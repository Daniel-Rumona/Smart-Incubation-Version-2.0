#!/usr/bin/env node

/*
 * Moves every platform `admin` account to `systemadmin`, ahead of `admin` becoming a company-level
 * reception role. Until this runs, `admin` and `systemadmin` both mean platform admin, so nobody loses
 * access: the code that changes what `admin` means must only go live after it.
 *
 * Where the role lives:
 *   users/{uid}.role            (what the app and the Firestore rules read)
 *   userIdentities/{uid}.role   (written alongside it by createPlatformUser)
 *   Auth custom claims .role    (reported, and updated with --apply if present)
 *
 * Matches role 'admin' case-insensitively and ignoring spaces. Deleted accounts (status 'deleted') are
 * listed but left alone. Every changed document gets `roleMigratedFrom: 'admin'`, `roleMigratedAt` and
 * `roleMigrationTag`; the manifest records the previous values so the run can be undone.
 *
 * Usage:
 *   # dry run (default): lists the accounts that would move, changes nothing
 *   node scripts/migrate-admin-to-systemadmin.cjs --service-account ./scripts/new-service-account.json
 *
 *   # write it
 *   node scripts/migrate-admin-to-systemadmin.cjs --service-account ./scripts/new-service-account.json --apply
 *
 *   # undo a previous run
 *   node scripts/migrate-admin-to-systemadmin.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-admin-migration-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const FIELDS = ['role', 'roleMigratedFrom', 'roleMigratedAt', 'roleMigrationTag']

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

const norm = (value) => String(value ?? '').replace(/\s+/g, '').toLowerCase()
const isAdmin = (value) => norm(value) === 'admin'

/** Values of FIELDS as they are now, so an undo can put them back. */
function before(data) {
  return Object.fromEntries(FIELDS.map((field) => [field, { existed: field in data, value: field in data ? data[field] : null }]))
}

async function undo(db, args) {
  const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  console.log(`Undoing ${manifest.tag}: ${manifest.documents.length} documents, ${manifest.claims.length} claim sets.`)
  if (!args.apply) {
    console.log('Dry run. Add --apply to restore.')
    return
  }
  const batch = db.batch()
  for (const entry of manifest.documents) {
    const data = {}
    for (const [field, prior] of Object.entries(entry.before)) {
      data[field] = prior.existed ? prior.value : admin.firestore.FieldValue.delete()
    }
    batch.update(db.collection(entry.collection).doc(entry.id), data)
  }
  await batch.commit()
  for (const entry of manifest.claims) await admin.auth().setCustomUserClaims(entry.uid, entry.before)
  console.log('Restored.')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount(args)) })
  const db = admin.firestore()
  if (args.undo) return undo(db, args)

  const tag = `admin-to-systemadmin-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const [users, identities] = await Promise.all([db.collection('users').get(), db.collection('userIdentities').get()])
  const identityById = new Map(identities.docs.map((row) => [row.id, row]))

  const accounts = []
  const seen = new Set()
  for (const row of users.docs) {
    const data = row.data()
    if (!isAdmin(data.role)) continue
    seen.add(row.id)
    accounts.push({ uid: row.id, user: row, identity: identityById.get(row.id) })
  }
  // An identity saying admin while the user record says something else is reported, not changed.
  const mismatched = identities.docs.filter((row) => isAdmin(row.data().role) && !seen.has(row.id))

  const rows = []
  const documents = []
  const claims = []
  for (const account of accounts) {
    const data = account.user.data()
    const deleted = norm(data.status) === 'deleted'
    let authUser = null
    try { authUser = await admin.auth().getUser(account.uid) } catch { authUser = null }
    const claimRole = authUser?.customClaims?.role
    rows.push({
      uid: account.uid,
      name: data.name || data.displayName || '',
      email: data.email || authUser?.email || '',
      company: data.companyCode || '—',
      status: deleted ? 'deleted (skipped)' : (data.status || (data.active === false ? 'inactive' : 'active')),
      identity: account.identity ? (isAdmin(account.identity.data().role) ? 'admin' : String(account.identity.data().role || '—')) : 'none',
      auth: authUser ? (authUser.disabled ? 'disabled' : 'yes') : 'missing',
      claim: claimRole === undefined ? '—' : String(claimRole),
    })
    if (deleted) continue
    documents.push({ collection: 'users', id: account.uid, before: before(data) })
    if (account.identity && isAdmin(account.identity.data().role)) {
      documents.push({ collection: 'userIdentities', id: account.uid, before: before(account.identity.data()) })
    }
    if (authUser && isAdmin(claimRole)) claims.push({ uid: account.uid, before: authUser.customClaims || {} })
  }

  console.log(`\nAccounts with role 'admin' in users: ${rows.length}`)
  if (rows.length) console.table(rows)
  if (mismatched.length) {
    console.log(`\nuserIdentities that say 'admin' but whose users record does not (left alone, check by hand): ${mismatched.length}`)
    console.table(mismatched.map((row) => ({ uid: row.id, email: row.data().email || '', usersRole: users.docs.find((user) => user.id === row.id)?.data().role ?? '(no users doc)' })))
  }
  console.log(`\nWould change: ${documents.filter((item) => item.collection === 'users').length} users, ${documents.filter((item) => item.collection === 'userIdentities').length} userIdentities, ${claims.length} sign-in claim sets -> role 'systemadmin'.`)

  if (!args.apply) {
    console.log('\nDry run: nothing was written. Add --apply to migrate.')
    return
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db.batch()
  for (const entry of documents) {
    batch.update(db.collection(entry.collection).doc(entry.id), { role: 'systemadmin', roleMigratedFrom: 'admin', roleMigratedAt: now, roleMigrationTag: tag })
  }
  await batch.commit()
  for (const entry of claims) await admin.auth().setCustomUserClaims(entry.uid, { ...entry.before, role: 'systemadmin' })

  const manifestPath = path.resolve(__dirname, `seed-output-admin-migration-${Date.now()}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ tag, documents, claims }, null, 2))
  console.log(`\nMigrated. Undo manifest: ${manifestPath}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
