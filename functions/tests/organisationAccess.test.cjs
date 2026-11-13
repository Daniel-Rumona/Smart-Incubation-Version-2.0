// Run after `npm --prefix functions run build` with node --test functions/tests/organisationAccess.test.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { requestOrganisationAccess, reviewOrganisationAccess, registrationKind, notifyCompletedRegistration, notifyFirstOrganisationStaff } = require('../lib/organisationAccess.js')
const { completeDirectorSetup } = require('../lib/directorSetup.js')
const { joinProgram } = require('../lib/programJoin.js')

// Serial transactions with atomic writes, create preconditions and Firestore's read-before-write constraint.
class Database {
  constructor(records = {}) { this.records = new Map(Object.entries(records)); this.queue = Promise.resolve() }
  collection(name) {
    return { doc: id => ({ path: `${name}/${id}`, id }), where: (field, op, value) => ({ name, field, value }) }
  }
  snapshot(path) {
    const data = this.records.get(path)
    return { exists: data !== undefined, id: path.split('/').at(-1), data: () => data, get: key => data?.[key] }
  }
  runTransaction(fn) {
    const run = this.queue.then(async () => {
      const writes = []
      const tx = {
        get: async ref => {
          assert.equal(writes.length, 0, 'Firestore requires all reads before writes')
          return ref.path ? this.snapshot(ref.path) : { docs: [...this.records.keys()].filter(path => path.startsWith(`${ref.name}/`) && this.records.get(path)[ref.field] === ref.value).map(path => this.snapshot(path)) }
        },
        create: (ref, data) => writes.push({ ref, data, create: true }),
        update: (ref, data) => writes.push({ ref, data, update: true, merge: true }),
        set: (ref, data, options) => writes.push({ ref, data, merge: options?.merge }),
      }
      const result = await fn(tx)
      const next = new Map(this.records)
      for (const write of writes) {
        if (write.create) assert.equal(next.has(write.ref.path), false, 'Document already exists')
        if (write.update) assert.equal(next.has(write.ref.path), true, 'Document missing')
        next.set(write.ref.path, write.merge ? { ...next.get(write.ref.path), ...write.data } : write.data)
      }
      this.records = next
      return result
    })
    this.queue = run.catch(() => {})
    return run
  }
  mails() { return [...this.records.entries()].filter(([path]) => path.startsWith('mail/')) }
}
const request = { contactName: 'Example Person', organisationName: 'Example Incubator', phone: '123', notes: 'Demo please' }
const setup = { companyName: 'Example Incubator', companyCode: 'EXAMPLE', consultantLabel: 'Consultants', hasDepartments: false, hasBranches: false, smeOnboardingModel: 'self_application', assignmentModel: 'ops_assign_consultant', interventionScopeModel: 'company_wide' }
const timestamp = value => ({ toMillis: () => value, toDate: () => new Date(value) })
const baseUrl = 'https://example.test'

test('new SME and consultant accounts cannot create an organisation directly', async () => {
  for (const role of ['incubatee', 'consultant']) {
    const db = new Database({ 'users/new': { role } })
    await assert.rejects(completeDirectorSetup(db, 'new', 'new@example.test', setup), /Request organisation access/)
    assert.equal(db.records.has('companies/EXAMPLE'), false)
  }
})

test('request retries queue one email, and only a System Admin can approve', async () => {
  const db = new Database({ 'users/new': { role: 'incubatee' }, 'users/admin': { role: 'systemadmin' }, 'users/other': { role: 'director' } })
  await Promise.all([1, 2].map(() => requestOrganisationAccess(db, 'new', 'new@example.test', request, baseUrl)))
  assert.equal(db.mails().length, 1)
  assert.deepEqual(db.mails()[0][1].to, ['daniel@quantilytix.co.za'])
  assert.equal(db.records.get('users/new').organisationAccessStatus, 'pending')
  await assert.rejects(reviewOrganisationAccess(db, 'other', 'new', 'approved', ''), /Only a System Admin/)
  await reviewOrganisationAccess(db, 'admin', 'new', 'approved', '')
  await reviewOrganisationAccess(db, 'admin', 'new', 'approved', '')
  assert.equal(db.records.get('users/new').role, 'director')
  await completeDirectorSetup(db, 'new', 'new@example.test', setup)
  assert.equal(db.records.get('companies/EXAMPLE').ownerUid, 'new')
  assert.equal(db.records.get('organisationMilestones/EXAMPLE').status, 'awaiting_first_staff')
})

test('rejected requests cannot create an organisation or join an SME programme', async () => {
  const db = new Database({ 'users/new': { role: 'incubatee' }, 'users/admin': { role: 'systemadmin' } })
  await requestOrganisationAccess(db, 'new', 'new@example.test', request, baseUrl)
  await reviewOrganisationAccess(db, 'admin', 'new', 'rejected', 'Contact us')
  await assert.rejects(completeDirectorSetup(db, 'new', '', setup), /must be approved/)
  await assert.rejects(joinProgram(db, 'new', { path: 'skip' }), /organisation request/)
  await assert.rejects(reviewOrganisationAccess(db, 'admin', 'new', 'approved', ''), /already been reviewed/)
  assert.equal(db.records.get('users/new').role, 'incubatee')
})

