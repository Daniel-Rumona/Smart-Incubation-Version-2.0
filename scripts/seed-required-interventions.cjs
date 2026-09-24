#!/usr/bin/env node

/*
 * seed-applications.cjs created the dummy SMEs' `applications` with requiredInterventions: [], so
 * every "required interventions" figure (Director dashboard, Operations reports) reads 0 even
 * though each SME has assigned interventions. In real data an application's required list is what
 * the SME was accepted to receive, and assignments are drawn from it.
 *
 * For each application tagged applications-<--seed-tag>, this finds the SME's assignedInterventions
 * (matched by participantId, seeded originally and by seed-historical-activity.cjs) and writes one
 * entry per assignment into `interventions.required` ({ id, interventionId, title, areaOfSupport }),
 * plus `interventions.completed` for the ones already completed. Updates existing application
 * documents in place - creates nothing new.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-required-interventions.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890
 *
 *   # write it
 *   node scripts/seed-required-interventions.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890 --apply
 *
 *   # undo a previous run (removes the `interventions` field this script wrote)
 *   node scripts/seed-required-interventions.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-required-interventions-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

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

const isCompleted = (assignment) =>
  String(assignment.status || '').toLowerCase() === 'completed'
  || String(assignment.completionStatus || '').toLowerCase() === 'completed'
  || String(assignment.assigneeCompletionStatus || '').toLowerCase() === 'done'
  || Number(assignment.progress) >= 100

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.updated.length} application document(s) from ${manifest.createdAt}`)

    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to remove these fields.')
      return
    }

    for (const entry of manifest.updated) {
      await db.collection('applications').doc(entry.applicationId).update({
        interventions: admin.firestore.FieldValue.delete(),
      })
    }
    console.log(`\nRemoved interventions from ${manifest.updated.length} application document(s).`)
    return
  }

  if (!args.seedTag) throw new Error('Pass --seed-tag <tag> (the seedTag written by seed-assigned-interventions.cjs, e.g. demo-assigned-1789583332890).')

  const applicationsSeedTag = `applications-${args.seedTag}`
  const applicationsSnapshot = await db.collection('applications').where('seedTag', '==', applicationsSeedTag).get()
  if (applicationsSnapshot.empty) throw new Error(`No applications found with seedTag=${applicationsSeedTag}. Run seed-applications.cjs first.`)

  console.log('\nSource applications')
  console.log(`  seedTag      : ${applicationsSeedTag}`)
  console.log(`  applications : ${applicationsSnapshot.size}`)

  const plan = []
  for (const applicationDoc of applicationsSnapshot.docs) {
    const application = applicationDoc.data()
    if (!application.participantId) continue
    const assignmentsSnapshot = await db.collection('assignedInterventions').where('participantId', '==', application.participantId).get()
    const assignments = assignmentsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    if (!assignments.length) continue

    const required = assignments.map((assignment) => ({
      id: assignment.id,
      interventionId: assignment.interventionId || null,
      title: assignment.interventionTitle || assignment.title || 'Intervention',
      areaOfSupport: assignment.areaOfSupport || assignment.subtitle || '',
    }))
    const completed = assignments.filter(isCompleted).map((assignment) => ({
      id: assignment.id,
      interventionId: assignment.interventionId || null,
      title: assignment.interventionTitle || assignment.title || 'Intervention',
    }))
    plan.push({ applicationId: applicationDoc.id, businessName: application.businessName, required, completed })
  }

  console.log(`\nWill set interventions.required / interventions.completed on ${plan.length} application(s):`)
  plan.forEach(({ businessName, required, completed }) => {
    console.log(`  ${String(businessName).padEnd(28)} required ${required.length}, completed ${completed.length}`)
  })

  if (!plan.length) {
    console.log('\nNothing to do.')
    return
  }

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these fields.')
    return
  }

  const updated = []
  const now = admin.firestore.FieldValue.serverTimestamp()
  for (const entry of plan) {
    await db.collection('applications').doc(entry.applicationId).update({
      interventions: { required: entry.required, completed: entry.completed },
      updatedAt: now,
    })
    updated.push({ applicationId: entry.applicationId })
    console.log(`  updated applications/${entry.applicationId} for ${entry.businessName}`)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-required-interventions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), sourceSeedTag: args.seedTag, updated }, null, 2))

  console.log(`\nDone. Updated ${updated.length} application document(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-required-interventions.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
