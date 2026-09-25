#!/usr/bin/env node

/*
 * Seeds `complianceDocuments` for the dummy SMEs (every participant that carries a seedTag, across
 * QTX and RCM) so the Operations Compliance page, ProjectAdmin/Director compliance scores and
 * risk-register compliance items have real data.
 *
 * Each SME gets a "compliance discipline" (0.3 - 0.97) and, for each of the six standard document
 * types (CIPC registration, Tax clearance, B-BBEE certificate, Bank confirmation, Proof of address,
 * ID document), a document whose status is drawn from that discipline: mostly valid + verified,
 * with some pending, queried (with a reason), expired, or simply not uploaded (no document), so
 * scores range from poor to excellent. The `verificationStatus` mirrors the outcome because the
 * dashboards read it first. Participants that already have compliance documents are skipped.
 *
 * Every created document carries a seedTag; a manifest is written to
 * scripts/seed-output-compliance-<timestamp>.json for --undo.
 *
 * Usage:
 *   node scripts/seed-compliance.cjs --service-account ./scripts/new-service-account.json            # dry run
 *   node scripts/seed-compliance.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-compliance.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-compliance-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const DOCUMENT_TYPES = [
  { type: 'CIPC registration', expires: false },
  { type: 'Tax clearance', expires: true },
  { type: 'B-BBEE certificate', expires: true },
  { type: 'Bank confirmation', expires: true },
  { type: 'Proof of address', expires: false },
  { type: 'ID document', expires: false },
]
const QUERY_REASONS = [
  'The document is not legible - please upload a clearer copy.',
  'The business name on the document does not match the application.',
  'The document is older than three months - please provide a recent one.',
  'Pages appear to be missing - please upload the complete document.',
]

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

const pick = (list, rand) => list[Math.floor(rand() * list.length)]
function makeRand(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}
const addDays = (date, days) => new Date(date.getTime() + days * 86400000)
const isoDate = (date) => date.toISOString().slice(0, 10)
const slug = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

async function main() {
  const args = parseArgs(process.argv.slice(2))
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount(args)) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.created.length} document(s) from ${manifest.createdAt}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to delete them.')
      return
    }
    let batch = db.batch()
    let ops = 0
    for (const id of manifest.created) {
      batch.delete(db.collection('complianceDocuments').doc(id))
      ops += 1
      if (ops === 400) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
    console.log(`\nDeleted ${manifest.created.length} document(s).`)
    return
  }

  const [participantsSnap, existingSnap] = await Promise.all([
    db.collection('participants').get(),
    db.collection('complianceDocuments').get(),
  ])
  const alreadyHas = new Set(existingSnap.docs.map((row) => row.data().participantId))
  const participants = participantsSnap.docs.filter((row) => row.data().seedTag && !alreadyHas.has(row.id))

  const rand = makeRand(311)
  const now = new Date()
  const plan = []
  const stats = { valid: 0, pending: 0, queried: 0, expired: 0, missing: 0 }

  participants.forEach((row) => {
    const data = row.data()
    const discipline = 0.3 + rand() * 0.67
    const docs = []
    DOCUMENT_TYPES.forEach(({ type, expires }) => {
      const roll = rand()
      let outcome
      if (roll < discipline * 0.85) outcome = 'valid'
      else if (roll < discipline * 0.85 + (1 - discipline) * 0.3) outcome = 'missing'
      else if (roll < discipline * 0.85 + (1 - discipline) * 0.55) outcome = 'pending'
      else if (roll < discipline * 0.85 + (1 - discipline) * 0.8) outcome = 'queried'
      else outcome = expires ? 'expired' : 'pending'
      stats[outcome] += 1
      if (outcome === 'missing') return

      let issue = addDays(now, -(20 + Math.floor(rand() * 240)))
      let expiry = expires ? addDays(issue, 365) : null
      if (outcome === 'expired') {
        issue = addDays(now, -(380 + Math.floor(rand() * 200)))
        expiry = addDays(issue, 365)
      }
      const key = slug(type)
      docs.push({
        type,
        key,
        outcome,
        issueDate: isoDate(issue),
        expiryDate: expiry ? isoDate(expiry) : null,
        fileName: `${key}-${slug(data.businessName)}.pdf`,
        comment: outcome === 'queried' ? pick(QUERY_REASONS, rand) : '',
        uploadedAt: addDays(issue, 1 + Math.floor(rand() * 5)),
      })
    })
    plan.push({ participantId: row.id, data, docs })
  })

  console.log(`\nWill create compliance documents for ${plan.length} participant(s) (${participants.length} seeded without any):`)
  const total = plan.reduce((sum, entry) => sum + entry.docs.length, 0)
  console.log(`  ${total} documents - ${JSON.stringify(stats)} (missing = not uploaded, no document written)`)
  plan.slice(0, 8).forEach(({ data, docs }) => console.log(`  ${String(data.businessName).padEnd(28)} [${data.companyCode}] ${docs.length}/6 uploaded, ${docs.filter((doc) => doc.outcome === 'valid').length} valid`))
  if (plan.length > 8) console.log(`  ... and ${plan.length - 8} more`)

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const seedTag = `compliance-${Date.now()}`
  const ts = (date) => admin.firestore.Timestamp.fromDate(date)
  const created = []
  let batch = db.batch()
  let ops = 0

  for (const { participantId, data, docs } of plan) {
    for (const doc of docs) {
      const ref = db.collection('complianceDocuments').doc()
      const verified = doc.outcome === 'valid'
      const verificationStatus = verified ? 'verified' : doc.outcome === 'queried' ? 'queried' : doc.outcome === 'expired' ? 'expired' : 'pending'
      batch.set(ref, {
        participantId,
        applicationId: data.applicationId || null,
        programId: data.programId || null,
        companyCode: data.companyCode || null,
        departmentId: null,
        key: doc.key,
        type: doc.type,
        documentName: `${doc.type} - ${data.businessName}`,
        currentStatus: doc.outcome === 'valid' ? 'valid' : doc.outcome === 'expired' ? 'expired' : 'pending',
        verificationStatus,
        verificationComment: doc.comment,
        issueDate: doc.issueDate,
        expiryDate: doc.expiryDate,
        notes: '',
        fileName: doc.fileName,
        url: null,
        storagePath: null,
        seedTag,
        createdAt: ts(doc.uploadedAt),
        createdBy: null,
        updatedAt: ts(doc.uploadedAt),
        updatedBy: null,
        ...(verified ? { verifiedAt: ts(addDays(doc.uploadedAt, 1 + Math.floor(rand() * 4))), verifiedBy: null } : {}),
      })
      created.push(ref.id)
      ops += 1
      if (ops === 400) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
  }
  if (ops > 0) await batch.commit()

  const manifestPath = path.resolve(__dirname, `seed-output-compliance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), seedTag, created }, null, 2))
  console.log(`\nDone. Created ${created.length} document(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-compliance.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
