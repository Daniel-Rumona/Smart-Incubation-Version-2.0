import { getFirebaseAuth } from '@/config/firebase'
import type { IncubateeWorkspace } from '@/types/incubatee'

export const PLAN_READY_PATH = '/incubatee/plan-ready'

/**
 * "Your growth plan is ready" opens once per sign-in until the SME confirms. The sign-in time
 * is part of the key, so the next sign-in shows it again while a reload or a later visit to the
 * dashboard in the same sign-in does not.
 */
const promptKey = (uid: string) => {
    const signedInAt = getFirebaseAuth().currentUser?.metadata.lastSignInTime || ''
    return `planReadyPrompt:${uid}:${signedInAt}`
}

export const shouldShowPlanReady = (workspace: IncubateeWorkspace | null | undefined, uid?: string) => {
    if (!workspace || !uid || !workspace.growthPlanAvailable || workspace.growthPlanConfirmed) return false
    try {
        return window.sessionStorage.getItem(promptKey(uid)) !== 'shown'
    } catch {
        // Storage can be blocked (private mode); then the dashboard reminder is enough.
        return false
    }
}

export const markPlanReadyShown = (uid?: string) => {
    if (!uid) return
    try {
        window.sessionStorage.setItem(promptKey(uid), 'shown')
    } catch {
        // Nothing to remember without storage; the page simply may show again.
    }
}
