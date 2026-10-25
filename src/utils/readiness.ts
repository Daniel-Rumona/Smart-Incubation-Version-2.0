import type { LivePlanItem } from '@/utils/liveDiagnosticPlan'

/**
 * Funding and market readiness for one SME, from evidence the platform already holds: verified compliance
 * documents, the live growth plan (with the facilitator's follow-up results), and revenue and digital presence
 * records. Nothing here is stored or self-declared: it is recomputed from those records each time, and every
 * gate says what it was based on, so operations can see exactly what to fix.
 *
 * Each track is a list of gates. A gate is met, partial, missing, or unknown (no evidence either way, left out of
 * the score). The band is Ready only when every critical gate is met and the score is high enough.
 */
export type GateState = 'met' | 'partial' | 'missing' | 'unknown'
export type ReadinessBand = 'ready' | 'almost' | 'not_ready'
export type TrackKey = 'funding' | 'market'

export type Gate = {
  key: string
  label: string
  state: GateState
  /** What the state is based on, in plain words. */
  detail: string
  /** What to do next when the gate is not met. */
  action?: string
  /** A critical gate must be met before the SME can be Ready. */
  critical?: boolean
}

export type ReadinessTrack = {
  gates: Gate[]
  /** 0-100 across the gates that have evidence; null when none do. */
  score: number | null
  band: ReadinessBand
}

export type SmeReadiness = {
  funding: ReadinessTrack
  market: ReadinessTrack
  /** Unmet gates, critical first, from both tracks. */
  nextSteps: Array<{ track: TrackKey; gate: Gate }>
}

export type ReadinessDocument = {
  key?: unknown
  type?: unknown
  currentStatus?: unknown
  expiryDate?: unknown
}

export type ReadinessInput = {
  documents: ReadinessDocument[]
  planItems: LivePlanItem[]
  /** Monthly revenue, oldest first. */
  revenueMonthly: Array<{ period: string; value: number }>
  yearsOfTrading?: number | null
  /** The Yes / No / unanswered answers for website and social channels. */
  digitalPresence?: Record<string, boolean | null | undefined>
  now?: Date
}

export const READY_SCORE = 75
export const ALMOST_SCORE = 50
const EXPIRING_SOON_DAYS = 30

export const BAND_LABEL: Record<ReadinessBand, string> = { ready: 'Ready', almost: 'Almost ready', not_ready: 'Not ready' }
export const TRACK_LABEL: Record<TrackKey, string> = { funding: 'Funding readiness', market: 'Market linkage' }

const slug = (value: unknown) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const areaKey = (value: unknown) => String(value || '').trim().toLowerCase()
const toDate = (value: unknown): Date | null => {
  if (!value) return null
  const date = typeof (value as { toDate?: () => Date }).toDate === 'function' ? (value as { toDate: () => Date }).toDate() : new Date(value as string)
  return Number.isNaN(date.getTime()) ? null : date
}

/* ---------- gate builders ---------- */

const documentGate = (input: ReadinessInput, spec: { key: string; label: string; action: string; critical?: boolean; match: string[] }): Gate => {
  const found = input.documents.find(doc => spec.match.includes(slug(doc.key)) || spec.match.includes(slug(doc.type)))
  const base = { key: spec.key, label: spec.label, critical: spec.critical }
  if (!found) return { ...base, state: 'missing', detail: 'Not uploaded', action: `Upload ${spec.label.toLowerCase()}` }
  const status = String(found.currentStatus || '').trim().toLowerCase()
  if (status === 'valid' || status === 'approved') {
    const expiry = toDate(found.expiryDate)
    const days = expiry ? Math.ceil((expiry.getTime() - (input.now || new Date()).getTime()) / 86_400_000) : null
    if (days !== null && days <= EXPIRING_SOON_DAYS) {
      return { ...base, state: 'partial', detail: days < 0 ? 'Expired' : `Valid, expires in ${days} day${days === 1 ? '' : 's'}`, action: `Renew ${spec.label.toLowerCase()}` }
    }
    return { ...base, state: 'met', detail: 'Verified and valid' }
  }
  if (['pending', 'uploaded', 'queried'].includes(status)) return { ...base, state: 'partial', detail: 'Uploaded, awaiting verification', action: `Verify ${spec.label.toLowerCase()}` }
  return { ...base, state: 'missing', detail: status === 'expired' ? 'Expired' : `Not valid (${status || 'unknown'})`, action: `Replace ${spec.label.toLowerCase()}` }
}

