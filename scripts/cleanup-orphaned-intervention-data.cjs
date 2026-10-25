#!/usr/bin/env node
/*
 * Removes plan/assignment records whose participant no longer exists, and rewrites readable intervention ids
 * ("strategic-plan") that never matched a library document to the real library document id.
 *
 * Dry run by default. --apply writes a backup of every touched document first; --restore <backup> puts them back.
 *
 *   node scripts/cleanup-orphaned-intervention-data.cjs --service-account ./scripts/new-service-account.json
 *   node scripts/cleanup-orphaned-intervention-data.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/cleanup-orphaned-intervention-data.cjs --service-account ./scripts/new-service-account.json --restore <backup.json> --apply
 */
const fs = require('fs')
const path = require('path')
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const serviceAccountPath = value('service-account')
const apply = flag('apply')
const restoreFile = value('restore')
if (!serviceAccountPath) { console.error('Usage: node scripts/cleanup-orphaned-intervention-data.cjs --service-account <file> [--apply] [--restore <backup>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(path.resolve(serviceAccountPath)) })
const db = admin.firestore()
const slug = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

;(async () => {
  if (restoreFile) {
    const backup = JSON.parse(fs.readFileSync(path.resolve(restoreFile), 'utf8'))
    console.log(`Restore: ${backup.length} documents`)
    if (!apply) { console.log('Dry run. Re-run with --apply.'); return }
    for (const entry of backup) await db.collection(entry.collection).doc(entry.id).set(entry.data)
    console.log('Restored.')
    return
  }

  const [plans, assignments, participants, library] = await Promise.all(
    ['diagnosticPlans', 'assignedInterventions', 'participants', 'interventions'].map((name) => db.collection(name).get()),
  )
  const participantIds = new Set(participants.docs.map((d) => d.id))
  const libraryIds = new Set(library.docs.map((d) => d.id))
  const libraryByTitle = new Map(library.docs.map((d) => [`${String(d.data().companyCode).toUpperCase()}|${slug(d.data().interventionTitle)}`, d.id]))

  const deletes = []
  plans.docs.filter((d) => !participantIds.has(String(d.data().participantId))).forEach((d) => deletes.push({ collection: 'diagnosticPlans', doc: d }))
  assignments.docs.filter((d) => !participantIds.has(String(d.data().participantId))).forEach((d) => deletes.push({ collection: 'assignedInterventions', doc: d }))
  const deleted = new Set(deletes.map((x) => `${x.collection}/${x.doc.id}`))

  // Ids that point at no library document are rewritten to the library document with the same title in that company.
  const rewrites = []
  const resolve = (company, id, title) => {
    if (!id || libraryIds.has(id) || libraryIds.has(`${String(company).toUpperCase()}__${id}`)) return null
    return libraryByTitle.get(`${String(company).toUpperCase()}|${slug(title)}`) || null
  }
  plans.docs.forEach((d) => {
    if (deleted.has(`diagnosticPlans/${d.id}`)) return
    const data = d.data()
    let changed = false
    const items = (data.interventions || []).map((item) => {
      const next = resolve(data.companyCode, item.interventionId, item.title)
      if (!next) return item
      changed = true
      return { ...item, interventionId: next }
    })
    if (changed) rewrites.push({ collection: 'diagnosticPlans', doc: d, patch: { interventions: items } })
  })
  assignments.docs.forEach((d) => {
    if (deleted.has(`assignedInterventions/${d.id}`)) return
    const data = d.data()
    const next = resolve(data.companyCode, data.interventionId, data.interventionTitle)
    if (next) rewrites.push({ collection: 'assignedInterventions', doc: d, patch: { interventionId: next } })
  })

  console.log(`Delete (participant no longer exists): ${deletes.length}`)
  deletes.forEach((x) => console.log(`  ${x.collection}/${x.doc.id}  ${x.doc.data().interventionTitle || ''}`))
  console.log(`Rewrite ids to real library documents: ${rewrites.length}`)
  rewrites.forEach((x) => console.log(`  ${x.collection}/${x.doc.id}  ${x.doc.data().interventionTitle || ''}`))
  if (!apply) { console.log('\nDry run. Re-run with --apply.'); return }

  const backupPath = path.join(__dirname, `seed-output-cleanup-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(backupPath, JSON.stringify([...deletes, ...rewrites].map((x) => ({ collection: x.collection, id: x.doc.id, data: x.doc.data() })), null, 2))
  console.log(`Backup: ${backupPath}`)
  const batch = db.batch()
  deletes.forEach((x) => batch.delete(x.doc.ref))
  rewrites.forEach((x) => batch.update(x.doc.ref, x.patch))
  await batch.commit()
  console.log('Done.')
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
