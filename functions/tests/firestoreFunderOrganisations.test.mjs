// Requires a local Firestore emulator loaded with firestore.rules. Never connects to a live project.
// firebase emulators:exec --only firestore --project demo-funder-organisations "node --test functions/tests/firestoreFunderOrganisations.test.mjs"
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app'
import { getFirestore as adminFirestore } from 'firebase-admin/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, getDocs, collection, query, where, terminate, setLogLevel,
} from 'firebase/firestore'

const emulator = String(process.env.FIRESTORE_EMULATOR_HOST || '').replace(/^localhost:/, '127.0.0.1:')
if (!/^127\.0\.0\.1:\d+$/.test(emulator)) throw new Error('Set FIRESTORE_EMULATOR_HOST to a local emulator before running these tests.')
const projectId = 'demo-funder-organisations'
const admin = initializeAdmin({ projectId }, 'funder-org-rules-test')
const db = adminFirestore(admin)
const clients = []
const client = (uid) => {
  const app = initializeApp({ projectId, apiKey: 'test-api-key' }, `test-${uid}`)
  const store = getFirestore(app)
  connectFirestoreEmulator(store, '127.0.0.1', Number(emulator.split(':')[1]), { mockUserToken: { sub: uid, email: `${uid}@example.test`, email_verified: true } })
  clients.push({ app, store })
  return store
}
setLogLevel('silent')
const denied = (promise) => assert.rejects(promise, (error) => error.code === 'permission-denied')

const orgFunder = client('orgFunder')
const waitingFunder = client('waitingFunder')
const legacyFunder = client('legacyFunder')
const legacyAllFunder = client('legacyAllFunder')
const directorA = client('directorA')
const sme = client('sme')
const sysadmin = client('sysadmin')

// Company A runs pA1 (funded) and pA2 (not); company B runs pB1 (funded); company C runs pC1 (not).
const records = (prefix) => ({
  [`${prefix}A1`]: { companyCode: 'A', programId: 'pA1' },
  [`${prefix}A2`]: { companyCode: 'A', programId: 'pA2' },
  [`${prefix}B1`]: { companyCode: 'B', programId: 'pB1' },
  [`${prefix}C1`]: { companyCode: 'C', programId: 'pC1' },
  [`${prefix}NoCompany`]: { programId: 'pA1' },
  [`${prefix}Empty`]: { companyCode: '', programId: '' },
})

before(async () => {
  const writes = [
    db.doc('users/orgFunder').set({ role: 'funder', email: 'orgFunder@example.test', funderOrgId: 'org1', funderProgramIds: ['pA1', 'pB1'], funderCompanyCodes: ['A', 'B'] }),
    db.doc('users/waitingFunder').set({ role: 'funder', email: 'waitingFunder@example.test', funderOrgId: 'org2', funderProgramIds: [], funderCompanyCodes: [] }),
    db.doc('users/legacyFunder').set({ role: 'funder', email: 'legacyFunder@example.test', companyCode: 'A', assignedProgramIds: ['pA1'] }),
    db.doc('users/legacyAllFunder').set({ role: 'funder', email: 'legacyAllFunder@example.test', companyCode: 'A', assignedProgramIds: [] }),
    db.doc('users/directorA').set({ role: 'director', email: 'directorA@example.test', companyCode: 'A' }),
    db.doc('users/sme').set({ role: 'incubatee', email: 'sme@example.test', companyCode: 'A' }),
    db.doc('users/sysadmin').set({ role: 'systemadmin', email: 'sysadmin@example.test' }),
    db.doc('funderOrganisations/org1').set({ name: 'Green Futures Fund', status: 'confirmed' }),
    db.doc('funderOrganisations/org2').set({ name: 'New Funder', status: 'invited' }),
    db.doc('funderLinks/pA1_org1').set({ programId: 'pA1', companyCode: 'A', funderOrgId: 'org1', status: 'active' }),
    db.doc('funderLinks/pB1_org1').set({ programId: 'pB1', companyCode: 'B', funderOrgId: 'org1', status: 'active' }),
    db.doc('funderLinks/pA2_org2').set({ programId: 'pA2', companyCode: 'A', funderOrgId: 'org2', status: 'pending' }),
    db.doc('kpis/kpiA').set({ companyCode: 'A', name: 'Jobs' }),
    db.doc('kpis/kpiEmpty').set({ companyCode: '', name: 'Orphan' }),
  ]
  for (const name of ['applications', 'participants', 'assignedInterventions', 'appointments']) {
    for (const [id, data] of Object.entries(records(name))) writes.push(db.doc(`${name}/${id}`).set(data))
  }
  for (const id of ['participantsA1', 'participantsA2']) {
    writes.push(db.doc(`monthlyPerformance/${id}`).set({ revenue: 1 }), db.doc(`monthlyPerformance/${id}/history/2026-10`).set({ revenue: 1 }))
  }
  await Promise.all(writes)
})

after(async () => {
  await Promise.all(clients.map(async ({ app, store }) => { await terminate(store); await deleteApp(app) }))
  await deleteAdmin(admin)
})

test('an organisation funder reads its linked programmes at two companies and nothing else', async () => {
  for (const name of ['applications', 'participants', 'assignedInterventions', 'appointments']) {
    assert.ok((await getDoc(doc(orgFunder, name, `${name}A1`))).exists(), `${name} A1`)
    assert.ok((await getDoc(doc(orgFunder, name, `${name}B1`))).exists(), `${name} B1`)
    for (const id of ['A2', 'C1', 'NoCompany', 'Empty']) await denied(getDoc(doc(orgFunder, name, `${name}${id}`)))
  }
})

