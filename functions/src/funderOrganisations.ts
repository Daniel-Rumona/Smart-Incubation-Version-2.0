import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/**
 * Funder organisations: one funder across several implementors (see docs/funder-organisations-plan.md).
 *
 * A funder organisation (funderOrganisations/{orgId}) belongs to no company. An implementor links one of its
 * programmes to it (funderLinks/{programId}_{orgId}); the link goes live only when the funder accepts, and only
 * once a system admin has confirmed the organisation. Members are `funder` users with users.funderOrgId and no
 * companyCode. What they may read is copied onto their user document (funderProgramIds, funderCompanyCodes) by
 * syncFunderAccess, the only code that grants it; firestore.rules checks those lists.
 *
 * Funders with a companyCode and no funderOrgId are the older company-scoped funders and are untouched here.
 */

export type FunderOrgStatus = 'invited' | 'confirmed' | 'merged'
export type FunderLinkStatus = 'pending' | 'active' | 'declined' | 'removed' | 'expired'
export type FunderLinkAction = 'request' | 'accept' | 'decline' | 'remove'
export type FunderOrgType = 'foundation' | 'government' | 'corporate' | 'dfi' | 'other'

export const FUNDER_ORGS = 'funderOrganisations'
export const FUNDER_LINKS = 'funderLinks'
const FUNDER_ORG_TYPES: FunderOrgType[] = ['foundation', 'government', 'corporate', 'dfi', 'other']

/** Who links a company's programmes to funders: its director and project admins (the roles that add funders today). */
export const PROGRAMME_FUNDER_MANAGERS = ['director', 'projectadmin']

/** A link request the funder hasn't answered in this many days expires; the implementor can ask again. */
export const LINK_REQUEST_DAYS = 30

