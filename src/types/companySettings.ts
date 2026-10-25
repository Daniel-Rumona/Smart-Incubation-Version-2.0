export type AssignmentModel = 'ops_assign_consultant' | 'consultant_self_assign'
export type InterventionDeliveryRole = 'consultant' | 'projectadmin' | 'operations'

export const DEFAULT_INTERVENTION_DELIVERY_ROLES: InterventionDeliveryRole[] = ['consultant', 'projectadmin', 'operations']

export type SmeDivisionModel =
  | 'system_equal_random'
  | 'ops_assign_smes_to_consultants'
  | 'consultants_register_their_smes'

export type SystemSettingsRecord = {
  companyCode: string
  companyName?: string
  consultantLabel?: string
  hasDepartments?: boolean
  hasBranches?: boolean
  assignmentModel?: AssignmentModel
  smeDivisionModel?: SmeDivisionModel
  branchScopedManagement?: boolean
  interventionDeliveryRoles?: InterventionDeliveryRole[]
  /** Roles the director let manage departments/offices and the logo. */
  delegation?: { structure?: string[]; branding?: string[] }
  logoUrl?: string
  subscription?: { tier?: string; addOns?: string[] }
  locked?: boolean
  ownerUid?: string
  ownerEmail?: string
  createdAt?: unknown
  createdByUid?: string
  createdByEmail?: string
}

export type ChangeRequestStatus = 'pending' | 'approved' | 'declined'

export type SystemSettingsChangeRequest = {
  id: string
  companyCode: string
  companyName?: string
  requestedByUid: string
  requestedByEmail: string
  requestedAt?: Date
  status: ChangeRequestStatus
  reason: string
  adminResponse?: string
  reviewedAt?: Date
  reviewedByUid?: string
  reviewedByEmail?: string
  currentSettingsSnapshot?: SystemSettingsRecord | null
  requestedInterventionDeliveryRoles?: InterventionDeliveryRole[]
}
