import { browserLocalPersistence, browserSessionPersistence, setPersistence } from 'firebase/auth'
import { getFirebaseAuth } from '@/config/firebase'

/**
 * How this device remembers a sign-in, chosen on the sign-in form and changeable in the account window. It belongs
 * to the device (a home laptop and a shared office PC deserve different answers), so it lives in localStorage.
 *  - keep:    stay signed in; opening the site goes straight to the workspace.
 *  - ask:     stay signed in, but the landing page asks "Continue as …?" first (the default).
 *  - session: signed out when the browser closes; details are entered next time.
 */
export type SignInPreference = 'keep' | 'ask' | 'session'

const STORAGE_KEY = 'smart.signInPreference'

export const getSignInPreference = (): SignInPreference => {
    try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        return stored === 'keep' || stored === 'session' ? stored : 'ask'
    } catch {
        return 'ask'
    }
}

/** Saves the choice and tells Firebase how long to keep the session. Works before signing in or while signed in. */
export const applySignInPreference = async (preference: SignInPreference) => {
    try {
        window.localStorage.setItem(STORAGE_KEY, preference)
    } catch {
        // Storage unavailable (private window): the persistence below still applies for this visit.
    }
    await setPersistence(getFirebaseAuth(), preference === 'session' ? browserSessionPersistence : browserLocalPersistence)
}

/** Whether this device has been asked yet. The sign-in form asks once; after that it's changed in the account window. */
export const hasSignInPreference = () => {
    try {
        return window.localStorage.getItem(STORAGE_KEY) !== null
    } catch {
        return false
    }
}
