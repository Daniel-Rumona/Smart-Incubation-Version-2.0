#!/usr/bin/env node
/*
 * Gives assignments that have no `interventionId` the id of the matching intervention in the same SME's plan.
 *
 * Diagnostic plans match assignments to their plan items by `interventionId`. Assignments created by the seed
 * scripts only recorded the title, so every plan showed those interventions as "Not assigned" no matter how much
 * work had been done. Only a missing id is ever filled in (never changed), and only from the participant's own plan
 * item with the same title; if the plan has no such item the title's slug is used, which is how plans name them.
 *
 * Dry run by default; writes a manifest so it can be undone.
 *
 *   node scripts/backfill-assignment-intervention-ids.cjs --service-account ./scripts/new-service-account.json
 *   node scripts/backfill-assignment-intervention-ids.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/backfill-assignment-intervention-ids.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-assignment-ids-<ts>.json --apply
 */
const fs = require('fs')
const path = require('path')
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const serviceAccountPath = value('service-account')
const apply = flag('apply')
const undoFile = value('undo')
if (!serviceAccountPath) { console.error('Usage: node scripts/backfill-assignment-intervention-ids.cjs --service-account <file> [--apply] [--undo <manifest>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(path.resolve(serviceAccountPath)) })
const db = admin.firestore()
const slug = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const commit = async (operations) => {
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch()
    operations.slice(i, i + 400).forEach((run) => run(batch))
    await batch.commit()
  }
}

;(async () => {
  if (undoFile) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(undoFile), 'utf8'))
    console.log(`Undo: ${manifest.updated.length} assignments get their interventionId cleared again`)
    if (!apply) { console.log('Dry run. Re-run with --apply.'); return }
    await commit(manifest.updated.map((entry) => (batch) => batch.update(db.collection('assignedInterventions').doc(entry.id), { interventionId: null })))
    console.log('Undone.')
    return
  }

  const [assignments, plans] = await Promise.all([db.collection('assignedInterventions').get(), db.collection('diagnosticPlans').get()])
  const planItemsByParticipant = new Map()
  plans.docs.forEach((plan) => {
    const data = plan.data()
    const list = planItemsByParticipant.get(String(data.participantId)) || []
    ;(Array.isArray(data.interventions) ? data.interventions : []).forEach((item) => list.push({ id: String(item.interventionId || ''), title: String(item.title || '') }))
    planItemsByParticipant.set(String(data.participantId), list)
  })

  const updates = []
  let fromPlan = 0
  let fromSlug = 0
  let untitled = 0
  assignments.docs.forEach((doc) => {
    const data = doc.data()
    if (data.interventionId) return
    const title = String(data.interventionTitle || '')
    if (!slug(title)) { untitled += 1; return }
    const planItem = (planItemsByParticipant.get(String(data.participantId)) || []).find((item) => item.id && slug(item.title) === slug(title))
    const id = planItem ? planItem.id : slug(title)
    if (planItem) fromPlan += 1; else fromSlug += 1
    updates.push({ id: doc.id, interventionId: id, title, seeded: Boolean(data.seedTag) })
  })

  console.log(`${assignments.size} assignments; ${updates.length} have no interventionId and can be filled (${fromPlan} from the SME's plan item, ${fromSlug} from the title), ${untitled} have no title and are left alone`)
  console.log(`  of those, ${updates.filter((u) => u.seeded).length} are seed data`)
  updates.slice(0, 5).forEach((u) => console.log(`  ${u.id}: "${u.title}" -> ${u.interventionId}`))
  if (!apply) { console.log('\nDry run. Re-run with --apply to write these.'); return }

  await commit(updates.map((u) => (batch) => batch.update(db.collection('assignedInterventions').doc(u.id), { interventionId: u.interventionId })))
  const manifestPath = path.join(__dirname, `seed-output-assignment-ids-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ updated: updates.map((u) => ({ id: u.id, interventionId: u.interventionId })) }, null, 2))
  console.log(`\nDone. Manifest: ${manifestPath}`)
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
