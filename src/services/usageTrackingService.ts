import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type UsageSessionRecord = {
  id: string
  uid: string
  email: string
  displayName: string
  role: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
  currentPath?: string
  active?: boolean
}

export type UsagePageViewRecord = {
  id: string
  sessionId: string
  uid: string
  email: string
  displayName: string
  role: string
  path: string
  startedAt: Date
  endedAt: Date
  durationSeconds: number
}

type TrackSessionPayload = {
  sessionId: string
  user: FullIdentity
  startedAt: Date
  currentPath: string
  active: boolean
  endedAt?: Date
}

type TrackPageViewPayload = {
  pageViewId: string
  sessionId: string
  user: FullIdentity
  path: string
  startedAt: Date
  endedAt: Date
}

const secondsBetween = (start: Date, end: Date) =>
  Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))

const asDate = (value: unknown, fallback = new Date(0)) => {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  return fallback
}

export const createUsageId = (prefix: string) => {
  const randomPart = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  return `${prefix}-${randomPart}`
}

// Rules only accept usage docs owned by the signed-in uid. Provider cleanups can fire after sign-out or an
// account switch, so skip writes for anyone else and never let analytics surface as an uncaught rejection.
const writeOwnUsageDoc = async (collectionName: string, id: string, uid: string, data: Record<string, unknown>) => {
  if (!isFirebaseConfigured || getFirebaseAuth().currentUser?.uid !== uid) return

  try {
    await setDoc(doc(getFirebaseDb(), collectionName, id), data, { merge: true })
  } catch (error) {
    console.warn('Usage tracking write skipped', error)
  }
}

export const saveUsageSession = async ({
  sessionId,
  user,
  startedAt,
  currentPath,
  active,
  endedAt = new Date(),
}: TrackSessionPayload) => {
  await writeOwnUsageDoc('usageSessions', sessionId, user.uid, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    startedAt: Timestamp.fromDate(startedAt),
    endedAt: Timestamp.fromDate(endedAt),
    durationSeconds: secondsBetween(startedAt, endedAt),
    currentPath,
    active,
    lastSeenAt: serverTimestamp(),
  })
}

export const saveUsagePageView = async ({
  pageViewId,
  sessionId,
  user,
  path,
  startedAt,
  endedAt,
}: TrackPageViewPayload) => {
  await writeOwnUsageDoc('usagePageViews', pageViewId, user.uid, {
    sessionId,
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    path,
    startedAt: Timestamp.fromDate(startedAt),
    endedAt: Timestamp.fromDate(endedAt),
    durationSeconds: secondsBetween(startedAt, endedAt),
    updatedAt: serverTimestamp(),
  })
}

export const listUsageSessions = async (): Promise<UsageSessionRecord[]> => {
  if (!isFirebaseConfigured) return []

  const snapshot = await getDocs(collection(getFirebaseDb(), 'usageSessions'))

  return snapshot.docs.map((snapshotDoc) => {
    const data = snapshotDoc.data()
    const startedAt = asDate(data.startedAt)
    const endedAt = asDate(data.endedAt, startedAt)

    return {
      id: snapshotDoc.id,
      uid: String(data.uid || ''),
      email: String(data.email || ''),
      displayName: String(data.displayName || ''),
      role: String(data.role || ''),
      startedAt,
      endedAt,
      durationSeconds: Number(data.durationSeconds || 0),
      currentPath: typeof data.currentPath === 'string' ? data.currentPath : undefined,
      active: data.active === true,
    }
  })
}

export const listUsagePageViews = async (): Promise<UsagePageViewRecord[]> => {
  if (!isFirebaseConfigured) return []

  const snapshot = await getDocs(collection(getFirebaseDb(), 'usagePageViews'))

  return snapshot.docs.map((snapshotDoc) => {
    const data = snapshotDoc.data()
    const startedAt = asDate(data.startedAt)
    const endedAt = asDate(data.endedAt, startedAt)

    return {
      id: snapshotDoc.id,
      sessionId: String(data.sessionId || ''),
      uid: String(data.uid || ''),
      email: String(data.email || ''),
      displayName: String(data.displayName || ''),
      role: String(data.role || ''),
      path: String(data.path || '/'),
      startedAt,
      endedAt,
      durationSeconds: Number(data.durationSeconds || 0),
    }
  })
}