/** The state of the plan interventions that serve one purpose, from their real status and follow-up results. */
const planGate = (items: LivePlanItem[], spec: { key: string; label: string; action: string; critical?: boolean; empty: string }): Gate => {
  const base = { key: spec.key, label: spec.label, critical: spec.critical }
  const live = items.filter(item => item.status !== 'Declined')
  if (!live.length) return { ...base, state: 'unknown', detail: spec.empty }
  const completed = live.filter(item => item.status === 'Completed')
  if (completed.length === live.length) {
    if (completed.some(item => !item.outcome?.result)) return { ...base, state: 'partial', detail: 'Delivered, outcome not yet checked', action: 'Record the follow-up result' }
    if (completed.every(item => item.outcome?.result === 'achieved')) return { ...base, state: 'met', detail: `${live.length} of ${live.length} delivered, outcome achieved` }
    return { ...base, state: 'partial', detail: 'Delivered, outcome only partly achieved', action: spec.action }
  }
  if (live.some(item => item.status !== 'Not started' && item.status !== 'Not assigned')) {
    return { ...base, state: 'partial', detail: `${completed.length} of ${live.length} delivered`, action: spec.action }
  }
  return { ...base, state: 'missing', detail: 'Not started', action: spec.action }
}

const revenueGate = (rows: ReadinessInput['revenueMonthly']): Gate => {
  const base = { key: 'revenue-trend', label: 'Revenue trend' }
  if (rows.length < 6) return { ...base, state: 'unknown', detail: 'Fewer than 6 months of revenue recorded' }
  const average = (list: typeof rows) => list.reduce((sum, row) => sum + row.value, 0) / list.length
  const recent = average(rows.slice(-3))
  const before = average(rows.slice(-6, -3))
  if (!before) return { ...base, state: 'unknown', detail: 'No earlier revenue to compare with' }
  const change = ((recent - before) / before) * 100
  const text = `${change >= 0 ? '+' : ''}${Math.round(change)}% over the last 3 months`
  if (change > 5) return { ...base, state: 'met', detail: text }
  if (change >= -5) return { ...base, state: 'partial', detail: `Flat (${text})`, action: 'Review the revenue plateau' }
  return { ...base, state: 'missing', detail: `Declining (${text})`, action: 'Investigate the revenue decline' }
}

const trackRecordGate = (years?: number | null): Gate => {
  const base = { key: 'track-record', label: 'Track record' }
  if (typeof years !== 'number' || years <= 0) return { ...base, state: 'unknown', detail: 'Years of trading not recorded' }
  if (years >= 2) return { ...base, state: 'met', detail: `${years} years trading` }
  return { ...base, state: 'partial', detail: `${years} year trading (funders usually want 2+)` }
}

const digitalGate = (presence?: ReadinessInput['digitalPresence']): Gate => {
  const base = { key: 'digital-presence', label: 'Online presence' }
  const channels = ['website', 'facebook', 'instagram', 'x', 'linkedIn', 'other']
  const answers = channels.map(channel => presence?.[channel])
  const answered = answers.filter(answer => answer === true || answer === false)
  if (!answered.length) return { ...base, state: 'unknown', detail: 'Digital presence not captured yet' }
  const yes = answers.filter(answer => answer === true).length
  if (presence?.website === true && yes >= 2) return { ...base, state: 'met', detail: `Website and ${yes - 1} other channel${yes - 1 === 1 ? '' : 's'}` }
  if (yes > 0) return { ...base, state: 'partial', detail: presence?.website === true ? 'Website only' : `${yes} channel${yes === 1 ? '' : 's'}, no website`, action: 'Build out online presence' }
  return { ...base, state: 'missing', detail: 'No online presence', action: 'Set up a website and a social channel' }
}

