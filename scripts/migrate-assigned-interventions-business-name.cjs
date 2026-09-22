#!/usr/bin/env node

/*
 * Backfills `businessName` on assignedInterventions documents that only have the legacy
 * `beneficiaryName` field. See scripts/FIELD_MIGRATIONS.md for why: the app's read paths now
 * read only `businessName` (no fallback chain), so any document that predates that change and
 * only has `beneficiaryName` would otherwise show as "Unassigned SME".
 *
 * Does not delete `beneficiaryName` - this is additive only, so it's safe to re-run and safe to
 * leave in place even after this script has run everywhere it needs to.
 *
 * Reuses firebase-admin from functions/node_modules (same pattern as the other scripts/*.cjs).
 *
 * Usage:
 *   # dry run (default): show which documents would change
 *   node scripts/migrate-assigned-interventions-business-name.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/migrate-assigned-interventions-business-name.cjs --service-account ./scripts/new-service-account.json --apply
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

  const snapshot = await db.collection('assignedInterventions').get()
  const toBackfill = snapshot.docs.filter((doc) => {
    const data = doc.data()
    const hasBusinessName = typeof data.businessName === 'string' && data.businessName.trim()
    const hasBeneficiaryName = typeof data.beneficiaryName === 'string' && data.beneficiaryName.trim()
    return !hasBusinessName && hasBeneficiaryName
  })

  console.log(`\n${snapshot.size} assignedInterventions document(s) total.`)
  console.log(`${toBackfill.length} document(s) have beneficiaryName but no businessName:\n`)
  for (const doc of toBackfill) {
    console.log(`  ${doc.id}  beneficiaryName="${doc.data().beneficiaryName}"`)
  }

  if (toBackfill.length === 0) {
    console.log('\nNothing to do.')
    return
  }

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to set businessName = beneficiaryName on these documents.')
    return
  }

  let batch = db.batch()
  let opsInBatch = 0
  for (const doc of toBackfill) {
    batch.update(doc.ref, { businessName: doc.data().beneficiaryName })
    opsInBatch += 1
    if (opsInBatch === 400) {
      await batch.commit()
      batch = db.batch()
      opsInBatch = 0
    }
  }
  if (opsInBatch > 0) await batch.commit()

  console.log(`\nDone. Backfilled businessName on ${toBackfill.length} document(s).`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
