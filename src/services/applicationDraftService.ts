import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import type { ApplicationFormValues } from '@/types/application'

/**
 * An in-progress programme application, saved as the SME answers so they can leave and pick up
 * where they stopped (on this device instantly, on any device once the Firestore copy lands).
 * Uploaded files aren't kept: a File can't be stored here, so documents are picked again.
 */
export type ApplicationDraft = {
    values: ApplicationFormValues
    interventionSelections: Record<string, string[]>
    savedAt: number
}

const draftId = (uid: string, programId: string) => `${uid}_${programId}`
const localKey = (uid: string, programId: string) => `applicationDraft:${draftId(uid, programId)}`

// Firestore rejects `undefined`; a JSON round-trip drops it.
const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null))

const readLocal = (uid: string, programId: string): ApplicationDraft | null => {
    try {
        const raw = localStorage.getItem(localKey(uid, programId))
        return raw ? JSON.parse(raw) as ApplicationDraft : null
    } catch {
        return null
    }
}

export const saveDraftLocally = (uid: string, programId: string, draft: ApplicationDraft) => {
    try {
        localStorage.setItem(localKey(uid, programId), JSON.stringify(draft))
    } catch {
        // Private mode or full storage: the Firestore copy still saves.
    }
}

export const saveDraftRemotely = async (uid: string, programId: string, draft: ApplicationDraft) => {
    await setDoc(doc(db, 'applicationDrafts', draftId(uid, programId)), {
        uid,
        programId,
        values: clean(draft.values),
        interventionSelections: clean(draft.interventionSelections),
        savedAt: draft.savedAt,
        updatedAt: serverTimestamp(),
    })
}

/** The newer of the device copy and the Firestore copy. */
export const loadDraft = async (uid: string, programId: string): Promise<ApplicationDraft | null> => {
    const local = readLocal(uid, programId)
    let remote: ApplicationDraft | null = null
    try {
        const snap = await getDoc(doc(db, 'applicationDrafts', draftId(uid, programId)))
        if (snap.exists()) {
            const data = snap.data()
            remote = {
                values: (data.values || {}) as ApplicationFormValues,
                interventionSelections: (data.interventionSelections || {}) as Record<string, string[]>,
                savedAt: Number(data.savedAt) || 0,
            }
        }
    } catch {
        // Offline or not allowed yet: fall back to the device copy.
    }
    if (local && remote) return local.savedAt >= remote.savedAt ? local : remote
    return local || remote
}

export const clearDraft = async (uid: string, programId: string) => {
    try { localStorage.removeItem(localKey(uid, programId)) } catch { /* nothing stored */ }
    await deleteDoc(doc(db, 'applicationDrafts', draftId(uid, programId))).catch(() => undefined)
}
