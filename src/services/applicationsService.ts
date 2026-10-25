import { collection, doc, getDoc, getDocs, limit, query, where, type Query } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'

type ApplicationOwner = {
  uid: string
  email?: string | null
}

const applicationOwnerFields = ['uid', 'userId', 'participantId'] as const
const participantOwnerFields = ['uid', 'userId', 'participantId', 'ownerUid'] as const

const isPermissionDenied = (error: unknown) =>
  Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'permission-denied')

/**
 * The rules only let an SME read their own records, so a lookup the rules can't match is rejected
 * instead of returning nothing. Application lookups treat that as "no match" (the worst case is the
 * applicant workspace for someone with no participant record, which is where they belong). Participant
 * lookups stay strict: guessing "no match" there could send an accepted SME to the applicant workspace.
 */
const anyMatch = async (search: Query, deniedMeansNoMatch: boolean, lookup: string) => {
  try {
    return !(await getDocs(query(search, limit(1)))).empty
  } catch (error) {
    if (deniedMeansNoMatch && isPermissionDenied(error)) return false
    throw withLookup(error, lookup)
  }
}

// Names the lookup that failed (e.g. "participants where uid"), so a rules mismatch is easy to pin down.
const withLookup = (error: unknown, lookup: string) =>
  Object.assign(error instanceof Error ? error : new Error(String(error)), { lookup })

export const hasApplicationForUser = async ({ uid, email }: ApplicationOwner) => {
  const db = getFirebaseDb()

  try {
    if ((await getDoc(doc(db, 'applications', uid))).exists()) return true
  } catch (error) {
    if (!isPermissionDenied(error)) throw error
  }

  for (const field of applicationOwnerFields) {
    if (await anyMatch(query(collection(db, 'applications'), where(field, '==', uid)), true, `applications where ${field}`)) return true
  }

  if (email && await anyMatch(query(collection(db, 'applications'), where('email', '==', email)), true, 'applications where email')) return true

  return false
}

export const hasParticipantForUser = async ({ uid, email }: ApplicationOwner) => {
  const db = getFirebaseDb()

  try {
    if ((await getDoc(doc(db, 'participants', uid))).exists()) return true
  } catch (error) {
    throw withLookup(error, 'participants by id')
  }

  // Email lookups may be denied when the email passed in differs from the sign-in email; such a record
  // can't be this user's, so that counts as no match. The uid lookups below stay strict.
  if (email && await anyMatch(query(collection(db, 'participants'), where('email', '==', email)), true, 'participants where email')) return true

  for (const field of participantOwnerFields) {
    if (await anyMatch(query(collection(db, 'participants'), where(field, '==', uid)), false, `participants where ${field}`)) return true
  }

  if (email && await anyMatch(query(collection(db, 'participants'), where('emailLower', '==', email.toLowerCase())), true, 'participants where emailLower')) return true

  return false
}

export const isApplicantWorkspaceUser = async ({ uid, email }: ApplicationOwner, explicitIsApplicant?: unknown) => {
  if (typeof explicitIsApplicant === 'boolean') return explicitIsApplicant

  try {
    if (await hasParticipantForUser({ uid, email })) return false

    return !(await hasApplicationForUser({ uid, email }))
  } catch (error) {
    const lookup = error && typeof error === 'object' && 'lookup' in error ? ` (${String(error.lookup)})` : ''
    console.warn(`Could not resolve applicant/incubatee workspace state${lookup}. Defaulting to incubatee workspace.`, error)
    return false
  }
}
