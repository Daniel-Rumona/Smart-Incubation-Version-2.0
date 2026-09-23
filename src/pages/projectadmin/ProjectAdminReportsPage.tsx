import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { App, Button, Card, Col, DatePicker, Empty, Modal, Progress, Row, Segmented, Space, Table, Tag, theme, Typography } from 'antd'
import {
    AppstoreOutlined,
    AuditOutlined,
    CheckCircleOutlined,
    DashboardOutlined,
    DollarCircleOutlined,
    ExclamationCircleOutlined,
    FallOutlined,
    FileProtectOutlined,
    FundOutlined,
    MinusOutlined,
    RiseOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS, CHART_PALETTE } from '@/config/chartPalette'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    filterProjectAdminDataByRange,
    isComplianceAttentionStatus,
    isCompletedInterventionStatus,
    isOpenApplicationStatus,
    isOverdueIntervention,
    loadProjectAdminWorkspace,
    type ProjectAdminApplication,
    type ProjectAdminComplianceDocument,
    type ProjectAdminIntervention,
    type ProjectAdminWorkspaceData,
} from '@/services/projectAdminWorkspaceService'
import {
    bucketRange as performanceBucketRange,
    computeMetricPerformance,
    employeesInRange,
    formatCurrencyZAR,
    formatMetricNumber,
    revenueInRange,
} from '@/services/smePerformanceMetrics'
import '@/styles/dashboard.css'
import '@/styles/operations-reports.css'

dayjs.extend(quarterOfYear)

const { RangePicker } = DatePicker

type ReportView = 'overview' | 'applications' | 'interventions' | 'compliance' | 'performance'
type TimeBucket = { key: string, label: string }

type DrilldownState =
    | { kind: 'applications', title: string, rows: ProjectAdminApplication[] }
    | { kind: 'interventions', title: string, rows: ProjectAdminIntervention[] }
    | { kind: 'compliance', title: string, rows: ProjectAdminComplianceDocument[] }

type ProgrammeRow = {
    key: string
    programme: string
    applications: number
    participants: number
    interventions: number
    completed: number
    overdue: number
}

const emptyWorkspace: ProjectAdminWorkspaceData = {
    applications: [],
    participants: [],
    interventions: [],
    complianceDocuments: [],
    staff: [],
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const labelize = (value: string) =>
    value
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ') || 'Unspecified'

const statusLabel = (value: string) => {
    const status = normalize(value)
    if (['awaiting_confirmation', 'awaiting confirmation'].includes(status)) return 'Awaiting SME Confirmation'
    if (['awaiting_sme_acceptance', 'awaiting sme acceptance'].includes(status)) return 'Awaiting SME Acceptance'
    if (['awaiting_assignee_acceptance', 'awaiting assignee acceptance'].includes(status)) return 'Awaiting Facilitator Acceptance'
    return labelize(value)
}

const statusColor = (value: string) => {
    const status = normalize(value).replace(/[\s-]+/g, '_')
    if (['accepted', 'approved', 'complete', 'completed', 'confirmed', 'done', 'valid', 'active', 'clear'].includes(status)) {
        return CHART_COLORS.success
    }
    if (['rejected', 'declined', 'failed', 'overdue', 'expired', 'invalid', 'cancelled', 'changes_requested', 'inactive'].includes(status)) {
        return CHART_COLORS.danger
    }
    if (status.includes('pending') || status.includes('awaiting') || ['submitted', 'under_review', 'queried', 'missing'].includes(status)) {
        return CHART_COLORS.amber
    }
    if (['in_progress', 'open', 'assigned'].includes(status)) return CHART_COLORS.primary
    return CHART_COLORS.slate
}

const countBy = <T,>(rows: T[], readKey: (row: T) => string) =>
    rows.reduce<Record<string, number>>((acc, row) => {
        const rawKey = readKey(row).trim()
        const key = rawKey ? labelize(rawKey) : 'Not Recorded'
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})

const toStatusSeries = (counts: Record<string, number>) =>
    Object.entries(counts)
        .sort((left, right) => right[1] - left[1])
        .map(([name, y]) => ({ name: statusLabel(name), y, color: statusColor(name) }))

const categoryColors = [
    CHART_COLORS.violet,
    CHART_COLORS.cyan,
    CHART_COLORS.success,
    CHART_COLORS.amber,
    CHART_COLORS.pink,
    CHART_COLORS.primary,
    CHART_COLORS.teal,
    CHART_COLORS.danger,
]

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.round((numerator / denominator) * 100) : 0)

const computeRates = (scoped: ProjectAdminWorkspaceData) => {
    const acceptedApplications = scoped.applications.filter((application) => ['accepted', 'approved'].includes(normalize(application.status))).length
    const completedInterventions = scoped.interventions.filter((intervention) => isCompletedInterventionStatus(intervention.status)).length
    const complianceAttention = scoped.complianceDocuments.filter((document) => isComplianceAttentionStatus(document.status)).length
    const compliantDocuments = Math.max(0, scoped.complianceDocuments.length - complianceAttention)
    return {
        acceptanceRate: percent(acceptedApplications, scoped.applications.length),
        deliveryRate: percent(completedInterventions, scoped.interventions.length),
        complianceRate: percent(compliantDocuments, scoped.complianceDocuments.length),
    }
}

const programmeAvatarColor = (programme: string) => {
    let hash = 0
    for (let index = 0; index < programme.length; index += 1) hash = (hash * 31 + programme.charCodeAt(index)) >>> 0
    return CHART_PALETTE[hash % CHART_PALETTE.length]
}

