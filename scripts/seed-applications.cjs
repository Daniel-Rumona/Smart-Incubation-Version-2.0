#!/usr/bin/env node

/*
 * Backfills `applications` documents for the dummy SMEs created by
 * seed-assigned-interventions.cjs. Those participants were seeded straight into the
 * `participants` collection with no corresponding application, so anything that reads
 * `applications` (Operations/Project Admin Reports - acceptance rate, applicant demographics,
 * intake trend charts) sees zero data for this cohort even though the SMEs themselves exist.
 *
 * For each participant tagged with --seed-tag, creates one accepted `applications` doc reusing
 * that participant's real businessName/email/phone/sector/stage/province/beeLevel/programId, plus
 * generated demographic fields (gender, age, hub, city, disability/education/employment/marital
 * status, location type, ownership percentages) so the applicant-profile charts have something to
 * show. Dated a few months before the participant's own createdAt so intake precedes activity.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-applications.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890
 *
 *   # write it
 *   node scripts/seed-applications.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890 --apply
 *
 *   # undo a previous run
 *   node scripts/seed-applications.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-applications-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const GENDERS = ['Female', 'Male']
const AGE_GROUPS = ['18-24', '25-34', '35-44', '45-54', '55+']
const HUBS = ['Johannesburg Hub', 'Cape Town Hub', 'Durban Hub', 'Pretoria Hub']
const CITIES = ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Bloemfontein', 'Port Elizabeth']
const DISABILITY_STATUSES = ['None', 'None', 'None', 'None', 'Physical', 'Visual', 'Hearing']
const EDUCATION_LEVELS = ['Matric', 'Diploma', "Bachelor's Degree", 'Honours Degree', 'Postgraduate']
const EMPLOYMENT_STATUSES = ['Self-employed', 'Employed full-time', 'Unemployed', 'Part-time']
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed']
const LOCATION_TYPES = ['Urban', 'Peri-urban', 'Rural']
const OWNERSHIP_PERCENTS = [0, 25, 50, 75, 100]

function parseArgs(argv) {
  const args = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--seed-tag=')) args.seedTag = arg.slice('--seed-tag='.length)
    else if (arg === '--seed-tag') args.seedTag = argv[++index]
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

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.created.length} document(s) from ${manifest.createdAt}`)

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

  if (!args.seedTag) throw new Error('Pass --seed-tag <tag> (the seedTag written by seed-assigned-interventions.cjs, e.g. demo-assigned-1789583332890).')

  const participantsSnapshot = await db.collection('participants').where('seedTag', '==', args.seedTag).get()
  if (participantsSnapshot.empty) throw new Error(`No participants found with seedTag=${args.seedTag}. Check the tag, or that the original seed run was applied.`)
  const participants = participantsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))

  const seedTag = `applications-${args.seedTag}`
  const existingApplications = await db.collection('applications').where('seedTag', '==', seedTag).get()
  const alreadyHasApplication = new Set(existingApplications.docs.map((docSnap) => docSnap.data().participantId))

  const programCache = new Map()
  const resolveProgramName = async (programId) => {
    if (!programId) return null
    if (programCache.has(programId)) return programCache.get(programId)
    const programDoc = await db.collection('programs').doc(programId).get()
    const name = programDoc.exists ? (programDoc.data().name || programDoc.data().title || null) : null
    programCache.set(programId, name)
    return name
  }

  console.log('\nSource participants')
  console.log(`  seedTag      : ${args.seedTag}`)
  console.log(`  participants : ${participants.length}`)

  const rand = makeRand(31)

  const plan = []
  for (const participant of participants) {
    if (alreadyHasApplication.has(participant.id)) continue
    const programName = await resolveProgramName(participant.programId)
    const createdAt = participant.createdAt && participant.createdAt.toDate ? participant.createdAt.toDate() : new Date()
    const submittedAt = addDays(createdAt, -(30 + Math.floor(rand() * 150)))
    const acceptedAt = addDays(submittedAt, 3 + Math.floor(rand() * 21))
    plan.push({
      participant,
      programName,
      submittedAt,
      acceptedAt,
      gender: pick(GENDERS, rand),
      ageGroup: pick(AGE_GROUPS, rand),
      age: 22 + Math.floor(rand() * 40),
      yearsOfTrading: 1 + Math.floor(rand() * 15),
      hub: pick(HUBS, rand),
      city: pick(CITIES, rand),
      disabilityStatus: pick(DISABILITY_STATUSES, rand),
      educationLevel: pick(EDUCATION_LEVELS, rand),
      employmentStatus: pick(EMPLOYMENT_STATUSES, rand),
      maritalStatus: pick(MARITAL_STATUSES, rand),
      locationType: pick(LOCATION_TYPES, rand),
      youthOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
      femaleOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
      blackOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
    })
  }

  const skipped = participants.length - plan.length
  console.log(`\nWill create ${plan.length} application(s) (seedTag=${seedTag})${skipped ? `, skipping ${skipped} that already have one` : ''}:`)
  plan.forEach(({ participant, submittedAt }) => {
    console.log(`  ${String(participant.businessName || participant.id).padEnd(28)} submitted ${submittedAt.toDateString()}`)
  })

  if (!plan.length) {
    console.log('\nNothing to do.')
    return
  }

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const created = []
  const now = admin.firestore.FieldValue.serverTimestamp()

  for (const entry of plan) {
    const { participant } = entry
    const applicationRef = db.collection('applications').doc()
    await applicationRef.set({
      uid: null,
      userId: null,
      applicantProfileId: null,
      businessProfileId: null,
      participantId: participant.id,
      businessName: participant.businessName,
      participantName: participant.participantName,
      email: participant.email || null,
      phone: participant.phone || null,
      gender: entry.gender,
      sector: participant.sector || '',
      stage: participant.stage || '',
      province: participant.province || '',
      hub: entry.hub,
      city: entry.city,
      ageGroup: entry.ageGroup,
      age: entry.age,
      yearsOfTrading: entry.yearsOfTrading,
      beeLevel: participant.beeLevel || '',
      disabilityStatus: entry.disabilityStatus,
      educationLevel: entry.educationLevel,
      employmentStatus: entry.employmentStatus,
      maritalStatus: entry.maritalStatus,
      locationType: entry.locationType,
      youthOwnedPercent: entry.youthOwnedPercent,
      femaleOwnedPercent: entry.femaleOwnedPercent,
      blackOwnedPercent: entry.blackOwnedPercent,
      programId: participant.programId || null,
      programName: entry.programName,
      companyCode: participant.companyCode || null,
      departmentId: null,
      status: 'accepted',
      applicationStatus: 'accepted',
      submittedAt: admin.firestore.Timestamp.fromDate(entry.submittedAt),
      acceptedAt: admin.firestore.Timestamp.fromDate(entry.acceptedAt),
      reviewedAt: admin.firestore.Timestamp.fromDate(entry.acceptedAt),
      reviewedBy: null,
      requiredInterventions: [],
      complianceDocuments: [],
      swot: null,
      seedTag,
      createdAt: admin.firestore.Timestamp.fromDate(entry.submittedAt),
      createdBy: null,
      updatedAt: now,
      updatedBy: null,
    })
    created.push({ collection: 'applications', id: applicationRef.id })
    console.log(`  created applications/${applicationRef.id} for ${participant.businessName}`)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-applications-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), sourceSeedTag: args.seedTag, seedTag, created }, null, 2))

  console.log(`\nDone. Created ${created.length} application(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-applications.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
