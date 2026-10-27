#!/usr/bin/env node
/*
 * Checks or registers a WhatsApp business phone number for the Cloud API, using the access token already in
 * functions/.env. The two-step verification PIN is typed by you on the command line, so it never goes anywhere else.
 *
 *   node scripts/whatsapp-number.cjs --phone-number-id <id>                 shows the number's status, name review and quality
 *   node scripts/whatsapp-number.cjs --phone-number-id <id> --pin <6 digits> registers the number for the Cloud API
 *   node scripts/whatsapp-number.cjs --phone-number-id <id> --update-pin     securely prompts for and changes the two-step PIN
 *
 * Registering is done once, after the number has been added and verified in WhatsApp Manager. Nothing here prints
 * the token.
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const phoneNumberId = value('phone-number-id')
const pin = value('pin')
const updatePin = args.includes('--update-pin')
if (!phoneNumberId) { console.error('Usage: node scripts/whatsapp-number.cjs --phone-number-id <id> [--pin <6 digits> | --update-pin]'); process.exit(1) }
if (pin !== undefined && updatePin) { console.error('Use either --pin to register or --update-pin to change the PIN, not both.'); process.exit(1) }
if (pin !== undefined && !/^\d{6}$/.test(pin)) { console.error('The PIN must be exactly 6 digits.'); process.exit(1) }

const promptForPin = () => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    reject(new Error('--update-pin must be run in an interactive terminal.'))
    return
  }

  let entered = ''
  const cleanup = () => {
    process.stdin.off('data', onData)
    process.stdin.setRawMode(false)
    process.stdin.pause()
  }
  const onData = (chunk) => {
    for (const char of chunk.toString()) {
      if (char === '\u0003') {
        cleanup()
        process.stdout.write('\n')
        reject(new Error('PIN update cancelled.'))
        return
      }
      if (char === '\r' || char === '\n') {
        cleanup()
        process.stdout.write('\n')
        if (!/^\d{6}$/.test(entered)) reject(new Error('The PIN must be exactly 6 digits.'))
        else resolve(entered)
        return
      }
      if (char === '\b' || char === '\u007f') {
        entered = entered.slice(0, -1)
      } else if (/\d/.test(char) && entered.length < 6) {
        entered += char
      }
    }
  }

  process.stdout.write('Enter a new 6-digit PIN (input hidden): ')
  process.stdin.setEncoding('utf8')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', onData)
})

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', 'functions', '.env'), 'utf8')
    .split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }),
)
const graph = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || 'v23.0'}`
const headers = { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }

;(async () => {
  if (updatePin) {
    const newPin = await promptForPin()
    const res = await fetch(`${graph}/${phoneNumberId}`, { method: 'POST', headers, body: JSON.stringify({ pin: newPin }) })
    const json = await res.json()
    console.log(res.ok && json.success ? 'Two-step verification PIN updated.' : `PIN update failed (HTTP ${res.status}): ${json.error?.message || JSON.stringify(json)}`)
    if (!res.ok) process.exit(1)
  } else if (pin) {
    const res = await fetch(`${graph}/${phoneNumberId}/register`, { method: 'POST', headers, body: JSON.stringify({ messaging_product: 'whatsapp', pin }) })
    const json = await res.json()
    console.log(res.ok && json.success ? 'Registered for the Cloud API.' : `Registration failed (HTTP ${res.status}): ${json.error?.message || JSON.stringify(json)}`)
    if (!res.ok) process.exit(1)
  }
  const res = await fetch(`${graph}/${phoneNumberId}?fields=display_phone_number,verified_name,name_status,status,quality_rating,code_verification_status,platform_type,throughput`, { headers })
  const json = await res.json()
  if (json.error) { console.error(`Could not read the number (HTTP ${res.status}): ${json.error.message}`); process.exit(1) }
  console.log(JSON.stringify(json, null, 2))
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
