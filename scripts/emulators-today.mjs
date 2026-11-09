// Brings saved walkthrough data up to today, against RUNNING emulators: every training date of the awareness
// training company moves by the same number of days, so the class that was running on the day the data was saved
// runs today again (its first day is today), the finished class is still a month back and the next ones still ahead.
// Revenue dates move with it, so "this month" and the funder report's months stay filled.
//
//   node scripts/emulators-today.mjs          (npm run walkthrough does this for you)
//
// Only the demo-smartinc emulators are touched; nothing can reach a real Firebase project.
import { createRequire } from 'node:module'
import dayjs from 'dayjs'

const PROJECT_ID = 'demo-smartinc'
const COMPANY = 'TNS'
const ANCHOR_CLASS = 'tns-class-now'

Object.assign(process.env, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCLOUD_PROJECT: PROJECT_ID })
delete process.env.GOOGLE_APPLICATION_CREDENTIALS
const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

initializeApp({ projectId: PROJECT_ID })
const db = getFirestore()

const anchor = await db.doc(`trainingClasses/${ANCHOR_CLASS}`).get()
if (!anchor.exists) {
    console.log('No walkthrough class found; dates left as they are.')
    process.exit(0)
}
const shift = dayjs().startOf('day').diff(dayjs(anchor.data().startDate), 'day')
if (!shift) {
    console.log('The walkthrough dates are already current.')
    process.exit(0)
}

const move = (value) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayjs(value).add(shift, 'day').format('YYYY-MM-DD') : value)
/** The same label the app prints on classes and certificates: "2 – 4 Nov 2026", or one date for a one-day class. */
const datesLabel = (startDate, dayCount) => {
    const start = dayjs(startDate)
    const end = start.add(Math.max(1, dayCount) - 1, 'day')
    if (dayCount <= 1) return start.format('D MMM YYYY')
    if (start.isSame(end, 'month')) return `${start.format('D')} – ${end.format('D MMM YYYY')}`
    return `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`
}

const writes = []
const classes = new Map()
for (const row of (await db.collection('trainingClasses').where('companyCode', '==', COMPANY).get()).docs) {
    const startDate = move(row.data().startDate)
    classes.set(row.id, { startDate, dayCount: Number(row.data().dayCount) || 1 })
    writes.push([row.ref, { startDate }])
}
for (const row of (await db.collection('trainingCertificates').where('companyCode', '==', COMPANY).get()).docs) {
    const trainingClass = classes.get(row.data().classId)
    const changes = { issuedOn: move(row.data().issuedOn), ...(trainingClass ? { trainingDates: datesLabel(trainingClass.startDate, trainingClass.dayCount) } : {}) }
    writes.push([row.ref, changes])
    const verification = db.doc(`certificateVerifications/${row.id}`)
    if ((await verification.get()).exists) writes.push([verification, changes])
}
for (const row of (await db.collection('clientRevenue').where('companyCode', '==', COMPANY).get()).docs) {
    writes.push([row.ref, { date: move(row.data().date), ...(row.data().paidOn ? { paidOn: move(row.data().paidOn) } : {}) }])
}

for (let start = 0; start < writes.length; start += 400) {
    const batch = db.batch()
    writes.slice(start, start + 400).forEach(([ref, data]) => batch.update(ref, data))
    await batch.commit()
}
console.log(`Moved the walkthrough dates ${shift > 0 ? 'forward' : 'back'} ${Math.abs(shift)} day(s) to today (${writes.length} records).`)
process.exit(0)
