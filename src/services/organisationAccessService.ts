import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '@/config/firebase'

export type OrganisationAccessRequest = {
  uid: string
  email: string
  contactName: string
  organisationName: string
  phone: string
  notes: string
  status: 'pending' | 'approved' | 'rejected'
  reason?: string
  createdAt?: { toDate: () => Date }
}

export const submitOrganisationRequest = async (input: Pick<OrganisationAccessRequest, 'contactName' | 'organisationName' | 'phone' | 'notes'>) => {
  const call = httpsCallable(getFunctions(firebaseApp, 'us-central1'), 'submitOrganisationAccessRequest')
  await call(input)
}

export const decideOrganisationRequest = async (uid: string, decision: 'approved' | 'rejected', reason: string) => {
  const call = httpsCallable(getFunctions(firebaseApp, 'us-central1'), 'decideOrganisationAccessRequest')
  await call({ uid, decision, reason })
}
