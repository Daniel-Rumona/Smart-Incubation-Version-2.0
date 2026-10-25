/**
 * Platform KPIs: how the system itself is doing and being developed, for system admins.
 * Separate from company KPIs (types/kpi.ts), which track a programme's delivery.
 *  - auto: a figure the app can work out from its own data (sessions, users, email logs, AI ratings);
 *  - manual: something measured outside the app (uptime, releases, bugs, page speed), entered each period.
 */

export type PlatformKpiKind = 'auto' | 'manual'
export type PlatformKpiUnit = 'count' | 'percent' | 'minutes' | 'seconds' | 'days' | 'hours' | 'rating' | 'currency'
export type PlatformKpiDirection = 'higher' | 'lower'
export type PlatformKpiCadence = 'month' | 'quarter'
export type PlatformKpiCategory = 'adoption' | 'engagement' | 'reliability' | 'ai' | 'engineering' | 'support'

export type PlatformMetricKey =
    | 'monthly_active_users'
    | 'new_users'
    | 'activation_rate'
    | 'returning_users_rate'
    | 'stickiness'
    | 'avg_session_minutes'
    | 'pages_per_session'
    | 'active_companies'
    | 'applications_submitted'
    | 'email_delivery_rate'
    | 'email_failures'
    | 'ai_rating'
    | 'ai_rated_conversations'

export type PlatformKpiManualActual = { value: number; note?: string; byUid: string; byName: string; at: string }

export type PlatformKpi = {
    id: string
    name: string
    description?: string
    category: PlatformKpiCategory
    kind: PlatformKpiKind
    metric?: PlatformMetricKey
    unit: PlatformKpiUnit
    direction: PlatformKpiDirection
    cadence: PlatformKpiCadence
    /** null tracks the figure without a target. */
    target: number | null
    /** Period key ("2026-10", "2026-Q4") → the value someone entered (manual KPIs only). */
    manualActuals: Record<string, PlatformKpiManualActual>
    /** Set on KPIs created from the recommended set, so adding it again skips them. */
    seedKey?: string
    active: boolean
}

export type PlatformKpiDraft = Pick<PlatformKpi, 'name' | 'description' | 'category' | 'kind' | 'metric' | 'unit' | 'direction' | 'cadence' | 'target'>

export const PLATFORM_KPI_CATEGORIES: Array<{ key: PlatformKpiCategory; label: string }> = [
    { key: 'adoption', label: 'Adoption' },
    { key: 'engagement', label: 'Engagement' },
    { key: 'reliability', label: 'Reliability' },
    { key: 'ai', label: 'AI assistant' },
    { key: 'engineering', label: 'Engineering' },
    { key: 'support', label: 'Support' },
]

export const PLATFORM_KPI_UNITS: Array<{ key: PlatformKpiUnit; label: string }> = [
    { key: 'count', label: 'Count' },
    { key: 'percent', label: 'Percent' },
    { key: 'minutes', label: 'Minutes' },
    { key: 'seconds', label: 'Seconds' },
    { key: 'hours', label: 'Hours' },
    { key: 'days', label: 'Days' },
    { key: 'rating', label: 'Rating out of 5' },
    { key: 'currency', label: 'Rand' },
]

export type PlatformMetric = { key: PlatformMetricKey; name: string; description: string; unit: PlatformKpiUnit; direction: PlatformKpiDirection; category: PlatformKpiCategory }

