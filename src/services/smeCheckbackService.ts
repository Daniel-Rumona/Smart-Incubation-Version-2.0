import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FollowUpResult } from '@/services/interventionOutcomeConfig'

/*
 * The SME's own check-back on an intervention's outcome: Yes / Partly / No, once per check-back round, next to the
 * facilitator's result (which stays the official one). Mirrors functions/src/smeCheckbacks.ts, which asks SMEs and
 * records WhatsApp answers; firestore.rules enforces the same round rules for answers given here.
 */

export type SmeCheckbackAnswer = 'yes' | 'partly' | 'no'

export const SME_CHECKBACK_ANSWERS: Array<{ value: SmeCheckbackAnswer, label: string }> = [
    { value: 'yes', label: 'Yes' },
    { value: 'partly', label: 'Partly' },
    { value: 'no', label: 'No' },
]

/** The facilitator result each SME answer corresponds to, for agreement. */
export const SME_ANSWER_MATCHES: Record<SmeCheckbackAnswer, FollowUpResult> = { yes: 'achieved', partly: 'partially', no: 'not_yet' }

export type SmeCheckbackEntry = {
    answer: SmeCheckbackAnswer
    note: string | null
    round: number
    via: 'web' | 'whatsapp'
    recordedAt: string
    recordedBy: { uid: string, name: string }
}

/** How long after the facilitator answers a round the SME can still answer that same round. */
const SME_ANSWER_WINDOW_DAYS = 30
const DAY_MS = 86_400_000

const toDate = (value: unknown): Date | null => {
    if (!value) return null
    if (typeof value === 'object' && 'toDate' in (value as object) && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
    const parsed = new Date(String(value))
    return Number.isNaN(+parsed) ? null : parsed
}

const isAnswer = (value: unknown): value is SmeCheckbackAnswer => value === 'yes' || value === 'partly' || value === 'no'

/** Every SME answer on an assignment, oldest round first. */
export const smeCheckbackHistory = (raw: Record<string, unknown>): SmeCheckbackEntry[] =>
    (Array.isArray(raw.smeCheckbackHistory) ? raw.smeCheckbackHistory as Array<Record<string, unknown>> : [])
        .filter((entry) => isAnswer(entry?.answer) && Number(entry?.round) > 0)
        .map((entry) => entry as unknown as SmeCheckbackEntry)
        .sort((left, right) => left.round - right.round)

/** The SME's answer for one round, if they gave one. */
export const smeAnswerForRound = (raw: Record<string, unknown>, round: number) => smeCheckbackHistory(raw).find((entry) => entry.round === round)

/**
 * The check-back round the SME can answer now, or null (same rules as smeCheckbackRound in functions/src/smeCheckbacks.ts):
 * the round the facilitator answered in the last 30 days if the SME hasn't, otherwise the next round once it's due.
 */
export const smeCheckbackRound = (raw: Record<string, unknown>, now = new Date()): number | null => {
    const history = Array.isArray(raw.outcomeHistory) ? raw.outcomeHistory as Array<{ recordedAt?: unknown }> : []
    const facilitatorRounds = Math.max(Number(raw.followUpRound || 0), history.length)
    const smeRound = Number((raw.smeCheckback as { round?: unknown } | undefined)?.round || 0)
    if (facilitatorRounds > smeRound) {
        const answeredAt = toDate(history[facilitatorRounds - 1]?.recordedAt)
        if (answeredAt && now.getTime() - answeredAt.getTime() <= SME_ANSWER_WINDOW_DAYS * DAY_MS) return facilitatorRounds
    }
    const dueAt = toDate(raw.followUpDueAt)
    const pending = String(raw.followUpStatus || '').trim().toLowerCase() === 'pending'
    if (pending && dueAt && dueAt.getTime() <= now.getTime() && facilitatorRounds + 1 > smeRound) return facilitatorRounds + 1
    return null
}

/** Records the SME's answer from the app. The rules only accept the round that is open, once. */
export const recordSmeCheckback = async (
    assignmentId: string,
    input: { answer: SmeCheckbackAnswer, round: number, note?: string },
    actor: { uid: string, name?: string },
) => {
    const entry: SmeCheckbackEntry = {
        answer: input.answer,
        note: String(input.note || '').trim().slice(0, 500) || null,
        round: input.round,
        via: 'web',
        recordedAt: new Date().toISOString(),
        recordedBy: { uid: actor.uid, name: actor.name || '' },
    }
    await updateDoc(doc(getFirebaseDb(), 'assignedInterventions', assignmentId), {
        smeCheckback: entry,
        smeCheckbackHistory: arrayUnion(entry),
        updatedAt: serverTimestamp(),
    })
    return entry
}
