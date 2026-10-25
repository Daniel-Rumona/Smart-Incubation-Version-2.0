import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Card, Col, DatePicker, Empty, Grid, Progress, Row, Segmented, Space, Tag, theme, Typography } from 'antd'
import {
    AppstoreOutlined,
    AuditOutlined,
    BulbOutlined,
    CheckCircleOutlined,
    DashboardOutlined,
    DollarCircleOutlined,
    FallOutlined,
    FileProtectOutlined,
    FundOutlined,
    MinusOutlined,
    PlayCircleOutlined,
    RiseOutlined,
    TeamOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ReportExportButton } from '@/components/shared/ReportExportButton'
import { ReportPlayer, type PlayerSlide } from '@/components/reports/ReportPlayer'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS, CHART_PALETTE } from '@/config/chartPalette'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import type { ReportExportData } from '@/services/reportExport'
import { resolveReportInsights } from '@/services/reportExport/insights'
import type { ReportInsights } from '@/services/reportExport/types'
import { getCompanyName } from '@/services/userProfileService'
import { useThemeMode } from '@/providers/ThemeProvider'
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
import { useLanguage, tr } from '@/providers/LanguageProvider'

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
    const { t } = useLanguage()
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
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.applications} {t('applications ·')} {row.participants} {t('participants ·')} {row.interventions} {t('interventions')}</Typography.Text>
                {row.overdue > 0 && <Tag color="orange" style={{ marginInlineEnd: 0 }}>{row.overdue} {t('overdue')}</Tag>}
            </Space>
        </button>
    )
}

type RateItem = {
    title: string
    icon: ReactNode
    value: number
    /** null when the previous period had no records, so there is nothing to compare with. */
    previousValue: number | null
    caption: string
}

/** The change in points against the previous period, or a plain note when there's no earlier figure. */
const RateDelta = ({ value, previousValue }: Pick<RateItem, 'value' | 'previousValue'>) => {
    const { t } = useLanguage()
    const { token } = theme.useToken()
    if (previousValue === null) return <Typography.Text type="secondary" className="pa-rate-delta">{t('New this period')}</Typography.Text>
    const delta = value - previousValue
    const color = delta > 0 ? token.colorSuccess : delta < 0 ? token.colorError : token.colorTextSecondary
    const DeltaIcon = delta > 0 ? RiseOutlined : delta < 0 ? FallOutlined : MinusOutlined
    return (
        <span className="pa-rate-delta" style={{ color }}>
            <DeltaIcon />
            <Typography.Text strong style={{ color }}>{delta === 0 ? t('No change') : t('{points} pts', undefined, { points: Math.abs(delta) })}</Typography.Text>
        </span>
    )
}

const RateChangeCard = ({ title, icon, value, previousValue, caption, loading }: RateItem & { loading?: boolean }) => {
    const { t } = useLanguage()
    return (
        <Card loading={loading} className="dashboard-section-card motion-card" title={<Space>{icon} {title}</Space>}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                <Typography.Text strong style={{ fontSize: 34, lineHeight: 1 }}>{value}%</Typography.Text>
                <RateDelta value={value} previousValue={previousValue} />
            </div>
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
                {previousValue === null ? t('No records in the previous period to compare with') : t('vs {rate}% in the previous period', undefined, { rate: previousValue })}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{caption}</Typography.Text>
        </Card>
    )
}

/** Phone version: one row per rate inside a single card. */
const RateRow = ({ title, icon, value, previousValue, caption }: RateItem) => (
    <div className="pa-rate-row">
        <span className="pa-rate-icon" aria-hidden>{icon}</span>
        <span className="pa-rate-text">
            <Typography.Text strong>{title}</Typography.Text>
            <Typography.Text type="secondary">{caption}</Typography.Text>
        </span>
        <span className="pa-rate-figure">
            <strong>{value}%</strong>
            <RateDelta value={value} previousValue={previousValue} />
        </span>
    </div>
)

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
    const { t } = useLanguage()
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
            <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>{t('vs previous period ·')} {caption}</Typography.Text>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{headline.label}</Typography.Text>
                <Typography.Text strong style={{ color: headlineColor }}>{headline.value}%</Typography.Text>
            </div>
        </Card>
    )
}

