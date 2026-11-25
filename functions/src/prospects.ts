import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { isReservedTestAddress } from './testAddresses.js'

/*
 * Prospects (smeProspects, see src/config/prospects.ts): businesses and people a company has reached who have not
 * joined yet. The browser manages them; this module does what must not be left to the browser:
 *   - matching a sign-up to its prospect (the invite link's token, else the phone, email or registration number),
 *     and copying what the prospect already told us into their new profile so they don't type it again;
 *   - marking prospects converted when a participant or a training client company is created;
 *   - the public sign-up form behind an event's QR code or WhatsApp link (no sign-in);
 *   - the funnel counts funders may see (numbers only, never names);
 *   - retention: prospects that never convert are archived after 12 months and anonymised 30 days later.
 */

export const PROSPECTS = 'smeProspects'
export const EVENTS = 'smeProspectEvents'
export const SIGNUP_LINKS = 'prospectSignupLinks'
export const RETENTION_MONTHS = 12
export const RESTORE_DAYS = 30

type Module = 'incubation' | 'training'
type Data = Record<string, unknown>

const clean = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

// ---- Comparable contact details (mirrors src/utils/contactKeys.ts) ---------------------------------------------

export const emailKey = (value: unknown) => {
  const email = String(value ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export const phoneKey = (value: unknown, defaultCountryCode = '27') => {
  const raw = String(value ?? '').trim()
  let digits = raw.replace(/\D/g, '')
  if (!digits) return ''
  if (raw.startsWith('+')) return digits.length >= 9 ? `+${digits}` : ''
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (digits.startsWith('0')) digits = `${defaultCountryCode}${digits.slice(1)}`
  else if (digits.length <= 9) digits = `${defaultCountryCode}${digits}`
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : ''
}

export const registrationKey = (value: unknown) => {
  const key = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  return key.length >= 4 ? key : ''
}

export type Keys = { phone: string, email: string, registration: string }

export const keysOf = (details: { phone?: unknown, email?: unknown, registrationNumber?: unknown }): Keys => ({
  phone: phoneKey(details.phone), email: emailKey(details.email), registration: registrationKey(details.registrationNumber),
})

const sameName = (a: unknown, b: unknown) => {
  const left = clean(a).toLowerCase().replace(/\s+/g, ' ')
  return left !== '' && left === clean(b).toLowerCase().replace(/\s+/g, ' ')
}

/** True when two records share a phone, email or registration number (or, with `byName`, the same name). */
export const sameBusiness = (keys: Keys, other: Data, name?: string, byName = false) => {
  const otherKeys = (other.keys || {}) as Partial<Keys>
  if ((['phone', 'email', 'registration'] as const).some((key) => keys[key] && keys[key] === otherKeys[key])) return true
  return byName && Boolean(name) && sameName(name, other.businessName || other.contactName)
}

// ---- Pipeline order ---------------------------------------------------------------------------------------------

const ORDER: Record<Module, string[]> = {
  incubation: ['new', 'contacted', 'invited', 'applied', 'joined'],
  training: ['new', 'contacted', 'proposal', 'booked', 'client'],
}
export const CONVERTED: Record<Module, string> = { incubation: 'joined', training: 'client' }

/** Moves forward only: a prospect already further along (or converted) is never moved back by a sign-up. */
export const isAdvance = (module: Module, from: unknown, to: string) => {
  const order = ORDER[module]
  const fromIndex = order.indexOf(clean(from))
  // A closed prospect (not interested, lost) who signs up after all has come back: that is an advance.
  return order.indexOf(to) > fromIndex
}

const moduleOf = (data: Data): Module => (data.module === 'training' ? 'training' : 'incubation')

/** The status change and its history entry, in one batch. */
const advance = (db: Firestore, batch: FirebaseFirestore.WriteBatch, ref: FirebaseFirestore.DocumentReference, data: Data, to: string, extra: Data, by: { uid: string, name: string }, note?: string) => {
  const at = new Date().toISOString()
  const module = moduleOf(data)
  const converted = to === CONVERTED[module]
  batch.update(ref, {
    status: to, statusChangedAt: at, updatedAt: at, updatedBy: by.uid,
    ...(converted && !data.convertedAt ? { convertedAt: at } : {}),
    ...extra,
  })
  batch.set(db.collection(EVENTS).doc(), {
    companyCode: data.companyCode, prospectId: ref.id, module, from: clean(data.status) || null, to, at, by: by.uid, byName: by.name, ...(note ? { note } : {}),
  })
}

const findMatches = async (db: Firestore, companyCode: string, module: Module, keys: Keys, name?: string) => {
  const rows = await db.collection(PROSPECTS).where('companyCode', '==', companyCode).where('module', '==', module).get()
  return rows.docs.filter((row) => !row.get('anonymisedAt') && sameBusiness(keys, row.data(), name))
}

// ---- Sign-up through a programme link -------------------------------------------------------------------------

/**
 * After an SME joins a programme: the prospect behind it (the invite link's token, else the same phone, email or
 * registration number in that company) is marked "applied", and what it told us is copied into the SME's profile
 * when the profile does not exist yet. Never fails the join.
 */
export async function matchProspectOnJoin(db: Firestore, uid: string, input: { companyCode: string, programId?: string, token?: string }) {
  const companyCode = clean(input.companyCode)
  if (!companyCode) return null
  const user = (await db.collection('users').doc(uid).get()).data() || {}
  let match: FirebaseFirestore.QueryDocumentSnapshot | undefined
  const token = clean(input.token)
  if (token && /^[A-Za-z0-9_-]{8,64}$/.test(token)) {
    const byToken = await db.collection(PROSPECTS).where('inviteToken', '==', token).limit(1).get()
    match = byToken.docs.find((row) => row.get('companyCode') === companyCode)
  }
  if (!match) {
    const keys = keysOf({ phone: user.phone, email: user.email })
    if (!keys.phone && !keys.email) return null
    match = (await findMatches(db, companyCode, 'incubation', keys)).find((row) => !row.get('userUid') || row.get('userUid') === uid)
  }
  if (!match) return null

  const data = match.data()
  const batch = db.batch()
  const linked = { userUid: uid, ...(input.programId && !data.programId ? { programId: input.programId } : {}) }
  if (isAdvance('incubation', data.status, 'applied')) {
    advance(db, batch, match.ref, data, 'applied', linked, { uid, name: clean(user.name || user.displayName) || 'The business' }, 'Signed up through the programme link')
  } else {
    batch.update(match.ref, { ...linked, updatedAt: new Date().toISOString() })
  }

  // What the prospect already told us, so the SME doesn't type it again. Only into profiles that don't exist yet.
  const [applicant, business] = await Promise.all([
    db.collection('applicantProfiles').doc(uid).get(),
    db.collection('businessProfiles').doc(uid).get(),
  ])
  const email = emailKey(user.email) || emailKey(data.email)
  if (!applicant.exists) {
    batch.set(db.collection('applicantProfiles').doc(uid), {
      uid, participantName: clean(data.contactName) || null, email, phone: clean(data.phone) || null, province: clean(data.province) || null,
      prefilledFromProspect: match.id, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  }
  if (!business.exists && data.kind !== 'person') {
    const ownership = Array.isArray(data.ownership) ? data.ownership : []
    batch.set(db.collection('businessProfiles').doc(uid), {
      ownerUid: uid, applicantProfileId: uid, businessName: clean(data.businessName) || null, participantName: clean(data.contactName) || null,
      email, phone: clean(data.phone) || null, sector: clean(data.sector) || null, registrationNumber: clean(data.registrationNumber) || null,
      province: clean(data.province) || null, directors: [],
      // Only what the prospect said for sure: a "majority women-owned" tick is not a percentage, so it is left for the SME.
      ownership: { youthOwnedPercent: null, femaleOwnedPercent: null, blackOwnedPercent: null },
      ownershipHints: ownership,
      prefilledFromProspect: match.id, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
  }
  await batch.commit()
  return match.id
}

// ---- Conversions --------------------------------------------------------------------------------------------------

/** A participant was created (operations accepted the application): its prospect has joined. */
export async function convertOnParticipant(db: Firestore, participantId: string, participant: Data) {
  const companyCode = clean(participant.companyCode)
  if (!companyCode) return null
  const uid = clean(participant.uid || participant.userId || participant.ownerUid)
  const keys = keysOf({ phone: participant.phone, email: participant.email, registrationNumber: participant.registrationNumber })
  const rows = await db.collection(PROSPECTS).where('companyCode', '==', companyCode).where('module', '==', 'incubation').get()
  const match = rows.docs.find((row) => uid && row.get('userUid') === uid)
    || rows.docs.find((row) => !row.get('anonymisedAt') && !row.get('participantId') && sameBusiness(keys, row.data()))
  if (!match || match.get('participantId')) return null
  const batch = db.batch()
  advance(db, batch, match.ref, match.data(), 'joined', { participantId, ...(uid ? { userUid: uid } : {}) }, { uid: 'system', name: 'Smart Incubation' }, 'Accepted into the programme')
  await batch.commit()
  return match.id
}

/** A training company registered a client company: the prospect for it (same email, phone or name) is now a client. */
export async function convertOnClientCompany(db: Firestore, organisationId: string, organisation: Data) {
  const companyCode = clean(organisation.companyCode)
  if (!companyCode) return null
  const keys = keysOf({ phone: organisation.phone, email: organisation.contactEmail })
  const rows = await db.collection(PROSPECTS).where('companyCode', '==', companyCode).where('module', '==', 'training').get()
  const match = rows.docs.find((row) => row.get('organisationId') === organisationId)
    || rows.docs.find((row) => !row.get('anonymisedAt') && !row.get('organisationId') && row.get('kind') !== 'person' && sameBusiness(keys, row.data(), clean(organisation.name), true))
  if (!match) return null
  const batch = db.batch()
  if (isAdvance('training', match.get('status'), 'client')) {
    advance(db, batch, match.ref, match.data(), 'client', { organisationId }, { uid: 'system', name: 'Smart Incubation' }, 'Registered as a client company')
  } else {
    batch.update(match.ref, { organisationId, updatedAt: new Date().toISOString() })
  }
  await batch.commit()
  return match.id
}

// ---- Public sign-up form ------------------------------------------------------------------------------------------

export class ProspectError extends Error {
  constructor(public code: 'invalid' | 'not_found' | 'rate_limited' | 'forbidden', message: string) {
    super(message)
  }
}

const MAX_SIGNUPS_PER_HOUR = 60

export async function signupLinkInfo(db: Firestore, code: string) {
  const id = clean(code)
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new ProspectError('not_found', 'This sign-up link is not valid.')
  const link = await db.collection(SIGNUP_LINKS).doc(id).get()
  if (!link.exists || link.get('active') !== true) throw new ProspectError('not_found', 'This sign-up link is closed.')
  // An event's codes close the day after the event (functions/src/teamEvents.ts).
  const closesAt = clean(link.get('closesAt'))
  if (closesAt && closesAt < new Date().toISOString()) throw new ProspectError('not_found', 'This sign-up link is closed.')
  const company = (await db.collection('companies').doc(clean(link.get('companyCode'))).get()).data() || {}
  return {
    link,
    info: {
      label: clean(link.get('label')),
      module: link.get('module') === 'training' ? 'training' : 'incubation',
      companyName: clean(company.companyName || company.name),
      logoUrl: clean(company.logoUrl),
      // An event code belongs to one team member: their first name, so they know the code on screen is theirs.
      ownerFirstName: clean(link.get('ownerName')).split(/\s+/)[0] || '',
    },
  }
}

export type SignupInput = {
  code?: unknown, kind?: unknown, businessName?: unknown, contactName?: unknown, phone?: unknown, email?: unknown,
  sector?: unknown, province?: unknown, interest?: unknown, consent?: unknown, contactAllowed?: unknown, website?: unknown,
}

/**
 * Someone fills in the event's form themselves. Consent is required; a hidden field catches bots; each link takes at
 * most 60 sign-ups an hour. Someone already on record (same phone or email) is not added twice: their record gets a
 * history entry instead.
 */
export async function submitSignup(db: Firestore, input: SignupInput) {
  if (clean(input.website)) return { ok: true }  // the hidden field: only bots fill it in
  const { link, info } = await signupLinkInfo(db, clean(input.code))
  // Incubation works with businesses only; training also takes individuals.
  const kind = input.kind === 'person' && info.module === 'training' ? 'person' : 'business'
  const businessName = kind === 'person' ? '' : clean(input.businessName).slice(0, 160)
  const contactName = clean(input.contactName).slice(0, 120)
  const phone = clean(input.phone).slice(0, 40)
  const email = clean(input.email).toLowerCase().slice(0, 160)
  if (input.consent !== true) throw new ProspectError('invalid', 'Please agree that we may keep your details.')
  if (kind === 'business' ? !businessName : !contactName) throw new ProspectError('invalid', kind === 'business' ? 'Please enter the business name.' : 'Please enter your name.')
  if (!phoneKey(phone) && !emailKey(email)) throw new ProspectError('invalid', 'Please enter a phone number or an email address.')

  const companyCode = clean(link.get('companyCode'))
  const module = info.module as Module
  const hour = new Date().toISOString().slice(0, 13)
  const counterRef = db.collection(SIGNUP_LINKS).doc(link.id)
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(counterRef)).data() || {}
    const count = current.hour === hour ? Number(current.hourCount || 0) : 0
    if (count >= MAX_SIGNUPS_PER_HOUR) throw new ProspectError('rate_limited', 'Too many sign-ups right now. Please try again later.')
    transaction.update(counterRef, { hour, hourCount: count + 1, signups: FieldValue.increment(1), lastSignupAt: new Date().toISOString() })
  })

  const keys = keysOf({ phone, email })
  const at = new Date().toISOString()
  const self = { uid: 'self-signup', name: contactName || businessName || 'Signed up themselves' }
  const existing = (await findMatches(db, companyCode, module, keys))[0]
  const batch = db.batch()
  if (existing) {
    batch.set(db.collection(EVENTS).doc(), {
      companyCode, prospectId: existing.id, module, from: clean(existing.get('status')) || null, to: clean(existing.get('status')) || 'new',
      at, by: self.uid, byName: self.name, note: `Signed up again: ${info.label || 'sign-up link'}`,
    })
    batch.update(existing.ref, { updatedAt: at, ...(input.contactAllowed === true ? { 'consent.contactAllowed': true, 'consent.at': at } : {}) })
    await batch.commit()
    return { ok: true, prospectId: existing.id, existing: true }
  }
  const ref = db.collection(PROSPECTS).doc()
  batch.set(ref, {
    companyCode, module, kind, businessName, contactName, phone, email, registrationNumber: '',
    sector: clean(input.sector).slice(0, 80), province: clean(input.province).slice(0, 60), ownership: [],
    source: clean(link.get('source')) || 'event', sourceDetail: info.label, signupLinkId: link.id,
    ...(module === 'training' ? { interest: clean(input.interest).slice(0, 160) || null } : { programId: clean(link.get('programId')) || null, programName: clean(link.get('programName')) || null }),
    ownerUid: clean(link.get('ownerUid')) || null, ownerName: clean(link.get('ownerName')) || null,
    notes: '', status: 'new', statusChangedAt: at, keys,
    consent: { given: true, source: 'form', contactAllowed: input.contactAllowed === true, at, recordedBy: self.uid },
    createdAt: at, createdBy: self.uid, updatedAt: at, updatedBy: self.uid,
  })
  batch.set(db.collection(EVENTS).doc(), { companyCode, prospectId: ref.id, module, from: null, to: 'new', at, by: self.uid, byName: self.name, note: `Signed up: ${info.label || 'sign-up link'}` })
  await batch.commit()
  return { ok: true, prospectId: ref.id, existing: false }
}

// ---- Funnel counts (funders: numbers only) -----------------------------------------------------------------------

export type FunnelRow = { source: string, reached: number, engaged: number, invited: number, converted: number, conversionPct: number }

/** Per source: reached (all), engaged (got past "new"), invited (invited or proposal sent, or further), converted. */
export const funnelCounts = (module: Module, prospects: Data[], furthest: Map<string, number>) => {
  const order = ORDER[module]
  const bySource = new Map<string, FunnelRow>()
  const row = (source: string) => {
    if (!bySource.has(source)) bySource.set(source, { source, reached: 0, engaged: 0, invited: 0, converted: 0, conversionPct: 0 })
    return bySource.get(source) as FunnelRow
  }
  for (const prospect of prospects) {
    const reachedIndex = Math.max(order.indexOf(clean(prospect.status)), furthest.get(clean(prospect.id)) ?? -1, 0)
    for (const target of [row(clean(prospect.source) || 'other'), row('all')]) {
      target.reached += 1
      if (reachedIndex >= 1) target.engaged += 1
      if (reachedIndex >= 2) target.invited += 1
      if (reachedIndex >= 4) target.converted += 1
    }
  }
  for (const value of bySource.values()) value.conversionPct = value.reached ? Math.round((value.converted / value.reached) * 100) : 0
  return [...bySource.values()].sort((a, b) => (a.source === 'all' ? -1 : b.source === 'all' ? 1 : b.reached - a.reached))
}

/**
 * What a funder's numbers cover: the prospects tied to what it funds. Incubation: prospects for its programmes.
 * Training: prospects booked into the classes it pays for. Null means the whole company (staff).
 */
export type FunnelScope = { programIds?: string[], classIds?: string[] } | null

export const inScope = (module: Module, prospect: Data, scope: FunnelScope) => {
  if (!scope) return true
  return module === 'incubation'
    ? (scope.programIds || []).includes(clean(prospect.programId))
    : (scope.classIds || []).includes(clean(prospect.bookedClassId))
}

export type EventRow = { source: string, event: string, reached: number, engaged: number, converted: number, conversionPct: number, revenue: number | null }

const normaliseName = (value: unknown) => clean(value).toLowerCase().replace(/\s+/g, ' ')

/**
 * Per event or campaign (the prospect's source and its detail, e.g. "Event · Mining Sustainability Summit"): how many
 * were reached, engaged and converted and, for training, the income from the clients it brought (paid and invoiced,
 * matched on the client company's name). Staff only: it names the clients' events, not people.
 */
export const eventCounts = (module: Module, prospects: Data[], furthest: Map<string, number>, revenue: Data[] = []) => {
  const order = ORDER[module]
  const income = new Map<string, number>()
  for (const row of revenue) {
    const key = normaliseName(row.organisation)
    if (key && ['paid', 'invoiced'].includes(clean(row.status))) income.set(key, (income.get(key) || 0) + (Number(row.amount) || 0))
  }
  const rows = new Map<string, EventRow>()
  for (const prospect of prospects) {
    const event = clean(prospect.sourceDetail)
    if (!event) continue
    const source = clean(prospect.source) || 'other'
    const key = `${source}|${event.toLowerCase()}`
    if (!rows.has(key)) rows.set(key, { source, event, reached: 0, engaged: 0, converted: 0, conversionPct: 0, revenue: module === 'training' ? 0 : null })
    const row = rows.get(key) as EventRow
    const reachedIndex = Math.max(order.indexOf(clean(prospect.status)), furthest.get(clean(prospect.id)) ?? -1, 0)
    row.reached += 1
    if (reachedIndex >= 1) row.engaged += 1
    if (reachedIndex >= 4) {
      row.converted += 1
      if (row.revenue !== null) row.revenue += income.get(normaliseName(prospect.businessName)) || 0
    }
  }
  for (const row of rows.values()) row.conversionPct = row.reached ? Math.round((row.converted / row.reached) * 100) : 0
  return [...rows.values()].sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || b.converted - a.converted || b.reached - a.reached)
}

export async function prospectFunnel(db: Firestore, companyCode: string, module: Module, scope: FunnelScope = null, withEvents = false) {
  const [prospects, events, revenue] = await Promise.all([
    db.collection(PROSPECTS).where('companyCode', '==', companyCode).where('module', '==', module).get(),
    db.collection(EVENTS).where('companyCode', '==', companyCode).where('module', '==', module).get(),
    withEvents && module === 'training' ? db.collection('clientRevenue').where('companyCode', '==', companyCode).get() : Promise.resolve(null),
  ])
  const order = ORDER[module]
  const furthest = new Map<string, number>()
  for (const event of events.docs) {
    const id = clean(event.get('prospectId'))
    furthest.set(id, Math.max(furthest.get(id) ?? -1, order.indexOf(clean(event.get('to')))))
  }
  const rows = prospects.docs.map((row) => ({ id: row.id, ...row.data() } as Data)).filter((row) => inScope(module, row, scope))
  return {
    rows: funnelCounts(module, rows, furthest),
    byEvent: withEvents ? eventCounts(module, rows, furthest, revenue ? revenue.docs.map((row) => row.data()) : []) : [],
  }
}

/** A funder's scope: the programmes on its account (incubation) or the classes its funder record pays for (training). */
export async function funderScope(db: Firestore, caller: Data, companyCode: string, module: Module): Promise<FunnelScope> {
  if (module === 'incubation') {
    const programIds = [...new Set([
      ...(Array.isArray(caller.assignedProgramIds) ? caller.assignedProgramIds : []),
      ...(Array.isArray(caller.funderProgramIds) ? caller.funderProgramIds : []),
    ].map(clean).filter(Boolean))]
    return { programIds }
  }
  const funderId = clean(caller.funderId)
  if (!funderId) return { classIds: [] }
  const classes = await db.collection('trainingClasses').where('companyCode', '==', companyCode).where('funderId', '==', funderId).get()
  return { classIds: classes.docs.map((row) => row.id) }
}

/** Staff of the company, or its funder: who may see the funnel counts. */
export const canSeeFunnel = (caller: Data, companyCode: string) => {
  const role = clean(caller.role)
  if (role === 'systemadmin') return true
  if (['projectadmin', 'projectmanager', 'operations', 'director'].includes(role)) return clean(caller.companyCode) === companyCode
  if (role === 'funder') {
    return clean(caller.companyCode) === companyCode
      || (Array.isArray(caller.funderCompanyCodes) && caller.funderCompanyCodes.includes(companyCode))
  }
  return false
}

// ---- Retention ------------------------------------------------------------------------------------------------------

const monthsAgo = (months: number, now: Date) => { const date = new Date(now); date.setMonth(date.getMonth() - months); return date.toISOString() }
const daysAgo = (days: number, now: Date) => new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString()

/** What retention does with one prospect today: nothing, archive it, or anonymise it. */
export const retentionStep = (data: Data, now = new Date()): 'keep' | 'archive' | 'anonymise' => {
  if (data.anonymisedAt || data.convertedAt || data.participantId || data.organisationId) return 'keep'
  const lastActivity = clean(data.statusChangedAt) || clean(data.createdAt)
  const stale = Boolean(lastActivity) && lastActivity < monthsAgo(RETENTION_MONTHS, now)
  const archivedAt = clean(data.archivedAt)
  if (!archivedAt) return stale ? 'archive' : 'keep'
  // Archived (by retention or by staff) for longer than the restore window, and not touched in a year: anonymise.
  return archivedAt < daysAgo(RESTORE_DAYS, now) && (data.archiveReason === 'retention' || stale) ? 'anonymise' : 'keep'
}

/** Personal details out; what the funnel needs (side, source, status, dates, sector, province) stays. */
export const ANONYMISED_FIELDS = {
  businessName: 'Anonymised prospect', contactName: '', phone: '', email: '', registrationNumber: '', notes: '', sourceDetail: '',
  ownerName: null, extraDetails: [], keys: { phone: '', email: '', registration: '' }, inviteToken: null, 'consent.note': null,
}

export async function runRetention(db: Firestore, now = new Date()) {
  const rows = await db.collection(PROSPECTS).get()
  let archived = 0
  let anonymised = 0
  let batch = db.batch()
  let pending = 0
  for (const row of rows.docs) {
    const step = retentionStep(row.data(), now)
    if (step === 'keep') continue
    const at = now.toISOString()
    if (step === 'archive') {
      batch.update(row.ref, { archivedAt: at, archivedBy: 'retention', archiveReason: 'retention', updatedAt: at })
      archived += 1
    } else {
      batch.update(row.ref, { ...ANONYMISED_FIELDS, anonymisedAt: at, updatedAt: at })
      anonymised += 1
    }
    pending += 1
    if (pending >= 400) { await batch.commit(); batch = db.batch(); pending = 0 }
  }
  if (pending) await batch.commit()
  return { archived, anonymised }
}

// ---- Invite email -------------------------------------------------------------------------------------------------

/** Whether the system may email this prospect: they agreed to messages, and the address can receive mail. */
export const mayEmail = (data: Data) => {
  const consent = (data.consent || {}) as Data
  const email = emailKey(data.email)
  return consent.contactAllowed === true && Boolean(email) && !isReservedTestAddress(email)
}
