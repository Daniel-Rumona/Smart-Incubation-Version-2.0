#!/usr/bin/env node

/*
 * Seeds demo data so a user's "Assigned to me" page (AllocatedInterventionsPage, at
 * /consultant/allocated or /operations/interventions/assigned) has something to show:
 * N fake SME participants plus one assignedIntervention per SME, assigned to the target user.
 *
 * Every created document gets a `seedTag` field so the batch can be found and removed later.
 * A manifest of every created (collection, id) pair is also written to
 * scripts/seed-output-<timestamp>.json - pass that file to --undo to delete exactly those docs.
 *
 * Reuses firebase-admin from functions/node_modules (same pattern as
 * seed-agent-catalogue.cjs / set-sme-company-code.cjs) instead of a separate package.json.
 *
 * Usage:
 *   # dry run (default): show the target user and what would be created
 *   node scripts/seed-assigned-interventions.cjs --service-account ./scripts/new-service-account.json --email danieltmazorodze@gmail.com
 *
 *   # write it
 *   node scripts/seed-assigned-interventions.cjs --service-account ./scripts/new-service-account.json --email danieltmazorodze@gmail.com --count 20 --apply
 *
 *   # undo a previous run
 *   node scripts/seed-assigned-interventions.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-2025-01-01T00-00-00.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const SECTORS = ['Agro-processing', 'Retail & Trade', 'Manufacturing', 'ICT & Software', 'Tourism & Hospitality', 'Construction', 'Creative Industries', 'Professional Services', 'Renewable Energy', 'Health & Wellness']
const PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape']
const STAGES = ['Ideation', 'Startup', 'Early growth', 'Growth', 'Established']
const BEE_LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4']
const AREAS_OF_SUPPORT = ['Financial Management', 'Marketing & Sales', 'Digital Transformation', 'Operations & Compliance', 'Governance & Leadership', 'Access to Markets']
const INTERVENTION_TITLES = {
  'Financial Management': ['Financial Management Coaching', 'Cash Flow & Budgeting Workshop', 'Bookkeeping Systems Setup'],
  'Marketing & Sales': ['Marketing Strategy Development', 'Brand & Digital Presence Audit', 'Sales Pipeline Coaching'],
  'Digital Transformation': ['Digital Tools Onboarding', 'Website & E-commerce Setup', 'Systems Automation Review'],
  'Operations & Compliance': ['Compliance Readiness Review', 'Operations Efficiency Assessment', 'Standard Operating Procedures Workshop'],
  'Governance & Leadership': ['Governance & Leadership Coaching', 'Business Plan Refresh', 'Succession Planning Session'],
  'Access to Markets': ['Market Access Facilitation', 'Tender Readiness Coaching', 'Export Readiness Assessment'],
}
const BUSINESS_NAME_PREFIXES = ['Thandeka', 'Sizwe', 'Nkosi', 'Amanzi', 'Baobab', 'Ubuntu', 'Kagiso', 'Lerato', 'Vukani', 'Khaya', 'Zenzele', 'Impilo', 'Ikhaya', 'Sisonke', 'Masiza', 'Nala', 'Thuto', 'Vuka', 'Litha', 'Ntando']
const BUSINESS_NAME_SUFFIXES = ['Trading', 'Enterprises', 'Solutions', 'Holdings', 'Logistics', 'Consulting', 'Ventures', 'Projects', 'Supplies', 'Agri Co']
const FIRST_NAMES = ['Thandiwe', 'Bongani', 'Lindiwe', 'Sipho', 'Nomvula', 'Kagiso', 'Ayanda', 'Mpho', 'Zanele', 'Themba', 'Palesa', 'Kabelo', 'Nokuthula', 'Tumelo', 'Busisiwe']
const LAST_NAMES = ['Dlamini', 'Nkosi', 'Mokoena', 'Khumalo', 'Mahlangu', 'Radebe', 'Sithole', 'Zulu', 'Mbeki', 'Ndlovu']

function parseArgs(argv) {
  const args = { apply: false, count: 20 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length)
    else if (arg === '--email') args.email = argv[++index]
    else if (arg.startsWith('--count=')) args.count = Number(arg.slice('--count='.length))
    else if (arg === '--count') args.count = Number(argv[++index])
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

const pick = (list, rand) => list[Math.floor(rand() * list.length)]

/** Deterministic-enough PRNG so a dry run and the matching --apply run generate the same preview. */
function makeRand(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

function daysFromNow(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(9, 0, 0, 0)
  return date
}

/** Mirrors deriveStatus in AllocatedInterventionsPage.tsx so seeded rows land in the bucket they claim. */
function buildAssignmentStatusFields(bucket) {
  if (bucket === 'completed') {
    return { status: 'completed', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'done', participantCompletionStatus: 'confirmed', progress: 100 }
  }
  if (bucket === 'inProgress') {
    return { status: 'in_progress', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 40 + Math.round(Math.random() * 40) }
  }
  if (bucket === 'overdue') {
    return { status: 'pending', assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 10 }
  }
  return { status: 'pending', assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 0 }
}

function buildDueDate(bucket, index, rand) {
  if (bucket === 'overdue') return daysFromNow(-(3 + Math.floor(rand() * 10)))
  if (bucket === 'completed') return daysFromNow(-(5 + Math.floor(rand() * 20)))
  // Spread the rest across this week and the next few weeks so the operations dashboard's
  // "Upcoming Week" calendar and risk register have something to bucket.
  return daysFromNow(index % 5 === 0 ? 0 : Math.floor(rand() * 21))
}

function buildBusinesses(count, rand) {
  const businesses = []
  const usedNames = new Set()
  for (let index = 0; index < count; index += 1) {
    let businessName
    do {
      businessName = `${pick(BUSINESS_NAME_PREFIXES, rand)} ${pick(BUSINESS_NAME_SUFFIXES, rand)}`
    } while (usedNames.has(businessName))
    usedNames.add(businessName)

    const participantName = `${pick(FIRST_NAMES, rand)} ${pick(LAST_NAMES, rand)}`
    const areaOfSupport = pick(AREAS_OF_SUPPORT, rand)
    const sector = pick(SECTORS, rand)

    businesses.push({
      businessName,
      participantName,
      email: `${participantName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
      phone: `+27${String(60000000 + Math.floor(rand() * 9999999)).slice(0, 9)}`,
      sector,
      stage: pick(STAGES, rand),
      province: pick(PROVINCES, rand),
      beeLevel: pick(BEE_LEVELS, rand),
      areaOfSupport,
      interventionTitle: pick(INTERVENTION_TITLES[areaOfSupport], rand),
    })
  }
  return businesses
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()
  const auth = admin.auth()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.created.length} document(s) from ${manifest.createdAt}`)
    console.log(`Target user  : ${manifest.targetEmail}`)

    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to delete these documents.')
      return
    }

    let batch = db.batch()
    let opsInBatch = 0
    for (const entry of manifest.created) {
      batch.delete(db.collection(entry.collection).doc(entry.id))
      opsInBatch += 1
      if (opsInBatch === 400) {
        await batch.commit()
        batch = db.batch()
        opsInBatch = 0
      }
    }
    if (opsInBatch > 0) await batch.commit()
    console.log(`\nDeleted ${manifest.created.length} document(s).`)
    return
  }

  if (!args.email) throw new Error('Pass --email <address> (the user whose "Assigned to me" page gets seeded).')
  if (!Number.isFinite(args.count) || args.count <= 0) throw new Error('--count must be a positive number.')

  const userRecord = await auth.getUserByEmail(args.email).catch(() => null)
  if (!userRecord) throw new Error(`No Firebase Auth user found for ${args.email}. Create the account first - this script will not create one.`)

  const userDoc = await db.collection('users').doc(userRecord.uid).get()
  if (!userDoc.exists) throw new Error(`Auth user ${args.email} (${userRecord.uid}) has no matching users/${userRecord.uid} Firestore document. Complete their profile setup first.`)

  const userData = userDoc.data()
  const companyCode = String(userData.companyCode || '').trim()
  if (!companyCode) throw new Error(`users/${userRecord.uid} has no companyCode set - can't tell which tenant to seed the SMEs under.`)

  const role = String(userData.role || '')
  const assigneeType = ['operations', 'projectadmin', 'projectmanager'].includes(role) ? 'operations' : 'consultant'
  const assigneeName = String(userData.displayName || userData.name || args.email)

  const programSnapshot = await db.collection('programs').where('companyCode', '==', companyCode).limit(1).get()
  const programId = programSnapshot.empty ? null : programSnapshot.docs[0].id
  const programName = programSnapshot.empty ? null : (programSnapshot.docs[0].data().name || programSnapshot.docs[0].data().title || null)

  console.log('\nTarget user')
  console.log(`  email        : ${args.email}`)
  console.log(`  uid          : ${userRecord.uid}`)
  console.log(`  role         : ${role || '(none)'}`)
  console.log(`  companyCode  : ${companyCode}`)
  console.log(`  program      : ${programId ? `${programName || programId} (${programId})` : '(none found - assignments will have programId: null)'}`)
  console.log(`  assigneeType : ${assigneeType}`)

  const seedTag = `demo-assigned-${Date.now()}`
  const rand = makeRand(42)
  const businesses = buildBusinesses(args.count, rand)

  // Roughly a quarter overdue, a quarter completed, the rest split between pending and in-progress
  // due this week / soon - gives every status bucket on the page something to show.
  const buckets = businesses.map((_, index) => {
    const mod = index % 4
    if (mod === 0) return 'overdue'
    if (mod === 1) return 'completed'
    if (mod === 2) return 'inProgress'
    return 'pending'
  })

  console.log(`\nWill create ${args.count} participants + ${args.count} assignedInterventions (companyCode=${companyCode}, seedTag=${seedTag}):`)
  businesses.forEach((business, index) => {
    console.log(`  ${String(index + 1).padStart(2, ' ')}. ${business.businessName.padEnd(28)} ${business.interventionTitle.padEnd(34)} due ${buildDueDate(buckets[index], index, rand).toDateString()} [${buckets[index]}]`)
  })

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const created = []
  const now = admin.firestore.FieldValue.serverTimestamp()

  for (let index = 0; index < businesses.length; index += 1) {
    const business = businesses[index]
    const bucket = buckets[index]

    const participantRef = db.collection('participants').doc()
    await participantRef.set({
      applicationId: null,
      applicantProfileId: null,
      businessProfileId: null,
      programId,
      companyCode,
      departmentId: null,
      businessName: business.businessName,
      participantName: business.participantName,
      email: business.email,
      phone: business.phone,
      sector: business.sector,
      stage: business.stage,
      province: business.province,
      beeLevel: business.beeLevel,
      status: 'active',
      acceptedAt: now,
      acceptedBy: userRecord.uid,
      seedTag,
      createdAt: now,
      updatedAt: now,
    })
    created.push({ collection: 'participants', id: participantRef.id })

    const statusFields = buildAssignmentStatusFields(bucket)
    const dueDate = admin.firestore.Timestamp.fromDate(buildDueDate(bucket, index, rand))

    const assignmentRef = db.collection('assignedInterventions').doc()
    await assignmentRef.set({
      companyCode,
      groupId: null,
      participantId: participantRef.id,
      businessName: business.businessName,
      interventionDefinitionId: null,
      interventionId: null,
      interventionTitle: business.interventionTitle,
      subtitle: business.areaOfSupport,
      type: 'coaching',
      programId,
      programName,
      implementationDate: now,
      dueDate,
      isRecurring: false,
      assigneeType,
      assigneeUid: userRecord.uid,
      assigneeId: userRecord.uid,
      assigneeName,
      assigneeEmail: args.email,
      ...statusFields,
      areaOfSupport: business.areaOfSupport,
      targetType: 'number',
      targetValue: 10,
      targetMetric: 'hours',
      targetActual: bucket === 'completed' ? 10 : bucket === 'inProgress' ? Math.round(statusFields.progress / 10) : 0,
      timeSpent: 0,
      notes: '',
      seedTag,
      createdAt: now,
      createdBy: userRecord.uid,
      updatedAt: now,
      updatedBy: userRecord.uid,
    })
    created.push({ collection: 'assignedInterventions', id: assignmentRef.id })

    console.log(`  created ${business.businessName} -> participants/${participantRef.id}, assignedInterventions/${assignmentRef.id}`)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), targetEmail: args.email, seedTag, created }, null, 2))

  console.log(`\nDone. Created ${created.length} document(s) across participants + assignedInterventions.`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-assigned-interventions.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
