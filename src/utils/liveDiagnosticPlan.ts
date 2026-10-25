import { followUpState, hasDeliverableEvidence, type FollowUpResult, type FollowUpState } from '../services/interventionOutcomeConfig'
import { hasWorkStarted } from './interventionStart'

/**
 * The live growth plan: what each intervention in the plan really looks like right now.
 *
 * Rules (one place, so the SME's plan and the operations plan always agree):
 *  - A step is Completed only once the SME has confirmed it. Finished work waiting for that confirmation is
 *    "Awaiting SME confirmation", never Completed.
 *  - Cancelled or declined assignments are ignored (a reassigned step counts once, by its current assignment).
 *  - Progress is weighted by each step's weight (steps without one count 1) and is held at 99% until the whole
 *    intervention is confirmed complete, so 100% always means confirmed.
 *  - Steps that have not been assigned yet are listed, so the plan shows what is still to come.
 *  - Delivery is separate from impact: the outcome (deliverable received, follow-up due, result) is reported next
 *    to the status and never changes it.
 */

export type LivePlanStatus = 'Completed' | 'In progress' | 'Awaiting confirmation' | 'Not started' | 'Not assigned' | 'Declined'
export type StepState = 'completed' | 'delivered' | 'in_progress' | 'assigned' | 'not_assigned'

export type LivePlanStep = {
  key: string
  title: string
  state: StepState
  /** Plain-language state for the screen. */
  label: string
  /** 0-100; held at 99 until the step is confirmed. */
  progress: number
  weight: number
  /** This step's share of the whole intervention, in percent. */
  share: number
  /** How many earlier assignments of this step were cancelled or replaced. */
  replaced: number
}

export type LivePlanOutcome = {
  deliverableName?: string
  deliverableRequired?: boolean
  deliverableReceived?: boolean
  intendedOutcome?: string
  followUp?: { state: FollowUpState, dueAt: Date }
  result?: FollowUpResult
  resultNote?: string
}

export type LivePlanItem = {
  interventionId?: string
  id?: string
  title: string
  areaOfSupport?: string
  steps?: Array<{ id?: string, title?: string, weight?: number }>
  status: LivePlanStatus
  progress: number
  totalSteps: number
  completedSteps: number
  remainingSteps: number
  stepRows: LivePlanStep[]
  outcome?: LivePlanOutcome
}

type Row = Record<string, unknown>

export const STEP_STATE_LABEL: Record<StepState, string> = {
  completed: 'Completed',
  delivered: 'Awaiting SME confirmation',
  in_progress: 'In progress',
  assigned: 'Assigned, not started',
  not_assigned: 'Not assigned yet',
}

export const planStatusColor = (status: LivePlanStatus) =>
  status === 'Completed' ? 'green' : status === 'In progress' ? 'blue' : status === 'Awaiting confirmation' ? 'gold' : status === 'Declined' ? 'red' : 'default'

export const stepStateColor = (state: StepState) =>
  state === 'completed' ? 'green' : state === 'in_progress' ? 'blue' : state === 'delivered' ? 'gold' : 'default'

