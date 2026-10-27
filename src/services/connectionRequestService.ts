import { addDoc, arrayUnion, collection, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import { isPlatformAdmin, isPlatformOwnerStaff, PLATFORM_OWNER_CODE } from '@/services/companiesService'
import type { FullIdentity } from '@/types/identity'
import type {
  ConnectionMessage,
  ConnectionParty,
  ConnectionPlan,
  ConnectionRequest,
  ConnectionRequestDeliveryMode,
  ConnectionRequestStatus,
  ConnectionRequestTargetType,
  ConnectionRequestUrgency,
} from '@/types/connectionRequest'

// 'admin' is the platform owner's reception: it marks requests contacted and forwards them, but never decides them.
const REVIEW_ROLES = new Set(['systemadmin', 'director', 'projectadmin', 'projectmanager', 'operations', 'admin'])
const RECEPTION_STATUSES: ConnectionRequestStatus[] = ['pending', 'contacted']

/**
 * Marketplace requests come from SMEs in the platform owner's fallback bucket, so only that
 * workspace's operations staff (plus platform admins) review them - not every company's operations.
 */
const canReviewConnectionRequests = (user?: FullIdentity | null) =>
  Boolean(user && REVIEW_ROLES.has(user.role) && isPlatformOwnerStaff(user))

const DELIVERY_MODES: ConnectionRequestDeliveryMode[] = ['online', 'in_person', 'hybrid', 'no_preference']
const URGENCIES: ConnectionRequestUrgency[] = ['low', 'normal', 'high']

export type CreateConnectionRequestInput = {
  smeUid: string
  smeName: string
  smeEmail: string
  targetType: ConnectionRequestTargetType
  targetId: string
  targetName: string
  companyCode?: string
  areaOfSupport?: string
  deliveryMode?: ConnectionRequestDeliveryMode
  preferredStartDate?: string
  engagementDays?: number
  urgency?: ConnectionRequestUrgency
  budget?: number
  currency?: string
  note?: string
  /** Steps from the SME's plan this request covers ("Use this plan"); the consultant's plan starts from them. */
  planSteps?: string[]
}

const mapConnectionRequest = (id: string, data: Record<string, unknown>): ConnectionRequest => ({
  id,
  smeUid: String(data.smeUid || ''),
  smeName: String(data.smeName || ''),
  smeEmail: String(data.smeEmail || ''),
  targetType: data.targetType === 'agent' ? 'agent' : 'consultant',
  targetId: String(data.targetId || ''),
  targetName: String(data.targetName || ''),
  // Requests written before the marketplace was scoped carry no code; they were all platform-owner SMEs.
  companyCode: String(data.companyCode || '').trim() || PLATFORM_OWNER_CODE,
  areaOfSupport: typeof data.areaOfSupport === 'string' ? data.areaOfSupport : undefined,
  deliveryMode: DELIVERY_MODES.includes(data.deliveryMode as ConnectionRequestDeliveryMode) ? data.deliveryMode as ConnectionRequestDeliveryMode : undefined,
  preferredStartDate: typeof data.preferredStartDate === 'string' ? data.preferredStartDate : undefined,
  engagementDays: typeof data.engagementDays === 'number' ? data.engagementDays : undefined,
  urgency: URGENCIES.includes(data.urgency as ConnectionRequestUrgency) ? data.urgency as ConnectionRequestUrgency : undefined,
  budget: typeof data.budget === 'number' ? data.budget : undefined,
  currency: typeof data.currency === 'string' ? data.currency : undefined,
  note: typeof data.note === 'string' ? data.note : undefined,
  planSteps: Array.isArray(data.planSteps) ? data.planSteps.map(String).filter(Boolean) : undefined,
  status: ['pending', 'contacted', 'proposed', 'matched', 'declined'].includes(data.status as string) ? data.status as ConnectionRequestStatus : 'pending',
  messages: Array.isArray(data.messages) ? data.messages as ConnectionMessage[] : [],
  plan: data.plan && typeof data.plan === 'object' ? data.plan as ConnectionPlan : undefined,
  declinedBy: ['sme', 'consultant', 'operations'].includes(data.declinedBy as string) ? data.declinedBy as ConnectionParty : undefined,
  declineReason: typeof data.declineReason === 'string' ? data.declineReason : undefined,
  assignmentIds: Array.isArray(data.assignmentIds) ? data.assignmentIds.map(String) : undefined,
  consultantRespondedAt: data.consultantRespondedAt,
  acceptedAt: data.acceptedAt,
  nudgedAt: data.nudgedAt,
  reviewerNote: typeof data.reviewerNote === 'string' ? data.reviewerNote : undefined,
  forwardedToUid: typeof data.forwardedToUid === 'string' ? data.forwardedToUid : undefined,
  forwardedToName: typeof data.forwardedToName === 'string' ? data.forwardedToName : undefined,
  forwardedAt: data.forwardedAt,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
})

export const createConnectionRequest = async (input: CreateConnectionRequestInput) => {
  await addDoc(collection(getFirebaseDb(), 'connectionRequests'), {
    smeUid: input.smeUid,
    smeName: input.smeName,
    smeEmail: input.smeEmail,
    targetType: input.targetType,
    targetId: input.targetId,
    targetName: input.targetName,
    companyCode: input.companyCode?.trim() || PLATFORM_OWNER_CODE,
    areaOfSupport: input.areaOfSupport?.trim() || null,
    deliveryMode: input.deliveryMode ?? null,
    preferredStartDate: input.preferredStartDate ?? null,
    engagementDays: input.engagementDays ?? null,
    urgency: input.urgency ?? 'normal',
    budget: input.budget ?? null,
    currency: input.currency || 'ZAR',
    note: input.note?.trim() || null,
    ...(input.planSteps?.length ? { planSteps: input.planSteps } : {}),
    status: 'pending' satisfies ConnectionRequestStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export const listConnectionRequests = async (user?: FullIdentity | null): Promise<ConnectionRequest[]> => {
  if (!canReviewConnectionRequests(user)) throw new Error('forbidden')

  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'connectionRequests'), orderBy('createdAt', 'desc')))
  const rows = snapshot.docs.map((row) => mapConnectionRequest(row.id, row.data()))
  if (isPlatformAdmin(user)) return rows

  // Filtered in memory rather than by query, so legacy requests with no companyCode
  // still surface in the platform owner's queue via the mapper's fallback.
  const reviewerCompanyCode = String(user?.companyCode || '').trim()
  return rows.filter((row) => row.companyCode === reviewerCompanyCode)
}

/** The SME's own requests, so they can track what they asked for without operations access. */
export const listConnectionRequestsForSme = async (smeUid: string): Promise<ConnectionRequest[]> => {
  if (!smeUid) return []

  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'connectionRequests'), where('smeUid', '==', smeUid)))
  const rows = snapshot.docs.map((row) => mapConnectionRequest(row.id, row.data()))
  const toMillis = (value: unknown) => (value as { toMillis?: () => number })?.toMillis?.() ?? 0
  return rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
}

