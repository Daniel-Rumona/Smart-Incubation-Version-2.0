import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '@/config/firebase'

/**
 * Facilitators picking up their own work. The list and the pick-up run in Cloud Functions
 * (functions/src/availableWork.ts): facilitators can't read applications or growth plans, and the server enforces
 * their programmes and areas of support and makes sure only the first pick-up wins.
 */

export type AvailableWorkItem = {
  participantId: string
  smeName: string
  programId: string | null
  programName: string | null
  interventionId: string
  title: string
  area: string | null
  stepId: string | null
  stepTitle: string | null
  stepNumber: number | null
  stepCount: number | null
}

/** Why there's no work at all: the company doesn't use pick-up, facilitators don't deliver, or no areas are set. */
export type AvailableWorkBlock = 'not_enabled' | 'not_delivery_role' | 'no_areas'

const functions = () => getFunctions(firebaseApp, 'us-central1')

export const listAvailableWork = async () => {
  const callable = httpsCallable<void, { block: AvailableWorkBlock | null, items: AvailableWorkItem[] }>(functions(), 'listFacilitatorAvailableWork')
  return (await callable()).data
}

export const claimWork = async (item: AvailableWorkItem) => {
  const callable = httpsCallable<{ participantId: string, interventionId: string, stepId: string | null }, { assignmentId: string }>(functions(), 'claimFacilitatorWork')
  return (await callable({ participantId: item.participantId, interventionId: item.interventionId, stepId: item.stepId })).data
}

/** The pick-up lost the race (or the work stopped being theirs); the list should reload. */
export const isAlreadyTaken = (error: unknown) => String((error as { code?: string })?.code || '').endsWith('already-exists')
