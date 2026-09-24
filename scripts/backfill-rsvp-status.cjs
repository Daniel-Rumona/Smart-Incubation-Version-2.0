#!/usr/bin/env node

/*
 * Before the RSVP fix, an SME accepting or declining an appointment on WhatsApp only wrote the
 * audit fields (`beneficiaryConfirmation` / `userConfirmation`, `confirmationSource: 'whatsapp'`).
 * The appointment's `status`, which the calendar, monitoring and scheduling all read, stayed
 * 'pending'. This copies those old answers onto `status`:
 *
 *   confirmed -> status 'accepted'
 *   declined  -> status 'declined', declineReasonCode 'other' (the old free-text reason is kept in
 *                declineReason), declineNeedsReview false, declinedVia 'whatsapp'
 *
 * Only touches appointments that are still 'pending' (or have no status), were answered over
 * WhatsApp, and have a clear answer. Cancelled/completed appointments and ones that already have an
 * accepted/declined status are left alone; conflicting answers are reported and skipped.
 *
 * Updates existing documents in place - creates nothing, sends no notifications, and does not touch
 * `updatedAt`. Every changed document is tagged with `rsvpBackfillTag`. The manifest records the
 * previous values so the run can be undone.
 *
 * Optional: --accept-bundled-assignments also accepts the still-pending assignment when an accepted
 * appointment was booked together with its intervention (acceptanceBundle 'intervention_*'), which is
 * what the new RSVP code does. Off by default; those are counted and reported either way.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/backfill-rsvp-status.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/backfill-rsvp-status.cjs --service-account ./scripts/new-service-account.json --apply
 *
 *   # undo a previous run
 *   node scripts/backfill-rsvp-status.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-rsvp-backfill-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const BATCH_SIZE = 400
const APPOINTMENT_FIELDS = ['status', 'declineReasonCode', 'declineNeedsReview', 'declinedVia', 'rsvpBackfillTag']
const ASSIGNMENT_FIELDS = ['participantStatus', 'participantAcceptedAt', 'status', 'rsvpBackfillTag']

function parseArgs(argv) {
  const args = { apply: false, acceptBundled: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--undo=')) args.undo = arg.slice('--undo='.length)
    else if (arg === '--undo') args.undo = argv[++index]
    else if (arg === '--apply') args.apply = true
    else if (arg === '--accept-bundled-assignments') args.acceptBundled = true
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

const norm = (value) => String(value ?? '').trim().toLowerCase()

/** 'accepted' | 'declined' | null (no clear answer) | 'conflict' */
function answerOf(data) {
  const answers = new Set([norm(data.beneficiaryConfirmation), norm(data.userConfirmation)].filter(Boolean))
  if (!answers.size) return null
  if (answers.size > 1) return 'conflict'
  const [only] = answers
  if (only === 'confirmed') return 'accepted'
  if (only === 'declined') return 'declined'
  return null
}

/** Values of `fields` as they are now, so an undo can put them back (undefined => field did not exist). */
function snapshot(data, fields) {
  return Object.fromEntries(fields.map((field) => [field, { existed: field in data, value: field in data ? data[field] : null }]))
}

async function commitInBatches(db, operations, apply) {
  if (!apply) return
  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    const batch = db.batch()
    operations.slice(index, index + BATCH_SIZE).forEach((operation) => batch.update(operation.ref, operation.data))
    await batch.commit()
  }
}

