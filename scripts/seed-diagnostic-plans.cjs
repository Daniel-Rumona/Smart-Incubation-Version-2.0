#!/usr/bin/env node

/*
 * The Operations > Interventions > Assign page only lists SMEs whose application is accepted AND
 * has an Operations-confirmed diagnostic plan with readable required interventions. The seeded SMEs
 * have accepted applications with required interventions but no diagnostic plan, so only the two
 * SMEs with real plans appeared.
 *
 * For every seeded application (has a seedTag) that has interventions.required and no
 * diagnosticPlans/{applicationId} yet, this creates a confirmed plan (same shape the app writes)
 * listing those required interventions. Creates new documents only - nothing existing is changed.
 * Each plan takes the application's own companyCode, so run it after setup-company-rcm.cjs.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-diagnostic-plans.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/seed-diagnostic-plans.cjs --service-account ./scripts/new-service-account.json --apply
 *
 *   # undo
 *   node scripts/seed-diagnostic-plans.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-diagnostic-plans-<timestamp>.json --apply
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

const slug = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.created.length} plan(s) from ${manifest.createdAt}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to delete these plans.')
      return
    }
    for (const id of manifest.created) await db.collection('diagnosticPlans').doc(id).delete()
    console.log(`\nDeleted ${manifest.created.length} plan(s).`)
    return
  }

  const applications = await db.collection('applications').get()
  const plan = []
  for (const docSnap of applications.docs) {
    const data = docSnap.data()
    if (!data.seedTag) continue
    const required = data.interventions && Array.isArray(data.interventions.required) ? data.interventions.required : []
    if (!required.length) continue
    const existing = await db.collection('diagnosticPlans').doc(docSnap.id).get()
    if (existing.exists) continue
    plan.push({ applicationId: docSnap.id, data, required })
  }

  console.log(`\nWill create ${plan.length} confirmed diagnostic plan(s):`)
  const byCompany = {}
  plan.forEach(({ data }) => { byCompany[data.companyCode || 'none'] = (byCompany[data.companyCode || 'none'] || 0) + 1 })
  console.log('  by company:', JSON.stringify(byCompany))
  plan.slice(0, 8).forEach(({ data, required }) => console.log(`  ${String(data.businessName).padEnd(28)} ${required.length} interventions  [${data.companyCode}]`))
  if (plan.length > 8) console.log(`  ... and ${plan.length - 8} more`)

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const created = []
  for (const { applicationId, data, required } of plan) {
    await db.collection('diagnosticPlans').doc(applicationId).set({
      companyCode: data.companyCode || null,
      participantId: data.participantId,
      applicationId,
      programId: data.programId || null,
      interventions: required.map((item) => ({
        interventionId: slug(item.title),
        title: item.title,
        areaOfSupport: item.areaOfSupport || '',
        executionMode: 'single_session',
        steps: [],
      })),
      confirmed: true,
      status: 'Confirmed',
      confirmedAt: new Date().toISOString(),
      confirmedBy: { operations: { name: 'Seeded plan', confirmedAt: new Date().toISOString() } },
      confirmedMeta: { operations: { name: 'Seeded plan', confirmedAt: new Date().toISOString() } },
      seedTag: `diagnostic-plans-${Date.now()}`,
      updatedAt: now,
    })
    created.push(applicationId)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-diagnostic-plans-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), created }, null, 2))
  console.log(`\nDone. Created ${created.length} plan(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-diagnostic-plans.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
