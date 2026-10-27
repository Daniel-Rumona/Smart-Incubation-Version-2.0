/*
 * Removes the data left by the end-to-end test of the Training / no-application flow (26 Oct 2026).
 *
 *   node scripts/cleanup-e2e-training-test.cjs          lists what would be deleted (nothing changes)
 *   node scripts/cleanup-e2e-training-test.cjs --apply  deletes it
 *
 * Only touches the test programme, the two test SME accounts and records tied to them. Accounts outside
 * company RCM are refused. Masakhane Poultry was already moved back to Women in Agri separately.
 * Delete this script once it has been run.
 */
const path = require('path')
const { initializeApp, cert } = require('../functions/node_modules/firebase-admin/lib/app')
const { getAuth } = require('../functions/node_modules/firebase-admin/lib/auth')
const { getFirestore } = require('../functions/node_modules/firebase-admin/lib/firestore')

const APPLY = process.argv.includes('--apply')
const PROGRAM_ID = 'atm8vchHXtJgpEXB873c'
const PROGRAM_NAME = 'E2E test - Training (delete me)'
const TEST_EMAILS = ['daniel+e2e1@quantilytix.co.za', 'prince@quantilytix.co.za']

initializeApp({ credential: cert(require(path.join(__dirname, 'new-service-account.json'))) })
const db = getFirestore()
const auth = getAuth()

;(async () => {
  const refs = new Map()
  const add = (ref) => refs.set(ref.path, ref)

  const program = await db.collection('programs').doc(PROGRAM_ID).get()
  if (program.exists && program.get('name') !== PROGRAM_NAME) throw new Error(`Programme ${PROGRAM_ID} is not the test programme; stopping.`)
  if (program.exists) add(program.ref)

  // Everything recorded against the test programme.
  for (const name of ['applications', 'participants', 'diagnosticPlans', 'assignedInterventions', 'appointments', 'complianceDocuments']) {
    const snap = await db.collection(name).where('programId', '==', PROGRAM_ID).get()
    snap.docs.forEach((row) => add(row.ref))
  }

  const accounts = []
  for (const email of TEST_EMAILS) {
    const user = await auth.getUserByEmail(email).catch(() => null)
    if (!user) continue
    const profile = await db.collection('users').doc(user.uid).get()
    const companyCode = profile.get('companyCode') || null
    if (companyCode && companyCode !== 'RCM') throw new Error(`${email} belongs to company ${companyCode}; stopping.`)
    accounts.push({ email, uid: user.uid })
    for (const name of ['users', 'applicantProfiles', 'businessProfiles', 'participants']) {
      const row = await db.collection(name).doc(user.uid).get()
      if (row.exists) add(row.ref)
    }
    const apps = await db.collection('applications').where('participantId', '==', user.uid).get()
    for (const app of apps.docs) {
      add(app.ref)
      const plan = await db.collection('diagnosticPlans').doc(app.id).get()
      if (plan.exists) add(plan.ref)
    }
  }

  // Masakhane Poultry (a real demo SME) was in the programme during the test; never delete its records.
  for (const key of [...refs.keys()]) if (key.includes('aty90vcS0j2p2Fd7UYDo') || key.includes('YfpxPQdNXppgRIN41Aux')) refs.delete(key)

  console.log(`${APPLY ? 'Deleting' : 'Would delete'} ${refs.size} documents:`)
  ;[...refs.keys()].sort().forEach((key) => console.log(`  ${key}`))
  console.log(`${APPLY ? 'Deleting' : 'Would delete'} ${accounts.length} sign-in accounts:`)
  accounts.forEach((account) => console.log(`  ${account.email} (${account.uid})`))

  if (!APPLY) {
    console.log('\nNothing changed. Run again with --apply to delete.')
    return
  }
  const all = [...refs.values()]
  for (let i = 0; i < all.length; i += 400) {
    const batch = db.batch()
    all.slice(i, i + 400).forEach((ref) => batch.delete(ref))
    await batch.commit()
  }
  for (const account of accounts) await auth.deleteUser(account.uid)
  console.log('\nDone.')
})().catch((error) => { console.error(error.message); process.exit(1) })