async function undo(db, args) {
  const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const operations = []
  for (const [collection, entries] of [['appointments', manifest.appointments], ['assignedInterventions', manifest.assignments]]) {
    for (const entry of entries || []) {
      const ref = db.collection(collection).doc(entry.id)
      const data = {}
      for (const [field, prior] of Object.entries(entry.before)) {
        data[field] = prior.existed ? prior.value : admin.firestore.FieldValue.delete()
      }
      operations.push({ ref, data })
    }
  }
  console.log(`${args.apply ? 'Restoring' : 'Would restore'} ${operations.length} documents from ${path.basename(manifestPath)}`)
  await commitInBatches(db, operations, args.apply)
  if (!args.apply) console.log('Dry run only. Re-run with --apply to write.')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()
  console.log(`Project: ${serviceAccount.project_id}   Mode: ${args.apply ? 'APPLY (writing)' : 'dry run'}`)

  if (args.undo) return undo(db, args)

  const tag = `rsvp-status-backfill-${new Date().toISOString()}`
  const snapshotAll = await db.collection('appointments').get()
  console.log(`Scanned ${snapshotAll.size} appointments`)

  const stats = { accepted: 0, declined: 0, alreadyCorrect: 0, closed: 0, noWhatsAppAnswer: 0, conflicts: [], bundledPending: 0, bundledAccepted: 0 }
  const appointmentOps = []
  const assignmentOps = new Map()
  const manifest = { tag, projectId: serviceAccount.project_id, createdAt: new Date().toISOString(), appointments: [], assignments: [] }

  const assignmentIds = new Set()
  const candidates = []
  for (const doc of snapshotAll.docs) {
    const data = doc.data()
    const status = norm(data.status)
    if (status === 'cancelled' || status === 'completed') { stats.closed += 1; continue }
    if (status === 'accepted' || status === 'declined') { stats.alreadyCorrect += 1; continue }
    if (norm(data.confirmationSource) !== 'whatsapp') { stats.noWhatsAppAnswer += 1; continue }
    const answer = answerOf(data)
    if (!answer) { stats.noWhatsAppAnswer += 1; continue }
    if (answer === 'conflict') { stats.conflicts.push(doc.id); continue }
    candidates.push({ doc, data, answer })
    if (answer === 'accepted' && data.assignedInterventionId && norm(data.acceptanceBundle).startsWith('intervention_')) {
      assignmentIds.add(String(data.assignedInterventionId))
    }
  }

  const assignments = new Map()
  await Promise.all([...assignmentIds].map(async (id) => {
    const snap = await db.collection('assignedInterventions').doc(id).get()
    if (snap.exists) assignments.set(id, { ref: snap.ref, data: snap.data() })
  }))

  for (const { doc, data, answer } of candidates) {
    const update = { status: answer, rsvpBackfillTag: tag }
    if (answer === 'declined') {
      Object.assign(update, { declineReasonCode: 'other', declineNeedsReview: false, declinedVia: 'whatsapp' })
      stats.declined += 1
    } else {
      stats.accepted += 1
    }
    manifest.appointments.push({ id: doc.id, before: snapshot(data, APPOINTMENT_FIELDS) })
    appointmentOps.push({ ref: doc.ref, data: update })

    const assignment = assignments.get(String(data.assignedInterventionId || ''))
    if (answer === 'accepted' && assignment
      && String(assignment.data.participantId || '') === String(data.participantId || '')
      && norm(assignment.data.participantStatus) === 'pending'
      && !assignmentOps.has(assignment.ref.id)) {
      stats.bundledPending += 1
      if (args.acceptBundled) {
        stats.bundledAccepted += 1
        manifest.assignments.push({ id: assignment.ref.id, before: snapshot(assignment.data, ASSIGNMENT_FIELDS) })
        assignmentOps.set(assignment.ref.id, {
          ref: assignment.ref,
          data: {
            participantStatus: 'accepted',
            participantAcceptedAt: admin.firestore.FieldValue.serverTimestamp(),
            status: 'in-progress',
            rsvpBackfillTag: tag,
          },
        })
      }
    }
  }

  console.log('')
  console.log(`  set to accepted:                       ${stats.accepted}`)
  console.log(`  set to declined:                       ${stats.declined}`)
  console.log(`  skipped, status already accepted/declined: ${stats.alreadyCorrect}`)
  console.log(`  skipped, cancelled or completed:       ${stats.closed}`)
  console.log(`  skipped, no WhatsApp answer:           ${stats.noWhatsAppAnswer}`)
  console.log(`  skipped, conflicting answers:          ${stats.conflicts.length}${stats.conflicts.length ? `  (${stats.conflicts.join(', ')})` : ''}`)
  console.log(`  bundled assignments still pending:     ${stats.bundledPending}${args.acceptBundled ? ` (accepting ${stats.bundledAccepted})` : '  (left as is; pass --accept-bundled-assignments to accept)'}`)
  console.log('')

  if (!appointmentOps.length) {
    console.log('Nothing to change.')
    return
  }

  if (!args.apply) {
    console.log('Appointments that would change:')
    appointmentOps.slice(0, 25).forEach((operation) => console.log(`  ${operation.ref.id} -> ${operation.data.status}`))
    if (appointmentOps.length > 25) console.log(`  ... and ${appointmentOps.length - 25} more`)
    console.log('\nDry run only. Re-run with --apply to write.')
    return
  }

  const manifestPath = path.resolve(__dirname, `seed-output-rsvp-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`Undo manifest written: ${path.relative(process.cwd(), manifestPath)}`)

  await commitInBatches(db, [...appointmentOps, ...assignmentOps.values()], true)
  console.log(`Updated ${appointmentOps.length} appointments${assignmentOps.size ? ` and ${assignmentOps.size} assignments` : ''}.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
