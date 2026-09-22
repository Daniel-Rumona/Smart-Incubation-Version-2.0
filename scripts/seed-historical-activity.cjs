#!/usr/bin/env node

/*
 * Adds more historical activity - extra assignedInterventions plus appointments - for the
 * dummy SMEs created by seed-assigned-interventions.cjs, dated across Jan 2025 through Jun
 * 2026. The earlier seed scripts only cover the last couple of months, which is enough for
 * "This month"/"This quarter", but leaves the Operations Reports trend charts (Application
 * Flow, Intervention Status Over Time, Appointments Over Time) with almost nothing to show
 * over a longer custom range. This backfills that history for the SAME participants (no new
 * SMEs), reusing their companyCode/programId.
 *
 * For each participant tagged with --seed-tag, creates 2-4 additional assignedInterventions
 * (a fresh random intervention type each time, mostly "completed", some "overdue"/"in
 * progress" for variety) dated across the historical window, plus one appointment per new
 * assignment around the same date (mostly "completed" with attendance captured, a few
 * "cancelled").
 *
 * Every created document is tagged with its own seedTag (history-<original seed tag>) and a
 * manifest is written to scripts/seed-output-historical-<timestamp>.json so the batch can be
 * undone.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-historical-activity.cjs --service-account ./scripts/new-service-account.json --email user@example.com --seed-tag demo-assigned-1789583332890
 *
 *   # write it
 *   node scripts/seed-historical-activity.cjs --service-account ./scripts/new-service-account.json --email user@example.com --seed-tag demo-assigned-1789583332890 --apply
 *
 *   # undo a previous run
 *   node scripts/seed-historical-activity.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-historical-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const AREAS_OF_SUPPORT = ['Financial Management', 'Marketing & Sales', 'Digital Transformation', 'Operations & Compliance', 'Governance & Leadership', 'Access to Markets']
const INTERVENTION_TITLES = {
  'Financial Management': ['Financial Management Coaching', 'Cash Flow & Budgeting Workshop', 'Bookkeeping Systems Setup'],
  'Marketing & Sales': ['Marketing Strategy Development', 'Brand & Digital Presence Audit', 'Sales Pipeline Coaching'],
  'Digital Transformation': ['Digital Tools Onboarding', 'Website & E-commerce Setup', 'Systems Automation Review'],
  'Operations & Compliance': ['Compliance Readiness Review', 'Operations Efficiency Assessment', 'Standard Operating Procedures Workshop'],
  'Governance & Leadership': ['Governance & Leadership Coaching', 'Business Plan Refresh', 'Succession Planning Session'],
  'Access to Markets': ['Market Access Facilitation', 'Tender Readiness Coaching', 'Export Readiness Assessment'],
}
const MEETING_TYPES = ['telephonic', 'online', 'in_person']
const DISCUSSION_SUMMARIES = [
  'Reviewed progress against targets and agreed next steps.',
  'Walked through outstanding action items and blockers.',
  'Covered implementation status and upcoming milestones.',
  'Discussed challenges since the last session and adjusted the plan.',
  'Confirmed deliverables and set the agenda for the next session.',
]

const HISTORICAL_START = new Date(2025, 0, 1)
const HISTORICAL_END = new Date(2026, 5, 30)

function parseArgs(argv) {
  const args = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length)
    else if (arg === '--email') args.email = argv[++index]
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

function randomDateInRange(startDate, endDate, rand) {
  const date = new Date(startDate.getTime() + rand() * (endDate.getTime() - startDate.getTime()))
  date.setHours(9 + Math.floor(rand() * 6), 0, 0, 0)
  return date
}

function addDays(date, days) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/** Mirrors deriveStatus in AllocatedInterventionsPage.tsx so seeded rows land in the bucket they claim. */
function buildAssignmentStatusFields(bucket, rand) {
  if (bucket === 'completed') {
    return { status: 'completed', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'done', participantCompletionStatus: 'confirmed', progress: 100 }
  }
  if (bucket === 'inProgress') {
    return { status: 'in_progress', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 40 + Math.round(rand() * 40) }
  }
  return { status: 'pending', assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 10 }
}

