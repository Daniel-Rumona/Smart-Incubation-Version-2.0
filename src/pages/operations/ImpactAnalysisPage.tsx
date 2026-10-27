import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Card, Col, Input, Row, Select, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { CheckCircleOutlined, CloseOutlined, InfoCircleOutlined, RiseOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import type Highcharts from 'highcharts'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { BEFORE_AFTER_WINDOW_MONTHS, loadImpactAnalytics, type ImpactAnalytics, type SmeImpact } from '@/services/impactAnalyticsService'
import { formatCurrencyZAR, formatMetricNumber } from '@/services/smePerformanceMetrics'
import '@/styles/impact-analysis.css'

// Below this many SMEs a median says little, so the headline figure is left out.
const MIN_SMES_FOR_MEDIAN = 5

// Revenue change after support, grouped into bands so the chart reads the same for 8 SMEs or 800.
type BandKey = 'down_big' | 'down' | 'flat' | 'up' | 'up_big'
const BANDS: Array<{ key: BandKey, label: string, color: string, matches: (change: number) => boolean }> = [
    { key: 'down_big', label: 'Down more than 20%', color: CHART_COLORS.danger, matches: (change) => change < -20 },
    { key: 'down', label: 'Down 5–20%', color: '#f87171', matches: (change) => change >= -20 && change < -5 },
    { key: 'flat', label: 'About the same', color: CHART_COLORS.slate, matches: (change) => change >= -5 && change <= 5 },
    { key: 'up', label: 'Up 5–20%', color: '#34d399', matches: (change) => change > 5 && change <= 20 },
    { key: 'up_big', label: 'Up more than 20%', color: CHART_COLORS.success, matches: (change) => change > 20 },
]
const bandOf = (change: number) => BANDS.find((band) => band.matches(change))?.key

type SortKey = 'name' | 'gains' | 'drops'

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`

/** A green, red or neutral tag for a percentage change. */
const ChangeTag = ({ value }: { value: number | null }) => {
    if (value === null) return <Typography.Text type="secondary">—</Typography.Text>
    return <Tag color={value > 0 ? 'green' : value < 0 ? 'red' : undefined} bordered={false}>{signed(value)}%</Tag>
}

export default function ImpactAnalysisPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [data, setData] = useState<ImpactAnalytics | null>(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [band, setBand] = useState<BandKey | null>(null)
    const [sort, setSort] = useState<SortKey>('name')

    const load = useCallback(async () => {
        if (identityLoading || !user) return
        setLoading(true)
        try {
            setData(await loadImpactAnalytics(user, { activeProgramId, isAllPrograms }))
        } catch (error) {
            console.error('[IMPACT] Failed to load impact analytics:', error)
            message.error(t('Impact analytics could not be loaded.'))
            setData(null)
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, identityLoading, isAllPrograms, message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const pageLoading = identityLoading || loading

    const outcomesChart = useMemo<Highcharts.Options | null>(() => {
        if (!data?.areas.length) return null
        return {
            chart: { type: 'bar', height: Math.max(220, data.areas.length * 44 + 90) },
            title: { text: undefined },
            xAxis: { categories: data.areas.map((area) => area.area) },
            yAxis: { min: 0, allowDecimals: false, title: { text: t('Completed interventions') }, reversedStacks: false },
            legend: { enabled: true },
            tooltip: { shared: true },
            plotOptions: { series: { stacking: 'normal' } },
            // Results only; anything still waiting on a check-back is one grey "Awaiting result" bar.
            series: [
                { type: 'bar', name: t('Achieved, SME confirmed'), color: '#047857', data: data.areas.map((area) => area.achievedConfirmed) },
                { type: 'bar', name: t('Achieved, facilitator only'), color: CHART_COLORS.success, data: data.areas.map((area) => area.achieved - area.achievedConfirmed) },
                { type: 'bar', name: t('Partially'), color: CHART_COLORS.amber, data: data.areas.map((area) => area.partially) },
                { type: 'bar', name: t('Not yet'), color: CHART_COLORS.danger, data: data.areas.map((area) => area.not_yet) },
                { type: 'bar', name: t('Awaiting result'), color: CHART_COLORS.slate, data: data.areas.map((area) => area.checkback_due + area.checkback_overdue + area.no_checkback) },
            ],
        }
    }, [data, t])

    const bandCounts = useMemo(() => {
        const counts: Record<BandKey, number> = { down_big: 0, down: 0, flat: 0, up: 0, up_big: 0 }
        ;(data?.smes || []).forEach((sme) => {
            const key = sme.beforeAfterChange === null ? undefined : bandOf(sme.beforeAfterChange)
            if (key) counts[key] += 1
        })
        return counts
    }, [data])

    const beforeAfterChart = useMemo<Highcharts.Options | null>(() => {
        if (!data?.beforeAfter.count) return null
        return {
            chart: { type: 'column', height: 260 },
            title: { text: undefined },
            xAxis: { categories: BANDS.map((item) => t(item.label)) },
            yAxis: { min: 0, allowDecimals: false, title: { text: t('SMEs') } },
            legend: { enabled: false },
            tooltip: { pointFormat: `<b>{point.y}</b> ${t('SMEs')}` },
            plotOptions: {
                column: { cursor: 'pointer', borderRadius: 4, dataLabels: { enabled: true } },
                series: {
                    point: {
                        // Clicking a band filters the SME table to it; clicking it again clears the filter.
                        events: { click(this: Highcharts.Point) { const key = BANDS[this.index]?.key; if (key) setBand((current) => (current === key ? null : key)) } },
                    },
                },
            },
            series: [{
                type: 'column',
                name: t('SMEs'),
                data: BANDS.map((item) => ({
                    y: bandCounts[item.key],
                    color: item.color,
                    opacity: band && band !== item.key ? 0.35 : 1,
                })),
            }],
        }
    }, [band, bandCounts, data, t])

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        const filtered = (data?.smes || []).filter((sme) =>
            (!needle || sme.name.toLowerCase().includes(needle))
            && (!band || (sme.beforeAfterChange !== null && bandOf(sme.beforeAfterChange) === band)))
        if (sort === 'name') return filtered
        // SMEs without a before-and-after figure go last either way.
        const direction = sort === 'gains' ? -1 : 1
        return [...filtered].sort((left, right) => {
            if (left.beforeAfterChange === null) return right.beforeAfterChange === null ? 0 : 1
            if (right.beforeAfterChange === null) return -1
            return (left.beforeAfterChange - right.beforeAfterChange) * direction
        })
    }, [band, data, search, sort])

    const revenueCell = (sme: SmeImpact) => sme.revenueLatest === null
        ? <Typography.Text type="secondary">{t('Not recorded')}</Typography.Text>
        : (
            <span className="impact-change">
                <span>{sme.revenueStart !== null ? `${formatCurrencyZAR(sme.revenueStart)} → ` : ''}{formatCurrencyZAR(sme.revenueLatest)}</span>
                <ChangeTag value={sme.revenueChange} />
            </span>
        )
    const jobsCell = (sme: SmeImpact) => sme.jobsLatest === null
        ? <Typography.Text type="secondary">{t('Not recorded')}</Typography.Text>
        : (
            <span className="impact-change">
                <span>{sme.jobsStart !== null ? `${formatMetricNumber(sme.jobsStart)} → ` : ''}{formatMetricNumber(sme.jobsLatest)}</span>
                {sme.jobsChange !== null && <Tag color={sme.jobsChange > 0 ? 'green' : sme.jobsChange < 0 ? 'red' : undefined} bordered={false}>{signed(sme.jobsChange)}</Tag>}
            </span>
        )
    const outcomesCell = (sme: SmeImpact) => sme.outcomesRecorded
        ? t('{achieved} of {recorded} achieved', undefined, { achieved: sme.outcomesAchieved, recorded: sme.outcomesRecorded })
        : <Typography.Text type="secondary">{sme.completedInterventions ? t('Awaiting follow-up') : '—'}</Typography.Text>

    const columns: TableProps<SmeImpact>['columns'] = [
        { title: t('SME'), dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
        { title: t('Revenue'), key: 'revenue', render: (_, sme) => revenueCell(sme) },
        { title: t('Employees'), key: 'jobs', render: (_, sme) => jobsCell(sme) },
        { title: t('Completed'), dataIndex: 'completedInterventions', width: 110, align: 'center' },
        { title: t('Outcomes'), key: 'outcomes', width: 150, render: (_, sme) => outcomesCell(sme) },
        { title: t('Before → after'), key: 'beforeAfter', width: 130, align: 'center', render: (_, sme) => <ChangeTag value={sme.beforeAfterChange} /> },
    ]

    const followedUp = data ? data.outcomes.achieved + data.outcomes.partially + data.outcomes.not_yet : 0
    const outcomesHint = !data
        ? undefined
        : data.outcomes.achieved
            ? t('{confirmed} of {achieved} confirmed by the SME', undefined, { confirmed: data.smeCheckbacks.confirmedAchieved, achieved: data.outcomes.achieved })
            : t('Of {count} followed-up interventions', undefined, { count: followedUp })

    // Sections without enough data are left out; one note says what will appear and when.
    const missing = data && !pageLoading
        ? [
            data.smesWithRevenue === 0 && data.smesWithJobs === 0 && t('Growth figures appear once SMEs have revenue or headcount recorded for two periods. SMEs add these on their metrics page.'),
            !data.areas.length && t('Outcomes by area appear once interventions are completed.'),
            !data.beforeAfter.count && t('Before and after support appears once SMEs have monthly revenue on both sides of their first completed intervention.'),
        ].filter((line): line is string => Boolean(line))
        : []

    const showOutcomes = pageLoading || !!outcomesChart
    const showBeforeAfter = pageLoading || !!beforeAfterChart
    const bandLabel = band ? BANDS.find((item) => item.key === band)?.label : undefined

    return (
        <DashboardPage className="operations-impact-analysis-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={24} md={8}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<RiseOutlined />}
                        iconClassName="dashboard-icon-green"
                        label={t('Revenue growth')}
                        value={data?.revenueGrowth !== null && data?.revenueGrowth !== undefined ? `${signed(data.revenueGrowth)}%` : '—'}
                        hint={data?.smesWithRevenue
                            ? t('{growing} of {count} SMEs growing since joining', undefined, { growing: data.growingSmes, count: data.smesWithRevenue })
                            : t('No revenue history yet')}
                    />
                </Col>
                <Col xs={12} md={8}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<TeamOutlined />}
                        iconClassName="dashboard-icon-blue"
                        label={t('Jobs created')}
                        value={data?.smesWithJobs ? signed(data.netJobs) : '—'}
                        hint={data?.smesWithJobs ? t('Net change across {count} SMEs', undefined, { count: data.smesWithJobs }) : t('No headcount history yet')}
                    />
                </Col>
                <Col xs={12} md={8}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="dashboard-icon-orange"
                        label={t('Outcomes achieved')}
                        value={data?.achievedRate !== null && data?.achievedRate !== undefined ? `${data.achievedRate}%` : '—'}
                        hint={outcomesHint}
                    />
                </Col>
            </Row>

            {missing.length > 0 && (
                <Card className="dashboard-section-card motion-card impact-note">
                    {missing.map((line) => <Typography.Paragraph key={line} type="secondary">{line}</Typography.Paragraph>)}
                </Card>
            )}

            <Row gutter={[16, 16]}>
                {showOutcomes && (
                    <Col span={24}>
                        <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Outcomes by area of support')}>
                            {outcomesChart && <ThemedHighcharts options={outcomesChart} />}
                        </Card>
                    </Col>
                )}
                {showBeforeAfter && (
                    <Col span={24}>
                        <Card
                            loading={pageLoading}
                            className="dashboard-section-card motion-card"
                            title={(
                                <span className="impact-card-title">
                                    {t('Before and after support')}
                                    <Tooltip title={t('Change in average monthly revenue: {months} months before against {months} months after each SME’s first completed intervention.', undefined, { months: BEFORE_AFTER_WINDOW_MONTHS })}>
                                        <InfoCircleOutlined />
                                    </Tooltip>
                                </span>
                            )}
                        >
                            {data && beforeAfterChart && (
                                <>
                                    <div className="impact-headline">
                                        {data.beforeAfter.count >= MIN_SMES_FOR_MEDIAN && (
                                            <strong className={(data.beforeAfter.medianChange || 0) >= 0 ? 'is-up' : 'is-down'}>{signed(data.beforeAfter.medianChange || 0)}%</strong>
                                        )}
                                        <span>
                                            {data.beforeAfter.count >= MIN_SMES_FOR_MEDIAN
                                                ? t('Median revenue change after support. {improved} of {count} SMEs improved.', undefined, { improved: data.beforeAfter.improved, count: data.beforeAfter.count })
                                                : t('Only {count} SMEs have enough data so far, too few for a reliable median.', undefined, { count: data.beforeAfter.count })}
                                            {' '}
                                            {t('Based on {count} of {total} SMEs.', undefined, { count: data.beforeAfter.count, total: data.totalSmes })}
                                        </span>
                                    </div>
                                    <ThemedHighcharts options={beforeAfterChart} />
                                    <Typography.Text type="secondary" className="impact-footnote">{t('Click a bar to see those SMEs in the table below.')}</Typography.Text>
                                    {data.servedGrowth !== null && data.notServedGrowth !== null && (
                                        <div className="impact-compare-line">
                                            {t('SMEs with completed support grew {served}% since joining; those not yet supported grew {notServed}%.', undefined, { served: signed(data.servedGrowth), notServed: signed(data.notServedGrowth) })}
                                            {' '}
                                            <Typography.Text type="secondary">{t('A comparison, not proof of cause.')}</Typography.Text>
                                        </div>
                                    )}
                                </>
                            )}
                        </Card>
                    </Col>
                )}
            </Row>

            <FilterBar
                compact
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search SMEs')} allowClear />
                        <Select
                            value={sort}
                            onChange={setSort}
                            options={[
                                { value: 'name', label: t('Sort: name') },
                                { value: 'gains', label: t('Sort: biggest gains') },
                                { value: 'drops', label: t('Sort: biggest drops') },
                            ]}
                        />
                        {bandLabel && (
                            <Tag className="impact-band-filter" closable closeIcon={<CloseOutlined />} onClose={() => setBand(null)}>
                                {t('Before → after')}: {t(bandLabel)}
                            </Tag>
                        )}
                    </>
                )}
            />
            <Card className="dashboard-section-card motion-card" title={t('Impact by SME')}>
                <ResponsiveDataView<SmeImpact>
                    rowKey="id"
                    rows={rows}
                    columns={columns}
                    loading={pageLoading}
                    emptyText={band ? t('No SMEs in this band.') : t('No SMEs in this programme yet.')}
                    renderCard={(sme) => (
                        <div className="impact-sme-card">
                            <span className="impact-sme-head">
                                <Typography.Text strong>{sme.name}</Typography.Text>
                                <ChangeTag value={sme.revenueChange} />
                            </span>
                            <dl>
                                <dt>{t('Revenue')}</dt><dd>{revenueCell(sme)}</dd>
                                <dt>{t('Employees')}</dt><dd>{jobsCell(sme)}</dd>
                                <dt>{t('Completed')}</dt><dd>{sme.completedInterventions}</dd>
                                <dt>{t('Outcomes')}</dt><dd>{outcomesCell(sme)}</dd>
                                <dt>{t('Before → after')}</dt><dd><ChangeTag value={sme.beforeAfterChange} /></dd>
                            </dl>
                        </div>
                    )}
                />
            </Card>
        </DashboardPage>
    )
}
