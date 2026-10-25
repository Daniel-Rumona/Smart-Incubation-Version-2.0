import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { canReceiveWhatsAppAlerts } from './whatsappConsent.js'
import { companyHasFeature } from './entitlements.js'
import { alertPlainText, shortDate, type AlertParts } from './alertMessages.js'

/*
 * Follow-up outcome checks for completed interventions.
 *
 * When completion is confirmed, an intervention that defines `outcomeDefinition.followUpDays` gets
 * `followUpDueAt` (ISO string) and `followUpStatus: 'pending'`. A facilitator later records whether the
 * intended change happened: achieved / partially / not yet. That is facilitator observation, never
 * system-observed evidence. The same rules are mirrored in the web app (src/services/interventionOutcomeConfig.ts).
 */

export type FollowUpResult = 'achieved' | 'partially' | 'not_yet'
export const FOLLOW_UP_RESULTS: Record<FollowUpResult, string> = { achieved: 'Achieved', partially: 'Partially', not_yet: 'Not yet' }
export const isFollowUpResult = (value: unknown): value is FollowUpResult => typeof value === 'string' && value in FOLLOW_UP_RESULTS

/** Days until the next check when the outcome is not yet fully achieved. */
export const RECHECK_DAYS = 30
export const DUE_SOON_DAYS = 14

const DAY_MS = 86_400_000
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
const OPERATIONS_SIDE_ROLES = ['operations', 'projectadmin', 'projectmanager', 'admin', 'systemadmin']

export type FollowUpActor = { id: string, role?: unknown, name?: unknown, email?: unknown, companyCode?: unknown }

export type FollowUpItem = {
  id: string
  title: string
  sme: string
  deliverable: string
  intendedOutcome: string
  dueAt: Date
  overdue: boolean
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (typeof value === 'object' && 'toDate' in (value as object) && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const parsed = new Date(String(value))
  return Number.isNaN(+parsed) ? null : parsed
}

const itemFrom = (id: string, data: Record<string, unknown>, now: Date): FollowUpItem | null => {
  if (normalize(data.followUpStatus) !== 'pending') return null
  const dueAt = toDate(data.followUpDueAt)
  if (!dueAt) return null
  const definition = (data.outcomeDefinition || {}) as Record<string, unknown>
  return {
    id,
    title: String(data.interventionTitle || 'Intervention'),
    sme: String(data.businessName || data.participantName || 'SME'),
    deliverable: String(definition.deliverableName || ''),
    intendedOutcome: String(definition.intendedOutcome || ''),
    dueAt,
    overdue: dueAt.getTime() < now.getTime(),
  }
}

const isAssignee = (data: Record<string, unknown>, actor: FollowUpActor) =>
  String(data.assigneeId || '') === actor.id || (Boolean(actor.email) && normalize(data.assigneeEmail) === normalize(actor.email))

const canRecord = (data: Record<string, unknown>, actor: FollowUpActor) => {
  const sameCompany = !data.companyCode || String(data.companyCode) === String(actor.companyCode || '')
  if (!sameCompany) return false
  return isAssignee(data, actor) || OPERATIONS_SIDE_ROLES.includes(normalize(actor.role))
}

/** Pending follow-ups that are overdue or due within DUE_SOON_DAYS, scoped to what this person may act on. */
export async function listFollowUps(db: Firestore, actor: FollowUpActor, now = new Date(), limit = 10): Promise<FollowUpItem[]> {
  const cutoff = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS).toISOString()
  const companyCode = String(actor.companyCode || '')
  let query = db.collection('assignedInterventions').where('followUpDueAt', '<=', cutoff)
  if (companyCode) query = query.where('companyCode', '==', companyCode)
  const snapshot = await query.limit(300).get()
  return snapshot.docs
    .filter(row => canRecord(row.data(), actor))
    .map(row => itemFrom(row.id, row.data(), now))
    .filter((item): item is FollowUpItem => item !== null)
    .sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
    .slice(0, limit)
}

export type RecordFollowUpInput = { assignmentId: string, result: FollowUpResult, note?: string, via: 'whatsapp' | 'web' }
export type RecordFollowUpOutcome =
  | { ok: true, title: string, sme: string, result: FollowUpResult, nextDueAt: Date | null }
  | { ok: false, reason: 'not_found' | 'not_allowed' | 'not_pending' }

/** Writes the facilitator's result. Not yet / partially schedules another check; achieved closes the follow-up. */
export async function recordFollowUpResult(db: Firestore, actor: FollowUpActor, input: RecordFollowUpInput, now = new Date()): Promise<RecordFollowUpOutcome> {
  const ref = db.collection('assignedInterventions').doc(input.assignmentId)
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return { ok: false, reason: 'not_found' } as const
    const data = snapshot.data() as Record<string, unknown>
    if (!canRecord(data, actor)) return { ok: false, reason: 'not_allowed' } as const
    if (normalize(data.followUpStatus) !== 'pending') return { ok: false, reason: 'not_pending' } as const

    const note = String(input.note || '').trim().slice(0, 500)
    const recordedAt = now.toISOString()
    const entry = {
      result: input.result,
      note: note || null,
      recordedAt,
      recordedBy: { uid: actor.id, name: String(actor.name || actor.email || ''), role: String(actor.role || '') },
      via: input.via,
      evidenceMechanism: 'facilitator_observation',
      confidence: 'facilitator_verified',
    }
    const achieved = input.result === 'achieved'
    const nextDueAt = achieved ? null : new Date(now.getTime() + RECHECK_DAYS * DAY_MS)
    transaction.update(ref, {
      outcomeResult: entry,
      outcomeHistory: FieldValue.arrayUnion(entry),
      followUpStatus: achieved ? 'done' : 'pending',
      followUpDueAt: nextDueAt ? nextDueAt.toISOString() : String(data.followUpDueAt),
      followUpRound: Number(data.followUpRound || 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    })
    return {
      ok: true,
      title: String(data.interventionTitle || 'Intervention'),
      sme: String(data.businessName || data.participantName || 'SME'),
      result: input.result,
      nextDueAt,
    } as const
  })
}

