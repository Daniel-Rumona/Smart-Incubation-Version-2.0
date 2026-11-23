/**
 * The growth ladder: one set of steps for every programme, each one backed by the SME's own records, so a step is
 * never a judgement call and the same SME sits on the same step for every viewer.
 *
 *   1 Reporting monthly   figures for at least 3 of the last 4 completed months
 *   2 Selling regularly   revenue in at least 2 of the last 3 completed months
 *   3 Growing             revenue over the last 3 months 10%+ above the same 3 months half a year earlier,
 *                         or more jobs now than half a year earlier
 *   4 In the market       a quote, tender or funding application submitted in the last 90 days
 *   5 Winning work        an opportunity won in the last 12 months
 *
 * Steps are cumulative: the SME's step is the highest one reached with every step below it met too. Because each
 * test only looks at dated records, the step can be worked out "as at" any past date, which is how the history
 * (steps gained, stuck for N quarters) is built without storing anything new.
 *
 * Compliance documents are deliberately not a step: directors and funders can't read them, and a step that changes
 * with the viewer would make the ladder disagree with itself. Document readiness stays on the compliance pages.
 *
 * No imports, so `node --test src/services/growthLadder.test.ts` runs it directly.
 */

export const LADDER_STEPS = [
    { key: 'reporting', title: 'Reporting monthly', rule: 'Monthly figures for at least 3 of the last 4 months.' },
    { key: 'selling', title: 'Selling regularly', rule: 'Revenue in at least 2 of the last 3 months.' },
    { key: 'growing', title: 'Growing', rule: 'Revenue up 10% or more on half a year earlier, or more jobs than then.' },
    { key: 'market', title: 'In the market', rule: 'A quote, tender or funding application submitted in the last 90 days.' },
    { key: 'winning', title: 'Winning work', rule: 'An opportunity won in the last 12 months.' },
] as const

export type LadderStepKey = (typeof LADDER_STEPS)[number]['key']
export const TOP_RUNG = LADDER_STEPS.length

export type LadderMonth = { month: string, revenue?: number | null, jobs?: number | null }
export type LadderOpportunity = { stage: string, submittedAt?: string | null }
export type LadderInput = { months: LadderMonth[], opportunities: LadderOpportunity[] }
export type LadderResult = { rung: number, steps: Record<LadderStepKey, boolean> }

const SUBMITTED_STAGES = new Set(['submitted', 'shortlisted', 'awarded', 'unsuccessful'])
const DAY_MS = 86_400_000

/** 'YYYY-MM' of the month `offset` months before the month of `asOf` (YYYY-MM-DD). */
const monthBefore = (asOf: string, offset: number) => {
    const [year, month] = asOf.split('-').map(Number)
    const index = year * 12 + (month - 1) - offset
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

const dayValue = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)

const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length

/** Which steps the records show as at `asOf` (YYYY-MM-DD), and the step reached. */
export const evaluateLadder = (input: LadderInput, asOf: string): LadderResult => {
    const byMonth = new Map(input.months.map(row => [row.month, row]))
    // Completed months only: the month asOf falls in is still running.
    const window = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => byMonth.get(monthBefore(asOf, from + index))).filter((row): row is LadderMonth => Boolean(row))

    const lastFour = window(1, 4)
    const lastThree = window(1, 3)
    const halfYearAgo = window(7, 9)

    const revenueOf = (rows: LadderMonth[]) => rows.map(row => Number(row.revenue)).filter(value => Number.isFinite(value) && value >= 0)
    const latestJobs = (rows: LadderMonth[]) => {
        const values = rows.map(row => Number(row.jobs)).filter(value => Number.isFinite(value) && value >= 0)
        return values.length ? values[0] : null
    }

    const recentRevenue = revenueOf(lastThree)
    const earlierRevenue = revenueOf(halfYearAgo).filter(value => value > 0)
    const revenueGrew = recentRevenue.length >= 2 && earlierRevenue.length >= 1 && average(recentRevenue) >= average(earlierRevenue) * 1.1
    const jobsNow = latestJobs(lastThree)
    const jobsThen = latestJobs(halfYearAgo)
    const jobsGrew = jobsNow !== null && jobsThen !== null && jobsNow > jobsThen

    const now = dayValue(asOf)
    const within = (date: string | null | undefined, days: number) => {
        if (!date) return false
        const at = dayValue(date)
        return Number.isFinite(at) && at <= now && now - at < days * DAY_MS
    }
    const stageOf = (row: LadderOpportunity) => String(row.stage || '').toLowerCase()

    const steps: Record<LadderStepKey, boolean> = {
        reporting: lastFour.length >= 3,
        selling: recentRevenue.filter(value => value > 0).length >= 2,
        growing: revenueGrew || jobsGrew,
        market: input.opportunities.some(row => SUBMITTED_STAGES.has(stageOf(row)) && within(row.submittedAt, 90)),
        winning: input.opportunities.some(row => stageOf(row) === 'awarded' && within(row.submittedAt, 365)),
    }

    let rung = 0
    for (const step of LADDER_STEPS) {
        if (!steps[step.key]) break
        rung += 1
    }
    return { rung, steps }
}

/** The last day (YYYY-MM-DD) of each quarter from the one `from` falls in up to the last one ended by `to`. */
export const quarterEnds = (from: string, to: string) => {
    const ends: string[] = []
    const [fromYear, fromMonth] = from.split('-').map(Number)
    let year = fromYear
    let quarter = Math.floor((fromMonth - 1) / 3)
    for (let guard = 0; guard < 200; guard += 1) {
        const lastMonth = quarter * 3 + 3
        const end = new Date(Date.UTC(year, lastMonth, 0)).toISOString().slice(0, 10)
        if (end > to) break
        ends.push(end)
        quarter += 1
        if (quarter === 4) { quarter = 0; year += 1 }
    }
    return ends
}

export const quarterLabel = (end: string) => `${end.slice(0, 4)} Q${Math.floor((Number(end.slice(5, 7)) - 1) / 3) + 1}`

export type LadderPoint = { quarter: string, asOf: string, rung: number }

/** The step at the end of every quarter since joining (the last `limit`), then where the SME stands today. */
export const ladderHistory = (input: LadderInput, joinedAt: string, today: string, limit = 8): LadderPoint[] => {
    const points = quarterEnds(joinedAt, today).slice(-limit).map(end => ({ quarter: quarterLabel(end), asOf: end, rung: evaluateLadder(input, end).rung }))
    return [...points, { quarter: 'Now', asOf: today, rung: evaluateLadder(input, today).rung }]
}

/** How many quarters in a row, ending today, the SME has been on the step it is on now (1 = moved this quarter). */
export const quartersOnStep = (history: LadderPoint[]) => {
    if (!history.length) return 0
    const current = history[history.length - 1].rung
    let count = 0
    // Quarter ends only; "Now" is the current quarter, counted once.
    for (let index = history.length - 2; index >= 0 && history[index].rung === current; index -= 1) count += 1
    return count + 1
}

/** Steps gained since the first quarter on record (negative when the SME has slipped). */
export const stepsGained = (history: LadderPoint[]) => (history.length ? history[history.length - 1].rung - history[0].rung : 0)
