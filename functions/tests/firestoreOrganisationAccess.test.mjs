// Requires a local Firestore emulator loaded with firestore.rules. Never connects to a live project.
// FIRESTORE_EMULATOR_HOST=127.0.0.1:8189 node --test functions/tests/firestoreOrganisationAccess.test.mjs
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { initializeApp as initializeAdmin, deleteApp as deleteAdmin } from 'firebase-admin/app'
import { getFirestore as adminFirestore } from 'firebase-admin/firestore'
import { initializeApp, deleteApp } from 'firebase/app'
import { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, getDocs, collection, terminate, setLogLevel } from 'firebase/firestore'

const emulator = process.env.FIRESTORE_EMULATOR_HOST
if (!emulator || !/^127\.0\.0\.1:\d+$/.test(emulator)) throw new Error('Set FIRESTORE_EMULATOR_HOST to a local emulator before running these tests.')
const projectId = 'demo-organisation-access'
const admin = initializeAdmin({ projectId }, 'organisation-rules-test')
const db = adminFirestore(admin)
const clients = []
const client = uid => {
  const app = initializeApp({ projectId, apiKey: 'test-api-key' }, `test-${uid}`)
  const store = getFirestore(app)
  connectFirestoreEmulator(store, '127.0.0.1', Number(emulator.split(':')[1]), { mockUserToken: { sub: uid, email: `${uid}@example.test`, email_verified: true } })
  clients.push({ app, store })
  return store
}
setLogLevel('silent')
const owner = client('owner')
const reviewer = client('reviewer')
const outsider = client('outsider')
const denied = promise => assert.rejects(promise, error => error.code === 'permission-denied')

before(async () => {
  await Promise.all([
    db.doc('users/owner').set({ role: 'incubatee', firstLoginComplete: false, email: 'owner@example.test' }),
    db.doc('users/reviewer').set({ role: 'systemadmin', email: 'reviewer@example.test' }),
    db.doc('users/outsider').set({ role: 'director', email: 'outsider@example.test' }),
    db.doc('organisationAccessRequests/owner').set({ uid: 'owner', status: 'pending', organisationName: 'Example' }),
  ])
})
after(async () => {
  await Promise.all(clients.map(async ({ app, store }) => { await terminate(store); await deleteApp(app) }))
  await deleteAdmin(admin)
})

test('ordinary SME and consultant signup still works', async () => {
  for (const role of ['incubatee', 'consultant']) {
    const store = client(`signup-${role}`)
    await setDoc(doc(store, 'users', `signup-${role}`), { role, name: 'New user', firstLoginComplete: false })
  }
})

test('signup cannot grant approval, a company, permissions, or a notification exemption', async () => {
  for (const [field, value] of Object.entries({ organisationAccessStatus: 'approved', companyCode: 'EXAMPLE', permissions: ['manage_users'], registrationProgramLink: { programId: 'p' }, managedAccount: true, staffJoinedAt: 'fake' })) {
    const uid = `forge-${field}`
    await denied(setDoc(doc(client(uid), 'users', uid), { role: 'incubatee', [field]: value }))
  }
})

test('existing accounts cannot self-promote or change protected registration fields', async () => {
  for (const change of [{ role: 'director' }, { organisationAccessStatus: 'approved' }, { registrationProgramLink: { programId: 'p' } }, { managedAccount: true }, { staffJoinedAt: 'fake' }]) {
    await denied(updateDoc(doc(owner, 'users', 'owner'), change))
  }
  await updateDoc(doc(owner, 'users', 'owner'), { name: 'Updated name' })
})

test('an applicant can read only their own request, and System Admin can list requests', async () => {
  assert.equal((await getDoc(doc(owner, 'organisationAccessRequests', 'owner'))).data().status, 'pending')
  await denied(getDoc(doc(outsider, 'organisationAccessRequests', 'owner')))
  assert.ok((await getDocs(collection(reviewer, 'organisationAccessRequests'))).size >= 1)
})

test('request decisions and notification markers can only be written by the backend', async () => {
  await denied(updateDoc(doc(owner, 'organisationAccessRequests', 'owner'), { status: 'approved' }))
  await denied(updateDoc(doc(reviewer, 'organisationAccessRequests', 'owner'), { status: 'approved' }))
  await denied(setDoc(doc(owner, 'registrationNotifications', 'owner'), { notified: true }))
  await denied(setDoc(doc(reviewer, 'organisationMilestones', 'EXAMPLE'), { status: 'recorded' }))
})

test('pending operators cannot complete onboarding or switch into a consultant role', async () => {
  await db.doc('users/owner').update({ organisationAccessStatus: 'pending' })
  await denied(updateDoc(doc(owner, 'users', 'owner'), { firstLoginComplete: true }))
  await denied(updateDoc(doc(owner, 'users', 'owner'), { role: 'consultant' }))
  await denied(updateDoc(doc(owner, 'users', 'owner'), { organisationAccessStatus: 'approved', firstLoginComplete: true }))
  await updateDoc(doc(owner, 'users', 'owner'), { name: 'Still editable' })
})
