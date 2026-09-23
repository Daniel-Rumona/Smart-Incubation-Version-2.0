#!/usr/bin/env node

/*
 * Fixes a gap left by the seed scripts: seed-assigned-interventions.cjs created the dummy
 * `participants` with applicationId: null (there was no application yet), and
 * seed-applications.cjs later created a matching `applications` doc for each one but never linked
 * it back. Every page that shows an SME's gender/demographics falls back from the participant doc
 * to its linked application doc via `participant.applicationId` (ParticipantsPage, SmeMetricsPage's
 * businessProfile/application merge, etc.) - with that link null, the fallback never resolves, so
 * gender (and every other application-only field) reads as blank everywhere.
 *
 * This links them: for each `applications` doc created by seed-applications.cjs (matched by
 * --seed-tag, the ORIGINAL seed-assigned-interventions.cjs tag), sets that participant's
 * `applicationId` to the application's id, and also copies `gender` directly onto the participant
 * (belt-and-suspenders for the few places that read participant.gender with no fallback at all).
 * Updates existing `participants` documents in place - creates nothing new.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/link-participant-applications.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890
 *
 *   # write it
 *   node scripts/link-participant-applications.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890 --apply
 *
 *   # undo a previous run (restores each participant's applicationId/gender to what they were before)
 *   node scripts/link-participant-applications.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-participant-links-<timestamp>.json --apply
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.updated.length} participant document(s) from ${manifest.createdAt}`)

    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to restore these fields.')
      return
    }

    let batch = db.batch()
    let opsInBatch = 0
    for (const entry of manifest.updated) {
      batch.update(db.collection('participants').doc(entry.participantId), {
        applicationId: entry.previous.applicationId,
        gender: entry.previous.gender === undefined ? admin.firestore.FieldValue.delete() : entry.previous.gender,
      })
      opsInBatch += 1
      if (opsInBatch === 400) {
        await batch.commit()
        batch = db.batch()
        opsInBatch = 0
      }
    }
    if (opsInBatch > 0) await batch.commit()
    console.log(`\nRestored ${manifest.updated.length} participant document(s).`)
    return
  }

  if (!args.seedTag) throw new Error('Pass --seed-tag <tag> (the seedTag written by seed-assigned-interventions.cjs, e.g. demo-assigned-1789583332890).')

  const applicationsSeedTag = `applications-${args.seedTag}`
  const applicationsSnapshot = await db.collection('applications').where('seedTag', '==', applicationsSeedTag).get()
  if (applicationsSnapshot.empty) throw new Error(`No applications found with seedTag=${applicationsSeedTag}. Run seed-applications.cjs first.`)
  const applications = applicationsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))

  console.log('\nSource applications')
  console.log(`  seedTag      : ${applicationsSeedTag}`)
  console.log(`  applications : ${applications.length}`)

  const plan = []
  for (const application of applications) {
    if (!application.participantId) continue
    const participantDoc = await db.collection('participants').doc(application.participantId).get()
    if (!participantDoc.exists) continue
    const participant = participantDoc.data()
    plan.push({
      participantId: application.participantId,
      businessName: participant.businessName || application.businessName,
      previous: { applicationId: participant.applicationId ?? null, gender: participant.gender },
      next: { applicationId: application.id, gender: application.gender },
    })
  }

  console.log(`\nWill link ${plan.length} participant(s) to their application and set gender:`)
  plan.forEach(({ businessName, previous, next }) => {
    console.log(`  ${String(businessName).padEnd(28)} applicationId ${previous.applicationId || 'null'} -> ${next.applicationId}, gender ${previous.gender || '(none)'} -> ${next.gender}`)
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
    await db.collection('participants').doc(entry.participantId).update({
      applicationId: entry.next.applicationId,
      gender: entry.next.gender,
      updatedAt: now,
    })
    updated.push({ participantId: entry.participantId, previous: entry.previous })
    console.log(`  updated participants/${entry.participantId} for ${entry.businessName}`)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-participant-links-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), sourceSeedTag: args.seedTag, updated }, null, 2))

  console.log(`\nDone. Updated ${updated.length} participant document(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/link-participant-applications.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
