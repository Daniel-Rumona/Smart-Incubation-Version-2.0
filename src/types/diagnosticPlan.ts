import type { OperationsParticipant } from '@/types/operationsParticipant'
import type { SwotItem } from '@/utils/swotOutcomes'

export type DiagnosticPlanIntervention = {
  interventionId: string
  title: string
  areaOfSupport?: string
  executionMode?: 'single_session' | 'multi_step'
  steps?: Array<{ id?: string, title?: string, description?: string, weight?: number }>
}

export type DiagnosticConfirmationMeta = {
  uid?: string
  name?: string
  email?: string
  signatureURL?: string
  confirmedAt?: string
}

export type DiagnosticSwot = {
  strengths: string[]
  weaknesses: string[]
  opportunities: string[]
  threats: string[]
}

export type DiagnosticInterventionOption = DiagnosticPlanIntervention

export type DiagnosticPlan = {
  id: string
  participantId: string
  applicationId: string
  programId?: string
  status: 'Draft' | 'Confirmed'
  interventions: DiagnosticPlanIntervention[]
  confirmedBy?: Record<string, unknown>
  confirmedMeta?: {
    operations?: DiagnosticConfirmationMeta
    participant?: DiagnosticConfirmationMeta
    incubatee?: DiagnosticConfirmationMeta
    sme?: DiagnosticConfirmationMeta
  }
  confirmedAt?: string
}

export type DiagnosticApplicationSummary = {
  motivation?: string
  challenges?: string
  complianceScore?: number | string
  aiScore?: number | string
  aiRecommendation?: string
  aiJustification?: string
  recommendedInterventions?: Record<string, unknown>
  aiEvaluation?: Record<string, unknown>
  submittedAt?: unknown
}

export type DiagnosticPlanParticipant = OperationsParticipant & {
  plan: DiagnosticPlan
  swot: DiagnosticSwot
  swotItems: SwotItem[]
  applicationSummary: DiagnosticApplicationSummary
  aiRecommendation?: Record<string, unknown>
}
