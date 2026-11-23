import { useCallback } from 'react'
import { doc, updateDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import type { UiMode } from '@/types/identity'

/** SMEs who have not picked a view get Simple view. */
export const DEFAULT_UI_MODE: UiMode = 'simple'

/**
 * The view an SME picked for their pages (Simple or Full). It is saved on their own users record, so it follows them
 * across devices; the in-memory identity is patched first so the page switches straight away.
 */
export const useUiMode = () => {
    const { user, updateIdentity } = useFullIdentity()
    const mode: UiMode = user?.uiMode ?? DEFAULT_UI_MODE

    const setMode = useCallback(async (next: UiMode) => {
        if (!user) return
        const previous = user.uiMode
        updateIdentity({ uiMode: next })
        try {
            await updateDoc(doc(getFirebaseDb(), 'users', user.uid), { uiMode: next })
        } catch (error) {
            updateIdentity({ uiMode: previous })
            throw error
        }
    }, [updateIdentity, user])

    return { mode, setMode }
}
