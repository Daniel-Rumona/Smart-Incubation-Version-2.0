import type { InterventionDeliveryRole } from '@/types/companySettings'

// Company setup settings a director can ask the platform admin to change, and their options.
export type SetupSettingKey =
  | 'assignmentModel'
  | 'smeDivisionModel'
  | 'interventionDeliveryRoles'
  | 'consultantLabel'
  | 'hasDepartments'
  | 'hasBranches'
  | 'branchScopedManagement'
  | 'other'

// Labels are English: they go into the request the platform admin reads. The modal translates them for display.
export const SETUP_SETTINGS: Record<SetupSettingKey, string> = {
  assignmentModel: 'Who assigns interventions',
  smeDivisionModel: 'How SMEs are divided among facilitators',
  interventionDeliveryRoles: 'Who delivers interventions',
  consultantLabel: 'What you call facilitators',
  hasDepartments: 'Departments',
  hasBranches: 'Branches or offices',
  branchScopedManagement: 'Managers see only their own branch',
  other: 'Something else',
}

export const ASSIGNMENT_OPTIONS: Record<string, string> = {
  ops_assign_consultant: 'Operations assigns facilitators',
  consultant_self_assign: 'Facilitators pick their own',
}

export const DIVISION_OPTIONS: Record<string, string> = {
  system_equal_random: 'The system divides SMEs equally',
  ops_assign_smes_to_consultants: 'Operations assigns SMEs to facilitators',
  consultants_register_their_smes: 'Facilitators manage the SMEs they register',
}

export const DELIVERY_ROLE_LABELS: Record<InterventionDeliveryRole, string> = {
  consultant: 'Facilitators',
  projectadmin: 'Project admins',
  operations: 'Operations',
}

const YES_NO: Record<string, string> = { yes: 'Yes', no: 'No' }
export const OPTIONS_FOR: Partial<Record<SetupSettingKey, Record<string, string>>> = {
  assignmentModel: ASSIGNMENT_OPTIONS,
  smeDivisionModel: DIVISION_OPTIONS,
  hasDepartments: YES_NO,
  hasBranches: YES_NO,
  branchScopedManagement: YES_NO,
}
