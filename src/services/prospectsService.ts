import { collection, doc, getDocs, query, where, writeBatch } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import { CONVERTED_STATUS, PROSPECT_STATUSES, allowsPeople, isClosedStatus, isForwardMove, type ConsentSource, type OwnershipKey, type ProspectModule, type ProspectSource, type ProspectStatus } from '@/config/prospects'
import { listTrainingOrganisations } from '@/services/trainingOrganisationsService'
import { addTrainingLearners } from '@/services/trainingService'
import type { FullIdentity } from '@/types/identity'
import { prospectName, type Prospect, type ProspectDuplicate, type ProspectEvent, type ProspectFunnel as ProspectFunnelResult, type ProspectSignupLink, type ProspectValues } from '@/types/prospects'
import { contactKeys, sharedKeys, type ContactKeys } from '@/utils/contactKeys'

/**
 * Prospects of one company (see src/config/prospects.ts). Staff of the company only (firestore.rules); never deleted
 * from here: archiving hides a prospect and can be undone, and the retention job anonymises old ones.
 */

const PROSPECTS = 'smeProspects'
const EVENTS = 'smeProspectEvents'
const STAFF_ROLES = new Set(['projectadmin', 'projectmanager', 'operations'])

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const now = () => new Date().toISOString()

export const canManageProspects = (user?: Pick<FullIdentity, 'role' | 'companyCode'> | null) =>
    Boolean(user && STAFF_ROLES.has(String(user.role)) && text(user.companyCode))

const companyOf = (user?: FullIdentity | null) => {
    if (!user || !canManageProspects(user)) throw new Error('forbidden')
    return text(user.companyCode)
}

const nameOf = (user: FullIdentity) => text(user.displayName) || text(user.name) || text(user.email)

const STATUS_KEYS = new Set(Object.values(PROSPECT_STATUSES).flat().map((option) => option.key))

export const toProspect = (id: string, data: Record<string, unknown>): Prospect => {
    const consent = (data.consent || {}) as Record<string, unknown>
    const keys = (data.keys || {}) as Record<string, unknown>
    const module: ProspectModule = data.module === 'training' ? 'training' : 'incubation'
    const status = STATUS_KEYS.has(data.status as ProspectStatus) ? data.status as ProspectStatus : 'new'
    return {
        id,
        companyCode: text(data.companyCode),
        module,
        kind: data.kind === 'person' ? 'person' : 'business',
        businessName: text(data.businessName),
        contactName: text(data.contactName),
        phone: text(data.phone),
        email: text(data.email),
        registrationNumber: text(data.registrationNumber),
        sector: text(data.sector),
        province: text(data.province),
        ownership: (Array.isArray(data.ownership) ? data.ownership : []).filter((item): item is OwnershipKey => typeof item === 'string'),
        source: (text(data.source) || 'other') as ProspectSource,
        sourceDetail: text(data.sourceDetail),
        programId: text(data.programId) || undefined,
        programName: text(data.programName) || undefined,
        interest: text(data.interest) || undefined,
        ownerUid: text(data.ownerUid) || undefined,
        ownerName: text(data.ownerName) || undefined,
        notes: text(data.notes),
        nextFollowUpAt: text(data.nextFollowUpAt) || undefined,
        status,
        closedReason: text(data.closedReason) || undefined,
        invitedAt: text(data.invitedAt) || undefined,
        bookedClassId: text(data.bookedClassId) || undefined,
        bookedClassLabel: text(data.bookedClassLabel) || undefined,
        userUid: text(data.userUid) || undefined,
        statusChangedAt: text(data.statusChangedAt) || text(data.createdAt),
        consent: {
            given: consent.given === true,
            source: (text(consent.source) || 'other') as ConsentSource,
            contactAllowed: consent.contactAllowed === true,
            at: text(consent.at),
            recordedBy: text(consent.recordedBy),
            note: text(consent.note) || undefined,
        },
        keys: { phone: text(keys.phone), email: text(keys.email), registration: text(keys.registration) },
        participantId: text(data.participantId) || undefined,
        organisationId: text(data.organisationId) || undefined,
        convertedAt: text(data.convertedAt) || undefined,
        archivedAt: text(data.archivedAt) || undefined,
        createdAt: text(data.createdAt),
        createdBy: text(data.createdBy),
        updatedAt: text(data.updatedAt),
    }
}

