/**
 * Company KPIs and their targets. Three kinds:
 *  - system: a metric the app already measures (see KPI_CATALOGUE), so the actual fills in on its own;
 *  - interventions: counts SMEs that complete any / all / at least N of a set of interventions;
 *  - manual: something the app can't measure (e.g. a sponsor contract figure); someone enters the actual each period.
 * Targets are a company default per KPI, which a programme can override.
 */

export type KpiKind = 'system' | 'interventions' | 'manual'
export type KpiUnit = 'count' | 'percent' | 'days' | 'rating' | 'currency' | 'number'
export type KpiDirection = 'higher' | 'lower'
export type KpiCadence = 'month' | 'quarter' | 'year'
export type KpiInterventionRule = 'any' | 'all' | 'atLeast'

export type SystemMetricKey =
    | 'interventions_completed'
    | 'completion_rate'
    | 'median_turnaround_days'
    | 'on_time_rate'
    | 'overdue_now'
    | 'smes_supported'
    | 'attendance_rate'
    | 'average_rating'

export type KpiManualActual = { value: number; note?: string; byUid: string; byName: string; at: string }

export type Kpi = {
    id: string
    companyCode: string
    name: string
    description?: string
    kind: KpiKind
    metric?: SystemMetricKey
    interventionIds?: string[]
    rule?: KpiInterventionRule
    /** For rule 'atLeast': how many of the listed interventions an SME must complete. */
    atLeast?: number
    unit: KpiUnit
    direction: KpiDirection
    cadence: KpiCadence
    /** Company-wide target; null tracks the KPI without one. */
    target: number | null
    /** Programme id → that programme's target, overriding the company one. */
    programTargets: Record<string, number>
    /** `${periodKey}|${programId or 'all'}` → the actual someone entered (manual KPIs only). */
    manualActuals: Record<string, KpiManualActual>
    active: boolean
    createdByUid?: string
    updatedAt?: unknown
}

export type KpiDraft = Omit<Kpi, 'id' | 'companyCode' | 'manualActuals' | 'active' | 'createdByUid' | 'updatedAt'>

export type SystemMetric = {
    key: SystemMetricKey
    name: string
    description: string
    unit: KpiUnit
    direction: KpiDirection
    /** True when the figure describes right now, not the period (e.g. overdue work). */
    current?: boolean
}

export const KPI_CATALOGUE: SystemMetric[] = [
    { key: 'interventions_completed', name: 'Interventions completed', description: 'Interventions completed and confirmed in the period.', unit: 'count', direction: 'higher' },
    { key: 'completion_rate', name: 'Completion rate', description: 'Share of the period’s interventions that are complete.', unit: 'percent', direction: 'higher' },
    { key: 'median_turnaround_days', name: 'Median turnaround', description: 'Days from assignment to completion, at the median.', unit: 'days', direction: 'lower' },
    { key: 'on_time_rate', name: 'Delivered on time', description: 'Share of completed interventions finished by their due date.', unit: 'percent', direction: 'higher' },
    { key: 'overdue_now', name: 'Overdue interventions', description: 'Open interventions past their due date right now.', unit: 'count', direction: 'lower', current: true },
    { key: 'smes_supported', name: 'SMEs supported', description: 'SMEs with at least one intervention completed in the period.', unit: 'count', direction: 'higher' },
    { key: 'attendance_rate', name: 'Appointment attendance', description: 'Share of held appointments the SME attended.', unit: 'percent', direction: 'higher' },
    { key: 'average_rating', name: 'Client rating', description: 'Average rating SMEs gave completed interventions, out of 5.', unit: 'rating', direction: 'higher' },
]
