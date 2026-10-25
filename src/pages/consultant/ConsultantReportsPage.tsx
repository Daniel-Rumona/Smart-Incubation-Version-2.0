import { Button, Card, Col, DatePicker, Dropdown, Empty, Popover, Progress, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import type { ColumnsType } from 'antd/es/table'
import { AreaChartOutlined, BarChartOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined, DownOutlined, ExclamationCircleOutlined, ExpandAltOutlined, FilterOutlined, FlagOutlined, FundOutlined, MessageOutlined, PlayCircleOutlined, RiseOutlined, StarOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { ReportPlayer, type PlayerSlide } from '@/components/reports/ReportPlayer'
import { ChartDetailsModal } from '@/components/shared/ChartDetailsModal'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ReportExportButton } from '@/components/shared/ReportExportButton'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { waitingOnFor } from '@/services/interventionHoldUp'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import type { ReportExportData } from '@/services/reportExport'
import {
    assignmentParticipant,
    assignmentProgram,
    assignmentTitle,
    deriveConsultantStatus,
    downloadCsv,
    getFeedback,
    isOverdueAssignment,
    progressForAssignment,
    toDate,
} from './ConsultantWorkspaceUtils'
import '@/styles/consultant.css'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

// The burn-up band is an arearange series, which lives in highcharts-more. Same registration as DirectorReportsPage.
const highchartsMore = typeof HighchartsMore === 'function' ? HighchartsMore : (HighchartsMore as { default?: unknown }).default
if (typeof highchartsMore === 'function') (highchartsMore as (highcharts: typeof Highcharts) => void)(Highcharts)

type Period = 'month' | 'quarter' | 'year' | 'all' | 'custom'
type StatusKey = 'overdue' | 'pending' | 'inProgress' | 'completed' | 'declined'
type DetailKey = 'status' | 'trend' | 'overdue' | 'turnaround' | 'attendance' | 'ratings'
type Section = 'delivery' | 'timeliness' | 'engagement'
type Audience = 'me' | 'manager'

type ReportRow = {
    id: string
    title: string
    participant: string
    program: string
    status: ReturnType<typeof deriveConsultantStatus>
    progress: number
    dueDate: Date | null
    completedAt: Date | null
    rating?: number
    raw: AssignedIntervention
}

type OverdueItem = { row: ReportRow; daysLate: number }
type FinishedItem = { row: ReportRow; finishedAt: Date; createdAt: Date; days: number; onTime: boolean }
type TrendBucket = { label: string; from: Dayjs; to: Dayjs; assigned: number; completed: number; assignedTotal: number; completedTotal: number }
type HeldAppointment = { key: string; date: Date; participant: string; intervention: string; present: boolean }

const { RangePicker } = DatePicker
const { Text } = Typography

// Checked with the dataviz palette validator for each surface. The status chart keeps the order
// overdue, pending, in progress, completed, declined so red and green never sit side by side.
// Declined is a deliberate neutral gray.
const STATUS_COLORS = {
    light: { overdue: '#DC2626', pending: '#CA8A04', inProgress: '#2563EB', completed: '#15803D', declined: '#64748B', assigned: '#7C3AED' },
    dark: { overdue: '#DC2626', pending: '#B48C08', inProgress: '#3B82F6', completed: '#16A34A', declined: '#94A3B8', assigned: '#8B5CF6' },
}

const STATUS_ORDER: StatusKey[] = ['overdue', 'pending', 'inProgress', 'completed', 'declined']

// Upper bound in days for each band; used for both days late and turnaround.
const DAY_BANDS = [
    { label: 'Up to 7 days', max: 7 },
    { label: '8 to 14 days', max: 14 },
    { label: '15 to 30 days', max: 30 },
    { label: 'Over 30 days', max: Infinity },
]

const rangeFor = (period: Period): [Dayjs, Dayjs] => {
    const now = dayjs()
    if (period === 'month') return [now.startOf('month'), now.endOf('month')]
    if (period === 'quarter') return [now.startOf('quarter'), now.endOf('quarter')]
    if (period === 'year') return [now.startOf('year'), now]
    if (period === 'all') return [now.subtract(10, 'year').startOf('year'), now.endOf('day')]
    return [now.startOf('year'), now]
}

const dateInRange = (date: Date | null, start: Dayjs, end: Dayjs) => {
    if (!date) return false
    return dayjs(date).isSameOrAfter(start, 'day') && dayjs(date).isSameOrBefore(end, 'day')
}

const statusKeyOf = (row: ReportRow): StatusKey => {
    if (row.status === 'Rejected') return 'declined'
    if (row.status === 'Completed') return 'completed'
    // A declined item past its due date counts as declined, so overdue only covers work still open.
    if (isOverdueAssignment(row.raw)) return 'overdue'
    return row.status === 'In progress' ? 'inProgress' : 'pending'
}

const bandCounts = (values: number[]) => DAY_BANDS.map((band, index) => values.filter((value) => value <= band.max && (index === 0 || value > DAY_BANDS[index - 1].max)).length)

export const ConsultantReportsPage = () => {
    const { t } = useLanguage()
    const { assignments, loading, isMine } = useAssignedInterventions()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { mode } = useThemeMode()
    const dark = mode === 'dark'
    const labelColor = dark ? '#e5e7eb' : '#374151'
    const colors = STATUS_COLORS[dark ? 'dark' : 'light']
    const navigate = useNavigate()
    // Skeletons only on the first load; a refresh keeps the last render and fades it.
    const firstLoad = loading && !assignments.length
    const refreshing = loading && !firstLoad
    const [period, setPeriod] = useState<Period>('year')
    const [[start, end], setRange] = useState<[Dayjs, Dayjs]>(rangeFor('year'))
    const [smes, setSmes] = useState<string[]>([])
    const [statuses, setStatuses] = useState<StatusKey[]>([])
    const [filtersOpen, setFiltersOpen] = useState(false)
    const [details, setDetails] = useState<DetailKey | null>(null)
    const [section, setSection] = useState<Section>('delivery')
    const [playerOpen, setPlayerOpen] = useState(false)
    const [playerOrigin, setPlayerOrigin] = useState<{ x: number; y: number } | null>(null)
    const [audience, setAudience] = useState<Audience>('me')
    const [appointments, setAppointments] = useState<Array<Record<string, unknown>>>([])

    useEffect(() => {
        if (!user?.uid) return
        let active = true
        void getDocs(query(collection(db, 'appointments'), where('assigneeId', '==', user.uid)))
            .then((snapshot) => { if (active) setAppointments(snapshot.docs.map((row) => ({ id: row.id, ...row.data() } as Record<string, unknown>)).filter((row) => !isDiscontinuedRecord(row as { participantDiscontinuedAt?: unknown }))) })
            .catch(() => { if (active) setAppointments([]) })
        return () => { active = false }
    }, [user?.uid])

    const allRows = useMemo<ReportRow[]>(() => assignments.filter(isMine).map((assignment) => {
        const status = deriveConsultantStatus(assignment)
        return {
            id: assignment.id,
            title: assignmentTitle(assignment),
            participant: assignmentParticipant(assignment),
            program: assignmentProgram(assignment),
            status,
            progress: progressForAssignment(assignment, status),
            dueDate: toDate(assignment.dueDate),
            completedAt: toDate(assignment.completedAt) || toDate(assignment.updatedAt),
            rating: getFeedback(assignment).rating,
            raw: assignment,
        }
    }), [assignments, isMine])

    const statusLabels: Record<StatusKey, string> = {
        overdue: t('consultant.status.overdue', 'Overdue'),
        pending: t('consultant.status.pending', 'Pending'),
        inProgress: t('consultant.status.inProgress', 'In progress'),
        completed: t('consultant.status.completed', 'Completed'),
        declined: t('consultant.status.rejected', 'Rejected'),
    }
    const periodLabels: Record<Period, string> = {
        month: t('consultant.reports.thisMonth'),
        quarter: t('consultant.reports.thisQuarter'),
        year: t('consultant.reports.thisYear'),
        all: t('consultant.reports.allTime', 'All time'),
        custom: t('consultant.reports.custom'),
    }

    // The programme comes from the top-bar selector.
    const programRows = allRows.filter((row) => matchesActiveProgram(user, activeProgramId, String(row.raw.programId || '')))
    const programIdByAssignment = new Map(allRows.map((row) => [row.id, String(row.raw.programId || '')]))
    const smeOptions = [...new Set(programRows.map((row) => row.participant).filter(Boolean))].sort()

    // SME and status apply everywhere; the period is applied per chart below.
    const filteredRows = programRows.filter((row) =>
        (!smes.length || smes.includes(row.participant))
        && (!statuses.length || statuses.includes(statusKeyOf(row))))

    const scopedRows = filteredRows.filter((row) => dateInRange(row.completedAt || row.dueDate || toDate(row.raw.createdAt), start, end))

    const byStatus = (key: StatusKey) => scopedRows.filter((row) => statusKeyOf(row) === key)
    const completed = byStatus('completed')
    const rejected = byStatus('declined')
    const overdue = byStatus('overdue')
    const active = byStatus('inProgress')
    const pending = byStatus('pending')
    const isLate = (row: ReportRow) => statusKeyOf(row) === 'overdue'
    const rated = scopedRows.filter((row) => row.rating != null)
    const avgRating = rated.length ? rated.reduce((sum, row) => sum + (row.rating || 0), 0) / rated.length : 0
    const completionRate = scopedRows.length ? Math.round((completed.length / scopedRows.length) * 100) : 0

    // Turnaround: assigned -> completed, using real completion timestamps only.
    const finished: FinishedItem[] = completed
        .map((row) => ({ row, finishedAt: toDate(row.raw.completedAt), createdAt: toDate(row.raw.createdAt) || toDate(row.raw.implementationDate) }))
        .filter((item): item is { row: ReportRow; finishedAt: Date; createdAt: Date } => !!item.finishedAt && !!item.createdAt)
        .map((item) => ({
            ...item,
            days: Math.max(0, dayjs(item.finishedAt).diff(dayjs(item.createdAt), 'day')),
            onTime: !item.row.dueDate || !dayjs(item.finishedAt).isAfter(item.row.dueDate, 'day'),
        }))
    const onTime = finished.filter((item) => item.onTime)
    const onTimeRate = finished.length ? Math.round((onTime.length / finished.length) * 100) : 0

    // Their own appointments held in a date range. Status does not apply to appointments; programme and SME do.
    const heldIn = (from: Dayjs, to: Dayjs): HeldAppointment[] => appointments.flatMap((row) => {
        const date = toDate(row.startTime)
        if (!date || dayjs(date).isAfter(dayjs()) || !dateInRange(date, from, to)) return []
        if (!matchesActiveProgram(user, activeProgramId, String(row.programId || programIdByAssignment.get(String(row.assignedInterventionId || '')) || ''))) return []
        if (smes.length && !smes.includes(String(row.participantName || ''))) return []
        const values = Object.values((row.attendance as Record<string, unknown>) || {}).map((value) => String(value).toLowerCase())
        const present = values.includes('present')
        if (!present && !values.includes('absent')) return []
        return [{ key: String(row.id || date.getTime()), date, participant: String(row.participantName || '-'), intervention: String(row.interventionTitle || '-'), present }]
    }).sort((left, right) => right.date.getTime() - left.date.getTime())
    const attendanceOf = (rows: HeldAppointment[]) => {
        const present = rows.filter((row) => row.present).length
        const held = rows.length
        return { present, absent: held - present, held, rate: held ? Math.round((present / held) * 100) : 0 }
    }
    const heldAppointments = heldIn(start, end)
    const attendance = attendanceOf(heldAppointments)

    // Overdue is a state of right now, so it ignores the period: anything open and past due counts.
    const today = dayjs().startOf('day')
    const overdueItems: OverdueItem[] = filteredRows
        .filter((row) => statusKeyOf(row) === 'overdue')
        .map((row) => ({ row, daysLate: row.dueDate ? Math.max(1, today.diff(dayjs(row.dueDate).startOf('day'), 'day')) : 0 }))
        .sort((left, right) => right.daysLate - left.daysLate)

    const rateColor = (value: number, good: number, watch: number) => (value >= good ? colors.completed : value >= watch ? colors.pending : colors.overdue)
    const valueLabels = { enabled: true, color: labelColor, style: { textOutline: 'none', fontWeight: '600', color: labelColor } }
    const bandCategories = DAY_BANDS.map((band) => t(band.label))

    // A horizontal bar per band or bucket, one colour per bar.
    const barChart = (categories: string[], data: Array<{ y: number; color: string }>, unit: string): Highcharts.Options => ({
        chart: { type: 'bar', height: 260, backgroundColor: 'transparent' },
        title: { text: undefined },
        legend: { enabled: false },
        xAxis: { categories, lineWidth: 0, tickLength: 0, labels: { style: { color: labelColor, fontSize: '13px' } } },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, labels: { enabled: false }, gridLineWidth: 0 },
        tooltip: { headerFormat: '{point.key}<br/>', pointFormat: `<b>{point.y}</b> ${unit}` },
        // No grow-in: these redraw on every tab switch, which happens far too often to animate.
        plotOptions: { series: { animation: false }, bar: { borderRadius: 4, borderWidth: 0, pointPadding: 0.12, groupPadding: 0.04, dataLabels: valueLabels } },
        series: [{ type: 'bar', name: unit, data }],
    })

    // Fixed order and every bucket shown, so a bar keeps its place and colour when the filters change.
    const statusChart = barChart(
        STATUS_ORDER.map((key) => statusLabels[key]),
        STATUS_ORDER.map((key) => ({ y: byStatus(key).length, color: colors[key] })),
        t('consultant.common.assignments'),
    )
    const overdueChart = barChart(bandCategories, bandCounts(overdueItems.map((item) => item.daysLate)).map((y) => ({ y, color: colors.overdue })), t('consultant.common.assignments'))
    const turnaroundChart = barChart(bandCategories, bandCounts(finished.map((item) => item.days)).map((y) => ({ y, color: colors.inProgress })), t('consultant.common.assignments'))
    const ratingsChart = barChart(
        [5, 4, 3, 2, 1].map((stars) => `${stars} / 5`),
        [5, 4, 3, 2, 1].map((stars) => ({ y: rated.filter((row) => Math.round(row.rating || 0) === stars).length, color: colors.inProgress })),
        t('consultant.common.assignments'),
    )

    // Assigned and completed as running totals from the start of the period, by week for short ranges and by month otherwise.
    const trendBuckets: TrendBucket[] = (() => {
        const chartEnd = end.isAfter(dayjs()) ? dayjs() : end
        const unit = chartEnd.diff(start, 'day') > 60 ? 'month' : 'week'
        const inBucket = (date: Date | null, from: Dayjs, to: Dayjs) => !!date && !dayjs(date).isBefore(from) && !dayjs(date).isAfter(to)
        const buckets: TrendBucket[] = []
        let assignedTotal = 0
        let completedTotal = 0
        let cursor = start.startOf(unit)
        while (!cursor.isAfter(chartEnd, 'day')) {
            const from = cursor.isBefore(start) ? start : cursor
            const to = cursor.endOf(unit)
            const assigned = filteredRows.filter((row) => inBucket(toDate(row.raw.createdAt) || toDate(row.raw.implementationDate), from, to)).length
            const completed = filteredRows.filter((row) => row.status === 'Completed' && inBucket(row.completedAt, from, to)).length
            assignedTotal += assigned
            completedTotal += completed
            buckets.push({ label: unit === 'month' ? cursor.format('MMM YY') : cursor.format('DD MMM'), from, to, assigned, completed, assignedTotal, completedTotal })
            cursor = cursor.add(1, unit)
        }
        return buckets
    })()

    // Burn-up: the shaded band between the two lines is the work still open.
    const endLabel = (text: string, color: string) => ({ enabled: true, align: 'left' as const, x: 6, verticalAlign: 'middle' as const, crop: false, overflow: 'allow' as const, format: text, style: { textOutline: 'none', fontWeight: '600', color } })
    const lastIndex = trendBuckets.length - 1
    const assignedLabel = t('consultant.metrics.assigned', 'Assigned')
    const trendChart: Highcharts.Options = {
        chart: { height: 300, backgroundColor: 'transparent', marginRight: 96 },
        title: { text: undefined },
        xAxis: { categories: trendBuckets.map((bucket) => bucket.label), tickLength: 0 },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
        tooltip: { shared: true },
        legend: { itemStyle: { color: labelColor } },
        plotOptions: { series: { animation: false, marker: { enabled: false, states: { hover: { enabled: true, radius: 4 } } } } },
        series: [
            {
                type: 'arearange',
                name: t('Open work'),
                color: colors.assigned,
                fillOpacity: 0.12,
                lineWidth: 0,
                enableMouseTracking: false,
                showInLegend: false,
                data: trendBuckets.map((bucket) => [bucket.completedTotal, bucket.assignedTotal]),
            },
            {
                type: 'line',
                name: assignedLabel,
                color: colors.assigned,
                lineWidth: 2,
                data: trendBuckets.map((bucket, index) => (index === lastIndex ? { y: bucket.assignedTotal, dataLabels: endLabel(`${bucket.assignedTotal} ${assignedLabel.toLowerCase()}`, labelColor) } : bucket.assignedTotal)),
            },
            {
                type: 'line',
                name: statusLabels.completed,
                color: colors.completed,
                lineWidth: 2,
                data: trendBuckets.map((bucket, index) => (index === lastIndex ? { y: bucket.completedTotal, dataLabels: endLabel(`${bucket.completedTotal} ${statusLabels.completed.toLowerCase()}`, labelColor) } : bucket.completedTotal)),
            },
        ],
    }

    // Headline figures for this period and the one before it. Turnaround is the median: a few slow cases skew an average.
    const turnaroundOf = (row: ReportRow) => {
        const finishedAt = toDate(row.raw.completedAt)
        const createdAt = toDate(row.raw.createdAt) || toDate(row.raw.implementationDate)
        return finishedAt && createdAt ? Math.max(0, dayjs(finishedAt).diff(dayjs(createdAt), 'day')) : null
    }
    const median = (values: number[]) => {
        if (!values.length) return null
        const sorted = [...values].sort((left, right) => left - right)
        const middle = Math.floor(sorted.length / 2)
        return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    }
    const summarise = (rows: ReportRow[]) => {
        const done = rows.filter((row) => statusKeyOf(row) === 'completed')
        const ratings = rows.map((row) => row.rating).filter((value): value is number => value != null)
        const timed = done.filter((row) => toDate(row.raw.completedAt))
        const onTimeCount = timed.filter((row) => !row.dueDate || !dayjs(toDate(row.raw.completedAt)).isAfter(row.dueDate, 'day')).length
        return {
            total: rows.length,
            doneCount: timed.length,
            rate: rows.length ? Math.round((done.length / rows.length) * 100) : null,
            medianDays: median(done.map(turnaroundOf).filter((value): value is number => value !== null)),
            onTimeRate: timed.length ? Math.round((onTimeCount / timed.length) * 100) : null,
            rating: ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null,
        }
    }
    const previousRange: [Dayjs, Dayjs] | null = (() => {
        if (period === 'all') return null
        if (period === 'custom') {
            const days = end.diff(start, 'day') + 1
            return [start.subtract(days, 'day'), start.subtract(1, 'day')]
        }
        const [amount, unit] = period === 'year' ? [1, 'year' as const] : [period === 'quarter' ? 3 : 1, 'month' as const]
        return [start.subtract(amount, unit), end.subtract(amount, unit)]
    })()
    const current = summarise(scopedRows)
    const previous = previousRange ? summarise(filteredRows.filter((row) => dateInRange(row.completedAt || row.dueDate || toDate(row.raw.createdAt), previousRange[0], previousRange[1]))) : null
    const previousAttendance = previousRange ? attendanceOf(heldIn(previousRange[0], previousRange[1])) : null
    const comparisonLabel = { month: t('vs last month'), quarter: t('vs last quarter'), year: t('vs this time last year'), custom: t('vs the previous period'), all: '' }[period]
    const daysLabel = (count: number) => (count === 1 ? t('1 day') : t('{count} days', undefined, { count }))

    const delta = (now: number | null, before: number | null | undefined, format: (value: number) => string, higherIsBetter: boolean, digits = 0) => {
        if (now === null || before == null) return null
        const change = Number((now - before).toFixed(digits))
        if (!change) return <Text type="secondary">{t('no change')} {comparisonLabel}</Text>
        const better = higherIsBetter ? change > 0 : change < 0
        return (
            <span>
                <Text type={better ? 'success' : 'danger'}>{`${change > 0 ? '+' : '−'}${format(Math.abs(change))}`}</Text>{' '}
                <Text type="secondary">{comparisonLabel}</Text>
            </span>
        )
    }

    // What needs the consultant now, whatever the period: open work that is late or due within a week.
    const lateNow = overdueItems
    const dueSoon = filteredRows
        .filter((row) => ['pending', 'inProgress'].includes(statusKeyOf(row)) && row.dueDate && dayjs(row.dueDate).diff(today, 'day') >= 0 && dayjs(row.dueDate).diff(today, 'day') <= 7)
        .sort((left, right) => (left.dueDate?.getTime() || 0) - (right.dueDate?.getTime() || 0))
    const attention = [
        ...lateNow.map((item) => ({ row: item.row, late: true, label: t('{days} late', undefined, { days: daysLabel(item.daysLate) }) })),
        ...dueSoon.map((row) => {
            const days = dayjs(row.dueDate).diff(today, 'day')
            return { row, late: false, label: days === 0 ? t('Due today') : days === 1 ? t('Due tomorrow') : t('Due {day}', undefined, { day: dayjs(row.dueDate).format('ddd D MMM') }) }
        }),
    ]

    // One verdict sentence per tab. The late clause is shared so every tab says the same thing about overdue work.
    const lateClause = (() => {
        const oldest = lateNow[0] ? daysLabel(lateNow[0].daysLate) : ''
        if (lateNow.length === 1) return t('1 is overdue, by {days}.', undefined, { days: oldest })
        if (lateNow.length) return t('{count} are overdue, the oldest by {days}.', undefined, { count: lateNow.length, days: oldest })
        if (dueSoon.length) return t('Nothing is overdue, and {count} due in the next 7 days.', undefined, { count: dueSoon.length })
        return t('Nothing is overdue.')
    })()
    // The period is named above the sentence, so the sentence never says "in this period". Below
    // SMALL_SAMPLE, a percentage overstates what we know ("0%" from one appointment), so it says counts.
    const SMALL_SAMPLE = 5
    // The consultant reads the tabs, so they say "you". Presented to a manager, the same sentences
    // name the consultant instead, so the report reads as being about them, not to them.
    const consultantName = (user?.name || user?.displayName || '').trim().split(/\s+/)[0] || t('The consultant')
    const verdictsFor = (forManager: boolean): Record<Section, string> => {
        const name = consultantName
        const deliverySentence = (() => {
            if (!scopedRows.length) return t('No interventions yet.')
            if (scopedRows.length === 1) {
                if (forManager) return completed.length ? t("{name}'s one intervention is complete.", undefined, { name }) : t("{name}'s one intervention is still open.", undefined, { name })
                return completed.length ? t('Your one intervention is complete.') : t('Your one intervention is still open.')
            }
            return forManager
                ? t('{name} has completed {done} of {total} interventions.', undefined, { name, done: completed.length, total: scopedRows.length })
                : t("You've completed {done} of {total} interventions.", undefined, { done: completed.length, total: scopedRows.length })
        })()
        const timelinessSentence = (() => {
            if (current.medianDays === null) return t('No completed interventions yet.')
            if (finished.length === 1) {
                const days = daysLabel(finished[0].days)
                if (forManager) return finished[0].onTime
                    ? t("{name}'s one completed intervention took {days} and was on time.", undefined, { name, days })
                    : t("{name}'s one completed intervention took {days} and was late.", undefined, { name, days })
                return finished[0].onTime
                    ? t('Your one completed intervention took {days} and was on time.', undefined, { days })
                    : t('Your one completed intervention took {days} and was late.', undefined, { days })
            }
            const days = daysLabel(current.medianDays)
            if (finished.length < SMALL_SAMPLE) return forManager
                ? t("{name}'s median turnaround is {days}, and {onTime} of {count} were on time.", undefined, { name, days, onTime: onTime.length, count: finished.length })
                : t('Your median turnaround is {days}, and {onTime} of {count} were on time.', undefined, { days, onTime: onTime.length, count: finished.length })
            return forManager
                ? t("{name}'s median turnaround is {days}, and {rate}% were delivered on time.", undefined, { name, days, rate: current.onTimeRate ?? 0 })
                : t('Your median turnaround is {days}, and {rate}% were delivered on time.', undefined, { days, rate: current.onTimeRate ?? 0 })
        })()
        const attendanceSentence = (() => {
            if (!attendance.held) return t('No appointments held yet.')
            if (attendance.held === 1) {
                if (forManager) return attendance.present ? t("The SME attended {name}'s one appointment.", undefined, { name }) : t("The SME missed {name}'s one appointment.", undefined, { name })
                return attendance.present ? t('The SME attended your one appointment.') : t('The SME missed your one appointment.')
            }
            if (attendance.held < SMALL_SAMPLE) return t('SMEs attended {present} of {held} appointments.', undefined, { present: attendance.present, held: attendance.held })
            return t('Attendance is {rate}% across {count} appointments.', undefined, { rate: attendance.rate, count: attendance.held })
        })()
        const ratingSentence = (() => {
            if (current.rating === null) return t('No ratings yet.')
            const rating = current.rating.toFixed(1)
            if (rated.length === 1) return forManager
                ? t("One SME rated {name}'s work {rating} out of 5.", undefined, { name, rating })
                : t('One SME rated your work {rating} out of 5.', undefined, { rating })
            return forManager
                ? t("{count} SMEs rate {name}'s work {rating} out of 5 on average.", undefined, { name, count: rated.length, rating })
                : t('{count} SMEs rate your work {rating} out of 5 on average.', undefined, { count: rated.length, rating })
        })()
        return {
            delivery: scopedRows.length ? `${deliverySentence} ${lateClause}` : deliverySentence,
            timeliness: `${timelinessSentence} ${lateClause}`,
            engagement: `${attendanceSentence} ${ratingSentence}`,
        }
    }
    const verdicts = verdictsFor(false)

    // The latest two comments, in the SME's own words.
    const latestComments = scopedRows
        .map((row) => ({ row, ...getFeedback(row.raw) }))
        .filter((item) => item.comments)
        .sort((left, right) => (right.createdAt?.getTime() || 0) - (left.createdAt?.getTime() || 0))
        .slice(0, 2)

    // Present vs absent per month; absent is the neutral gray so it never sits red-on-green.
    const attendanceChart: Highcharts.Options = (() => {
        const months = [...new Set([...heldAppointments].reverse().map((row) => dayjs(row.date).format('MMM YY')))]
        const count = (month: string, present: boolean) => heldAppointments.filter((row) => row.present === present && dayjs(row.date).format('MMM YY') === month).length
        return {
            chart: { type: 'column', height: 300, backgroundColor: 'transparent' },
            title: { text: undefined },
            xAxis: { categories: months },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
            tooltip: { shared: true },
            legend: { itemStyle: { color: labelColor } },
            plotOptions: { series: { animation: false }, column: { stacking: 'normal', borderRadius: 4, borderWidth: 0 } },
            series: [
                { type: 'column', name: t('Absent'), color: colors.declined, data: months.map((month) => count(month, false)) },
                { type: 'column', name: t('Present'), color: colors.completed, data: months.map((month) => count(month, true)) },
            ],
        }
    })()

    const updatePeriod = (value: Period) => {
        setPeriod(value)
        if (value !== 'custom') setRange(rangeFor(value))
    }

    // The period is spelled out on the trigger, so the count only covers the other filters.
    const extraFilterCount = (smes.length ? 1 : 0) + (statuses.length ? 1 : 0)
    const activeFilterCount = (period !== 'year' ? 1 : 0) + extraFilterCount
    const resetFilters = () => {
        updatePeriod('year')
        setSmes([])
        setStatuses([])
    }

    const openInterventions = () => navigate('/consultant/interventions')
    const formatDate = (date: Date | null) => (date ? dayjs(date).format('DD MMM YYYY') : '-')
    const statusTag = (row: ReportRow) => {
        const key = statusKeyOf(row)
        return <Tag bordered={false} style={{ marginInlineEnd: 0 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: colors[key], marginInlineEnd: 6 }} />{statusLabels[key]}</Tag>
    }

    const assignmentColumns: ColumnsType<ReportRow> = [
        { title: t('consultant.common.sme'), dataIndex: 'participant', key: 'sme', sorter: (left, right) => left.participant.localeCompare(right.participant) },
        { title: t('consultant.common.intervention'), dataIndex: 'title', key: 'title' },
        { title: t('consultant.common.program'), key: 'program', render: (_, row) => row.program || '-' },
        { title: t('common.status'), key: 'status', render: (_, row) => statusTag(row), sorter: (left, right) => STATUS_ORDER.indexOf(statusKeyOf(left)) - STATUS_ORDER.indexOf(statusKeyOf(right)) },
        { title: t('consultant.common.progress'), dataIndex: 'progress', key: 'progress', align: 'right', render: (value: number) => `${value}%` },
        { title: t('Due date'), key: 'due', render: (_, row) => formatDate(row.dueDate), sorter: (left, right) => (left.dueDate?.getTime() || 0) - (right.dueDate?.getTime() || 0) },
    ]
    const overdueColumns: ColumnsType<OverdueItem> = [
        { title: t('consultant.common.sme'), key: 'sme', render: (_, item) => item.row.participant },
        { title: t('consultant.common.intervention'), key: 'title', render: (_, item) => item.row.title },
        { title: t('consultant.common.program'), key: 'program', render: (_, item) => item.row.program || '-' },
        { title: t('Due date'), key: 'due', render: (_, item) => formatDate(item.row.dueDate) },
        { title: t('Days late'), key: 'late', align: 'right', render: (_, item) => <Text strong>{item.daysLate}</Text>, sorter: (left, right) => left.daysLate - right.daysLate, defaultSortOrder: 'descend' },
    ]
    const trendColumns: ColumnsType<TrendBucket> = [
        { title: t('Period'), dataIndex: 'label', key: 'label' },
        { title: assignedLabel, dataIndex: 'assigned', key: 'assigned', align: 'right' },
        { title: statusLabels.completed, dataIndex: 'completed', key: 'completed', align: 'right' },
        { title: t('Assigned so far'), dataIndex: 'assignedTotal', key: 'assignedTotal', align: 'right' },
        { title: t('Completed so far'), dataIndex: 'completedTotal', key: 'completedTotal', align: 'right' },
        { title: t('Still open'), key: 'open', align: 'right', render: (_, bucket) => bucket.assignedTotal - bucket.completedTotal },
    ]
    const turnaroundColumns: ColumnsType<FinishedItem> = [
        { title: t('consultant.common.sme'), key: 'sme', render: (_, item) => item.row.participant },
        { title: t('consultant.common.intervention'), key: 'title', render: (_, item) => item.row.title },
        { title: t('Assigned on'), key: 'assigned', render: (_, item) => formatDate(item.createdAt) },
        { title: t('Completed on'), key: 'completed', render: (_, item) => formatDate(item.finishedAt) },
        { title: t('Days'), dataIndex: 'days', key: 'days', align: 'right', sorter: (left, right) => left.days - right.days },
        { title: t('Delivered on time'), key: 'onTime', render: (_, item) => (item.onTime ? t('Yes') : t('No')) },
    ]
    const attendanceColumns: ColumnsType<HeldAppointment> = [
        { title: t('Date'), key: 'date', render: (_, row) => formatDate(row.date) },
        { title: t('consultant.common.sme'), dataIndex: 'participant', key: 'sme' },
        { title: t('consultant.common.intervention'), dataIndex: 'intervention', key: 'intervention' },
        { title: t('Attendance'), key: 'present', render: (_, row) => (row.present ? t('Present') : t('Absent')) },
    ]

    const ratingColumns: ColumnsType<ReportRow> = [
        { title: t('consultant.common.sme'), dataIndex: 'participant', key: 'sme' },
        { title: t('consultant.common.intervention'), dataIndex: 'title', key: 'title' },
        { title: t('consultant.feedback.rating'), key: 'rating', align: 'right', render: (_, row) => `${row.rating} / 5`, sorter: (left, right) => (left.rating || 0) - (right.rating || 0), defaultSortOrder: 'ascend' },
        { title: t('Comments'), key: 'comments', render: (_, row) => getFeedback(row.raw).comments || '-' },
    ]

    const points = (value: number) => t('{count} pts', undefined, { count: value })

    // A figure earns its place under the sentence by adding something: a value the sentence doesn't
    // state, or a change against the last period. One that would only repeat the sentence is dropped.
    const figure = (key: string, value: ReactNode, label: string, change: ReactNode, saidInSentence: boolean) => {
        if (saidInSentence && !change) return null
        return <span key={key}><strong>{value}</strong> {label} {change}</span>
    }
    const enough = (count: number | undefined) => (count ?? 0) >= SMALL_SAMPLE

    // Every tab opens with the same card: the period, one sentence, then the figures behind it.
    const verdictCard = (figures: ReactNode[]) => {
        const shown = figures.filter(Boolean)
        return (
            <Card loading={firstLoad} className="dashboard-section-card report-verdict">
                <Text type="secondary">{periodLabels[period]}</Text>
                <p className="report-verdict-headline">{verdicts[section]}</p>
                {shown.length > 0 && <div className="report-verdict-figures">{shown}</div>}
            </Card>
        )
    }

    const attentionList = (limit: number) => (attention.length ? (
        <div className="report-attention">
            {attention.slice(0, limit).map((item) => (
                <button key={item.row.id} type="button" className="report-attention-row" onClick={openInterventions}>
                    <span className="report-attention-name"><strong>{item.row.participant}</strong> · {item.row.title}</span>
                    <Text type={item.late ? 'danger' : 'secondary'} className="report-attention-when">{item.label}</Text>
                </button>
            ))}
        </div>
    ) : <Text type="secondary">{t('Nothing is late or due this week.')}</Text>)

    // For a manager, overdue work isn't a to-do list but a question: why is it late? Each item's hold-up
    // comes from the same status logic as Interventions Monitoring, so nobody has to type a reason. A reason
    // carried over from the old system (overdueReason) wins when there is one.
    // Past this, an overdue item is more likely a record nobody closed than work still under way.
    const STALE_DAYS = 90
    const risksSlide: PlayerSlide = (() => {
        const waitingOn = lateNow.map((item) => {
            const raw = item.row.raw as AssignedIntervention & { overdueReason?: unknown }
            if (String(raw.overdueReason || '').trim()) return 'Reason given by the consultant'
            return waitingOnFor(raw)
        })
        const counts = [...waitingOn.reduce((map, label) => map.set(label, (map.get(label) || 0) + 1), new Map<string, number>())].sort((left, right) => right[1] - left[1])
        const stale = lateNow.filter((item) => item.daysLate > STALE_DAYS).length
        // The bars carry the counts per hold-up, so the lead names the most common one without its number.
        const lead = lateNow.length
            ? [
                lateClause,
                counts.length > 1 ? t('The most common hold-up: {holdUp}.', undefined, { holdUp: t(counts[0][0]).toLowerCase() }) : t('All of it is waiting on the same thing: {holdUp}.', undefined, { holdUp: t(counts[0][0]).toLowerCase() }),
                stale === 1 ? t('1 has been overdue for more than 90 days and likely needs closing out.') : stale ? t('{count} have been overdue for more than 90 days and likely need closing out.', undefined, { count: stale }) : '',
            ].filter(Boolean).join(' ')
            : t('Nothing is overdue.')
        return {
            kind: 'focus',
            title: t('Risks and hold-ups'),
            lead,
            icon: <WarningOutlined />,
            accent: '#f0808a',
            barsTitle: counts.length > 1 ? t('What overdue work is waiting on') : undefined,
            bars: counts.length > 1 ? counts.map(([label, value]) => ({ label: t(label), value, total: lateNow.length, color: colors.overdue })) : undefined,
        }
    })()

    // The report as a story: the same verdicts as the tabs, one idea per slide, and each number said
    // once per slide. The lead carries the main counts; the visual only adds what the lead doesn't say.
    const playerSlides: PlayerSlide[] = (() => {
        const forManager = audience === 'manager'
        const told = verdictsFor(forManager)
        const total = scopedRows.length
        // The rate's change against the last period, when both periods have enough items to mean something.
        const rateChange = enough(total) && enough(previous?.total) && current.rate !== null && previous?.rate != null && current.rate !== previous.rate
            ? `, ${current.rate > previous.rate ? '+' : '−'}${points(Math.abs(current.rate - previous.rate))} ${comparisonLabel}`
            : ''
        // Counts the delivery sentence already states. Overdue there means "late right now"; the bar
        // counts the period, so it only drops the number when the two agree.
        const statedInDelivery: Partial<Record<StatusKey, boolean>> = {
            completed: total > 1,
            overdue: byStatus('overdue').length === lateNow.length,
        }
        const slides: PlayerSlide[] = [
            {
                kind: 'title',
                eyebrow: t('Consultant report'),
                // For a manager the report is about a person, so their name leads; for the consultant, the period does.
                title: forManager ? (user?.name || user?.displayName || consultantName) : periodLabels[period],
                subtitle: forManager
                    ? `${periodLabels[period]} · ${start.format('DD MMM YYYY')} – ${end.format('DD MMM YYYY')}`
                    : `${user?.name || user?.displayName || ''}${user?.name || user?.displayName ? ' · ' : ''}${start.format('DD MMM YYYY')} – ${end.format('DD MMM YYYY')}`,
                icon: <FundOutlined />,
                accent: '#8b5cf6',
            },
            {
                kind: 'focus',
                title: t('Delivery'),
                lead: told.delivery,
                icon: <RiseOutlined />,
                accent: '#38bdf8',
                // The rate is the one delivery number the sentence doesn't say. Too few items and it overstates, so it's left out.
                figure: enough(total) ? { value: `${current.rate ?? 0}%`, label: `${t('completion')}${rateChange}` } : undefined,
                breakdownTitle: forManager ? t('Where the work stands') : t('Where your work stands'),
                breakdown: STATUS_ORDER.map((key) => ({ label: statusLabels[key], value: byStatus(key).length, total, color: colors[key], note: statedInDelivery[key] ? '' : undefined })),
            },
            forManager ? risksSlide : {
                kind: 'narrative',
                title: t('Needs your attention'),
                lead: lateClause,
                icon: <WarningOutlined />,
                accent: '#f0808a',
                paragraph: attention.length ? undefined : t('Nothing is late or due this week.'),
                // Three at most, so the slide fits a phone; the SME and how late it is go on the second line.
                points: attention.slice(0, 3).map((item) => ({
                    icon: item.late ? <ExclamationCircleOutlined /> : <ClockCircleOutlined />,
                    text: item.row.title,
                    meta: `${item.row.participant} · ${item.label}`,
                    tone: item.late ? 'risk' as const : 'warn' as const,
                })),
                note: attention.length > 3 ? t('{count} more in your interventions list.', undefined, { count: attention.length - 3 }) : undefined,
            },
            {
                // The lead gives the median and on-time share; the visual adds the spread behind the median.
                kind: 'focus',
                title: t('Timeliness'),
                lead: told.timeliness,
                icon: <ClockCircleOutlined />,
                accent: '#22d3ee',
                barsTitle: finished.length > 1 ? t('Days from assignment to completion') : undefined,
                bars: finished.length > 1 ? bandCounts(finished.map((item) => item.days)).map((value, position) => ({ label: t(DAY_BANDS[position].label), value, total: finished.length, color: colors.inProgress })) : undefined,
            },
            {
                // The lead gives attendance and the average rating; the visual adds how the ratings spread.
                kind: 'focus',
                title: t('Engagement'),
                lead: told.engagement,
                icon: <TeamOutlined />,
                accent: '#f59e0b',
                barsTitle: rated.length > 1 ? (forManager ? t('How SMEs rated the work') : t('How SMEs rated your work')) : undefined,
                bars: rated.length > 1 ? [5, 4, 3, 2, 1].map((stars) => ({ label: `${stars} / 5`, value: rated.filter((row) => Math.round(row.rating || 0) === stars).length, total: rated.length, color: colors.pending })) : undefined,
            },
        ]
        if (latestComments.length) {
            slides.push({
                kind: 'narrative',
                title: t('What SMEs said'),
                icon: <MessageOutlined />,
                accent: '#a78bfa',
                points: latestComments.map((item) => ({ icon: <MessageOutlined />, text: `“${item.comments}”`, meta: item.row.participant, tone: 'info' as const })),
            })
        }
        const first = attention[0]
        slides.push(forManager
            ? {
                kind: 'closing',
                title: t('End of report'),
                subtitle: t('The full figures, with a table for each section, are in the exported report.'),
                icon: <FlagOutlined />,
                accent: '#8b5cf6',
            }
            : {
                kind: 'closing',
                title: t("That's your report"),
                // End on the one thing to do next, if there is one.
                subtitle: first
                    ? t('Start with {sme}: {intervention} is {when}.', undefined, { sme: first.row.participant, intervention: first.row.title, when: first.label.charAt(0).toLowerCase() + first.label.slice(1) })
                    : t('Nothing needs you right now.'),
                icon: <FlagOutlined />,
                accent: '#8b5cf6',
            })
        return slides
    })()

    // The ripple grows from whatever was clicked: the Play button, or the menu item that chose the audience.
    const startPlayer = (event: { currentTarget: EventTarget | null }, who: Audience) => {
        const rect = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null
        setPlayerOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
        setAudience(who)
        setPlayerOpen(true)
    }

    const detailsButton = (key: DetailKey, disabled = false) => (
        <Button type="text" size="small" icon={<ExpandAltOutlined />} disabled={disabled} onClick={() => setDetails(key)}>{t('Details')}</Button>
    )

    const exportReport = () => {
        downloadCsv(`consultant-report-${start.format('YYYYMMDD')}-${end.format('YYYYMMDD')}.csv`, scopedRows.map((row) => ({
            [t('consultant.common.sme')]: row.participant,
            [t('consultant.common.program')]: row.program,
            [t('consultant.common.intervention')]: row.title,
            [t('common.status')]: isLate(row) ? 'Overdue' : row.status,
            [t('consultant.common.progress')]: row.progress,
            DueDate: row.dueDate ? dayjs(row.dueDate).format('YYYY-MM-DD') : '',
            CompletedAt: row.completedAt ? dayjs(row.completedAt).format('YYYY-MM-DD') : '',
            [t('consultant.feedback.rating')]: row.rating ?? '',
        })))
    }

    const buildExportData = (): ReportExportData => {
        const rate = (value: number) => `${value}%`
        const byProgramme = new Map<string, { assigned: number, completed: number, overdue: number }>()
        scopedRows.forEach((row) => {
            const name = row.program || 'Unassigned'
            const entry = byProgramme.get(name) || { assigned: 0, completed: 0, overdue: 0 }
            entry.assigned += 1
            if (row.status === 'Completed') entry.completed += 1
            if (isLate(row)) entry.overdue += 1
            byProgramme.set(name, entry)
        })
        return {
            role: user?.role || 'consultant',
            title: 'Consultant Report',
            periodLabel: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}`,
            organisation: user?.companyCode || undefined,
            preparedBy: user?.name || user?.displayName || user?.email || 'Consultant',
            kpis: [
                { label: 'Assignments', value: scopedRows.length },
                { label: 'Completed', value: completed.length, note: `${rate(completionRate)} completion rate`, tone: completionRate >= 70 ? 'good' : completionRate < 40 && scopedRows.length ? 'risk' : 'watch' },
                { label: 'In progress', value: active.length },
                { label: 'Pending', value: pending.length },
                { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'risk' : 'good' },
                { label: 'Declined', value: rejected.length, tone: rejected.length ? 'watch' : 'good' },
                // Median, matching the page: a few slow cases would skew an average.
                { label: 'Median turnaround', value: current.medianDays !== null ? `${current.medianDays} days` : 'No completions yet', note: finished.length ? `${onTimeRate}% delivered on or before the due date` : undefined, tone: current.medianDays !== null ? (current.medianDays <= 14 ? 'good' : current.medianDays > 30 ? 'risk' : 'watch') : undefined },
                { label: 'Appointment attendance', value: attendance.held ? rate(attendance.rate) : 'No appointments held', note: attendance.held ? `${attendance.present} present, ${attendance.absent} absent of ${attendance.held} held` : undefined, tone: attendance.held ? (attendance.rate >= 80 ? 'good' : attendance.rate < 60 ? 'risk' : 'watch') : undefined },
                { label: 'Average client rating', value: rated.length ? `${avgRating.toFixed(1)} / 5` : 'Not rated', note: `${rated.length} rated assignment${rated.length === 1 ? '' : 's'}`, tone: rated.length ? (avgRating >= 4 ? 'good' : avgRating < 3 ? 'risk' : 'watch') : undefined },
            ],
            tables: [
                {
                    key: 'assignments',
                    title: 'Assignment detail',
                    columns: [{ key: 'participant', label: 'SME' }, { key: 'program', label: 'Programme' }, { key: 'title', label: 'Intervention' }, { key: 'status', label: 'Status' }, { key: 'progress', label: 'Progress %' }, { key: 'due', label: 'Due' }, { key: 'rating', label: 'Rating' }],
                    rows: scopedRows.map((row) => ({
                        participant: row.participant,
                        program: row.program || 'Unassigned',
                        title: row.title,
                        status: isLate(row) ? 'Overdue' : row.status,
                        progress: row.progress,
                        due: row.dueDate ? dayjs(row.dueDate).format('DD MMM YYYY') : '-',
                        rating: row.rating ? `${row.rating}/5` : '-',
                    })),
                },
                {
                    key: 'programmes',
                    title: 'Workload by programme',
                    columns: [{ key: 'programme', label: 'Programme' }, { key: 'assigned', label: 'Assigned' }, { key: 'completed', label: 'Completed' }, { key: 'overdue', label: 'Overdue' }],
                    rows: [...byProgramme.entries()].sort((left, right) => right[1].assigned - left[1].assigned).map(([programme, entry]) => ({ programme, ...entry })),
                },
            ],
        }
    }

    const filtersPanel = (
        <div className="consultant-report-filters">
            <label>
                <Text type="secondary">{t('Period')}</Text>
                <Select<Period> value={period} onChange={updatePeriod} options={(Object.keys(periodLabels) as Period[]).map((value) => ({ value, label: periodLabels[value] }))} />
            </label>
            {period === 'custom' && (
                <RangePicker
                    value={[start, end]}
                    allowClear={false}
                    onChange={(value) => {
                        if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
                    }}
                />
            )}
            <label>
                <Text type="secondary">{t('consultant.common.sme')}</Text>
                <Select mode="multiple" allowClear showSearch maxTagCount="responsive" value={smes} onChange={setSmes} placeholder={t('All SMEs')} options={smeOptions.map((value) => ({ value, label: value }))} />
            </label>
            <label>
                <Text type="secondary">{t('common.status')}</Text>
                <Select<StatusKey[]> mode="multiple" allowClear maxTagCount="responsive" value={statuses} onChange={setStatuses} placeholder={t('All statuses')} options={STATUS_ORDER.map((value) => ({ value, label: statusLabels[value] }))} />
            </label>
            <div className="consultant-report-filters-foot">
                <Button type="link" size="small" disabled={!activeFilterCount} onClick={resetFilters}>{t('Reset')}</Button>
                <Button type="primary" size="small" onClick={() => setFiltersOpen(false)}>{t('Done')}</Button>
            </div>
        </div>
    )

    return (
        <DashboardPage className="consultant-page consultant-reports-page">
            <FilterBar
                compact
                primary={
                    <>
                        <Segmented<Section>
                            className="consultant-report-sections"
                            value={section}
                            onChange={setSection}
                            options={[
                                { value: 'delivery', label: t('Delivery'), icon: <CheckCircleOutlined /> },
                                { value: 'timeliness', label: t('Timeliness'), icon: <ClockCircleOutlined /> },
                                { value: 'engagement', label: t('Engagement'), icon: <TeamOutlined /> },
                            ]}
                        />
                        {/* The applied period lives inside its own control, so the row reads as one thing. */}
                        <Popover trigger="click" placement="bottomLeft" open={filtersOpen} onOpenChange={setFiltersOpen} content={filtersPanel} arrow={false}>
                            <Button className="consultant-report-filter-trigger" icon={<FilterOutlined />}>
                                <span>{t('common.filters')}</span>
                                <span className="consultant-report-filter-summary filter-bar-keep">
                                    {periodLabels[period]}
                                    <span className="consultant-report-filter-range filter-bar-detail">{`, ${start.format('DD MMM')} – ${end.format('DD MMM YYYY')}`}</span>
                                </span>
                                {extraFilterCount > 0 && <span className="consultant-report-filter-count filter-bar-keep">{extraFilterCount}</span>}
                            </Button>
                        </Popover>
                    </>
                }
                actions={
                    <>
                        <Space.Compact className="consultant-report-actions-start">
                            <Button icon={<PlayCircleOutlined />} disabled={firstLoad} onClick={(event) => startPlayer(event, 'me')}>
                                {t('Play report')}
                            </Button>
                            <Dropdown
                                disabled={firstLoad}
                                trigger={['click']}
                                placement="bottomRight"
                                menu={{
                                    items: [
                                        { key: 'me', icon: <PlayCircleOutlined />, label: t('Play for me') },
                                        { key: 'manager', icon: <TeamOutlined />, label: t('Present to my manager') },
                                    ],
                                    onClick: ({ key, domEvent }) => startPlayer(domEvent, key as Audience),
                                }}
                            >
                                <Button icon={<DownOutlined />} aria-label={t('Choose who the report is for')} />
                            </Dropdown>
                        </Space.Compact>
                        <Button icon={<DownloadOutlined />} disabled={!scopedRows.length} onClick={exportReport}>
                            {t('consultant.reports.downloadCsv')}
                        </Button>
                        <ReportExportButton buildData={buildExportData} disabled={loading || !scopedRows.length} />
                    </>
                }
            />

            <div style={{ opacity: refreshing ? 0.6 : 1, transition: 'opacity 200ms cubic-bezier(0.23, 1, 0.32, 1)' }}>
                {section === 'delivery' && (
                <div className="consultant-report-section">
                    {verdictCard([
                        enough(current.total) && figure('rate', `${current.rate}%`, t('completion'), enough(previous?.total) && delta(current.rate, previous?.rate, points, true), false),
                        current.medianDays !== null && figure('days', daysLabel(current.medianDays), t('median turnaround'), delta(current.medianDays, previous?.medianDays, daysLabel, false), false),
                        current.rating !== null && figure('rating', `${current.rating.toFixed(1)} / 5`, t('client rating'), delta(current.rating, previous?.rating, (value) => value.toFixed(1), true, 1), false),
                    ])}

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} xl={15}>
                            <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><AreaChartOutlined /> {t('Assigned vs completed, running total')}</Space>} extra={detailsButton('trend', !filteredRows.length)} style={{ height: '100%' }}>
                                {filteredRows.length ? <ThemedHighcharts options={trendChart} /> : <Empty description={t('consultant.reports.empty')} />}
                            </Card>
                        </Col>
                        <Col xs={24} xl={9}>
                            <div className="report-side-stack">
                                <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><BarChartOutlined /> {t('Where your {count} assignments stand', undefined, { count: scopedRows.length })}</Space>} extra={detailsButton('status', !scopedRows.length)}>
                                    {scopedRows.length ? (
                                        <>
                                            <div className="report-status-bar" role="img" aria-label={STATUS_ORDER.map((key) => `${byStatus(key).length} ${statusLabels[key]}`).join(', ')}>
                                                {STATUS_ORDER.filter((key) => byStatus(key).length).map((key) => (
                                                    <span key={key} style={{ flexGrow: byStatus(key).length, background: colors[key] }} title={`${statusLabels[key]}: ${byStatus(key).length}`} />
                                                ))}
                                            </div>
                                            <div className="report-status-legend">
                                                {STATUS_ORDER.map((key) => (
                                                    <span key={key} className={byStatus(key).length ? undefined : 'is-empty'}>
                                                        <i style={{ background: colors[key] }} />
                                                        <strong>{byStatus(key).length}</strong> {statusLabels[key]}
                                                    </span>
                                                ))}
                                            </div>
                                        </>
                                    ) : <Empty description={t('consultant.reports.empty')} />}
                                </Card>

                                <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><WarningOutlined /> {t('Needs your attention')}</Space>} extra={lateNow.length > 0 ? <Button type="text" size="small" onClick={() => setDetails('overdue')}>{t('All overdue')}</Button> : null}>
                                    {attentionList(3)}
                                </Card>
                            </div>
                        </Col>
                    </Row>
                </div>
                )}

                {section === 'timeliness' && (
                <div className="consultant-report-section">
                    {verdictCard([
                        current.medianDays !== null && figure('days', daysLabel(current.medianDays), t('median turnaround'), delta(current.medianDays, previous?.medianDays, daysLabel, false), true),
                        enough(current.doneCount) && figure('ontime', `${current.onTimeRate}%`, t('on time'), enough(previous?.doneCount) && delta(current.onTimeRate, previous?.onTimeRate, points, true), true),
                    ])}

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} xl={15}>
                            <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><WarningOutlined /> {t('Needs your attention')}</Space>} extra={detailsButton('overdue', !overdueItems.length)} style={{ height: '100%' }}>
                                {overdueItems.length > 0 && (
                                    <>
                                        <Text type="secondary">{t('Open work past its due date, by how many days late.')}</Text>
                                        <ThemedHighcharts options={{ ...overdueChart, chart: { ...overdueChart.chart, height: 200 } }} />
                                    </>
                                )}
                                <div className={overdueItems.length ? 'report-attention-after-chart' : undefined}>{attentionList(5)}</div>
                            </Card>
                        </Col>
                        <Col xs={24} xl={9}>
                            <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><ClockCircleOutlined /> {t('Turnaround time')}</Space>} extra={detailsButton('turnaround', !finished.length)} style={{ height: '100%' }}>
                                {current.medianDays !== null ? (
                                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                        <div>
                                            <span className="report-hero-figure">{current.medianDays}</span>
                                            <Text type="secondary" style={{ marginLeft: 8 }}>{t('days, median')}</Text>
                                            <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>{t('From the day an intervention is assigned to the day it is completed.')}</Text>
                                        </div>
                                        <div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                                <Text>{t('Delivered on time')}</Text>
                                                <Text type="secondary" style={{ fontSize: 12 }}>{onTime.length}/{finished.length}</Text>
                                            </div>
                                            <Progress percent={onTimeRate} showInfo={false} strokeColor={rateColor(onTimeRate, 75, 50)} />
                                        </div>
                                        <ThemedHighcharts options={{ ...turnaroundChart, chart: { ...turnaroundChart.chart, height: 180 } }} />
                                    </Space>
                                ) : <Text type="secondary">{t('Turnaround shows after your first completed intervention in this period.')}</Text>}
                            </Card>
                        </Col>
                    </Row>
                </div>
                )}

                {section === 'engagement' && (
                <div className="consultant-report-section">
                    {verdictCard([
                        enough(attendance.held) && figure('attendance', `${attendance.rate}%`, t('attendance'), enough(previousAttendance?.held) && delta(attendance.rate, previousAttendance?.rate, points, true), true),
                        attendance.held > 0 && figure('held', attendance.held, attendance.held === 1 ? t('appointment held') : t('appointments held'), delta(attendance.held, previousAttendance?.held, String, true), true),
                        current.rating !== null && figure('rating', `${current.rating.toFixed(1)} / 5`, t('client rating'), delta(current.rating, previous?.rating, (value) => value.toFixed(1), true, 1), true),
                    ])}

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} xl={15}>
                            <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><CalendarOutlined /> {t('Appointment attendance by month')}</Space>} extra={detailsButton('attendance', !attendance.held)} style={{ height: '100%' }}>
                                {attendance.held ? (
                                    <>
                                        <Text type="secondary">{t('{present} present, {absent} absent.', undefined, { present: attendance.present, absent: attendance.absent })}</Text>
                                        <ThemedHighcharts options={attendanceChart} />
                                    </>
                                ) : <Text type="secondary">{t('Attendance shows once you have held an appointment in this period.')}</Text>}
                            </Card>
                        </Col>
                        <Col xs={24} xl={9}>
                            <div className="report-side-stack">
                                <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><StarOutlined /> {t('Client ratings')}</Space>} extra={detailsButton('ratings', !rated.length)}>
                                    {rated.length ? (
                                        <>
                                            <div>
                                                <span className="report-hero-figure">{avgRating.toFixed(1)}</span>
                                                <Text type="secondary" style={{ marginLeft: 8 }}>{t('out of 5 on average')}</Text>
                                                <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>{rated.length === 1 ? t('From one rated assignment.') : t('From {count} rated assignments.', undefined, { count: rated.length })}</Text>
                                            </div>
                                            <ThemedHighcharts options={{ ...ratingsChart, chart: { ...ratingsChart.chart, height: 180 } }} />
                                        </>
                                    ) : <Text type="secondary">{t('Ratings show once SMEs rate your completed work.')}</Text>}
                                </Card>

                                <Card loading={firstLoad} className="dashboard-section-card motion-card" title={<Space><MessageOutlined /> {t('What SMEs said')}</Space>}>
                                    {latestComments.length ? (
                                        <div className="report-quotes">
                                            {latestComments.map((item) => (
                                                <figure key={item.row.id} className="report-quote">
                                                    <blockquote>{item.comments}</blockquote>
                                                    <figcaption>
                                                        {item.row.participant} · {item.row.title}
                                                        {item.rating != null && <span> · {item.rating} / 5</span>}
                                                    </figcaption>
                                                </figure>
                                            ))}
                                        </div>
                                    ) : <Text type="secondary">{t('Comments show here when SMEs leave feedback on your work.')}</Text>}
                                </Card>
                            </div>
                        </Col>
                    </Row>
                </div>
                )}
            </div>

            <ChartDetailsModal<ReportRow>
                open={details === 'status'}
                onClose={() => setDetails(null)}
                title={t('consultant.reports.statusMix')}
                description={t('Every assignment in the period counted once, by where it stands today.')}
                chart={statusChart}
                columns={assignmentColumns}
                rows={scopedRows}
                rowKey="id"
                emptyText={t('consultant.reports.empty')}
                onRowClick={openInterventions}
            />
            <ChartDetailsModal<TrendBucket>
                open={details === 'trend'}
                onClose={() => setDetails(null)}
                title={t('Assigned vs completed, running total')}
                description={t('Totals since the start of the period. The shaded gap is work still open.')}
                chart={trendChart}
                columns={trendColumns}
                rows={trendBuckets}
                rowKey="label"
                emptyText={t('consultant.reports.empty')}
            />
            <ChartDetailsModal<OverdueItem>
                open={details === 'overdue'}
                onClose={() => setDetails(null)}
                title={t('Overdue items')}
                description={t('Open work past its due date, by how many days late.')}
                chart={overdueChart}
                columns={overdueColumns}
                rows={overdueItems}
                rowKey={(item) => item.row.id}
                emptyText={t('Nothing is overdue.')}
                onRowClick={openInterventions}
            />
            <ChartDetailsModal<FinishedItem>
                open={details === 'turnaround'}
                onClose={() => setDetails(null)}
                title={t('Turnaround time')}
                description={t('Completed interventions, by days from assignment to completion.')}
                chart={turnaroundChart}
                columns={turnaroundColumns}
                rows={finished}
                rowKey={(item) => item.row.id}
                emptyText={t('No completed interventions in this period.')}
                onRowClick={openInterventions}
            />
            <ChartDetailsModal<HeldAppointment>
                open={details === 'attendance'}
                onClose={() => setDetails(null)}
                title={t('Appointment attendance')}
                description={t('Appointments held each month, present and absent.')}
                chart={attendanceChart}
                columns={attendanceColumns}
                rows={heldAppointments}
                rowKey="key"
                emptyText={t('No appointments have been held in this period.')}
            />
            <ChartDetailsModal<ReportRow>
                open={details === 'ratings'}
                onClose={() => setDetails(null)}
                title={t('Client ratings')}
                description={t('Ratings SMEs gave your completed work, lowest first in the table.')}
                chart={ratingsChart}
                columns={ratingColumns}
                rows={rated}
                rowKey="id"
                emptyText={t('No ratings in this period.')}
                onRowClick={openInterventions}
            />
            <ReportPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} slides={playerSlides} origin={playerOrigin} />
        </DashboardPage>
    )
}

export default ConsultantReportsPage
