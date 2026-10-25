import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { getFirebaseDb } from '@/config/firebase'
import { listAgentRatings, type AgentRatingRecord } from '@/services/agentRatingsService'
import { listUsagePageViews, listUsageSessions, type UsagePageViewRecord, type UsageSessionRecord } from '@/services/usageTrackingService'
import type { FullIdentity } from '@/types/identity'
import {
    RECOMMENDED_PLATFORM_KPIS,
    type PlatformKpi,
    type PlatformKpiCadence,
    type PlatformKpiDraft,
    type PlatformMetricKey,
} from '@/types/platformKpi'

dayjs.extend(quarterOfYear)

const COLLECTION = 'platformKpis'

const assertAdmin = (user: FullIdentity) => {
    if (!['systemadmin', 'admin'].includes(user.role)) throw new Error('forbidden')
}

const toDate = (value: unknown): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return (value as { toDate: () => Date }).toDate()
    const parsed = new Date(String(value))
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const fromDoc = (id: string, data: Record<string, unknown>): PlatformKpi => ({
    id,
    name: String(data.name || 'KPI'),
    description: data.description ? String(data.description) : undefined,
    category: (data.category as PlatformKpi['category']) || 'engineering',
    kind: data.kind === 'auto' ? 'auto' : 'manual',
    metric: data.metric as PlatformMetricKey | undefined,
    unit: (data.unit as PlatformKpi['unit']) || 'count',
    direction: data.direction === 'lower' ? 'lower' : 'higher',
    cadence: data.cadence === 'quarter' ? 'quarter' : 'month',
    target: typeof data.target === 'number' ? data.target : null,
    manualActuals: (data.manualActuals as PlatformKpi['manualActuals']) || {},
    seedKey: data.seedKey ? String(data.seedKey) : undefined,
    active: data.active !== false,
})

/** Every platform KPI, archived ones included (the caller filters), so seeding can tell what already exists. */
export const listPlatformKpis = async (user: FullIdentity) => {
    assertAdmin(user)
    const snapshot = await getDocs(collection(getFirebaseDb(), COLLECTION))
    return snapshot.docs.map((row) => fromDoc(row.id, row.data()))
}

const cleanDraft = (draft: PlatformKpiDraft) => ({
    name: draft.name.trim(),
    description: draft.description?.trim() || null,
    category: draft.category,
    kind: draft.kind,
    metric: draft.kind === 'auto' ? draft.metric || null : null,
    unit: draft.unit,
    direction: draft.direction,
    cadence: draft.cadence,
    target: typeof draft.target === 'number' ? draft.target : null,
})

export const createPlatformKpi = async (user: FullIdentity, draft: PlatformKpiDraft, seedKey?: string) => {
    assertAdmin(user)
    await addDoc(collection(getFirebaseDb(), COLLECTION), {
        ...cleanDraft(draft),
        ...(seedKey ? { seedKey } : {}),
        manualActuals: {},
        active: true,
        createdByUid: user.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    })
}

export const updatePlatformKpi = (user: FullIdentity, id: string, draft: PlatformKpiDraft) => {
    assertAdmin(user)
    return updateDoc(doc(getFirebaseDb(), COLLECTION, id), { ...cleanDraft(draft), updatedAt: serverTimestamp() })
}

/** Archived, never deleted, so the history of what was tracked stays. Re-adding recommended KPIs revives them. */
export const setPlatformKpiActive = (user: FullIdentity, id: string, active: boolean) => {
    assertAdmin(user)
    return updateDoc(doc(getFirebaseDb(), COLLECTION, id), { active, updatedAt: serverTimestamp() })
}

export const setPlatformManualActual = (user: FullIdentity, kpi: PlatformKpi, periodKey: string, value: number, note?: string) => {
    assertAdmin(user)
    return updateDoc(doc(getFirebaseDb(), COLLECTION, kpi.id), {
        [`manualActuals.${periodKey}`]: {
            value,
            note: note?.trim() || null,
            byUid: user.uid,
            byName: user.name || user.displayName || user.email || '',
            at: new Date().toISOString(),
        },
        updatedAt: serverTimestamp(),
    })
}