const ProgrammeCard = ({ row, onClick }: { row: ProgrammeRow, onClick: () => void }) => {
    const { token } = theme.useToken()
    const completionRate = percent(row.completed, row.interventions)
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '14px 16px',
                borderRadius: 12,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                boxShadow: token.boxShadowTertiary,
                cursor: 'pointer',
            }}
        >
            <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space size={8} align="center">
                    <span style={{ width: 28, height: 28, borderRadius: '50%', background: programmeAvatarColor(row.programme), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
                        {row.programme.charAt(0).toUpperCase()}
                    </span>
                    <Typography.Text strong ellipsis style={{ maxWidth: 170 }}>{row.programme}</Typography.Text>
                </Space>
                <Typography.Text strong style={{ color: completionRate >= 75 ? token.colorSuccess : completionRate >= 40 ? token.colorWarning : token.colorError }}>{completionRate}%</Typography.Text>
            </Space>
            <Progress percent={completionRate} size="small" showInfo={false} />
            <Space size={10} style={{ width: '100%', justifyContent: 'space-between' }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.applications} applications · {row.participants} participants · {row.interventions} interventions</Typography.Text>
                {row.overdue > 0 && <Tag color="orange" style={{ marginInlineEnd: 0 }}>{row.overdue} overdue</Tag>}
            </Space>
        </button>
    )
}

const RateChangeCard = ({ title, icon, value, previousValue, caption, loading }: {
    title: string
    icon: ReactNode
    value: number
    previousValue: number
    caption: string
    loading?: boolean
}) => {
    const { token } = theme.useToken()
    const delta = value - previousValue
    const deltaColor = delta > 0 ? token.colorSuccess : delta < 0 ? token.colorError : token.colorTextSecondary
    const DeltaIcon = delta > 0 ? RiseOutlined : delta < 0 ? FallOutlined : MinusOutlined

    return (
        <Card loading={loading} className="dashboard-section-card motion-card" title={<Space>{icon} {title}</Space>}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <Typography.Text strong style={{ fontSize: 34, lineHeight: 1 }}>{value}%</Typography.Text>
                <Space size={4} style={{ color: deltaColor }}>
                    <DeltaIcon />
                    <Typography.Text strong style={{ color: deltaColor }}>{Math.abs(delta)}pt{Math.abs(delta) === 1 ? '' : 's'}</Typography.Text>
                </Space>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>vs {previousValue}% previous period</Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{caption}</Typography.Text>
        </Card>
    )
}

const PerformanceStatCard = ({ title, icon, formattedValue, deltaLabel, deltaPositive, headline, caption, loading }: {
    title: string
    icon: ReactNode
    formattedValue: string
    deltaLabel: string
    deltaPositive: boolean
    headline: { label: string; value: number; positive: boolean }
    caption: string
    loading?: boolean
}) => {
    const { token } = theme.useToken()
    const deltaColor = deltaPositive ? token.colorSuccess : token.colorError
    const DeltaIcon = deltaPositive ? RiseOutlined : FallOutlined
    const headlineColor = headline.positive ? token.colorSuccess : token.colorError
    return (
        <Card loading={loading} className="dashboard-section-card motion-card" title={<Space>{icon} {title}</Space>}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <Typography.Text strong style={{ fontSize: 28, lineHeight: 1 }}>{formattedValue}</Typography.Text>
                <Space size={4} style={{ color: deltaColor }}>
                    <DeltaIcon />
                    <Typography.Text strong style={{ color: deltaColor }}>{deltaLabel}</Typography.Text>
                </Space>
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>vs previous period · {caption}</Typography.Text>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{headline.label}</Typography.Text>
                <Typography.Text strong style={{ color: headlineColor }}>{headline.value}%</Typography.Text>
            </div>
        </Card>
    )
}

const StatusBreakdownList = ({ counts }: { counts: Record<string, number> }) => {
    const entries = Object.entries(counts).sort((left, right) => right[1] - left[1])
    const total = entries.reduce((sum, [, count]) => sum + count, 0)
    if (!entries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No records" style={{ margin: '20px 0' }} />
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {entries.map(([name, count]) => (
                <div key={name}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <Typography.Text>{statusLabel(name)}</Typography.Text>
                        <Typography.Text strong>{count}</Typography.Text>
                    </div>
                    <Progress percent={percent(count, total)} showInfo={false} size="small" strokeColor={statusColor(name)} />
                </div>
            ))}
        </div>
    )
}

const distributionChart = (
    counts: Record<string, number>,
    type: 'bar' | 'column' | 'pie' = 'column',
): Highcharts.Options => {
    const data = Object.entries(counts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 12)
        .map(([name, y], index) => ({ name, y, color: categoryColors[index % categoryColors.length] }))
    const isPie = type === 'pie'
    return {
        chart: { type, height: type === 'bar' ? Math.max(320, data.length * 38) : 320 },
        title: { text: undefined },
        xAxis: isPie ? undefined : { type: 'category' },
        yAxis: isPie ? undefined : { title: { text: 'Applicants' }, allowDecimals: false },
        legend: { enabled: isPie },
        plotOptions: isPie
            ? { pie: { innerSize: '52%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' } } }
            : { series: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{ type, name: 'Applicants', data } as Highcharts.SeriesOptionsType],
    }
}

