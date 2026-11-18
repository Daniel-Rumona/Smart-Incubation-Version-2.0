// Takes the demo data back out of the live project, using the removal list that
// `node scripts/seed-emulators.mjs --live <key> --apply` saved (scripts/seed-output-live-demo-<time>.json).
//
//   node scripts/remove-live-demo.mjs scripts/new-service-account.json <removal list>            # dry run: lists only
//   node scripts/remove-live-demo.mjs scripts/new-service-account.json <removal list> --apply    # deletes
//
// It deletes only what the list names, and of those only records still tagged as live demo data
// (seededBy: 'live-demo'); the sign-ins it deletes are the ones the seed created. Prince's account is never in the list.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const [keyPath, listPath] = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
const APPLY = process.argv.includes('--apply')
if (!keyPath || !listPath) {
    console.error('Usage: node scripts/remove-live-demo.mjs <service-account.json> <removal list> [--apply]')
    process.exit(1)
}
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'))
const list = JSON.parse(readFileSync(listPath, 'utf8'))
if (serviceAccount.project_id !== list.project) {
    console.error(`The key is for ${serviceAccount.project_id}, the list for ${list.project}. Nothing was deleted.`)
    process.exit(1)
}

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { cert, initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
initializeApp({ credential: cert(serviceAccount), projectId: list.project, storageBucket: `${list.project}.firebasestorage.app` })
const db = getFirestore()

const demoDocs = []
for (let start = 0; start < list.docs.length; start += 100) {
    const snapshots = await db.getAll(...list.docs.slice(start, start + 100).map((path) => db.doc(path)))
    for (const snapshot of snapshots) if (snapshot.exists && snapshot.get('seededBy') === 'live-demo') demoDocs.push(snapshot.ref)
}
const uids = list.uids.filter((uid) => uid !== 'qtx-prince')
console.log(`${APPLY ? 'Deleting' : 'Would delete'} ${demoDocs.length} records, ${list.files.length} files and ${uids.length} demo sign-ins.`)
if (!APPLY) process.exit(0)

for (let start = 0; start < demoDocs.length; start += 400) {
    const batch = db.batch()
    for (const ref of demoDocs.slice(start, start + 400)) batch.delete(ref)
    await batch.commit()
}
const bucket = getStorage().bucket()
for (const path of list.files) await bucket.file(path).delete({ ignoreNotFound: true })
for (let start = 0; start < uids.length; start += 1000) await getAuth().deleteUsers(uids.slice(start, start + 1000))
console.log('Done.')
process.exit(0)
