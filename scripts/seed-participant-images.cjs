#!/usr/bin/env node
/*
 * Gives most seeded SMEs a profile picture so the avatars and the control tower hero show how they look with an
 * image. The pictures are placeholder stock photos served by Lorem Picsum (https://picsum.photos), picked per SME
 * with a fixed seed so each one always gets the same image. About one SME in six is left without a picture on
 * purpose, so the initials fallback stays visible. Real SMEs upload their own; this is demo data only.
 *
 * Only SMEs with no picture are touched. Dry run by default; --apply writes and saves a manifest;
 * --undo <manifest> --apply removes exactly what was written.
 *
 *   node scripts/seed-participant-images.cjs --service-account ./scripts/new-service-account.json
 *   node scripts/seed-participant-images.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-participant-images.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-images-<ts>.json --apply
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
if (!serviceAccountPath) { console.error('Usage: node scripts/seed-participant-images.cjs --service-account <file> [--apply] [--undo <manifest>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(path.resolve(serviceAccountPath)) })
const db = admin.firestore()
const { FieldValue } = admin.firestore
const SEED_TAG = `images-${Date.now()}`

const hash = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }

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
    console.log(`Undo: ${manifest.written.length} participants lose the picture this seed added`)
    if (!apply) { console.log('Dry run. Re-run with --apply.'); return }
    await commit(manifest.written.map((entry) => (batch) => batch.update(db.collection('participants').doc(entry.id), { profileImageUrl: FieldValue.delete(), imageSeedTag: FieldValue.delete() })))
    console.log('Undone.')
    return
  }

  const snap = await db.collection('participants').get()
  const writes = []
  let skippedOnPurpose = 0
  snap.docs.forEach((doc) => {
    const data = doc.data()
    if (data.profileImageUrl) return
    if (hash(`${doc.id}:image`) % 6 === 0) { skippedOnPurpose += 1; return }
    writes.push({ id: doc.id, url: `https://picsum.photos/seed/sme-${doc.id}/900/600` })
  })
  console.log(`${writes.length} of ${snap.size} participants get a picture; ${skippedOnPurpose} are left without one on purpose`)
  if (writes[0]) console.log('Sample:', writes[0].url)
  if (!apply) { console.log('\nDry run. Re-run with --apply to write these.'); return }

  await commit(writes.map((w) => (batch) => batch.update(db.collection('participants').doc(w.id), { profileImageUrl: w.url, imageSeedTag: SEED_TAG })))
  const manifestPath = path.join(__dirname, `seed-output-images-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ seedTag: SEED_TAG, written: writes.map((w) => ({ id: w.id })) }, null, 2))
  console.log(`\nDone. Manifest: ${manifestPath}`)
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
