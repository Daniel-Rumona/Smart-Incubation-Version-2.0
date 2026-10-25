#!/usr/bin/env node
/*
 * Fills the business and location details the SME screens show but the seeded participants never had:
 * nature of business, street address, city, postal code, location type and area, host community, registration
 * details, ownership percentages, development type, and digital presence (with the Yes/No answers).
 *
 * Only fields that are empty are written, never overwritten. Province, sector, stage and the rest are left as they
 * are, and each city is chosen to match the SME's province. Deterministic per SME, so a re-run is stable.
 *
 * Dry run by default; --apply writes and saves a manifest; --undo <manifest> --apply removes exactly those fields.
 *
 *   node scripts/seed-participant-profiles.cjs --service-account ./scripts/new-service-account.json
 *   node scripts/seed-participant-profiles.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-participant-profiles.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-profiles-<ts>.json --apply
 */
const fs = require('fs')
const path = require('path')
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const serviceAccountPath = value('service-account')
const apply = flag('apply')
const undoFile = value('undo')
if (!serviceAccountPath) { console.error('Usage: node scripts/seed-participant-profiles.cjs --service-account <file> [--apply] [--undo <manifest>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(path.resolve(serviceAccountPath)) })
const db = admin.firestore()
const { FieldValue } = admin.firestore
const SEED_TAG = `profiles-${Date.now()}`

const hash = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
const pick = (list, seed) => list[hash(seed) % list.length]
const chance = (seed, percent) => hash(seed) % 100 < percent
const slug = (v) => String(v || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '')

// city, area (suburb or township), postal code, location type
const PLACES = {
  Gauteng: [['Johannesburg', 'Sandton', '2196', 'Urban'], ['Johannesburg', 'Soweto', '1804', 'Township'], ['Pretoria', 'Centurion', '0157', 'Urban'], ['Pretoria', 'Mamelodi', '0122', 'Township'], ['Ekurhuleni', 'Germiston', '1401', 'Urban'], ['Johannesburg', 'Alexandra', '2090', 'Township']],
  'Western Cape': [['Cape Town', 'Bellville', '7530', 'Urban'], ['Cape Town', 'Khayelitsha', '7784', 'Township'], ['Cape Town', 'Mitchells Plain', '7785', 'Township'], ['Stellenbosch', 'Stellenbosch Central', '7600', 'Urban'], ['George', 'George Industria', '6529', 'Urban']],
  Mpumalanga: [['Mbombela', 'Nelspruit Ext 4', '1200', 'Urban'], ['eMalahleni', 'Witbank Central', '1035', 'Urban'], ['Middelburg', 'Mhluzi', '1050', 'Township']],
  'KwaZulu-Natal': [['Durban', 'Umlazi', '4031', 'Township'], ['Durban', 'Pinetown', '3610', 'Urban'], ['Pietermaritzburg', 'Scottsville', '3201', 'Urban'], ['Richards Bay', 'Meerensee', '3900', 'Urban'], ['Ladysmith', 'Ezakheni', '3370', 'Rural']],
  'Northern Cape': [['Kimberley', 'Galeshewe', '8345', 'Township'], ['Upington', 'Upington Industrial', '8800', 'Urban'], ['Springbok', 'Springbok Central', '8240', 'Rural']],
  'North West': [['Mahikeng', 'Mmabatho', '2735', 'Township'], ['Rustenburg', 'Rustenburg Central', '0299', 'Urban'], ['Potchefstroom', 'Ikageng', '2531', 'Township'], ['Zeerust', 'Zeerust Rural', '2865', 'Rural']],
  'Eastern Cape': [['Gqeberha', 'Motherwell', '6211', 'Township'], ['East London', 'Mdantsane', '5219', 'Township'], ['Mthatha', 'Mthatha Central', '5099', 'Rural'], ['Gqeberha', 'Walmer', '6065', 'Urban']],
  'Free State': [['Bloemfontein', 'Mangaung', '9301', 'Township'], ['Bloemfontein', 'Westdene', '9301', 'Urban'], ['Welkom', 'Thabong', '9459', 'Township']],
  Limpopo: [['Polokwane', 'Seshego', '0742', 'Township'], ['Polokwane', 'Bendor', '0699', 'Urban'], ['Thohoyandou', 'Thohoyandou Block D', '0950', 'Rural']],
}
const FALLBACK_PLACES = PLACES.Gauteng

const NATURE = {
  'Retail & Trade': ['General dealer selling groceries and household goods to the local community', 'Wholesale distribution of consumer goods to spaza shops and small retailers', 'Online and in-store retail of clothing and accessories'],
  'Renewable Energy': ['Installs and maintains solar PV systems for homes and small businesses', 'Supplies solar geysers and battery backup kits', 'Energy audits and off-grid power solutions for farms'],
  Manufacturing: ['Manufactures steel and aluminium products for the construction industry', 'Produces packaged food and beverage products for retail chains', 'Cut-and-sew garment manufacturing for corporate uniforms'],
  'Tourism & Hospitality': ['Guest house and township tour experiences', 'Catering and events for corporate and community clients', 'Small lodge offering accommodation and guided local tours'],
  'ICT & Software': ['Develops custom business software and mobile apps for SMEs', 'Managed IT support and cloud services for small offices', 'Builds e-commerce platforms for local retailers'],
  'Information Technology': ['IT support, networking and hardware supply for schools and small businesses'],
  'Health & Wellness': ['Primary-care clinic and wellness services for the local community', 'Supplies medical consumables and PPE to clinics', 'Fitness studio and nutrition coaching'],
  'Agro-processing': ['Processes and packages fresh produce for retail and export', 'Dried fruit and nut processing for supermarket chains', 'Poultry processing and distribution to local butcheries'],
  Construction: ['Builds and renovates residential and small commercial properties', 'Civil works and paving contractor for municipalities', 'Plumbing, electrical and general maintenance contracting'],
  'Professional Services': ['Bookkeeping, tax and payroll services for small businesses', 'Business consulting and compliance support', 'Marketing and brand design agency for small enterprises'],
  'Creative Industries': ['Graphic design, printing and signage studio', 'Film and photography production for brands and events'],
}
const FALLBACK_NATURE = ['Small business providing products and services to the local market']
const STREETS = ['Main Road', 'Church Street', 'Industrial Road', 'Market Street', 'Voortrekker Road', 'Nelson Mandela Drive', 'Commissioner Street', 'Station Road']
const DEV_TYPES = ['Enterprise Development', 'Supplier Development']
const OTHER_PLATFORMS = ['TikTok', 'YouTube', 'WhatsApp Business', 'Google Business Profile', 'Pinterest']

const buildProfile = (id, data) => {
  const places = PLACES[data.province] || FALLBACK_PLACES
  const [city, area, postal, locationType] = pick(places, `${id}:place`)
  const years = 1 + (hash(`${id}:years`) % 12)
  const registered = new Date(); registered.setFullYear(registered.getFullYear() - years); registered.setMonth(hash(`${id}:m`) % 12, 1 + (hash(`${id}:d`) % 27))
  const black = pick([51, 60, 75, 80, 100], `${id}:black`)
  const handle = slug(data.businessName) || `sme${hash(id) % 1000}`

  const profile = {
    natureOfBusiness: pick(NATURE[data.sector] || FALLBACK_NATURE, `${id}:nature`),
    businessAddress: `${1 + (hash(`${id}:no`) % 240)} ${pick(STREETS, `${id}:street`)}, ${area}`,
    city,
    postalCode: postal,
    locationType,
    location: area,
    registrationNumber: `${registered.getFullYear()}/${String(100000 + (hash(`${id}:reg`) % 899999))}/07`,
    dateOfRegistration: registered.toISOString().slice(0, 10),
    yearsOfTrading: years,
    youthOwnedPercent: pick([0, 25, 51, 60, 100], `${id}:youth`),
    femaleOwnedPercent: pick([0, 30, 51, 70, 100], `${id}:female`),
    blackOwnedPercent: black,
    developmentType: pick(DEV_TYPES, `${id}:dev`),
  }
  // Host community is only meaningful where the business sits in a township or rural community.
  if (locationType !== 'Urban') profile.hub = area

  // Digital presence: Yes (with a link), No, or still unanswered, so all three states are visible.
  const channel = (key, yesPercent, link) => {
    const roll = hash(`${id}:${key}`) % 100
    if (roll < yesPercent) return { answer: true, link }
    return roll < yesPercent + (100 - yesPercent) * 0.75 ? { answer: false } : { answer: null }
  }
  const channels = {
    website: channel('website', 55, `https://www.${handle}.co.za`),
    facebook: channel('facebook', 80, `facebook.com/${handle}`),
    instagram: channel('instagram', 60, `@${handle}`),
    x: channel('x', 20, `@${handle}`),
    linkedIn: channel('linkedIn', 35, `linkedin.com/company/${handle}`),
  }
  const others = chance(`${id}:other`, 30)
    ? [{ platform: pick(OTHER_PLATFORMS, `${id}:op`), link: `@${handle}` }]
    : []
  const digitalPresence = {
    website: channels.website.answer, facebook: channels.facebook.answer, instagram: channels.instagram.answer,
    x: channels.x.answer, linkedIn: channels.linkedIn.answer,
    other: others.length ? true : (chance(`${id}:othern`, 60) ? false : null),
  }
  profile.digitalPresence = digitalPresence
  if (channels.website.link && channels.website.answer) profile.websiteUrl = channels.website.link
  const social = {}
  ;['facebook', 'instagram', 'x', 'linkedIn'].forEach((key) => { if (channels[key].answer) social[key] = channels[key].link })
  if (others.length) social.otherPlatforms = others
  if (Object.keys(social).length) profile.socialMedia = social
  return profile
}

const commit = async (operations) => {
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch()
    operations.slice(i, i + 400).forEach((run) => run(batch))
    await batch.commit()
  }
}

;(async () => {
  if (undoFile) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(undoFile), 'utf8'))
    console.log(`Undo: ${manifest.written.length} participants lose the fields this seed added`)
    if (!apply) { console.log('Dry run. Re-run with --apply.'); return }
    await commit(manifest.written.map((entry) => (batch) => {
      const fields = Object.fromEntries(entry.fields.map((field) => [field, FieldValue.delete()]))
      batch.update(db.collection('participants').doc(entry.id), { ...fields, profileSeedTag: FieldValue.delete() })
    }))
    console.log('Undone.')
    return
  }

  const snap = await db.collection('participants').get()
  const writes = []
  snap.docs.forEach((doc) => {
    const data = doc.data()
    if (data.profileSeedTag) return
    const profile = buildProfile(doc.id, data)
    // Never overwrite: keep only the fields this SME has no value for.
    const missing = Object.fromEntries(Object.entries(profile).filter(([key]) => {
      const current = data[key]
      return current === undefined || current === null || current === ''
    }))
    if (Object.keys(missing).length) writes.push({ id: doc.id, fields: missing })
  })

  const count = (key) => writes.filter((w) => w.fields[key] !== undefined).length
  console.log(`${writes.length} of ${snap.size} participants get profile details`)
  console.log(`  address/city: ${count('city')}, nature of business: ${count('natureOfBusiness')}, registration: ${count('registrationNumber')}, ownership: ${count('blackOwnedPercent')}`)
  const presence = writes.map((w) => w.fields.digitalPresence).filter(Boolean)
  const tally = (key) => ({ yes: presence.filter((p) => p[key] === true).length, no: presence.filter((p) => p[key] === false).length, unanswered: presence.filter((p) => p[key] === null).length })
  ;['website', 'facebook', 'instagram', 'x', 'linkedIn', 'other'].forEach((key) => console.log(`  digital ${key}:`, tally(key)))
  const sample = writes[0]
  if (sample) console.log('Sample:', sample.id, JSON.stringify(sample.fields, null, 1))
  if (!apply) { console.log('\nDry run. Re-run with --apply to write these.'); return }

  await commit(writes.map((w) => (batch) => batch.update(db.collection('participants').doc(w.id), { ...w.fields, profileSeedTag: SEED_TAG })))
  const manifestPath = path.join(__dirname, `seed-output-profiles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ seedTag: SEED_TAG, written: writes.map((w) => ({ id: w.id, fields: Object.keys(w.fields) })) }, null, 2))
  console.log(`\nDone. Manifest: ${manifestPath}`)
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
