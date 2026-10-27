import { getFirebaseAuth } from '@/config/firebase'

export const FINISH_PROFILE_PATH = '/incubatee/profile?finish=1'

/**
 * SMEs added by their programme team (one by one or from a sheet) start with only a name, business and email.
 * Their business profile opens once per sign-in until it is complete; the dashboard keeps a reminder meanwhile.
 * Same once-per-sign-in key as the growth plan prompt (utils/planReadyPrompt).
 */
const promptKey = (uid: string) => {
    const signedInAt = getFirebaseAuth().currentUser?.metadata.lastSignInTime || ''
    return `finishProfilePrompt:${uid}:${signedInAt}`
}

export const shouldShowFinishProfile = (missingCount: number | undefined, uid?: string) => {
    if (!uid || !missingCount) return false
    try {
        return window.sessionStorage.getItem(promptKey(uid)) !== 'shown'
    } catch {
        // Storage can be blocked (private mode); then the dashboard reminder is enough.
        return false
    }
}

export const markFinishProfileShown = (uid?: string) => {
    if (!uid) return
    try {
        window.sessionStorage.setItem(promptKey(uid), 'shown')
    } catch {
        // Nothing to remember without storage; the page simply may open again.
    }
}
