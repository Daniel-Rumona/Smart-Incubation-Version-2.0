import { addDoc, collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { db } from '@/firebase'
import type { FullIdentity } from '@/types/identity'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { KPI_CATALOGUE, type Kpi, type KpiCadence, type KpiDraft, type SystemMetricKey } from '@/types/kpi'

dayjs.extend(quarterOfYear)

type Row = Record<string, unknown> & { id: string }

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const toDate = (value: unknown): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
    if (typeof value === 'object' && value && 'seconds' in value) return new Date(Number((value as { seconds: number }).seconds) * 1000)
    const parsed = new Date(String(value))
    return Number.isNaN(+parsed) ? null : parsed
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const fromDoc = (id: string, data: Record<string, unknown>): Kpi => ({
    id,
    companyCode: String(data.companyCode || ''),
    name: String(data.name || 'KPI'),
    description: data.description ? String(data.description) : undefined,
    kind: (data.kind as Kpi['kind']) || 'manual',
    metric: data.metric as SystemMetricKey | undefined,
    interventionIds: Array.isArray(data.interventionIds) ? data.interventionIds.map(String) : [],
    rule: (data.rule as Kpi['rule']) || 'any',
    atLeast: typeof data.atLeast === 'number' ? data.atLeast : undefined,
    unit: (data.unit as Kpi['unit']) || 'count',
    direction: (data.direction as Kpi['direction']) || 'higher',
    cadence: (data.cadence as KpiCadence) || 'quarter',
    target: typeof data.target === 'number' ? data.target : null,
    programTargets: (data.programTargets as Record<string, number>) || {},
    manualActuals: (data.manualActuals as Kpi['manualActuals']) || {},
    active: data.active !== false,
    createdByUid: data.createdByUid ? String(data.createdByUid) : undefined,
    updatedAt: data.updatedAt,
})

/** Active KPIs for the company. The query filters on companyCode, which the kpis rule checks. */
export const listKpis = async (companyCode: string) => {
    if (!companyCode) return []
    const snapshot = await getDocs(query(collection(db, 'kpis'), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => fromDoc(row.id, row.data())).filter((kpi) => kpi.active).sort((left, right) => left.name.localeCompare(right.name))
}

const cleanDraft = (draft: KpiDraft) => ({
    name: draft.name.trim(),
    description: draft.description?.trim() || null,
    kind: draft.kind,
    metric: draft.kind === 'system' ? draft.metric || null : null,
    interventionIds: draft.kind === 'interventions' ? draft.interventionIds || [] : [],
    rule: draft.kind === 'interventions' ? draft.rule || 'any' : null,
    atLeast: draft.kind === 'interventions' && draft.rule === 'atLeast' ? draft.atLeast || 1 : null,
    unit: draft.unit,
    direction: draft.direction,
    cadence: draft.cadence,
    target: typeof draft.target === 'number' ? draft.target : null,
    programTargets: draft.programTargets || {},
})

export const createKpi = async (user: FullIdentity, draft: KpiDraft) => {
    const companyCode = String(user.companyCode || '')
    if (!companyCode) throw new Error('Your profile has no company, so KPIs cannot be saved.')
    await addDoc(collection(db, 'kpis'), {
        ...cleanDraft(draft),
        companyCode,
        manualActuals: {},
        active: true,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    })
}

export const updateKpi = (id: string, draft: KpiDraft) => updateDoc(doc(db, 'kpis', id), { ...cleanDraft(draft), updatedAt: serverTimestamp() })

/** KPIs are archived, never deleted, so past reports that used them stay explainable. */
export const archiveKpi = (id: string) => updateDoc(doc(db, 'kpis', id), { active: false, updatedAt: serverTimestamp() })

export const setManualActual = (user: FullIdentity, kpi: Kpi, periodKey: string, programId: string | null, value: number, note?: string) =>
    updateDoc(doc(db, 'kpis', kpi.id), {
        [`manualActuals.${actualKey(periodKey, programId)}`]: {
            value,
            note: note?.trim() || null,
            byUid: user.uid,
            byName: user.name || user.displayName || user.email || '',
            at: new Date().toISOString(),
        },
        updatedAt: serverTimestamp(),
    })

// ---------------------------------------------------------------------------
// Periods and targets
// ---------------------------------------------------------------------------

export type KpiPeriod = { key: string; label: string; start: Dayjs; end: Dayjs; elapsed: number }

/** The cadence period containing `at` (offset 0) or the one before it (offset -1). Elapsed is the share of it that has passed. */
export const periodFor = (cadence: KpiCadence, offset = 0, when: Date | Dayjs = new Date()): KpiPeriod => {
    // Re-wrapped so the quarter plugin registered here is always available, whatever dayjs the caller used.
    const at = dayjs(when instanceof Date ? when : when.toDate())
    const anchor = at.add(offset, cadence)
    const start = anchor.startOf(cadence)
    const end = anchor.endOf(cadence)
    const key = cadence === 'year' ? start.format('YYYY') : cadence === 'quarter' ? `${start.format('YYYY')}-Q${start.quarter()}` : start.format('YYYY-MM')
    const label = cadence === 'year' ? start.format('YYYY') : cadence === 'quarter' ? `Q${start.quarter()} ${start.format('YYYY')}` : start.format('MMMM YYYY')
    const elapsed = Math.max(0, Math.min(1, at.diff(start) / Math.max(1, end.diff(start))))
    return { key, label, start, end, elapsed: offset < 0 ? 1 : elapsed }
}

const actualKey = (periodKey: string, programId: string | null) => `${periodKey}|${programId || 'all'}`

/** A programme's own target wins; with no programme selected (or none set for it), the company target applies. */
export const targetFor = (kpi: Kpi, programId: string | null) => {
    if (programId && typeof kpi.programTargets[programId] === 'number') return { value: kpi.programTargets[programId], source: 'programme' as const }
    return kpi.target === null ? null : { value: kpi.target, source: 'company' as const }
}

// ---------------------------------------------------------------------------
// Actuals
// ---------------------------------------------------------------------------

export type KpiData = { assignments: Row[]; appointments: Row[] }

/** Everything the system and intervention KPIs are computed from, scoped to the company and without discontinued SMEs. */
export const loadKpiData = async (companyCode: string): Promise<KpiData> => {
    if (!companyCode) return { assignments: [], appointments: [] }
    const [assignments, appointments] = await Promise.all([
        getDocs(query(collection(db, 'assignedInterventions'), where('companyCode', '==', companyCode))),
        getDocs(query(collection(db, 'appointments'), where('companyCode', '==', companyCode))),
    ])
    const rows = (snapshot: typeof assignments) => snapshot.docs
        .map((row) => ({ id: row.id, ...row.data() } as Row))
        .filter((row) => !isDiscontinuedRecord(row as { participantDiscontinuedAt?: unknown }))
    return { assignments: rows(assignments), appointments: rows(appointments) }
}

// Completed means the SME confirmed it (or it was closed as completed), the same rule as the Operations report.
const isCompleted = (row: Row) => {
    const status = normalize(row.status)
    return status === 'completed' || status === 'done' || normalize(row.completionStatus) === 'confirmed' || normalize(row.participantCompletionStatus) === 'confirmed'
}
const isDeclined = (row: Row) => ['declined', 'cancelled'].includes(normalize(row.status)) || normalize(row.assigneeStatus) === 'declined' || normalize(row.participantStatus) === 'declined'
const completedAt = (row: Row) => toDate(row.completedAt) || toDate(row.updatedAt)
const createdAt = (row: Row) => toDate(row.createdAt) || toDate(row.implementationDate)
const inRange = (date: Date | null, period: KpiPeriod) => !!date && !dayjs(date).isBefore(period.start) && !dayjs(date).isAfter(period.end)

export type KpiActual = {
    value: number | null
    /** Short context under the figure, e.g. "18 of 26" or "+4 SMEs part-way through". */
    detail?: string
    manual?: { byName: string; at: string; note?: string }
}

const median = (values: number[]) => {
    if (!values.length) return null
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}

const systemActual = (metric: SystemMetricKey, assignments: Row[], appointments: Row[], period: KpiPeriod): KpiActual => {
    // Same scoping as the reports: an assignment belongs to the period of its completion, else its due date, else creation.
    const scoped = assignments.filter((row) => inRange(completedAt(row) && isCompleted(row) ? completedAt(row) : toDate(row.dueDate) || createdAt(row), period))
    const done = scoped.filter(isCompleted)

    if (metric === 'interventions_completed') return { value: done.length }
    if (metric === 'completion_rate') {
        return scoped.length ? { value: Math.round((done.length / scoped.length) * 100), detail: `${done.length} of ${scoped.length}` } : { value: null }
    }
    if (metric === 'median_turnaround_days' || metric === 'on_time_rate') {
        const timed = done.flatMap((row) => {
            const finished = toDate(row.completedAt)
            const started = createdAt(row)
            if (!finished || !started) return []
            const due = toDate(row.dueDate)
            return [{ days: Math.max(0, dayjs(finished).diff(started, 'day')), onTime: !due || !dayjs(finished).isAfter(due, 'day') }]
        })
        if (!timed.length) return { value: null }
        if (metric === 'median_turnaround_days') return { value: median(timed.map((item) => item.days)), detail: `${timed.length} completed` }
        const onTime = timed.filter((item) => item.onTime).length
        return { value: Math.round((onTime / timed.length) * 100), detail: `${onTime} of ${timed.length}` }
    }
    if (metric === 'overdue_now') {
        const today = dayjs().startOf('day')
        return { value: assignments.filter((row) => !isCompleted(row) && !isDeclined(row) && toDate(row.dueDate) && dayjs(toDate(row.dueDate)).isBefore(today)).length }
    }
    if (metric === 'smes_supported') return { value: new Set(done.map((row) => String(row.participantId || '')).filter(Boolean)).size }
    if (metric === 'attendance_rate') {
        let present = 0
        let held = 0
        appointments.forEach((row) => {
            const start = toDate(row.startTime)
            if (!start || dayjs(start).isAfter(dayjs()) || !inRange(start, period)) return
            const values = Object.values((row.attendance as Record<string, unknown>) || {}).map(normalize)
            if (values.includes('present')) { present += 1; held += 1 } else if (values.includes('absent')) held += 1
        })
        return held ? { value: Math.round((present / held) * 100), detail: `${present} of ${held}` } : { value: null }
    }
    // average_rating
    const ratings = done.map((row) => (row.feedback as { rating?: unknown } | undefined)?.rating).filter((value): value is number => typeof value === 'number')
    return ratings.length ? { value: Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10, detail: `${ratings.length} rated` } : { value: null }
}

/**
 * SMEs that completed the KPI's interventions. With several interventions an SME counts in the period in which it
 * met the rule: its first listed completion for 'any', its last one for 'all', its Nth one for 'atLeast'.
 */
const interventionActual = (kpi: Kpi, assignments: Row[], period: KpiPeriod): KpiActual => {
    const counts = interventionCounts(kpi, assignments, period)
    if (!counts) return { value: null }
    return { value: counts.counted.length, detail: counts.needed > 1 && counts.partWay ? `+${counts.partWay} part-way` : undefined }
}

/** The SMEs an intervention KPI counts in the period, and how many are part-way there. */
const interventionCounts = (kpi: Kpi, assignments: Row[], period: KpiPeriod) => {
    const wanted = new Set(kpi.interventionIds || [])
    if (!wanted.size) return null
    const needed = kpi.rule === 'all' ? wanted.size : kpi.rule === 'atLeast' ? Math.min(wanted.size, Math.max(1, kpi.atLeast || 1)) : 1

    // Earliest completion of each listed intervention, per SME.
    const bySme = new Map<string, Map<string, Date>>()
    assignments.forEach((row) => {
        const interventionId = String(row.interventionId || '')
        const participantId = String(row.participantId || '')
        if (!wanted.has(interventionId) || !participantId || !isCompleted(row)) return
        const date = completedAt(row)
        if (!date) return
        const own = bySme.get(participantId) || new Map<string, Date>()
        const previous = own.get(interventionId)
        if (!previous || date < previous) own.set(interventionId, date)
        bySme.set(participantId, own)
    })

    const counted: string[] = []
    let partWay = 0
    bySme.forEach((completions, participantId) => {
        const dates = [...completions.values()].sort((left, right) => +left - +right)
        if (dates.length >= needed) {
            if (inRange(dates[needed - 1], period)) counted.push(participantId)
        } else if (dayjs(dates[dates.length - 1]).isBefore(period.end)) {
            partWay += 1
        }
    })
    return { wanted, needed, counted, partWay }
}

const manualActual = (kpi: Kpi, period: KpiPeriod, programId: string | null): KpiActual => {
    const own = kpi.manualActuals[actualKey(period.key, programId)]
    if (own) return { value: own.value, manual: { byName: own.byName, at: own.at, note: own.note } }
    // With no programme selected and no company-wide entry, add up the programmes' entries for countable units.
    if (!programId && ['count', 'currency', 'number'].includes(kpi.unit)) {
        const entries = Object.entries(kpi.manualActuals).filter(([key]) => key.startsWith(`${period.key}|`) && !key.endsWith('|all'))
        if (entries.length) return { value: entries.reduce((sum, [, entry]) => sum + entry.value, 0), detail: `${entries.length} programme${entries.length === 1 ? '' : 's'} reported` }
    }
    return { value: null }
}

export const computeActual = (kpi: Kpi, data: KpiData, period: KpiPeriod, user: FullIdentity | null, programId: string | null): KpiActual => {
    if (kpi.kind === 'manual') return manualActual(kpi, period, programId)
    const programmeIdOf = new Map(data.assignments.map((row) => [row.id, String(row.programId || '')]))
    const assignments = data.assignments.filter((row) => matchesActiveProgram(user, programId || 'all', String(row.programId || '')))
    if (kpi.kind === 'interventions') return interventionActual(kpi, assignments, period)
    const appointments = data.appointments.filter((row) => matchesActiveProgram(user, programId || 'all', String(row.programId || programmeIdOf.get(String(row.assignedInterventionId || '')) || '')))
    return systemActual(kpi.metric || 'interventions_completed', assignments, appointments, period)
}

/**
 * A consultant's own part of a KPI: the same measure over their own assignments and appointments. For an
 * intervention KPI, the counted SMEs for which they completed at least one of the listed interventions, since
 * another consultant may have done the rest. Manual KPIs are entered for the company, so they have no share.
 */
export const computeContribution = (kpi: Kpi, data: KpiData, period: KpiPeriod, user: FullIdentity | null, programId: string | null): KpiActual | null => {
    if (!user || kpi.kind === 'manual') return null
    const uid = normalize(user.uid)
    const email = normalize(user.email)
    const isMine = (row: Row) => (!!uid && normalize(row.assigneeId) === uid) || (!!email && normalize(row.assigneeEmail) === email)
    if (kpi.kind === 'interventions') {
        const assignments = data.assignments.filter((row) => matchesActiveProgram(user, programId || 'all', String(row.programId || '')))
        const counts = interventionCounts(kpi, assignments, period)
        if (!counts) return { value: null }
        const mine = new Set(assignments
            .filter((row) => isMine(row) && counts.wanted.has(String(row.interventionId || '')) && isCompleted(row))
            .map((row) => String(row.participantId || '')))
        return { value: counts.counted.filter((participantId) => mine.has(participantId)).length }
    }
    return computeActual(kpi, { assignments: data.assignments.filter(isMine), appointments: data.appointments.filter((row) => !!uid && normalize(row.assigneeId) === uid) }, period, user, programId)
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type KpiStatus = 'met' | 'on_track' | 'behind' | 'no_target' | 'no_data'

/**
 * Counts build up over a period, so mid-period they're judged against the pace needed to reach the target
 * (target × share of the period gone). Rates, days and ratings are judged as they stand.
 */
export const statusFor = (kpi: Kpi, actual: KpiActual, target: number | null, period: KpiPeriod): { status: KpiStatus; pace: number | null } => {
    if (target === null) return { status: actual.value === null ? 'no_data' : 'no_target', pace: null }
    if (actual.value === null) return { status: 'no_data', pace: null }
    const accumulates = ['count', 'currency', 'number'].includes(kpi.unit) && !(kpi.kind === 'system' && KPI_CATALOGUE.find((item) => item.key === kpi.metric)?.current)
    if (kpi.direction === 'lower') return { status: actual.value <= target ? 'met' : 'behind', pace: null }
    if (actual.value >= target) return { status: 'met', pace: null }
    if (accumulates && period.elapsed < 1) {
        const pace = target * period.elapsed
        return { status: actual.value >= pace ? 'on_track' : 'behind', pace }
    }
    return { status: 'behind', pace: null }
}

export const canEditKpis = (role?: string) => ['operations', 'director', 'admin', 'systemadmin'].includes(String(role || ''))
