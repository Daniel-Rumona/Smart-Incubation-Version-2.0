#!/usr/bin/env node

/*
 * Confirming the diagnostic plan now accepts every intervention on it (no per-intervention SME accept),
 * and an intervention starts at the first sign of work (src/utils/interventionStart.ts). This brings
 * existing records in line:
 *
 *   1. Plan already signed by the SME -> its still-pending assignments become participantStatus
 *      'accepted', participantAcceptedVia 'plan_backfill'.
 *   2. An appointment the SME already accepted (or attended) -> its assignment gets workStartedAt /
 *      workStartedVia, and is accepted too if it was still pending. The start time is the appointment's
 *      beneficiaryConfirmedAt (or its start time for attended ones), not "now".
 *
 * Declined, cancelled and other companies' records are left alone. Updates documents in place, creates
 * nothing, sends no notifications and does not touch `updatedAt`. Every changed document is tagged with
 * `planAcceptanceBackfillTag`, and the manifest keeps the previous values so a run can be undone.
 *
 * Usage:
 *   # dry run (default): prints what would change
 *   node scripts/backfill-plan-acceptance.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/backfill-plan-acceptance.cjs --service-account ./scripts/new-service-account.json --apply
 *
 *   # undo a previous run
 *   node scripts/backfill-plan-acceptance.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-plan-acceptance-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const BATCH_SIZE = 400
const FIELDS = ['participantStatus', 'participantAcceptedVia', 'participantAcceptedAt', 'workStartedAt', 'workStartedVia', 'status', 'planAcceptanceBackfillTag']

function parseArgs(argv) {
  const args = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
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

const norm = (value) => String(value ?? '').trim().toLowerCase()
const isPending = (data) => ['', 'pending'].includes(norm(data.participantStatus))
const isClosed = (data) => ['declined', 'cancelled', 'completed'].includes(norm(data.status)) || norm(data.assigneeStatus) === 'declined'
const smeSigned = (plan) => {
  const confirmedBy = plan.confirmedBy || {}
  return Boolean(confirmedBy.participant || confirmedBy.incubatee || confirmedBy.sme)
}
const attendedPresent = (appointment) => Object.values(appointment.attendance || {}).some((value) => norm(value) === 'present')

function snapshot(data) {
  return Object.fromEntries(FIELDS.map((field) => [field, { existed: field in data, value: field in data ? data[field] : null }]))
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
  const operations = (manifest.assignments || []).map((entry) => ({
    ref: db.collection('assignedInterventions').doc(entry.id),
    data: Object.fromEntries(Object.entries(entry.before).map(([field, prior]) => [field, prior.existed ? prior.value : admin.firestore.FieldValue.delete()])),
  }))
  console.log(`${args.apply ? 'Restoring' : 'Would restore'} ${operations.length} assignment(s) from ${manifestPath}`)
  await commitInBatches(db, operations, args.apply)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const credentials = loadServiceAccount(args)
  admin.initializeApp({ credential: admin.credential.cert(credentials) })
  const db = admin.firestore()
  if (args.undo) return undo(db, args)

  const tag = new Date().toISOString()
  const [plansSnapshot, assignmentsSnapshot, appointmentsSnapshot] = await Promise.all([
    db.collection('diagnosticPlans').get(),
    db.collection('assignedInterventions').get(),
    db.collection('appointments').get(),
  ])

  const signedPlans = new Set(plansSnapshot.docs.filter((row) => smeSigned(row.data())).map((row) => row.id))
  const assignments = new Map(assignmentsSnapshot.docs.map((row) => [row.id, row]))

  // Earliest SME engagement per assignment: an accepted RSVP, or attendance marked present.
  const firstEngagement = new Map()
  for (const row of appointmentsSnapshot.docs) {
    const data = row.data()
    const assignment = assignments.get(String(data.assignedInterventionId || ''))
    if (!assignment || assignment.data().companyCode !== data.companyCode) continue
    if (assignment.data().participantId && data.participantId && assignment.data().participantId !== data.participantId) continue
    const accepted = norm(data.status) === 'accepted' || norm(data.beneficiaryConfirmation) === 'confirmed'
    const attended = attendedPresent(data)
    if (!accepted && !attended) continue
    const at = (accepted && data.beneficiaryConfirmedAt) || data.startTime || null
    const via = accepted ? 'appointment_accepted' : 'appointment_attended'
    const current = firstEngagement.get(assignment.id)
    const millis = at && typeof at.toMillis === 'function' ? at.toMillis() : Number.MAX_SAFE_INTEGER
    if (!current || millis < current.millis) firstEngagement.set(assignment.id, { at, via, millis })
  }

  const operations = []
  const manifest = { tag, assignments: [] }
  const counts = { acceptedViaPlan: 0, acceptedViaAppointment: 0, started: 0, skippedClosed: 0 }

  for (const row of assignmentsSnapshot.docs) {
    const data = row.data()
    if (isClosed(data)) { counts.skippedClosed += 1; continue }
    const update = {}
    if (isPending(data) && signedPlans.has(String(data.applicationId || ''))) {
      Object.assign(update, { participantStatus: 'accepted', participantAcceptedVia: 'plan_backfill', participantAcceptedAt: admin.firestore.FieldValue.serverTimestamp() })
      counts.acceptedViaPlan += 1
    }
    const engagement = firstEngagement.get(row.id)
    if (engagement && !data.workStartedAt) {
      Object.assign(update, { workStartedAt: engagement.at || admin.firestore.FieldValue.serverTimestamp(), workStartedVia: `${engagement.via}_backfill` })
      if (isPending(data) && !update.participantStatus) {
        Object.assign(update, { participantStatus: 'accepted', participantAcceptedVia: 'appointment_backfill', participantAcceptedAt: engagement.at || admin.firestore.FieldValue.serverTimestamp() })
        counts.acceptedViaAppointment += 1
      }
      counts.started += 1
    }
    if (!Object.keys(update).length) continue
    update.planAcceptanceBackfillTag = tag
    operations.push({ ref: row.ref, data: update })
    manifest.assignments.push({ id: row.id, companyCode: data.companyCode || null, title: data.interventionTitle || null, before: snapshot(data), change: Object.keys(update) })
  }

  console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', signedPlans: signedPlans.size, assignmentsChanged: operations.length, ...counts }, null, 2))
  const outputPath = path.resolve(__dirname, `seed-output-plan-acceptance-${tag.replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2))
  console.log(`Manifest: ${outputPath}`)
  await commitInBatches(db, operations, args.apply)
  if (!args.apply) console.log('Dry run only. Re-run with --apply to write.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
