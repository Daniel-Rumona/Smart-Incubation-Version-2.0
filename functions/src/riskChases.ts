import { createHash } from 'node:crypto'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { canReceiveWhatsAppAlerts } from './whatsappConsent.js'
import { companyHasFeature } from './entitlements.js'
import { smeUser, whatsappNumbers } from './smeCheckbacks.js'
import type { AlertParts } from './alertMessages.js'

/*
 * Chasing an SME from the risk register (src/pages/operations/RiskRegisterPage.tsx). Staff press one button; the SME
 * gets an in-app notification and, where they can receive it, a WhatsApp message. The chase is kept on the SME's
 * risk review (riskReviews/{companyCode}_{smeKey}, field `chases`) so the register can show it in the SME's log and
 * follow it: the WhatsApp status (sent, delivered, read, failed) is copied in by processWhatsAppMessageStatusEvent,
 * and a delivery Yes / No tap by recordDeliveryReply. Signing the plan or sending figures shows up on its own, as the
 * problem leaves the register.
 */

export type ChaseKind = 'sign_plan' | 'confirm_delivery' | 'monthly_figures'
export const CHASE_KINDS: ChaseKind[] = ['sign_plan', 'confirm_delivery', 'monthly_figures']
const STAFF_ROLES = ['systemadmin', 'projectadmin', 'projectmanager', 'operations']

export type DeliveryAnswer = 'yes' | 'no'

/** A delivery Yes / No tap on the chase template: QTX|CD|<assignmentId>|<chaseId>|<YES|NO>. */
export const deliveryReplyPayload = (assignmentId: string, chaseId: string, answer: DeliveryAnswer) => `QTX|CD|${assignmentId}|${chaseId}|${answer.toUpperCase()}`
export const parseDeliveryReply = (input: string) => {
    const match = /^QTX\|CD\|([^|]+)\|([^|]+)\|(YES|NO)$/i.exec(input.trim())
    return match ? { assignmentId: match[1], chaseId: match[2], answer: match[3].toLowerCase() as DeliveryAnswer } : null
}

/** Same id as the web app's riskReviewService.reviewId. */
export const riskReviewId = (companyCode: string, smeKey: string) => `${companyCode}_${smeKey.replace(/[^A-Za-z0-9_-]+/g, '-')}`

/** The outbound message id sendRiskChaseWhatsApp's first send gets, so the chase can follow its status. */
export const chaseOutboundMessageId = (chaseId: string) => createHash('sha256').update(`riskchase:${chaseId}:0`).digest('hex')

export class ChaseError extends Error {
    constructor(readonly code: 'unauthenticated' | 'permission-denied' | 'invalid-argument' | 'not-found' | 'failed-precondition', message: string) {
        super(message)
    }
}

export type ChaseDeps = {
    appUrl: string
    /** Sends the general alert template (or text inside the 24-hour window). */
    sendAlert: (phone: string, chaseId: string, text: string, parts: AlertParts) => Promise<void>
    /** Sends the delivery Yes / No template; false when none is configured. */
    sendDeliveryTemplate: (phone: string, chaseId: string, input: { firstName: string, title: string, payloads: string[] }) => Promise<boolean>
}

const text = (value: unknown) => String(value ?? '').trim()

async function belongsToCompany(db: Firestore, participantId: string, participant: Record<string, unknown>, companyCode: string) {
    if (text(participant.companyCode) === companyCode) return true
    const [applications, assignments] = await Promise.all([
        db.collection('applications').where('participantId', '==', participantId).where('companyCode', '==', companyCode).limit(1).get(),
        db.collection('assignedInterventions').where('participantId', '==', participantId).where('companyCode', '==', companyCode).limit(1).get(),
    ])
    return !applications.empty || !assignments.empty
}

