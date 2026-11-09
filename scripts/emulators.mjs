// Starts the local Firebase emulators (Auth, Firestore, Storage, Functions) for the demo-smartinc project, with the
// repo's Firestore rules and the Cloud Functions built from functions/src. See firebase.emulators.json.
//
//   npm run emulators                          start empty and seed the test data (scripts/seed-emulators.mjs)
//   npm run emulators -- --data <name>         start from emulator-data/<name>, saved with `npm run emulators:save`
//
// Nothing is saved when the emulators stop: the CLI's export on exit does not work on Windows (the emulators keep the
// exported files open, so the export cannot be moved into place). Save on purpose with scripts/emulators-save.mjs.
// `npm run emulators:seed -- --reset` restores the seeded state at any time.
//
// Uses a pinned Firebase CLI through npx: the Functions emulator needs a CLI that supports the Node 24 runtime in
// functions/package.json (older global installs do not), and 15.x needs Java 21.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const FIREBASE_TOOLS = 'firebase-tools@14.27.0'
const root = new URL('..', import.meta.url)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dataFlag = process.argv.indexOf('--data')
const dataName = dataFlag >= 0 ? process.argv[dataFlag + 1] : null
if (dataFlag >= 0 && (!dataName || !existsSync(new URL(`emulator-data/${dataName}/firebase-export-metadata.json`, root)))) {
    console.error(`No saved data called "${dataName || ''}" in emulator-data/. Save some first with: npm run emulators:save -- <name>`)
    process.exit(1)
}

const build = spawnSync('npm', ['--prefix', 'functions', 'run', 'build'], { cwd: root, stdio: 'inherit', shell: true })
if (build.status !== 0) process.exit(build.status ?? 1)

const emulators = spawn('npx', [
    '--yes', FIREBASE_TOOLS, 'emulators:start',
    '--config', 'firebase.emulators.json',
    '--project', 'demo-smartinc',
    ...(dataName ? ['--import', `./emulator-data/${dataName}`] : []),
], { cwd: root, stdio: 'inherit', shell: true })

// Ctrl+C reaches the emulators too; wait for them to stop.
process.on('SIGINT', () => undefined)
let stopped = false
emulators.on('exit', (code) => {
    stopped = true
    process.exit(code ?? 0)
})

// Started from saved data, the emulators already hold everything; otherwise seed the test data.
const up = (port) => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)
const deadline = Date.now() + 5 * 60 * 1000
while (!dataName && !stopped && Date.now() < deadline) {
    if ((await Promise.all([8080, 9099, 9199, 5001].map(up))).every(Boolean)) {
        spawnSync('node', ['scripts/seed-emulators.mjs'], { cwd: root, stdio: 'inherit', shell: true })
        break
    }
    await sleep(1000)
}