/* ---------- scoring ---------- */

const POINTS: Record<GateState, number | null> = { met: 1, partial: 0.5, missing: 0, unknown: null }

export const scoreTrack = (gates: Gate[]): ReadinessTrack => {
  const known = gates.filter(gate => POINTS[gate.state] !== null)
  const score = known.length ? Math.round((known.reduce((sum, gate) => sum + (POINTS[gate.state] as number), 0) / known.length) * 100) : null
  const criticalMet = gates.filter(gate => gate.critical).every(gate => gate.state === 'met')
  const band: ReadinessBand = score !== null && score >= READY_SCORE && criticalMet ? 'ready' : score !== null && score >= ALMOST_SCORE ? 'almost' : 'not_ready'
  return { gates, score, band }
}

const inArea = (items: LivePlanItem[], area: string) => items.filter(item => areaKey(item.areaOfSupport) === areaKey(area))
const pitchItems = (items: LivePlanItem[]) => items.filter(item => /pitch|investor|funding|investment/i.test(item.title))

export const assessReadiness = (input: ReadinessInput): SmeReadiness => {
  const tax = documentGate(input, { key: 'tax-clearance', label: 'Tax clearance', action: 'Renew tax clearance', critical: true, match: ['tax-clearance'] })

  const funding = scoreTrack([
    tax,
    documentGate(input, { key: 'cipc', label: 'Company registration (CIPC)', action: 'Register or update with CIPC', critical: true, match: ['cipc-registration', 'cipc'] }),
    documentGate(input, { key: 'bank', label: 'Bank confirmation', action: 'Provide bank confirmation', critical: true, match: ['bank-confirmation'] }),
    planGate(inArea(input.planItems, 'Financial Management'), { key: 'financial-management', label: 'Financial management', action: 'Complete financial management support', empty: 'No financial support planned' }),
    planGate(inArea(input.planItems, 'Governance & Leadership'), { key: 'governance', label: 'Governance', action: 'Complete governance support', empty: 'No governance support planned' }),
    revenueGate(input.revenueMonthly),
    trackRecordGate(input.yearsOfTrading),
    planGate(pitchItems(input.planItems), { key: 'pitch', label: 'Pitch readiness', action: 'Complete the investor pitch work', empty: 'No pitch work planned' }),
  ])

  const market = scoreTrack([
    documentGate(input, { key: 'bbbee', label: 'B-BBEE certificate', action: 'Renew B-BBEE certificate', critical: true, match: ['b-bbee-certificate', 'bbbee-certificate', 'bbbee', 'b-bbee'] }),
    tax,
    planGate(inArea(input.planItems, 'Access to Markets'), { key: 'access-to-markets', label: 'Market access support', action: 'Complete market access support', empty: 'No market access support planned' }),
    planGate(inArea(input.planItems, 'Marketing & Sales'), { key: 'marketing-sales', label: 'Marketing and sales', action: 'Complete marketing and sales support', empty: 'No marketing support planned' }),
    digitalGate(input.digitalPresence),
  ])

  const order = (gate: Gate) => (gate.critical ? 0 : 1) + (gate.state === 'missing' ? 0 : 0.5)
  const nextSteps = ([['funding', funding], ['market', market]] as Array<[TrackKey, ReadinessTrack]>)
    .flatMap(([track, value]) => value.gates.filter(gate => gate.action && (gate.state === 'missing' || gate.state === 'partial')).map(gate => ({ track, gate })))
    // the shared tax gate appears in both tracks; list it once
    .filter((step, index, all) => all.findIndex(other => other.gate.key === step.gate.key) === index)
    .sort((a, b) => order(a.gate) - order(b.gate))

  return { funding, market, nextSteps }
}
