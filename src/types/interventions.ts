import type { Timestamp } from 'firebase/firestore'

export type StatusFilter = 'All' | 'Pending' | 'In progress' | 'Completed' | 'Rejected'
export type UpdateMode = 'manual' | 'ai'
export type TargetType = 'percentage' | 'number'
export type DeliveryActorType = 'human' | 'agent'

export type FirestoreDate = Timestamp | Date | string | number | null | undefined

export type ProgressStep = {
  createdAt?: unknown
  actorUid?: string | null
  actorRole?: string | null
  source?: UpdateMode
  hoursAdded?: number
  unitsAdded?: number
  progressBefore?: number
  progressAfter?: number
  timeSpentBefore?: number
  timeSpentAfter?: number
  targetActualBefore?: number
  targetActualAfter?: number | null
  notes?: string
  evidenceFiles?: string[]
}

export type AssignedInterventionLike = {
  id: string
  interventionId?: string
  interventionTitle?: string
  /** @deprecated Legacy field, replaced by `businessName`. See scripts/FIELD_MIGRATIONS.md. Kept only so older unmigrated documents still type-check. */
  beneficiaryName?: string
  beneficiaryEmail?: string
  businessName?: string
  participantName?: string
  email?: string
  participantId?: string
  programId?: string
  programName?: string
  companyCode?: string
  groupId?: string | null
  groupName?: string
  assigneeId?: string
  assigneeName?: string
  assigneeEmail?: string
  assigneeStatus?: string
  participantStatus?: string
  assigneeCompletionStatus?: string
  participantCompletionStatus?: string
  deliveryActorType?: DeliveryActorType
  status?: string
  dueDate?: FirestoreDate
  implementationDate?: FirestoreDate
  assignedAt?: FirestoreDate
  createdAt?: FirestoreDate
  updatedAt?: FirestoreDate
  completedAt?: FirestoreDate
  progress?: number
  timeSpent?: number
  targetType?: TargetType | string
  targetMetric?: string
  targetValue?: number
  targetActual?: number
  notes?: string
  areaOfSupport?: string
  snapshot?: {
    interventionTitle?: string
    businessName?: string
    programName?: string
  }
  progressSteps?: ProgressStep[]
  assignedStepId?: string
  assignedStepTitle?: string
  stepIndex?: number
  stepCount?: number
}

export type AssignedIntervention = AssignedInterventionLike

export type InterventionCompletionRecord = {
  id: string
  assignmentId?: string
  interventionId?: string
  participantId?: string
  participantName?: string
  programId?: string
  programName?: string
  completedAt?: FirestoreDate
  confirmedAt?: FirestoreDate
  status?: string
  completionStatus?: string
  feedback?: string
  evidenceUrls?: string[]
  createdAt?: FirestoreDate
  updatedAt?: FirestoreDate
}

export type InterventionRow = {
  id: string
  title: string
  beneficiaryName: string
  programmeName?: string
  programmeId?: string
  assigneeStatus: string
  participantStatus: string
  completionStatus: string
  status: StatusFilter
  dueDate?: unknown
  progress: number
  raw: AssignedInterventionLike
  localOnly?: boolean
}

export type ProgressUpdateForm = {
  hoursAdded?: number
  unitsAdded?: number
  progressAfter?: number
  notes?: string
  evidenceFiles?: string[]
}

export type AiReview = {
  summary: string
  polishedNotes: string
  suggestedHours?: number
  suggestedUnits?: number
  suggestedProgress?: number
  confidence?: number
  completionReadiness: 'not_ready' | 'close' | 'ready'
  warnings: string[]
  blockers: string[]
  nextSteps: string[]
  proofSuggestions: Array<{
    id: string
    label: string
    reason: string
    required: boolean
  }>
}
