import { App, Button, Card, Col, Dropdown, Empty, Form, Grid, Input, InputNumber, Radio, Row, Segmented, Select, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    CheckCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    MinusCircleOutlined,
    MoreOutlined,
    PlusOutlined,
    QuestionCircleOutlined,
    RightOutlined,
    RiseOutlined,
    UserOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import {
    archiveKpi,
    canEditKpis,
    computeActual,
    computeContribution,
    createKpi,
    listKpis,
    loadKpiData,
    myOverdueAssignmentIds,
    periodFor,
    setManualActual,
    statusFor,
    targetFor,
    updateKpi,
    type KpiActual,
    type KpiData,
    type KpiPeriod,
    type KpiStatus,
} from '@/services/kpiService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import { listWorkspacePrograms } from '@/services/workspaceProgramsService'
import { KPI_CATALOGUE, type Kpi, type KpiDraft, type KpiKind, type KpiUnit } from '@/types/kpi'
import '@/styles/kpis.css'

const { Text } = Typography

type Option = { id: string; name: string }
type InterventionOption = { id: string; title: string; area: string }
/**
 * Where a KPI sits on the page: needing attention first, then met or on track, then no data or no target.
 * Consultants are grouped by their own figures; KPIs they have no share in (manual ones) go to 'company', folded away.
 */
type KpiGroup = 'attention' | 'ok' | 'none' | 'company'
type StatusFilter = 'all' | Exclude<KpiGroup, 'company'>
/** The status a KPI shows: the company's, or for a consultant their own ('share' = a count they add to, with no target of its own). */
type ShownStatus = KpiStatus | 'share'

/** Counts add up across people, so a consultant's count is a share of the company's; rates, days and ratings are their own. */
const accumulates = (kpi: Kpi) => ['count', 'currency', 'number'].includes(kpi.unit)
/** Figures that describe right now (overdue work), so they have no history and no period to compare. */
const isRightNow = (kpi: Kpi) => kpi.kind === 'system' && !!KPI_CATALOGUE.find((item) => item.key === kpi.metric)?.current
type Row = {
    kpi: Kpi
    period: KpiPeriod
    actual: KpiActual
    mine: KpiActual | null
    target: { value: number; source: 'programme' | 'company' } | null
    status: KpiStatus
    pace: number | null
    /** What the KPI shows and is grouped by: the company status, or a consultant's own. */
    shown: ShownStatus
    /** Behind badly enough to call off track: under 80% of where it should be, or a limit exceeded by over 25%. */
    offTrack: boolean
    group: KpiGroup
    /** The previous period, for the change shown on the card. Null for "right now" metrics such as overdue work. */
    previous: { period: KpiPeriod; actual: KpiActual } | null
    /** The last six periods, oldest first, for the trend line. */
    trend: Array<number | null>
}

// Same status colours as the reports (checked with the dataviz palette validator), per theme. Behind is amber;
// off track (well behind) is red.
const STATUS_COLORS = {
    light: { met: '#15803D', on_track: '#2563EB', behind: '#B45309', off: '#DC2626', muted: '#64748B' },
    dark: { met: '#16A34A', on_track: '#3B82F6', behind: '#F59E0B', off: '#EF4444', muted: '#94A3B8' },
}

const TREND_PERIODS = 6

/** A small line over the last periods; gaps (no data) are skipped. */
const TrendLine = ({ values, color }: { values: Array<number | null>; color: string }) => {
    const points = values.flatMap((value, index) => value === null ? [] : [[index, value] as const])
    if (points.length < 2) return null
    const max = Math.max(...points.map(([, value]) => value))
    const min = Math.min(...points.map(([, value]) => value))
    const span = max - min || 1
    const xy = points.map(([index, value]) => [(index / (values.length - 1)) * 68 + 2, 20 - ((value - min) / span) * 16] as const)
    const [lastX, lastY] = xy[xy.length - 1]
    return (
        <svg className="kpi-trend" viewBox="0 0 72 24" aria-hidden="true">
            <path d={`M${xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L')}`} style={{ stroke: color }} />
            <circle cx={lastX} cy={lastY} r={2.4} style={{ fill: color }} />
        </svg>
    )
}

type FormValues = {
    name: string
    description?: string
    kind: KpiKind
    metric?: Kpi['metric']
    interventionIds?: string[]
    rule?: Kpi['rule']
    atLeast?: number
    unit?: KpiUnit
    direction?: Kpi['direction']
    cadence: Kpi['cadence']
    target?: number | null
    programTargets?: Array<{ programId?: string; value?: number }>
}

export const KpisPage = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { mode } = useThemeMode()
    const colors = STATUS_COLORS[mode === 'dark' ? 'dark' : 'light']
    const programId = isAllPrograms ? null : activeProgramId
    const editable = canEditKpis(user?.role)
    const companyCode = String(user?.companyCode || '')

    const [kpis, setKpis] = useState<Kpi[]>([])
    const [data, setData] = useState<KpiData>({ assignments: [], appointments: [] })
    const [programs, setPrograms] = useState<Option[]>([])
    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    // "As at" a month: every KPI shows its own period (month, quarter or year) containing it. Default: this month.
    const currentMonth = dayjs().format('YYYY-MM')
    const [asAt, setAsAt] = useState(currentMonth)
    const asAtDate = useMemo(() => (asAt === currentMonth ? new Date() : dayjs(`${asAt}-01`).endOf('month').toDate()), [asAt, currentMonth])
    const monthOptions = useMemo(() => Array.from({ length: 13 }, (_, index) => {
        const month = dayjs().subtract(index, 'month')
        return { value: month.format('YYYY-MM'), label: month.format('MMM YYYY') }
    }), [])
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [view, setView] = useState<'cards' | 'programmes'>('cards')
    const [openId, setOpenId] = useState<string | null>(null)
    const isMobile = !Grid.useBreakpoint().md
    const [editing, setEditing] = useState<Kpi | 'new' | null>(null)
    const [recording, setRecording] = useState<Kpi | null>(null)
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm<FormValues>()
    const [actualForm] = Form.useForm<{ value: number; note?: string }>()

    const load = useCallback(async () => {
        if (!user) return
        setLoading(true)
        setError(null)
        try {
            const [nextKpis, nextData, nextPrograms, definitions] = await Promise.all([
                listKpis(companyCode),
                loadKpiData(companyCode),
                listWorkspacePrograms(user),
                companyCode ? getDocs(query(collection(db, 'interventions'), where('companyCode', '==', companyCode))) : Promise.resolve(null),
            ])
            setKpis(nextKpis)
            setData(nextData)
            setPrograms(nextPrograms.map((program) => ({ id: program.id, name: program.name })))
            setInterventions((definitions?.docs || [])
                .map((row) => ({ id: row.id, title: String(row.data().interventionTitle || 'Untitled intervention'), area: String(row.data().areaOfSupport || 'General') }))
                .sort((left, right) => left.title.localeCompare(right.title)))
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setLoading(false)
        }
    }, [companyCode, user])

    useEffect(() => { void load() }, [load])

    // Consultants see the company's KPIs read-only, with their own part of each alongside.
    const showsOwnPart = user?.role === 'consultant'
    const rows = useMemo<Row[]>(() => {
        const built = kpis.map((kpi): Row => {
            const period = periodFor(kpi.cadence, 0, asAtDate)
            const actual = computeActual(kpi, data, period, user, programId)
            const mine = showsOwnPart ? computeContribution(kpi, data, period, user, programId) : null
            const target = targetFor(kpi, programId)
            const { status, pace } = statusFor(kpi, actual, target?.value ?? null, period)
            // "Right now" metrics (overdue work) have no history to compare with.
            const rightNow = isRightNow(kpi)
            // Change and trend follow what the KPI shows: the company's figure, or a consultant's own.
            const figureFor = (forPeriod: KpiPeriod) => showsOwnPart
                ? computeContribution(kpi, data, forPeriod, user, programId) ?? { value: null }
                : computeActual(kpi, data, forPeriod, user, programId)
            const shownNow = showsOwnPart ? mine ?? { value: null } : actual
            const previousPeriod = periodFor(kpi.cadence, -1, asAtDate)
            const previous = rightNow ? null : { period: previousPeriod, actual: figureFor(previousPeriod) }
            const trend = rightNow ? [] : Array.from({ length: TREND_PERIODS }, (_, index) => {
                const back = index - (TREND_PERIODS - 1)
                if (back === 0) return shownNow.value
                if (back === -1) return previous?.actual.value ?? null
                return figureFor(periodFor(kpi.cadence, back, asAtDate)).value
            })
            const isOffTrack = (value: number | null, judged: KpiStatus, judgedPace: number | null) => judged === 'behind' && value !== null && !!target && (kpi.direction === 'lower'
                ? value > target.value * 1.25
                : value < (judgedPace ?? target.value) * 0.8)
            const groupOf = (judged: ShownStatus): KpiGroup => judged === 'behind' ? 'attention' : judged === 'met' || judged === 'on_track' || judged === 'share' ? 'ok' : 'none'

            if (!showsOwnPart) {
                const offTrack = isOffTrack(actual.value, status, pace)
                return { kpi, period, actual, mine, target, status, pace, shown: status, offTrack, group: groupOf(status), previous, trend }
            }

            // Consultants: judged on their own part. Manual KPIs have no share, so they fold away as company figures.
            if (kpi.kind === 'manual') return { kpi, period, actual, mine, target, status, pace, shown: status, offTrack: false, group: 'company', previous: null, trend: [] }
            if (!mine || mine.value === null) return { kpi, period, actual, mine, target, status, pace, shown: 'no_data', offTrack: false, group: 'none', previous, trend }
            if (rightNow) {
                // Their own overdue work: anything at all needs attention.
                const shown: ShownStatus = mine.value > 0 ? 'behind' : 'met'
                return { kpi, period, actual, mine, target, status, pace, shown, offTrack: mine.value > 2, group: groupOf(shown), previous, trend }
            }
            if (accumulates(kpi)) return { kpi, period, actual, mine, target, status, pace, shown: 'share', offTrack: false, group: 'ok', previous, trend }
            const own = statusFor(kpi, mine, target?.value ?? null, period)
            return { kpi, period, actual, mine, target, status, pace, shown: own.status, offTrack: isOffTrack(mine.value, own.status, own.pace), group: groupOf(own.status), previous, trend }
        })
        // Within a group, off track before behind; otherwise the order the KPIs were set up in.
        return built.sort((left, right) => Number(right.offTrack) - Number(left.offTrack))
    }, [asAtDate, data, kpis, programId, showsOwnPart, user])

    const GROUPS: Array<{ key: KpiGroup; label: string }> = showsOwnPart ? [
        { key: 'attention', label: t('Needs your attention') },
        { key: 'ok', label: t('Your part') },
        { key: 'none', label: t('No data from you yet') },
    ] : [
        { key: 'attention', label: t('Needs attention') },
        { key: 'ok', label: t('Met or on track') },
        { key: 'none', label: t('No data or target yet') },
    ]
    // Company-only KPIs (no consultant share) sit in their own folded section, outside the filters and counts.
    const companyRows = rows.filter((row) => row.group === 'company')
    const [companyOpen, setCompanyOpen] = useState(false)
    const visibleRows = rows.filter((row) => row.group !== 'company' && (statusFilter === 'all' || row.group === statusFilter))
    const groupCount = (group: KpiGroup) => rows.filter((row) => row.group === group).length
    /** The figure a KPI leads with: the company's, or a consultant's own part. */
    const shownValue = (row: Row) => showsOwnPart ? row.mine?.value ?? null : row.actual.value

    const programName = (id: string) => programs.find((program) => program.id === id)?.name || t('Programme')
    const scopeName = programId ? programName(programId) : t('All programmes')

    const formatValue = (unit: KpiUnit, value: number | null) => {
        if (value === null) return '–'
        if (unit === 'percent') return `${value}%`
        if (unit === 'days') return value === 1 ? t('1 day') : t('{count} days', undefined, { count: value })
        if (unit === 'rating') return `${value.toFixed(1)} / 5`
        if (unit === 'currency') return formatCurrencyZAR(value)
        return value.toLocaleString()
    }

    const statusLabels: Record<KpiStatus, { label: string; icon: React.ReactNode; color: string }> = {
        met: { label: t('Met'), icon: <CheckCircleOutlined />, color: colors.met },
        on_track: { label: t('On track'), icon: <RiseOutlined />, color: colors.on_track },
        behind: { label: t('Behind'), icon: <WarningOutlined />, color: colors.behind },
        no_target: { label: t('No target'), icon: <MinusCircleOutlined />, color: colors.muted },
        no_data: { label: t('No data yet'), icon: <QuestionCircleOutlined />, color: colors.muted },
    }

    /** The label and colour a KPI shows: Behind splits into amber Behind and red Off track. */
    const stateOf = (row: Row) => row.offTrack
        ? { label: t('Off track'), icon: <WarningOutlined />, color: colors.off }
        : row.shown === 'share'
            ? { label: t('Your share'), icon: <UserOutlined />, color: colors.on_track }
            : showsOwnPart && isRightNow(row.kpi)
                ? (row.shown === 'behind' ? { label: t('Overdue'), icon: <WarningOutlined />, color: colors.behind } : { label: t('All on time'), icon: <CheckCircleOutlined />, color: colors.met })
                : statusLabels[row.shown as KpiStatus]

    // One sentence on how the company's KPIs stand, naming the ones behind so the reader knows where to look.
    const verdict = (() => {
        if (!rows.length) return ''
        const attention = rows.filter((row) => row.status === 'behind')
        if (!attention.length) {
            const missing = rows.filter((row) => row.status === 'no_data' || row.status === 'no_target').length
            return missing
                ? t('Every KPI with data is met or on track; {count} have no data or target yet.', undefined, { count: missing })
                : t('All {count} KPIs are met or on track.', undefined, { count: rows.length })
        }
        const names = attention.map((row) => row.kpi.name)
        return t('{count} of {total} KPIs need attention: {names}.', undefined, {
            count: attention.length,
            total: rows.length,
            names: names.slice(0, 3).join(', ') + (names.length > 3 ? ` +${names.length - 3}` : ''),
        })
    })()

    // Consultants: one line on their own part, from the KPIs that have one, then how many need their attention.
    const youSummary = (() => {
        if (!showsOwnPart || !rows.length) return ''
        const own = (metric: string) => rows.find((row) => row.kpi.kind === 'system' && row.kpi.metric === metric && row.mine?.value !== null && row.mine?.value !== undefined)?.mine?.value ?? null
        const completed = own('interventions_completed')
        const overdue = own('overdue_now')
        const rating = own('average_rating')
        const facts = [
            completed !== null ? t('{count} completed', undefined, { count: completed }) : '',
            overdue !== null ? (overdue > 0 ? t('{count} overdue', undefined, { count: overdue }) : t('nothing overdue')) : '',
            rating !== null ? t('rated {rating} / 5', undefined, { rating: rating.toFixed(1) }) : '',
        ].filter(Boolean)
        const attention = groupCount('attention')
        const lead = attention
            ? t('{count} of your KPIs need your attention.', undefined, { count: attention })
            : t('Your part is on track.')
        return facts.length ? `${lead} ${t('Your part: {facts}.', undefined, { facts: facts.join(' · ') })}` : lead
    })()

    /** The change against the previous period, e.g. "↑ 8 pts vs Q3 2026", coloured by whether it is good news. */
    const changeOf = (row: Row) => {
        const before = row.previous?.actual.value
        const now = shownValue(row)
        if (before === null || before === undefined || now === null || !row.previous) return null
        const diff = Math.round((now - before) * 10) / 10
        const size = Math.abs(diff)
        const unit = row.kpi.unit
        const amount = unit === 'percent' ? t('{count} pts', undefined, { count: size })
            : unit === 'currency' ? formatCurrencyZAR(size)
            : unit === 'days' ? formatValue('days', size)
            : unit === 'rating' ? size.toFixed(1)
            : size.toLocaleString()
        const tone = diff === 0 ? 'flat' : (diff > 0) === (row.kpi.direction === 'higher') ? 'good' : 'bad'
        return { tone, text: `${amount}`, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat', against: row.previous.period.label }
    }

    // -----------------------------------------------------------------------
    // Editing
    // -----------------------------------------------------------------------

    const openEditor = (kpi: Kpi | 'new') => {
        setEditing(kpi)
        form.resetFields()
        if (kpi === 'new') {
            form.setFieldsValue({ kind: 'system', metric: 'completion_rate', name: t('Completion rate'), cadence: 'quarter', rule: 'any', unit: 'count', direction: 'higher', programTargets: [] })
            return
        }
        form.setFieldsValue({
            ...kpi,
            target: kpi.target,
            programTargets: Object.entries(kpi.programTargets).map(([programIdKey, value]) => ({ programId: programIdKey, value })),
        })
    }

    const kind = Form.useWatch('kind', form)
    const rule = Form.useWatch('rule', form)
    const metric = Form.useWatch('metric', form)
    const pickedInterventions = Form.useWatch('interventionIds', form) || []
    // Watched unconditionally: a hook inside the ternary below changed the hook count whenever `kind` changed,
    // which crashed the page (blank screen) as soon as the editor set the kind.
    const watchedUnit = Form.useWatch('unit', form)
    const unitInForm: KpiUnit = kind === 'system' ? KPI_CATALOGUE.find((item) => item.key === metric)?.unit || 'count' : kind === 'interventions' ? 'count' : watchedUnit || 'count'
    const unitSuffix = unitInForm === 'percent' ? '%' : unitInForm === 'days' ? t('days') : unitInForm === 'rating' ? '/ 5' : unitInForm === 'currency' ? 'ZAR' : undefined

    const save = async () => {
        if (!user) return
        const values = await form.validateFields()
        const system = values.kind === 'system' ? KPI_CATALOGUE.find((item) => item.key === values.metric) : null
        const draft: KpiDraft = {
            name: values.name,
            description: values.description,
            kind: values.kind,
            metric: values.metric,
            interventionIds: values.interventionIds,
            rule: values.rule,
            atLeast: values.atLeast,
            unit: system ? system.unit : values.kind === 'interventions' ? 'count' : values.unit || 'count',
            direction: system ? system.direction : values.kind === 'interventions' ? 'higher' : values.direction || 'higher',
            cadence: values.cadence,
            target: typeof values.target === 'number' ? values.target : null,
            programTargets: Object.fromEntries((values.programTargets || []).filter((row) => row.programId && typeof row.value === 'number').map((row) => [row.programId as string, row.value as number])),
        }
        setSaving(true)
        try {
            if (editing === 'new') await createKpi(user, draft)
            else if (editing) await updateKpi(editing.id, draft)
            message.success(editing === 'new' ? t('KPI added') : t('KPI saved'))
            setEditing(null)
            await load()
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : t('The KPI could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const archive = (kpi: Kpi) => modal.confirm({
        title: t('Archive {name}?', undefined, { name: kpi.name }),
        content: t('It disappears from this page and the reports. Its history is kept.'),
        okText: t('Archive'),
        okButtonProps: { danger: true },
        onOk: async () => {
            await archiveKpi(kpi.id)
            await load()
        },
    })

    const saveActual = async () => {
        if (!user || !recording) return
        const values = await actualForm.validateFields()
        setSaving(true)
        try {
            await setManualActual(user, recording, periodFor(recording.cadence, 0, asAtDate).key, programId, values.value, values.note)
            message.success(t('Actual saved'))
            setRecording(null)
            await load()
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : t('The actual could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const ruleText = (kpi: Kpi) => {
        const count = kpi.interventionIds?.length || 0
        if (kpi.kind !== 'interventions' || !count) return null
        if (count === 1) return t('Counts SMEs that complete 1 intervention')
        if (kpi.rule === 'all') return t('Counts SMEs that complete all {count} interventions', undefined, { count })
        if (kpi.rule === 'atLeast') return t('Counts SMEs that complete at least {needed} of {count} interventions', undefined, { needed: kpi.atLeast || 1, count })
        return t('Counts SMEs that complete any of {count} interventions', undefined, { count })
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    // Counts add up, so a share reads as "4 of the 31"; a rate, a median or a rating is the consultant's own figure.
    const ownPartText = (kpi: Kpi, mine: KpiActual, actual: KpiActual) => {
        if (mine.value === null) return t('Yours: no data yet')
        if (['count', 'currency', 'number'].includes(kpi.unit) && actual.value !== null) {
            return t('Yours: {mine} of the {total}', undefined, { mine: formatValue(kpi.unit, mine.value), total: formatValue(kpi.unit, actual.value) })
        }
        return t('Yours: {mine}', undefined, { mine: formatValue(kpi.unit, mine.value) })
    }

    const menuFor = (kpi: Kpi) => editable ? [
        { key: 'edit', icon: <EditOutlined />, label: t('Edit'), onClick: () => openEditor(kpi) },
        { key: 'archive', icon: <DeleteOutlined />, label: t('Archive'), danger: true, onClick: () => archive(kpi) },
    ] : []

    /** The company's figure against its target, e.g. "of 80% target" or "limit 3". */
    const companyTargetText = (row: Row) => {
        const { kpi, target } = row
        if (!target) return t('no target set')
        return kpi.direction === 'higher'
            ? t('of {target} target', undefined, { target: formatValue(kpi.unit, target.value) })
            : t('limit {target}', undefined, { target: formatValue(kpi.unit, target.value) })
    }

    /**
     * What sits beside the main figure. Consultants: a count is their share of the company's total; a rate, days or
     * rating is their own figure against the same target.
     */
    const targetText = (row: Row) => {
        if (!showsOwnPart || row.group === 'company') return companyTargetText(row)
        if (accumulates(row.kpi)) {
            return row.actual.value !== null
                ? t('of the company’s {total}', undefined, { total: formatValue(row.kpi.unit, row.actual.value) })
                : t('your share')
        }
        return companyTargetText(row)
    }

    /** Consultants lead with their own figure, so the company's sits underneath as context. */
    const companyContext = (row: Row) => showsOwnPart && row.group !== 'company' && (
        <Text type="secondary" className="kpi-card-company">
            {t('Company: {value}', undefined, { value: formatValue(row.kpi.unit, row.actual.value) })}
            {!accumulates(row.kpi) || row.kpi.direction === 'lower' ? ` · ${companyTargetText(row)}` : ''}
        </Text>
    )

    /**
     * Progress to target. Higher-is-better fills towards the target, with a tick where a count should be by now.
     * Lower-is-better gets a bar too: it fills towards the limit (the tick at the middle) and past it in red.
     */
    const progressBar = (row: Row, color: string) => {
        const { kpi, actual, target, pace } = row
        if (!target || actual.value === null) return null
        if (kpi.direction === 'lower') {
            const scale = Math.max(target.value * 2, actual.value, 1)
            return (
                <div className="kpi-progress" role="img" aria-label={t('{value} against a limit of {target}', undefined, { value: formatValue(kpi.unit, actual.value), target: formatValue(kpi.unit, target.value) })}>
                    <span className="kpi-progress-fill" style={{ width: `${Math.min(100, (actual.value / scale) * 100)}%`, background: color }} />
                    <span className="kpi-progress-limit" style={{ left: `${(target.value / scale) * 100}%` }} title={t('Limit')} />
                </div>
            )
        }
        const fill = target.value > 0 ? Math.min(100, (actual.value / target.value) * 100) : 0
        return (
            <div className="kpi-progress" role="img" aria-label={`${Math.round(fill)}%`}>
                <span className="kpi-progress-fill" style={{ width: `${fill}%`, background: color }} />
                {/* Where a count should be by now to finish the period on target. */}
                {pace !== null && target.value > 0 && <span className="kpi-progress-pace" style={{ left: `${Math.min(100, (pace / target.value) * 100)}%` } as CSSProperties} title={t('Expected by now: {value}', undefined, { value: formatValue(kpi.unit, Math.round(pace * 10) / 10) })} />}
            </div>
        )
    }

    /** The bar a KPI shows: the company's, or for a consultant their own figure (a rate) or their share (a count). */
    const barFor = (row: Row, color: string) => {
        if (!showsOwnPart || row.group === 'company') return progressBar(row, color)
        const own = row.mine?.value
        if (own === null || own === undefined || isRightNow(row.kpi)) return null
        if (accumulates(row.kpi)) {
            const total = row.actual.value
            if (!total) return null
            const share = Math.min(100, (own / total) * 100)
            return (
                <div className="kpi-progress" role="img" aria-label={t('{share}% of the company’s total', undefined, { share: Math.round(share) })}>
                    <span className="kpi-progress-fill" style={{ width: `${share}%`, background: color }} />
                </div>
            )
        }
        return progressBar({ ...row, actual: row.mine as KpiActual, pace: null }, color)
    }

    /** Consultants: from a KPI straight to the work behind it. */
    const linkFor = (kpi: Kpi) => {
        if (!showsOwnPart || kpi.kind === 'manual') return null
        if (kpi.kind === 'system' && kpi.metric === 'overdue_now') {
            return { label: t('See my overdue work'), go: () => navigate('/consultant/interventions', { state: { needsYouIds: myOverdueAssignmentIds(data, user, programId) } }) }
        }
        if (kpi.kind === 'system' && kpi.metric === 'attendance_rate') return { label: t('Open my appointments'), go: () => navigate('/shared/interventions/appointments') }
        return { label: t('Open my interventions'), go: () => navigate('/consultant/interventions') }
    }

    const workLink = (kpi: Kpi) => {
        const link = linkFor(kpi)
        return link && (
            <Button type="link" size="small" className="kpi-work-link" onClick={link.go}>
                {link.label} <RightOutlined />
            </Button>
        )
    }

    const changeBadge = (row: Row) => {
        const change = changeOf(row)
        if (!change) return null
        return (
            <span className={`kpi-change is-${change.tone}`} title={t('vs {period}', undefined, { period: change.against })}>
                {change.direction === 'up' ? <ArrowUpOutlined /> : change.direction === 'down' ? <ArrowDownOutlined /> : null}
                {change.text}
                <small>{t('vs {period}', undefined, { period: change.against })}</small>
            </span>
        )
    }

    const manualFooter = (row: Row) => row.kpi.kind === 'manual' && (
        <div className="kpi-card-manual">
            <Text type="secondary">
                {row.actual.manual ? t('Entered by {name}', undefined, { name: row.actual.manual.byName }) : t('No actual entered for {period}.', undefined, { period: row.period.label })}
            </Text>
            {editable && <Button size="small" onClick={() => { setRecording(row.kpi); actualForm.setFieldsValue({ value: row.actual.manual ? row.actual.value ?? undefined : undefined, note: row.actual.manual?.note }) }}>{row.actual.manual ? t('Update actual') : t('Enter actual')}</Button>}
        </div>
    )

    const describe = (kpi: Kpi) => ruleText(kpi) || kpi.description || t(KPI_CATALOGUE.find((item) => item.key === kpi.metric)?.description || '')
    const cadenceLabel = (kpi: Kpi) => kpi.cadence === 'month' ? t('Monthly') : kpi.cadence === 'quarter' ? t('Quarterly') : t('Yearly')
    const detailOf = (row: Row) => (showsOwnPart && row.group !== 'company' ? row.mine?.detail : row.actual.detail)

    const card = (row: Row) => {
        const { kpi, mine, actual, target, period } = row
        const state = stateOf(row)
        const menu = menuFor(kpi)
        return (
            <Card className="kpi-card" key={kpi.id} style={{ '--kpi-color': state.color } as CSSProperties}>
                <div className="kpi-card-head">
                    <div className="kpi-card-title">
                        <strong>{kpi.name}</strong>
                        <span>{describe(kpi)}</span>
                    </div>
                    <span className="kpi-pill">{state.label}</span>
                    {menu.length > 0 && (
                        <Dropdown trigger={['click']} menu={{ items: menu }} placement="bottomRight">
                            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('KPI options')} />
                        </Dropdown>
                    )}
                </div>

                <div className="kpi-card-figure">
                    {showsOwnPart && row.group !== 'company' && <span className="kpi-card-yours">{t('Yours')}</span>}
                    <span className="kpi-card-value">{formatValue(kpi.unit, row.group === 'company' ? actual.value : shownValue(row))}</span>
                    <span className="kpi-card-target">
                        {targetText(row)}
                        {target?.source === 'programme' && <Tag bordered={false} className="kpi-card-source">{t('Programme target')}</Tag>}
                    </span>
                </div>

                {companyContext(row)}
                {!showsOwnPart && mine && <div className="kpi-card-mine"><UserOutlined /> {ownPartText(kpi, mine, actual)}</div>}

                {barFor(row, state.color)}

                <div className="kpi-card-foot">
                    {changeBadge(row)}
                    <TrendLine values={row.trend} color={state.color} />
                    <Text type="secondary" className="kpi-card-meta">{[detailOf(row), `${cadenceLabel(kpi)} · ${period.label}`].filter(Boolean).join(' · ')}</Text>
                </div>

                {workLink(kpi)}
                {manualFooter(row)}
            </Card>
        )
    }

    // Phones: one line per KPI (status dot, name, value over target); tap to open the bar, change and trend.
    const compactRow = (row: Row) => {
        const { kpi, actual, period } = row
        const state = stateOf(row)
        const open = openId === kpi.id
        const menu = menuFor(kpi)
        return (
            <div key={kpi.id} className={`kpi-row${open ? ' is-open' : ''}`} style={{ '--kpi-color': state.color } as CSSProperties}>
                <button type="button" className="kpi-row-main" aria-expanded={open} onClick={() => setOpenId(open ? null : kpi.id)}>
                    <span className="kpi-dot" aria-hidden="true" />
                    <span className="kpi-row-name">{kpi.name}</span>
                    <span className="kpi-row-value">
                        {showsOwnPart && row.group !== 'company' && <em>{t('Yours')} </em>}
                        {formatValue(kpi.unit, row.group === 'company' ? actual.value : shownValue(row))}
                        <small>{targetText(row)}</small>
                    </span>
                    <RightOutlined className="kpi-row-chevron" aria-hidden="true" />
                </button>
                <div className="kpi-row-more"><div>
                    <div className="kpi-row-inner">
                        {companyContext(row)}
                        {!showsOwnPart && row.mine && <div className="kpi-card-mine"><UserOutlined /> {ownPartText(kpi, row.mine, actual)}</div>}
                        {barFor(row, state.color)}
                        <div className="kpi-card-foot">
                            {changeBadge(row)}
                            <TrendLine values={row.trend} color={state.color} />
                            <span className="kpi-pill">{state.label}</span>
                        </div>
                        <Text type="secondary" className="kpi-card-meta">{[describe(kpi), `${cadenceLabel(kpi)} · ${period.label}`].filter(Boolean).join(' · ')}</Text>
                        {workLink(kpi)}
                        {manualFooter(row)}
                        {menu.length > 0 && (
                            <div className="kpi-row-actions">
                                <Button size="small" icon={<EditOutlined />} onClick={() => openEditor(kpi)}>{t('Edit')}</Button>
                                <Button size="small" danger icon={<DeleteOutlined />} onClick={() => archive(kpi)}>{t('Archive')}</Button>
                            </div>
                        )}
                    </div>
                </div></div>
            </div>
        )
    }

    // Programmes view: each KPI against each programme's own target, plus the company figure.
    const programmeColumns = useMemo(() => [{ id: null as string | null, name: t('Company') }, ...programs.map((program) => ({ id: program.id as string | null, name: program.name }))], [programs, t])
    const programmeCell = (row: Row, scopeId: string | null) => {
        const actual = computeActual(row.kpi, data, row.period, user, scopeId)
        const target = targetFor(row.kpi, scopeId)
        if (!target && actual.value === null) return <Text type="secondary">–</Text>
        const { status, pace } = statusFor(row.kpi, actual, target?.value ?? null, row.period)
        const off = status === 'behind' && actual.value !== null && !!target && (row.kpi.direction === 'lower' ? actual.value > target.value * 1.25 : actual.value < (pace ?? target.value) * 0.8)
        const color = off ? colors.off : statusLabels[status].color
        return (
            <span className="kpi-cell" style={{ '--kpi-color': color } as CSSProperties} title={off ? t('Off track') : statusLabels[status].label}>
                <span className="kpi-dot" aria-hidden="true" />
                <b>{formatValue(row.kpi.unit, actual.value)}</b>
                {target && <span>/ {formatValue(row.kpi.unit, target.value)}</span>}
            </span>
        )
    }

    const statusChips: Array<{ key: StatusFilter; label: string; count: number; color?: string }> = [
        { key: 'all', label: showsOwnPart ? t('Your KPIs') : t('All KPIs'), count: rows.length - companyRows.length },
        { key: 'attention', label: showsOwnPart ? t('Need your attention') : t('Need attention'), count: groupCount('attention'), color: colors.off },
        { key: 'ok', label: showsOwnPart ? t('On track') : t('Met or on track'), count: groupCount('ok'), color: colors.met },
        { key: 'none', label: showsOwnPart ? t('No data from you') : t('No data or target'), count: groupCount('none'), color: colors.muted },
    ]

    const groupedRows = GROUPS
        .map((group) => ({ ...group, rows: visibleRows.filter((row) => row.group === group.key) }))
        .filter((group) => group.rows.length)

    return (
        <DashboardPage className="kpis-page">
            <FilterBar
                compact
                primary={
                    <>
                        <label className="kpis-asat">
                            <span>{t('As at')}</span>
                            <Select value={asAt} onChange={(value) => { setAsAt(value); setOpenId(null) }} options={monthOptions} popupMatchSelectWidth={false} aria-label={t('As at')} />
                        </label>
                        <Text type="secondary" className="kpis-scope">{scopeName}</Text>
                    </>
                }
                actions={(
                    <>
                        {/* Comparing programmes is for operations and directors, not consultants. */}
                        {!isMobile && !showsOwnPart && rows.length > 0 && (
                            <Segmented value={view} onChange={(value) => setView(value as 'cards' | 'programmes')} options={[{ value: 'cards', label: t('Cards') }, { value: 'programmes', label: t('Programmes') }]} />
                        )}
                        {editable && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>{t('New KPI')}</Button>}
                    </>
                )}
            />

            {error ? (
                <Card><Empty description={t('KPIs could not be loaded: {error}', undefined, { error })} /></Card>
            ) : !loading && !rows.length ? (
                <Card className="kpis-empty">
                    <Empty
                        description={editable
                            ? t('Set the goals your team works towards. Each KPI tracks its actual against a target, for the company or per programme.')
                            : t('No KPIs have been set yet.')}
                    >
                        {editable && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>{t('Add your first KPI')}</Button>}
                    </Empty>
                </Card>
            ) : (
                <>
                    {/* Status first: the verdict, then the counts, each of which filters the page. */}
                    <div className="kpis-summary">
                        <Card loading={loading} className="dashboard-section-card kpis-verdict">
                            {showsOwnPart ? (
                                <>
                                    {/* Consultants: "You" first; the company verdict is the second line. */}
                                    <Text type="secondary">{t('You · {scope} · as at {month}', undefined, { scope: scopeName, month: dayjs(`${asAt}-01`).format('MMM YYYY') })}</Text>
                                    <p>{youSummary}</p>
                                    <Text type="secondary" className="kpis-own-note">{t('Company: {verdict}', undefined, { verdict })}</Text>
                                </>
                            ) : (
                                <>
                                    <Text type="secondary">{t('{scope} · as at {month}', undefined, { scope: scopeName, month: dayjs(`${asAt}-01`).format('MMM YYYY') })}</Text>
                                    <p>{verdict}</p>
                                </>
                            )}
                        </Card>
                        <div className="kpis-chips" role="group" aria-label={t('Filter by status')}>
                            {statusChips.map((chip) => (
                                <button
                                    key={chip.key}
                                    type="button"
                                    className={`kpis-chip${statusFilter === chip.key ? ' is-active' : ''}`}
                                    aria-pressed={statusFilter === chip.key}
                                    onClick={() => setStatusFilter(chip.key)}
                                    style={chip.color ? { '--kpi-color': chip.color } as CSSProperties : undefined}
                                >
                                    <strong>{loading ? '–' : chip.count}</strong>
                                    <span>{chip.color && <i className="kpi-dot" aria-hidden="true" />}{chip.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {!loading && !visibleRows.length && <Card><Empty description={t('No KPIs match this filter.')} /></Card>}

                    {!isMobile && view === 'programmes' ? (
                        <Card className="dashboard-section-card kpis-table-card">
                            <Table<Row>
                                rowKey={(row) => row.kpi.id}
                                dataSource={visibleRows.slice().sort((left, right) => GROUPS.findIndex((group) => group.key === left.group) - GROUPS.findIndex((group) => group.key === right.group))}
                                pagination={false}
                                scroll={{ x: 'max-content' }}
                                loading={loading}
                                columns={[
                                    {
                                        title: t('KPI'),
                                        key: 'kpi',
                                        fixed: 'left',
                                        render: (_, row) => (
                                            <div className="kpi-table-name">
                                                <strong>{row.kpi.name}</strong>
                                                <span>{cadenceLabel(row.kpi)} · {row.period.label}</span>
                                            </div>
                                        ),
                                    },
                                    ...programmeColumns.map((scope) => ({
                                        title: scope.name,
                                        key: scope.id || 'company',
                                        render: (_: unknown, row: Row) => programmeCell(row, scope.id),
                                    })),
                                ]}
                            />
                        </Card>
                    ) : groupedRows.map((group) => (
                        <section key={group.key} className="kpis-group">
                            <h3 className="kpis-group-head">
                                <i className="kpi-dot" aria-hidden="true" style={{ '--kpi-color': group.key === 'attention' ? colors.off : group.key === 'ok' ? colors.met : colors.muted } as CSSProperties} />
                                {group.label}
                                <span>{group.rows.length}</span>
                            </h3>
                            {isMobile ? (
                                <div className="kpi-rows">{group.rows.map(compactRow)}</div>
                            ) : (
                                <Row gutter={[16, 16]}>
                                    {group.rows.map((row) => <Col key={row.kpi.id} xs={24} md={12} xl={8}>{card(row)}</Col>)}
                                </Row>
                            )}
                        </section>
                    ))}

                    {/* Consultants: KPIs with no share for them (entered by the company) fold away at the bottom. */}
                    {showsOwnPart && companyRows.length > 0 && statusFilter === 'all' && view === 'cards' && (
                        <section className="kpis-group kpis-company">
                            <button type="button" className="kpis-company-toggle" aria-expanded={companyOpen} onClick={() => setCompanyOpen((value) => !value)}>
                                <span>{t('Company figures')} <em>{companyRows.length}</em></span>
                                <small>{t('Tracked by the programme team; you have no share in these.')}</small>
                                <RightOutlined className="kpi-row-chevron" aria-hidden="true" />
                            </button>
                            {companyOpen && (isMobile ? (
                                <div className="kpi-rows">{companyRows.map(compactRow)}</div>
                            ) : (
                                <Row gutter={[16, 16]}>
                                    {companyRows.map((row) => <Col key={row.kpi.id} xs={24} md={12} xl={8}>{card(row)}</Col>)}
                                </Row>
                            ))}
                        </section>
                    )}
                </>
            )}

            <ResponsiveModal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={editing === 'new' ? t('New KPI') : t('Edit KPI')}
                width={640}
                centered
                // One full-width action; closing is the ✕.
                footer={<Button type="primary" block loading={saving} onClick={() => void save()}>{t('Save')}</Button>}
            >
                <Form form={form} layout="vertical" requiredMark="optional" className="kpi-form">
                    <Form.Item name="kind" label={t('What does it measure?')}>
                        <Segmented<KpiKind>
                            block
                            options={[
                                { value: 'system', label: t('A system metric') },
                                { value: 'interventions', label: t('Interventions') },
                                { value: 'manual', label: t('Entered by hand') },
                            ]}
                        />
                    </Form.Item>

                    {kind === 'system' && (
                        <Form.Item name="metric" label={t('Metric')} rules={[{ required: true }]}>
                            <Select
                                options={KPI_CATALOGUE.map((item) => ({ value: item.key, label: t(item.name), description: t(item.description) }))}
                                optionRender={(option) => <div><div>{option.label}</div><Text type="secondary" style={{ fontSize: 12 }}>{option.data.description}</Text></div>}
                                onChange={(value) => {
                                    const current = form.getFieldValue('name')
                                    const wasCatalogueName = !current || KPI_CATALOGUE.some((item) => t(item.name) === current)
                                    if (wasCatalogueName) form.setFieldValue('name', t(KPI_CATALOGUE.find((item) => item.key === value)?.name || ''))
                                }}
                            />
                        </Form.Item>
                    )}

                    {kind === 'interventions' && (
                        <>
                            <Form.Item name="interventionIds" label={t('Interventions')} rules={[{ required: true, message: t('Pick at least one intervention.') }]}>
                                <Select
                                    mode="multiple"
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder={t('Search interventions')}
                                    options={interventions.map((item) => ({ value: item.id, label: item.title, area: item.area }))}
                                    optionRender={(option) => <div><div>{option.label}</div><Text type="secondary" style={{ fontSize: 12 }}>{option.data.area}</Text></div>}
                                />
                            </Form.Item>
                            {pickedInterventions.length > 1 && (
                                <Form.Item name="rule" label={t('An SME counts when it completes')}>
                                    <Radio.Group className="kpi-rule">
                                        <Radio value="any">{t('Any one of them')}</Radio>
                                        <Radio value="all">{t('All of them')}</Radio>
                                        <Radio value="atLeast">
                                            <Space size={6}>
                                                {t('At least')}
                                                <Form.Item name="atLeast" noStyle initialValue={2}>
                                                    <InputNumber min={1} max={pickedInterventions.length} size="small" style={{ width: 64 }} disabled={rule !== 'atLeast'} />
                                                </Form.Item>
                                                {t('of them')}
                                            </Space>
                                        </Radio>
                                    </Radio.Group>
                                </Form.Item>
                            )}
                            <Text type="secondary" className="kpi-form-hint">
                                {t('An SME counts in the period it meets the rule. In a group intervention, each SME counts on its own.')}
                            </Text>
                        </>
                    )}

                    {kind === 'manual' && (
                        <Row gutter={12}>
                            <Col xs={24} sm={12}>
                                <Form.Item name="unit" label={t('Unit')}>
                                    <Select options={[
                                        { value: 'count', label: t('Count') },
                                        { value: 'percent', label: t('Percentage') },
                                        { value: 'currency', label: t('Rand (ZAR)') },
                                        { value: 'number', label: t('Number') },
                                    ]} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} sm={12}>
                                <Form.Item name="direction" label={t('Better when it is')}>
                                    <Select options={[{ value: 'higher', label: t('Higher') }, { value: 'lower', label: t('Lower') }]} />
                                </Form.Item>
                            </Col>
                        </Row>
                    )}

                    <Form.Item name="name" label={t('Name')} rules={[{ required: true, message: t('Give the KPI a name.') }]}>
                        <Input maxLength={80} placeholder={t('Compliance-ready SMEs')} />
                    </Form.Item>
                    <Form.Item name="description" label={t('Description')}>
                        <Input.TextArea maxLength={200} autoSize={{ minRows: 1, maxRows: 3 }} placeholder={t('What it means and why it matters')} />
                    </Form.Item>

                    <Form.Item name="cadence" label={t('Tracked per')}>
                        <Segmented block options={[{ value: 'month', label: t('Month') }, { value: 'quarter', label: t('Quarter') }, { value: 'year', label: t('Year') }]} />
                    </Form.Item>

                    <Form.Item name="target" label={t('Company target')} extra={t('Leave empty to track it without a target.')}>
                        <InputNumber min={0} style={{ width: '100%' }} addonAfter={unitSuffix} />
                    </Form.Item>

                    <Form.List name="programTargets">
                        {(fields, { add, remove }) => (
                            <div className="kpi-program-targets">
                                <Text strong>{t('Programme targets')}</Text>
                                <Text type="secondary" className="kpi-form-hint">{t('A programme with its own target (for example a sponsor contract) uses it instead of the company one.')}</Text>
                                {fields.map((field) => (
                                    // Programme and target stay joined; removing the row is its own round button beside them.
                                    <div key={field.key} className="kpi-program-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Space.Compact block style={{ flex: 1, minWidth: 0 }}>
                                            <Form.Item name={[field.name, 'programId']} noStyle rules={[{ required: true }]}>
                                                <Select placeholder={t('Programme')} style={{ width: '60%' }} options={programs.map((program) => ({ value: program.id, label: program.name }))} />
                                            </Form.Item>
                                            <Form.Item name={[field.name, 'value']} noStyle rules={[{ required: true }]}>
                                                <InputNumber min={0} placeholder={t('Target')} style={{ width: '40%' }} />
                                            </Form.Item>
                                        </Space.Compact>
                                        <Button shape="circle" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label={t('Remove programme target')} />
                                    </div>
                                ))}
                                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} disabled={!programs.length}>{t('Add programme target')}</Button>
                            </div>
                        )}
                    </Form.List>
                </Form>
            </ResponsiveModal>

            <ResponsiveModal
                open={recording !== null}
                onClose={() => setRecording(null)}
                title={recording ? t('Actual for {name}', undefined, { name: recording.name }) : ''}
                width={440}
                centered
                footer={<Button type="primary" block loading={saving} onClick={() => void saveActual()}>{t('Save')}</Button>}
            >
                {recording && (
                    <Form form={actualForm} layout="vertical" requiredMark="optional">
                        <Text type="secondary" className="kpi-form-hint">
                            {t('{period} · {scope}', undefined, { period: periodFor(recording.cadence, 0, asAtDate).label, scope: scopeName })}
                        </Text>
                        <Form.Item name="value" label={t('Actual')} rules={[{ required: true, message: t('Enter the actual.') }]}>
                            <InputNumber min={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name="note" label={t('Source or note')}>
                            <Input maxLength={160} placeholder={t('Quarterly sponsor return')} />
                        </Form.Item>
                    </Form>
                )}
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default KpisPage