/** The company's prospects on one side (archived ones included, for the "show archived" view), newest first. */
export const listProspects = async (user: FullIdentity, module: ProspectModule) => {
    const companyCode = companyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), PROSPECTS), where('companyCode', '==', companyCode), where('module', '==', module)))
    return snapshot.docs.map((row) => toProspect(row.id, row.data())).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const listProspectEvents = async (user: FullIdentity, prospect: Pick<Prospect, 'id' | 'module'>) => {
    const companyCode = companyOf(user)
    // The side is part of the query: firestore.rules checks it on every result.
    const snapshot = await getDocs(query(collection(getFirebaseDb(), EVENTS), where('companyCode', '==', companyCode), where('module', '==', prospect.module), where('prospectId', '==', prospect.id)))
    return snapshot.docs.map((row): ProspectEvent => {
        const data = row.data()
        return { id: row.id, prospectId: text(data.prospectId), from: (text(data.from) || null) as ProspectStatus | null, to: text(data.to) as ProspectStatus, at: text(data.at), by: text(data.by), byName: text(data.byName), note: text(data.note) || undefined }
    }).sort((a, b) => b.at.localeCompare(a.at))
}

/** The company's staff who can own a prospect. */
export const listProspectOwners = async (user: FullIdentity) => {
    const companyCode = companyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', companyCode)))
    return snapshot.docs.flatMap((row) => {
        const data = row.data()
        if (!STAFF_ROLES.has(String(data.role)) || data.status === 'deleted' || data.status === 'inactive' || data.active === false) return []
        return [{ uid: row.id, name: text(data.name) || text(data.displayName) || text(data.email) }]
    }).sort((a, b) => a.name.localeCompare(b.name))
}

const sameName = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, ' ') === b.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Records in the company that already hold this business: other prospects on the same side (archived ones too), its
 * participants (incubation) and its client companies (training). Matched on phone, email, registration number or name.
 */
export const findProspectDuplicates = async (user: FullIdentity, module: ProspectModule, values: Pick<ProspectValues, 'businessName' | 'contactName' | 'phone' | 'email' | 'registrationNumber'>, ignoreId?: string): Promise<ProspectDuplicate[]> => {
    const companyCode = companyOf(user)
    const keys = contactKeys(values)
    const name = text(values.businessName) || text(values.contactName)
    const match = (other: ContactKeys, otherName: string) => {
        const matched: ProspectDuplicate['matchedOn'] = sharedKeys(keys, other)
        if (name && otherName && sameName(name, otherName)) matched.push('name')
        return matched
    }
    const db = getFirebaseDb()
    const found: ProspectDuplicate[] = []

    const prospects = await getDocs(query(collection(db, PROSPECTS), where('companyCode', '==', companyCode), where('module', '==', module)))
    for (const row of prospects.docs) {
        if (row.id === ignoreId) continue
        const prospect = toProspect(row.id, row.data())
        const matchedOn = match(prospect.keys, prospectName(prospect))
        if (matchedOn.length) found.push({ kind: 'prospect', id: prospect.id, name: prospectName(prospect), matchedOn, status: prospect.status, archived: Boolean(prospect.archivedAt) })
    }

    for (const record of await listKnownRecords(user, module)) {
        const matchedOn = match(record.keys, record.name)
        if (matchedOn.length) found.push({ kind: record.kind, id: record.id, name: record.name, matchedOn })
    }
    return found
}

export type KnownRecord = { kind: 'participant' | 'client', id: string, name: string, keys: ContactKeys }

/** The businesses the company already works with: its participants (incubation) or client companies (training). */
export const listKnownRecords = async (user: FullIdentity, module: ProspectModule): Promise<KnownRecord[]> => {
    const companyCode = companyOf(user)
    if (module === 'incubation') {
        const participants = await getDocs(query(collection(getFirebaseDb(), 'participants'), where('companyCode', '==', companyCode))).catch(() => null)
        return (participants?.docs || []).map((row) => {
            const data = row.data()
            const name = text(data.beneficiaryName) || text(data.businessName) || text(data.participantName) || text(data.email)
            return { kind: 'participant' as const, id: row.id, name, keys: contactKeys({ phone: data.phone, email: data.email, registrationNumber: data.registrationNumber }) }
        })
    }
    const organisations = await listTrainingOrganisations(user).catch(() => [])
    return organisations.map((organisation) => ({
        kind: 'client' as const, id: organisation.id, name: organisation.name,
        keys: contactKeys({ phone: organisation.phone, email: organisation.contactEmail, registrationNumber: organisation.details?.registrationNumber }),
    }))
}

