import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { canReceiveWhatsAppAlerts } from './whatsappConsent.js'
import { companyHasFeature } from './entitlements.js'
import type { AlertParts } from './alertMessages.js'

/*
 * The SME's own check-back on an intervention's outcome, next to the facilitator's (followUps.ts).
 *
 * The facilitator's answer stays the official result. The SME answers the same question from their side,
 * Yes / Partly / No, once per check-back round, independently (they never see the facilitator's answer first).
 * Stored on the assignment as `smeCheckback` (latest) and `smeCheckbackHistory` (every round), and asked about
 * in the app and on WhatsApp. The round logic is mirrored in the web app (src/services/smeCheckbackService.ts)
 * and enforced by firestore.rules for in-app answers.
 */

export type SmeCheckbackAnswer = 'yes' | 'partly' | 'no'
export const SME_CHECKBACK_ANSWERS: Record<SmeCheckbackAnswer, string> = { yes: 'Yes', partly: 'Partly', no: 'No' }
export const isSmeCheckbackAnswer = (value: unknown): value is SmeCheckbackAnswer => typeof value === 'string' && value in SME_CHECKBACK_ANSWERS

/** How long after the facilitator answers a round the SME can still answer that same round. */
export const SME_ANSWER_WINDOW_DAYS = 30
/** A second WhatsApp ask goes out this many days after the first, if the round is still unanswered. */
export const SME_REMINDER_DAYS = 7
const MAX_ASKS_PER_ROUND = 2
const DAY_MS = 86_400_000

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (typeof value === 'object' && 'toDate' in (value as object) && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const parsed = new Date(String(value))
  return Number.isNaN(+parsed) ? null : parsed
}

/**
 * The check-back round the SME can answer now, or null. Rounds count from 1, in step with the facilitator's
 * `followUpRound` (how many rounds the facilitator has answered). Two cases, oldest first:
 *  - the facilitator answered round R in the last 30 days and the SME hasn't answered R yet;
 *  - the next round (R + 1) is open: the follow-up is pending and its date has come.
 */
export const smeCheckbackRound = (data: Record<string, unknown>, now = new Date()): number | null => {
  const history = Array.isArray(data.outcomeHistory) ? data.outcomeHistory as Array<{ recordedAt?: unknown }> : []
  const facilitatorRounds = Math.max(Number(data.followUpRound || 0), history.length)
  const smeRound = Number((data.smeCheckback as { round?: unknown } | undefined)?.round || 0)
  if (facilitatorRounds > smeRound) {
    const answeredAt = toDate(history[facilitatorRounds - 1]?.recordedAt)
    if (answeredAt && now.getTime() - answeredAt.getTime() <= SME_ANSWER_WINDOW_DAYS * DAY_MS) return facilitatorRounds
  }
  const dueAt = toDate(data.followUpDueAt)
  if (normalize(data.followUpStatus) === 'pending' && dueAt && dueAt.getTime() <= now.getTime() && facilitatorRounds + 1 > smeRound) return facilitatorRounds + 1
  return null
}

export type SmeCheckbackItem = { id: string, round: number, title: string, intendedOutcome: string, deliverable: string, companyCode: string, participantId: string }

const itemFrom = (id: string, data: Record<string, unknown>, now: Date): SmeCheckbackItem | null => {
  const round = smeCheckbackRound(data, now)
  if (!round) return null
  const definition = (data.outcomeDefinition || {}) as Record<string, unknown>
  return {
    id,
    round,
    title: String(data.interventionTitle || 'Intervention'),
    intendedOutcome: String(definition.intendedOutcome || ''),
    deliverable: String(definition.deliverableName || ''),
    companyCode: String(data.companyCode || ''),
    participantId: String(data.participantId || ''),
  }
}

/** Check-backs the SME (any of these participant ids) can answer now. */
export async function listSmeCheckbacks(db: Firestore, participantIds: Iterable<string>, now = new Date()): Promise<SmeCheckbackItem[]> {
  const ids = [...new Set([...participantIds].filter(Boolean))]
  const snapshots = await Promise.all(ids.map(id => db.collection('assignedInterventions').where('participantId', '==', id).get()))
  return snapshots.flatMap(snapshot => snapshot.docs.map(row => itemFrom(row.id, row.data(), now)).filter((item): item is SmeCheckbackItem => !!item))
}

export type RecordSmeCheckbackInput = {
  assignmentId: string
  answer: SmeCheckbackAnswer
  /** The round the SME is answering (from the button they tapped); must still be the open one. */
  round: number
  via: 'whatsapp' | 'web'
  participantIds: Set<string>
}
export type RecordSmeCheckbackOutcome =
  | { ok: true, title: string, answer: SmeCheckbackAnswer, round: number }
  | { ok: false, reason: 'not_found' | 'not_allowed' | 'not_open' | 'already_answered' }

