#!/usr/bin/env node

/*
 * Backfills revenue/employee trend data for the dummy SMEs created by
 * seed-assigned-interventions.cjs, so the Operations "SME Impact" card and the SME Metrics page
 * (revenue & headcount, current vs previous period, trend charts) have real numbers instead of
 * zeros - those pages read `revenue`/`employeeCount` (a flat current value) and
 * `revenueHistory.monthly` / `headcountHistory.monthly` (a { "YYYY-MM": number } map) directly off
 * each `participants` document.
 *
 * For each participant tagged with --seed-tag, generates one monthly value per month from Jan
 * 2025 through the current month for both revenue and headcount, trending the series up or down
 * (alternating per participant, so roughly half the SMEs are growing and half are declining, with
 * natural month-to-month noise rather than a straight line) and sets the flat `revenue` /
 * `employeeCount` fields to the latest month's value. This updates the existing participant
 * documents in place - it does not create any new documents.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-sme-metrics.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890
 *
 *   # write it
 *   node scripts/seed-sme-metrics.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-1789583332890 --apply
 *
 *   # undo a previous run (clears the fields this script set, restores nothing else)
 *   node scripts/seed-sme-metrics.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-sme-metrics-<timestamp>.json --apply
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

/** Deterministic-enough PRNG so a dry run and the matching --apply run generate the same preview. */
function makeRand(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

/** Every "YYYY-MM" from 2025-01 through the current month, inclusive. */
function monthKeys() {
  const keys = []
  const now = new Date()
  const cursor = new Date(2025, 0, 1)
  const end = new Date(now.getFullYear(), now.getMonth(), 1)
  while (cursor <= end) {
    keys.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`)
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys
}

/**
 * A noisy trending series: each step drifts up or down by a few percent (direction set by
 * `trend`) plus random month-to-month noise, so it reads as a real business trend rather than a
 * straight line, while still clearly ending up higher or lower than it started.
 */
function buildSeries(startValue, months, trend, rand, minValue) {
  const series = []
  let value = startValue
  for (let index = 0; index < months; index += 1) {
    const drift = trend === 'up' ? 0.015 + rand() * 0.035 : -(0.015 + rand() * 0.035)
    const noise = (rand() - 0.5) * 0.05
    value = Math.max(minValue, value * (1 + drift + noise))
    series.push(value)
  }
  return series
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
      console.log('\nDry run. Re-run with --apply to clear these fields.')
      return
    }

    let batch = db.batch()
    let opsInBatch = 0
    for (const entry of manifest.updated) {
      const clear = {}
      entry.fields.forEach((field) => { clear[field] = admin.firestore.FieldValue.delete() })
      batch.update(db.collection('participants').doc(entry.participantId), clear)
      opsInBatch += 1
      if (opsInBatch === 400) {
        await batch.commit()
        batch = db.batch()
        opsInBatch = 0
      }
    }
    if (opsInBatch > 0) await batch.commit()
    console.log(`\nCleared metrics fields on ${manifest.updated.length} participant document(s).`)
    return
  }

  if (!args.seedTag) throw new Error('Pass --seed-tag <tag> (the seedTag written by seed-assigned-interventions.cjs, e.g. demo-assigned-1789583332890).')

  const participantsSnapshot = await db.collection('participants').where('seedTag', '==', args.seedTag).get()
  if (participantsSnapshot.empty) throw new Error(`No participants found with seedTag=${args.seedTag}. Check the tag, or that the original seed run was applied.`)
  const participants = participantsSnapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))

  console.log('\nSource participants')
  console.log(`  seedTag      : ${args.seedTag}`)
  console.log(`  participants : ${participants.length}`)

  const months = monthKeys()
  const rand = makeRand(53)

  const plan = participants.map((participant, index) => {
    const trend = index % 2 === 0 ? 'up' : 'down'
    const startRevenue = 60000 + Math.round(rand() * 240000)
    const startEmployees = 2 + Math.floor(rand() * 10)
    const revenueSeries = buildSeries(startRevenue, months.length, trend, rand, 5000)
    const employeeSeries = buildSeries(startEmployees, months.length, trend, rand, 1)

    const revenueHistory = {}
    const headcountHistory = {}
    months.forEach((month, monthIndex) => {
      revenueHistory[month] = Math.round(revenueSeries[monthIndex] / 100) * 100
      headcountHistory[month] = Math.round(employeeSeries[monthIndex])
    })

    return {
      participant,
      trend,
      revenueHistory,
      headcountHistory,
      latestRevenue: revenueHistory[months[months.length - 1]],
      latestEmployees: headcountHistory[months[months.length - 1]],
      firstRevenue: revenueHistory[months[0]],
      firstEmployees: headcountHistory[months[0]],
    }
  })

  console.log(`\nWill update ${plan.length} participant document(s) with ${months.length} months of history each (${months[0]} to ${months[months.length - 1]}):`)
  plan.forEach(({ participant, trend, firstRevenue, latestRevenue, firstEmployees, latestEmployees }) => {
    console.log(`  ${String(participant.businessName || participant.id).padEnd(28)} [${trend.padEnd(4)}] revenue R${firstRevenue} -> R${latestRevenue}, employees ${firstEmployees} -> ${latestEmployees}`)
  })

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these fields.')
    return
  }

  const updated = []
  const now = admin.firestore.FieldValue.serverTimestamp()
  const fields = ['revenueHistory', 'headcountHistory', 'revenue', 'employeeCount', 'metricsSeedTag']

  for (const entry of plan) {
    await db.collection('participants').doc(entry.participant.id).update({
      revenueHistory: { monthly: entry.revenueHistory },
      headcountHistory: { monthly: entry.headcountHistory },
      revenue: entry.latestRevenue,
      employeeCount: entry.latestEmployees,
      metricsSeedTag: args.seedTag,
      updatedAt: now,
    })
    updated.push({ participantId: entry.participant.id, fields })
    console.log(`  updated participants/${entry.participant.id} for ${entry.participant.businessName}`)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-sme-metrics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), sourceSeedTag: args.seedTag, updated }, null, 2))

  console.log(`\nDone. Updated ${updated.length} participant document(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-sme-metrics.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
