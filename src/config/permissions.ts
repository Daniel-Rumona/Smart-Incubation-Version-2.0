import { USER_ROLES, type UserRole } from '@/config/roles'
import type { IdentityPermission } from '@/types/identity'

const allPermissions: IdentityPermission[] = [
  'view_dashboard',
  'view_users',
  'manage_users',
  'view_reports',
  'manage_programs',
  'manage_interventions',
  'assign_interventions',
  'track_interventions',
  'view_diagnostic_plans',
  'manage_diagnostic_plans',
  'view_applications',
  'manage_applications',
  'view_compliance',
  'manage_compliance',
  'view_participants',
  'view_staff',
  'manage_staff',
  'view_usage_analytics',
  'view_email_operations',
]

export const ROLE_PERMISSIONS: Record<UserRole, IdentityPermission[]> = {
  [USER_ROLES.SYSTEM_ADMIN]: allPermissions,
  // Company reception: sees applications, intake and the SME directory, and keeps the calendar (track_interventions
  // opens Appointments). What reception may change on each page is limited in the page and in firestore.rules.
  [USER_ROLES.ADMIN]: ['view_dashboard', 'view_applications', 'view_participants', 'track_interventions'],
  [USER_ROLES.DIRECTOR]: ['view_dashboard', 'view_reports', 'view_applications'],
  [USER_ROLES.PROJECT_ADMIN]: ['view_dashboard', 'view_reports', 'manage_programs', 'manage_interventions', 'assign_interventions', 'track_interventions', 'view_diagnostic_plans', 'manage_diagnostic_plans', 'view_applications', 'manage_applications', 'view_compliance', 'manage_compliance', 'view_participants', 'view_staff', 'manage_staff'],
  [USER_ROLES.PROJECT_MANAGER]: ['view_dashboard', 'view_reports', 'manage_programs', 'manage_interventions', 'assign_interventions', 'track_interventions', 'view_diagnostic_plans', 'manage_diagnostic_plans', 'view_applications', 'view_participants'],
  [USER_ROLES.OPERATIONS]: ['view_dashboard', 'view_reports', 'manage_programs', 'manage_interventions', 'assign_interventions', 'track_interventions', 'view_diagnostic_plans', 'manage_diagnostic_plans', 'view_applications', 'manage_applications', 'view_compliance', 'manage_compliance', 'view_participants', 'view_staff', 'manage_staff'],
  [USER_ROLES.CONSULTANT]: ['view_dashboard', 'track_interventions', 'view_diagnostic_plans'],
  [USER_ROLES.INCUBATEE]: ['view_dashboard'],
}

export const getRolePermissions = (role: UserRole) => ROLE_PERMISSIONS[role] ?? []

export const FEATURE_PERMISSION_OPTIONS: Array<{ value: IdentityPermission, labelKey: string }> = [
  { value: 'assign_interventions', labelKey: 'permissions.assignInterventions' },
  { value: 'track_interventions', labelKey: 'permissions.trackInterventions' },
  { value: 'view_diagnostic_plans', labelKey: 'permissions.viewDiagnosticPlans' },
  { value: 'manage_diagnostic_plans', labelKey: 'permissions.manageDiagnosticPlans' },
  { value: 'view_applications', labelKey: 'permissions.viewApplications' },
  { value: 'manage_applications', labelKey: 'permissions.manageApplications' },
  { value: 'view_participants', labelKey: 'permissions.viewParticipants' },
  { value: 'view_compliance', labelKey: 'permissions.viewCompliance' },
  { value: 'manage_compliance', labelKey: 'permissions.manageCompliance' },
  { value: 'view_reports', labelKey: 'permissions.viewReports' },
]

const isIdentityPermission = (permission: unknown): permission is IdentityPermission => {
  return typeof permission === 'string' && allPermissions.includes(permission as IdentityPermission)
}

export const resolveIdentityPermissions = (role: UserRole, storedPermissions: unknown) => {
  if (!Array.isArray(storedPermissions)) return getRolePermissions(role)
  return storedPermissions.filter(isIdentityPermission)
}

export const hasRolePermission = (role: UserRole, permission: IdentityPermission, permissions?: IdentityPermission[]) => {
  return (permissions || getRolePermissions(role)).includes(permission)
}