export async function chaseSme(db: Firestore, callerUid: string | undefined, input: Record<string, unknown>, deps: ChaseDeps) {
    if (!callerUid) throw new ChaseError('unauthenticated', 'Sign in to chase an SME.')
    const caller = (await db.collection('users').doc(callerUid).get()).data() || {}
    const companyCode = text(caller.companyCode)
    if (!STAFF_ROLES.includes(text(caller.role)) || !companyCode) throw new ChaseError('permission-denied', 'Only operations staff can chase an SME.')

    const participantId = text(input.participantId)
    const kind = text(input.kind) as ChaseKind
    const assignmentId = text(input.assignmentId)
    if (!participantId || !CHASE_KINDS.includes(kind)) throw new ChaseError('invalid-argument', 'Say which SME and what to ask.')
    if (kind !== 'monthly_figures' && !assignmentId) throw new ChaseError('invalid-argument', 'Say which intervention this is about.')

    const participantSnap = await db.collection('participants').doc(participantId).get()
    if (!participantSnap.exists) throw new ChaseError('not-found', 'That SME was not found.')
    const participant = participantSnap.data() || {}
    if (!await belongsToCompany(db, participantId, participant, companyCode)) throw new ChaseError('permission-denied', 'That SME is not in your company.')

    let title = ''
    if (assignmentId) {
        const assignment = (await db.collection('assignedInterventions').doc(assignmentId).get()).data()
        if (!assignment || text(assignment.companyCode) !== companyCode || text(assignment.participantId || assignment.smmeId || assignment.smeId) !== participantId) {
            throw new ChaseError('not-found', 'That intervention was not found for this SME.')
        }
        title = text(assignment.interventionTitle || assignment.title) || 'your intervention'
    }

    const smeName = text(participant.businessName || participant.participantName) || 'Unnamed SME'
    const user = await smeUser(db, participantId)
    const firstName = text(user?.displayName || user?.name || participant.participantName).split(/\s+/)[0] || ''
    const numbers = user ? whatsappNumbers(user) : []
    const phone = text(numbers[0] || user?.phone || participant.phone || participant.contactNumber) || null
    const chaseRef = db.collection('riskReviews').doc(riskReviewId(companyCode, participantId))
    const chaseId = db.collection('_ids').doc().id
    const now = new Date()

    const copy: Record<ChaseKind, { notice: string, link: string, headline: string, item: string }> = {
        sign_plan: {
            notice: `Please sign your support plan so "${title}" can start.`,
            link: '/incubatee/diagnostic-plan',
            headline: 'Your plan is waiting for your signature',
            item: `${title} can start once you sign`,
        },
        confirm_delivery: {
            notice: `Was "${title}" delivered? Please confirm it in the app.`,
            link: '/incubatee/interventions',
            headline: 'Was this delivered?',
            item: `${title}: please confirm`,
        },
        monthly_figures: {
            notice: 'Please send your monthly figures (revenue and jobs).',
            link: '/incubatee/metrics',
            headline: 'Your monthly figures are due',
            item: 'Revenue and jobs for this month',
        },
    }
    const words = copy[kind]

    // Always in the app; WhatsApp where the SME has a number, has agreed to it, and the company has WhatsApp.
    if (user) {
        await db.collection('notifications').doc(`risk_chase_${chaseId}`).set({
            companyCode,
            participantId,
            ...(assignmentId ? { assignedInterventionId: assignmentId } : {}),
            type: 'risk_chase',
            recipientRoles: ['incubatee'],
            recipientUid: user.id,
            message: { incubatee: words.notice },
            link: words.link,
            createdAt: FieldValue.serverTimestamp(),
            readBy: {},
        })
    }

    let channel: 'whatsapp' | 'in_app' | 'whatsapp_failed' | 'none' = user ? 'in_app' : 'none'
    if (user && numbers.length && canReceiveWhatsAppAlerts(user) && await companyHasFeature(db, companyCode, 'whatsappComms')) {
        try {
            const sentTemplate = kind === 'confirm_delivery' && await deps.sendDeliveryTemplate(numbers[0], chaseId, {
                firstName,
                title,
                payloads: (['yes', 'no'] as DeliveryAnswer[]).map(answer => deliveryReplyPayload(assignmentId, chaseId, answer)),
            })
            if (!sentTemplate) {
                await deps.sendAlert(numbers[0], chaseId, `Hi ${firstName || 'there'}. ${words.notice} ${deps.appUrl}${words.link}`, {
                    firstName,
                    headline: words.headline,
                    items: [{ title: words.item, sme: smeName, overdue: false, when: 'today' }],
                })
            }
            channel = 'whatsapp'
        } catch (error) {
            console.warn('[RISK CHASE] WhatsApp send failed', { chaseId, error: error instanceof Error ? error.message : String(error) })
            channel = 'whatsapp_failed'
        }
    }

    const existing = await chaseRef.get()
    const outboundMessageId = channel === 'whatsapp' ? chaseOutboundMessageId(chaseId) : null
    await chaseRef.set({
        companyCode,
        smeKey: participantId,
        smeName,
        // A review created by a chase starts like one the register creates.
        ...(existing.exists ? {} : { firstSeenAt: now.toISOString(), status: 'open', notes: [] }),
        chases: {
            [chaseId]: {
                id: chaseId,
                kind,
                assignmentId: assignmentId || null,
                title: title || null,
                at: now.toISOString(),
                byUid: callerUid,
                byName: text(caller.displayName || caller.name || caller.email) || 'Staff',
                channel,
                phone,
                outboundMessageId,
                whatsappStatus: channel === 'whatsapp' ? 'accepted' : null,
                reply: null,
            },
        },
        updatedAt: now.toISOString(),
    }, { merge: true })

    // Let status updates find the chase. A status that arrived before this tag is copied across here.
    if (outboundMessageId) {
        const outboundRef = db.collection('whatsappOutboundMessages').doc(outboundMessageId)
        await outboundRef.set({ riskChase: { reviewId: chaseRef.id, chaseId } }, { merge: true })
        const status = text((await outboundRef.get()).data()?.status)
        if (status && status !== 'accepted') await chaseRef.set({ chases: { [chaseId]: { whatsappStatus: status } } }, { merge: true })
    }

    return { chaseId, channel, phone }
}

/**
 * The SME tapped Yes or No on "Was this delivered?". Yes is kept as their answer (they still confirm and rate it
 * in the app, which completes the intervention); No is recorded as not delivered, as the app's own "No" does.
 */
export async function recordDeliveryReply(db: Firestore, participantIds: string[], reply: { assignmentId: string, chaseId: string, answer: DeliveryAnswer }) {
    const ref = db.collection('assignedInterventions').doc(reply.assignmentId)
    const assignment = (await ref.get()).data()
    const participantId = text(assignment?.participantId || assignment?.smmeId || assignment?.smeId)
    if (!assignment || !participantIds.includes(participantId)) return { ok: false as const, reason: 'not_yours' as const }
    const title = text(assignment.interventionTitle || assignment.title) || 'your intervention'
    const companyCode = text(assignment.companyCode)
    const at = new Date().toISOString()

    if (reply.answer === 'no' && text(assignment.participantCompletionStatus) !== 'confirmed') {
        await ref.update({
            participantCompletionStatus: 'rejected',
            completionStatus: 'rejected',
            completionRejectionReason: 'Not delivered yet (answered on WhatsApp)',
            updatedAt: FieldValue.serverTimestamp(),
        })
    }
    if (companyCode) {
        await db.collection('riskReviews').doc(riskReviewId(companyCode, participantId)).set({
            chases: { [reply.chaseId]: { reply: { answer: reply.answer, at, via: 'whatsapp' } } },
        }, { merge: true })
    }
    return { ok: true as const, title }
}
