import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { listMyApplications } from '@/services/applicantService'

/**
 * The programme an SME chose at sign-up (from a programme link or the company picker) that they have not applied
 * to yet, or '' when there is none. Used to carry them from the finished profile straight into the application.
 */
export const getNextProgramToApply = async (uid: string): Promise<string> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'users', uid))
  const chosen = String(snapshot.data()?.smeOnboarding?.selectedProgramId || '').trim()
  if (!chosen) return ''
  // Only the lookups the security rules allow an SME (a wider search is refused and would hide the programme).
  const applications = await listMyApplications(uid)
  return applications.some((application) => application.programId === chosen) ? '' : chosen
}

/** True when the programme has no application: the SME joins as soon as their profile is complete. */
export const isDirectProgram = async (programId: string): Promise<boolean> => {
  if (!programId) return false
  const snapshot = await getDoc(doc(getFirebaseDb(), 'programs', programId))
  return snapshot.data()?.intakeMode === 'direct'
}
