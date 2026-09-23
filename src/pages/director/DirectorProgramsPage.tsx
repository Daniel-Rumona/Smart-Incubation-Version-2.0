import { useEffect, useMemo, useState } from 'react'
import { App, Card, Col, Empty, Input, Modal, Pagination, Progress, Row, Segmented, Select, Space, Tag, Typography, theme } from 'antd'
import {
    AppstoreOutlined,
    BarChartOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    DollarOutlined,
    ExclamationCircleOutlined,
    ProjectOutlined,
    SearchOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { listDirectorProgramPerformance } from '@/services/directorProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import type { DirectorProgramPerformance } from '@/types/director'
import '@/styles/dashboard.css'
import '@/styles/director.css'

type SortKey = 'smes' | 'progress' | 'delivery' | 'revenue' | 'risk'
type ChartView = 'delivery' | 'risk' | 'funnel'

const PAGE_SIZE = 6

const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0, notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard' }).format(value || 0)

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.round((numerator / denominator) * 100) : 0)

const deliveryRate = (row: DirectorProgramPerformance) => percent(row.completedAssignments, row.assignments)

const statusColor = (status: string) => {
    const normalized = status.toLowerCase()
    if (normalized.includes('inactive') || normalized.includes('closed')) return 'default'
    if (normalized.includes('draft') || normalized.includes('pending')) return 'orange'
    return 'green'
}

const healthColor = (value: number) => (value >= 75 ? CHART_COLORS.success : value >= 40 ? CHART_COLORS.amber : CHART_COLORS.danger)

const RiskMixBar = ({ low, medium, high }: { low: number, medium: number, high: number }) => {
    const total = low + medium + high
    if (!total) return <Typography.Text type="secondary" style={{ fontSize: 12 }}>No SME risk data</Typography.Text>
    const segments = [
        { key: 'low', value: low, color: CHART_COLORS.success },
        { key: 'medium', value: medium, color: CHART_COLORS.amber },
        { key: 'high', value: high, color: CHART_COLORS.danger },
    ].filter((segment) => segment.value > 0)
    return (
        <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
            {segments.map((segment) => (
                <div key={segment.key} style={{ flex: segment.value, background: segment.color }} title={`${segment.key}: ${segment.value}`} />
            ))}
        </div>
    )
}

const ProgramCard = ({ row, onClick }: { row: DirectorProgramPerformance, onClick: () => void }) => {
    const { token } = theme.useToken()
    const delivery = deliveryRate(row)
    const accent = healthColor(row.avgProgress)
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                height: '100%',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                padding: 16,
                borderRadius: 16,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderTop: `3px solid ${accent}`,
                background: token.colorBgContainer,
                boxShadow: token.boxShadowTertiary,
                cursor: 'pointer',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <Progress type="circle" size={64} percent={row.avgProgress} strokeColor={accent} format={(value) => `${value}%`} />
                <div style={{ minWidth: 0, flex: 1 }}>
                    <Typography.Text strong ellipsis style={{ display: 'block', fontSize: 15 }}>{row.name}</Typography.Text>
                    <Space size={6} wrap style={{ marginTop: 4 }}>
                        <Tag color={statusColor(row.status)} style={{ margin: 0 }}>{row.status.toUpperCase()}</Tag>
                        {row.startDate && <Typography.Text type="secondary" style={{ fontSize: 12 }}><CalendarOutlined /> {row.startDate}</Typography.Text>}
                    </Space>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                    { label: 'SMEs', value: row.smes.toLocaleString() },
                    { label: 'Employees', value: row.totalEmployees.toLocaleString() },
                    { label: 'Revenue', value: formatCurrency(row.totalRevenue) },
                ].map((stat) => (
                    <div key={stat.label} style={{ padding: '8px 10px', borderRadius: 10, background: token.colorFillQuaternary }}>
                        <Typography.Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{stat.label}</Typography.Text>
                        <Typography.Text strong style={{ fontSize: 14 }}>{stat.value}</Typography.Text>
                    </div>
                ))}
            </div>

            <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                    <Typography.Text type="secondary">Delivery ({row.completedAssignments}/{row.assignments})</Typography.Text>
                    <Typography.Text strong>{delivery}%</Typography.Text>
                </div>
                <Progress percent={delivery} showInfo={false} size="small" strokeColor={healthColor(delivery)} />
            </div>

            <div>
                <RiskMixBar low={row.lowRisk} medium={row.mediumRisk} high={row.highRisk} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.highRisk} high · {row.mediumRisk} medium · {row.lowRisk} low</Typography.Text>
                    {row.overdueAssignments > 0 && <Tag color="orange" style={{ margin: 0 }}>{row.overdueAssignments} overdue</Tag>}
                </div>
            </div>
        </button>
    )
}