/** What the app can measure on its own. Each is worked out per period in platformKpiService. */
export const PLATFORM_METRICS: PlatformMetric[] = [
    { key: 'monthly_active_users', name: 'Active users', description: 'People who signed in at least once in the period.', unit: 'count', direction: 'higher', category: 'adoption' },
    { key: 'new_users', name: 'New users', description: 'Accounts created in the period.', unit: 'count', direction: 'higher', category: 'adoption' },
    { key: 'activation_rate', name: 'Activation rate', description: 'Share of the period’s new accounts that signed in at least once.', unit: 'percent', direction: 'higher', category: 'adoption' },
    { key: 'active_companies', name: 'Active organisations', description: 'Companies with at least one person signed in during the period.', unit: 'count', direction: 'higher', category: 'adoption' },
    { key: 'applications_submitted', name: 'Applications submitted', description: 'Programme applications received in the period.', unit: 'count', direction: 'higher', category: 'adoption' },
    { key: 'returning_users_rate', name: 'Returning users', description: 'Share of the period’s active users who were also active the period before.', unit: 'percent', direction: 'higher', category: 'engagement' },
    { key: 'stickiness', name: 'Stickiness (daily ÷ period active)', description: 'Average daily active users as a share of the period’s active users.', unit: 'percent', direction: 'higher', category: 'engagement' },
    { key: 'avg_session_minutes', name: 'Average session length', description: 'Mean signed-in time per session.', unit: 'minutes', direction: 'higher', category: 'engagement' },
    { key: 'pages_per_session', name: 'Pages per session', description: 'Mean pages opened per session.', unit: 'count', direction: 'higher', category: 'engagement' },
    { key: 'email_delivery_rate', name: 'Email delivery rate', description: 'Share of system emails delivered without a failure.', unit: 'percent', direction: 'higher', category: 'reliability' },
    { key: 'email_failures', name: 'Failed emails', description: 'System emails that failed to send in the period.', unit: 'count', direction: 'lower', category: 'reliability' },
    { key: 'ai_rating', name: 'AI assistant rating', description: 'Average rating people gave AI conversations, out of 5.', unit: 'rating', direction: 'higher', category: 'ai' },
    { key: 'ai_rated_conversations', name: 'Rated AI conversations', description: 'AI conversations people rated in the period.', unit: 'count', direction: 'higher', category: 'ai' },
]

export type PlatformKpiSeed = PlatformKpiDraft & { seedKey: string }

const auto = (metric: PlatformMetricKey, target: number | null, cadence: PlatformKpiCadence = 'month'): PlatformKpiSeed => {
    const definition = PLATFORM_METRICS.find((item) => item.key === metric)!
    return { seedKey: `auto:${metric}`, name: definition.name, description: definition.description, category: definition.category, kind: 'auto', metric, unit: definition.unit, direction: definition.direction, cadence, target }
}

const manual = (seedKey: string, name: string, description: string, category: PlatformKpiCategory, unit: PlatformKpiUnit, direction: PlatformKpiDirection, target: number | null, cadence: PlatformKpiCadence = 'month'): PlatformKpiSeed =>
    ({ seedKey: `manual:${seedKey}`, name, description, category, kind: 'manual', unit, direction, cadence, target })

/**
 * A starting set for a platform still being built: adoption and engagement show whether what ships is used,
 * reliability and engineering show whether it is built well. Targets are starting points to tune.
 */
export const RECOMMENDED_PLATFORM_KPIS: PlatformKpiSeed[] = [
    auto('monthly_active_users', 100),
    auto('activation_rate', 80),
    auto('active_companies', 5),
    auto('returning_users_rate', 60),
    auto('stickiness', 20),
    auto('avg_session_minutes', 10),
    auto('email_delivery_rate', 98),
    auto('ai_rating', 4),
    manual('uptime', 'Uptime', 'Share of the period the app was reachable (from Firebase Hosting / an uptime monitor).', 'reliability', 'percent', 'higher', 99.5),
    manual('page_load', 'Page load time (p75)', 'Time for a typical page to become usable, at the 75th percentile (Lighthouse or Firebase Performance).', 'reliability', 'seconds', 'lower', 2.5),
    manual('error_rate', 'Front-end error rate', 'Share of sessions with an uncaught error (from the browser console reports or an error tracker).', 'reliability', 'percent', 'lower', 1),
    manual('releases', 'Releases shipped', 'Production deployments in the period.', 'engineering', 'count', 'higher', 4),
    manual('roadmap_delivery', 'Roadmap delivered', 'Share of the features planned for the period that shipped.', 'engineering', 'percent', 'higher', 80),
    manual('critical_bugs', 'Open critical bugs', 'Bugs that block a core flow (sign-in, applications, interventions, reports) still open at period end.', 'engineering', 'count', 'lower', 0),
    manual('bug_fix_time', 'Bug fix time', 'Average days from a bug being reported to the fix being live.', 'engineering', 'days', 'lower', 5),
    manual('test_coverage', 'Automated test coverage', 'Share of code covered by automated tests.', 'engineering', 'percent', 'higher', 60),
    manual('vulnerabilities', 'Known vulnerabilities', 'High or critical issues from `npm audit` and the rules review, still open.', 'engineering', 'count', 'lower', 0),
    manual('support_requests', 'Support requests', 'Issues and how-do-I questions users raised in the period.', 'support', 'count', 'lower', 20),
    manual('first_response', 'First response time', 'Average hours until a user’s support request gets a first reply.', 'support', 'hours', 'lower', 8),
    manual('cost_per_user', 'Cloud cost per active user', 'Firebase and AI spend for the period divided by active users.', 'engineering', 'currency', 'lower', 15),
]
