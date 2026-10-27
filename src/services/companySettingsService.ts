import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, where } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import type { SystemSettingsChangeRequest, SystemSettingsRecord, ChangeRequestStatus, InterventionDeliveryRole } from '@/types/companySettings'

const toDate = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return value.toDate() as Date
  }
  return undefined
}

const mapRequest = (id: string, data: Record<string, unknown>): SystemSettingsChangeRequest => ({
  id,
  companyCode: String(data.companyCode || ''),
  companyName: String(data.companyName || ''),
  requestedByUid: String(data.requestedByUid || ''),
  requestedByEmail: String(data.requestedByEmail || ''),
  requestedAt: toDate(data.requestedAt),
  status: (String(data.status || 'pending') as ChangeRequestStatus),
  reason: String(data.reason || ''),
  adminResponse: String(data.adminResponse || ''),
  reviewedAt: toDate(data.reviewedAt),
  reviewedByUid: String(data.reviewedByUid || ''),
  reviewedByEmail: String(data.reviewedByEmail || ''),
  currentSettingsSnapshot: (data.currentSettingsSnapshot || null) as SystemSettingsRecord | null,
  requestedInterventionDeliveryRoles: Array.isArray(data.requestedInterventionDeliveryRoles)
    ? data.requestedInterventionDeliveryRoles as InterventionDeliveryRole[]
    : undefined,
})

export const getSystemSettings = async (companyCode: string) => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', companyCode))
  if (!snapshot.exists()) return null
  const data = snapshot.data()
  return {
    ...data,
    companyCode: String(data.companyCode || snapshot.id),
    companyName: String(data.name || data.companyName || snapshot.id),
  } as SystemSettingsRecord
}

export const submitSystemSettingsChangeRequest = async (
  user: FullIdentity,
  settings: SystemSettingsRecord | null,
  reason: string,
  requestedInterventionDeliveryRoles?: InterventionDeliveryRole[],
) => {
  if (!user.companyCode) throw new Error('missing-company')
  const trimmedReason = reason.trim()
  if (trimmedReason.length < 10) throw new Error('reason-too-short')

  await addDoc(collection(getFirebaseDb(), 'systemSettingsChangeRequests'), {
    companyCode: user.companyCode,
    companyName: settings?.companyName || '',
    requestedByUid: user.uid,
    requestedByEmail: user.email,
    requestedAt: serverTimestamp(),
    status: 'pending',
    reason: trimmedReason,
    currentSettingsSnapshot: settings || null,
    requestedInterventionDeliveryRoles: requestedInterventionDeliveryRoles || null,
  })
}

export const listSystemSettingsChangeRequests = async (user: FullIdentity) => {
  if (user.role !== 'systemadmin') throw new Error('forbidden')
  const snapshot = await getDocs(query(
    collection(getFirebaseDb(), 'systemSettingsChangeRequests'),
    orderBy('requestedAt', 'desc'),
  ))
  return snapshot.docs.map(record => mapRequest(record.id, record.data()))
}

export const listMySystemSettingsChangeRequests = async (user: FullIdentity) => {
  const snapshot = await getDocs(query(
    collection(getFirebaseDb(), 'systemSettingsChangeRequests'),
    where('requestedByUid', '==', user.uid),
    orderBy('requestedAt', 'desc'),
  ))
  return snapshot.docs.map(record => mapRequest(record.id, record.data()))
}

export const reviewSystemSettingsChangeRequest = async (
  requestId: string,
  decision: 'approved' | 'declined',
  adminResponse: string,
) => {
  const functions = getFunctions(firebaseApp, 'us-central1')
  const callable = httpsCallable(functions, 'reviewSystemSettingsChangeRequest')
  await callable({ requestId, decision, adminResponse })
}