const newestFirst = (rows: ConnectionRequest[]) => {
  const toMillis = (value: unknown) => (value as { toMillis?: () => number })?.toMillis?.() ?? 0
  return rows.sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt))
}

/** Live request list for an SME. Keeps an open conversation current without a refresh. */
export const subscribeToConnectionRequestsForSme = (
  smeUid: string,
  onChange: (requests: ConnectionRequest[]) => void,
  onError?: () => void,
): Unsubscribe => {
  if (!smeUid) return () => undefined
  return onSnapshot(
    query(collection(getFirebaseDb(), 'connectionRequests'), where('smeUid', '==', smeUid)),
    (snapshot) => onChange(newestFirst(snapshot.docs.map((row) => mapConnectionRequest(row.id, row.data())))),
    () => onError?.(),
  )
}

export const updateConnectionRequestStatus = async (
  id: string,
  status: ConnectionRequestStatus,
  reviewerNote: string | undefined,
  user?: FullIdentity | null,
) => {
  if (!canReviewConnectionRequests(user)) throw new Error('forbidden')
  if (user?.role === 'admin' && !RECEPTION_STATUSES.includes(status)) throw new Error('forbidden')

  await updateDoc(doc(getFirebaseDb(), 'connectionRequests', id), {
    status,
    reviewerNote: reviewerNote?.trim() || null,
    updatedAt: serverTimestamp(),
  })
}

