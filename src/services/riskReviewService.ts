import { arrayUnion, collection, doc, getDoc, getDocs, query, setDoc, where, writeBatch } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

/*
 * What the team is doing about each SME on the risk register (RiskRegisterPage.tsx). One document per SME
 * per company in riskReviews/{companyCode}_{smeKey}. The problems themselves are still worked out from the
 * live data on every load; this only keeps the human side: when the SME first showed up, its status, the
 * review date and the notes. Operations-side staff write; the company's director reads.
 */

const COLLECTION = 'riskReviews'

export type RiskReviewStatus = 'open' | 'in_hand' | 'waiting'

/** One line in an SME's log. `status` and `reviewOn` are there only when that update changed them. */
export type RiskReviewNote = { text: string, byUid: string, byName: string, at: string, status?: RiskReviewStatus, reviewOn?: string | null }

export type RiskChaseKind = 'sign_plan' | 'confirm_delivery' | 'monthly_figures'

/**
 * A reminder staff sent the SME from the register (functions/src/riskChases.ts). Written by the function only;
 * `whatsappStatus` follows Meta's status updates and `reply` is set when the SME taps Yes or No.
 */
export type RiskChase = {
    id: string
    kind: RiskChaseKind
    assignmentId?: string | null
    title?: string | null
    at: string
    byUid: string
    byName: string
    /** whatsapp: sent on WhatsApp (and in the app); in_app: no usable WhatsApp; none: the SME has no account. */
    channel: 'whatsapp' | 'in_app' | 'whatsapp_failed' | 'none'
    /** The SME's number, for calling when there's no reply. */
    phone?: string | null
    whatsappStatus?: 'accepted' | 'sent' | 'delivered' | 'read' | 'failed' | null
    reply?: { answer: 'yes' | 'no', at: string, via: string } | null
}

export type RiskReview = {
    id: string
    companyCode: string
    /** The participant id, or `name:<sme name>` for an intervention whose SME has no participant record. */
    smeKey: string
    smeName: string
    /** When the SME last came onto the register. Reset when it comes back after dropping off. */
    firstSeenAt: string
    /** Set when the SME dropped off the register; cleared when it comes back. */
    clearedAt?: string | null
    status: RiskReviewStatus
    /** The SME's severity when the status was last set, so the page can tell when things got worse since. */
    severityAtStatus?: string | null
    /** ISO date (YYYY-MM-DD) to look at it again. */
    reviewOn?: string | null
    notes?: RiskReviewNote[]
    /** Reminders sent to the SME, by id. */
    chases?: Record<string, RiskChase>
    updatedAt?: string
    updatedByUid?: string
}

const reviewId = (companyCode: string, smeKey: string) => `${companyCode}_${smeKey.replace(/[^A-Za-z0-9_-]+/g, '-')}`

/** A review for an SME that has none stored yet (the page saves it on first use). */
export const newRiskReview = (companyCode: string, smeKey: string, smeName: string): RiskReview => ({
    id: reviewId(companyCode, smeKey), companyCode, smeKey, smeName, firstSeenAt: new Date().toISOString(), status: 'open', notes: [],
})

export const listRiskReviews = async (user: FullIdentity): Promise<Map<string, RiskReview>> => {
    if (!user.companyCode) return new Map()
    const snapshot = await getDocs(query(collection(getFirebaseDb(), COLLECTION), where('companyCode', '==', user.companyCode)))
    return new Map(snapshot.docs.map(row => {
        const data = row.data() as Omit<RiskReview, 'id'>
        return [data.smeKey, { ...data, id: row.id }]
    }))
}

/**
 * Brings the stored reviews in line with who is on the register now: SMEs new to it get a review dated today,
 * SMEs that came back after dropping off start again as open, and (when `clearMissing`) SMEs in view that
 * are no longer at risk are marked as cleared. Returns the reviews as they now stand.
 */