const StatusBreakdownList = ({ counts }: { counts: Record<string, number> }) => {
    const { t } = useLanguage()
    const entries = Object.entries(counts).sort((left, right) => right[1] - left[1])
    const total = entries.reduce((sum, [, count]) => sum + count, 0)
    if (!entries.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No records')} style={{ margin: '20px 0' }} />
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
        yAxis: isPie ? undefined : { title: { text: tr('Applicants') }, allowDecimals: false },
        legend: { enabled: isPie },
        plotOptions: isPie
            ? { pie: { innerSize: '52%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' } } }
            : { series: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{ type, name: tr('Applicants'), data } as Highcharts.SeriesOptionsType],
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
    const { t } = useLanguage()
    const navigate = useNavigate()
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const [loading, setLoading] = useState(true)
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()])
    const [view, setView] = useState<ReportView>('overview')
    const [data, setData] = useState<ProjectAdminWorkspaceData>(emptyWorkspace)
    const [selectedProgramme, setSelectedProgramme] = useState<string>()
    const [applicationsTab, setApplicationsTab] = useState<'trends' | 'profile'>('trends')
    const [drilldown, setDrilldown] = useState<DrilldownState | null>(null)
    const { mode: playerMode } = useThemeMode()
    const [playerOpen, setPlayerOpen] = useState(false)
    const [playerOrigin, setPlayerOrigin] = useState<{ x: number, y: number } | null>(null)
    const [playerInsights, setPlayerInsights] = useState<{ insights: ReportInsights, aiGenerated: boolean } | null>(null)
    const [companyName, setCompanyName] = useState('')

    const rangePresets = useMemo(() => {
        const now = dayjs()
        return [
            { label: t('This month'), value: [now.startOf('month'), now.endOf('month')] as [Dayjs, Dayjs] },
            { label: t('This quarter'), value: [now.startOf('quarter'), now.endOf('quarter')] as [Dayjs, Dayjs] },
            { label: t('Year to date'), value: [now.startOf('year'), now] as [Dayjs, Dayjs] },
            { label: t('All time'), value: [now.subtract(10, 'year').startOf('year'), now.endOf('day')] as [Dayjs, Dayjs] },
        ]
    }, [t])

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            if (identityLoading || !user) return

            try {
                setLoading(true)
                const result = await loadProjectAdminWorkspace(user, activeProgramId, { includeDiscontinued: true })
                if (!cancelled) setData(result)
            } catch (error) {
                console.error('[PROJECT ADMIN REPORTS] Failed loading report data:', error)
                if (!cancelled) {
                    setData(emptyWorkspace)
                    message.error(t('Failed to load project admin reports.'))
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [activeProgramId, identityLoading, message, user, t])

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
                { min: 0, title: { text: tr('Revenue') }, labels: { formatter() { return formatCurrencyZAR(Number(this.value)) } } },
                { min: 0, allowDecimals: false, title: { text: tr('Employees') }, opposite: true },
            ],
            tooltip: { shared: true },
            plotOptions: { column: { borderRadius: 4 }, spline: { marker: { enabled: true } } },
            series: [
                { name: tr('Revenue'), type: 'column', yAxis: 0, data: performanceData.trend.map((bucket) => bucket.revenue), tooltip: { valuePrefix: 'R ' } },
                { name: tr('Employees'), type: 'spline', yAxis: 1, data: performanceData.trend.map((bucket) => bucket.employees) },
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
            yAxis: { min: 0, title: { text: tr('Applications') }, allowDecimals: false },
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
            yAxis: { min: 0, title: { text: tr('Interventions') }, allowDecimals: false },
            tooltip: { shared: true },
            plotOptions: {
                series: {
                    marker: { enabled: true, radius: 4 },
                    dataLabels: { enabled: true, format: '{point.y}', filter: { property: 'y', operator: '>', value: 0 } },
                },
            },
            series: [
                { type: 'spline', name: tr('Assigned'), color: CHART_COLORS.primary, data: countDates((row) => row.assignedAt) },
                { type: 'spline', name: tr('Completed'), color: CHART_COLORS.success, data: countDates((row) => row.completedAt) },
                {
                    type: 'spline',
                    name: tr('Overdue due dates'),
                    color: CHART_COLORS.danger,
                    data: countDates((row) => isOverdueIntervention(row) ? row.dueDate : null),
                },
            ],
        }
    }, [dateRange, periodData.interventions])

    const applicantDemographicCharts = useMemo(() => {
        const applications = periodData.applications
        const definitions = [
            { key: 'gender', title: t('Gender'), type: 'pie' as const, read: (row: typeof applications[number]) => row.gender },
            { key: 'age', title: t('Age group'), type: 'column' as const, read: (row: typeof applications[number]) => row.ageGroup },
            { key: 'province', title: t('Province'), type: 'bar' as const, read: (row: typeof applications[number]) => row.province },
            { key: 'city', title: t('City'), type: 'bar' as const, read: (row: typeof applications[number]) => row.city },
            { key: 'sector', title: t('Business sector'), type: 'bar' as const, read: (row: typeof applications[number]) => row.sector },
            { key: 'stage', title: t('Business stage'), type: 'column' as const, read: (row: typeof applications[number]) => row.stage },
            { key: 'bee', title: t('B-BBEE Level'), type: 'column' as const, read: (row: typeof applications[number]) => row.beeLevel },
            { key: 'hub', title: t('Hub'), type: 'bar' as const, read: (row: typeof applications[number]) => row.hub },
            { key: 'location', title: t('Location type'), type: 'pie' as const, read: (row: typeof applications[number]) => row.locationType },
            { key: 'disability', title: t('Disability status'), type: 'pie' as const, read: (row: typeof applications[number]) => row.disabilityStatus },
            { key: 'education', title: t('Education level'), type: 'bar' as const, read: (row: typeof applications[number]) => row.educationLevel },
            { key: 'employment', title: t('Employment status'), type: 'column' as const, read: (row: typeof applications[number]) => row.employmentStatus },
            { key: 'marital', title: t('Marital status'), type: 'pie' as const, read: (row: typeof applications[number]) => row.maritalStatus },
        ]
        return definitions
            .filter((definition) => applications.some((application) => Boolean(definition.read(application).trim())))
            .map((definition) => ({
                key: definition.key,
                title: definition.title,
                options: distributionChart(countBy(applications, definition.read), definition.type),
            }))
    }, [periodData.applications, t])

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
            yAxis: { min: 0, max: 100, title: { text: tr('Average ownership (%)') } },
            legend: { enabled: false },
            plotOptions: { series: { dataLabels: { enabled: true, format: '{point.y:.0f}%' } } },
            series: [{
                type: 'bar',
                name: tr('Average ownership'),
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
            xAxis: { title: { text: tr('Average applicant age') } },
            yAxis: { title: { text: tr('Average years trading') } },
            legend: { enabled: false },
            tooltip: { pointFormat: '<b>{point.name}</b><br/>Applicants: {point.z}<br/>Average age: {point.x:.1f}<br/>Average years trading: {point.y:.1f}' },
            plotOptions: { bubble: { minSize: 18, maxSize: 70, dataLabels: { enabled: true, format: '{point.name}: {point.z}' } } },
            series: [{
                type: 'bubble',
                name: tr('Sectors'),
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
        yAxis: { title: { text: tr('Applications') }, allowDecimals: false },
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
            name: tr('Applications'),
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
            name: tr('Interventions'),
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
            { label: t('Not started (0%)'), test: (progress) => progress <= 0, color: CHART_COLORS.slate },
            { label: '1–24%', test: (progress) => progress > 0 && progress < 25, color: CHART_COLORS.danger },
            { label: '25–49%', test: (progress) => progress >= 25 && progress < 50, color: CHART_COLORS.amber },
            { label: '50–74%', test: (progress) => progress >= 50 && progress < 75, color: CHART_COLORS.primary },
            { label: '75–99%', test: (progress) => progress >= 75 && progress < 100, color: CHART_COLORS.cyan },
            { label: t('Completed (100%)'), test: (progress) => progress >= 100, color: CHART_COLORS.success },
        ]
        return {
            chart: { type: 'column', height: 340 },
            title: { text: undefined },
            xAxis: { categories: buckets.map((bucket) => bucket.label) },
            yAxis: { min: 0, title: { text: tr('Interventions') }, allowDecimals: false },
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
                name: tr('Interventions'),
                data: buckets.map((bucket) => ({
                    y: periodData.interventions.filter((row) => bucket.test(row.progress)).length,
                    color: bucket.color,
                })),
            }],
        }
    }, [periodData.interventions, t])

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
            name: tr('Documents'),
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
            yAxis: { title: { text: tr('Documents') }, allowDecimals: false },
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
                name: tr('Documents'),
                data: [
                    { name: 'Clear', y: clearRows.length, color: CHART_COLORS.success },
                    { name: 'Action required', y: attentionRows.length, color: CHART_COLORS.danger },
                ],
            }],
        }
    }, [periodData.complianceDocuments])

    const buildExportData = (): ReportExportData => {
        const countBy = (rows: Array<{ status?: string }>) => {
            const counts = new Map<string, number>()
            rows.forEach((row) => {
                const label = String(row.status || 'Unspecified').trim() || 'Unspecified'
                counts.set(label, (counts.get(label) || 0) + 1)
            })
            return [...counts.entries()].sort((left, right) => right[1] - left[1])
        }
        const rateTone = (rate: number) => (rate >= 70 ? 'good' as const : rate >= 40 ? 'watch' as const : 'risk' as const)
        const change = (current: number, previous: number) => (previous ? `${Math.round(((current - previous) / previous) * 100)}% vs previous period` : 'no previous period figure')

        return {
            role: user?.role || 'projectadmin',
            title: 'Programme Report',
            periodLabel: `${dateRange[0].format('DD MMM YYYY')} to ${dateRange[1].format('DD MMM YYYY')}`,
            organisation: user?.companyCode || undefined,
            preparedBy: user?.name || user?.displayName || user?.email || 'Project administrator',
            kpis: [
                { label: 'Open applications', value: metrics.openApplications, note: `${metrics.acceptedApplications} accepted (${metrics.acceptanceRate}% acceptance rate)` },
                { label: 'Participants', value: metrics.participants },
                { label: 'Interventions completed', value: metrics.completedInterventions, note: `${metrics.completionRate}% completion rate`, tone: rateTone(metrics.completionRate) },
                { label: 'Overdue interventions', value: metrics.overdueInterventions, tone: metrics.overdueInterventions ? 'risk' : 'good' },
                { label: 'Compliance alerts', value: metrics.complianceAttention, note: `${metrics.complianceRate}% of documents compliant`, tone: metrics.complianceAttention ? 'watch' : 'good' },
                { label: 'Programmes', value: programmeRows.length },
                { label: 'SME revenue', value: formatCurrencyZAR(performanceData.revenue.current), note: change(performanceData.revenue.current, performanceData.revenue.previous), tone: performanceData.revenue.current >= performanceData.revenue.previous ? 'good' : 'watch' },
                { label: 'Employees', value: performanceData.employees.current.toLocaleString(), note: change(performanceData.employees.current, performanceData.employees.previous), tone: performanceData.employees.current >= performanceData.employees.previous ? 'good' : 'watch' },
            ],
            tables: [
                {
                    key: 'programmes',
                    title: 'Programme breakdown',
                    columns: [{ key: 'programme', label: 'Programme' }, { key: 'applications', label: 'Applications' }, { key: 'participants', label: 'Participants' }, { key: 'interventions', label: 'Interventions' }, { key: 'completed', label: 'Completed' }, { key: 'overdue', label: 'Overdue' }],
                    rows: programmeRows.map((row) => ({ programme: row.programme, applications: row.applications, participants: row.participants, interventions: row.interventions, completed: row.completed, overdue: row.overdue })),
                },
                {
                    key: 'applications',
                    title: 'Applications by status',
                    columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Applications' }],
                    rows: countBy(periodData.applications).map(([status, count]) => ({ status, count })),
                },
                {
                    key: 'compliance',
                    title: 'Compliance documents by status',
                    columns: [{ key: 'status', label: 'Status' }, { key: 'count', label: 'Documents' }],
                    rows: countBy(periodData.complianceDocuments).map(([status, count]) => ({ status, count })),
                },
                {
                    key: 'performance',
                    title: 'SME revenue and employment over time',
                    columns: [{ key: 'period', label: 'Period' }, { key: 'revenue', label: 'Revenue' }, { key: 'employees', label: 'Employees' }],
                    rows: performanceData.trend.map((bucket) => ({ period: bucket.label, revenue: formatCurrencyZAR(bucket.revenue), employees: bucket.employees })),
                },
            ],
        }
    }

    const pageLoading = identityLoading || loading
    const isMobile = !Grid.useBreakpoint().md

    // A rate can only be compared with the previous period if that period had records to measure.
    const rateItems = [
        {
            key: 'acceptance',
            title: t('Acceptance rate'),
            icon: <AuditOutlined />,
            value: metrics.acceptanceRate,
            previousValue: previousPeriodData.applications.length ? previousRates.acceptanceRate : null,
            caption: t('{open} of {total} still open', undefined, { open: metrics.openApplications, total: periodData.applications.length }),
        },
        {
            key: 'delivery',
            title: t('Delivery rate'),
            icon: <CheckCircleOutlined />,
            value: metrics.deliveryRate,
            previousValue: previousPeriodData.interventions.length ? previousRates.deliveryRate : null,
            caption: t('{done} of {total} completed', undefined, { done: metrics.completedInterventions, total: periodData.interventions.length }),
        },
        {
            key: 'compliance',
            title: t('Compliance rate'),
            icon: <FileProtectOutlined />,
            value: metrics.complianceRate,
            previousValue: previousPeriodData.complianceDocuments.length ? previousRates.complianceRate : null,
            caption: t('{count} of {total} need attention', undefined, { count: metrics.complianceAttention, total: periodData.complianceDocuments.length }),
        },
    ]
    // Compliance documents only carry the participant's id.
    const participantNameById = useMemo(() => new Map(data.participants.map((participant) => [participant.id, participant.businessName])), [data.participants])

    // The few records to act on first: overdue interventions (oldest first), then compliance documents needing attention.
    const attentionItems = useMemo(() => {
        const overdue = periodData.interventions
            .filter((intervention) => isOverdueIntervention(intervention))
            .sort((left, right) => (left.dueDate?.getTime() ?? 0) - (right.dueDate?.getTime() ?? 0))
            .map((intervention) => ({
                key: `intervention-${intervention.id}`,
                title: intervention.title || tr('Untitled intervention'),
                detail: intervention.dueDate
                    ? tr('{sme} · {days} days overdue', undefined, { sme: intervention.participantName, days: Math.max(dayjs().diff(intervention.dueDate, 'day'), 1) })
                    : intervention.participantName,
                tag: { label: tr('Overdue'), color: 'red' },
                route: '/operations/interventions',
                state: { focusInterventionId: intervention.id },
            }))
        const compliance = periodData.complianceDocuments
            .filter((document) => isComplianceAttentionStatus(document.status))
            .map((document) => ({
                key: `compliance-${document.id}`,
                title: participantNameById.get(document.participantId) || tr('Unknown SME'),
                detail: document.type || tr('Compliance document'),
                tag: { label: statusLabel(document.status), color: 'orange' },
                route: '/operations/participants/compliance',
                state: { focusParticipantId: document.participantId },
            }))
        return { items: [...overdue, ...compliance].slice(0, 5), total: overdue.length + compliance.length }
    }, [participantNameById, periodData])

    const startPlayer = (event?: { currentTarget: Element }) => {
        // The player ripples open from the button that started it, and takes the browser fullscreen itself.
        const rect = event?.currentTarget.getBoundingClientRect()
        setPlayerOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
        setPlayerInsights(null)
        setPlayerOpen(true)
        if (user?.companyCode) void getCompanyName(user.companyCode).then(setCompanyName)
        void resolveReportInsights(buildExportData(), 'executive').then(setPlayerInsights)
    }

    // Same slide grammar as the Operations report: each slide says every number once (lead sentence, then a
    // rate the lead doesn't state, then the split). Player text stays English, like the exported report.
    const playerSlides = useMemo<PlayerSlide[]>(() => {
        const [start, end] = dateRange
        const periodLabel = start.isSame(end, 'month') ? start.format('MMMM YYYY') : `${start.format('DD MMM YYYY')} – ${end.format('DD MMM YYYY')}`
        const tone = playerMode === 'dark'
            ? { good: '#16A34A', warn: '#B48C08', risk: '#DC2626', info: '#3B82F6', neutral: '#94A3B8' }
            : { good: '#15803D', warn: '#CA8A04', risk: '#DC2626', info: '#2563EB', neutral: '#64748B' }
        const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
        // Below this many items a percentage overstates what we know, so no large figure is shown.
        const enough = (count: number) => count >= 5
        const versus = (current: number, previous: number) =>
            current === previous ? `, the same as the previous period` : `, ${current > previous ? 'up' : 'down'} from ${previous}% the previous period`
        const insights = playerInsights?.insights

        const applications = periodData.applications.length
        const declined = Math.max(applications - metrics.acceptedApplications - metrics.openApplications, 0)
        const interventions = periodData.interventions.length
        const underway = Math.max(interventions - metrics.completedInterventions - metrics.overdueInterventions, 0)
        const documents = periodData.complianceDocuments.length
        const compliant = Math.max(documents - metrics.complianceAttention, 0)
        const revenue = performanceData.revenue
        const steady = Math.max(performanceData.smeCount - revenue.growing - revenue.declining, 0)

        const slides: PlayerSlide[] = [
            {
                kind: 'title',
                eyebrow: 'Programme report',
                title: periodLabel,
                subtitle: `${companyName ? `${companyName} · ` : ''}Applications, intervention delivery, compliance and SME performance across your programmes.`,
                icon: <FundOutlined />,
                accent: '#8b5cf6',
            },
            {
                kind: 'focus',
                title: 'Applications',
                lead: applications
                    ? `${plural(applications, 'application')} in the period: ${metrics.acceptedApplications} accepted and ${metrics.openApplications} still open.`
                    : 'No applications were received in this period.',
                icon: <AuditOutlined />,
                accent: '#a78bfa',
                figure: enough(applications) ? { value: `${metrics.acceptanceRate}%`, label: `accepted${versus(metrics.acceptanceRate, previousRates.acceptanceRate)}` } : undefined,
                breakdownTitle: 'Where applications stand',
                breakdown: [
                    { label: 'Declined or withdrawn', value: declined, total: applications, color: tone.risk },
                    { label: 'Open', value: metrics.openApplications, total: applications, color: tone.neutral, note: '' },
                    { label: 'Accepted', value: metrics.acceptedApplications, total: applications, color: tone.good, note: '' },
                ],
            },
            {
                kind: 'focus',
                title: 'Intervention delivery',
                lead: interventions
                    ? `${metrics.completedInterventions} of ${plural(interventions, 'intervention')} completed${metrics.overdueInterventions ? `, and ${metrics.overdueInterventions} ${metrics.overdueInterventions === 1 ? 'is' : 'are'} overdue` : ', with nothing overdue'}.`
                    : 'No interventions were active in this period.',
                icon: <RiseOutlined />,
                accent: '#38bdf8',
                figure: enough(interventions) ? { value: `${metrics.deliveryRate}%`, label: `delivered${versus(metrics.deliveryRate, previousRates.deliveryRate)}` } : undefined,
                breakdownTitle: 'Where the work stands',
                breakdown: [
                    { label: 'Overdue', value: metrics.overdueInterventions, total: interventions, color: tone.risk, note: '' },
                    { label: 'Under way', value: underway, total: interventions, color: tone.info },
                    { label: 'Completed', value: metrics.completedInterventions, total: interventions, color: tone.good, note: '' },
                ],
            },
            {
                kind: 'focus',
                title: 'Compliance',
                lead: documents
                    ? `${compliant} of ${plural(documents, 'compliance document')} ${compliant === 1 ? 'is' : 'are'} in good standing, and ${metrics.complianceAttention} ${metrics.complianceAttention === 1 ? 'needs' : 'need'} attention.`
                    : 'No compliance documents were on record for this period.',
                icon: <FileProtectOutlined />,
                accent: '#f59e0b',
                figure: enough(documents) ? { value: `${metrics.complianceRate}%`, label: `compliant${versus(metrics.complianceRate, previousRates.complianceRate)}` } : undefined,
                breakdownTitle: 'Documents',
                breakdown: [
                    { label: 'Need attention', value: metrics.complianceAttention, total: documents, color: tone.risk, note: '' },
                    { label: 'In good standing', value: compliant, total: documents, color: tone.good, note: '' },
                ],
            },
        ]

        if (programmeRows.length) {
            slides.push({
                kind: 'focus',
                title: 'Programmes',
                lead: `${plural(programmeRows.length, 'programme')} with ${plural(metrics.participants, 'participant')} between them.`,
                icon: <AppstoreOutlined />,
                accent: '#818cf8',
                barsTitle: 'Interventions completed per programme',
                bars: programmeRows
                    .filter((row) => row.interventions)
                    .slice(0, 5)
                    .map((row) => ({ label: row.programme, value: row.completed, total: row.interventions, color: row.overdue ? tone.warn : tone.good, note: row.overdue ? `${row.overdue} overdue` : undefined })),
            })
        }

        if (performanceData.smeCount) {
            slides.push({
                kind: 'focus',
                title: 'SME performance',
                lead: `Revenue across ${plural(performanceData.smeCount, 'SME')} came to ${formatCurrencyZAR(revenue.current)}, ${revenue.delta.label} on the previous period. Employees: ${performanceData.employees.current}, ${performanceData.employees.delta.label}.`,
                icon: <FundOutlined />,
                accent: '#34d399',
                breakdownTitle: 'SMEs by revenue direction',
                breakdown: [
                    { label: 'Declining', value: revenue.declining, total: performanceData.smeCount, color: tone.risk },
                    { label: 'Steady or not reported', value: steady, total: performanceData.smeCount, color: tone.neutral },
                    { label: 'Growing', value: revenue.growing, total: performanceData.smeCount, color: tone.good },
                ],
            })
        }

        slides.push(
            {
                kind: 'narrative',
                title: 'What the figures say',
                icon: <BulbOutlined />,
                accent: '#fbbf24',
                loading: !insights,
                paragraph: insights?.executiveSummary,
                points: insights?.highlights.slice(0, 3).map((text) => ({ icon: <CheckCircleOutlined />, text, tone: 'good' as const })),
                note: insights ? (playerInsights?.aiGenerated ? 'Commentary written by AI from the report figures.' : 'Commentary compiled from the report figures.') : undefined,
            },
            // Risks and actions answer different questions, so each gets its own slide that fits a phone.
            {
                kind: 'narrative',
                title: 'Watch points',
                lead: insights?.outlook,
                icon: <WarningOutlined />,
                accent: '#f0808a',
                loading: !insights,
                points: insights?.risks.slice(0, 3).map((text) => ({ icon: <WarningOutlined />, text, tone: 'warn' as const })),
            },
            {
                kind: 'narrative',
                title: 'Next steps',
                icon: <BulbOutlined />,
                accent: '#60a5fa',
                loading: !insights,
                points: insights?.actionPlan.slice(0, 3).map((item) => ({ icon: <BulbOutlined />, text: item.action, meta: [item.owner, item.due].filter(Boolean).join(' · '), tone: 'info' as const })),
            },
            {
                kind: 'closing',
                title: 'End of report',
                subtitle: 'Use “Export report” for the full document with data tables.',
                icon: <CheckCircleOutlined />,
                accent: '#8b5cf6',
            },
        )
        return slides
    }, [companyName, dateRange, metrics, performanceData, periodData, playerInsights, playerMode, previousRates, programmeRows])

    return (
        <DashboardPage className="operations-reports-page project-admin-reports-page">
            <FilterBar
                primary={(
                    <>
                        <Segmented<ReportView>
                            value={view}
                            onChange={setView}
                            options={[
                                { label: t('Overview'), value: 'overview', icon: <DashboardOutlined /> },
                                { label: t('Applications'), value: 'applications', icon: <AuditOutlined /> },
                                { label: t('Interventions'), value: 'interventions', icon: <RiseOutlined /> },
                                { label: t('Compliance'), value: 'compliance', icon: <FileProtectOutlined /> },
                                { label: t('Performance'), value: 'performance', icon: <FundOutlined /> },
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
                actions={(
                    <>
                        <Button icon={<PlayCircleOutlined />} onClick={(event) => startPlayer(event)} disabled={identityLoading || loading}>{t('Play report')}</Button>
                        <ReportExportButton buildData={buildExportData} disabled={identityLoading || loading} />
                    </>
                )}
            />

            {/* One hint for the page instead of one per chart; the charts show a pointer where they can be clicked. */}
            {(view === 'applications' || view === 'interventions' || view === 'compliance') && (
                <Typography.Text type="secondary" className="pa-report-hint">{t('Select a bar or segment in any chart to see the records behind it.')}</Typography.Text>
            )}

            {view === 'overview' && (
                <>
                    {/* Three cards side by side on desktop; on phones one card with a row per rate, so they don't fill the screen. */}
                    {isMobile ? (
                        <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Rates this period')}>
                            <div className="pa-rate-list">
                                {rateItems.map(({ key, ...item }) => <RateRow key={key} {...item} />)}
                            </div>
                        </Card>
                    ) : (
                        <Row gutter={[16, 16]} className="project-admin-report-chart-grid">
                            {rateItems.map(({ key, ...item }) => (
                                <Col xs={24} lg={8} key={key}>
                                    <RateChangeCard loading={pageLoading} {...item} />
                                </Col>
                            ))}
                        </Row>
                    )}

                    <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                        <Col xs={24} xl={9}>
                            <Card
                                loading={pageLoading}
                                className="dashboard-section-card motion-card"
                                title={t('Needs attention')}
                                extra={<Button type="link" size="small" onClick={() => navigate('/operations/risk-register')}>{t('Risk register')}</Button>}
                            >
                                {attentionItems.items.length ? (
                                    <>
                                        <div className="pa-attention-list">
                                            {attentionItems.items.map((item) => (
                                                <button key={item.key} type="button" className="pa-attention-item" onClick={() => navigate(item.route, { state: item.state })}>
                                                    <span className="pa-attention-text">
                                                        <Typography.Text strong ellipsis>{item.title}</Typography.Text>
                                                        <Typography.Text type="secondary" ellipsis>{item.detail}</Typography.Text>
                                                    </span>
                                                    <Tag color={item.tag.color}>{item.tag.label}</Tag>
                                                </button>
                                            ))}
                                        </div>
                                        {attentionItems.total > attentionItems.items.length && (
                                            <Typography.Text type="secondary" className="pa-attention-more">
                                                {t('{count} more in the risk register.', undefined, { count: attentionItems.total - attentionItems.items.length })}
                                            </Typography.Text>
                                        )}
                                    </>
                                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nothing overdue and no compliance alerts in this period.')} />}
                            </Card>
                        </Col>
                        <Col xs={24} xl={15}>
                            <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Programme health')}>
                                {programmeRows.length ? (
                                    <Row gutter={[10, 10]}>
                                        {programmeRows.map((row) => (
                                            <Col xs={24} sm={12} key={row.key}>
                                                <ProgrammeCard row={row} onClick={() => setSelectedProgramme(row.programme)} />
                                            </Col>
                                        ))}
                                    </Row>
                                ) : <Empty description={t('No programme report data for this period.')} />}
                            </Card>
                        </Col>
                    </Row>
                </>
            )}

            <ResponsiveModal
                open={!!selectedProgrammeDetail}
                onClose={() => setSelectedProgramme(undefined)}
                title={selectedProgrammeDetail?.row.programme}
                width={760}
                centered
            >
                {selectedProgrammeDetail && (
                    <>
                        <div className="pa-report-figures">
                            <div><Typography.Text type="secondary">{t('Applications')}</Typography.Text><strong>{selectedProgrammeDetail.row.applications}</strong></div>
                            <div><Typography.Text type="secondary">{t('Participants')}</Typography.Text><strong>{selectedProgrammeDetail.row.participants}</strong></div>
                            <div><Typography.Text type="secondary">{t('Interventions')}</Typography.Text><strong>{selectedProgrammeDetail.row.interventions}</strong></div>
                            <div><Typography.Text type="secondary">{t('Overdue')}</Typography.Text><strong className={selectedProgrammeDetail.row.overdue > 0 ? 'is-risk' : undefined}>{selectedProgrammeDetail.row.overdue}</strong></div>
                        </div>
                        <Row gutter={[24, 24]}>
                            <Col xs={24} md={8}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>{t('Applications')}</Typography.Text>
                                <StatusBreakdownList counts={selectedProgrammeDetail.applicationCounts} />
                            </Col>
                            <Col xs={24} md={8}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>{t('Interventions')}</Typography.Text>
                                <StatusBreakdownList counts={selectedProgrammeDetail.interventionCounts} />
                            </Col>
                            <Col xs={24} md={8}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>{t('Compliance')}</Typography.Text>
                                <StatusBreakdownList counts={selectedProgrammeDetail.complianceCounts} />
                            </Col>
                        </Row>
                    </>
                )}
            </ResponsiveModal>

            {view === 'applications' && (
                <>
                    {/* The applicant profile is a tab here rather than a wide modal of charts, which read poorly on phones. */}
                    <Segmented<'trends' | 'profile'>
                        className="pa-report-subtabs"
                        value={applicationsTab}
                        onChange={setApplicationsTab}
                        options={[{ label: t('Trends'), value: 'trends' }, { label: t('Applicant profile'), value: 'profile' }]}
                    />
                    {applicationsTab === 'trends' ? (
                        <Row gutter={[20, 20]} className="project-admin-report-chart-grid">
                            <Col xs={24}>
                                <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Applications and statuses over time')}>
                                    {periodData.applications.length ? <ThemedHighcharts options={applicationTimelineChart} /> : <Empty description={t('No applications found for this period.')} />}
                                </Card>
                            </Col>
                            <Col xs={24}>
                                <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Application status mix')}>
                                    {periodData.applications.length ? <ThemedHighcharts options={applicationStatusChart} /> : <Empty description={t('No application statuses found.')} />}
                                </Card>
                            </Col>
                        </Row>
                    ) : (
                        <Row gutter={[20, 20]} className="project-admin-report-chart-grid">
                            {ownershipChart && (
                                <Col xs={24} xl={12}>
                                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Ownership profile')}>
                                        <ThemedHighcharts options={ownershipChart} />
                                    </Card>
                                </Col>
                            )}
                            {applicantDemographicCharts.map((chart) => (
                                <Col xs={24} xl={12} key={chart.key}>
                                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={chart.title}>
                                        <ThemedHighcharts options={chart.options} />
                                    </Card>
                                </Col>
                            ))}
                            {sectorBubbleChart && (
                                <Col xs={24}>
                                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Sector profile: applicant age, trading experience and volume')}>
                                        <ThemedHighcharts options={sectorBubbleChart} />
                                    </Card>
                                </Col>
                            )}
                            {!applicantDemographicCharts.length && !ownershipChart && !sectorBubbleChart && (
                                <Col xs={24}>
                                    <Card className="dashboard-section-card motion-card">
                                        <Empty description={t('Applicant demographic fields have not been captured for this period.')} />
                                    </Card>
                                </Col>
                            )}
                        </Row>
                    )}
                </>
            )}

            {view === 'interventions' && (
                <Row gutter={[20, 20]} className="project-admin-report-chart-grid">
                    <Col xs={24}>
                        <Card loading={identityLoading || loading} className="dashboard-section-card motion-card" title={t('Intervention activity over time')}>
                            {periodData.interventions.length ? <ThemedHighcharts options={interventionTimelineChart} /> : <Empty description={t('No intervention activity found.')} />}
                        </Card>
                    </Col>
                    <Col xs={24} xl={9}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title={t('Intervention status mix')}
                        >
                            {periodData.interventions.length ? <ThemedHighcharts options={interventionChart} /> : <Empty description={t('No interventions found.')} />}
                        </Card>
                    </Col>
                    <Col xs={24} xl={15}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title={t('Intervention progress distribution')}
                        >
                            {periodData.interventions.length ? <ThemedHighcharts options={interventionProgressChart} /> : <Empty description={t('No intervention progress found.')} />}
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
                            title={t('Compliance status mix')}
                        >
                            {periodData.complianceDocuments.length ? <ThemedHighcharts options={complianceStatusChart} /> : <Empty description={t('No compliance records found.')} />}
                        </Card>
                    </Col>
                    <Col xs={24} xl={12}>
                        <Card
                            loading={identityLoading || loading}
                            className="dashboard-section-card motion-card"
                            title={t('Compliance action summary')}
                        >
                            {periodData.complianceDocuments.length ? <ThemedHighcharts options={complianceHealthChart} /> : <Empty description={t('No compliance records found.')} />}
                        </Card>
                    </Col>
                </Row>
            )}

            {view === 'performance' && (
                <Row gutter={[16, 16]} className="project-admin-report-chart-grid">
                    <Col xs={24} lg={12}>
                        <PerformanceStatCard
                            loading={identityLoading || loading}
                            title={t('Revenue')}
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
                            title={t('Employees')}
                            icon={<TeamOutlined />}
                            formattedValue={formatMetricNumber(performanceData.employees.current)}
                            deltaLabel={performanceData.employees.delta.label}
                            deltaPositive={performanceData.employees.delta.positive}
                            headline={performanceData.employees.headline}
                            caption={`${performanceData.employees.growing} of ${performanceData.smeCount} SMEs growing`}
                        />
                    </Col>
                    <Col span={24}>
                        <Card loading={identityLoading || loading} className="dashboard-section-card motion-card" title={<Space><FundOutlined /> {t('Revenue and employees trend')}</Space>}>
                            {performanceData.smeCount ? <ThemedHighcharts options={performanceTrendOptions} /> : <Empty description={t('No SME revenue or employee data for this programme scope.')} />}
                        </Card>
                    </Col>
                </Row>
            )}

            {/* Chart drill-downs: a table on desktop, cards on phones (ResponsiveDataView). */}
            <ResponsiveModal
                open={!!drilldown}
                onClose={() => setDrilldown(null)}
                title={drilldown?.title}
                width={800}
                centered
            >
                {drilldown?.kind === 'applications' && (
                    <ResponsiveDataView<ProjectAdminApplication>
                        rowKey="id"
                        rows={drilldown.rows}
                        emptyText={t('No applications match this selection.')}
                        columns={[
                            { title: t('Business'), dataIndex: 'businessName' },
                            { title: t('Programme'), dataIndex: 'programName' },
                            { title: t('Status'), dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
                            { title: t('Submitted'), dataIndex: 'submittedAt', render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : '—' },
                        ]}
                        renderCard={(row) => (
                            <div className="pa-drill-card">
                                <Typography.Text strong>{row.businessName}</Typography.Text>
                                <Typography.Text type="secondary">{row.programName}{row.submittedAt ? ` · ${dayjs(row.submittedAt).format('DD MMM YYYY')}` : ''}</Typography.Text>
                                <Tag color={statusColor(row.status)}>{statusLabel(row.status)}</Tag>
                            </div>
                        )}
                    />
                )}
                {drilldown?.kind === 'interventions' && (
                    <ResponsiveDataView<ProjectAdminIntervention>
                        rowKey="id"
                        rows={drilldown.rows}
                        emptyText={t('No interventions match this selection.')}
                        columns={[
                            { title: t('Intervention'), dataIndex: 'title' },
                            { title: t('SME'), dataIndex: 'participantName' },
                            { title: t('Owner'), dataIndex: 'owner' },
                            { title: t('Progress'), dataIndex: 'progress', width: 140, render: (value: number) => <Progress percent={value} size="small" /> },
                            { title: t('Status'), dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
                        ]}
                        renderCard={(row) => (
                            <div className="pa-drill-card">
                                <Typography.Text strong>{row.title}</Typography.Text>
                                <Typography.Text type="secondary">{row.participantName}{row.owner ? ` · ${row.owner}` : ''}</Typography.Text>
                                <Progress percent={row.progress} size="small" />
                                <Tag color={statusColor(row.status)}>{statusLabel(row.status)}</Tag>
                            </div>
                        )}
                    />
                )}
                {drilldown?.kind === 'compliance' && (
                    <ResponsiveDataView<ProjectAdminComplianceDocument>
                        rowKey="id"
                        rows={drilldown.rows}
                        emptyText={t('No compliance documents match this selection.')}
                        columns={[
                            { title: t('SME'), dataIndex: 'participantId', render: (value: string) => participantNameById.get(value) || t('Unknown SME') },
                            { title: t('Document'), dataIndex: 'type', render: (value: string) => value || '—' },
                            { title: t('Status'), dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag> },
                            { title: t('Expiry'), dataIndex: 'expiryDate', render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : '—' },
                        ]}
                        renderCard={(row) => (
                            <div className="pa-drill-card">
                                <Typography.Text strong>{participantNameById.get(row.participantId) || t('Unknown SME')}</Typography.Text>
                                <Typography.Text type="secondary">{row.type || '—'}{row.expiryDate ? ` · ${t('Expires {date}', undefined, { date: dayjs(row.expiryDate).format('DD MMM YYYY') })}` : ''}</Typography.Text>
                                <Tag color={statusColor(row.status)}>{statusLabel(row.status)}</Tag>
                            </div>
                        )}
                    />
                )}
            </ResponsiveModal>

            <ReportPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} slides={playerSlides} origin={playerOrigin} />
        </DashboardPage>
    )
}
