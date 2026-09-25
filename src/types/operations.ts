import type { UserRole } from '@/config/roles'
import type { IdentityPermission } from '@/types/identity'

export type OperationsApplication = {
  id: string
  businessName: string
  email: string
  gender?: string
  ageGroup?: string
  stage?: string
  hub?: string
  province?: string
  beeLevel?: string
  complianceScore?: number
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
  documents: Array<{ type?: string, url?: string }>
  growthPlanDocUrl?: string
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
}