/** Same business name, ignoring case and spacing. */
export const sameBusinessName = (a: string, b: string) => Boolean(a.trim()) && sameName(a, b)

// Incubation prospects are always businesses (allowsPeople); training also takes individuals.
const cleanValues = (values: ProspectValues, module: ProspectModule) => {
    const person = values.kind === 'person' && allowsPeople(module)
    return {
        kind: person ? 'person' : 'business',
        businessName: person ? '' : text(values.businessName),
        contactName: text(values.contactName),
        phone: text(values.phone),
        email: text(values.email).toLowerCase(),
        registrationNumber: text(values.registrationNumber),
        sector: text(values.sector),
        province: text(values.province),
        ownership: Array.from(new Set(values.ownership || [])),
        source: values.source,
        sourceDetail: text(values.sourceDetail),
        notes: text(values.notes).slice(0, 4000),
        nextFollowUpAt: text(values.nextFollowUpAt) || null,
        keys: contactKeys(values),
    }
}

const eventDoc = (user: FullIdentity, companyCode: string, prospectId: string, module: ProspectModule, from: ProspectStatus | null, to: ProspectStatus, at: string, note?: string) => ({
    companyCode, prospectId, module, from, to, at, by: user.uid, byName: nameOf(user), ...(note ? { note } : {}),
})

type Lookups = { programs: Array<{ id: string, name: string }>, owners: Array<{ uid: string, name: string }> }

/** Adds a prospect (consent is required) or saves changes to one. Returns its id. */
export const saveProspect = async (user: FullIdentity, module: ProspectModule, values: ProspectValues, lookups: Lookups, existing?: Prospect) => {
    const companyCode = companyOf(user)
    if (values.kind === 'person' && allowsPeople(module) ? !text(values.contactName) : !text(values.businessName)) throw new Error('name_required')
    if (!existing && !values.consentGiven) throw new Error('consent_required')
    const db = getFirebaseDb()
    const at = now()
    const program = module === 'incubation' ? lookups.programs.find((row) => row.id === values.programId) : undefined
    const owner = lookups.owners.find((row) => row.uid === values.ownerUid)
    const fit = module === 'incubation'
        ? { programId: program?.id || null, programName: program?.name || null }
        : { interest: text(values.interest) || null }
    const consent = {
        given: existing ? existing.consent.given || values.consentGiven : true,
        source: values.consentSource,
        contactAllowed: values.contactAllowed === true,
        at: existing?.consent.at && existing.consent.source === values.consentSource && existing.consent.contactAllowed === values.contactAllowed ? existing.consent.at : at,
        recordedBy: existing?.consent.recordedBy && existing.consent.source === values.consentSource && existing.consent.contactAllowed === values.contactAllowed ? existing.consent.recordedBy : user.uid,
        ...(text(values.consentNote) ? { note: text(values.consentNote) } : {}),
    }
    const fields = { ...cleanValues(values, module), ...fit, ownerUid: owner?.uid || null, ownerName: owner?.name || null, consent, updatedAt: at, updatedBy: user.uid }

    const batch = writeBatch(db)
    if (existing) {
        batch.update(doc(db, PROSPECTS, existing.id), fields)
        await batch.commit()
        return existing.id
    }
    const ref = doc(collection(db, PROSPECTS))
    batch.set(ref, { ...fields, companyCode, module, status: 'new', statusChangedAt: at, createdAt: at, createdBy: user.uid })
    batch.set(doc(collection(db, EVENTS)), eventDoc(user, companyCode, ref.id, module, null, 'new', at))
    await batch.commit()
    return ref.id
}

/** Moves a prospect along its pipeline and records the move (who, when, from where to where). */
export const setProspectStatus = async (user: FullIdentity, prospect: Prospect, to: ProspectStatus, note?: string) => {
    const companyCode = companyOf(user)
    if (prospect.status === to) return
    const db = getFirebaseDb()
    const at = now()
    const converted = to === CONVERTED_STATUS[prospect.module]
    const batch = writeBatch(db)
    batch.update(doc(db, PROSPECTS, prospect.id), {
        status: to, statusChangedAt: at, updatedAt: at, updatedBy: user.uid,
        closedReason: isClosedStatus(to) ? text(note) || null : null,
        // Moving a prospect on means the follow-up happened: whoever follows up next sets a new date.
        nextFollowUpAt: null,
        ...(converted && !prospect.convertedAt ? { convertedAt: at } : {}),
    })
    batch.set(doc(collection(db, EVENTS)), eventDoc(user, companyCode, prospect.id, prospect.module, prospect.status, to, at, text(note) || undefined))
    await batch.commit()
}

