import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Card, Col, Empty, Input, Pagination, Progress, Row, Select, Space, Tag, Typography, theme } from 'antd'
import {
    AimOutlined,
    AppstoreOutlined,
    BarChartOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ProjectOutlined,
    RiseOutlined,
    SearchOutlined,
    DollarOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import { loadDirectorBriefing, type DirectorProgrammeRow, type KpiTally } from '@/services/directorDashboardService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import '@/styles/dashboard.css'
import '@/styles/director.css'

type SortKey = 'completion' | 'kpis' | 'growth' | 'smes' | 'risk'

const PAGE_SIZE = 6

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0, notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard' }).format(value || 0)

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : null)
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`
const healthColor = (value: number) => (value >= 75 ? CHART_COLORS.success : value >= 40 ? CHART_COLORS.amber : CHART_COLORS.danger)
const kpiRate = (tally: KpiTally) => percent(tally.onTrack, tally.withTarget)

const statusColor = (status: string) => {
    const normalized = status.toLowerCase()
    if (normalized.includes('inactive') || normalized.includes('closed')) return 'default'
    if (normalized.includes('draft') || normalized.includes('pending')) return 'orange'
    return 'green'
}
// Stored statuses are lower-case English words ("active", "draft"); shown capitalised and translated.
const statusLabel = (status: string) => status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase() : 'Active'

/**
 * Programme performance: one scorecard per programme (completion against required support, KPIs on track and revenue
 * growth), using the director dashboard's figures so the two pages always agree. A programme opens its size, intake
 * funnel and delivery & risk breakdown.
 */
export const DirectorProgramsPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { token } = theme.useToken()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [rows, setRows] = useState<DirectorProgrammeRow[]>([])
    // KPI totals for the whole selection, as the dashboard counts them (company targets), not a sum of programmes.
    const [kpiTotals, setKpiTotals] = useState<KpiTally | null>(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [sortKey, setSortKey] = useState<SortKey>('completion')
    const [page, setPage] = useState(1)
    const [selectedId, setSelectedId] = useState<string>()

    const load = useCallback(async () => {
        if (identityLoading || !user) return
        setLoading(true)
        try {
            const briefing = await loadDirectorBriefing(user, { activeProgramId, isAllPrograms })
            setRows(briefing.programmes)
            setKpiTotals(briefing.kpis)
        } catch (error) {
            console.error('[DIRECTOR] Failed to load programme performance:', error)
            message.error(t('Programme performance could not be loaded.'))
            setRows([])
            setKpiTotals(null)
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, identityLoading, isAllPrograms, message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const pageLoading = identityLoading || loading

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        const matches = rows.filter((row) => !term || row.name.toLowerCase().includes(term))
        // Highest first; programmes without a figure sort last.
        const score: Record<SortKey, (row: DirectorProgrammeRow) => number> = {
            completion: (row) => row.completion ?? -1,
            kpis: (row) => kpiRate(row.kpis) ?? -1,
            growth: (row) => row.revenueGrowth ?? -Infinity,
            smes: (row) => row.smes,
            risk: (row) => row.highRisk,
        }
        return [...matches].sort((left, right) => score[sortKey](right) - score[sortKey](left) || left.name.localeCompare(right.name))
    }, [rows, search, sortKey])

    const pagedRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

    const metrics = useMemo(() => {
        const required = filtered.reduce((sum, row) => sum + row.required, 0)
        const completed = filtered.reduce((sum, row) => sum + row.completed, 0)
        const start = filtered.reduce((sum, row) => sum + row.revenueStart, 0)
        const latest = filtered.reduce((sum, row) => sum + row.revenueLatest, 0)
        return {
            programmes: filtered.length,
            smes: filtered.reduce((sum, row) => sum + row.smes, 0),
            required,
            completed,
            completion: percent(completed, required),
            onTrack: kpiTotals?.onTrack || 0,
            withTarget: kpiTotals?.withTarget || 0,
            behind: kpiTotals?.behind || 0,
            growth: start > 0 ? Math.round(((latest - start) / start) * 100) : null,
            growing: filtered.reduce((sum, row) => sum + row.growingSmes, 0),
            withRevenue: filtered.reduce((sum, row) => sum + row.smesWithRevenue, 0),
        }
    }, [filtered, kpiTotals])

    useRegisterAgentPageContext({
        pageKey: 'director-programs',
        pageName: tEnglish('Programme performance'),
        purpose: 'Shows each programme\'s completion against required support, KPIs on track and revenue growth for the active programme selection.',
        currentFilters: { search, sortKey, activeProgramId },
        metrics,
        dataSummary: { visiblePrograms: filtered.length, scope: isAllPrograms ? 'all programs' : 'selected program' },
    })

    const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId])

    // One axis, 0–100%: completion and KPI attainment side by side for each programme.
    const comparisonChart = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'bar', height: Math.max(220, filtered.length * 60 + 80) },
        title: { text: undefined },
        xAxis: { categories: filtered.map((row) => row.name) },
        yAxis: { min: 0, max: 100, title: { text: undefined }, labels: { format: '{value}%' } },
        tooltip: { shared: true, valueSuffix: '%' },
        plotOptions: { bar: { borderRadius: 3, dataLabels: { enabled: true, format: '{y}%' } } },
        series: [
            { type: 'bar', name: t('Completion'), color: CHART_COLORS.primary, data: filtered.map((row) => row.completion) },
            { type: 'bar', name: t('KPIs on track'), color: CHART_COLORS.success, data: filtered.map((row) => kpiRate(row.kpis)) },
        ],
    }), [filtered, t])

    const programmeName = (row: DirectorProgrammeRow) => (row.id === 'unassigned' ? t('No programme') : row.name)

    const dates = (row: DirectorProgrammeRow) => (row.startDate || row.endDate)
        ? t('{start} to {end}', undefined, { start: row.startDate || '—', end: row.endDate || t('ongoing') })
        : null

    const growthTag = (row: DirectorProgrammeRow) => row.revenueGrowth === null
        ? <Typography.Text type="secondary">—</Typography.Text>
        : <Tag bordered={false} color={row.revenueGrowth > 0 ? 'green' : row.revenueGrowth < 0 ? 'red' : undefined}>{signed(row.revenueGrowth)}%</Tag>

    const renderCard = (row: DirectorProgrammeRow) => (
        <button
            type="button"
            className="director-programme-scorecard"
            onClick={() => setSelectedId(row.id)}
            style={{ borderTopColor: row.completion === null ? token.colorBorderSecondary : healthColor(row.completion) }}
        >
            <span className="director-programme-scorecard-head">
                <Typography.Text strong ellipsis>{programmeName(row)}</Typography.Text>
                <Tag bordered={false} color={statusColor(row.status)}>{t(statusLabel(row.status))}</Tag>
            </span>
            <Typography.Text type="secondary" className="director-programme-scorecard-sub">
                {t('{count} SMEs', undefined, { count: row.smes })}
                {dates(row) && <> · <CalendarOutlined /> {dates(row)}</>}
            </Typography.Text>

            <div className="director-programme-scorecard-completion">
                <span>
                    <Typography.Text type="secondary">{t('Completion')}</Typography.Text>
                    <Typography.Text strong>{row.completion === null ? '—' : `${row.completion}%`}</Typography.Text>
                </span>
                <Progress percent={row.completion ?? 0} showInfo={false} size="small" strokeColor={row.completion === null ? undefined : healthColor(row.completion)} />
                <Typography.Text type="secondary">
                    {row.required ? t('{completed} of {required} required', undefined, { completed: row.completed, required: row.required }) : t('Nothing required yet')}
                </Typography.Text>
            </div>

            <div className="director-programme-scorecard-stats">
                <div>
                    <Typography.Text type="secondary">{t('KPIs')}</Typography.Text>
                    {row.kpis.withTarget
                        ? <Tag bordered={false} color={row.kpis.behind ? 'orange' : 'green'}>{t('{onTrack} of {count} on track', undefined, { onTrack: row.kpis.onTrack, count: row.kpis.withTarget })}</Tag>
                        : <Typography.Text type="secondary">{t('No targets set')}</Typography.Text>}
                </div>
                <div>
                    <Typography.Text type="secondary">{t('Revenue growth')}</Typography.Text>
                    <span>
                        {growthTag(row)}
                        {row.smesWithRevenue > 0 && (
                            <Typography.Text type="secondary" className="director-small">
                                {t('{growing} of {count} growing', undefined, { growing: row.growingSmes, count: row.smesWithRevenue })}
                            </Typography.Text>
                        )}
                    </span>
                </div>
            </div>

            {(row.overdue > 0 || row.highRisk > 0) && (
                <span className="director-flags">
                    {row.overdue > 0 && <Tag bordered={false} color="red">{t('{count} overdue', undefined, { count: row.overdue })}</Tag>}
                    {row.highRisk > 0 && <Tag bordered={false} color="orange">{t('{count} high risk', undefined, { count: row.highRisk })}</Tag>}
                </span>
            )}
        </button>
    )

    return (
        <DashboardPage className="director-page director-programs-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<ProjectOutlined />} iconClassName="is-users" label={t('Programmes')} value={metrics.programmes} hint={t('{count} SMEs', undefined, { count: metrics.smes })} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="is-delivery"
                        label={t('Completion')}
                        value={metrics.completion === null ? '—' : `${metrics.completion}%`}
                        hint={metrics.required ? t('{completed} of {required} required interventions', undefined, { completed: metrics.completed, required: metrics.required }) : t('Nothing required yet')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<AimOutlined />}
                        iconClassName="is-attention"
                        label={t('KPIs on track')}
                        value={metrics.withTarget ? `${metrics.onTrack} / ${metrics.withTarget}` : '—'}
                        hint={metrics.withTarget ? t('{count} behind target', undefined, { count: metrics.behind }) : t('No targets set')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<RiseOutlined />}
                        iconClassName="is-participants"
                        label={t('Revenue growth')}
                        value={metrics.growth === null ? '—' : `${signed(metrics.growth)}%`}
                        hint={metrics.withRevenue ? t('{growing} of {count} SMEs growing since joining', undefined, { growing: metrics.growing, count: metrics.withRevenue }) : t('No revenue history yet')}
                    />
                </Col>
            </Row>

            <FilterBar
                compact
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t('Search programmes')} allowClear />
                        <Select
                            value={sortKey}
                            onChange={(value) => { setSortKey(value); setPage(1) }}
                            options={[
                                { value: 'completion', label: t('Sort: completion') },
                                { value: 'kpis', label: t('Sort: KPIs on track') },
                                { value: 'growth', label: t('Sort: revenue growth') },
                                { value: 'smes', label: t('Sort: SMEs') },
                                { value: 'risk', label: t('Sort: high risk') },
                            ]}
                        />
                    </>
                )}
            />

            <Row gutter={[16, 16]}>
                <Col span={24}>
                    <Card
                        loading={pageLoading}
                        className="dashboard-section-card motion-card"
                        title={<Space><AppstoreOutlined /> {t('Programme scorecards')}</Space>}
                        extra={<Typography.Text type="secondary" className="director-hide-mobile">{t('Click a programme for its full breakdown')}</Typography.Text>}
                    >
                        {filtered.length ? (
                            <>
                                <Row gutter={[14, 14]}>
                                    {pagedRows.map((row) => (
                                        <Col xs={24} md={12} xl={8} key={row.id}>
                                            {renderCard(row)}
                                        </Col>
                                    ))}
                                </Row>
                                {filtered.length > PAGE_SIZE && (
                                    <div className="director-pagination">
                                        <Pagination current={page} pageSize={PAGE_SIZE} total={filtered.length} showSizeChanger={false} onChange={setPage} />
                                    </div>
                                )}
                            </>
                        ) : <Empty description={t('No programmes match your search.')} />}
                    </Card>
                </Col>
                {filtered.length > 1 && (
                    <Col span={24}>
                        <Card loading={pageLoading} className="dashboard-section-card motion-card" title={<Space><BarChartOutlined /> {t('Completion and KPIs by programme')}</Space>}>
                            <ThemedHighcharts options={comparisonChart} />
                        </Card>
                    </Col>
                )}
            </Row>

            {/* Desktop modal, bottom sheet on phones. */}
            <ResponsiveModal
                open={!!selected}
                onClose={() => setSelectedId(undefined)}
                width={820}
                title={selected ? (
                    <Space direction="vertical" size={2}>
                        <Space><ProjectOutlined /> {programmeName(selected)}</Space>
                        <Space size={6}>
                            <Tag color={statusColor(selected.status)} style={{ margin: 0 }}>{t(statusLabel(selected.status))}</Tag>
                            {dates(selected) && <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{dates(selected)}</Typography.Text>}
                        </Space>
                    </Space>
                ) : ''}
            >
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<TeamOutlined />} iconClassName="is-users" label={t('SMEs')} value={selected.smes} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<TeamOutlined />} iconClassName="is-participants" label={t('Employees')} value={selected.totalEmployees} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<DollarOutlined />} iconClassName="is-participants" label={t('Revenue')} value={formatCurrency(selected.totalRevenue)} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<CheckCircleOutlined />} iconClassName="is-delivery" label={t('Avg progress')} value={`${selected.avgProgress}%`} /></Col>
                        </Row>
                        <Row gutter={[24, 16]}>
                            <Col xs={24} md={12}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>{t('Intake funnel')}</Typography.Text>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    {[
                                        { label: t('Submitted'), value: selected.submitted, color: CHART_COLORS.slate },
                                        { label: t('Accepted'), value: selected.accepted, color: CHART_COLORS.primary },
                                        { label: t('Active SMEs'), value: selected.smes, color: CHART_COLORS.success },
                                    ].map((step) => (
                                        <div key={step.label}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                                <Typography.Text>{step.label}</Typography.Text>
                                                <Typography.Text strong>{step.value}</Typography.Text>
                                            </div>
                                            <Progress percent={percent(step.value, Math.max(selected.submitted, selected.smes)) ?? 0} showInfo={false} size="small" strokeColor={step.color} />
                                        </div>
                                    ))}
                                </Space>
                            </Col>
                            <Col xs={24} md={12}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>{t('Delivery & risk')}</Typography.Text>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    {[
                                        // Completed against required support, the same figure as the card and the dashboard.
                                        { label: t('Completed ({completed}/{required})', undefined, { completed: selected.completed, required: selected.required }), value: selected.completion ?? 0, color: healthColor(selected.completion ?? 0) },
                                        { label: t('Overdue ({count})', undefined, { count: selected.overdue }), value: percent(selected.overdue, selected.required) ?? 0, color: CHART_COLORS.danger },
                                        { label: t('High risk SMEs ({count})', undefined, { count: selected.highRisk }), value: percent(selected.highRisk, selected.smes) ?? 0, color: CHART_COLORS.danger },
                                        { label: t('Medium risk SMEs ({count})', undefined, { count: selected.mediumRisk }), value: percent(selected.mediumRisk, selected.smes) ?? 0, color: CHART_COLORS.amber },
                                        { label: t('Low risk SMEs ({count})', undefined, { count: selected.lowRisk }), value: percent(selected.lowRisk, selected.smes) ?? 0, color: CHART_COLORS.success },
                                    ].map((step) => (
                                        <div key={step.label}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                                <Typography.Text>{step.label}</Typography.Text>
                                                <Typography.Text strong>{step.value}%</Typography.Text>
                                            </div>
                                            <Progress percent={step.value} showInfo={false} size="small" strokeColor={step.color} />
                                        </div>
                                    ))}
                                </Space>
                            </Col>
                        </Row>
                    </Space>
                )}
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default DirectorProgramsPage
