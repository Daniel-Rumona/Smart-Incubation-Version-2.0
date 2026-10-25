import type { LivePlanItem } from '@/utils/liveDiagnosticPlan'

/**
 * Matches an SME's SWOT items to the interventions in their growth plan, so the SWOT can answer "did the work
 * change anything?" A SWOT item names the area of support it belongs to; its outcome is read from the live plan
 * items in that area (their real status and the facilitator's follow-up result), so nothing here is stored and
 * nothing can drift from the plan.
 */
export type SwotQuadrant = 'strengths' | 'weaknesses' | 'opportunities' | 'threats'

export type SwotItem = {
  quadrant: SwotQuadrant
  text: string
  areaOfSupport: string
}

export type SwotOutcomeState = 'achieved' | 'partial' | 'unverified' | 'in_progress' | 'not_started' | 'no_plan'
export type SwotOutcomeTone = 'good' | 'warn' | 'bad' | 'neutral'

export type SwotEvidence = { title: string; status: LivePlanItem['status']; result?: string; note?: string }

export type SwotOutcome = {
  item: SwotItem
  state: SwotOutcomeState
  label: string
  tone: SwotOutcomeTone
  evidence: SwotEvidence[]
}

export const SWOT_QUADRANTS: SwotQuadrant[] = ['strengths', 'weaknesses', 'opportunities', 'threats']

export const SWOT_QUADRANT_LABEL: Record<SwotQuadrant, string> = {
  strengths: 'Strengths',
  weaknesses: 'Weaknesses',
  opportunities: 'Opportunities',
  threats: 'Threats',
}

/** What "achieved" means for each quadrant: weaknesses are resolved, threats mitigated, strengths built on, opportunities taken. */
const ACHIEVED_LABEL: Record<SwotQuadrant, string> = {
  weaknesses: 'Resolved',
  threats: 'Mitigated',
  strengths: 'Strengthened',
  opportunities: 'Captured',
}
const PARTIAL_LABEL: Record<SwotQuadrant, string> = {
  weaknesses: 'Partly resolved',
  threats: 'Partly mitigated',
  strengths: 'Partly strengthened',
  opportunities: 'Partly captured',
}

const areaKey = (value: unknown) => String(value || '').trim().toLowerCase()
/** Weaknesses and threats are problems to remove; having no plan for them is a gap. For strengths and opportunities it is only neutral. */
const isProblem = (quadrant: SwotQuadrant) => quadrant === 'weaknesses' || quadrant === 'threats'

export const evaluateSwotItem = (item: SwotItem, planItems: LivePlanItem[]): SwotOutcome => {
  const inArea = planItems.filter(row => areaKey(row.areaOfSupport) === areaKey(item.areaOfSupport) && row.status !== 'Declined')
  const evidence: SwotEvidence[] = inArea.map(row => ({ title: row.title, status: row.status, result: row.outcome?.result, note: row.outcome?.resultNote }))
  const done = (state: SwotOutcomeState, label: string, tone: SwotOutcomeTone): SwotOutcome => ({ item, state, label, tone, evidence })

  if (!inArea.length) {
    if (isProblem(item.quadrant)) return done('no_plan', 'No intervention planned', 'bad')
    return done('no_plan', item.quadrant === 'strengths' ? 'No support needed' : 'No action planned', 'neutral')
  }

  const completed = inArea.filter(row => row.status === 'Completed')
  if (completed.length === inArea.length) {
    if (completed.some(row => !row.outcome?.result)) return done('unverified', 'Delivered, outcome not yet checked', 'warn')
    if (completed.every(row => row.outcome?.result === 'achieved')) return done('achieved', ACHIEVED_LABEL[item.quadrant], 'good')
    return done('partial', PARTIAL_LABEL[item.quadrant], 'warn')
  }
  if (inArea.some(row => row.status === 'Completed' || row.status === 'In progress' || row.status === 'Awaiting confirmation')) {
    return done('in_progress', isProblem(item.quadrant) ? 'Being addressed' : 'In progress', 'neutral')
  }
  return done('not_started', 'Not started', isProblem(item.quadrant) ? 'bad' : 'neutral')
}

export const evaluateSwot = (items: SwotItem[], planItems: LivePlanItem[]): SwotOutcome[] =>
  items.map(item => evaluateSwotItem(item, planItems))

export type SwotSummary = Record<SwotQuadrant, { total: number; achieved: number }>

export const summariseSwot = (outcomes: SwotOutcome[]): SwotSummary => {
  const summary = Object.fromEntries(SWOT_QUADRANTS.map(quadrant => [quadrant, { total: 0, achieved: 0 }])) as SwotSummary
  outcomes.forEach(outcome => {
    summary[outcome.item.quadrant].total += 1
    if (outcome.state === 'achieved') summary[outcome.item.quadrant].achieved += 1
  })
  return summary
}

/** Reads `swotItems` off an application or participant document, dropping anything malformed. */
export const readSwotItems = (source: unknown): SwotItem[] => {
  const list = (source as { swotItems?: unknown } | null | undefined)?.swotItems
  if (!Array.isArray(list)) return []
  return list.flatMap((row): SwotItem[] => {
    const value = (row || {}) as Record<string, unknown>
    const quadrant = String(value.quadrant || '') as SwotQuadrant
    const text = String(value.text || '').trim()
    const areaOfSupport = String(value.areaOfSupport || '').trim()
    return SWOT_QUADRANTS.includes(quadrant) && text && areaOfSupport ? [{ quadrant, text, areaOfSupport }] : []
  })
}