/** Hides a prospect (or brings it back). Nothing is deleted. */
export const setProspectArchived = async (user: FullIdentity, prospect: Prospect, archived: boolean) => {
    companyOf(user)
    const db = getFirebaseDb()
    const at = now()
    const batch = writeBatch(db)
    batch.update(doc(db, PROSPECTS, prospect.id), archived
        ? { archivedAt: at, archivedBy: user.uid, updatedAt: at, updatedBy: user.uid }
        : { archivedAt: null, archivedBy: null, updatedAt: at, updatedBy: user.uid })
    await batch.commit()
}

/** Several prospects to one person who follows up. */
export const assignProspects = async (user: FullIdentity, prospects: Prospect[], owner: { uid: string, name: string } | null) => {
    companyOf(user)
    const db = getFirebaseDb()
    const at = now()
    for (let index = 0; index < prospects.length; index += 400) {
        const batch = writeBatch(db)
        for (const prospect of prospects.slice(index, index + 400)) {
            batch.update(doc(db, PROSPECTS, prospect.id), { ownerUid: owner?.uid || null, ownerName: owner?.name || null, updatedAt: at, updatedBy: user.uid })
        }
        await batch.commit()
    }
}

export type ImportRow = Omit<ProspectValues, 'consentGiven' | 'consentSource' | 'contactAllowed' | 'consentNote'>

/** Adds many prospects at once (an imported register or a training class), all with the consent given for the list. */
export const importProspects = async (user: FullIdentity, module: ProspectModule, rows: ImportRow[], consent: { source: ConsentSource, contactAllowed: boolean, note?: string }) => {
    const companyCode = companyOf(user)
    const db = getFirebaseDb()
    const at = now()
    let added = 0
    for (let index = 0; index < rows.length; index += 200) {
        const batch = writeBatch(db)
        for (const row of rows.slice(index, index + 200)) {
            const values: ProspectValues = { ...row, consentGiven: true, consentSource: consent.source, contactAllowed: consent.contactAllowed, consentNote: consent.note }
            if (values.kind === 'person' && allowsPeople(module) ? !text(values.contactName) : !text(values.businessName)) continue
            const ref = doc(collection(db, PROSPECTS))
            batch.set(ref, {
                ...cleanValues(values, module), programId: null, programName: null, interest: text(values.interest) || null,
                ownerUid: text(values.ownerUid) || null, ownerName: null,
                consent: { given: true, source: consent.source, contactAllowed: consent.contactAllowed, at, recordedBy: user.uid, ...(text(consent.note) ? { note: text(consent.note) } : {}) },
                companyCode, module, status: 'new', statusChangedAt: at, createdAt: at, createdBy: user.uid, updatedAt: at, updatedBy: user.uid,
            })
            batch.set(doc(collection(db, EVENTS)), eventDoc(user, companyCode, ref.id, module, null, 'new', at, values.sourceDetail ? `Imported: ${text(values.sourceDetail)}` : 'Imported'))
            added += 1
        }
        await batch.commit()
    }
    return added
}

const callable = <Input, Output>(name: string) => httpsCallable<Input, Output>(getFunctions(firebaseApp, 'us-central1'), name)

/** A personal invite link to a programme (incubation); emailed too when the prospect agreed to messages. */
export const inviteProspect = async (prospect: Prospect, programId: string, sendEmail: boolean) =>
    (await callable<{ prospectId: string, programId: string, sendEmail: boolean }, { link: string, emailed: boolean }>('sendProspectInvite')({ prospectId: prospect.id, programId, sendEmail })).data

/**
 * Funnel counts per source, worked out on the server. Staff get the whole company and the per-event view; a funder
 * gets only what is tied to what it funds.
 */