/** Writes the SME's answer for one round. A repeat tap, or a tap on an old message for a round that has passed, changes nothing. */
export async function recordSmeCheckback(db: Firestore, actor: { id: string, name?: unknown }, input: RecordSmeCheckbackInput, now = new Date()): Promise<RecordSmeCheckbackOutcome> {
  const ref = db.collection('assignedInterventions').doc(input.assignmentId)
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return { ok: false, reason: 'not_found' } as const
    const data = snapshot.data() as Record<string, unknown>
    if (!input.participantIds.has(String(data.participantId || ''))) return { ok: false, reason: 'not_allowed' } as const
    const answered = Number((data.smeCheckback as { round?: unknown } | undefined)?.round || 0)
    if (input.round <= answered) return { ok: false, reason: 'already_answered' } as const
    if (smeCheckbackRound(data, now) !== input.round) return { ok: false, reason: 'not_open' } as const
    const entry = {
      answer: input.answer,
      note: null,
      round: input.round,
      via: input.via,
      recordedAt: now.toISOString(),
      recordedBy: { uid: actor.id, name: String(actor.name || '') },
    }
    transaction.update(ref, {
      smeCheckback: entry,
      smeCheckbackHistory: FieldValue.arrayUnion(entry),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return { ok: true, title: String(data.interventionTitle || 'Intervention'), answer: input.answer, round: input.round } as const
  })
}

/** Adds the SME's optional note to the answer they just gave (same round, same person, within a day). */
export async function addSmeCheckbackNote(db: Firestore, actorId: string, input: { assignmentId: string, round: number, note: string }, now = new Date()) {
  const note = input.note.trim().slice(0, 500)
  if (!note) return false
  const ref = db.collection('assignedInterventions').doc(input.assignmentId)
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    const data = (snapshot.data() || {}) as Record<string, unknown>
    const latest = (data.smeCheckback || {}) as Record<string, unknown>
    const recordedBy = (latest.recordedBy || {}) as Record<string, unknown>
    const recordedAt = toDate(latest.recordedAt)
    if (Number(latest.round) !== input.round || String(recordedBy.uid || '') !== actorId || !recordedAt || now.getTime() - recordedAt.getTime() > DAY_MS) return false
    // arrayUnion can't edit an element, so the trail is rewritten with the note on this round's entry.
    const history = (Array.isArray(data.smeCheckbackHistory) ? data.smeCheckbackHistory : []) as Array<Record<string, unknown>>
    transaction.update(ref, {
      smeCheckback: { ...latest, note },
      smeCheckbackHistory: history.map(entry => (Number(entry.round) === input.round ? { ...entry, note } : entry)),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return true
  })
}

/** The quick-reply payloads for one round; the bot reads them back (whatsappBot.ts, structuredSmeCheckback). */
export const smeCheckbackPayload = (assignmentId: string, round: number, answer: SmeCheckbackAnswer) => `QTX|FU|${assignmentId}|${round}|${answer.toUpperCase()}`

export type SmeCheckbackAskDeps = {
  db: Firestore
  /** Sends the approved SME check-back template with Yes / Partly / No buttons; false when no template is configured. */
  sendCheckbackTemplate: (phone: string, input: { firstName: string, title: string, change: string, payloads: string[], dedupeKey: string }) => Promise<boolean>
  /** Fallback while no template is approved: the general alert template, asking them to reply "check-backs". */
  sendWhatsAppAlert: (phone: string, text: string, parts?: AlertParts) => Promise<boolean>
  now?: Date
  dryRun?: boolean
  companyCode?: string
}

export type SmeCheckbackAskResult = { eligible: number, asked: number, inApp: number, whatsapp: number, skipped: number, dryRun: boolean }

const whatsappNumbers = (user: Record<string, unknown>) => {
  const listed = Array.isArray(user.whatsappPhoneNumbers) ? user.whatsappPhoneNumbers.map(String) : []
  if (listed.length) return listed
  return user.phoneIsWhatsApp === true && user.phone ? [String(user.phone)] : []
}

/** The SME's user account: the participant doc's uid, or the account with the participant's email. */
async function smeUser(db: Firestore, participantId: string) {
  const participant = await db.collection('participants').doc(participantId).get()
  const data = (participant.data() || {}) as Record<string, unknown>
  const uid = String(data.uid || data.ownerUid || '')
  if (uid) {
    const user = await db.collection('users').doc(uid).get()
    if (user.exists) return { id: user.id, ...user.data() } as Record<string, unknown> & { id: string }
  }
  const direct = await db.collection('users').doc(participantId).get()
  if (direct.exists) return { id: direct.id, ...direct.data() } as Record<string, unknown> & { id: string }
  const email = normalize(data.email)
  if (!email) return null
  const byEmail = await db.collection('users').where('email', '==', email).limit(1).get()
  return byEmail.empty ? null : { id: byEmail.docs[0].id, ...byEmail.docs[0].data() } as Record<string, unknown> & { id: string }
}

