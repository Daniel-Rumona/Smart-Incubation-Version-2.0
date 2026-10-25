import type { FirestoreDate } from '@/types/interventions'
import type { SwotItem } from '@/utils/swotOutcomes'
import type { InterventionDeliveryStrategy } from '@/types/agentOrchestration'

export type IncubateeInterventionStatus =
  | 'Pending Assignment'
  | 'Awaiting Facilitator'
  | 'Not Started'
  | 'In Progress'
  | 'Awaiting Confirmation'
  | 'Completed'
  | 'Declined'
  | 'Rejected'

export type IncubateeResource = {
  type: 'document' | 'link'
  label: string
  link: string
}

export type IncubateeIntervention = {
  id: string
  interventionId: string
  participantId: string
  programId?: string
  title: string
  description?: string
  areaOfSupport?: string
  assigneeName?: string
  assigneeEmail?: string
  deliveryActorType?: 'human' | 'agent'
  deliveryStrategy?: InterventionDeliveryStrategy
  agentId?: string
  agentName?: string
  reviewRequired?: boolean
  reviewerType?: 'operations' | 'consultant'
  reviewStatus?: string
  agentWorkStatus?: string
  dueDate?: FirestoreDate
  progress: number
  status: IncubateeInterventionStatus
  resources: IncubateeResource[]
  feedback?: { rating?: number, comments?: string }
  raw: Record<string, unknown>
}

export type IncubateeRequiredIntervention = {
  id: string
  title: string
  areaOfSupport?: string
  executionMode?: 'single_session' | 'multi_step'
  steps?: Array<{ id?: string, title?: string, description?: string }>
}

export type IncubateeFormAssignment = {
  id: string
  kind: 'survey' | 'assessment'
  title: string
  status: string
  dueAt?: FirestoreDate
  updatedAt?: FirestoreDate
}

export type IncubateeNotification = {
  id: string
  type?: string
  title: string
  createdAt?: FirestoreDate
  read: boolean
}

export type IncubateeWorkspace = {
  participantId: string
  applicationId: string
  programId?: string
  programName?: string
  businessName: string
  growthPlanConfirmed: boolean
  growthPlanAvailable: boolean
  operationsPlanConfirmation?: { name?: string, email?: string, signatureURL?: string, confirmedAt?: string }
  participantPlanConfirmation?: { name?: string, email?: string, signatureURL?: string, confirmedAt?: string }
  outstandingDocuments: number
  requiredInterventions: IncubateeRequiredIntervention[]
  swotItems: SwotItem[]
  assignedInterventions: IncubateeIntervention[]
  requests: IncubateeInterventionRequest[]
  forms: IncubateeFormAssignment[]
  notifications: IncubateeNotification[]
}

export type IncubateeInterventionRequest = {
  id: string
  areaOfSupport: string
  interventionTitle: string
  reason: string
  status: string
}

export type IncubateeInterventionAppointment = {
  id: string
  startTime?: FirestoreDate
  endTime?: FirestoreDate
  status: string
  meetingType?: string
  location?: string
  meetingLink?: string
  discussionSummary?: string
}