test('existing directors retain access but cannot claim another organisation', async () => {
  const db = new Database({ 'users/director': { role: 'director' } })
  await completeDirectorSetup(db, 'director', '', setup)
  assert.equal((await completeDirectorSetup(db, 'director', '', setup)).alreadyLocked, true)
  db.records.set('users/other', { role: 'director', organisationAccessStatus: 'approved' })
  await assert.rejects(completeDirectorSetup(db, 'other', '', setup), /already in use/)
})

test('notification classification waits for completed onboarding and excludes managed accounts and linked SMEs', () => {
  const sme = { role: 'incubatee', firstLoginComplete: true, smeOnboardingComplete: true }
  assert.equal(registrationKind(sme), 'SME')
  assert.equal(registrationKind({ ...sme, smeOnboardingComplete: false }), null)
  assert.equal(registrationKind({ ...sme, registrationProgramLink: { programId: 'p' } }), null)
  assert.equal(registrationKind({ ...sme, managedAccount: true }), null)
  assert.equal(registrationKind({ ...sme, organisationAccessStatus: 'pending' }), null)
  assert.equal(registrationKind({ role: 'consultant', firstLoginComplete: true }), 'consultant')
  assert.equal(registrationKind({ role: 'consultant', firstLoginComplete: true, companyCode: 'EXAMPLE' }), null)
})

test('a validated programme link suppresses registration mail; invalid links cannot set the exemption', async () => {
  const db = new Database({
    'users/sme': { role: 'incubatee', firstLoginComplete: true, smeOnboardingComplete: false },
    'programs/p': { companyCode: 'EXAMPLE', status: 'active' }, 'companies/EXAMPLE': { name: 'Example' },
  })
  await assert.rejects(joinProgram(db, 'sme', { path: 'program_link', programId: 'missing' }), /could not be found/)
  assert.equal(db.records.get('users/sme').registrationProgramLink, undefined)
  await joinProgram(db, 'sme', { path: 'program_link', programId: 'p' })
  assert.equal(db.records.get('users/sme').registrationProgramLink.programId, 'p')
  await notifyCompletedRegistration(db, 'sme', baseUrl)
  assert.equal(db.mails().length, 0)
})

test('direct SME and freelance registrations produce one email each under duplicate events', async () => {
  const db = new Database({
    'users/sme': { role: 'incubatee', firstLoginComplete: true, smeOnboardingComplete: true },
    'users/consultant': { role: 'consultant', firstLoginComplete: true },
  })
  await Promise.all(['sme', 'sme', 'consultant', 'consultant'].map(uid => notifyCompletedRegistration(db, uid, baseUrl)))
  assert.equal(db.mails().length, 2)
})

test('concurrent first staff registrations queue one milestone, permanently', async () => {
  const db = new Database({
    'companies/EXAMPLE': { name: 'Example' },
    'organisationMilestones/EXAMPLE': { status: 'awaiting_first_staff' },
    'users/a': { role: 'consultant', companyCode: 'EXAMPLE', staffJoinedAt: timestamp(1) },
    'users/b': { role: 'operations', companyCode: 'EXAMPLE', staffJoinedAt: timestamp(2) },
  })
  await Promise.all(['b', 'a', 'a'].map(uid => notifyFirstOrganisationStaff(db, uid, 'EXAMPLE', baseUrl)))
  assert.equal(db.mails().length, 1)
  db.records.delete('users/a')
  db.records.delete('users/b')
  db.records.set('users/c', { role: 'admin', companyCode: 'EXAMPLE' })
  await notifyFirstOrganisationStaff(db, 'c', 'EXAMPLE', baseUrl)
  assert.equal(db.mails().length, 1)
})

test('legacy organisations with existing staff are baselined silently', async () => {
  const db = new Database({
    'companies/EXAMPLE': { name: 'Example' },
    'users/old': { role: 'operations', companyCode: 'EXAMPLE', createdAt: timestamp(1) },
    'users/new': { role: 'operations', companyCode: 'EXAMPLE', staffJoinedAt: timestamp(10) },
  })
  await notifyFirstOrganisationStaff(db, 'new', 'EXAMPLE', baseUrl)
  assert.equal(db.mails().length, 0)
  assert.equal(db.records.get('organisationMilestones/EXAMPLE').notificationQueued, false)
})

test('a delayed staff event cannot notify the wrong organisation after an account moves', async () => {
  const db = new Database({ 'users/person': { role: 'consultant', companyCode: 'OTHER' } })
  await notifyFirstOrganisationStaff(db, 'person', 'EXAMPLE', baseUrl)
  assert.equal(db.mails().length, 0)
  assert.equal(db.records.has('organisationMilestones/EXAMPLE'), false)
})
