import type { UserRole } from '@/config/roles'
import type { IdentityPermission } from '@/types/identity'

export type OperationsApplication = {
  id: string
  businessName: string
  email: string
  imageUrl?: string
  gender?: string
  ageGroup?: string
  stage?: string
  hub?: string
  province?: string
  beeLevel?: string
  complianceScore?: number
  programId?: string
  participantId?: string
  programName?: string
  companyCode?: string
  applicationStatus: string
  aiScore?: number | string
  aiRecommendation?: string
  aiJustification?: string
  supportFitStatus?: string
  unmatchedNeeds?: Array<{ title?: string, reason?: string }>
  externalInterventionSuggestions?: Array<{ title?: string, reason?: string, status?: string }>
  motivation?: string
  challenges?: string
  submittedAt?: unknown
  /** When the application was accepted or rejected. Older decisions fall back to the last update. */
  decidedAt?: unknown
  documents: Array<{ type?: string, url?: string }>
  growthPlanDocUrl?: string
  rejectionReason?: string
}

export type ManagedUser = {
  id: string
  name: string
  email: string
  role: UserRole
  status: 'active' | 'inactive'
  companyCode?: string
  permissions?: IdentityPermission[]
  photoUrl?: string
  phone?: string
  alternativePhone?: string
  phoneIsWhatsApp?: boolean
  alternativePhoneIsWhatsApp?: boolean
  phoneProvider?: string
  /** Programmes this person works on (project admins, consultants) or funds (funders). Empty = all the company's. */
  assignedProgramIds?: string[]
  /**
   * Funders only: the funder organisation they belong to (no company; they see what its accepted links cover).
   * '' saves them as a funder of one company. Only system admins set it.
   */
  funderOrgId?: string | null
  funderOrgName?: string
}