const norm = (value: unknown) => String(value || '').trim().toLowerCase()
const key = (value: unknown) => norm(value).replace(/[^a-z0-9]+/g, '-')
const timeValue = (value: unknown) => {
  if (value && typeof value === 'object' && 'toMillis' in value && typeof value.toMillis === 'function') return value.toMillis()
  if (value && typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return value.seconds * 1000
  const parsed = Date.parse(String(value || ''))
  return Number.isFinite(parsed) ? parsed : 0
}
const createdAt = (row: Row) => timeValue(row.createdAt || row.assignedAt || row.updatedAt)

const progressOf = (row: Row) => {
  const value = Number(row.progress)
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
}

const isDeclinedBySme = (row: Row) => norm(row.participantStatus) === 'declined'
const isDead = (row: Row) => ['cancelled', 'canceled', 'declined', 'superseded'].includes(norm(row.status)) || norm(row.assigneeStatus) === 'declined' || isDeclinedBySme(row)
const isConfirmed = (row: Row) => ['completed', 'done', 'confirmed'].includes(norm(row.status))
  || norm(row.participantCompletionStatus) === 'confirmed' || norm(row.completionStatus) === 'confirmed' || Boolean(row.completionConfirmedAt)
const isReturned = (row: Row) => norm(row.participantCompletionStatus) === 'rejected' || norm(row.completionStatus) === 'rejected'
const isDelivered = (row: Row) => !isReturned(row) && (
  progressOf(row) >= 100
  || ['awaiting_confirmation', 'awaiting confirmation', 'submitted'].includes(norm(row.status))
  || ['submitted', 'awaiting_confirmation'].includes(norm(row.completionStatus))
  || norm(row.assigneeCompletionStatus) === 'done'
)
const isStarted = (row: Row) => progressOf(row) > 0
  || ['in-progress', 'in progress', 'active', 'started'].includes(norm(row.status))
  || hasWorkStarted(row)

const stateOf = (row: Row | undefined): StepState => {
  if (!row) return 'not_assigned'
  if (isConfirmed(row)) return 'completed'
  if (isDelivered(row)) return 'delivered'
  if (isStarted(row)) return 'in_progress'
  return 'assigned'
}

/** What this step contributes to the intervention's progress, 0 to 1. Unconfirmed work never reaches 1. */
const fractionOf = (state: StepState, row: Row | undefined) => {
  if (state === 'completed') return 1
  if (state === 'not_assigned' || !row) return 0
  return Math.min(progressOf(row), 99) / 100
}

const positive = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

type CatalogueStep = { id?: string, title?: string, weight?: number }

/** The step a multi-step assignment belongs to, or -1 when it cannot be told. */
const slotIndexOf = (row: Row, catalogue: CatalogueStep[]) => {
  if (row.stepIndex !== null && row.stepIndex !== undefined && Number.isFinite(Number(row.stepIndex)) && Number(row.stepIndex) >= 0) return Number(row.stepIndex)
  if (Number(row.stepNumber) > 0) return Number(row.stepNumber) - 1
  return catalogue.findIndex(step => (key(step.id) && key(step.id) === key(row.assignedStepId)) || (key(step.title) && key(step.title) === key(row.assignedStepTitle || row.stepTitle)))
}

type Slot = { title: string, row?: Row, weight: number, replaced: number }

const buildSlots = (item: { title: string, steps?: CatalogueStep[], executionMode?: string }, matches: Row[]): { slots: Slot[], multi: boolean } => {
  const catalogue = item.steps || []
  // An assignment with no step information was made before the intervention had steps (or without them), so it stands
  // for the whole intervention rather than for one step of it.
  const hasStepInfo = (row: Row) => norm(row.executionMode) === 'multi_step' || (row.stepIndex !== null && row.stepIndex !== undefined) || Number(row.stepNumber) > 0 || Number(row.stepCount) > 0 || Boolean(row.assignedStepId)
  const definedAsMulti = norm(item.executionMode) === 'multi_step' || matches.some(row => norm(row.executionMode) === 'multi_step')
  const multi = definedAsMulti && (!matches.length || matches.some(hasStepInfo))
  const live = matches.filter(row => !isDead(row)).sort((a, b) => createdAt(a) - createdAt(b))
  const dead = matches.filter(row => isDead(row))

  if (!multi) {
    if (!live.length) return { slots: [{ title: item.title, weight: 1, replaced: dead.length }], multi }
    return {
      multi,
      slots: live.map((row, index) => ({ title: live.length > 1 ? `Session ${index + 1}` : item.title, row, weight: 1, replaced: index === 0 ? dead.length : 0 })),
    }
  }

  const indices = matches.map(row => slotIndexOf(row, catalogue))
  const declaredTotal = Math.max(1, catalogue.length, ...matches.map(row => Number(row.stepCount) || 0), ...indices.map(index => index + 1))
  const rowsBySlot: Row[][] = Array.from({ length: declaredTotal }, () => [])
  const deadBySlot: number[] = Array.from({ length: declaredTotal }, () => 0)

  const unresolved: Row[] = []
  matches.forEach((row, position) => {
    const index = indices[position]
    if (index < 0) { if (!isDead(row)) unresolved.push(row); return }
    if (isDead(row)) deadBySlot[index] += 1
    else rowsBySlot[index].push(row)
  })
  // Assignments that carry no step information fill the earliest steps that have nothing yet, oldest first.
  unresolved.sort((a, b) => createdAt(a) - createdAt(b)).forEach(row => {
    const free = rowsBySlot.findIndex(rows => !rows.length)
    if (free >= 0) rowsBySlot[free].push(row)
    else { rowsBySlot.push([row]); deadBySlot.push(0) }
  })

  const slots = rowsBySlot.map((rows, index): Slot => {
    const ordered = [...rows].sort((a, b) => createdAt(a) - createdAt(b))
    // A confirmed assignment wins; otherwise the most recent one is the current one.
    const current = ordered.find(isConfirmed) || ordered[ordered.length - 1]
    const weight = positive(catalogue[index]?.weight) || positive((current?.steps as Array<{ weight?: number }> | undefined)?.[0]?.weight) || 1
    const title = String(catalogue[index]?.title || current?.assignedStepTitle || current?.stepTitle || `Step ${index + 1}`)
    return { title, row: current, weight, replaced: Math.max(0, ordered.length - 1) + deadBySlot[index] }
  })
  return { slots, multi }
}

const outcomeOf = (matches: Row[]): LivePlanOutcome | undefined => {
  const live = matches.filter(row => !isDead(row)).sort((a, b) => createdAt(b) - createdAt(a))
  const withDefinition = live.find(row => row.outcomeDefinition && typeof row.outcomeDefinition === 'object')
  const definition = (withDefinition?.outcomeDefinition || {}) as { deliverableName?: string, deliverableRequired?: boolean, intendedOutcome?: string }
  const followRow = live.find(row => row.followUpDueAt)
  const follow = followRow ? followUpState(followRow) : null
  const resultRow = live.find(row => (row.outcomeResult as { result?: string } | undefined)?.result)
  const result = resultRow?.outcomeResult as { result?: FollowUpResult, note?: string | null } | undefined

  const hasDefinition = Boolean(definition.deliverableName || definition.intendedOutcome)
  if (!hasDefinition && !follow && !result?.result) return undefined
  return {
    deliverableName: definition.deliverableName || undefined,
    deliverableRequired: definition.deliverableRequired === true,
    deliverableReceived: definition.deliverableName ? live.some(row => hasDeliverableEvidence(row)) : undefined,
    intendedOutcome: definition.intendedOutcome || undefined,
    followUp: follow ? { state: follow.state, dueAt: follow.dueAt } : undefined,
    result: result?.result,
    resultNote: result?.note || undefined,
  }
}

export const buildLivePlanItems = <T extends { interventionId?: string, id?: string, title: string, areaOfSupport?: string, executionMode?: string, steps?: CatalogueStep[] }>(
  items: T[],
  assignments: Array<Record<string, unknown>>,
): Array<T & LivePlanItem> => items.map(item => {
  const definitionId = String(item.interventionId || item.id || '')
  const matches = assignments.filter(row => String(row.interventionId || '') === definitionId)
  const live = matches.filter(row => !isDead(row))
  const { slots } = buildSlots(item, matches)

  const states = slots.map(slot => stateOf(slot.row))
  const totalWeight = slots.reduce((sum, slot) => sum + slot.weight, 0) || 1
  const stepRows: LivePlanStep[] = slots.map((slot, index) => ({
    key: `${definitionId || item.title}-${index}`,
    title: slot.title,
    state: states[index],
    label: STEP_STATE_LABEL[states[index]],
    progress: states[index] === 'completed' ? 100 : slot.row ? Math.min(progressOf(slot.row), 99) : 0,
    weight: slot.weight,
    share: Math.round((slot.weight / totalWeight) * 100),
    replaced: slot.replaced,
  }))

  const completedSteps = states.filter(state => state === 'completed').length
  let status: LivePlanStatus
  if (!live.length) status = matches.some(isDeclinedBySme) ? 'Declined' : 'Not assigned'
  else if (states.every(state => state === 'completed')) status = 'Completed'
  else if (states.includes('in_progress') || completedSteps > 0 && !states.includes('delivered')) status = 'In progress'
  else if (states.includes('delivered')) status = 'Awaiting confirmation'
  else status = 'Not started'

  const weighted = slots.reduce((sum, slot, index) => sum + slot.weight * fractionOf(states[index], slot.row), 0) / totalWeight
  const rounded = Math.round(weighted * 100)
  const progress = status === 'Completed' ? 100 : (!live.length ? 0 : Math.min(99, rounded))

  return {
    ...item,
    status,
    progress,
    totalSteps: slots.length,
    completedSteps,
    remainingSteps: Math.max(0, slots.length - completedSteps),
    stepRows,
    outcome: outcomeOf(matches),
  }
})

/** Overall plan progress: the average of the interventions still in play (a declined one is not part of the plan). */
export const livePlanProgress = (items: Array<Pick<LivePlanItem, 'progress' | 'status'>>) => {
  const inPlay = items.filter(item => item.status !== 'Declined')
  return inPlay.length ? Math.round(inPlay.reduce((sum, item) => sum + item.progress, 0) / inPlay.length) : 0
}
