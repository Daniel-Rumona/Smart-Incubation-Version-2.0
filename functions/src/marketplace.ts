import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import type { AlertParts } from './alertMessages.js'
import { companyHasFeature } from './entitlements.js'
import { canReceiveWhatsAppAlerts } from './whatsappConsent.js'

/*
 * The consultant marketplace after an SME sends a request (connectionRequests/{id}):
 *  - acceptPlan: the SME accepts the consultant's plan; each item becomes an assigned intervention for the consultant;
 *  - notifyChange: email (and WhatsApp, where allowed) the other side when something happens on a request;
 *  - nudgeUnanswered: tell the platform owner's operations about requests a consultant hasn't answered in 3 days.
 * Prices on a plan are for agreement only; payment happens outside the system.
 */

export const PLATFORM_OWNER_CODE = 'QTX'
const UNANSWERED_DAYS = 3

type Row = Record<string, unknown>
type PlanItem = { title?: unknown, areaOfSupport?: unknown, sessions?: unknown, deliveryMode?: unknown, dueDate?: unknown, price?: unknown }

export type MarketplaceDeps = {
  db: Firestore
  appUrl: string
  /** Queues a branded email with one button; resolves false when the address is invalid or suppressed. */
  sendEmail: (input: { to: string, name: string, subject: string, intro: string, actionLabel: string, actionUrl: string, source: string }) => Promise<boolean>
  sendWhatsApp: (phone: string, text: string, parts?: AlertParts) => Promise<boolean>
  now?: Date
}

export class MarketplaceError extends Error {
  constructor(public code: 'not-found' | 'permission-denied' | 'failed-precondition', message: string) {
    super(message)
  }
}

const text = (value: unknown) => String(value ?? '').trim()
const firstName = (value: unknown) => text(value).split(/\s+/)[0] || ''

const whatsappNumbers = (user: Row) => {
  const listed = Array.isArray(user.whatsappPhoneNumbers) ? user.whatsappPhoneNumbers.map(String) : []
  if (listed.length) return listed
  return user.phoneIsWhatsApp === true && user.phone ? [String(user.phone)] : []
}

/**
 * The SME accepts the plan. Each plan item becomes an assigned intervention: already accepted by the consultant
 * (they proposed it) and by the SME (accepting the plan is their sign-off), in the platform owner's workspace.
 */
