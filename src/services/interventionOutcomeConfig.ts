import type { InterventionOutcomeDefinition, InterventionOutcomeType } from '@/types/interventions'

/** The kind of change an intervention is meant to produce. Not the same thing as a deliverable. */
export const OUTCOME_TYPE_OPTIONS: Array<{ value: InterventionOutcomeType; label: string }> = [
  { value: 'capability_established', label: 'Capability established' },
  { value: 'process_implemented', label: 'Process implemented' },
  { value: 'behaviour_adopted', label: 'Behaviour adopted' },
  { value: 'compliance_achieved', label: 'Compliance achieved' },
  { value: 'risk_reduced', label: 'Risk reduced' },
  { value: 'performance_improved', label: 'Performance improved' },
  { value: 'access_achieved', label: 'Access achieved' },
  { value: 'issue_resolved', label: 'Issue resolved' },
]

type Suggestion = Required<Pick<InterventionOutcomeDefinition, 'outcomeType' | 'deliverableName' | 'intendedOutcome'>> & { followUpDays: number }

/** Keyword -> suggested defaults. First match wins; checked against title then area of support. */
const SUGGESTIONS: Array<{ keywords: string[]; suggestion: Suggestion }> = [
  { keywords: ['cash flow', 'cashflow'], suggestion: { outcomeType: 'process_implemented', deliverableName: 'Cash Flow Forecast', intendedOutcome: 'The SME actively maintains a forward-looking cash-flow forecast.', followUpDays: 60 } },
  { keywords: ['business plan'], suggestion: { outcomeType: 'capability_established', deliverableName: 'Business Plan', intendedOutcome: 'The SME has a current business plan that guides its decisions.', followUpDays: 90 } },
  { keywords: ['marketing', 'brand', 'sales'], suggestion: { outcomeType: 'process_implemented', deliverableName: 'Marketing Strategy', intendedOutcome: 'The SME runs a repeatable customer acquisition process.', followUpDays: 90 } },
  { keywords: ['popia', 'privacy'], suggestion: { outcomeType: 'compliance_achieved', deliverableName: 'POPIA Policy', intendedOutcome: 'The SME has closed its identified data-protection gaps.', followUpDays: 90 } },
  { keywords: ['compliance', 'tax', 'registration', 'cipc', 'sars'], suggestion: { outcomeType: 'compliance_achieved', deliverableName: 'Compliance Document', intendedOutcome: 'The SME has closed its identified compliance gaps.', followUpDays: 90 } },
  { keywords: ['legal', 'contract', 'agreement', 'shareholder'], suggestion: { outcomeType: 'issue_resolved', deliverableName: 'Signed Agreement', intendedOutcome: 'The legal matter is resolved and documented.', followUpDays: 60 } },
  { keywords: ['psycholog', 'wellbeing', 'resilience', 'mental'], suggestion: { outcomeType: 'behaviour_adopted', deliverableName: 'Support Plan', intendedOutcome: 'The founder adopts structured resilience and decision-management practices.', followUpDays: 60 } },
  { keywords: ['funding', 'finance access', 'investment', 'loan'], suggestion: { outcomeType: 'access_achieved', deliverableName: 'Funding Application', intendedOutcome: 'The SME gains access to suitable funding.', followUpDays: 90 } },
  { keywords: ['financial', 'bookkeeping', 'accounting'], suggestion: { outcomeType: 'process_implemented', deliverableName: 'Management Accounts', intendedOutcome: 'The SME keeps up-to-date financial records.', followUpDays: 60 } },
]

export const suggestOutcomeDefaults = (title?: unknown, area?: unknown): Suggestion | null => {
  const haystacks = [String(title || ''), String(area || '')].map((value) => value.toLowerCase())
  for (const haystack of haystacks) {
    if (!haystack) continue
    const match = SUGGESTIONS.find((entry) => entry.keywords.some((keyword) => haystack.includes(keyword)))
    if (match) return match.suggestion
  }
  return null
}

/** Drops blank fields; returns undefined when nothing meaningful was configured so legacy shape is preserved. */
export const cleanOutcomeDefinition = (value?: InterventionOutcomeDefinition | null): InterventionOutcomeDefinition | undefined => {
  if (!value) return undefined
  const text = (input?: string) => String(input || '').trim() || undefined
  const followUpDays = Number(value.followUpDays)
  const cleaned: InterventionOutcomeDefinition = {
    intendedOutcome: text(value.intendedOutcome),
    outcomeType: value.outcomeType || undefined,
    deliverableName: text(value.deliverableName),
    deliverableDescription: text(value.deliverableDescription),
    deliverableRequired: value.deliverableRequired ? true : undefined,
    followUpDays: Number.isFinite(followUpDays) && followUpDays > 0 ? Math.round(followUpDays) : undefined,
  }
  const hasContent = Object.values(cleaned).some((entry) => entry !== undefined)
  if (!hasContent) return undefined
  return Object.fromEntries(Object.entries(cleaned).filter(([, entry]) => entry !== undefined)) as InterventionOutcomeDefinition
}

type AssignmentRecord = Record<string, unknown>

const asDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return value
  if (typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
  const parsed = new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** True when any progress update or an operations close-out attached evidence files. */
export const hasDeliverableEvidence = (assignment: AssignmentRecord) => {
  const steps = Array.isArray(assignment.progressSteps) ? assignment.progressSteps as Array<{ evidenceFiles?: unknown[] }> : []
  if (steps.some((step) => Array.isArray(step?.evidenceFiles) && step.evidenceFiles.length > 0)) return true
  const override = assignment.completionOverride as { evidence?: unknown[] } | undefined
  return Boolean(override && Array.isArray(override.evidence) && override.evidence.length > 0)
}

/**
 * A required deliverable must exist before a human-delivered intervention can be confirmed complete.
 * Agent-delivered work has no upload step, so it is exempt. Returns the user-facing error, or null when fine.
 */
export const deliverableBlockReason = (assignment: AssignmentRecord): string | null => {
  const definition = assignment.outcomeDefinition as InterventionOutcomeDefinition | undefined
  if (!definition?.deliverableRequired) return null
  if (assignment.deliveryActorType === 'agent') return null
  if (hasDeliverableEvidence(assignment)) return null
  return `${deliverableLabel(definition)} has not been uploaded yet. The facilitator must attach it before this can be completed.`
}

/** Written onto the assignment when completion is confirmed; nothing is written for legacy interventions. */
export const buildFollowUpFields = (assignment: AssignmentRecord, completedAt: Date = new Date()) => {
  const definition = assignment.outcomeDefinition as InterventionOutcomeDefinition | undefined
  const days = Number(definition?.followUpDays)
  if (!Number.isFinite(days) || days <= 0) return {}
  const due = new Date(completedAt.getTime() + days * 86_400_000)
  return { followUpDueAt: due.toISOString(), followUpStatus: 'pending' }
}

export type FollowUpState = 'pending' | 'due_soon' | 'overdue' | 'done'

/** due_soon = within 14 days. Returns null when no follow-up was scheduled. */
export const followUpState = (assignment: AssignmentRecord, now: Date = new Date()): { state: FollowUpState; dueAt: Date } | null => {
  const dueAt = asDate(assignment.followUpDueAt)
  if (!dueAt) return null
  if (assignment.followUpStatus === 'done') return { state: 'done', dueAt }
  const daysLeft = (dueAt.getTime() - now.getTime()) / 86_400_000
  if (daysLeft < 0) return { state: 'overdue', dueAt }
  return { state: daysLeft <= 14 ? 'due_soon' : 'pending', dueAt }
}

/** UI label for the evidence a facilitator uploads: the named deliverable when configured, else the generic POE wording. */
export const deliverableLabel = (definition?: InterventionOutcomeDefinition | null, fallback = 'Proof of evidence') =>
  String(definition?.deliverableName || '').trim() || fallback

export type FollowUpResult = 'achieved' | 'partially' | 'not_yet'

export const FOLLOW_UP_RESULT_OPTIONS: Array<{ value: FollowUpResult; label: string }> = [
  { value: 'achieved', label: 'Achieved' },
  { value: 'partially', label: 'Partially' },
  { value: 'not_yet', label: 'Not yet' },
]

/** Days until the next check when the outcome is not yet fully achieved (mirrored in functions/src/followUps.ts). */
export const FOLLOW_UP_RECHECK_DAYS = 30

/**
 * Builds the entry and assignment fields for a facilitator's follow-up result. This is facilitator
 * observation, not system evidence. Not yet / partially schedules another check; achieved closes it.
 */
export const buildFollowUpResult = (
  assignment: AssignmentRecord,
  input: { result: FollowUpResult; note?: string; actor: { uid: string; name?: string; role?: string } },
  now: Date = new Date(),
) => {
  const note = String(input.note || '').trim().slice(0, 500)
  const entry = {
    result: input.result,
    note: note || null,
    recordedAt: now.toISOString(),
    recordedBy: { uid: input.actor.uid, name: input.actor.name || '', role: input.actor.role || '' },
    via: 'web',
    evidenceMechanism: 'facilitator_observation',
    confidence: 'facilitator_verified',
  }
  const achieved = input.result === 'achieved'
  const fields = {
    outcomeResult: entry,
    followUpStatus: achieved ? 'done' : 'pending',
    followUpDueAt: achieved ? assignment.followUpDueAt ?? null : new Date(now.getTime() + FOLLOW_UP_RECHECK_DAYS * 86_400_000).toISOString(),
    followUpRound: Number(assignment.followUpRound || 0) + 1,
  }
  return { entry, fields }
}

export type OutcomeRiskFlag =
  | { kind: 'unresolved_outcome'; rounds: number; lastNote?: string }
  | { kind: 'follow_up_overdue'; daysOverdue: number }

/** A follow-up this many days past due is a delivery problem worth surfacing. */
export const FOLLOW_UP_OVERDUE_FLAG_DAYS = 30

/**
 * Register flags only; these never change a score. Unresolved = the last two recorded checks were both
 * Partially / Not yet. Overdue = a pending follow-up unrecorded for FOLLOW_UP_OVERDUE_FLAG_DAYS or more.
 */
export const outcomeRiskFlags = (assignment: AssignmentRecord, now: Date = new Date()): OutcomeRiskFlag[] => {
  const flags: OutcomeRiskFlag[] = []
  const history = Array.isArray(assignment.outcomeHistory) ? assignment.outcomeHistory as Array<{ result?: string; note?: string | null }> : []
  const lastTwo = history.slice(-2)
  if (lastTwo.length === 2 && lastTwo.every((entry) => entry?.result === 'partially' || entry?.result === 'not_yet')) {
    flags.push({ kind: 'unresolved_outcome', rounds: history.length, lastNote: lastTwo[1]?.note || undefined })
  }
  const followUp = followUpState(assignment, now)
  if (followUp && followUp.state === 'overdue') {
    const daysOverdue = Math.floor((now.getTime() - followUp.dueAt.getTime()) / 86_400_000)
    if (daysOverdue >= FOLLOW_UP_OVERDUE_FLAG_DAYS) flags.push({ kind: 'follow_up_overdue', daysOverdue })
  }
  return flags
}
