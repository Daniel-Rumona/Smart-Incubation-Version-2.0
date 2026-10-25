#!/usr/bin/env node
/*
 * Inspects and wires up a WhatsApp Business Account using the token in functions/.env (never printed).
 *
 *   node scripts/whatsapp-account.cjs --waba-id <id>                          lists its phone numbers, templates and subscribed apps
 *   node scripts/whatsapp-account.cjs --waba-id <id> --subscribe              subscribes our app so replies reach the webhook
 *   node scripts/whatsapp-account.cjs --waba-id <new> --copy-template <name> --from <old waba id>
 *                                                                             copies one approved template to this account
 *
 * Reading is safe. --subscribe and --copy-template change the account, so run them only for the account you mean to
 * go live with.
 */
const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const wabaId = value('waba-id')
if (!wabaId) { console.error('Usage: node scripts/whatsapp-account.cjs --waba-id <id> [--subscribe] [--copy-template <name> --from <waba id>]'); process.exit(1) }

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', 'functions', '.env'), 'utf8')
    .split(/\r?\n/).filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }),
)
const graph = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION || 'v23.0'}`
const headers = { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
const call = async (method, url, body) => {
  const res = await fetch(`${graph}/${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, json: await res.json() }
}
const show = (title, { status, json }, pick) => {
  if (json.error) return console.log(`${title}: could not read (HTTP ${status}): ${json.error.message}`)
  console.log(`${title}:`)
  console.log(JSON.stringify(pick ? pick(json) : json, null, 2))
}

;(async () => {
  if (flag('subscribe')) {
    const result = await call('POST', `${wabaId}/subscribed_apps`)
    console.log(result.json.error ? `Subscribe failed (HTTP ${result.status}): ${result.json.error.message}` : 'Our app is now subscribed to this account.')
  }
  // Copies one template's exact content (body, sample values, buttons) from another account and submits it for review.
  const copyTemplate = value('copy-template')
  if (copyTemplate) {
    const from = value('from')
    if (!from) { console.error('--copy-template needs --from <source waba id>'); process.exit(1) }
    const source = await call('GET', `${from}/message_templates?name=${encodeURIComponent(copyTemplate)}&fields=name,language,category,components,status`)
    const original = source.json.data?.find((row) => row.name === copyTemplate && row.status === 'APPROVED')
    if (!original) {
      console.log(`No approved template called ${copyTemplate} on ${from}${source.json.error ? `: ${source.json.error.message}` : ''}`)
    } else {
      const created = await call('POST', `${wabaId}/message_templates`, { name: original.name, language: original.language, category: original.category, components: original.components })
      console.log(created.json.error ? `Copy failed (HTTP ${created.status}): ${created.json.error.message}${created.json.error.error_user_msg ? ` - ${created.json.error.error_user_msg}` : ''}` : `Template ${original.name} submitted for review: ${JSON.stringify(created.json)}`)
    }
  }

  show('Account', await call('GET', `${wabaId}?fields=name,currency,timezone_id,account_review_status,business_verification_status`))
  show('Phone numbers', await call('GET', `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,name_status,status,quality_rating`), (json) => json.data)
  show('Templates', await call('GET', `${wabaId}/message_templates?fields=name,status,language,category&limit=50`), (json) => json.data)
  show('Subscribed apps', await call('GET', `${wabaId}/subscribed_apps`), (json) => (json.data || []).map((row) => row.whatsapp_business_api_data?.name || row.whatsapp_business_api_data?.id))
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