test('an organisation funder\'s list queries must name a linked company and its programmes', async () => {
  for (const name of ['applications', 'participants', 'assignedInterventions', 'appointments']) {
    const rows = await getDocs(query(collection(orgFunder, name), where('companyCode', '==', 'A'), where('programId', 'in', ['pA1'])))
    assert.deepEqual(rows.docs.map((row) => row.id), [`${name}A1`])
    await denied(getDocs(query(collection(orgFunder, name), where('companyCode', '==', 'A'))))
    await denied(getDocs(query(collection(orgFunder, name), where('companyCode', '==', 'C'), where('programId', 'in', ['pC1']))))
    await denied(getDocs(query(collection(orgFunder, name), where('companyCode', '==', ''))))
  }
})

test('monthly performance follows the participant\'s programme', async () => {
  assert.ok((await getDoc(doc(orgFunder, 'monthlyPerformance', 'participantsA1'))).exists())
  assert.equal((await getDocs(collection(orgFunder, 'monthlyPerformance', 'participantsA1', 'history'))).size, 1)
  await denied(getDoc(doc(orgFunder, 'monthlyPerformance', 'participantsA2')))
  await denied(getDocs(collection(orgFunder, 'monthlyPerformance', 'participantsA2', 'history')))
})

test('a funder whose organisation has no active links sees nothing, including records with no company', async () => {
  for (const name of ['applications', 'participants', 'assignedInterventions', 'appointments']) {
    for (const id of ['A1', 'A2', 'Empty', 'NoCompany']) await denied(getDoc(doc(waitingFunder, name, `${name}${id}`)))
  }
  await denied(getDoc(doc(waitingFunder, 'kpis', 'kpiEmpty')))
  await denied(getDoc(doc(orgFunder, 'kpis', 'kpiEmpty')))
  assert.ok((await getDoc(doc(orgFunder, 'kpis', 'kpiA'))).exists())
  await denied(getDoc(doc(waitingFunder, 'kpis', 'kpiA')))
})

test('company-scoped funders behave as before', async () => {
  assert.ok((await getDoc(doc(legacyFunder, 'applications', 'applicationsA1'))).exists())
  await denied(getDoc(doc(legacyFunder, 'applications', 'applicationsA2')))
  await denied(getDoc(doc(legacyFunder, 'applications', 'applicationsB1')))
  assert.ok((await getDoc(doc(legacyAllFunder, 'applications', 'applicationsA2'))).exists())
  assert.ok((await getDoc(doc(legacyAllFunder, 'assignedInterventions', 'assignedInterventionsA2'))).exists())
  await denied(getDoc(doc(legacyAllFunder, 'applications', 'applicationsB1')))
  assert.ok((await getDoc(doc(legacyFunder, 'kpis', 'kpiA'))).exists())
})

test('nobody can give themselves a funder organisation or its access', async () => {
  await denied(updateDoc(doc(orgFunder, 'users', 'orgFunder'), { funderProgramIds: ['pA1', 'pA2', 'pC1'] }))
  await denied(updateDoc(doc(orgFunder, 'users', 'orgFunder'), { funderCompanyCodes: ['A', 'B', 'C'] }))
  await denied(updateDoc(doc(waitingFunder, 'users', 'waitingFunder'), { funderOrgId: 'org1' }))
  await denied(updateDoc(doc(sme, 'users', 'sme'), { funderOrgId: 'org1' }))
  await denied(setDoc(doc(client('newSignup'), 'users', 'newSignup'), { role: 'incubatee', funderOrgId: 'org1', funderProgramIds: ['pA1'] }))
  await updateDoc(doc(orgFunder, 'users', 'orgFunder'), { name: 'Still editable' })
})

test('links are read by both sides only, and written by nobody client-side', async () => {
  assert.ok((await getDoc(doc(orgFunder, 'funderLinks', 'pA1_org1'))).exists())
  await denied(getDoc(doc(orgFunder, 'funderLinks', 'pA2_org2')))
  assert.equal((await getDocs(query(collection(orgFunder, 'funderLinks'), where('funderOrgId', '==', 'org1')))).size, 2)
  await denied(getDocs(query(collection(orgFunder, 'funderLinks'), where('funderOrgId', '==', 'org2'))))

  assert.equal((await getDocs(query(collection(directorA, 'funderLinks'), where('companyCode', '==', 'A')))).size, 2)
  await denied(getDoc(doc(directorA, 'funderLinks', 'pB1_org1')))
  await denied(getDocs(query(collection(sme, 'funderLinks'), where('companyCode', '==', 'A'))))

  for (const store of [orgFunder, directorA, sysadmin]) {
    await denied(setDoc(doc(store, 'funderLinks', 'pA2_org1'), { programId: 'pA2', companyCode: 'A', funderOrgId: 'org1', status: 'active' }))
    await denied(updateDoc(doc(store, 'funderLinks', 'pA1_org1'), { status: 'removed' }))
  }
})

test('organisations are read by their own members and system admins only, and written by nobody client-side', async () => {
  assert.ok((await getDoc(doc(orgFunder, 'funderOrganisations', 'org1'))).exists())
  await denied(getDoc(doc(orgFunder, 'funderOrganisations', 'org2')))
  await denied(getDoc(doc(directorA, 'funderOrganisations', 'org1')))
  await denied(getDocs(collection(directorA, 'funderOrganisations')))
  assert.equal((await getDocs(collection(sysadmin, 'funderOrganisations'))).size, 2)
  await denied(updateDoc(doc(sysadmin, 'funderOrganisations', 'org2'), { status: 'confirmed' }))
  await denied(updateDoc(doc(waitingFunder, 'funderOrganisations', 'org2'), { status: 'confirmed' }))
})