export const DirectorProgramsPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [rows, setRows] = useState<DirectorProgramPerformance[]>([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('all')
    const [sortKey, setSortKey] = useState<SortKey>('smes')
    const [chartView, setChartView] = useState<ChartView>('delivery')
    const [page, setPage] = useState(1)
    const [selectedId, setSelectedId] = useState<string>()

    useEffect(() => {
        let mounted = true
        const load = async () => {
            if (!user) return
            setLoading(true)
            try {
                const data = await listDirectorProgramPerformance(user, activeProgramId)
                if (mounted) setRows(data)
            } catch (error) {
                console.error(error)
                message.error(t('director.programs.loadError', 'Program performance could not be loaded.'))
                if (mounted) setRows([])
            } finally {
                if (mounted) setLoading(false)
            }
        }
        void load()
        return () => { mounted = false }
    }, [activeProgramId, message, t, user])

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        const matches = rows.filter((row) => {
            const matchText = !term || row.name.toLowerCase().includes(term) || row.status.toLowerCase().includes(term)
            const matchStatus = status === 'all' || row.status.toLowerCase() === status
            return matchText && matchStatus
        })
        const score: Record<SortKey, (row: DirectorProgramPerformance) => number> = {
            smes: (row) => row.smes,
            progress: (row) => row.avgProgress,
            delivery: (row) => deliveryRate(row),
            revenue: (row) => row.totalRevenue,
            risk: (row) => row.highRisk,
        }
        return [...matches].sort((left, right) => score[sortKey](right) - score[sortKey](left))
    }, [rows, search, sortKey, status])

    useEffect(() => { setPage(1) }, [search, status, sortKey])

    const pagedRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

    const metrics = useMemo(() => {
        const smes = filtered.reduce((sum, row) => sum + row.smes, 0)
        const assignments = filtered.reduce((sum, row) => sum + row.assignments, 0)
        const completed = filtered.reduce((sum, row) => sum + row.completedAssignments, 0)
        return {
            programs: filtered.length,
            smes,
            employees: filtered.reduce((sum, row) => sum + row.totalEmployees, 0),
            revenue: filtered.reduce((sum, row) => sum + row.totalRevenue, 0),
            avgProgress: smes ? Math.round(filtered.reduce((sum, row) => sum + row.avgProgress * row.smes, 0) / smes) : 0,
            completionRate: percent(completed, assignments),
            overdue: filtered.reduce((sum, row) => sum + row.overdueAssignments, 0),
        }
    }, [filtered])

    useRegisterAgentPageContext({
        pageKey: 'director-programs',
        pageName: t('director.programs.title', 'Program Performance'),
        purpose: 'Shows director-level performance across the active program selection.',
        currentFilters: { search, status, sortKey, activeProgramId },
        metrics,
        dataSummary: { visiblePrograms: filtered.length, scope: isAllPrograms ? 'all programs' : 'selected program' },
    })

    const selected = useMemo(() => rows.find((row) => row.id === selectedId) || null, [rows, selectedId])

    const chartOptions = useMemo<Highcharts.Options>(() => {
        const categories = filtered.map((row) => row.name)
        if (chartView === 'risk') {
            return {
                chart: { type: 'bar', height: Math.max(280, filtered.length * 46) },
                title: { text: undefined },
                xAxis: { categories },
                yAxis: { min: 0, title: { text: 'Share of SMEs' }, labels: { format: '{value}%' } },
                tooltip: { shared: true },
                plotOptions: { series: { stacking: 'percent', borderRadius: 3, dataLabels: { enabled: true, filter: { property: 'y', operator: '>', value: 0 } } } },
                series: [
                    { type: 'bar', name: 'Low', color: CHART_COLORS.success, data: filtered.map((row) => row.lowRisk) },
                    { type: 'bar', name: 'Medium', color: CHART_COLORS.amber, data: filtered.map((row) => row.mediumRisk) },
                    { type: 'bar', name: 'High', color: CHART_COLORS.danger, data: filtered.map((row) => row.highRisk) },
                ],
            }
        }
        if (chartView === 'funnel') {
            return {
                chart: { type: 'column', height: 320 },
                title: { text: undefined },
                xAxis: { categories },
                yAxis: { min: 0, allowDecimals: false, title: { text: 'Count' } },
                tooltip: { shared: true },
                plotOptions: { column: { borderRadius: 4, dataLabels: { enabled: true } } },
                series: [
                    { type: 'column', name: 'Submitted', color: CHART_COLORS.slate, data: filtered.map((row) => row.submitted) },
                    { type: 'column', name: 'Accepted', color: CHART_COLORS.primary, data: filtered.map((row) => row.accepted) },
                    { type: 'column', name: 'Active SMEs', color: CHART_COLORS.success, data: filtered.map((row) => row.smes) },
                ],
            }
        }
        return {
            chart: { height: 320 },
            title: { text: undefined },
            xAxis: { categories },
            yAxis: [
                { min: 0, max: 100, title: { text: 'Rate' }, labels: { format: '{value}%' } },
                { min: 0, title: { text: 'Revenue' }, opposite: true, labels: { formatter() { return formatCurrency(Number(this.value)) } } },
            ],
            tooltip: { shared: true },
            plotOptions: { column: { borderRadius: 4 }, spline: { marker: { enabled: true } } },
            series: [
                { type: 'column', name: 'Revenue', yAxis: 1, color: CHART_COLORS.violet, opacity: 0.55, data: filtered.map((row) => row.totalRevenue), tooltip: { valuePrefix: 'R ' } },
                { type: 'spline', name: 'Avg progress', yAxis: 0, color: CHART_COLORS.primary, data: filtered.map((row) => row.avgProgress), tooltip: { valueSuffix: '%' } },
                { type: 'spline', name: 'Delivery rate', yAxis: 0, color: CHART_COLORS.success, data: filtered.map((row) => deliveryRate(row)), tooltip: { valueSuffix: '%' } },
            ],
        }
    }, [chartView, filtered])

    const statusOptions = useMemo(
        () => [{ value: 'all', label: t('common.all', 'All') }, ...Array.from(new Set(rows.map((row) => row.status.toLowerCase()))).map((value) => ({ value, label: value.toUpperCase() }))],
        [rows, t],
    )

    return (
        <DashboardPage className="director-page director-programs-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<ProjectOutlined />} iconClassName="is-users" label={t('director.programs.programs', 'Programs')} value={metrics.programs} /></Col>
                <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} iconClassName="is-participants" label={t('director.programs.smes', 'SMEs')} value={metrics.smes} hint={`${metrics.employees.toLocaleString()} employees`} /></Col>
                <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<DollarOutlined />} iconClassName="is-participants" label="Revenue" value={formatCurrency(metrics.revenue)} /></Col>
                <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} iconClassName="is-delivery" label="Delivery rate" value={`${metrics.completionRate}%`} hint={`${metrics.avgProgress}% avg progress`} /></Col>
                {(loading || metrics.overdue > 0) && (
                    <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<ExclamationCircleOutlined />} iconClassName="is-attention" label={t('director.programs.overdue', 'Overdue')} value={metrics.overdue} /></Col>
                )}
            </Row>

            <FilterBar
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('director.programs.search', 'Search programs')} allowClear />
                        <Select value={status} onChange={setStatus} options={statusOptions} />
                        <Select
                            value={sortKey}
                            onChange={setSortKey}
                            options={[
                                { value: 'smes', label: 'Sort: SMEs' },
                                { value: 'progress', label: 'Sort: Progress' },
                                { value: 'delivery', label: 'Sort: Delivery rate' },
                                { value: 'revenue', label: 'Sort: Revenue' },
                                { value: 'risk', label: 'Sort: High risk' },
                            ]}
                        />
                    </>
                )}
            />

            <Row gutter={[16, 16]}>
                <Col span={24}>
                    <Card
                        loading={loading}
                        className="dashboard-section-card motion-card"
                        title={<Space><AppstoreOutlined /> Program Scorecards</Space>}
                        extra={<Typography.Text type="secondary">Click a program for its full breakdown</Typography.Text>}
                    >
                        {filtered.length ? (
                            <>
                                <Row gutter={[14, 14]}>
                                    {pagedRows.map((row) => (
                                        <Col xs={24} md={12} xl={8} key={row.id}>
                                            <ProgramCard row={row} onClick={() => setSelectedId(row.id)} />
                                        </Col>
                                    ))}
                                </Row>
                                {filtered.length > PAGE_SIZE && (
                                    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                                        <Pagination current={page} pageSize={PAGE_SIZE} total={filtered.length} showSizeChanger={false} onChange={setPage} />
                                    </div>
                                )}
                            </>
                        ) : <Empty description={t('director.programs.empty', 'No programs match the current filters.')} />}
                    </Card>
                </Col>
                <Col span={24}>
                    <Card
                        loading={loading}
                        className="dashboard-section-card motion-card"
                        title={<Space><BarChartOutlined /> Comparison</Space>}
                        extra={(
                            <Segmented<ChartView>
                                value={chartView}
                                onChange={setChartView}
                                options={[
                                    { label: 'Delivery & Revenue', value: 'delivery', icon: <CheckCircleOutlined /> },
                                    { label: 'Risk Mix', value: 'risk', icon: <ExclamationCircleOutlined /> },
                                    { label: 'Intake Funnel', value: 'funnel', icon: <TeamOutlined /> },
                                ]}
                            />
                        )}
                    >
                        {filtered.length ? <ThemedHighcharts options={chartOptions} /> : <Empty description={t('director.programs.empty', 'No programs match the current filters.')} />}
                    </Card>
                </Col>
            </Row>

            <Modal
                open={!!selected}
                onCancel={() => setSelectedId(undefined)}
                footer={null}
                width={820}
                destroyOnClose
                title={selected ? (
                    <Space direction="vertical" size={2}>
                        <Space><ProjectOutlined /> {selected.name}</Space>
                        <Space size={6}>
                            <Tag color={statusColor(selected.status)} style={{ margin: 0 }}>{selected.status.toUpperCase()}</Tag>
                            {(selected.startDate || selected.endDate) && <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>{selected.startDate || '—'} to {selected.endDate || 'ongoing'}</Typography.Text>}
                        </Space>
                    </Space>
                ) : ''}
            >
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<TeamOutlined />} iconClassName="is-users" label="SMEs" value={selected.smes} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<TeamOutlined />} iconClassName="is-participants" label="Employees" value={selected.totalEmployees} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<DollarOutlined />} iconClassName="is-participants" label="Revenue" value={formatCurrency(selected.totalRevenue)} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard icon={<CheckCircleOutlined />} iconClassName="is-delivery" label="Avg progress" value={`${selected.avgProgress}%`} /></Col>
                        </Row>
                        <Row gutter={[24, 16]}>
                            <Col xs={24} md={12}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>Intake funnel</Typography.Text>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    {[
                                        { label: 'Submitted', value: selected.submitted, color: CHART_COLORS.slate },
                                        { label: 'Accepted', value: selected.accepted, color: CHART_COLORS.primary },
                                        { label: 'Active SMEs', value: selected.smes, color: CHART_COLORS.success },
                                    ].map((step) => (
                                        <div key={step.label}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                                <Typography.Text>{step.label}</Typography.Text>
                                                <Typography.Text strong>{step.value}</Typography.Text>
                                            </div>
                                            <Progress percent={percent(step.value, Math.max(selected.submitted, selected.smes))} showInfo={false} size="small" strokeColor={step.color} />
                                        </div>
                                    ))}
                                </Space>
                            </Col>
                            <Col xs={24} md={12}>
                                <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>Delivery & risk</Typography.Text>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                    {[
                                        { label: `Completed (${selected.completedAssignments}/${selected.assignments})`, value: deliveryRate(selected), color: healthColor(deliveryRate(selected)) },
                                        { label: `Overdue (${selected.overdueAssignments})`, value: percent(selected.overdueAssignments, selected.assignments), color: CHART_COLORS.danger },
                                        { label: `High risk SMEs (${selected.highRisk})`, value: percent(selected.highRisk, selected.smes), color: CHART_COLORS.danger },
                                        { label: `Medium risk SMEs (${selected.mediumRisk})`, value: percent(selected.mediumRisk, selected.smes), color: CHART_COLORS.amber },
                                        { label: `Low risk SMEs (${selected.lowRisk})`, value: percent(selected.lowRisk, selected.smes), color: CHART_COLORS.success },
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
            </Modal>
        </DashboardPage>
    )
}

export default DirectorProgramsPage