export const getProspectFunnel = async (module: ProspectModule, companyCode?: string): Promise<ProspectFunnelResult> => {
    const data = (await callable<{ module: ProspectModule, companyCode?: string }, Partial<ProspectFunnelResult>>('getProspectFunnel')({ module, ...(companyCode ? { companyCode } : {}) })).data
    return { rows: data.rows || [], byEvent: data.byEvent || [], scope: data.scope === 'funded' ? 'funded' : 'company' }
}

// ---- Sign-up links (an event's QR code or WhatsApp link) -------------------------------------------------------

const LINKS = 'prospectSignupLinks'

export const listSignupLinks = async (user: FullIdentity, module: ProspectModule): Promise<ProspectSignupLink[]> => {
    const companyCode = companyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), LINKS), where('companyCode', '==', companyCode), where('module', '==', module)))
    return snapshot.docs.map((row) => {
        const data = row.data()
        return {
            id: row.id, module, label: text(data.label), active: data.active === true,
            programId: text(data.programId) || undefined, programName: text(data.programName) || undefined,
            ownerUid: text(data.ownerUid) || undefined, ownerName: text(data.ownerName) || undefined,
            signups: Number(data.signups || 0), createdAt: text(data.createdAt),
        }
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export const createSignupLink = async (user: FullIdentity, module: ProspectModule, values: { label: string, programId?: string, programName?: string, ownerUid?: string, ownerName?: string }) => {
    const companyCode = companyOf(user)
    const db = getFirebaseDb()
    const ref = doc(collection(db, LINKS))
    const batch = writeBatch(db)
    batch.set(ref, {
        companyCode, module, label: text(values.label), active: true, source: 'event', signups: 0,
        programId: text(values.programId) || null, programName: text(values.programName) || null,
        ownerUid: text(values.ownerUid) || null, ownerName: text(values.ownerName) || null,
        createdAt: now(), createdBy: user.uid,
    })
    await batch.commit()
    return ref.id
}

export const setSignupLinkActive = async (user: FullIdentity, link: ProspectSignupLink, active: boolean) => {
    companyOf(user)
    const db = getFirebaseDb()
    const batch = writeBatch(db)
    batch.update(doc(db, LINKS, link.id), { active, updatedAt: now(), updatedBy: user.uid })
    await batch.commit()
}

export const signupLinkUrl = (id: string) => `${window.location.origin}/p/${encodeURIComponent(id)}`

// ---- Public sign-up form (no sign-in) ---------------------------------------------------------------------------

export type SignupInfo = { label: string, module: ProspectModule, companyName: string, logoUrl: string }

export const getSignupInfo = async (code: string) =>
    (await callable<{ code: string }, SignupInfo & { ok: boolean }>('getProspectSignupInfo')({ code })).data

export const submitSignup = async (input: Record<string, unknown>) =>
    (await callable<Record<string, unknown>, { ok: boolean, existing: boolean }>('submitProspectSignup')(input)).data

/**
 * Training: books a prospect's people into a class as learners (someone already in the class is skipped) and moves
 * the prospect to "Booked". The facilitator then invites them as with any learner.
 */
export const bookProspectIntoClass = async (
    user: FullIdentity,
    prospect: Prospect,
    trainingClass: { id: string, label: string },
    people: Array<{ name: string, email?: string, phone?: string }>,
) => {
    const companyCode = companyOf(user)
    if (prospect.module !== 'training') throw new Error('training_only')
    const organisation = prospect.kind === 'business' ? prospect.businessName : ''
    const { added, skipped } = await addTrainingLearners(user, trainingClass.id, people
        .filter((person) => text(person.name))
        .map((person) => ({ name: text(person.name), organisation, email: text(person.email).toLowerCase(), phone: text(person.phone) })))
    const db = getFirebaseDb()
    const at = now()
    const batch = writeBatch(db)
    const forward = isForwardMove('training', prospect.status, 'booked')
    batch.update(doc(db, PROSPECTS, prospect.id), {
        bookedClassId: trainingClass.id, bookedClassLabel: trainingClass.label, updatedAt: at, updatedBy: user.uid,
        ...(forward ? { status: 'booked', statusChangedAt: at, nextFollowUpAt: null, closedReason: null } : {}),
    })
    batch.set(doc(collection(db, EVENTS)), eventDoc(user, companyCode, prospect.id, 'training', prospect.status, forward ? 'booked' : prospect.status, at,
        `Booked into ${trainingClass.label} (${added} ${added === 1 ? 'person' : 'people'})`))
    await batch.commit()
    return { added, skipped }
}