export async function acceptPlan(db: Firestore, callerUid: string, requestId: string) {
  const ref = db.collection('connectionRequests').doc(requestId)
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new MarketplaceError('not-found', 'This request no longer exists.')
    const request = snapshot.data() as Row
    if (text(request.smeUid) !== callerUid) throw new MarketplaceError('permission-denied', 'Only the SME who asked can accept this plan.')
    if (request.status !== 'proposed') throw new MarketplaceError('failed-precondition', 'There is no plan waiting for you on this request.')
    const plan = (request.plan || {}) as { items?: PlanItem[], currency?: unknown, version?: unknown }
    const items = Array.isArray(plan.items) ? plan.items : []
    if (!items.length) throw new MarketplaceError('failed-precondition', 'The plan has no interventions.')

    const consultantUid = text(request.targetId)
    const [consultantSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(db.collection('users').doc(consultantUid)),
      transaction.get(db.collection('consultantProfiles').doc(consultantUid)),
    ])
    const consultant = { ...(profileSnapshot.data() || {}), ...(consultantSnapshot.data() || {}) } as Row
    const companyCode = text(request.companyCode) || PLATFORM_OWNER_CODE
    const assignmentIds: string[] = []

    items.forEach((item, index) => {
      const id = `${requestId}_${index + 1}`
      assignmentIds.push(id)
      const due = new Date(`${text(item.dueDate)}T17:00:00`)
      transaction.set(db.collection('assignedInterventions').doc(id), {
        companyCode,
        participantId: text(request.smeUid),
        businessName: text(request.smeName) || 'SME',
        beneficiaryEmail: text(request.smeEmail) || null,
        interventionId: `marketplace:${requestId}:${index + 1}`,
        interventionTitle: text(item.title) || 'Intervention',
        areaOfSupport: text(item.areaOfSupport) || text(request.areaOfSupport) || null,
        programId: null,
        programName: null,
        assigneeId: consultantUid,
        assigneeUid: consultantUid,
        assigneeName: text(consultant.name || consultant.displayName) || text(request.targetName),
        assigneeEmail: text(consultant.email) || null,
        assigneeType: 'consultant',
        deliveryActorType: 'human',
        deliveryStrategy: 'human_only',
        type: 'singular',
        status: 'assigned',
        assigneeStatus: 'accepted',
        participantStatus: 'accepted',
        assigneeCompletionStatus: 'pending',
        participantCompletionStatus: 'pending',
        progress: 0,
        dueDate: Number.isNaN(due.getTime()) ? null : Timestamp.fromDate(due),
        plannedSessions: Number(item.sessions) || 1,
        deliveryMode: text(item.deliveryMode) || null,
        agreedPrice: Number(item.price) || 0,
        currency: text(plan.currency) || 'ZAR',
        source: 'marketplace',
        connectionRequestId: requestId,
        planVersion: Number(plan.version) || 1,
        createdByUid: callerUid,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    })

    transaction.update(ref, {
      status: 'matched',
      assignmentIds,
      acceptedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
    return assignmentIds
  })
}

const sideOf = async (db: Firestore, uid: string) => {
  if (!uid) return null
  const snapshot = await db.collection('users').doc(uid).get()
  return snapshot.exists ? { uid, ...(snapshot.data() as Row) } : null
}

/** One alert to one person: email always, WhatsApp too when they opted in and the platform has it switched on. */
async function alert(deps: MarketplaceDeps, person: Row | null, fallbackEmail: string, message: { subject: string, intro: string, actionLabel: string, path: string, source: string }) {
  const email = text(person?.email) || fallbackEmail
  const name = text(person?.displayName || person?.name)
  const actionUrl = `${deps.appUrl}${message.path}`
  if (email) await deps.sendEmail({ to: email, name, subject: message.subject, intro: message.intro, actionLabel: message.actionLabel, actionUrl, source: message.source })
  const numbers = person ? whatsappNumbers(person) : []
  if (person && numbers.length && canReceiveWhatsAppAlerts(person) && await companyHasFeature(deps.db, PLATFORM_OWNER_CODE, 'whatsappComms')) {
    await deps.sendWhatsApp(numbers[0], `${message.intro} ${actionUrl}`, {
      firstName: firstName(name),
      headline: message.subject,
      items: [{ title: message.intro, sme: message.actionLabel, overdue: false, when: 'today' }],
    }).catch(() => false)
  }
}

/** Works out what changed on a request and tells the person whose move it now is. */
export async function notifyChange(deps: MarketplaceDeps, requestId: string, before: Row | null, after: Row | null) {
  if (!after || after.targetType !== 'consultant') return
  const smeName = text(after.smeName) || 'An SME'
  const consultantName = text(after.targetName) || 'Your consultant'
  const consultantPath = `/consultant/requests?request=${requestId}`
  const smePath = `/applicant/marketplace?view=requests&request=${requestId}`
  const [consultant, sme] = await Promise.all([sideOf(deps.db, text(after.targetId)), sideOf(deps.db, text(after.smeUid))])
  const smeEmail = text(after.smeEmail)
  const consultantUid = text(after.targetId)

  if (!before) {
    await alert(deps, consultant, '', { subject: `New request from ${smeName}`, intro: `${smeName} asked for your help${after.areaOfSupport ? ` with ${text(after.areaOfSupport)}` : ''}. Reply or send them a plan.`, actionLabel: 'Open the request', path: consultantPath, source: 'marketplaceRequest' })
    await addConsultantNotification(deps.db, consultantUid, after, requestId, 'request', `New request from ${smeName}`, `${smeName} asked for your help${after.areaOfSupport ? ` with ${text(after.areaOfSupport)}` : ''}.`, consultantPath)
    return
  }

  if (before.status !== after.status) {
    if (after.status === 'proposed') {
      await alert(deps, sme, smeEmail, { subject: `${consultantName} sent you a plan`, intro: `${consultantName} sent you a plan for your request. Review it, then accept it or ask for changes.`, actionLabel: 'Review the plan', path: smePath, source: 'marketplacePlan' })
      await addSmeNotification(deps.db, after, requestId, `plan_${text((after.plan as Row | undefined)?.version) || '1'}`, `${consultantName} sent you a plan. Review it on your Requests tab.`)
      return
    }
    if (after.status === 'matched') {
      await alert(deps, consultant, '', { subject: `${smeName} accepted your plan`, intro: `${smeName} accepted your plan. The interventions are now on your My interventions page.`, actionLabel: 'Open my interventions', path: '/consultant/interventions', source: 'marketplaceAccepted' })
      await addConsultantNotification(deps.db, consultantUid, after, requestId, 'accepted', `${smeName} accepted your plan`, 'The interventions are now on your My interventions page.', '/consultant/interventions')
      return
    }
    if (after.status === 'declined') {
      const bySme = after.declinedBy === 'sme'
      if (bySme) {
        await alert(deps, consultant, '', { subject: `${smeName} declined`, intro: `${smeName} decided not to go ahead with this request.`, actionLabel: 'Open the request', path: consultantPath, source: 'marketplaceDeclined' })
        await addConsultantNotification(deps.db, consultantUid, after, requestId, 'declined_by_sme', `${smeName} declined`, `${smeName} decided not to go ahead with this request.`, consultantPath)
      }
      else await alert(deps, sme, smeEmail, { subject: `${consultantName} can't take this on`, intro: `${consultantName} can't take on your request. You can ask another consultant from the marketplace.`, actionLabel: 'Open the marketplace', path: '/applicant/marketplace', source: 'marketplaceDeclined' })
      if (!bySme) await addSmeNotification(deps.db, after, requestId, 'declined_by_consultant', `${consultantName} can't take on your request.`)
      return
    }
  }

  // A new message (not one that came with a status change above): tell the other side.
  const beforeCount = Array.isArray(before.messages) ? before.messages.length : 0
  const messages = Array.isArray(after.messages) ? after.messages as Row[] : []
  if (messages.length > beforeCount) {
    const latest = messages[messages.length - 1]
    if (latest.from === 'sme') {
      await alert(deps, consultant, '', { subject: `${smeName} replied`, intro: `${smeName}: "${text(latest.text).slice(0, 160)}"`, actionLabel: 'Reply', path: consultantPath, source: 'marketplaceMessage' })
      await addConsultantNotification(deps.db, consultantUid, after, requestId, `message_${text(latest.id) || beforeCount}`, `${smeName} replied`, text(latest.text).slice(0, 180), consultantPath)
    } else {
      await alert(deps, sme, smeEmail, { subject: `${consultantName} replied`, intro: `${consultantName}: "${text(latest.text).slice(0, 160)}"`, actionLabel: 'Reply', path: smePath, source: 'marketplaceMessage' })
      await addSmeNotification(deps.db, after, requestId, `message_${text(latest.id) || beforeCount}`, `${consultantName} replied to your request.`)
    }
  }
}

const addConsultantNotification = (db: Firestore, recipientUid: string, request: Row, requestId: string, eventKey: string, title: string, body: string, link: string) => {
  if (!recipientUid) return Promise.resolve()
  return db.collection('staffNotifications').doc(`connection_${requestId}_${eventKey}`).set({
    recipientUid,
    companyCode: text(request.companyCode) || PLATFORM_OWNER_CODE,
    type: 'connection_request_update',
    title,
    body,
    link,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })
}

const addSmeNotification = (db: Firestore, request: Row, requestId: string, eventKey: string, message: string) =>
  db.collection('notifications').doc(`connection_${requestId}_${eventKey}`).set({
    companyCode: text(request.companyCode) || PLATFORM_OWNER_CODE,
    participantId: text(request.smeUid),
    recipientUid: text(request.smeUid),
    type: 'connection_request_update',
    connectionRequestId: requestId,
    recipientRoles: ['incubatee'],
    message,
    readBy: {},
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true })

/** Requests a consultant hasn't answered in 3 days: an in-app alert to the platform owner's operations, once each. */
export async function nudgeUnanswered(deps: MarketplaceDeps) {
  const cutoff = (deps.now || new Date()).getTime() - UNANSWERED_DAYS * 86400000
  const snapshot = await deps.db.collection('connectionRequests').where('status', '==', 'pending').get()
  let nudged = 0
  for (const row of snapshot.docs) {
    const data = row.data() as Row
    const created = (data.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? Date.now()
    if (data.targetType !== 'consultant' || data.nudgedAt || data.consultantRespondedAt || created > cutoff) continue
    await deps.db.collection('notifications').doc(`connection_unanswered_${row.id}`).set({
      companyCode: text(data.companyCode) || PLATFORM_OWNER_CODE,
      type: 'connection_request_unanswered',
      connectionRequestId: row.id,
      recipientRoles: ['operations'],
      message: `${text(data.targetName) || 'A consultant'} hasn't answered ${text(data.smeName) || 'an SME'}'s request in ${UNANSWERED_DAYS} days.`,
      readBy: {},
      createdAt: FieldValue.serverTimestamp(),
    })
    await row.ref.update({ nudgedAt: FieldValue.serverTimestamp() })
    nudged += 1
  }
  return nudged
}