/** completed most of the time; overdue/inProgress scattered in for variety in the status trend chart. */
function pickBucket(rand) {
  const roll = rand()
  if (roll < 0.7) return 'completed'
  if (roll < 0.85) return 'overdue'
  return 'inProgress'
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

  if (!args.email) throw new Error('Pass --email <address> (the assignee for these historical assignments).')
  if (!args.seedTag) throw new Error('Pass --seed-tag <tag> (the seedTag written by seed-assigned-interventions.cjs, e.g. demo-assigned-1789583332890).')

  const userRecord = await auth.getUserByEmail(args.email).catch(() => null)
  if (!userRecord) throw new Error(`No Firebase Auth user found for ${args.email}.`)

  const userDoc = await db.collection('users').doc(userRecord.uid).get()
  if (!userDoc.exists) throw new Error(`Auth user ${args.email} (${userRecord.uid}) has no matching users/${userRecord.uid} Firestore document.`)

  const userData = userDoc.data()
  const role = String(userData.role || '')
  const assigneeType = ['operations', 'projectadmin', 'projectmanager'].includes(role) ? 'operations' : 'consultant'
  const assigneeName = String(userData.displayName || userData.name || args.email)

  const participantsSnapshot = await db.collection('participants').where('seedTag', '==', args.seedTag).get()
  if (participantsSnapshot.empty) throw new Error(`No participants found with seedTag=${args.seedTag}. Check the tag, or that the original seed run was applied.`)
  const participants = participantsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))

  console.log('\nSource participants')
  console.log(`  seedTag      : ${args.seedTag}`)
  console.log(`  participants : ${participants.length}`)
  console.log(`  window       : ${HISTORICAL_START.toDateString()} - ${HISTORICAL_END.toDateString()}`)

  const seedTag = `history-${args.seedTag}`
  const rand = makeRand(19)

  const plan = participants.map((participant, index) => {
    const count = 2 + (index % 3)
    const items = Array.from({ length: count }, () => {
      const areaOfSupport = pick(AREAS_OF_SUPPORT, rand)
      const interventionTitle = pick(INTERVENTION_TITLES[areaOfSupport], rand)
      const bucket = pickBucket(rand)
      const assignedDate = randomDateInRange(HISTORICAL_START, HISTORICAL_END, rand)
      return { areaOfSupport, interventionTitle, bucket, assignedDate }
    })
    return { participant, items }
  })
  const totalAssignments = plan.reduce((sum, entry) => sum + entry.items.length, 0)

  console.log(`\nWill create ${totalAssignments} assignedIntervention(s) + ${totalAssignments} appointment(s) across ${participants.length} participant(s) (seedTag=${seedTag}):`)
  plan.forEach(({ participant, items }) => {
    console.log(`  ${String(participant.businessName || participant.id).padEnd(28)} ${items.length} historical assignment(s)`)
  })

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const created = []
  const now = admin.firestore.FieldValue.serverTimestamp()

  for (const { participant, items } of plan) {
    for (const item of items) {
      const statusFields = buildAssignmentStatusFields(item.bucket, rand)
      const dueDate = item.bucket === 'inProgress' ? null : addDays(item.assignedDate, 5 + Math.floor(rand() * 20))

      const assignmentRef = db.collection('assignedInterventions').doc()
      await assignmentRef.set({
        companyCode: participant.companyCode || null,
        groupId: null,
        participantId: participant.id,
        businessName: participant.businessName,
        interventionDefinitionId: null,
        interventionId: null,
        interventionTitle: item.interventionTitle,
        subtitle: item.areaOfSupport,
        type: 'coaching',
        programId: participant.programId || null,
        programName: null,
        implementationDate: admin.firestore.Timestamp.fromDate(item.assignedDate),
        assignedAt: admin.firestore.Timestamp.fromDate(item.assignedDate),
        dueDate: dueDate ? admin.firestore.Timestamp.fromDate(dueDate) : null,
        isRecurring: false,
        assigneeType,
        assigneeUid: userRecord.uid,
        assigneeId: userRecord.uid,
        assigneeName,
        assigneeEmail: args.email,
        ...statusFields,
        areaOfSupport: item.areaOfSupport,
        targetType: 'number',
        targetValue: 10,
        targetMetric: 'hours',
        targetActual: item.bucket === 'completed' ? 10 : item.bucket === 'inProgress' ? Math.round(statusFields.progress / 10) : 0,
        timeSpent: 0,
        notes: '',
        seedTag,
        createdAt: admin.firestore.Timestamp.fromDate(item.assignedDate),
        createdBy: userRecord.uid,
        updatedAt: now,
        updatedBy: userRecord.uid,
        ...(item.bucket === 'completed' ? { completedAt: admin.firestore.Timestamp.fromDate(dueDate || item.assignedDate) } : {}),
      })
      created.push({ collection: 'assignedInterventions', id: assignmentRef.id })

      const held = rand() < 0.85
      const appointmentStart = addDays(item.assignedDate, Math.floor(rand() * 5))
      const appointmentEnd = new Date(appointmentStart.getTime() + 60 * 60 * 1000)
      const status = held ? 'completed' : 'cancelled'
      const attendanceKey = participant.email || participant.id
      const attendance = held ? { [attendanceKey]: rand() < 0.8 ? 'present' : 'absent' } : {}

      const appointmentRef = db.collection('appointments').doc()
      await appointmentRef.set({
        companyCode: participant.companyCode || null,
        assignedInterventionId: assignmentRef.id,
        interventionId: null,
        interventionTitle: item.interventionTitle,
        participantId: participant.id,
        participantName: participant.businessName,
        participantEmail: participant.email || null,
        programId: participant.programId || null,
        programName: null,
        assigneeId: userRecord.uid,
        assigneeEmail: args.email,
        meetingType: pick(MEETING_TYPES, rand),
        meetingLink: null,
        location: null,
        startTime: admin.firestore.Timestamp.fromDate(appointmentStart),
        endTime: admin.firestore.Timestamp.fromDate(appointmentEnd),
        status,
        requiresSmeAcceptance: true,
        acceptanceBundle: 'intervention_and_appointment',
        attendance,
        discussionSummary: held ? pick(DISCUSSION_SUMMARIES, rand) : '',
        seedTag,
        createdByUid: userRecord.uid,
        createdByEmail: args.email,
        createdAt: admin.firestore.Timestamp.fromDate(appointmentStart),
        updatedAt: now,
        ...(held ? { completedAt: admin.firestore.Timestamp.fromDate(appointmentStart) } : {}),
      })
      created.push({ collection: 'appointments', id: appointmentRef.id })

      console.log(`  created assignedInterventions/${assignmentRef.id} + appointments/${appointmentRef.id} for ${participant.businessName} (${item.assignedDate.toDateString()}) [${item.bucket}/${status}]`)
    }
  }

  const manifestPath = path.resolve(__dirname, `seed-output-historical-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), sourceSeedTag: args.seedTag, seedTag, created }, null, 2))

  console.log(`\nDone. Created ${created.length} document(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-historical-activity.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