export class FunderOrgError extends Error {
  constructor(public code: 'invalid-argument' | 'permission-denied' | 'not-found' | 'failed-precondition' | 'already-exists', message: string) {
    super(message)
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
type Caller = { role?: unknown, companyCode?: unknown, funderOrgId?: unknown }

const clean = (value: unknown) => String(value ?? '').trim()
const roleOf = (caller: Caller | null | undefined) => clean(caller?.role).toLowerCase()

export const toFunderOrgType = (value: unknown): FunderOrgType =>
  (FUNDER_ORG_TYPES.includes(clean(value) as FunderOrgType) ? clean(value) as FunderOrgType : 'other')

// Words that differ between how two people write the same funder's name ("Green Futures Fund" / "The Green
// Futures Foundation"), dropped before comparing.
const FILLER_WORDS = new Set(['the', 'fund', 'funds', 'foundation', 'trust', 'agency', 'of', 'and', 'for', 'sa', 'south', 'africa', 'pty', 'ltd', 'npc', 'inc'])

/** The name reduced for duplicate checks: lower case, letters and digits only, filler words dropped. */
export const funderNameKey = (name: unknown) => {
  const words = clean(name).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ').filter(Boolean)
  const kept = words.filter((word) => !FILLER_WORDS.has(word))
  return (kept.length ? kept : words).join('')
}

const editDistance = (a: string, b: string) => {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]
}

/** Two names that are probably the same funder: same key, one key inside the other, or a typo or two apart. */
export const isLookalikeName = (a: unknown, b: unknown) => {
  const left = funderNameKey(a)
  const right = funderNameKey(b)
  if (!left || !right) return false
  if (left === right) return true
  const [short, long] = left.length <= right.length ? [left, right] : [right, left]
  if (short.length >= 4 && long.includes(short)) return true
  return short.length >= 6 && editDistance(left, right) <= 2
}

export const funderLinkId = (programId: string, orgId: string) => `${programId}_${orgId}`

export const isSystemAdmin = (caller: Caller | null | undefined) => roleOf(caller) === 'systemadmin'

/** A company's director or project admin, for that company's own programme; or a system admin. */
export const canManageProgrammeFunders = (caller: Caller | null | undefined, programme: { companyCode?: unknown }) => {
  const companyCode = clean(programme.companyCode)
  if (!companyCode) return false
  if (isSystemAdmin(caller)) return true
  return PROGRAMME_FUNDER_MANAGERS.includes(roleOf(caller)) && clean(caller?.companyCode) === companyCode
}

/** A member of this funder organisation: role funder, the organisation on the account, and no company of its own. */
export const isFunderOrgMember = (caller: Caller | null | undefined, orgId: string) =>
  roleOf(caller) === 'funder' && !!orgId && clean(caller?.funderOrgId) === orgId && !clean(caller?.companyCode)

/** An address that already has an account is only reused when it is already this organisation's funder. */
export const canReuseAccountAsOrgFunder = (existing: Caller | null | undefined, orgId: string) =>
  Boolean(existing) && isFunderOrgMember(existing, orgId)

/**
 * What a link may become. The implementor requests (again after a decline or removal); only the funder accepts or
 * declines, and accepting needs a confirmed organisation; either side removes. Returns the new status, or an error.
 */
export const nextLinkStatus = (
  current: FunderLinkStatus | null,
  action: FunderLinkAction,
  side: 'implementor' | 'funder' | 'systemadmin',
  orgStatus: FunderOrgStatus,
): FunderLinkStatus => {
  if (orgStatus === 'merged') throw new FunderOrgError('failed-precondition', 'This funder organisation has been merged into another.')
  if (action === 'request') {
    if (side === 'funder') throw new FunderOrgError('permission-denied', 'Only the programme\'s organisation can request a link.')
    if (current === 'pending' || current === 'active') throw new FunderOrgError('already-exists', 'This funder is already linked or asked.')
    return 'pending'
  }
  if (action === 'accept' || action === 'decline') {
    if (side !== 'funder') throw new FunderOrgError('permission-denied', 'Only the funder can answer a link request.')
    if (current === 'expired') throw new FunderOrgError('failed-precondition', 'This request has expired. Ask the programme\'s organisation to send it again.')
    if (current !== 'pending') throw new FunderOrgError('failed-precondition', 'This link request has already been answered.')
    if (action === 'accept' && orgStatus !== 'confirmed') {
      throw new FunderOrgError('failed-precondition', 'Your organisation is still being confirmed. You can accept once it is.')
    }
    return action === 'accept' ? 'active' : 'declined'
  }
  if (current !== 'pending' && current !== 'active') throw new FunderOrgError('failed-precondition', 'This link is not in place.')
  return 'removed'
}

/** The access copied onto each member: only active links, and nothing at all until the organisation is confirmed. */
export const funderAccessFromLinks = (links: Array<{ status?: unknown, programId?: unknown, companyCode?: unknown }>, orgStatus: FunderOrgStatus) => {
  if (orgStatus !== 'confirmed') return { funderProgramIds: [] as string[], funderCompanyCodes: [] as string[] }
  const active = links.filter((link) => link.status === 'active' && clean(link.programId) && clean(link.companyCode))
  return {
    funderProgramIds: [...new Set(active.map((link) => clean(link.programId)))].sort(),
    funderCompanyCodes: [...new Set(active.map((link) => clean(link.companyCode)))].sort(),
  }
}

/** A pending request older than LINK_REQUEST_DAYS. requestedAt is a Firestore Timestamp, a Date or milliseconds. */
export const isExpiredRequest = (link: { status?: unknown, requestedAt?: unknown }, now: Date) => {
  if (link.status !== 'pending') return false
  const at = link.requestedAt as { toMillis?: () => number } | Date | number | null | undefined
  const millis = typeof at === 'number' ? at : at instanceof Date ? at.getTime() : typeof at?.toMillis === 'function' ? at.toMillis() : NaN
  return Number.isFinite(millis) && now.getTime() - millis > LINK_REQUEST_DAYS * 24 * 60 * 60 * 1000
}

/** A colleague may be added by a member of a confirmed organisation (or a system admin). */
export const canInviteFunderColleague = (caller: Caller | null | undefined, orgId: string, orgStatus: FunderOrgStatus) =>
  orgStatus === 'confirmed' && (isSystemAdmin(caller) || isFunderOrgMember(caller, orgId))

export type FunderOrgChange = { action: 'keep' | 'set' | 'clear'; orgId: string }

/**
 * What saving an account from the Users page (createPlatformUser / updatePlatformUser) does to its funder organisation.
 * `requestedOrgId` undefined means the form didn't send it (unchanged); '' or null means "one company only". Only a
 * system admin sets or changes it; an organisation's member never has a company (that would quietly end their access);
 * and an account that stops being a funder leaves its organisation.
 */
export const decideFunderOrgChange = (input: {
  isPlatformAdmin: boolean
  role: unknown
  requestedOrgId?: unknown
  existingOrgId?: unknown
  companyCode?: unknown
  /** The account's role before this save; undefined for a new account. */
  previousRole?: unknown
}): FunderOrgChange => {
  const existing = clean(input.existingOrgId)
  if (clean(input.role).toLowerCase() !== 'funder') return existing ? { action: 'clear', orgId: existing } : { action: 'keep', orgId: '' }
  const requested = input.requestedOrgId === undefined ? undefined : clean(input.requestedOrgId)
  if (requested && requested !== existing) {
    if (!input.isPlatformAdmin) throw new FunderOrgError('permission-denied', 'Only a System Admin can change a funder\'s organisation.')
    if (requested.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a funder organisation.')
    if (clean(input.companyCode)) throw new FunderOrgError('invalid-argument', 'A funder organisation\'s member has no company. Clear the company code.')
    return { action: 'set', orgId: requested }
  }
  // Every new funder belongs to a funder organisation. Only funders made the old way (one company) carry on
  // without one, until a system admin converts them on the Funder organisations page.
  const oldStyleFunder = !existing && clean(input.previousRole).toLowerCase() === 'funder'
  if (!existing && !oldStyleFunder) throw new FunderOrgError('invalid-argument', 'Choose the funder organisation they work for.')
  if (existing && clean(input.companyCode)) throw new FunderOrgError('invalid-argument', 'A funder organisation\'s member has no company. Clear the company code.')
  return { action: 'keep', orgId: existing }
}

/** The user-document fields for a decided change (checking that a newly chosen organisation is confirmed). */
export async function funderOrgFieldsFor(db: Firestore, change: FunderOrgChange): Promise<Record<string, unknown>> {
  if (change.action === 'clear') {
    return { funderOrgId: FieldValue.delete(), funderOrgName: FieldValue.delete(), funderProgramIds: [], funderCompanyCodes: [] }
  }
  if (change.action === 'keep') return change.orgId ? { companyCode: '', assignedProgramIds: [] } : {}
  const org = await db.collection(FUNDER_ORGS).doc(change.orgId).get()
  if (!org.exists || orgStatusOf(org.data()) !== 'confirmed') {
    throw new FunderOrgError('failed-precondition', 'Choose a confirmed funder organisation.')
  }
  return { funderOrgId: change.orgId, funderOrgName: clean(org.get('name')), companyCode: '', assignedProgramIds: [] }
}

/** Two links for one programme after a merge: keep the one further along. */
const LINK_RANK: Record<FunderLinkStatus, number> = { removed: 0, expired: 1, declined: 1, pending: 2, active: 3 }
export const strongerLinkStatus = (a: FunderLinkStatus, b: FunderLinkStatus) => (LINK_RANK[a] >= LINK_RANK[b] ? a : b)

// ---------------------------------------------------------------------------------------------------------------
// Firestore operations. Auth accounts and email are left to index.ts.
// ---------------------------------------------------------------------------------------------------------------

const orgStatusOf = (data: Row | undefined): FunderOrgStatus => {
  const status = clean(data?.status)
  return status === 'confirmed' || status === 'merged' ? status : 'invited'
}

const getCaller = async (db: Firestore, uid: string) => (await db.collection('users').doc(uid).get()).data() || {}

const getProgramme = async (db: Firestore, programId: string) => {
  if (!programId || programId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a programme.')
  const snapshot = await db.collection('programs').doc(programId).get()
  if (!snapshot.exists) throw new FunderOrgError('not-found', 'That programme no longer exists.')
  const data = snapshot.data() || {}
  return { id: snapshot.id, companyCode: clean(data.companyCode), name: clean(data.name || data.programName || data.title) }
}

const getCompanyName = async (db: Firestore, companyCode: string) => {
  const data = (await db.collection('companies').doc(companyCode).get()).data()
  return clean(data?.companyName || data?.name) || companyCode
}

const orgMembers = async (db: Firestore, orgId: string) => {
  const snapshot = await db.collection('users').where('funderOrgId', '==', orgId).get()
  return snapshot.docs
    .filter((doc) => clean(doc.get('role')) === 'funder' && !clean(doc.get('companyCode')))
    .map((doc) => ({ uid: doc.id, email: clean(doc.get('email')), name: clean(doc.get('name') || doc.get('displayName')) }))
}

const memberEmails = async (db: Firestore, orgId: string) =>
  (await orgMembers(db, orgId)).filter((member) => member.email).map(({ email, name }) => ({ email, name }))

/** One bell notification per member per request (staffNotifications, the in-app inbox); asking again refreshes it. */
export const linkRequestNotificationId = (memberUid: string, linkId: string) => `${memberUid}_funderlink_${linkId}`

/** Puts a link request in each member's notification bell. Only for a confirmed organisation (there's nothing to accept before). */
export async function notifyLinkRequest(db: Firestore, orgId: string, links: Array<{ id: string, companyName: string, programName: string }>) {
  if (!links.length) return
  const members = await orgMembers(db, orgId)
  if (!members.length) return
  const batch = db.batch()
  members.forEach((member) => links.forEach((link) => {
    batch.set(db.collection('staffNotifications').doc(linkRequestNotificationId(member.uid, link.id)), {
      recipientUid: member.uid,
      type: 'funder_link_request',
      title: `${link.companyName || 'An implementor'} lists you as a funder`,
      body: `Programme: ${link.programName || 'one of its programmes'}. Accept it to add its results to your dashboard, or tell them it isn't your project.`,
      link: '/funder',
      funderLinkId: link.id,
      counts: {},
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    })
  }))
  await batch.commit()
}

/** Once a request is answered, withdrawn or expired, its bell notification reads as done for every member. */
export async function closeLinkRequestNotifications(db: Firestore, orgId: string, linkIds: string[]) {
  if (!orgId || !linkIds.length) return
  const members = await orgMembers(db, orgId)
  const refs = members.flatMap((member) => linkIds.map((linkId) => db.collection('staffNotifications').doc(linkRequestNotificationId(member.uid, linkId))))
  if (!refs.length) return
  const existing = (await db.getAll(...refs)).filter((snapshot) => snapshot.exists && !snapshot.get('readAt'))
  if (!existing.length) return
  const batch = db.batch()
  existing.forEach((snapshot) => batch.update(snapshot.ref, { readAt: FieldValue.serverTimestamp() }))
  await batch.commit()
}

/** Keeps the organisation's status (and, when given, its invited contact) copied onto all its links. */
export async function setLinksOrgStatus(db: Firestore, orgId: string, status: FunderOrgStatus, contact?: { email: string }) {
  const links = await db.collection(FUNDER_LINKS).where('funderOrgId', '==', orgId).get()
  for (let index = 0; index < links.docs.length; index += 400) {
    const batch = db.batch()
    links.docs.slice(index, index + 400).forEach((link) => batch.update(link.ref, {
      funderOrgStatus: status,
      ...(contact ? { funderOrgContactEmail: contact.email } : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }))
    await batch.commit()
  }
}

/** Rebuilds what every member of the organisation may read. Call after any change to its links, members or status. */
export async function syncFunderAccess(db: Firestore, orgId: string) {
  if (!orgId) return
  const [org, links, members] = await Promise.all([
    db.collection(FUNDER_ORGS).doc(orgId).get(),
    db.collection(FUNDER_LINKS).where('funderOrgId', '==', orgId).get(),
    db.collection('users').where('funderOrgId', '==', orgId).get(),
  ])
  const access = funderAccessFromLinks(links.docs.map((doc) => doc.data()), org.exists ? orgStatusOf(org.data()) : 'merged')
  const batch = db.batch()
  members.docs.forEach((member) => {
    // A member who has since been given another role or company keeps nothing from this organisation.
    const keep = clean(member.get('role')) === 'funder' && !clean(member.get('companyCode'))
    batch.update(member.ref, {
      funderProgramIds: keep ? access.funderProgramIds : [],
      funderCompanyCodes: keep ? access.funderCompanyCodes : [],
      funderAccessSyncedAt: FieldValue.serverTimestamp(),
    })
  })
  if (members.size) await batch.commit()
}

/** Confirmed organisations matching a name, for an implementor choosing a funder; plus lookalikes of it. */
export async function searchFunderOrganisations(db: Firestore, uid: string, text: string) {
  const caller = await getCaller(db, uid)
  if (!isSystemAdmin(caller) && !(PROGRAMME_FUNDER_MANAGERS.includes(roleOf(caller)) && clean(caller.companyCode))) {
    throw new FunderOrgError('permission-denied', 'You cannot look up funders.')
  }
  const query = clean(text).toLowerCase()
  if (query.length < 2) return { matches: [] }
  // Unconfirmed organisations stay with the implementor that invited them until a system admin confirms them.
  const snapshot = await db.collection(FUNDER_ORGS).where('status', '==', 'confirmed').get()
  const matches = snapshot.docs
    .map((doc) => ({ id: doc.id, name: clean(doc.get('name')), type: toFunderOrgType(doc.get('type')) }))
    .filter((org) => org.name.toLowerCase().includes(query) || isLookalikeName(org.name, text))
    .slice(0, 10)
  return { matches }
}

/** The implementor asks a confirmed funder organisation to accept a link to one of its programmes. */
export async function requestFunderLink(db: Firestore, uid: string, programId: string, orgId: string) {
  const [caller, programme] = await Promise.all([getCaller(db, uid), getProgramme(db, programId)])
  if (!canManageProgrammeFunders(caller, programme)) throw new FunderOrgError('permission-denied', 'You cannot change this programme\'s funders.')
  if (!orgId || orgId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a funder.')
  const companyName = await getCompanyName(db, programme.companyCode)
  const orgRef = db.collection(FUNDER_ORGS).doc(orgId)
  const linkRef = db.collection(FUNDER_LINKS).doc(funderLinkId(programme.id, orgId))
  const org = await db.runTransaction(async (tx) => {
    const [orgSnap, linkSnap] = await Promise.all([tx.get(orgRef), tx.get(linkRef)])
    if (!orgSnap.exists) throw new FunderOrgError('not-found', 'That funder organisation is not registered.')
    const orgData = orgSnap.data() || {}
    const orgStatus = orgStatusOf(orgData)
    // An unconfirmed organisation may only be asked by the company that invited it.
    if (orgStatus === 'invited' && clean(orgData.createdByCompany) !== programme.companyCode && !isSystemAdmin(caller)) {
      throw new FunderOrgError('not-found', 'That funder organisation is not registered.')
    }
    const status = nextLinkStatus(linkSnap.exists ? clean(linkSnap.get('status')) as FunderLinkStatus : null, 'request', isSystemAdmin(caller) ? 'systemadmin' : 'implementor', orgStatus)
    tx.set(linkRef, {
      programId: programme.id,
      programName: programme.name,
      companyCode: programme.companyCode,
      companyName,
      funderOrgId: orgId,
      funderOrgName: clean(orgData.name),
      // Implementors can't read the organisation itself, so the link carries its status.
      funderOrgStatus: orgStatus,
      status,
      requestedBy: uid,
      requestedAt: FieldValue.serverTimestamp(),
      respondedBy: null,
      respondedAt: null,
      updatedAt: FieldValue.serverTimestamp(),
      ...(linkSnap.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
    }, { merge: true })
    return { name: clean(orgData.name), status: orgStatus }
  })
  // Members are only told once there's something they can accept.
  if (org.status === 'confirmed') await notifyLinkRequest(db, orgId, [{ id: linkRef.id, companyName, programName: programme.name }])
  return {
    linkId: linkRef.id,
    orgName: org.name,
    programName: programme.name,
    companyName,
    notify: org.status === 'confirmed' ? await memberEmails(db, orgId) : [],
  }
}

/** Checks for inviteFunderOrganisation before any account is made. */
export async function prepareFunderOrgInvite(db: Firestore, uid: string, input: { programId: string, name: string, email: string }) {
  const [caller, programme] = await Promise.all([getCaller(db, uid), getProgramme(db, input.programId)])
  if (!canManageProgrammeFunders(caller, programme)) throw new FunderOrgError('permission-denied', 'You cannot change this programme\'s funders.')
  const name = clean(input.name)
  if (name.length < 2 || name.length > 120) throw new FunderOrgError('invalid-argument', 'Enter the funder organisation\'s name.')
  return { programme, companyName: await getCompanyName(db, programme.companyCode), name }
}

/**
 * Writes a new, unconfirmed funder organisation with its first member and a pending link to the programme, in one
 * batch. The member's auth account already exists (index.ts creates it).
 */
export async function createInvitedFunderOrganisation(db: Firestore, uid: string, input: {
  programme: { id: string, companyCode: string, name: string }
  companyName: string
  name: string
  type: FunderOrgType
  contact: { uid: string, email: string, name: string, existing: boolean }
}) {
  const orgRef = db.collection(FUNDER_ORGS).doc()
  const linkRef = db.collection(FUNDER_LINKS).doc(funderLinkId(input.programme.id, orgRef.id))
  const now = FieldValue.serverTimestamp()
  const batch = db.batch()
  batch.create(orgRef, {
    name: input.name,
    nameKey: funderNameKey(input.name),
    type: input.type,
    status: 'invited',
    contactUid: input.contact.uid,
    contactEmail: input.contact.email,
    contactName: input.contact.name,
    createdByCompany: input.programme.companyCode,
    createdByCompanyName: input.companyName,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  })
  batch.create(linkRef, {
    programId: input.programme.id,
    programName: input.programme.name,
    companyCode: input.programme.companyCode,
    companyName: input.companyName,
    funderOrgId: orgRef.id,
    funderOrgName: input.name,
    funderOrgStatus: 'invited',
    // The invited contact, so the implementor that invited them can resend or correct the invite.
    funderOrgContactEmail: input.contact.email,
    funderOrgContactName: input.contact.name,
    status: 'pending',
    requestedBy: uid,
    requestedAt: now,
    respondedBy: null,
    respondedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  batch.set(db.collection('users').doc(input.contact.uid), {
    uid: input.contact.uid,
    email: input.contact.email,
    name: input.contact.name,
    displayName: input.contact.name,
    role: 'funder',
    funderOrgId: orgRef.id,
    funderOrgName: input.name,
    funderProgramIds: [],
    funderCompanyCodes: [],
    assignedProgramIds: [],
    jobTitle: input.name,
    mustChangePassword: true,
    active: true,
    status: 'active',
    invitedBy: uid,
    updatedAt: now,
    ...(input.contact.existing ? {} : { createdAt: now }),
  }, { merge: true })
  batch.set(db.collection('userIdentities').doc(input.contact.uid), {
    uid: input.contact.uid,
    email: input.contact.email,
    name: input.contact.name,
    displayName: input.contact.name,
    role: 'funder',
    mustChangePassword: true,
    updatedAt: now,
  }, { merge: true })
  await batch.commit()
  return { orgId: orgRef.id, linkId: linkRef.id }
}

/** The funder accepts or declines a link request. */
export async function respondToFunderLink(db: Firestore, uid: string, linkId: string, accept: boolean) {
  if (!linkId || linkId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a link request.')
  const caller = await getCaller(db, uid)
  const linkRef = db.collection(FUNDER_LINKS).doc(linkId)
  const result = await db.runTransaction(async (tx) => {
    const linkSnap = await tx.get(linkRef)
    if (!linkSnap.exists) throw new FunderOrgError('not-found', 'That link request no longer exists.')
    const link = linkSnap.data() || {}
    const orgId = clean(link.funderOrgId)
    if (!isFunderOrgMember(caller, orgId)) throw new FunderOrgError('permission-denied', 'This request is for another organisation.')
    const orgSnap = await tx.get(db.collection(FUNDER_ORGS).doc(orgId))
    const status = nextLinkStatus(clean(link.status) as FunderLinkStatus, accept ? 'accept' : 'decline', 'funder', orgStatusOf(orgSnap.data()))
    tx.update(linkRef, { status, respondedBy: uid, respondedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { orgId, status, requestedBy: clean(link.requestedBy), programName: clean(link.programName), orgName: clean(link.funderOrgName) }
  })
  await syncFunderAccess(db, result.orgId)
  await closeLinkRequestNotifications(db, result.orgId, [linkId])
  return result
}

/** Either side ends a link (or withdraws a request). */
export async function removeFunderLink(db: Firestore, uid: string, linkId: string) {
  if (!linkId || linkId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a link.')
  const caller = await getCaller(db, uid)
  const linkRef = db.collection(FUNDER_LINKS).doc(linkId)
  const result = await db.runTransaction(async (tx) => {
    const linkSnap = await tx.get(linkRef)
    if (!linkSnap.exists) throw new FunderOrgError('not-found', 'That link no longer exists.')
    const link = linkSnap.data() || {}
    const orgId = clean(link.funderOrgId)
    const side = isSystemAdmin(caller) ? 'systemadmin'
      : isFunderOrgMember(caller, orgId) ? 'funder'
        : canManageProgrammeFunders(caller, { companyCode: link.companyCode }) ? 'implementor' : null
    if (!side) throw new FunderOrgError('permission-denied', 'You cannot change this link.')
    const orgSnap = await tx.get(db.collection(FUNDER_ORGS).doc(orgId))
    const status = nextLinkStatus(clean(link.status) as FunderLinkStatus, 'remove', side, orgSnap.exists ? orgStatusOf(orgSnap.data()) : 'invited')
    tx.update(linkRef, { status, removedBy: uid, removedBySide: side, removedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return { orgId, side, requestedBy: clean(link.requestedBy), programName: clean(link.programName), orgName: clean(link.funderOrgName), companyName: clean(link.companyName) }
  })
  await syncFunderAccess(db, result.orgId)
  await closeLinkRequestNotifications(db, result.orgId, [linkId])
  return result
}

/** A system admin confirms a newly invited organisation, so its links can be accepted and other implementors can find it. */
export async function confirmFunderOrganisation(db: Firestore, uid: string, orgId: string) {
  if (!isSystemAdmin(await getCaller(db, uid))) throw new FunderOrgError('permission-denied', 'Only a System Admin can confirm funder organisations.')
  if (!orgId || orgId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a funder organisation.')
  const orgRef = db.collection(FUNDER_ORGS).doc(orgId)
  const name = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(orgRef)
    if (!snapshot.exists) throw new FunderOrgError('not-found', 'That funder organisation no longer exists.')
    const status = orgStatusOf(snapshot.data())
    if (status === 'merged') throw new FunderOrgError('failed-precondition', 'This organisation has been merged into another.')
    if (status === 'invited') tx.update(orgRef, { status: 'confirmed', confirmedBy: uid, confirmedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return clean(snapshot.get('name'))
  })
  await setLinksOrgStatus(db, orgId, 'confirmed')
  await syncFunderAccess(db, orgId)
  const waiting = await db.collection(FUNDER_LINKS).where('funderOrgId', '==', orgId).where('status', '==', 'pending').get()
  await notifyLinkRequest(db, orgId, waiting.docs.map((link) => ({ id: link.id, companyName: clean(link.get('companyName')), programName: clean(link.get('programName')) })))
  return { orgId, name, notify: await memberEmails(db, orgId) }
}

/**
 * A system admin folds a duplicate organisation into the real one: its members and links move across (where both
 * have a link to one programme, the one further along wins), and the duplicate is marked merged.
 */
export async function mergeFunderOrganisation(db: Firestore, uid: string, sourceId: string, targetId: string) {
  if (!isSystemAdmin(await getCaller(db, uid))) throw new FunderOrgError('permission-denied', 'Only a System Admin can merge funder organisations.')
  if (!sourceId || !targetId || sourceId === targetId || sourceId.includes('/') || targetId.includes('/')) {
    throw new FunderOrgError('invalid-argument', 'Choose two different funder organisations.')
  }
  const sourceRef = db.collection(FUNDER_ORGS).doc(sourceId)
  const targetRef = db.collection(FUNDER_ORGS).doc(targetId)
  const [sourceLinks, members] = await Promise.all([
    db.collection(FUNDER_LINKS).where('funderOrgId', '==', sourceId).get(),
    db.collection('users').where('funderOrgId', '==', sourceId).get(),
  ])
  await db.runTransaction(async (tx) => {
    const [source, target] = await Promise.all([tx.get(sourceRef), tx.get(targetRef)])
    if (!source.exists || !target.exists) throw new FunderOrgError('not-found', 'One of these organisations no longer exists.')
    if (orgStatusOf(source.data()) === 'merged') throw new FunderOrgError('failed-precondition', 'That organisation has already been merged.')
    if (orgStatusOf(target.data()) !== 'confirmed') throw new FunderOrgError('failed-precondition', 'Merge into a confirmed organisation.')
    const targetName = clean(target.get('name'))
    const targetLinkRefs = sourceLinks.docs.map((link) => db.collection(FUNDER_LINKS).doc(funderLinkId(clean(link.get('programId')), targetId)))
    const existingTargetLinks = await Promise.all(targetLinkRefs.map((ref) => tx.get(ref)))
    const now = FieldValue.serverTimestamp()
    sourceLinks.docs.forEach((link, index) => {
      const data = link.data()
      const existing = existingTargetLinks[index]
      const status = existing.exists
        ? strongerLinkStatus(clean(existing.get('status')) as FunderLinkStatus, clean(data.status) as FunderLinkStatus)
        : clean(data.status) as FunderLinkStatus
      tx.set(targetLinkRefs[index], { ...data, ...(existing.exists ? existing.data() : {}), funderOrgId: targetId, funderOrgName: targetName, funderOrgStatus: 'confirmed', status, mergedFrom: sourceId, updatedAt: now }, { merge: false })
      tx.update(link.ref, { status: 'removed', funderOrgStatus: 'merged', mergedInto: targetId, updatedAt: now })
    })
    members.docs.forEach((member) => tx.update(member.ref, { funderOrgId: targetId, funderOrgName: targetName, updatedAt: now }))
    tx.update(sourceRef, { status: 'merged', mergedInto: targetId, mergedBy: uid, mergedAt: now, updatedAt: now })
  })
  await Promise.all([syncFunderAccess(db, targetId), syncFunderAccess(db, sourceId)])
  return { orgId: targetId }
}

/** For resending or correcting an invite: the inviting company's manager (or a system admin), and only its contact. */
export async function getInviteForResend(db: Firestore, uid: string, orgId: string) {
  if (!orgId || orgId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a funder organisation.')
  const [caller, org] = await Promise.all([getCaller(db, uid), db.collection(FUNDER_ORGS).doc(orgId).get()])
  if (!org.exists) throw new FunderOrgError('not-found', 'That funder organisation no longer exists.')
  const data = org.data() || {}
  if (!isSystemAdmin(caller) && !canManageProgrammeFunders(caller, { companyCode: data.createdByCompany })) {
    throw new FunderOrgError('permission-denied', 'Only the organisation that invited this funder can change the invite.')
  }
  if (orgStatusOf(data) === 'merged') throw new FunderOrgError('failed-precondition', 'This organisation has been merged into another.')
  return {
    orgId,
    name: clean(data.name),
    contactUid: clean(data.contactUid),
    contactEmail: clean(data.contactEmail),
    contactName: clean(data.contactName),
    companyName: clean(data.createdByCompanyName) || clean(data.createdByCompany),
  }
}

/** Ends pending requests older than LINK_REQUEST_DAYS. Returns them, so the implementors who asked can be told. */
export async function expirePendingFunderLinks(db: Firestore, now: Date) {
  const pending = await db.collection(FUNDER_LINKS).where('status', '==', 'pending').get()
  const expired = pending.docs.filter((link) => isExpiredRequest(link.data(), now))
  for (let index = 0; index < expired.length; index += 400) {
    const batch = db.batch()
    expired.slice(index, index + 400).forEach((link) => batch.update(link.ref, { status: 'expired', expiredAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }))
    await batch.commit()
  }
  const byOrg = new Map<string, string[]>()
  expired.forEach((link) => byOrg.set(clean(link.get('funderOrgId')), [...(byOrg.get(clean(link.get('funderOrgId'))) || []), link.id]))
  for (const [orgId, linkIds] of byOrg) await closeLinkRequestNotifications(db, orgId, linkIds)
  return expired.map((link) => ({ requestedBy: clean(link.get('requestedBy')), programName: clean(link.get('programName')), orgName: clean(link.get('funderOrgName')) }))
}

/** Checks for inviteFunderOrgColleague: the organisation, its status, and that the caller may add to it. */
export async function prepareFunderColleagueInvite(db: Firestore, uid: string) {
  const caller = await getCaller(db, uid)
  const orgId = clean(caller.funderOrgId)
  if (!orgId) throw new FunderOrgError('permission-denied', 'Only a funder organisation\'s members can add colleagues.')
  const org = await db.collection(FUNDER_ORGS).doc(orgId).get()
  if (!org.exists || !canInviteFunderColleague(caller, orgId, orgStatusOf(org.data()))) {
    throw new FunderOrgError('failed-precondition', 'You can add colleagues once your organisation is confirmed.')
  }
  return { orgId, orgName: clean(org.get('name')), inviterName: clean(caller.name || caller.displayName) }
}

/** Adds a colleague to the organisation (their auth account already exists) and gives them its access. */
export async function addFunderColleague(db: Firestore, uid: string, input: { orgId: string, orgName: string, contact: { uid: string, email: string, name: string, existing: boolean } }) {
  const now = FieldValue.serverTimestamp()
  await Promise.all([
    db.collection('users').doc(input.contact.uid).set({
      uid: input.contact.uid,
      email: input.contact.email,
      name: input.contact.name,
      displayName: input.contact.name,
      role: 'funder',
      funderOrgId: input.orgId,
      funderOrgName: input.orgName,
      funderProgramIds: [],
      funderCompanyCodes: [],
      assignedProgramIds: [],
      jobTitle: input.orgName,
      mustChangePassword: true,
      active: true,
      status: 'active',
      invitedBy: uid,
      updatedAt: now,
      ...(input.contact.existing ? {} : { createdAt: now }),
    }, { merge: true }),
    db.collection('userIdentities').doc(input.contact.uid).set({
      uid: input.contact.uid, email: input.contact.email, name: input.contact.name, displayName: input.contact.name, role: 'funder', mustChangePassword: true, updatedAt: now,
    }, { merge: true }),
  ])
  await syncFunderAccess(db, input.orgId)
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 5: funders made the old way (one company, users.companyCode + assignedProgramIds) become organisation members.
// ---------------------------------------------------------------------------------------------------------------

/**
 * A funder made the old way: role funder with a company and no organisation. Training-module funders
 * (users.funderId, see trainingOrganisations.ts) are a different kind and stay as they are.
 */
export const isOldStyleFunder = (data: Row | null | undefined) =>
  clean(data?.role) === 'funder' && !!clean(data?.companyCode) && !clean(data?.funderOrgId) && !clean(data?.funderId)

/** The programmes an old-style funder sees today: their linked ones, or all of the company's when none are linked. */
export const oldStyleProgrammeIds = (companyProgrammeIds: string[], assignedProgramIds: unknown) => {
  const linked = new Set((Array.isArray(assignedProgramIds) ? assignedProgramIds : []).map(clean).filter(Boolean))
  return linked.size ? companyProgrammeIds.filter((id) => linked.has(id)) : [...companyProgrammeIds]
}

const validOrgName = (value: unknown) => {
  const name = clean(value)
  if (name.length < 2 || name.length > 120) throw new FunderOrgError('invalid-argument', 'Enter the funder organisation\'s name.')
  return name
}

const newConfirmedOrg = (uid: string, name: string, type: FunderOrgType) => ({
  name,
  nameKey: funderNameKey(name),
  type,
  status: 'confirmed',
  createdByCompany: '',
  createdBy: uid,
  confirmedBy: uid,
  confirmedAt: FieldValue.serverTimestamp(),
  createdAt: FieldValue.serverTimestamp(),
  updatedAt: FieldValue.serverTimestamp(),
})

/** A system admin adds a funder organisation directly; it is confirmed at once. */
export async function createConfirmedFunderOrganisation(db: Firestore, uid: string, input: { name: unknown, type: unknown }) {
  if (!isSystemAdmin(await getCaller(db, uid))) throw new FunderOrgError('permission-denied', 'Only a System Admin can add funder organisations.')
  const name = validOrgName(input.name)
  const ref = db.collection(FUNDER_ORGS).doc()
  await ref.create(newConfirmedOrg(uid, name, toFunderOrgType(input.type)))
  return { orgId: ref.id, name }
}

/**
 * Converts an old-style funder into a member of a funder organisation (an existing confirmed one, or a new one made
 * here). The programmes they see today become accepted links at once: they already see that data, so there is
 * nothing for them to accept again. Their company code is cleared, and what it was is kept on the account.
 */
export async function convertOldStyleFunder(db: Firestore, uid: string, input: { userId: unknown, orgId?: unknown, newOrg?: { name?: unknown, type?: unknown } | null }) {
  if (!isSystemAdmin(await getCaller(db, uid))) throw new FunderOrgError('permission-denied', 'Only a System Admin can convert funders.')
  const userId = clean(input.userId)
  if (!userId || userId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a funder.')
  const userRef = db.collection('users').doc(userId)
  const before = (await userRef.get()).data()
  if (!isOldStyleFunder(before)) throw new FunderOrgError('failed-precondition', 'This account isn\'t a company funder made the old way.')
  const companyCode = clean(before?.companyCode)

  const existingOrgId = clean(input.orgId)
  const newName = input.newOrg ? validOrgName(input.newOrg.name) : ''
  if (!existingOrgId && !newName) throw new FunderOrgError('invalid-argument', 'Choose a funder organisation, or name a new one.')
  if (existingOrgId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a funder organisation.')
  const orgRef = existingOrgId ? db.collection(FUNDER_ORGS).doc(existingOrgId) : db.collection(FUNDER_ORGS).doc()

  const [programmes, companyName] = await Promise.all([
    db.collection('programs').where('companyCode', '==', companyCode).get(),
    getCompanyName(db, companyCode),
  ])
  const programmeIds = oldStyleProgrammeIds(programmes.docs.map((row) => row.id), before?.assignedProgramIds)
  const programmeName = new Map(programmes.docs.map((row) => [row.id, clean(row.get('name') || row.get('programName') || row.get('title'))]))
  const linkRefs = programmeIds.map((programId) => db.collection(FUNDER_LINKS).doc(funderLinkId(programId, orgRef.id)))

  const orgName = await db.runTransaction(async (tx) => {
    const [user, org, ...links] = await Promise.all([tx.get(userRef), existingOrgId ? tx.get(orgRef) : Promise.resolve(null), ...linkRefs.map((ref) => tx.get(ref))])
    if (!isOldStyleFunder(user.data())) throw new FunderOrgError('failed-precondition', 'This account has changed. Reload and try again.')
    let name = newName
    if (existingOrgId) {
      if (!org?.exists || orgStatusOf(org.data()) !== 'confirmed') throw new FunderOrgError('failed-precondition', 'Choose a confirmed funder organisation.')
      name = clean(org.get('name'))
    } else {
      tx.create(orgRef, newConfirmedOrg(uid, name, toFunderOrgType(input.newOrg?.type)))
    }
    const now = FieldValue.serverTimestamp()
    programmeIds.forEach((programId, index) => {
      tx.set(linkRefs[index], {
        programId,
        programName: programmeName.get(programId) || '',
        companyCode,
        companyName,
        funderOrgId: orgRef.id,
        funderOrgName: name,
        funderOrgStatus: 'confirmed',
        // Already funded before the change, so the link starts accepted.
        status: links[index].exists ? strongerLinkStatus(clean(links[index].get('status')) as FunderLinkStatus, 'active') : 'active',
        requestedBy: uid,
        requestedAt: now,
        respondedBy: userId,
        respondedAt: now,
        convertedFrom: userId,
        updatedAt: now,
        ...(links[index].exists ? {} : { createdAt: now }),
      }, { merge: true })
    })
    tx.update(userRef, {
      companyCode: '',
      assignedProgramIds: [],
      funderOrgId: orgRef.id,
      funderOrgName: name,
      convertedFromCompany: { companyCode, programIds: programmeIds, by: uid, at: now },
      updatedAt: now,
    })
    tx.set(db.collection('userIdentities').doc(userId), { companyCode: '', updatedAt: now }, { merge: true })
    return name
  })
  await syncFunderAccess(db, orgRef.id)
  return { orgId: orgRef.id, orgName, programmes: programmeIds.length }
}

// ---------------------------------------------------------------------------------------------------------------
// Funding committed: the amount (rand) a funder put into one programme, kept on its link for the Impact page.
// ---------------------------------------------------------------------------------------------------------------

/** A rand amount to store (two decimals), null to clear it; anything else is refused. */
export const parseFundingAmount = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const digits = typeof value === 'number' ? '' : String(value).replace(/[^0-9.-]/g, '')
  // Text with no digits in it ("abc") must not read as nought.
  const amount = typeof value === 'number' ? value : digits ? Number(digits) : NaN
  if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) throw new FunderOrgError('invalid-argument', 'Enter the amount in rand, for example 2500000.')
  return Math.round(amount * 100) / 100
}

/**
 * The implementor records how much the funder committed to the programme (its director or project admins, or a system
 * admin). The funder sees it read-only, with who set it and when. Both sides confirming it may come later.
 */
export async function setFunderLinkFunding(db: Firestore, uid: string, linkId: string, value: unknown) {
  if (!linkId || linkId.includes('/')) throw new FunderOrgError('invalid-argument', 'Choose a programme link.')
  const amount = parseFundingAmount(value)
  const caller = await getCaller(db, uid)
  const linkRef = db.collection(FUNDER_LINKS).doc(linkId)
  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(linkRef)
    if (!snapshot.exists) throw new FunderOrgError('not-found', 'That link no longer exists.')
    const link = snapshot.data() || {}
    const side = isSystemAdmin(caller) ? 'systemadmin'
      : canManageProgrammeFunders(caller, { companyCode: link.companyCode }) ? 'implementor' : null
    if (!side) throw new FunderOrgError('permission-denied', 'The programme\'s organisation records the funding amount.')
    if (!['active', 'pending'].includes(clean(link.status))) throw new FunderOrgError('failed-precondition', 'This link is not in place.')
    tx.update(linkRef, {
      fundingAmount: amount === null ? FieldValue.delete() : amount,
      fundingCurrency: 'ZAR',
      fundingUpdatedBy: uid,
      fundingUpdatedSide: side,
      fundingUpdatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { linkId, fundingAmount: amount }
  })
}

/** A programme was deleted: its funder links end, and the funders' access is rebuilt. */
export async function endLinksForDeletedProgramme(db: Firestore, programId: string) {
  const links = await db.collection(FUNDER_LINKS).where('programId', '==', programId).get()
  if (links.empty) return
  const batch = db.batch()
  links.docs.forEach((link) => batch.update(link.ref, { status: 'removed', removedBySide: 'programme-deleted', removedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }))
  await batch.commit()
  await Promise.all([...new Set(links.docs.map((link) => clean(link.get('funderOrgId'))))].map((orgId) => syncFunderAccess(db, orgId)))
}

// ---------------------------------------------------------------------------------------------------------------
// Email wording
// ---------------------------------------------------------------------------------------------------------------

export const orgFunderInviteWording = (input: { implementorName?: unknown, funderName?: unknown, programName?: unknown }) => {
  const implementor = clean(input.implementorName) || 'An implementing organisation'
  const funder = clean(input.funderName) || 'your organisation'
  const programme = clean(input.programName) || 'one of its programmes'
  return {
    title: `${implementor} lists ${funder} as a funder`,
    intro: `${implementor} has listed ${funder} as a funder of ${programme} on Smart Incubation. Use the secure link below to set your password. `
      + 'Once your organisation is confirmed and you accept the link, you will see the programme\'s results: SMEs supported, jobs, revenue and support delivered.',
    actionLabel: 'Set your password',
    expiryNote: `This link is time-sensitive. Ask ${implementor} for a new invitation if it has expired.`,
  }
}

export const linkRequestWording = (input: { implementorName?: unknown, programName?: unknown }) => {
  const implementor = clean(input.implementorName) || 'An implementing organisation'
  const programme = clean(input.programName) || 'one of its programmes'
  return {
    title: `${implementor} lists you as a funder of ${programme}`,
    intro: `${implementor} has asked to link ${programme} to your organisation on Smart Incubation. Accept it to add the programme's results to your dashboard, or tell them it isn't your project.`,
    actionLabel: 'Review the request',
    expiryNote: '',
  }
}

export const colleagueInviteWording = (input: { inviterName?: unknown, funderName?: unknown }) => {
  const inviter = clean(input.inviterName) || 'A colleague'
  const funder = clean(input.funderName) || 'your organisation'
  return {
    title: `Your ${funder} funder dashboard`,
    intro: `${inviter} has given you a sign-in to ${funder}'s funder dashboard on Smart Incubation: the results of the programmes it funds. Use the secure link below to set your password.`,
    actionLabel: 'Set your password',
    expiryNote: `This link is time-sensitive. Ask ${inviter} for a new invitation if it has expired.`,
  }
}

export const orgConfirmedWording = (input: { funderName?: unknown }) => {
  const funder = clean(input.funderName) || 'Your organisation'
  return {
    title: `${funder} is confirmed on Smart Incubation`,
    intro: `${funder} is now confirmed. Accept the programme links waiting for you to see their results.`,
    actionLabel: 'Open your dashboard',
    expiryNote: '',
  }
}
