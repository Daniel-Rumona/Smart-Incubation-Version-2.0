#!/usr/bin/env node

/*
 * Sets up a second company, RCM, so multi-company behaviour (a director who only sees their own
 * company, consultants employed by a client company) can be tried with real logins:
 *
 *   - companies/RCM
 *   - a working director login (default director@quantilytix.co.za) - Firebase Auth user + users doc
 *   - two RCM consultants with their own logins, and the existing quantilytix@gmail.com consultant
 *     moved under RCM (users.companyCode = RCM)
 *   - one existing programme (default "Women in Agri Accelerator 2026") re-homed to RCM: the
 *     programme, its participants, applications and assigned interventions all get companyCode RCM,
 *     and every SME's interventions are re-assigned round-robin across the three RCM consultants
 *
 * The new accounts are emailed nothing - they simply exist with the dummy password (printed at the
 * end; change it with --password). Everything changed is recorded in
 * scripts/seed-output-rcm-<timestamp>.json so --undo can restore it (and delete the new accounts).
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/setup-company-rcm.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/setup-company-rcm.cjs --service-account ./scripts/new-service-account.json --apply
 *
 *   # undo
 *   node scripts/setup-company-rcm.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-rcm-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const COMPANY_CODE = 'RCM'
const DIRECTOR = { email: 'director@quantilytix.co.za', name: 'RCM Director', role: 'director' }
const NEW_CONSULTANTS = [
  { email: 'thandi.molefe.rcm@quantilytix.co.za', name: 'Thandi Molefe' },
  { email: 'sipho.ndlovu.rcm@quantilytix.co.za', name: 'Sipho Ndlovu' },
]
const EXISTING_CONSULTANT_EMAIL = 'quantilytix@gmail.com'
const ASSIGNEE_FIELDS = ['assigneeUid', 'assigneeId', 'assigneeName', 'assigneeEmail', 'assigneeType']

function parseArgs(argv) {
  const args = { apply: false, password: 'Rcm#Demo2026!', programName: 'Women in Agri Accelerator 2026' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--password=')) args.password = arg.slice('--password='.length)
    else if (arg === '--password') args.password = argv[++index]
    else if (arg.startsWith('--program-name=')) args.programName = arg.slice('--program-name='.length)
    else if (arg === '--program-name') args.programName = argv[++index]
    else if (arg.startsWith('--undo=')) args.undo = arg.slice('--undo='.length)
    else if (arg === '--undo') args.undo = argv[++index]
    else if (arg === '--apply') args.apply = true
  }
  return args
}

function loadServiceAccount(args) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'))
  }
  if (!args.serviceAccount) {
    throw new Error('Pass --service-account <path> or set FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_B64.')
  }
  const resolved = path.isAbsolute(args.serviceAccount) ? args.serviceAccount : path.resolve(process.cwd(), args.serviceAccount)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()
  const auth = admin.auth()
  const FieldValue = admin.firestore.FieldValue

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest from ${manifest.createdAt}`)
    console.log(`  restores ${manifest.restored.length} document(s), deletes ${manifest.createdAccounts.length} account(s)${manifest.createdCompany ? ', deletes companies/RCM' : ''}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to undo.')
      return
    }
    for (const entry of manifest.restored) {
      const update = {}
      Object.entries(entry.previous).forEach(([field, value]) => { update[field] = value === null && entry.deleteIfNull?.includes(field) ? FieldValue.delete() : value })
      await db.collection(entry.collection).doc(entry.id).update(update)
    }
    for (const account of manifest.createdAccounts) {
      await db.collection('users').doc(account.uid).delete().catch(() => undefined)
      await db.collection('userIdentities').doc(account.uid).delete().catch(() => undefined)
      await auth.deleteUser(account.uid).catch(() => undefined)
    }
    if (manifest.createdCompany) await db.collection('companies').doc(COMPANY_CODE).delete()
    console.log('\nUndone.')
    return
  }

  const programSnap = await db.collection('programs').where('name', '==', args.programName).limit(1).get()
  if (programSnap.empty) throw new Error(`No programme named "${args.programName}" found.`)
  const programDoc = programSnap.docs[0]
  const programId = programDoc.id
  const previousProgramCompany = programDoc.data().companyCode || null

  const existingConsultant = await auth.getUserByEmail(EXISTING_CONSULTANT_EMAIL).catch(() => null)
  if (!existingConsultant) throw new Error(`No Firebase Auth user found for ${EXISTING_CONSULTANT_EMAIL}.`)
  const existingConsultantDoc = await db.collection('users').doc(existingConsultant.uid).get()
  const existingConsultantData = existingConsultantDoc.data() || {}

  const [participants, applications, assignments] = await Promise.all([
    db.collection('participants').where('programId', '==', programId).get(),
    db.collection('applications').where('programId', '==', programId).get(),
    db.collection('assignedInterventions').where('programId', '==', programId).get(),
  ])
  const companyDoc = await db.collection('companies').doc(COMPANY_CODE).get()

  console.log('\nPlan')
  console.log(`  company            : ${COMPANY_CODE} (${companyDoc.exists ? 'exists - will be updated' : 'new'})`)
  console.log(`  director login     : ${DIRECTOR.email}  (password: ${args.password})`)
  console.log(`  new consultants    : ${NEW_CONSULTANTS.map((item) => item.email).join(', ')}`)
  console.log(`  existing consultant: ${EXISTING_CONSULTANT_EMAIL} -> companyCode ${COMPANY_CODE} (was ${existingConsultantData.companyCode || 'none'})`)
  console.log(`  programme          : ${args.programName} (${programId}) ${previousProgramCompany} -> ${COMPANY_CODE}`)
  console.log(`  re-homed documents : ${participants.size} participants, ${applications.size} applications, ${assignments.size} assigned interventions`)

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these changes.')
    return
  }

  const now = FieldValue.serverTimestamp()
  const manifest = { createdAt: new Date().toISOString(), createdCompany: !companyDoc.exists, createdAccounts: [], restored: [] }

  await db.collection('companies').doc(COMPANY_CODE).set({
    companyCode: COMPANY_CODE,
    name: COMPANY_CODE,
    companyName: COMPANY_CODE,
    status: 'active',
    hasDepartments: false,
    hasBranches: false,
    assignmentModel: 'ops_assign_consultant',
    smeDivisionModel: 'ops_assign_smes_to_consultants',
    locked: true,
    createdAt: now,
    updatedAt: now,
  }, { merge: true })

  const ensureAccount = async ({ email, name, role }) => {
    let record = await auth.getUserByEmail(email).catch(() => null)
    if (record) {
      await auth.updateUser(record.uid, { password: args.password, emailVerified: true, disabled: false, displayName: name })
    } else {
      record = await auth.createUser({ email, password: args.password, displayName: name, emailVerified: true, disabled: false })
      manifest.createdAccounts.push({ uid: record.uid, email })
    }
    const profile = {
      uid: record.uid,
      email,
      name,
      displayName: name,
      role,
      companyCode: COMPANY_CODE,
      assignedProgramIds: [],
      emailVerified: true,
      firstLoginComplete: true,
      mustChangePassword: false,
      active: true,
      status: 'active',
      updatedAt: now,
    }
    await db.collection('users').doc(record.uid).set({ ...profile, createdAt: now }, { merge: true })
    await db.collection('userIdentities').doc(record.uid).set({ uid: record.uid, email, name, displayName: name, role, companyCode: COMPANY_CODE, mustChangePassword: false, updatedAt: now }, { merge: true })
    return { uid: record.uid, email, name }
  }

  await ensureAccount({ ...DIRECTOR })
  const consultants = [
    { uid: existingConsultant.uid, email: EXISTING_CONSULTANT_EMAIL, name: existingConsultantData.name || existingConsultantData.displayName || 'Consultant' },
  ]
  for (const item of NEW_CONSULTANTS) consultants.push(await ensureAccount({ ...item, role: 'consultant' }))

  manifest.restored.push({ collection: 'users', id: existingConsultant.uid, previous: { companyCode: existingConsultantData.companyCode ?? null }, deleteIfNull: ['companyCode'] })
  await db.collection('users').doc(existingConsultant.uid).update({ companyCode: COMPANY_CODE, updatedAt: now })
  const identityDoc = await db.collection('userIdentities').doc(existingConsultant.uid).get()
  if (identityDoc.exists) {
    manifest.restored.push({ collection: 'userIdentities', id: existingConsultant.uid, previous: { companyCode: identityDoc.data().companyCode ?? null }, deleteIfNull: ['companyCode'] })
    await db.collection('userIdentities').doc(existingConsultant.uid).update({ companyCode: COMPANY_CODE })
  }

  manifest.restored.push({ collection: 'programs', id: programId, previous: { companyCode: previousProgramCompany } })
  await db.collection('programs').doc(programId).update({ companyCode: COMPANY_CODE, updatedAt: now })

  for (const doc of [...participants.docs, ...applications.docs]) {
    const collectionName = doc.ref.parent.id
    manifest.restored.push({ collection: collectionName, id: doc.id, previous: { companyCode: doc.data().companyCode ?? null } })
    await doc.ref.update({ companyCode: COMPANY_CODE, updatedAt: now })
  }

  // One consultant per SME, round-robin, so each SME's interventions stay with the same person.
  const consultantByParticipant = new Map()
  let next = 0
  for (const doc of assignments.docs) {
    const participantId = String(doc.data().participantId || doc.id)
    if (!consultantByParticipant.has(participantId)) consultantByParticipant.set(participantId, consultants[next++ % consultants.length])
    const consultant = consultantByParticipant.get(participantId)
    const previous = { companyCode: doc.data().companyCode ?? null }
    ASSIGNEE_FIELDS.forEach((field) => { previous[field] = doc.data()[field] ?? null })
    manifest.restored.push({ collection: 'assignedInterventions', id: doc.id, previous })
    await doc.ref.update({
      companyCode: COMPANY_CODE,
      assigneeUid: consultant.uid,
      assigneeId: consultant.uid,
      assigneeName: consultant.name,
      assigneeEmail: consultant.email,
      assigneeType: 'consultant',
      updatedAt: now,
    })
  }

  const manifestPath = path.resolve(__dirname, `seed-output-rcm-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log('\nDone.')
  console.log(`  Director login : ${DIRECTOR.email} / ${args.password}`)
  console.log(`  Consultants    : ${consultants.map((item) => item.email).join(', ')}`)
  console.log(`  ${EXISTING_CONSULTANT_EMAIL} keeps its existing password.`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/setup-company-rcm.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
