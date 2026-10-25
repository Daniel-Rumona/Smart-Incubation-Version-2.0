import { deleteField, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'

/**
 * Programme links: `/join/<programId>`. A link carries the programme (and so the company) an SME is joining,
 * so SMEs who arrive through one never pick a company or a role. The programme is remembered across sign-up and
 * email verification, then the server attaches the SME to it (see functions/src/programJoin.ts).
 */

const STORAGE_KEY = 'smart-incubation:pending-program-link'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export const buildProgramLink = (programId: string) => `${window.location.origin}/join/${encodeURIComponent(programId)}`

export const savePendingProgramLink = (programId: string) => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ programId, savedAt: Date.now() }))
  } catch {
    // Private windows or blocked storage: the SME simply falls back to choosing a company during onboarding.
  }
}

export const readPendingProgramLink = (): string => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as { programId?: unknown; savedAt?: unknown }
    const age = Date.now() - Number(parsed.savedAt || 0)
    if (typeof parsed.programId !== 'string' || !parsed.programId || age > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY)
      return ''
    }
    return parsed.programId
  } catch {
    return ''
  }
}

export const clearPendingProgramLink = () => {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

/**
 * Copies a programme link opened in this browser onto the signed-in account, so it survives finishing
 * sign-up on another device (e.g. verifying email on a phone) or cleared browser storage.
 */
export const rememberProgramLinkOnAccount = async (uid: string) => {
  const programId = readPendingProgramLink()
  if (!programId) return
  await updateDoc(doc(getFirebaseDb(), 'users', uid), {
    pendingProgramLink: { programId, savedAt: serverTimestamp() },
  }).catch(() => undefined)
}

/** Forgets the programme link everywhere once it has been used (or turned out to be unusable). */
export const forgetProgramLink = async (uid: string) => {
  clearPendingProgramLink()
  await updateDoc(doc(getFirebaseDb(), 'users', uid), { pendingProgramLink: deleteField() }).catch(() => undefined)
}

/** Accepts a full programme link (…/join/<id>) or a bare programme id, as pasted by an SME. */
export const parseProgramLink = (input: string) => {
  const value = input.trim()
  const fromUrl = value.match(/\/join\/([^/?#\s]+)/)?.[1]
  const id = decodeURIComponent(fromUrl || value)
  return /^[A-Za-z0-9_-]{4,}$/.test(id) ? id : ''
}

export type ProgramLinkInfo = {
  programId: string
  programName: string
  companyName: string
  logoUrl: string
  open: boolean
  selfApplication: boolean
}

const callable = <Input, Output>(name: string) => httpsCallable<Input, Output>(getFunctions(firebaseApp, 'us-central1'), name)

/** Callable errors carry the server's plain-language message; strip the technical prefix. */
export const callableMessage = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message.replace(/^[a-z-]+\/?\s*/i, '').trim() : ''
  return message || fallback
}

export const getProgramLinkInfo = async (programId: string): Promise<ProgramLinkInfo> =>
  (await callable<{ programId: string }, ProgramLinkInfo & { ok: boolean }>('getProgramJoinInfo')({ programId })).data

export type JoinPath = 'program_link' | 'company_program' | 'open_program' | 'marketplace' | 'skip'
export type JoinRequest = { path: JoinPath; programId?: string; companyCode?: string; consultingBudget?: number; wantsSpecificProgram?: boolean }
export type JoinResult = { companyCode: string; companyName: string; programId: string; programName: string }

export const joinProgramAsSme = async (request: JoinRequest): Promise<JoinResult> =>
  (await callable<JoinRequest, JoinResult & { ok: boolean }>('joinProgramAsSme')(request)).data
