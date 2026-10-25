import { confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/config/firebase'
import { loginUser } from '@/services/authService'

/** Email address the password link was issued for; throws when the code has expired or was already used. */
export const readPasswordActionEmail = (code: string) => verifyPasswordResetCode(getFirebaseAuth(), code)

/**
 * Sets the password from an invite or reset link, signs the person in, and marks the password as chosen so the
 * welcome flow doesn't ask for it a second time.
 */
export const completePasswordAction = async (code: string, email: string, password: string) => {
  await confirmPasswordReset(getFirebaseAuth(), code, password)
  const session = await loginUser(email, password)
  const updates = {
    mustChangePassword: false,
    passwordChangedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  await Promise.all([
    setDoc(doc(getFirebaseDb(), 'users', session.user.uid), updates, { merge: true }),
    setDoc(doc(getFirebaseDb(), 'userIdentities', session.user.uid), updates, { merge: true }),
  ])
  return session.profile
}
