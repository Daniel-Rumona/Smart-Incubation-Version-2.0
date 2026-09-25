import type { UserRole } from '@/config/roles'

export type IdentityPermission =
  | 'view_dashboard'
  | 'view_users'
  | 'manage_users'
  | 'view_reports'
  | 'manage_programs'
  | 'manage_interventions'
  | 'assign_interventions'
  | 'track_interventions'
  | 'view_diagnostic_plans'
  | 'manage_diagnostic_plans'
  | 'view_applications'
  | 'manage_applications'
  | 'view_compliance'
  | 'manage_compliance'
  | 'view_participants'
  | 'view_staff'
  | 'manage_staff'
  | 'view_usage_analytics'
  | 'view_email_operations'

export type WorkspaceAudience = 'platform' | 'applicant' | 'incubatee' | 'operations'

export type FullIdentity = {
  uid: string
  email: string
  emailVerified: boolean
  displayName: string
  name?: string
  role: UserRole
  isApplicant: boolean
  firstLoginComplete: boolean
  mustChangePassword?: boolean
  companyCode?: string | null
  branchId?: string | null
  departmentId?: string | null
  signatureURL?: string | null
  profileImageUrl?: string | null
  assignedProgramIds: string[]
  permissions: IdentityPermission[]
  consultingBudget?: number
  smeOnboardingComplete: boolean
}