const buildTimeBuckets = (dates: Array<Date | null>, range: [Dayjs, Dayjs] | null): {
    buckets: TimeBucket[]
    unit: 'day' | 'month'
    keyFor: (date: Date) => string
} => {
    const validDates = dates.filter((date): date is Date => Boolean(date)).map(dayjs).sort((left, right) => left.valueOf() - right.valueOf())
    const start = (range?.[0] || validDates[0] || dayjs()).startOf('day')
    const end = (range?.[1] || validDates[validDates.length - 1] || start).endOf('day')
    const unit = end.diff(start, 'day') > 62 ? 'month' as const : 'day' as const
    const cursorStart = start.startOf(unit)
    const cursorEnd = end.startOf(unit)
    const buckets: TimeBucket[] = []
    let cursor = cursorStart
    while (cursor.isBefore(cursorEnd) || cursor.isSame(cursorEnd, unit)) {
        buckets.push({
            key: cursor.format(unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'),
            label: cursor.format(unit === 'day' ? 'DD MMM' : 'MMM YYYY'),
        })
        cursor = cursor.add(1, unit)
    }
    return {
        buckets,
        unit,
        keyFor: (date: Date) => dayjs(date).format(unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM'),
    }
}

export default function ProjectAdminReportsPage() {
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const [loading, setLoading] = useState(true)
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')])
    const [view, setView] = useState<ReportView>('overview')
    const [data, setData] = useState<ProjectAdminWorkspaceData>(emptyWorkspace)
    const [selectedProgramme, setSelectedProgramme] = useState<string>()
    const [applicantProfileOpen, setApplicantProfileOpen] = useState(false)
    const [drilldown, setDrilldown] = useState<DrilldownState | null>(null)

    const rangePresets = useMemo(() => {
        const now = dayjs()
        return [
            { label: 'This month', value: [now.startOf('month'), now.endOf('month')] as [Dayjs, Dayjs] },
            { label: 'This quarter', value: [now.startOf('quarter'), now.endOf('quarter')] as [Dayjs, Dayjs] },
            { label: 'Year to date', value: [now.startOf('year'), now] as [Dayjs, Dayjs] },
        ]
    }, [])

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            if (identityLoading || !user) return

            try {
                setLoading(true)
                const result = await loadProjectAdminWorkspace(user, activeProgramId)
                if (!cancelled) setData(result)
            } catch (error) {
                console.error('[PROJECT ADMIN REPORTS] Failed loading report data:', error)
                if (!cancelled) {
                    setData(emptyWorkspace)
                    message.error('Failed to load project admin reports.')
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [activeProgramId, identityLoading, message, user])

    const periodData = useMemo(() => filterProjectAdminDataByRange(data, dateRange), [data, dateRange])

    const previousRange = useMemo<[Dayjs, Dayjs]>(() => {
        const [start, end] = dateRange
        const durationDays = end.diff(start, 'day') + 1
        const previousEnd = start.subtract(1, 'day').endOf('day')
        const previousStart = previousEnd.subtract(durationDays - 1, 'day').startOf('day')
        return [previousStart, previousEnd]
    }, [dateRange])

    const previousPeriodData = useMemo(() => filterProjectAdminDataByRange(data, previousRange), [data, previousRange])
    const previousRates = useMemo(() => computeRates(previousPeriodData), [previousPeriodData])

    const performanceData = useMemo(() => {
        const rows = data.participants
        const revenue = computeMetricPerformance(rows, revenueInRange, dateRange, previousRange)
        const employees = computeMetricPerformance(rows, employeesInRange, dateRange, previousRange)
        const trend = performanceBucketRange(dateRange).map((bucket) => ({
            label: bucket.label,
            revenue: rows.reduce((sum, row) => sum + revenueInRange(row, bucket.range), 0),
            employees: rows.reduce((sum, row) => sum + employeesInRange(row, bucket.range), 0),
        }))
        return { revenue, employees, trend, smeCount: rows.length }
    }, [data.participants, dateRange, previousRange])

    const performanceTrendOptions = useMemo<Highcharts.Options>(() => {
        const categories = performanceData.trend.map((bucket) => bucket.label)
        return {
            colors: [CHART_COLORS.success, CHART_COLORS.primary],
            chart: { height: 300 },
            title: { text: undefined },
            subtitle: { text: `${dateRange[0].format('DD MMM YYYY')} to ${dateRange[1].format('DD MMM YYYY')}` },
            xAxis: { categories },
            yAxis: [
                { min: 0, title: { text: 'Revenue' }, labels: { formatter() { return formatCurrencyZAR(Number(this.value)) } } },
                { min: 0, allowDecimals: false, title: { text: 'Employees' }, opposite: true },
            ],
            tooltip: { shared: true },
            plotOptions: { column: { borderRadius: 4 }, spline: { marker: { enabled: true } } },
            series: [
                { name: 'Revenue', type: 'column', yAxis: 0, data: performanceData.trend.map((bucket) => bucket.revenue), tooltip: { valuePrefix: 'R ' } },
                { name: 'Employees', type: 'spline', yAxis: 1, data: performanceData.trend.map((bucket) => bucket.employees) },
            ],
        }
    }, [dateRange, performanceData.trend])

    const metrics = useMemo(() => {
        const openApplications = periodData.applications.filter((application) => isOpenApplicationStatus(application.status)).length
        const acceptedApplications = periodData.applications.filter((application) =>
            ['accepted', 'approved'].includes(normalize(application.status)),
        ).length
        const completedInterventions = periodData.interventions.filter((intervention) =>
            isCompletedInterventionStatus(intervention.status),
        ).length
        const overdueInterventions = periodData.interventions.filter((intervention) => isOverdueIntervention(intervention)).length
        const complianceAttention = periodData.complianceDocuments.filter((document) =>
            isComplianceAttentionStatus(document.status),
        ).length
        const completionRate = periodData.interventions.length
            ? Math.round((completedInterventions / periodData.interventions.length) * 100)
            : 0

        return {
            openApplications,
            acceptedApplications,
            participants: periodData.participants.length,
            completedInterventions,
            overdueInterventions,
            complianceAttention,
            completionRate,
            ...computeRates(periodData),
        }
    }, [periodData])

    const programmeRows = useMemo<ProgrammeRow[]>(() => {
        const byProgramme = new Map<string, ProgrammeRow>()
        const ensure = (programme: string) => {
            const key = programme || 'Unassigned programme'
            if (!byProgramme.has(key)) {
                byProgramme.set(key, {
                    key,
                    programme: key,
                    applications: 0,
                    participants: 0,
                    interventions: 0,
                    completed: 0,
                    overdue: 0,
                })
            }
            return byProgramme.get(key) as ProgrammeRow
        }

        periodData.applications.forEach((application) => {
            ensure(application.programName).applications += 1
        })
        periodData.participants.forEach((participant) => {
            ensure(participant.programName).participants += 1
        })
        periodData.interventions.forEach((intervention) => {
            const row = ensure(intervention.programName)
            row.interventions += 1
            if (isCompletedInterventionStatus(intervention.status)) row.completed += 1
            if (isOverdueIntervention(intervention)) row.overdue += 1
        })

        return [...byProgramme.values()].sort((left, right) => right.participants - left.participants)
    }, [periodData])

    const programNameById = useMemo(() => {
        const map = new Map<string, string>()
        periodData.applications.forEach((application) => { if (application.programId && application.programName) map.set(application.programId, application.programName) })
        periodData.participants.forEach((participant) => { if (participant.programId && participant.programName) map.set(participant.programId, participant.programName) })
        periodData.interventions.forEach((intervention) => { if (intervention.programId && intervention.programName) map.set(intervention.programId, intervention.programName) })
        return map
    }, [periodData])

    const selectedProgrammeDetail = useMemo(() => {
        if (!selectedProgramme) return null
        const row = programmeRows.find((candidate) => candidate.programme === selectedProgramme)
        if (!row) return null

        const applications = periodData.applications.filter((application) => (application.programName || 'Unassigned programme') === selectedProgramme)
        const interventions = periodData.interventions.filter((intervention) => (intervention.programName || 'Unassigned programme') === selectedProgramme)
        const complianceDocuments = periodData.complianceDocuments.filter((document) => (programNameById.get(document.programId) || 'Unassigned programme') === selectedProgramme)

        return {
            row,
            applicationCounts: countBy(applications, (application) => application.status),
            interventionCounts: countBy(interventions, (intervention) => intervention.status),
            complianceCounts: countBy(complianceDocuments, (document) => document.status),
        }
    }, [periodData, programNameById, programmeRows, selectedProgramme])

    const applicationTimelineChart = useMemo<Highcharts.Options>(() => {
        const timeline = buildTimeBuckets(
            periodData.applications.map((application) => application.submittedAt || application.createdAt),
            dateRange,
        )
        const statuses = [...new Set(periodData.applications.map((application) => statusLabel(application.status)))]
        return {
            chart: { type: 'spline', height: 360 },
            title: { text: undefined },
            xAxis: { categories: timeline.buckets.map((bucket) => bucket.label) },
            yAxis: { min: 0, title: { text: 'Applications' }, allowDecimals: false },
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    marker: { enabled: true, radius: 4 },
                    dataLabels: { enabled: true, format: '{point.y}', filter: { property: 'y', operator: '>', value: 0 } },
                },
            },
            series: statuses.map((status) => {
                const counts = new Map<string, number>()
                periodData.applications
                    .filter((application) => statusLabel(application.status) === status)
                    .forEach((application) => {
                        const date = application.submittedAt || application.createdAt
                        if (!date) return
                        const key = timeline.keyFor(date)
                        counts.set(key, (counts.get(key) || 0) + 1)
                    })
                return {
                    type: 'spline' as const,
                    name: status,
                    color: statusColor(status),
                    data: timeline.buckets.map((bucket) => counts.get(bucket.key) || 0),
                }
            }),
        }
    }, [dateRange, periodData.applications])

    const interventionTimelineChart = useMemo<Highcharts.Options>(() => {
        const timeline = buildTimeBuckets(
            periodData.interventions.flatMap((intervention) => [intervention.assignedAt, intervention.completedAt, intervention.dueDate]),
            dateRange,
        )
        const countDates = (readDate: (row: typeof periodData.interventions[number]) => Date | null) => {
            const counts = new Map<string, number>()
            periodData.interventions.forEach((intervention) => {
                const date = readDate(intervention)
                if (!date) return
                const key = timeline.keyFor(date)
                counts.set(key, (counts.get(key) || 0) + 1)
            })
            return timeline.buckets.map((bucket) => counts.get(bucket.key) || 0)
        }
        return {
            chart: { type: 'spline', height: 360 },
            title: { text: undefined },
            xAxis: { categories: timeline.buckets.map((bucket) => bucket.label) },
            yAxis: { min: 0, title: { text: 'Interventions' }, allowDecimals: false },
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    marker: { enabled: true, radius: 4 },
                    dataLabels: { enabled: true, format: '{point.y}', filter: { property: 'y', operator: '>', value: 0 } },
                },
            },
            series: [
                { type: 'spline', name: 'Assigned', color: CHART_COLORS.primary, data: countDates((row) => row.assignedAt) },
                { type: 'spline', name: 'Completed', color: CHART_COLORS.success, data: countDates((row) => row.completedAt) },
                {
                    type: 'spline',
                    name: 'Overdue due dates',
                    color: CHART_COLORS.danger,
                    data: countDates((row) => isOverdueIntervention(row) ? row.dueDate : null),
                },
            ],
        }
    }, [dateRange, periodData.interventions])

    const applicantDemographicCharts = useMemo(() => {
        const applications = periodData.applications
        const definitions = [
            { key: 'gender', title: 'Gender', type: 'pie' as const, read: (row: typeof applications[number]) => row.gender },
            { key: 'age', title: 'Age Group', type: 'column' as const, read: (row: typeof applications[number]) => row.ageGroup },
            { key: 'province', title: 'Province', type: 'bar' as const, read: (row: typeof applications[number]) => row.province },
            { key: 'city', title: 'City', type: 'bar' as const, read: (row: typeof applications[number]) => row.city },
            { key: 'sector', title: 'Business Sector', type: 'bar' as const, read: (row: typeof applications[number]) => row.sector },
            { key: 'stage', title: 'Business Stage', type: 'column' as const, read: (row: typeof applications[number]) => row.stage },
            { key: 'bee', title: 'B-BBEE Level', type: 'column' as const, read: (row: typeof applications[number]) => row.beeLevel },
            { key: 'hub', title: 'Hub', type: 'bar' as const, read: (row: typeof applications[number]) => row.hub },
            { key: 'location', title: 'Location Type', type: 'pie' as const, read: (row: typeof applications[number]) => row.locationType },
            { key: 'disability', title: 'Disability Status', type: 'pie' as const, read: (row: typeof applications[number]) => row.disabilityStatus },
            { key: 'education', title: 'Education Level', type: 'bar' as const, read: (row: typeof applications[number]) => row.educationLevel },
            { key: 'employment', title: 'Employment Status', type: 'column' as const, read: (row: typeof applications[number]) => row.employmentStatus },
            { key: 'marital', title: 'Marital Status', type: 'pie' as const, read: (row: typeof applications[number]) => row.maritalStatus },
        ]
        return definitions
            .filter((definition) => applications.some((application) => Boolean(definition.read(application).trim())))
            .map((definition) => ({
                key: definition.key,
                title: definition.title,
                options: distributionChart(countBy(applications, definition.read), definition.type),
            }))
    }, [periodData.applications])

    const ownershipChart = useMemo<Highcharts.Options | null>(() => {
        const averages = [
            { name: 'Female-owned', values: periodData.applications.map((row) => row.femaleOwnedPercent).filter((value): value is number => value !== null), color: CHART_COLORS.pink },
            { name: 'Youth-owned', values: periodData.applications.map((row) => row.youthOwnedPercent).filter((value): value is number => value !== null), color: CHART_COLORS.amber },
            { name: 'Black-owned', values: periodData.applications.map((row) => row.blackOwnedPercent).filter((value): value is number => value !== null), color: CHART_COLORS.success },
        ].filter((row) => row.values.length)
        if (!averages.length) return null
        return {
            chart: { type: 'bar', height: 320 },
            title: { text: undefined },
            xAxis: { type: 'category' },
            yAxis: { min: 0, max: 100, title: { text: 'Average ownership (%)' } },
            legend: { enabled: false },
            plotOptions: { series: { dataLabels: { enabled: true, format: '{point.y:.0f}%' } } },
            series: [{
                type: 'bar',
                name: 'Average ownership',
                data: averages.map((row) => ({
                    name: row.name,
                    y: row.values.reduce((sum, value) => sum + value, 0) / row.values.length,
                    color: row.color,
                })),
            }],
        }
    }, [periodData.applications])

    const sectorBubbleChart = useMemo<Highcharts.Options | null>(() => {
        const groups = new Map<string, { ages: number[], years: number[], count: number }>()
        periodData.applications.forEach((application) => {
            if (!application.sector || (application.age === null && application.yearsOfTrading === null)) return
            const group = groups.get(application.sector) || { ages: [], years: [], count: 0 }
            if (application.age !== null) group.ages.push(application.age)
            if (application.yearsOfTrading !== null) group.years.push(application.yearsOfTrading)
            group.count += 1
            groups.set(application.sector, group)
        })
        if (!groups.size) return null
        const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
        return {
            chart: { type: 'bubble', height: 380, plotBorderWidth: 1 },
            title: { text: undefined },
            xAxis: { title: { text: 'Average applicant age' } },
            yAxis: { title: { text: 'Average years trading' } },
            legend: { enabled: false },
            tooltip: { pointFormat: '<b>{point.name}</b><br/>Applicants: {point.z}<br/>Average age: {point.x:.1f}<br/>Average years trading: {point.y:.1f}' },
            plotOptions: { bubble: { minSize: 18, maxSize: 70, dataLabels: { enabled: true, format: '{point.name}: {point.z}' } } },
            series: [{
                type: 'bubble',
                name: 'Sectors',
                data: [...groups.entries()].map(([name, group], index) => ({
                    name,
                    x: average(group.ages),
                    y: average(group.years),
                    z: group.count,
                    color: categoryColors[index % categoryColors.length],
                })),
            }],
        }
    }, [periodData.applications])

    const applicationStatusChart = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'column', height: 320 },
        title: { text: undefined },
        xAxis: { type: 'category' },
        yAxis: { title: { text: 'Applications' }, allowDecimals: false },
        legend: { enabled: false },
        plotOptions: {
            series: {
                cursor: 'pointer',
                dataLabels: { enabled: true, format: '{point.y}' },
                point: {
                    events: {
                        click: function (this: Highcharts.Point) {
                            const label = this.name
                            const rows = periodData.applications.filter((application) => statusLabel(application.status) === label)
                            setDrilldown({ kind: 'applications', title: `Applications — ${label}`, rows })
                        },
                    },
                },
            },
        },
        series: [{
            type: 'column',
            name: 'Applications',
            data: toStatusSeries(countBy(periodData.applications, (application) => application.status)),
        }],
    }), [periodData.applications])

    const interventionChart = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'pie', height: 320 },
        title: { text: undefined },
        plotOptions: {
            pie: {
                innerSize: '58%',
                dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
                cursor: 'pointer',
                point: {
                    events: {
                        click: function (this: Highcharts.Point) {
                            const label = this.name
                            const rows = periodData.interventions.filter((intervention) => statusLabel(intervention.status) === label)
                            setDrilldown({ kind: 'interventions', title: `Interventions — ${label}`, rows })
                        },
                    },
                },
            },
        },
        series: [{
            type: 'pie',
            name: 'Interventions',
            data: toStatusSeries(countBy(periodData.interventions, (intervention) => intervention.status)),
        }],
    }), [periodData.interventions])

    /**
     * Bucketed by progress range rather than one bar per intervention, so this stays readable
     * and renders in constant time regardless of how many SMEs/interventions are in scope -
     * a per-row bar chart would become unusable (and slice off most rows) well before 100 SMEs.
     */
    const interventionProgressChart = useMemo<Highcharts.Options>(() => {
        const buckets: { label: string, test: (progress: number) => boolean, color: string }[] = [
            { label: 'Not started (0%)', test: (progress) => progress <= 0, color: CHART_COLORS.slate },
            { label: '1–24%', test: (progress) => progress > 0 && progress < 25, color: CHART_COLORS.danger },
            { label: '25–49%', test: (progress) => progress >= 25 && progress < 50, color: CHART_COLORS.amber },
            { label: '50–74%', test: (progress) => progress >= 50 && progress < 75, color: CHART_COLORS.primary },
            { label: '75–99%', test: (progress) => progress >= 75 && progress < 100, color: CHART_COLORS.cyan },
            { label: 'Completed (100%)', test: (progress) => progress >= 100, color: CHART_COLORS.success },
        ]
        return {
            chart: { type: 'column', height: 340 },
            title: { text: undefined },
            xAxis: { categories: buckets.map((bucket) => bucket.label) },
            yAxis: { min: 0, title: { text: 'Interventions' }, allowDecimals: false },
            legend: { enabled: false },
            tooltip: { pointFormat: '<b>{point.y}</b> interventions' },
            plotOptions: {
                column: {
                    borderRadius: 4,
                    dataLabels: { enabled: true },
                    cursor: 'pointer',
                    point: {
                        events: {
                            click: function (this: Highcharts.Point) {
                                const bucket = buckets[this.index]
                                if (!bucket) return
                                const rows = periodData.interventions.filter((row) => bucket.test(row.progress))
                                setDrilldown({ kind: 'interventions', title: `Interventions — ${bucket.label}`, rows })
                            },
                        },
                    },
                },
            },
            series: [{
                type: 'column',
                name: 'Interventions',
                data: buckets.map((bucket) => ({
                    y: periodData.interventions.filter((row) => bucket.test(row.progress)).length,
                    color: bucket.color,
                })),
            }],
        }
    }, [periodData.interventions])

    const complianceStatusChart = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'pie', height: 340 },
        title: { text: undefined },
        plotOptions: {
            pie: {
                innerSize: '58%',
                dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
                cursor: 'pointer',
                point: {
                    events: {
                        click: function (this: Highcharts.Point) {
                            const label = this.name
                            const rows = periodData.complianceDocuments.filter((document) => statusLabel(document.status) === label)
                            setDrilldown({ kind: 'compliance', title: `Compliance — ${label}`, rows })
                        },
                    },
                },
            },
        },
        series: [{
            type: 'pie',
            name: 'Documents',
            data: toStatusSeries(countBy(periodData.complianceDocuments, (document) => document.status)),
        }],
    }), [periodData.complianceDocuments])

    const complianceHealthChart = useMemo<Highcharts.Options>(() => {
        const attentionRows = periodData.complianceDocuments.filter((document) => isComplianceAttentionStatus(document.status))
        const clearRows = periodData.complianceDocuments.filter((document) => !isComplianceAttentionStatus(document.status))
        return {
            chart: { type: 'column', height: 340 },
            title: { text: undefined },
            xAxis: { type: 'category' },
            yAxis: { title: { text: 'Documents' }, allowDecimals: false },
            legend: { enabled: false },
            plotOptions: {
                series: {
                    cursor: 'pointer',
                    dataLabels: { enabled: true, format: '{point.y}' },
                    point: {
                        events: {
                            click: function (this: Highcharts.Point) {
                                const isAttention = this.name === 'Action required'
                                setDrilldown({ kind: 'compliance', title: `Compliance — ${this.name}`, rows: isAttention ? attentionRows : clearRows })
                            },
                        },
                    },
                },
            },
            series: [{
                type: 'column',
                name: 'Documents',
                data: [
                    { name: 'Clear', y: clearRows.length, color: CHART_COLORS.success },
                    { name: 'Action required', y: attentionRows.length, color: CHART_COLORS.danger },
                ],
            }],
        }
    }, [periodData.complianceDocuments])

    return (
        <DashboardPage className="operations-reports-page project-admin-reports-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row operations-reports-metrics">
                {(identityLoading || loading || metrics.openApplications > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}>
                        <DashboardMetricCard
                            loading={identityLoading || loading}
                            icon={<AuditOutlined />}
                            iconClassName="is-applications"
                            label="Open Applications"
                            value={metrics.openApplications}
                            hint={`${metrics.acceptedApplications} accepted`} />
                    </Col>
                )}
                {(identityLoading || loading || metrics.participants > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={identityLoading || loading} icon={<TeamOutlined />} iconClassName="is-participants" label="Participants" value={metrics.participants} /></Col>
                )}
                {(identityLoading || loading || metrics.completedInterventions > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={identityLoading || loading} icon={<CheckCircleOutlined />} iconClassName="is-delivery" label="Completed interventions" value={metrics.completedInterventions} hint={`${metrics.completionRate}% rate`} /></Col>
                )}
                {(identityLoading || loading || metrics.overdueInterventions > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={identityLoading || loading} icon={<ExclamationCircleOutlined />} iconClassName="is-attention" label="Overdue interventions" value={metrics.overdueInterventions} /></Col>
                )}
                {(identityLoading || loading || metrics.complianceAttention > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={identityLoading || loading} icon={<FileProtectOutlined />} iconClassName="is-attention" label="Compliance alerts" value={metrics.complianceAttention} /></Col>
                )}
                {(identityLoading || loading || programmeRows.length > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={identityLoading || loading} icon={<AppstoreOutlined />} iconClassName="is-users" label="Programmes" value={programmeRows.length} /></Col>
                )}
            </Row>

            <FilterBar
                primary={(
                    <>
                        <Segmented<ReportView>
                            value={view}
                            onChange={setView}
                            options={[
                                { label: 'Overview', value: 'overview', icon: <DashboardOutlined /> },
                                { label: 'Applications', value: 'applications', icon: <AuditOutlined /> },
                                { label: 'Interventions', value: 'interventions', icon: <RiseOutlined /> },
                                { label: 'Compliance', value: 'compliance', icon: <FileProtectOutlined /> },
                                { label: 'Performance', value: 'performance', icon: <FundOutlined /> },
                            ]}
                        />
                        <RangePicker
                            value={dateRange}
                            allowClear={false}
                            presets={rangePresets}
                            onChange={(range) => {
                                if (range?.[0] && range?.[1]) setDateRange([range[0], range[1]])
                            }}
                        />
                    </>
                )}
            />

            {view === 'overview' && (
                <>
                    <Row gutter={[16, 16]} className="project-admin-report-chart-grid">
                        <Col xs={24} lg={8}>
                            <RateChangeCard
                                loading={identityLoading || loading}
                                title="Acceptance Rate"
                                icon={<AuditOutlined />}
                                value={metrics.acceptanceRate}
                                previousValue={previousRates.acceptanceRate}
                                caption={`${metrics.openApplications} of ${periodData.applications.length} still open`}
                            />
                        </Col>
                        <Col xs={24} lg={8}>
                            <RateChangeCard
                                loading={identityLoading || loading}
                                title="Delivery Rate"
                                icon={<CheckCircleOutlined />}
                                value={metrics.deliveryRate}
                                previousValue={previousRates.deliveryRate}
                                caption={`${metrics.completedInterventions} of ${periodData.interventions.length} completed`}
                            />
                        </Col>
                        <Col xs={24} lg={8}>
                            <RateChangeCard
                                loading={identityLoading || loading}
                                title="Compliance Rate"
                                icon={<FileProtectOutlined />}
                                value={metrics.complianceRate}
                                previousValue={previousRates.complianceRate}
                                caption={`${metrics.complianceAttention} of ${periodData.complianceDocuments.length} need attention`}
                            />
                        </Col>
                    </Row>

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col span={24}>
                            <Card loading={identityLoading || loading} className="dashboard-section-card motion-card" title="Programme Health" extra={<Typography.Text type="secondary">Click a programme for its breakdown</Typography.Text>}>
                                {programmeRows.length ? (
                                    <Row gutter={[10, 10]}>
                                        {programmeRows.map((row) => (
                                            <Col xs={24} sm={12} xl={8} key={row.key}>
                                                <ProgrammeCard row={row} onClick={() => setSelectedProgramme(row.programme)} />
                                            </Col>
                                        ))}
                                    </Row>
                                ) : <Empty description="No programme report data for this period." />}
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            <Modal
                open={!!selectedProgrammeDetail}
                onCancel={() => setSelectedProgramme(undefined)}
                footer={<Button onClick={() => setSelectedProgramme(undefined)}>Close</Button>}
                title={selectedProgrammeDetail ? `${selectedProgrammeDetail.row.programme} — Programme Breakdown` : ''}
                width={760}
                destroyOnClose
            >
                {selectedProgrammeDetail && (
                    <>
                        <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
                            <Col xs={12} md={6}><Typography.Text type="secondary">Applications</Typography.Text><div style={{ fontSize: 22, fontWeight: 700 }}>{selectedProgrammeDetail.row.applications}</div></Col>
                            <Col xs={12} md={6}><Typography.Text type="secondary">Participants</Typography.Text><div style={{ fontSize: 22, fontWeight: 700 }}>{selectedProgrammeDetail.row.participants}</div></Col>
                            <Col xs={12} md={6}><Typography.Text type="secondary">Interventions</Typography.Text><div style={{ fontSize: 22, fontWeight: 700 }}>{selectedProgrammeDetail.row.interventions}</div></Col>
                            <Col xs={12} md={6}><Typography.Text type="secondary">Overdue</Typography.Text><div style={{ fontSize: 22, fontWeight: 700, color: selectedProgrammeDetail.row.overdue > 0 ? '#EF4444' : undefined }}>{selectedProgrammeDetail.row.overdue}</div></Col>
                        </Row>
                        <Row gutter={[24, 24]}>
                            <Col xs={24} md={8}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>Applications</Typography.Text>
                                <StatusBreakdownList counts={selectedProgrammeDetail.applicationCounts} />
                            </Col>
                            <Col xs={24} md={8}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>Interventions</Typography.Text>
                                <StatusBreakdownList counts={selectedProgrammeDetail.interventionCounts} />
                            </Col>
                            <Col xs={24} md={8}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>Compliance</Typography.Text>
                                <StatusBreakdownList counts={selectedProgrammeDetail.complianceCounts} />
                            </Col>
                        </Row>
                    </>
                )}
            </Modal>

            {view === 'applications' && (
                <Row gutter={[20, 20]} className="project-admin-report-chart-grid">
                    <Col xs={24}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title="Applications And Statuses Over Time"
                            extra={<Button onClick={() => setApplicantProfileOpen(true)}>View applicant profile</Button>}
                        >
                            {periodData.applications.length ? <ThemedHighcharts options={applicationTimelineChart} /> : <Empty description="No applications found for this period." />}
                        </Card>
                    </Col>
                    <Col xs={24}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title="Application Status Mix"
                            extra={<Typography.Text type="secondary">Click a bar for details</Typography.Text>}
                        >
                            {periodData.applications.length ? <ThemedHighcharts options={applicationStatusChart} /> : <Empty description="No application statuses found." />}
                        </Card>
                    </Col>
                </Row>
            )}

            <Modal
                open={applicantProfileOpen}
                onCancel={() => setApplicantProfileOpen(false)}
                footer={<Button onClick={() => setApplicantProfileOpen(false)}>Close</Button>}
                title="Applicant Profile"
                width={960}
                destroyOnClose
            >
                <Row gutter={[16, 16]}>
                    {ownershipChart && (
                        <Col xs={24} xl={12}>
                            <Typography.Text strong>Ownership Profile</Typography.Text>
                            <ThemedHighcharts options={ownershipChart} />
                        </Col>
                    )}
                    {sectorBubbleChart && (
                        <Col xs={24}>
                            <Typography.Text strong>Sector Profile: Applicant Age, Trading Experience And Volume</Typography.Text>
                            <ThemedHighcharts options={sectorBubbleChart} />
                        </Col>
                    )}
                    {applicantDemographicCharts.map((chart) => (
                        <Col xs={24} xl={12} key={chart.key}>
                            <Typography.Text strong>{chart.title}</Typography.Text>
                            <ThemedHighcharts options={chart.options} />
                        </Col>
                    ))}
                    {!applicantDemographicCharts.length && !ownershipChart && !sectorBubbleChart && (
                        <Col xs={24}>
                            <Empty description="Applicant demographic fields have not been captured for this period." />
                        </Col>
                    )}
                </Row>
            </Modal>

            {view === 'interventions' && (
                <Row gutter={[20, 20]} className="project-admin-report-chart-grid">
                    <Col xs={24}>
                        <Card loading={identityLoading || loading} className="dashboard-section-card motion-card" title="Intervention Activity Over Time">
                            {periodData.interventions.length ? <ThemedHighcharts options={interventionTimelineChart} /> : <Empty description="No intervention activity found." />}
                        </Card>
                    </Col>
                    <Col xs={24} xl={9}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title="Intervention Status Mix"
                            extra={<Typography.Text type="secondary">Click a segment for details</Typography.Text>}
                        >
                            {periodData.interventions.length ? <ThemedHighcharts options={interventionChart} /> : <Empty description="No interventions found." />}
                        </Card>
                    </Col>
                    <Col xs={24} xl={15}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title="Intervention Progress Distribution"
                            extra={<Typography.Text type="secondary">Click a bar for details</Typography.Text>}
                        >
                            {periodData.interventions.length ? <ThemedHighcharts options={interventionProgressChart} /> : <Empty description="No intervention progress found." />}
                        </Card>
                    </Col>
                </Row>
            )}

            {view === 'compliance' && (
                <Row gutter={[20, 20]} className="project-admin-report-chart-grid">
                    <Col xs={24} xl={12}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title="Compliance Status Mix"
                            extra={<Typography.Text type="secondary">Click a segment for details</Typography.Text>}
                        >
                            {periodData.complianceDocuments.length ? <ThemedHighcharts options={complianceStatusChart} /> : <Empty description="No compliance records found." />}
                        </Card>
                    </Col>
                    <Col xs={24} xl={12}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title="Compliance Action Summary"
                            extra={<Typography.Text type="secondary">Click a bar for details</Typography.Text>}
                        >
                            {periodData.complianceDocuments.length ? <ThemedHighcharts options={complianceHealthChart} /> : <Empty description="No compliance records found." />}
                        </Card>
                    </Col>
                </Row>
            )}

            {view === 'performance' && (
                <Row gutter={[16, 16]} className="project-admin-report-chart-grid">
                    <Col xs={24} lg={12}>
                        <PerformanceStatCard
                            loading={identityLoading || loading}
                            title="Revenue"
                            icon={<DollarCircleOutlined />}
                            formattedValue={formatCurrencyZAR(performanceData.revenue.current)}
                            deltaLabel={performanceData.revenue.delta.label}
                            deltaPositive={performanceData.revenue.delta.positive}
                            headline={performanceData.revenue.headline}
                            caption={`${performanceData.revenue.growing} of ${performanceData.smeCount} SMEs growing`}
                        />
                    </Col>
                    <Col xs={24} lg={12}>
                        <PerformanceStatCard
                            loading={identityLoading || loading}
                            title="Employees"
                            icon={<TeamOutlined />}
                            formattedValue={formatMetricNumber(performanceData.employees.current)}
                            deltaLabel={performanceData.employees.delta.label}
                            deltaPositive={performanceData.employees.delta.positive}
                            headline={performanceData.employees.headline}
                            caption={`${performanceData.employees.growing} of ${performanceData.smeCount} SMEs growing`}
                        />
                    </Col>
                    <Col span={24}>
                        <Card loading={identityLoading || loading} className="dashboard-section-card motion-card" title={<Space><FundOutlined /> Revenue & Employees Trend</Space>}>
                            {performanceData.smeCount ? <ThemedHighcharts options={performanceTrendOptions} /> : <Empty description="No SME revenue or employee data for this programme scope." />}
                        </Card>
                    </Col>
                </Row>
            )}

            <Modal
                open={!!drilldown}
                onCancel={() => setDrilldown(null)}
                footer={<Button onClick={() => setDrilldown(null)}>Close</Button>}
                title={drilldown?.title}
                width={800}
                destroyOnClose
            >
                {drilldown?.kind === 'applications' && (
                    <Table<ProjectAdminApplication>
                        rowKey="id"
                        size="small"
                        dataSource={drilldown.rows}
                        pagination={{ pageSize: 8, showSizeChanger: false }}
                        locale={{ emptyText: 'No applications match this selection.' }}
                        columns={[
                            { title: 'Business', dataIndex: 'businessName' },
                            { title: 'Programme', dataIndex: 'programName' },
                            { title: 'Status', dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
                            { title: 'Submitted', dataIndex: 'submittedAt', render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : '—' },
                        ]}
                    />
                )}
                {drilldown?.kind === 'interventions' && (
                    <Table<ProjectAdminIntervention>
                        rowKey="id"
                        size="small"
                        dataSource={drilldown.rows}
                        pagination={{ pageSize: 8, showSizeChanger: false }}
                        locale={{ emptyText: 'No interventions match this selection.' }}
                        columns={[
                            { title: 'Intervention', dataIndex: 'title' },
                            { title: 'SME', dataIndex: 'participantName' },
                            { title: 'Owner', dataIndex: 'owner' },
                            { title: 'Progress', dataIndex: 'progress', width: 140, render: (value: number) => <Progress percent={value} size="small" /> },
                            { title: 'Status', dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
                        ]}
                    />
                )}
                {drilldown?.kind === 'compliance' && (
                    <Table<ProjectAdminComplianceDocument>
                        rowKey="id"
                        size="small"
                        dataSource={drilldown.rows}
                        pagination={{ pageSize: 8, showSizeChanger: false }}
                        locale={{ emptyText: 'No compliance documents match this selection.' }}
                        columns={[
                            { title: 'Participant', dataIndex: 'participantId' },
                            { title: 'Status', dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
                            { title: 'Expiry', dataIndex: 'expiryDate', render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : '—' },
                            { title: 'Updated', dataIndex: 'updatedAt', render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : '—' },
                        ]}
                    />
                )}
            </Modal>
        </DashboardPage>
    )
}
