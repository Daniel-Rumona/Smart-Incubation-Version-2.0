// Starts the whole local test setup in one terminal: the Firebase emulators (scripts/emulators.mjs), then the app
// pointed at them (vite --mode emulators) and the AI backend (ai-backend/run_emulators.py).
//
//   npm run local                 fresh test data (the seed)
//   npm run walkthrough           the saved walkthrough data (emulator-data/keletso-walkthrough-final), its dates moved to today
//   node scripts/local.mjs --data <name> [--today]
//
// Ctrl+C stops all three. Save changes first with `npm run emulators:save -- <name>` in another terminal.
import { spawn } from 'node:child_process'

const root = new URL('..', import.meta.url)
const dataFlag = process.argv.indexOf('--data')
const data = dataFlag >= 0 ? ['--data', process.argv[dataFlag + 1]] : []
const toToday = process.argv.includes('--today')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const children = []
const run = (label, command, args, env = {}) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, ...env } })
    child.on('exit', (code) => console.log(`[${label}] stopped${code ? ` (exit ${code})` : ''}`))
    children.push(child)
    return child
}

process.on('SIGINT', () => undefined)
const emulators = run('database', 'node', ['scripts/emulators.mjs', ...data])
emulators.on('exit', () => {
    for (const child of children) if (child !== emulators && child.exitCode === null) child.kill()
    process.exit(0)
})

const up = (port) => fetch(`http://127.0.0.1:${port}/`).then(() => true, () => false)
while (!(await Promise.all([8080, 9099, 9199, 5001].map(up))).every(Boolean)) await sleep(1000)

// Saved data keeps the dates it was saved with: bring the classes back to "running today" (scripts/emulators-today.mjs).
if (toToday) {
    await new Promise((resolve) => {
        const child = spawn('node', ['scripts/emulators-today.mjs'], { cwd: root, stdio: 'inherit', shell: true })
        child.on('exit', resolve)
    })
}

run('app', 'npm', ['run', 'dev:emulators', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'])
run('assistant', 'python', ['ai-backend/run_emulators.py'], { PYTHONIOENCODING: 'utf-8', ALLOWED_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173' })
await sleep(4000)
console.log('\n  Smartinc (local test setup) is running: http://127.0.0.1:5173   ·   database UI: http://127.0.0.1:4000')
console.log('  Every account uses the password Password@1. Ctrl+C stops everything.\n')
