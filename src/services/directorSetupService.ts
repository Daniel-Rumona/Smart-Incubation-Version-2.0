import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { firebaseApp, getFirebaseAuth, getFirebaseDb, getFirebaseStorage } from '@/config/firebase'

export type DirectorSettingsInput = {
  consultantLabel: string
  hasDepartments: boolean
  hasBranches: boolean
  branchScopedManagement?: boolean
  smeOnboardingModel: 'self_application' | 'consultants_register_smes'
  assignmentModel: 'ops_assign_consultant' | 'consultant_self_assign'
  smeDivisionModel?: 'system_equal_random' | 'ops_assign_smes_to_consultants' | 'consultants_register_their_smes'
  interventionScopeModel: 'program_specific' | 'company_wide' | 'department_specific' | 'both'
}

export type DirectorSetupPayload = DirectorSettingsInput & { companyName: string, companyCode: string, logoUrl?: string }

export const cleanCompanyCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')
export const isValidCompanyCode = (value: string) => /^[A-Z0-9_-]{3,20}$/.test(cleanCompanyCode(value))

export type CompanyOverview = { exists: boolean, locked: boolean, ownedByMe: boolean, name: string, logoUrl: string }

/** What is already stored for a code, used to prefill and to warn early (the server enforces the real rules). */
export const getCompanyOverview = async (code: string, uid: string): Promise<CompanyOverview> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', cleanCompanyCode(code)))
  if (!snapshot.exists()) return { exists: false, locked: false, ownedByMe: false, name: '', logoUrl: '' }
  const data = snapshot.data()
  return {
    exists: true,
    locked: data.locked === true,
    ownedByMe: data.ownerUid === uid,
    name: String(data.name || data.companyName || ''),
    logoUrl: String(data.logoUrl || ''),
  }
}

/** The code is unavailable if another director owns it, or it exists with an owner that is not you. */
export const companyCodeConflict = (overview: CompanyOverview, providedByAdmin: boolean) =>
  overview.exists && !overview.ownedByMe && !providedByAdmin
    ? 'This company code is already in use by another organisation. Choose a different code.'
    : ''

export const uploadCompanyLogo = async (file: File) => {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You are not signed in.')
  const extension = file.name.split('.').pop()?.toLowerCase() || 'png'
  const storageRef = ref(getFirebaseStorage(), `company-logos/${user.uid}/${Date.now()}.${extension}`)
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/png' })
  return getDownloadURL(storageRef)
}

export const completeDirectorSetup = async (payload: DirectorSetupPayload) => {
  const callable = httpsCallable(getFunctions(firebaseApp, 'us-central1'), 'completeDirectorCompanySetup')
  try {
    await callable({ ...payload, companyCode: cleanCompanyCode(payload.companyCode) })
  } catch (error) {
    // Callable errors carry the server's plain-language message after the code.
    const message = error instanceof Error ? error.message.replace(/^[a-z-]+\/?\s*/i, '') : ''
    throw new Error(message || 'Your company setup could not be saved.')
  }
}
