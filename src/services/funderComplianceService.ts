import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '@/config/firebase'

/**
 * Compliance for funders, as counts only (functions/src/funderCompliance.ts). Funders can't read compliance documents,
 * which link to uploaded IDs and certificates, so the server works the summary out and returns no names or files.
 */

export type FunderComplianceSummary = {
  total: number
  compliant: number
  expiring: number
  missing: number
  missingDocuments: Array<{ name: string; smes: number }>
}

/** For a funder organisation, `implementor` narrows the summary to one company ('all' or empty = every implementor). */
export const loadFunderCompliance = async (programId?: string | null, implementor?: string | null) => {
  const callable = httpsCallable<{ programId: string | null; implementor: string | null }, FunderComplianceSummary>(getFunctions(firebaseApp, 'us-central1'), 'getFunderComplianceSummary')
  return (await callable({ programId: programId && programId !== 'all' ? programId : null, implementor: implementor && implementor !== 'all' ? implementor : null })).data
}