/**
 * Daily: ask each SME with an open check-back round, in the app (a notification) and on WhatsApp. One ask when
 * the round opens, one reminder a week later, then nothing until the next round. `smeCheckbackAsk` remembers it.
 */
export async function runSmeCheckbackAsks(deps: SmeCheckbackAskDeps): Promise<SmeCheckbackAskResult> {
  const { db } = deps
  const now = deps.now || new Date()
  // Rounds open up to 30 days after the facilitator answers, and a "partially" moves the due date 30 days on.
  const cutoff = new Date(now.getTime() + (SME_ANSWER_WINDOW_DAYS + 1) * DAY_MS).toISOString()
  let query = db.collection('assignedInterventions').where('followUpDueAt', '<=', cutoff)
  if (deps.companyCode) query = query.where('companyCode', '==', deps.companyCode)
  const snapshot = await query.get()

  const result: SmeCheckbackAskResult = { eligible: 0, asked: 0, inApp: 0, whatsapp: 0, skipped: 0, dryRun: Boolean(deps.dryRun) }
  for (const row of snapshot.docs) {
    const data = row.data()
    if (data.participantDiscontinuedAt) continue
    const item = itemFrom(row.id, data, now)
    if (!item || !item.participantId) continue
    result.eligible += 1

    const ask = (data.smeCheckbackAsk || {}) as { round?: unknown, count?: unknown, lastAskedAt?: unknown }
    const sameRound = Number(ask.round || 0) === item.round
    const lastAskedAt = toDate(ask.lastAskedAt)
    const count = sameRound ? Number(ask.count || 0) : 0
    if (sameRound && (count >= MAX_ASKS_PER_ROUND || (lastAskedAt && now.getTime() - lastAskedAt.getTime() < SME_REMINDER_DAYS * DAY_MS))) {
      result.skipped += 1
      continue
    }
    if (deps.dryRun) continue

    const reminder = count > 0
    const notificationId = `sme_checkback_${row.id}_${item.round}_${count + 1}`
    await db.collection('notifications').doc(notificationId).set({
      companyCode: item.companyCode || null,
      participantId: item.participantId,
      assignedInterventionId: row.id,
      interventionId: data.interventionId || row.id,
      interventionTitle: item.title,
      type: 'sme_checkback',
      recipientRoles: ['incubatee'],
      message: { incubatee: `${reminder ? 'Reminder: ' : ''}has the change from "${item.title}" happened in your business? Let us know in a tap.` },
      link: '/incubatee/interventions',
      createdAt: FieldValue.serverTimestamp(),
      readBy: {},
    }, { merge: true })
    result.inApp += 1

    let whatsapp = 'not_sent'
    const user = await smeUser(db, item.participantId)
    const numbers = user ? whatsappNumbers(user) : []
    if (user && numbers.length && canReceiveWhatsAppAlerts(user) && await companyHasFeature(db, item.companyCode, 'whatsappComms')) {
      const firstName = String(user.displayName || user.name || '').trim().split(/\s+/)[0] || ''
      const change = item.intendedOutcome || 'the change it set out to make'
      try {
        const sent = await deps.sendCheckbackTemplate(numbers[0], {
          firstName,
          title: item.title,
          change,
          payloads: (['yes', 'partly', 'no'] as SmeCheckbackAnswer[]).map(answer => smeCheckbackPayload(row.id, item.round, answer)),
          dedupeKey: `${row.id}:${item.round}:${count + 1}`,
        })
        whatsapp = sent
          ? 'sent'
          : (await deps.sendWhatsAppAlert(numbers[0], `Has the change from "${item.title}" happened in your business? Reply "check-backs" to answer.`, {
            firstName,
            headline: reminder ? 'Reminder: a quick check-back' : 'A quick check-back',
            items: [{ title: item.title, sme: 'Reply “check-backs” to answer', overdue: false, when: 'today' }],
          })) ? 'sent_alert' : 'failed'
      } catch {
        whatsapp = 'failed'
      }
      if (whatsapp !== 'failed') result.whatsapp += 1
    }

    await row.ref.update({
      smeCheckbackAsk: { round: item.round, count: count + 1, lastAskedAt: now.toISOString(), whatsapp },
    })
    result.asked += 1
  }
  return result
}