export const syncRiskReviews = async (
    user: FullIdentity,
    existing: Map<string, RiskReview>,
    atRisk: Array<{ smeKey: string, smeName: string }>,
    inView: Set<string>,
    clearMissing: boolean,
): Promise<Map<string, RiskReview>> => {
    const companyCode = user.companyCode
    if (!companyCode) return existing
    const now = new Date().toISOString()
    const next = new Map(existing)
    const writes: Array<{ id: string, data: Partial<RiskReview> }> = []
    const atRiskKeys = new Set(atRisk.map(entry => entry.smeKey))

    atRisk.forEach(({ smeKey, smeName }) => {
        const current = existing.get(smeKey)
        if (current && !current.clearedAt) return
        const data: Omit<RiskReview, 'id'> = {
            companyCode, smeKey, smeName, firstSeenAt: now, clearedAt: null, status: 'open', severityAtStatus: null, reviewOn: null,
            notes: current?.notes || [], updatedAt: now, updatedByUid: user.uid,
        }
        const id = current?.id || reviewId(companyCode, smeKey)
        writes.push({ id, data })
        next.set(smeKey, { ...data, id })
    })

    if (clearMissing) {
        existing.forEach((review, smeKey) => {
            if (review.clearedAt || atRiskKeys.has(smeKey) || !inView.has(smeKey)) return
            writes.push({ id: review.id, data: { clearedAt: now, updatedAt: now } })
            next.set(smeKey, { ...review, clearedAt: now })
        })
    }

    for (let start = 0; start < writes.length; start += 400) {
        const batch = writeBatch(getFirebaseDb())
        writes.slice(start, start + 400).forEach(({ id, data }) => batch.set(doc(getFirebaseDb(), COLLECTION, id), data, { merge: true }))
        await batch.commit()
    }
    return next
}

/**
 * Sets the status and review date and adds one line to the SME's log: the note, plus the new status or review
 * date when either changed, so the log reads as the full story of what was done.
 */
export const saveRiskReview = async (
    user: FullIdentity,
    review: RiskReview,
    change: { status: RiskReviewStatus, reviewOn: string | null, note: string, severity: string },
): Promise<RiskReview> => {
    const now = new Date().toISOString()
    const text = change.note.trim()
    const statusChanged = change.status !== review.status
    const reviewOnChanged = (change.reviewOn || null) !== (review.reviewOn || null)
    // Only set keys go in: Firestore rejects undefined inside arrayUnion.
    const note: RiskReviewNote | null = text || statusChanged || reviewOnChanged
        ? {
            text,
            byUid: user.uid,
            byName: String(user.name || user.email || 'Staff'),
            at: now,
            ...(statusChanged ? { status: change.status } : {}),
            ...(reviewOnChanged ? { reviewOn: change.reviewOn } : {}),
        }
        : null
    await setDoc(doc(getFirebaseDb(), COLLECTION, review.id), {
        companyCode: review.companyCode,
        smeKey: review.smeKey,
        smeName: review.smeName,
        firstSeenAt: review.firstSeenAt,
        clearedAt: null,
        status: change.status,
        severityAtStatus: change.severity,
        reviewOn: change.reviewOn,
        updatedAt: now,
        updatedByUid: user.uid,
        ...(note ? { notes: arrayUnion(note) } : {}),
    }, { merge: true })
    return {
        ...review,
        clearedAt: null,
        status: change.status,
        severityAtStatus: change.severity,
        reviewOn: change.reviewOn,
        updatedAt: now,
        updatedByUid: user.uid,
        notes: note ? [...(review.notes || []), note] : review.notes,
    }
}

/**
 * Sends the SME a reminder in the app and, where they can get it, on WhatsApp (chaseSmeFromRiskRegister), then
 * returns the review as it now stands so the new chase shows straight away.
 */
export const chaseSme = async (input: { participantId: string, kind: RiskChaseKind, assignmentId?: string }, reviewDocId: string) => {
    const call = httpsCallable<typeof input, { chaseId: string, channel: RiskChase['channel'], phone: string | null }>(getFunctions(firebaseApp, 'us-central1'), 'chaseSmeFromRiskRegister')
    const result = (await call(input)).data
    const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTION, reviewDocId))
    const review = snapshot.exists() ? { ...(snapshot.data() as Omit<RiskReview, 'id'>), id: snapshot.id } : null
    return { ...result, review }
}

/** The review document id for an SME (matches functions/src/riskChases.ts riskReviewId). */
export const riskReviewDocId = (companyCode: string, smeKey: string) => reviewId(companyCode, smeKey)