/** Adds the recommended KPIs that are missing and revives archived ones; returns how many changed. */
export const seedRecommendedPlatformKpis = async (user: FullIdentity, existing: PlatformKpi[]) => {
    assertAdmin(user)
    const bySeed = new Map(existing.filter((kpi) => kpi.seedKey).map((kpi) => [kpi.seedKey!, kpi]))
    let changed = 0
    for (const { seedKey, ...draft } of RECOMMENDED_PLATFORM_KPIS) {
        const current = bySeed.get(seedKey)
        if (!current) {
            await createPlatformKpi(user, draft, seedKey)
            changed += 1
        } else if (!current.active) {
            await setPlatformKpiActive(user, current.id, true)
            changed += 1
        }
    }
    return changed
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type PlatformKpiPeriod = { key: string; label: string; shortLabel: string; start: Dayjs; end: Dayjs; elapsed: number }

/** The cadence period `offset` steps from the one containing `from` (default today; 0 = that one, -1 = the one before). */
export const platformPeriod = (cadence: PlatformKpiCadence, offset = 0, from: Dayjs = dayjs()): PlatformKpiPeriod => {
    const anchor = from.add(offset, cadence)
    const start = anchor.startOf(cadence)
    const end = anchor.endOf(cadence)
    const quarter = `Q${start.quarter()}`
    return {
        key: cadence === 'quarter' ? `${start.format('YYYY')}-${quarter}` : start.format('YYYY-MM'),
        label: cadence === 'quarter' ? `${quarter} ${start.format('YYYY')}` : start.format('MMMM YYYY'),
        shortLabel: cadence === 'quarter' ? quarter : start.format('MMM'),
        start,
        end,
        elapsed: Math.max(0, Math.min(1, dayjs().diff(start) / Math.max(1, end.diff(start)))),
    }
}

// ---------------------------------------------------------------------------
// Automatic figures
// ---------------------------------------------------------------------------

export type PlatformKpiData = {
    users: Array<{ uid: string; companyCode: string; createdAt: Date | null }>
    applications: Array<{ createdAt: Date | null }>
    emails: Array<{ status: string; createdAt: Date | null }>
    sessions: UsageSessionRecord[]
    pageViews: UsagePageViewRecord[]
    ratings: AgentRatingRecord[]
}

/** Everything the automatic KPIs are worked out from. Each source is optional: one failing leaves its KPIs empty. */
export const loadPlatformKpiData = async (user: FullIdentity): Promise<PlatformKpiData> => {
    assertAdmin(user)
    const db = getFirebaseDb()
    const docs = (name: string) => getDocs(collection(db, name)).then((snapshot) => snapshot.docs.map((row) => ({ id: row.id, ...row.data() } as Record<string, unknown> & { id: string }))).catch(() => [])
    const [users, applications, emails, sessions, pageViews, ratings] = await Promise.all([
        docs('users'),
        docs('applications'),
        docs('emailDeliveryLogs'),
        listUsageSessions().catch(() => []),
        listUsagePageViews().catch(() => []),
        listAgentRatings(user).catch(() => []),
    ])
    return {
        users: users.map((row) => ({ uid: row.id, companyCode: String(row.companyCode || '').trim(), createdAt: toDate(row.createdAt) })),
        applications: applications.map((row) => ({ createdAt: toDate(row.createdAt || row.submittedAt) })),
        emails: emails.map((row) => ({ status: String(row.status || ''), createdAt: toDate(row.createdAt) })),
        sessions,
        pageViews,
        ratings,
    }
}

export type PlatformKpiActual = {
    value: number | null
    /** Short context under the figure, e.g. "18 of 26". */
    detail?: string
    manual?: { byName: string; at: string; note?: string }
}

const within = (date: Date | null | undefined, period: PlatformKpiPeriod) => !!date && !dayjs(date).isBefore(period.start) && !dayjs(date).isAfter(period.end)
const round1 = (value: number) => Math.round(value * 10) / 10
const share = (part: number, whole: number) => (whole ? { value: Math.round((part / whole) * 100), detail: `${part} of ${whole}` } : { value: null })

const autoActual = (metric: PlatformMetricKey, data: PlatformKpiData, period: PlatformKpiPeriod, previous: PlatformKpiPeriod): PlatformKpiActual => {
    const sessions = data.sessions.filter((session) => within(session.startedAt, period))
    const activeUids = new Set(sessions.map((session) => session.uid).filter(Boolean))

    switch (metric) {
        case 'monthly_active_users':
            return { value: activeUids.size }
        case 'new_users':
            return { value: data.users.filter((row) => within(row.createdAt, period)).length }
        case 'activation_rate': {
            const fresh = data.users.filter((row) => within(row.createdAt, period))
            const everActive = new Set(data.sessions.map((session) => session.uid))
            return share(fresh.filter((row) => everActive.has(row.uid)).length, fresh.length)
        }
        case 'active_companies': {
            const companyOf = new Map(data.users.map((row) => [row.uid, row.companyCode]))
            return { value: new Set([...activeUids].map((uid) => companyOf.get(uid)).filter(Boolean)).size }
        }
        case 'applications_submitted':
            return { value: data.applications.filter((row) => within(row.createdAt, period)).length }
        case 'returning_users_rate': {
            const before = new Set(data.sessions.filter((session) => within(session.startedAt, previous)).map((session) => session.uid))
            return share([...activeUids].filter((uid) => before.has(uid)).length, activeUids.size)
        }
        case 'stickiness': {
            if (!activeUids.size) return { value: null }
            const days = new Map<string, Set<string>>()
            sessions.forEach((session) => {
                const key = dayjs(session.startedAt).format('YYYY-MM-DD')
                days.set(key, (days.get(key) || new Set()).add(session.uid))
            })
            const elapsedDays = Math.max(1, Math.min(dayjs().isAfter(period.end) ? period.end.diff(period.start, 'day') + 1 : dayjs().diff(period.start, 'day') + 1, period.end.diff(period.start, 'day') + 1))
            const averageDaily = [...days.values()].reduce((sum, uids) => sum + uids.size, 0) / elapsedDays
            return { value: Math.round((averageDaily / activeUids.size) * 100), detail: `${round1(averageDaily)} a day` }
        }
        case 'avg_session_minutes':
            return sessions.length ? { value: round1(sessions.reduce((sum, session) => sum + session.durationSeconds, 0) / sessions.length / 60), detail: `${sessions.length} sessions` } : { value: null }
        case 'pages_per_session': {
            if (!sessions.length) return { value: null }
            const views = data.pageViews.filter((view) => within(view.startedAt, period)).length
            return { value: round1(views / sessions.length), detail: `${views} page views` }
        }
        case 'email_delivery_rate': {
            const emails = data.emails.filter((row) => within(row.createdAt, period))
            return share(emails.filter((row) => row.status !== 'failed').length, emails.length)
        }
        case 'email_failures':
            return { value: data.emails.filter((row) => row.status === 'failed' && within(row.createdAt, period)).length }
        case 'ai_rating': {
            const ratings = data.ratings.filter((row) => within(row.createdAt, period))
            return ratings.length ? { value: round1(ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length), detail: `${ratings.length} ratings` } : { value: null }
        }
        case 'ai_rated_conversations':
            return { value: data.ratings.filter((row) => within(row.createdAt, period)).length }
        default:
            return { value: null }
    }
}

export const platformKpiActual = (kpi: PlatformKpi, data: PlatformKpiData | undefined, period: PlatformKpiPeriod): PlatformKpiActual => {
    if (kpi.kind === 'manual') {
        const entry = kpi.manualActuals[period.key]
        return entry ? { value: entry.value, manual: { byName: entry.byName, at: entry.at, note: entry.note } } : { value: null }
    }
    if (!kpi.metric || !data) return { value: null }
    const previous = platformPeriod(kpi.cadence, -1, period.start)
    return autoActual(kpi.metric, data, period, previous)
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type PlatformKpiStatus = 'met' | 'on_track' | 'behind' | 'no_target' | 'no_data'

/**
 * Met when the actual is on the right side of the target. For a count still being built up in the current
 * period ("releases", "active users"), on track means it is at least where it should be by now.
 */
export const platformKpiStatus = (kpi: PlatformKpi, actual: PlatformKpiActual, period: PlatformKpiPeriod): PlatformKpiStatus => {
    if (actual.value === null) return 'no_data'
    if (kpi.target === null) return 'no_target'
    const met = kpi.direction === 'higher' ? actual.value >= kpi.target : actual.value <= kpi.target
    if (met) return 'met'
    const accumulates = kpi.unit === 'count' && kpi.direction === 'higher'
    if (accumulates && period.elapsed < 1 && actual.value >= kpi.target * period.elapsed) return 'on_track'
    return 'behind'
}
