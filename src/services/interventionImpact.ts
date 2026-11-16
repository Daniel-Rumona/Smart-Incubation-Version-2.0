import dayjs from 'dayjs'
import { metricHistory, type PerformanceSourceRow } from './smePerformanceMetrics'

export type InterventionExposure = {
    interventionId: string
    title: string
    participantId: string
    programId: string
    completed: boolean
    completedAt: string | null
}
export type InterventionImpact = {
    id: string
    title: string
    smes: number
    revenueSmes: number
    jobsSmes: number
    revenueChange: number | null
    jobsChange: number | null
}
const median = (values: number[]) => {
    if (!values.length) return null
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    return Math.round((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10
}

/** One observation per SME/intervention; all recorded steps must be completed. */
export const rankInterventionImpact = (
    participants: Array<{ id: string, programId: string, source: PerformanceSourceRow }>,
    assignments: InterventionExposure[], lagMonths: number, now = dayjs(),
): InterventionImpact[] => {
    const people = new Map(participants.map(row => [row.id, row]))
    const cohorts = new Map<string, InterventionExposure[]>()
    assignments.forEach(row => {
        const person = people.get(row.participantId)
        if (!person || (row.programId && row.programId !== person.programId)) return
        const key = JSON.stringify([row.interventionId || row.title, row.participantId])
        cohorts.set(key, [...(cohorts.get(key) || []), row])
    })
    const groups = new Map<string, { title: string, smes: number, revenue: number[], jobs: number[] }>()
    cohorts.forEach(rows => {
        if (rows.some(row => !row.completed || !row.completedAt || !dayjs(row.completedAt).isValid())) return
        const row = rows[0]
        const completion = rows.map(item => dayjs(item.completedAt!)).sort((a, b) => b.valueOf() - a.valueOf())[0]
        if (completion.isAfter(now)) return
        const baselineEnd = completion.startOf('month')
        // Exclude the completion month; zero lag starts with the next full calendar month.
        const afterStart = baselineEnd.add(1 + lagMonths, 'month')
        const source = people.get(row.participantId)!.source
        const key = row.interventionId || row.title
        const group = groups.get(key) || { title: row.title, smes: 0, revenue: [], jobs: [] }
        group.smes += 1
        for (const metric of ['revenue', 'headcount'] as const) {
            const monthlySource = metric === 'revenue'
                ? { revenueHistory: { monthly: source.revenueHistory?.monthly } }
                : { headcountHistory: { monthly: source.headcountHistory?.monthly } }
            const entries = metricHistory(monthlySource, metric).filter(entry => entry.date.isBefore(now.startOf('month')))
            const before = entries.filter(entry => !entry.date.isBefore(baselineEnd.subtract(6, 'month')) && entry.date.isBefore(baselineEnd))
            const after = entries.filter(entry => !entry.date.isBefore(afterStart) && entry.date.isBefore(afterStart.add(6, 'month')))
            if (!before.length || !after.length) continue
            if (metric === 'revenue') {
                const average = (list: typeof entries) => list.reduce((sum, item) => sum + item.value, 0) / list.length
                const base = average(before)
                if (base > 0) group.revenue.push((average(after) - base) / base * 100)
            } else group.jobs.push(after[after.length - 1].value - before[before.length - 1].value)
        }
        groups.set(key, group)
    })
    return [...groups].map(([id, group]) => ({ id, title: group.title, smes: group.smes,
        revenueSmes: group.revenue.length, jobsSmes: group.jobs.length,
        revenueChange: median(group.revenue), jobsChange: median(group.jobs) }))
}
