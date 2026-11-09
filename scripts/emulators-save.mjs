// Saves what is in the running local emulators now (database, sign-ins and files) to emulator-data/<name>, to start
// from it again later, for example a prepared walkthrough:
//
//   npm run emulators:save -- keletso-walkthrough        (while `npm run emulators` is running)
//   npm run emulators -- --data keletso-walkthrough       (later: start from it instead of the seed)
//
// The Firebase CLI's own export (emulators:export, --export-on-exit) fails on Windows: it writes to a temporary folder
// and then moves it, while the emulators still hold the files it wrote. Here each emulator writes straight into the
// final folder, in the same format the CLI imports.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ID = 'demo-smartinc'
const HOST = '127.0.0.1'
const CLI_VERSION = '14.27.0' // scripts/emulators.mjs
const root = fileURLToPath(new URL('..', import.meta.url))

const name = process.argv[2] || 'latest'
if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    console.error('Use a folder name of letters, numbers, - and _ only, e.g. keletso-walkthrough.')
    process.exit(1)
}

const up = (port) => fetch(`http://${HOST}:${port}/`).then(() => true, () => false)
for (const [label, port] of [['Firestore', 8080], ['Auth', 9099], ['Storage', 9199]]) {
    if (!await up(port)) {
        console.error(`The ${label} emulator is not running on ${HOST}:${port}. Start the emulators first: npm run emulators`)
        process.exit(1)
    }
}

// A folder saved earlier in this same run of the emulators is still held by them; save next to it instead.
let target = join(root, 'emulator-data', name)
if (existsSync(target)) {
    try {
        rmSync(target, { recursive: true, force: true })
    } catch {
        target = join(root, 'emulator-data', `${name}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`)
        console.log(`emulator-data/${name} is still in use by the running emulators; saving to ${target} instead.`)
    }
}
mkdirSync(target, { recursive: true })

const owner = { Authorization: 'Bearer owner' }
const ok = async (response, label) => {
    if (!response.ok) throw new Error(`${label} failed (${response.status}): ${await response.text()}`)
    return response
}

// Firestore writes firestore_export/ itself.
await ok(await fetch(`http://${HOST}:8080/emulator/v1/projects/${PROJECT_ID}:export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ database: `projects/${PROJECT_ID}/databases/(default)`, export_directory: target, export_name: 'firestore_export' }),
}), 'Firestore export')

// Auth: the accounts (with the emulator's stored passwords) and the project config.
mkdirSync(join(target, 'auth_export'))
const accounts = await (await ok(await fetch(`http://${HOST}:9099/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=-1`, { headers: owner }), 'Auth export')).text()
writeFileSync(join(target, 'auth_export', 'accounts.json'), accounts)
const config = await (await ok(await fetch(`http://${HOST}:9099/emulator/v1/projects/${PROJECT_ID}/config`, { headers: owner }), 'Auth config export')).text()
writeFileSync(join(target, 'auth_export', 'config.json'), config)

// Storage writes storage_export/ itself.
mkdirSync(join(target, 'storage_export'))
await ok(await fetch(`http://${HOST}:9199/internal/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: join(target, 'storage_export'), initiatedBy: 'export' }),
}), 'Storage export')

const firestoreJar = (() => {
    try {
        return readdirSync(join(homedir(), '.cache', 'firebase', 'emulators')).find((file) => /^cloud-firestore-emulator-v.*\.jar$/.test(file))
    } catch {
        return undefined
    }
})()
writeFileSync(join(target, 'firebase-export-metadata.json'), JSON.stringify({
    version: CLI_VERSION,
    firestore: {
        version: firestoreJar?.replace(/^cloud-firestore-emulator-v|\.jar$/g, '') || 'unknown',
        path: 'firestore_export',
        metadata_file: 'firestore_export/firestore_export.overall_export_metadata',
    },
    auth: { version: CLI_VERSION, path: 'auth_export' },
    storage: { version: CLI_VERSION, path: 'storage_export' },
}, undefined, 2))

if (!existsSync(join(target, 'firestore_export', 'firestore_export.overall_export_metadata'))) {
    console.error('The Firestore export did not arrive; the folder is not usable.')
    process.exit(1)
}
const users = JSON.parse(accounts).users?.length ?? 0
const folder = target.slice(join(root, 'emulator-data').length + 1)
console.log(`Saved to emulator-data/${folder}: the database, ${users} sign-ins and the stored files.`)
console.log(`Start from it later with:  npm run emulators -- --data ${folder}`)
process.exit(0)
