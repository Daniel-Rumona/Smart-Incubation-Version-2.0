#!/usr/bin/env node

/*
 * The seeded completed `assignedInterventions` were written with status: 'completed' but no
 * completion timestamp, so anything that measures delivery over time (Director Reports'
 * "assigned vs completed" chart, on-time delivery and turnaround time) has nothing to read.
 *
 * For every seeded (has a seedTag) completed assignment with no completedAt, this sets
 * `completedAt` to createdAt + 4-40 days (never in the future); about three quarters land on or
 * before the due date, the rest slightly after, so on-time delivery is realistic rather than 100%.
 * Updates existing documents in place - creates nothing new.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-completion-dates.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/seed-completion-dates.cjs --service-account ./scripts/new-service-account.json --apply
 *
 *   # undo a previous run (removes the completedAt this script added)
 *   node scripts/seed-completion-dates.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-completion-dates-<timestamp>.json --apply
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

function makeRand(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

const toDate = (value) => (value && value.toDate ? value.toDate() : null)
const addDays = (date, days) => new Date(date.getTime() + days * 86400000)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.updated.length} assignment(s) from ${manifest.createdAt}`)

    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to remove these fields.')
      return
    }

    let batch = db.batch()
    let ops = 0
    for (const entry of manifest.updated) {
      batch.update(db.collection('assignedInterventions').doc(entry.id), { completedAt: admin.firestore.FieldValue.delete() })
      ops += 1
      if (ops === 400) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
    console.log(`\nRemoved completedAt from ${manifest.updated.length} assignment(s).`)
    return
  }

  const snapshot = await db.collection('assignedInterventions').where('status', '==', 'completed').get()
  const rand = makeRand(19)
  const now = new Date()

  const plan = []
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data()
    if (!data.seedTag || data.completedAt) return
    const created = toDate(data.createdAt) || addDays(now, -60)
    const due = toDate(data.dueDate)
    let finished = addDays(created, 4 + Math.floor(rand() * 37))
    if (due && rand() < 0.75 && finished > due) finished = addDays(due, -Math.floor(rand() * 5))
    if (finished < created) finished = addDays(created, 3)
    if (finished > now) finished = addDays(now, -1)
    plan.push({ id: docSnap.id, businessName: data.businessName, finished })
  })

  console.log(`\nWill set completedAt on ${plan.length} seeded completed assignment(s) (of ${snapshot.size} completed in total):`)
  plan.slice(0, 15).forEach(({ businessName, finished }) => console.log(`  ${String(businessName || '').padEnd(28)} completed ${finished.toDateString()}`))
  if (plan.length > 15) console.log(`  ... and ${plan.length - 15} more`)

  if (!plan.length) {
    console.log('\nNothing to do.')
    return
  }
  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these fields.')
    return
  }

  let batch = db.batch()
  let ops = 0
  for (const entry of plan) {
    batch.update(db.collection('assignedInterventions').doc(entry.id), { completedAt: admin.firestore.Timestamp.fromDate(entry.finished) })
    ops += 1
    if (ops === 400) {
      await batch.commit()
      batch = db.batch()
      ops = 0
    }
  }
  if (ops > 0) await batch.commit()

  const manifestPath = path.resolve(__dirname, `seed-output-completion-dates-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), updated: plan.map(({ id }) => ({ id })) }, null, 2))

  console.log(`\nDone. Updated ${plan.length} assignment(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-completion-dates.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
