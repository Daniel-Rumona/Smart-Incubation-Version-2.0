#!/usr/bin/env node

/*
 * Consultants can't read `participants` (Firestore rules limit that to the SME and operations staff),
 * so a consultant's "My SMEs" page can't know an SME's sector. New assignments now carry the
 * SME's `sector` (InterventionsAssignmentsPage); this stamps it onto existing
 * `assignedInterventions` that lack one, taking it from the participant (falling back to their
 * application). Updates in place - creates nothing. Dry run by default; undo removes the field.
 *
 * Usage:
 *   node scripts/backfill-assignment-sector.cjs --service-account ./scripts/new-service-account.json            # dry run
 *   node scripts/backfill-assignment-sector.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/backfill-assignment-sector.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-assignment-sector-<timestamp>.json --apply
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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount(args)) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.updated.length} assignment(s) from ${manifest.createdAt}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to remove the field.')
      return
    }
    let batch = db.batch()
    let ops = 0
    for (const id of manifest.updated) {
      batch.update(db.collection('assignedInterventions').doc(id), { sector: admin.firestore.FieldValue.delete() })
      ops += 1
      if (ops === 400) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
    console.log(`\nRemoved sector from ${manifest.updated.length} assignment(s).`)
    return
  }

  const [assignments, participants, applications] = await Promise.all([
    db.collection('assignedInterventions').get(),
    db.collection('participants').get(),
    db.collection('applications').get(),
  ])
  const participantSector = new Map(participants.docs.map((row) => [row.id, String(row.data().sector || '').trim()]))
  const applicationSector = new Map(applications.docs.map((row) => [row.data().participantId, String(row.data().sector || '').trim()]).filter(([id]) => id))

  const plan = []
  let unresolved = 0
  assignments.docs.forEach((row) => {
    const data = row.data()
    if (data.sector) return
    const sector = participantSector.get(data.participantId) || applicationSector.get(data.participantId) || ''
    if (!sector) {
      unresolved += 1
      return
    }
    plan.push({ id: row.id, sector })
  })

  console.log(`\nWill set sector on ${plan.length} assignment(s) (${unresolved} have no resolvable sector and are left alone).`)
  const bySector = {}
  plan.forEach(({ sector }) => { bySector[sector] = (bySector[sector] || 0) + 1 })
  console.log('  ', JSON.stringify(bySector))

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these fields.')
    return
  }

  let batch = db.batch()
  let ops = 0
  for (const entry of plan) {
    batch.update(db.collection('assignedInterventions').doc(entry.id), { sector: entry.sector })
    ops += 1
    if (ops === 400) {
      await batch.commit()
      batch = db.batch()
      ops = 0
    }
  }
  if (ops > 0) await batch.commit()

  const manifestPath = path.resolve(__dirname, `seed-output-assignment-sector-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), updated: plan.map(({ id }) => id) }, null, 2))
  console.log(`\nDone. Updated ${plan.length} assignment(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/backfill-assignment-sector.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
