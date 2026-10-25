import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { listApplicantApplications } from '@/services/applicantService'

/**
 * The programme an SME chose at sign-up (from a programme link or the company picker) that they have not applied
 * to yet, or '' when there is none. Used to carry them from the finished profile straight into the application.
 */
export const getNextProgramToApply = async (uid: string, email: string): Promise<string> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'users', uid))
  const chosen = String(snapshot.data()?.smeOnboarding?.selectedProgramId || '').trim()
  if (!chosen) return ''
  const applications = await listApplicantApplications(uid, email)
  return applications.some((application) => application.programId === chosen) ? '' : chosen
}
