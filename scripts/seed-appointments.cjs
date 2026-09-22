#!/usr/bin/env node

/*
 * Seeds demo `appointments` for a previous run of seed-assigned-interventions.cjs, so the
 * Operations Reports "Appointments" tab (and the intervention appointment calendar) has
 * something to show for those dummy SMEs.
 *
 * Reads the assignedInterventions (and their participants) tagged with the given --seed-tag,
 * then creates 1-3 appointments per assignment: a mix of already-"held" ones (status: completed,
 * with attendance captured - present or absent) and still-"planned" upcoming ones (status:
 * pending/accepted, no attendance yet). This mirrors exactly what InterventionAppointmentsPage.tsx
 * writes when a real user schedules/completes an appointment.
 *
 * Every created document gets its own `seedTag` (appointments-<original assignment seedTag>) and a
 * manifest of every created (collection, id) pair is written to
 * scripts/seed-output-appointments-<timestamp>.json - pass that file to --undo to delete exactly
 * those docs.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-appointments.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890
 *
 *   # write it
 *   node scripts/seed-appointments.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890 --apply
 *
 *   # undo a previous run
 *   node scripts/seed-appointments.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-appointments-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const MEETING_TYPES = ['telephonic', 'online', 'in_person']
const DISCUSSION_SUMMARIES = [
  'Reviewed progress against targets and agreed next steps.',
  'Walked through outstanding action items and blockers.',
  'Covered implementation status and upcoming milestones.',
  'Discussed challenges since the last session and adjusted the plan.',
  'Confirmed deliverables and set the agenda for the next session.',
]

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

function daysFromNow(days, hour) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  date.setHours(hour, 0, 0, 0)
  return date
}

/**
 * Builds the appointments for one assignment. Index-driven so the mix is deterministic: the
 * first appointment is always "held" (completed, in the past, attendance captured), the second
 * (when present) is always "planned" (upcoming, no attendance yet), and a third appointment
 * (roughly a third of assignments) is another held one further back, so the attendance-rate and
 * planned-vs-held numbers aren't a suspiciously clean 50/50 split.
 */
function buildAppointmentPlans(index, rand) {
  const plans = [
    { held: true, daysOffset: -(2 + Math.floor(rand() * 35)) },
    { held: false, daysOffset: 1 + Math.floor(rand() * 14) },
  ]
  if (index % 3 === 0) plans.push({ held: true, daysOffset: -(40 + Math.floor(rand() * 30)) })
  return plans
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
    console.log(`Source seed tag: ${manifest.sourceSeedTag}`)

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

  const assignmentsSnapshot = await db.collection('assignedInterventions').where('seedTag', '==', args.seedTag).get()
  if (assignmentsSnapshot.empty) throw new Error(`No assignedInterventions found with seedTag=${args.seedTag}. Check the tag, or that the seed run was applied.`)

  const assignments = assignmentsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
  const participantIds = [...new Set(assignments.map((assignment) => assignment.participantId).filter(Boolean))]
  const participantEmails = new Map()
  await Promise.all(participantIds.map(async (participantId) => {
    const participantDoc = await db.collection('participants').doc(participantId).get()
    if (participantDoc.exists) participantEmails.set(participantId, participantDoc.data().email || null)
  }))

  console.log('\nSource assignments')
  console.log(`  seedTag      : ${args.seedTag}`)
  console.log(`  assignments  : ${assignments.length}`)

  const seedTag = `appointments-${args.seedTag}`
  const rand = makeRand(7)

  const plan = assignments.map((assignment, index) => ({
    assignment,
    appointments: buildAppointmentPlans(index, rand),
  }))
  const totalCount = plan.reduce((sum, entry) => sum + entry.appointments.length, 0)

  console.log(`\nWill create ${totalCount} appointment(s) across ${assignments.length} assignment(s) (seedTag=${seedTag}):`)
  plan.forEach(({ assignment, appointments }) => {
    const summary = appointments.map((entry) => (entry.held ? 'held' : 'planned')).join(', ')
    console.log(`  ${String(assignment.businessName || assignment.id).padEnd(28)} ${appointments.length} appointment(s) [${summary}]`)
  })

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const created = []
  const now = admin.firestore.FieldValue.serverTimestamp()

  for (const { assignment, appointments } of plan) {
    const participantEmail = participantEmails.get(assignment.participantId) || null

    for (const entry of appointments) {
      const startDate = daysFromNow(entry.daysOffset, 9 + Math.floor(rand() * 6))
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000)
      const status = entry.held ? 'completed' : pick(['pending', 'accepted'], rand)
      const attendanceKey = participantEmail || assignment.participantId || 'participant'
      const attendance = entry.held ? { [attendanceKey]: rand() < 0.8 ? 'present' : 'absent' } : {}

      const appointmentRef = db.collection('appointments').doc()
      const doc = {
        companyCode: assignment.companyCode || null,
        assignedInterventionId: assignment.id,
        interventionId: assignment.interventionId || null,
        interventionTitle: assignment.interventionTitle || 'Intervention',
        participantId: assignment.participantId || null,
        participantName: assignment.businessName || null,
        participantEmail,
        programId: assignment.programId || null,
        programName: assignment.programName || null,
        assigneeId: assignment.assigneeUid || assignment.assigneeId || null,
        assigneeEmail: assignment.assigneeEmail || null,
        meetingType: pick(MEETING_TYPES, rand),
        meetingLink: null,
        location: null,
        startTime: admin.firestore.Timestamp.fromDate(startDate),
        endTime: admin.firestore.Timestamp.fromDate(endDate),
        status,
        requiresSmeAcceptance: true,
        acceptanceBundle: 'intervention_and_appointment',
        attendance,
        discussionSummary: entry.held ? pick(DISCUSSION_SUMMARIES, rand) : '',
        seedTag,
        createdByUid: assignment.assigneeUid || assignment.assigneeId || null,
        createdByEmail: assignment.assigneeEmail || null,
        createdAt: now,
        updatedAt: now,
        ...(entry.held ? { completedAt: now } : {}),
      }
      await appointmentRef.set(doc)
      created.push({ collection: 'appointments', id: appointmentRef.id })
      console.log(`  created appointments/${appointmentRef.id} for ${assignment.businessName} [${status}]`)
    }
  }

  const manifestPath = path.resolve(__dirname, `seed-output-appointments-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), sourceSeedTag: args.seedTag, seedTag, created }, null, 2))

  console.log(`\nDone. Created ${created.length} appointment(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-appointments.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
