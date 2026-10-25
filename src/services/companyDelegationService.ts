import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

/**
 * A director can hand day-to-day control of parts of the company set-up to project admins and operations:
 *   structure - add and edit departments and offices
 *   branding  - change the company logo
 * Stored on `companies/{code}.delegation = { structure: Role[], branding: Role[] }`. Everyone in the company can
 * always SEE departments, offices and the logo; delegation only grants the right to change them.
 */
export const DELEGABLE_ROLES = ['projectadmin', 'operations'] as const
export type DelegableRole = (typeof DELEGABLE_ROLES)[number]
export type DelegationArea = 'structure' | 'branding'
export type Delegation = Record<DelegationArea, DelegableRole[]>

export const ROLE_LABELS: Record<DelegableRole, string> = { projectadmin: 'Project admins', operations: 'Operations' }
export const AREA_LABELS: Record<DelegationArea, { title: string; description: string }> = {
  structure: { title: 'Departments and offices', description: 'Add and edit the departments and offices of your company.' },
  branding: { title: 'Company logo', description: 'Upload or replace the company logo shown across the workspace.' },
}

const isDelegable = (value: unknown): value is DelegableRole => DELEGABLE_ROLES.includes(value as DelegableRole)

export const readDelegation = (settings: { delegation?: unknown } | null | undefined): Delegation => {
  const raw = (settings?.delegation || {}) as Partial<Record<DelegationArea, unknown>>
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isDelegable) : [])
  return { structure: list(raw.structure), branding: list(raw.branding) }
}

/** Directors (and platform admins) always manage; project admins and operations only when delegated to. */
export const canManageArea = (role: string | undefined, settings: { delegation?: unknown } | null | undefined, area: DelegationArea) => {
  if (role === 'director' || role === 'admin' || role === 'systemadmin') return true
  return isDelegable(role) && readDelegation(settings)[area].includes(role)
}

export const saveDelegation = async (user: FullIdentity, companyCode: string, delegation: Delegation) => {
  if (user.role !== 'director' || user.companyCode !== companyCode) throw new Error('forbidden')
  await updateDoc(doc(getFirebaseDb(), 'companies', companyCode), {
    delegation: { structure: delegation.structure.filter(isDelegable), branding: delegation.branding.filter(isDelegable) },
    updatedAt: serverTimestamp(),
    updatedByUid: user.uid,
  })
}

export const saveCompanyLogo = async (user: FullIdentity, companyCode: string, file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
  const storageRef = ref(getFirebaseStorage(), `company-logos/${user.uid}/${Date.now()}.${extension}`)
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' })
  const logoUrl = await getDownloadURL(storageRef)
  await updateDoc(doc(getFirebaseDb(), 'companies', companyCode), { logoUrl, updatedAt: serverTimestamp(), updatedByUid: user.uid })
  return logoUrl
}
