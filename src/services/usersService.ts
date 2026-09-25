import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { getFirebaseAuth } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import type { FullIdentity } from '@/types/identity'
import type { ManagedUser } from '@/types/operations'
import type { UserRole } from '@/config/roles'
import { ensureWorkspaceCompany } from '@/services/companiesService'

const assertAdmin = (user: FullIdentity) => {
  if (!hasRolePermission(user.role, 'manage_users', user.permissions)) throw new Error('forbidden')
}

const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()
const functionsBaseUrl = String(
  import.meta.env.VITE_FUNCTIONS_BASE_URL
    || (projectId ? `https://us-central1-${projectId}.cloudfunctions.net` : ''),
).replace(/\/$/, '')

const callAdminEndpoint = async <T>(path: string, body: Record<string, unknown>) => {
  const token = await getFirebaseAuth().currentUser?.getIdToken()
  if (!token) throw new Error('unauthenticated')
  const response = await fetch(`${functionsBaseUrl}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'request-failed')
  return result
}

export type OrphanUserRecord = {
  id: string
  email: string
  name: string
  role: string
  companyCode: string
}

export const previewOrphanUsers = async (user: FullIdentity) => {
  assertAdmin(user)
  if (!['systemadmin', 'admin'].includes(user.role)) throw new Error('platform-admin-required')
  return callAdminEndpoint<{ count: number, orphans: OrphanUserRecord[] }>('cleanupOrphanUserRecords', { dryRun: true })
}

export const cleanupOrphanUsers = async (user: FullIdentity, confirmation: string) => {
  assertAdmin(user)
  if (!['systemadmin', 'admin'].includes(user.role)) throw new Error('platform-admin-required')
  return callAdminEndpoint<{ count: number, deletedRecordCount: number, deletedUserIds: string[] }>('cleanupOrphanUserRecords', {
    dryRun: false,
    confirmation,
  })
}

export const listManagedUsers = async (user: FullIdentity) => {
  assertAdmin(user)
  const source = collection(getFirebaseDb(), 'users')
  const snapshot = await getDocs(source)

  // Consultant photos saved before they were mirrored onto users/{uid} only exist on consultantProfiles
  // (a full scan of which is limited to systemadmin).
  const consultantPhotos = new Map<string, string>()
  if (user.role === 'systemadmin') {
    try {
      const profiles = await getDocs(collection(getFirebaseDb(), 'consultantProfiles'))
      profiles.docs.forEach((row) => {
        const url = String(row.data().profileImageUrl || '').trim()
        if (url) consultantPhotos.set(row.id, url)
      })
    } catch (error) {
      console.warn('[users] consultant photos unavailable', error)
    }
  }

  return snapshot.docs.map((record) => {
    const data = record.data()
    return {
      id: record.id,
      name: data.name || data.displayName || '',
      email: data.email || '',
      role: data.role as UserRole,
      status: data.status === 'active' || data.status === 'Active' ? 'active' : 'inactive',
      companyCode: data.companyCode,
      permissions: Array.isArray(data.permissions) ? data.permissions : undefined,
      photoUrl: String(data.profileImageUrl || consultantPhotos.get(record.id) || '') || undefined,
      phone: data.phone || '',
      alternativePhone: data.alternativePhone || '',
      phoneIsWhatsApp: data.phoneIsWhatsApp === true,
      alternativePhoneIsWhatsApp: data.alternativePhoneIsWhatsApp === true,
    } satisfies ManagedUser
  })
}

export const createManagedUser = async (user: FullIdentity, values: Omit<ManagedUser, 'id'>) => {
  assertAdmin(user)
  if (user.role !== 'systemadmin' && values.role === 'systemadmin') throw new Error('forbidden')
  const companyCode = values.companyCode || user.companyCode || ''
  if (companyCode) await ensureWorkspaceCompany(companyCode, companyCode, user.uid)
  if (functionsBaseUrl) {
    const result = await callAdminEndpoint<{ uid: string }>('createPlatformUser', {
      ...values,
      sendResetLink: true,
      sendEmail: true,
    })
    await updateDoc(doc(getFirebaseDb(), 'users', result.uid), {
      companyCode,
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    })
    return
  }
  await addDoc(collection(getFirebaseDb(), 'users'), {
    ...values,
    companyCode,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: user.uid,
  })
}

export const updateManagedUser = async (user: FullIdentity, id: string, values: Omit<ManagedUser, 'id'>) => {
  assertAdmin(user)
  if (user.role !== 'systemadmin' && values.role === 'systemadmin') throw new Error('forbidden')
  if (functionsBaseUrl) {
    await callAdminEndpoint('updatePlatformUser', { uid: id, ...values })
    return
  }
  await updateDoc(doc(getFirebaseDb(), 'users', id), {
    ...values,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

export const deleteManagedUser = async (user: FullIdentity, id: string) => {
  assertAdmin(user)
  if (id === user.uid) throw new Error('self-delete')
  if (functionsBaseUrl) {
    await callAdminEndpoint('deleteUserAccount', { uid: id, reason: 'Removed by administrator' })
    return
  }
  await deleteDoc(doc(getFirebaseDb(), 'users', id))
}
