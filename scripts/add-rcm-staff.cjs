#!/usr/bin/env node

/*
 * Adds RCM's operations and project admin logins (see setup-company-rcm.cjs):
 *   - operations@quantilytix.co.za   (role operations, sees every RCM programme)
 *   - projectadmin@quantilytix.co.za (role projectadmin, restricted to RCM's one programme and set
 *     as that programme's assignedAdmin)
 * Real Firebase Auth users + users/userIdentities docs, email verified, no forced password change.
 * Existing accounts with these emails are reused (password reset to the given one).
 *
 * Usage:
 *   node scripts/add-rcm-staff.cjs --service-account ./scripts/new-service-account.json            # dry run
 *   node scripts/add-rcm-staff.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/add-rcm-staff.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-rcm-staff-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const COMPANY_CODE = 'RCM'
const STAFF = [
  { email: 'operations@quantilytix.co.za', name: 'RCM Operations', role: 'operations', restrictToProgramme: false },
  { email: 'projectadmin@quantilytix.co.za', name: 'RCM Project Admin', role: 'projectadmin', restrictToProgramme: true },
]

function parseArgs(argv) {
  const args = { apply: false, password: 'Rcm#Demo2026!' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--password=')) args.password = arg.slice('--password='.length)
    else if (arg === '--password') args.password = argv[++index]
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
  const auth = admin.auth()
  const FieldValue = admin.firestore.FieldValue

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.createdAccounts.length} account(s) from ${manifest.createdAt}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to delete them.')
      return
    }
    for (const account of manifest.createdAccounts) {
      await db.collection('users').doc(account.uid).delete().catch(() => undefined)
      await db.collection('userIdentities').doc(account.uid).delete().catch(() => undefined)
      await auth.deleteUser(account.uid).catch(() => undefined)
    }
    if (manifest.programme) await db.collection('programs').doc(manifest.programme.id).update({ assignedAdmin: manifest.programme.previousAssignedAdmin ?? FieldValue.delete() })
    console.log('\nUndone.')
    return
  }

  const programmes = await db.collection('programs').where('companyCode', '==', COMPANY_CODE).get()
  if (programmes.size !== 1) throw new Error(`Expected exactly one RCM programme, found ${programmes.size}. Run setup-company-rcm.cjs first.`)
  const programme = programmes.docs[0]

  console.log('\nPlan')
  STAFF.forEach((item) => console.log(`  ${item.email.padEnd(34)} ${item.role.padEnd(13)} ${item.restrictToProgramme ? `restricted to "${programme.data().name}"` : 'all RCM programmes'}`))
  console.log(`  password: ${args.password}`)

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these accounts.')
    return
  }

  const now = FieldValue.serverTimestamp()
  const manifest = { createdAt: new Date().toISOString(), createdAccounts: [], programme: null }
  let projectAdminUid = null

  for (const item of STAFF) {
    let record = await auth.getUserByEmail(item.email).catch(() => null)
    if (record) {
      await auth.updateUser(record.uid, { password: args.password, emailVerified: true, disabled: false, displayName: item.name })
    } else {
      record = await auth.createUser({ email: item.email, password: args.password, displayName: item.name, emailVerified: true, disabled: false })
      manifest.createdAccounts.push({ uid: record.uid, email: item.email })
    }
    const assignedProgramIds = item.restrictToProgramme ? [programme.id] : []
    await db.collection('users').doc(record.uid).set({
      uid: record.uid,
      email: item.email,
      name: item.name,
      displayName: item.name,
      role: item.role,
      companyCode: COMPANY_CODE,
      assignedProgramIds,
      emailVerified: true,
      firstLoginComplete: true,
      mustChangePassword: false,
      active: true,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }, { merge: true })
    await db.collection('userIdentities').doc(record.uid).set({
      uid: record.uid, email: item.email, name: item.name, displayName: item.name, role: item.role, companyCode: COMPANY_CODE, mustChangePassword: false, updatedAt: now,
    }, { merge: true })
    if (item.role === 'projectadmin') projectAdminUid = record.uid
  }

  if (projectAdminUid) {
    manifest.programme = { id: programme.id, previousAssignedAdmin: programme.data().assignedAdmin ?? null }
    await programme.ref.update({ assignedAdmin: projectAdminUid, updatedAt: now })
  }

  const manifestPath = path.resolve(__dirname, `seed-output-rcm-staff-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('\nDone.')
  STAFF.forEach((item) => console.log(`  ${item.email} / ${args.password}`))
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/add-rcm-staff.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
