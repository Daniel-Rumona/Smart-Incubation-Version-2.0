import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import type { FullIdentity, IdentityPermission } from '@/types/identity'
import type { ManagedUser } from '@/types/operations'

/** Staff values sent to the server. `permissions: null` clears a stored override so the person follows their role's defaults. */
export type StaffValues = Omit<ManagedUser, 'id' | 'permissions'> & { permissions?: IdentityPermission[] | null }

// Directors may manage their company's reception admins (and only those: the staff functions enforce it).
const assertPermission = (user: FullIdentity, permission: 'view_staff' | 'manage_staff') => {
  if (user.role === 'director' && user.companyCode) return
  if (!hasRolePermission(user.role, permission, user.permissions)) throw new Error('forbidden')
}

const projectId = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim()
const functionsBaseUrl = String(
  import.meta.env.VITE_FUNCTIONS_BASE_URL
    || (projectId ? `https://us-central1-${projectId}.cloudfunctions.net` : ''),
).replace(/\/$/, '')

const callStaffEndpoint = async <T>(path: string, body: Record<string, unknown>) => {
  const token = await getFirebaseAuth().currentUser?.getIdToken()
  if (!token) throw new Error('unauthenticated')
  const response = await fetch(`${functionsBaseUrl}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(result.error || 'request-failed')
  return result
}

export const listOperationsStaff = async (user: FullIdentity) => {
  assertPermission(user, 'view_staff')
  const source = collection(getFirebaseDb(), 'users')
  const snapshot = user.companyCode
    ? await getDocs(query(source, where('companyCode', '==', user.companyCode)))
    : await getDocs(source)

  return snapshot.docs.flatMap((record) => {
    const data = record.data()
    // Operations users are listed for visibility only: the staff Cloud Functions don't let managers change them.
    // Directors only see the reception admins they manage.
    if (user.role === 'director' ? data.role !== 'admin' : !['consultant', 'projectadmin', 'operations', 'admin'].includes(data.role)) return []
    // deleteUserAccount keeps the profile as a tombstone with status 'deleted'; its sign-in no longer exists.
    if (data.status === 'deleted') return []
    return [{
      id: record.id,
      name: data.name || data.displayName || '',
      email: data.email || '',
      role: data.role,
      status: data.status === 'inactive' || data.active === false ? 'inactive' : 'active',
      companyCode: data.companyCode,
      permissions: Array.isArray(data.permissions) ? data.permissions : undefined,
      phone: data.phone || '',
      phoneIsWhatsApp: data.phoneIsWhatsApp === true,
      phoneProvider: data.phoneProvider || '',
    } satisfies ManagedUser]
  })
}

/** Returns the new staff member's uid. */
export const createOperationsStaff = async (user: FullIdentity, values: StaffValues) => {
  assertPermission(user, 'manage_staff')
  if (functionsBaseUrl) {
    const result = await callStaffEndpoint<{ uid?: string }>('createPlatformUser', {
      ...values,
      companyCode: user.companyCode || values.companyCode || '',
      sendResetLink: true,
      sendEmail: true,
    })
    return String(result.uid || '')
  }
  const created = await addDoc(collection(getFirebaseDb(), 'users'), {
    ...values,
    companyCode: user.companyCode || values.companyCode || '',
    active: values.status === 'active',
    createdAt: serverTimestamp(),
    createdBy: user.uid,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
  return created.id
}

export const updateOperationsStaff = async (user: FullIdentity, id: string, values: StaffValues) => {
  assertPermission(user, 'manage_staff')
  if (id === user.uid && (values.role !== user.role || values.status === 'inactive')) throw new Error('self_lockout')
  // Your own access is never sent: the staff function rejects self permission changes, and leaving the field out
  // keeps whatever you have. Your name, phone and other details still save.
  if (id === user.uid) {
    const { permissions: _ownPermissions, ...ownDetails } = values
    values = ownDetails
  }
  if (functionsBaseUrl) {
    await callStaffEndpoint('updatePlatformUser', {
      uid: id,
      ...values,
      companyCode: user.companyCode || values.companyCode || '',
    })
    return
  }
  await updateDoc(doc(getFirebaseDb(), 'users', id), {
    ...values,
    companyCode: user.companyCode || values.companyCode || '',
    active: values.status === 'active',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

export const deleteOperationsStaff = async (user: FullIdentity, id: string) => {
  assertPermission(user, 'manage_staff')
  if (id === user.uid) throw new Error('self_delete')
  if (functionsBaseUrl) {
    await callStaffEndpoint('deleteUserAccount', { uid: id, reason: 'Removed from project staff' })
    return
  }
  await deleteDoc(doc(getFirebaseDb(), 'users', id))
}
