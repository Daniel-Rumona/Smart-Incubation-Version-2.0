#!/usr/bin/env node

/*
 * The Operations dashboard's "SME Impact" card counts the employees/revenue of every SME onboarded on or
 * before a date and compares this month with last month. RCM's dummy SMEs were all onboarded months ago,
 * so both months had identical totals and every change read 0. This moves the onboarding date
 * (`onboardedAt` / `acceptedAt`) of a share of RCM's participants (default one third) to spread across
 * the current month, so this month's totals are higher than last month's and the weekly impact chart
 * steps upward. Updates existing participants in place; the previous dates are kept in the manifest and
 * restored by --undo.
 *
 * Usage:
 *   node scripts/seed-rcm-impact-dates.cjs --service-account ./scripts/new-service-account.json            # dry run
 *   node scripts/seed-rcm-impact-dates.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-rcm-impact-dates.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-rcm-impact-dates-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const COMPANY_CODE = 'RCM'

function parseArgs(argv) {
  const args = { apply: false, share: 1 / 3 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--share=')) args.share = Number(arg.slice('--share='.length))
    else if (arg === '--share') args.share = Number(argv[++index])
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

const iso = (ts) => (ts && ts.toDate ? ts.toDate().toISOString() : null)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount(args)) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.updated.length} participant(s) from ${manifest.createdAt}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to restore their dates.')
      return
    }
    for (const entry of manifest.updated) {
      await db.collection('participants').doc(entry.id).update({
        onboardedAt: entry.previous.onboardedAt ? admin.firestore.Timestamp.fromDate(new Date(entry.previous.onboardedAt)) : admin.firestore.FieldValue.delete(),
        acceptedAt: entry.previous.acceptedAt ? admin.firestore.Timestamp.fromDate(new Date(entry.previous.acceptedAt)) : admin.firestore.FieldValue.delete(),
      })
    }
    console.log(`\nRestored ${manifest.updated.length} participant(s).`)
    return
  }

  const snapshot = await db.collection('participants').where('companyCode', '==', COMPANY_CODE).get()
  const participants = snapshot.docs
    .map((row) => ({ id: row.id, ...row.data() }))
    .sort((left, right) => String(left.businessName).localeCompare(String(right.businessName)))
  if (!participants.length) throw new Error('No RCM participants found.')

  const count = Math.max(1, Math.round(participants.length * args.share))
  // Every (participants.length / count)-th SME, so the movers are spread across sectors and trends.
  const step = participants.length / count
  const chosen = Array.from({ length: count }, (_, index) => participants[Math.min(participants.length - 1, Math.floor(index * step))])

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 9))
  const daysSoFar = Math.max(1, now.getUTCDate() - 1)
  const plan = chosen.map((participant, index) => {
    const offset = count === 1 ? 0 : Math.round((index * Math.max(daysSoFar - 1, 0)) / (count - 1))
    const date = new Date(monthStart.getTime() + offset * 86400000)
    return { participant, date }
  })

  const asOf = (date) => plan.filter((entry) => entry.date <= date)
  console.log(`\nRCM has ${participants.length} SMEs; moving ${plan.length} to onboard this month (${monthStart.toISOString().slice(0, 7)}):`)
  plan.forEach(({ participant, date }) => console.log(`  ${String(participant.businessName).padEnd(26)} ${date.toISOString().slice(0, 10)}  (was ${(iso(participant.onboardedAt) || iso(participant.acceptedAt) || 'n/a').slice(0, 10)})  ${participant.employeeCount || 0} staff, R${participant.revenue || 0}`))
  const addedEmployees = plan.reduce((sum, { participant }) => sum + Number(participant.employeeCount || 0), 0)
  const addedRevenue = plan.reduce((sum, { participant }) => sum + Number(participant.revenue || 0), 0)
  console.log(`\nThis month's SME Impact will rise by ${addedEmployees} employees and R${addedRevenue} versus last month (${asOf(now).length} SMEs onboarded so far this month).`)

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these dates.')
    return
  }

  const updated = []
  for (const { participant, date } of plan) {
    updated.push({ id: participant.id, previous: { onboardedAt: iso(participant.onboardedAt), acceptedAt: iso(participant.acceptedAt) } })
    await db.collection('participants').doc(participant.id).update({
      onboardedAt: admin.firestore.Timestamp.fromDate(date),
      acceptedAt: admin.firestore.Timestamp.fromDate(date),
    })
  }

  const manifestPath = path.resolve(__dirname, `seed-output-rcm-impact-dates-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), updated }, null, 2))
  console.log(`\nDone. Updated ${updated.length} participant(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-rcm-impact-dates.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