export type FollowUpReminderDeps = {
  db: Firestore
  appUrl: string
  sendWhatsApp: (phone: string, text: string, parts?: AlertParts) => Promise<boolean>
  now?: Date
  dryRun?: boolean
  force?: boolean
  companyCode?: string
}

export type FollowUpReminderResult = { facilitators: number, notified: number, skippedAlreadySent: number, items: number, dryRun: boolean }

const whatsappNumbers = (user: Record<string, unknown>) => {
  const listed = Array.isArray(user.whatsappPhoneNumbers) ? user.whatsappPhoneNumbers.map(String) : []
  if (listed.length) return listed
  return user.phoneIsWhatsApp === true && user.phone ? [String(user.phone)] : []
}

/**
 * Daily nudge to the facilitator who owns each due follow-up: an in-app notification plus a WhatsApp
 * message pointing at "Follow-ups due". One per facilitator per day (create() fails on a repeat run).
 */
export async function runFollowUpReminders(deps: FollowUpReminderDeps): Promise<FollowUpReminderResult> {
  const { db } = deps
  const now = deps.now || new Date()
  const cutoff = new Date(now.getTime() + DUE_SOON_DAYS * DAY_MS).toISOString()
  let query = db.collection('assignedInterventions').where('followUpDueAt', '<=', cutoff)
  if (deps.companyCode) query = query.where('companyCode', '==', deps.companyCode)
  const snapshot = await query.get()

  const byAssignee = new Map<string, { companyCode: string, items: FollowUpItem[] }>()
  snapshot.docs.forEach(row => {
    const data = row.data()
    const item = itemFrom(row.id, data, now)
    const assigneeId = String(data.assigneeId || '')
    if (!item || !assigneeId || assigneeId.startsWith('agent:')) return
    const entry = byAssignee.get(assigneeId) || { companyCode: String(data.companyCode || ''), items: [] }
    entry.items.push(item)
    byAssignee.set(assigneeId, entry)
  })

  const result: FollowUpReminderResult = { facilitators: byAssignee.size, notified: 0, skippedAlreadySent: 0, items: 0, dryRun: Boolean(deps.dryRun) }
  const day = now.toISOString().slice(0, 10)

  for (const [assigneeId, { companyCode, items }] of byAssignee) {
    result.items += items.length
    if (deps.dryRun) continue
    const userSnapshot = await db.collection('users').doc(assigneeId).get()
    if (!userSnapshot.exists) continue
    const user = userSnapshot.data() as Record<string, unknown>
    if (normalize(user.status || 'active') === 'inactive' || user.active === false) continue

    const sorted = [...items].sort((left, right) => left.dueAt.getTime() - right.dueAt.getTime())
    const overdue = sorted.filter(item => item.overdue).length
    const label = (item: FollowUpItem) => `${item.title} (${item.sme}): ${item.overdue ? 'overdue' : 'due ' + item.dueAt.toLocaleDateString('en-ZA')}`
    const notificationRef = db.collection('staffNotifications').doc(`${assigneeId}_followup_${day}`)
    const base = {
      recipientUid: assigneeId,
      companyCode,
      type: 'intervention_follow_ups',
      title: `${items.length} follow-up${items.length === 1 ? '' : 's'} due${overdue ? ` (${overdue} overdue)` : ''}`,
      body: sorted.slice(0, 3).map(label).join('\n'),
      items: sorted.slice(0, 8).map(item => ({ id: item.id, title: item.title, sme: item.sme, overdue: item.overdue, dueAt: item.dueAt.toISOString() })),
      link: '/consultant/interventions',
      readAt: null,
      channels: { inApp: 'created' } as Record<string, string>,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    try {
      if (deps.force) await notificationRef.set(base)
      else await notificationRef.create(base)
    } catch (error) {
      if ((error as { code?: number }).code === 6) {
        result.skippedAlreadySent += 1
        continue
      }
      throw error
    }

    const numbers = whatsappNumbers(user)
    const inPlan = await companyHasFeature(db, companyCode, 'whatsappComms')
    let whatsapp = !inPlan ? 'not_in_plan' : canReceiveWhatsAppAlerts(user) ? 'no_number' : 'not_consented'
    if (inPlan && numbers.length && canReceiveWhatsAppAlerts(user)) {
      const parts: AlertParts = {
        firstName: String(user.displayName || user.name || '').trim().split(/\s+/)[0] || '',
        headline: `${items.length} follow-up check${items.length === 1 ? '' : 's'} due`,
        items: sorted.map(item => {
          const daysOverdue = Math.max(1, Math.floor((now.getTime() - item.dueAt.getTime()) / DAY_MS))
          return { title: item.title, sme: item.sme, overdue: item.overdue, when: item.overdue ? `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue` : `due ${shortDate(item.dueAt)}` }
        }),
      }
      const text = alertPlainText(parts, 'Reply “follow-ups” to record what you have observed.')
      try {
        whatsapp = (await deps.sendWhatsApp(numbers[0], text, parts)) ? 'sent' : 'failed'
      } catch {
        whatsapp = 'failed'
      }
    }
    await notificationRef.set({ channels: { inApp: 'created', whatsapp }, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    result.notified += 1
  }
  return result
}