/** Staff a request can be forwarded to: the reviewer's own company's delivery and management staff. */
export const listForwardingStaff = async (user?: FullIdentity | null) => {
  const companyCode = String(user?.companyCode || '').trim()
  if (!canReviewConnectionRequests(user) || !companyCode) return []
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', companyCode)))
  return snapshot.docs
    .map((row) => ({ uid: row.id, name: String(row.data().name || row.data().displayName || row.data().email || ''), role: String(row.data().role || ''), status: String(row.data().status || '') }))
    .filter((row) => ['operations', 'projectadmin', 'projectmanager', 'director', 'consultant'].includes(row.role) && row.status !== 'deleted' && row.status !== 'inactive')
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Passes a request to a staff member (reception's routing step), keeping an optional note. */
export const forwardConnectionRequest = async (id: string, staff: { uid: string, name: string }, reviewerNote: string | undefined, user?: FullIdentity | null) => {
  if (!canReviewConnectionRequests(user)) throw new Error('forbidden')
  await updateDoc(doc(getFirebaseDb(), 'connectionRequests', id), {
    forwardedToUid: staff.uid,
    forwardedToName: staff.name,
    forwardedAt: serverTimestamp(),
    ...(reviewerNote?.trim() ? { reviewerNote: reviewerNote.trim() } : {}),
    updatedAt: serverTimestamp(),
  })
}

/*
 * The conversation and plan on a consultant request. The consultant answers first (operations see every request
 * and are nudged if one waits 3 days); they can ask questions, decline, or send a plan built from their services.
 * The SME accepts the plan (which creates the work, server side), asks for changes, or declines.
 * Prices are shown for agreement only; payment happens outside the system.
 */

/** Requests sent to this consultant from the marketplace. Both filters are needed for the rule to allow the query. */
export const listConnectionRequestsForConsultant = async (consultantUid: string): Promise<ConnectionRequest[]> => {
  if (!consultantUid) return []
  const snapshot = await getDocs(query(
    collection(getFirebaseDb(), 'connectionRequests'),
    where('targetType', '==', 'consultant'),
    where('targetId', '==', consultantUid),
  ))
  const toMillis = (value: unknown) => (value as { toMillis?: () => number })?.toMillis?.() ?? 0
  return snapshot.docs.map((row) => mapConnectionRequest(row.id, row.data())).sort((a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt))
}

/** Live request list for a consultant. The thread updates as soon as the SME responds. */
export const subscribeToConnectionRequestsForConsultant = (
  consultantUid: string,
  onChange: (requests: ConnectionRequest[]) => void,
  onError?: () => void,
): Unsubscribe => {
  if (!consultantUid) return () => undefined
  return onSnapshot(
    query(
      collection(getFirebaseDb(), 'connectionRequests'),
      where('targetType', '==', 'consultant'),
      where('targetId', '==', consultantUid),
    ),
    (snapshot) => onChange(newestFirst(snapshot.docs.map((row) => mapConnectionRequest(row.id, row.data())))),
    () => onError?.(),
  )
}

const messageFrom = (user: FullIdentity, from: ConnectionParty, text: string): ConnectionMessage => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  from,
  uid: user.uid,
  name: String(user.displayName || user.name || user.email || ''),
  text: text.trim(),
  at: new Date().toISOString(),
})

/** Whose turn it is: the newest message's sender is waiting on the other side. */
export const lastMessage = (request: ConnectionRequest) => request.messages?.[request.messages.length - 1]

/** A message on the request. A consultant's first reply moves a new request into conversation. */
export const sendConnectionMessage = async (request: ConnectionRequest, user: FullIdentity, from: ConnectionParty, text: string) => {
  const consultantFirstReply = from === 'consultant' && request.status === 'pending'
  await updateDoc(doc(getFirebaseDb(), 'connectionRequests', request.id), {
    messages: arrayUnion(messageFrom(user, from, text)),
    ...(consultantFirstReply ? { status: 'contacted' satisfies ConnectionRequestStatus } : {}),
    ...(from === 'consultant' ? { consultantRespondedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  })
}

/** The consultant sends (or revises) the plan; it replaces any earlier one. */
export const sendConnectionPlan = async (request: ConnectionRequest, user: FullIdentity, plan: Omit<ConnectionPlan, 'sentAt' | 'version' | 'total'>) => {
  const total = plan.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0)
  const nextPlan: ConnectionPlan = { ...plan, total, sentAt: new Date().toISOString(), version: (request.plan?.version || 0) + 1 }
  await updateDoc(doc(getFirebaseDb(), 'connectionRequests', request.id), {
    plan: nextPlan,
    status: 'proposed' satisfies ConnectionRequestStatus,
    ...(plan.message?.trim() ? { messages: arrayUnion(messageFrom(user, 'consultant', plan.message)) } : {}),
    consultantRespondedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

/** Either side declines; the reason is kept on the request and in the thread. */
export const declineConnectionRequest = async (request: ConnectionRequest, user: FullIdentity, by: 'sme' | 'consultant', reason: string) => {
  await updateDoc(doc(getFirebaseDb(), 'connectionRequests', request.id), {
    status: 'declined' satisfies ConnectionRequestStatus,
    declinedBy: by,
    declineReason: reason.trim() || null,
    ...(reason.trim() ? { messages: arrayUnion(messageFrom(user, by, reason)) } : {}),
    ...(by === 'consultant' ? { consultantRespondedAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  })
}

/** The SME asks for a different plan: back into conversation, with what they'd like changed. */
export const askForPlanChanges = async (request: ConnectionRequest, user: FullIdentity, text: string) => {
  await updateDoc(doc(getFirebaseDb(), 'connectionRequests', request.id), {
    status: 'contacted' satisfies ConnectionRequestStatus,
    messages: arrayUnion(messageFrom(user, 'sme', text)),
    updatedAt: serverTimestamp(),
  })
}

/** The SME accepts the plan. Runs on the server, which creates the assigned interventions for the consultant. */
export const acceptConnectionPlan = async (requestId: string) => {
  const callable = httpsCallable<{ requestId: string }, { assignmentIds: string[] }>(getFunctions(firebaseApp, 'us-central1'), 'acceptConnectionPlan')
  const result = await callable({ requestId })
  return result.data.assignmentIds
}

/** Whose move it is on an open request: new ones, and ones where the SME wrote last, wait on the consultant. */
export const waitsOnConsultant = (request: ConnectionRequest) =>
  request.status === 'pending' || (request.status === 'contacted' && lastMessage(request)?.from !== 'consultant')
