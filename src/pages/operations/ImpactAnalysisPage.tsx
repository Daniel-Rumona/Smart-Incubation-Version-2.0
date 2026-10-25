import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Card, Col, Empty, Input, Row, Tag, Typography, type TableProps } from 'antd'
import { CheckCircleOutlined, FundOutlined, RiseOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
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
import { BEFORE_AFTER_WINDOW_MONTHS, loadImpactAnalytics, type ImpactAnalytics, type OutcomeBucket, type SmeImpact } from '@/services/impactAnalyticsService'
import { formatCurrencyZAR, formatMetricNumber } from '@/services/smePerformanceMetrics'
import '@/styles/impact-analysis.css'

// Results first (good to bad), then the interventions still waiting on a check-back answer.
const OUTCOME_SERIES: Array<{ key: OutcomeBucket, label: string, color: string }> = [
    { key: 'achieved', label: 'Achieved', color: CHART_COLORS.success },
    { key: 'partially', label: 'Partially', color: CHART_COLORS.amber },
    { key: 'not_yet', label: 'Not yet', color: CHART_COLORS.danger },
    { key: 'checkback_due', label: 'Check-back due', color: CHART_COLORS.primary },
    { key: 'checkback_overdue', label: 'Check-back overdue', color: CHART_COLORS.pink },
    { key: 'no_checkback', label: 'No check-back set', color: CHART_COLORS.slate },
]

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
            // "Achieved" splits into the part the SME also confirmed (darker) and the facilitator-only rest.
            series: [
                { type: 'bar', name: t('Achieved, SME confirmed'), color: '#047857', data: data.areas.map((area) => area.achievedConfirmed) },
                ...OUTCOME_SERIES.map((series) => ({
                    type: 'bar' as const,
                    name: t(series.key === 'achieved' ? 'Achieved, facilitator only' : series.label),
                    color: series.color,
                    data: data.areas.map((area) => (series.key === 'achieved' ? area.achieved - area.achievedConfirmed : area[series.key])),
                })),
            ],
        }
    }, [data, t])

    const beforeAfterChart = useMemo<Highcharts.Options | null>(() => {
        const compared = (data?.smes || []).filter((sme) => sme.beforeAfterChange !== null)
            .sort((left, right) => (right.beforeAfterChange as number) - (left.beforeAfterChange as number))
            .slice(0, 12)
        if (!compared.length) return null
        return {
            chart: { type: 'bar', height: Math.max(200, compared.length * 34 + 70) },
            title: { text: undefined },
            xAxis: { categories: compared.map((sme) => sme.name) },
            yAxis: { title: { text: t('Change in average monthly revenue (%)') }, plotLines: [{ value: 0, width: 1, color: CHART_COLORS.slate }] },
            legend: { enabled: false },
            tooltip: { valueSuffix: '%' },
            plotOptions: { series: { dataLabels: { enabled: true, format: '{y}%' } } },
            series: [{
                type: 'bar',
                name: t('Change'),
                data: compared.map((sme) => ({ y: sme.beforeAfterChange as number, color: (sme.beforeAfterChange as number) >= 0 ? CHART_COLORS.success : CHART_COLORS.danger })),
            }],
        }
    }, [data, t])

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return (data?.smes || []).filter((sme) => !needle || sme.name.toLowerCase().includes(needle))
    }, [data, search])

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

    const noMetrics = !!data && data.smesWithRevenue === 0 && data.smesWithJobs === 0

    return (
        <DashboardPage className="operations-impact-analysis-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<RiseOutlined />}
                        iconClassName="dashboard-icon-green"
                        label={t('Revenue growth')}
                        value={data?.revenueGrowth !== null && data?.revenueGrowth !== undefined ? `${signed(data.revenueGrowth)}%` : '—'}
                        hint={data?.smesWithRevenue ? t('Since joining, across {count} SMEs', undefined, { count: data.smesWithRevenue }) : t('No revenue history yet')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<TeamOutlined />}
                        iconClassName="dashboard-icon-blue"
                        label={t('Jobs created')}
                        value={data?.smesWithJobs ? signed(data.netJobs) : '—'}
                        hint={data?.smesWithJobs ? t('Net change across {count} SMEs', undefined, { count: data.smesWithJobs }) : t('No headcount history yet')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="dashboard-icon-orange"
                        label={t('Outcomes achieved')}
                        value={data?.achievedRate !== null && data?.achievedRate !== undefined ? `${data.achievedRate}%` : '—'}
                        hint={data ? t('Of {count} followed-up interventions', undefined, { count: data.outcomes.achieved + data.outcomes.partially + data.outcomes.not_yet }) : undefined}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<FundOutlined />}
                        iconClassName="dashboard-icon-red"
                        label={t('SMEs growing')}
                        value={data?.smesWithRevenue ? `${data.growingSmes} / ${data.smesWithRevenue}` : '—'}
                        hint={t('Revenue up since joining')}
                    />
                </Col>
            </Row>

            {noMetrics && (
                <Card className="dashboard-section-card motion-card impact-note">
                    <Typography.Text type="secondary">
                        {t('Growth figures appear once SMEs have revenue or headcount recorded for at least two periods. SMEs add these on their metrics page, and operations can add them on the participant’s profile.')}
                    </Typography.Text>
                </Card>
            )}

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Before and after support')}>
                        {data && data.beforeAfter.count ? (
                            <>
                                <div className="impact-headline">
                                    <strong className={(data.beforeAfter.medianChange || 0) >= 0 ? 'is-up' : 'is-down'}>{signed(data.beforeAfter.medianChange || 0)}%</strong>
                                    <span>
                                        {t('Median change in average monthly revenue, {months} months before against {months} months after an SME’s first completed intervention. {improved} of {count} SMEs improved.', undefined, { months: BEFORE_AFTER_WINDOW_MONTHS, improved: data.beforeAfter.improved, count: data.beforeAfter.count })}
                                    </span>
                                </div>
                                {beforeAfterChart && <ThemedHighcharts options={beforeAfterChart} />}
                            </>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Needs monthly revenue on both sides of an SME’s first completed intervention.')} />
                        )}
                    </Card>
                </Col>
                <Col xs={24} xl={12}>
                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Supported and not yet supported')}>
                        {data && data.smesWithRevenue ? (
                            <>
                                <div className="impact-compare">
                                    <div>
                                        <Typography.Text type="secondary">{t('With a completed intervention')}</Typography.Text>
                                        <strong>{data.servedGrowth === null ? '—' : `${signed(data.servedGrowth)}%`}</strong>
                                        <small>{t('{count} SMEs', undefined, { count: data.servedCount })}</small>
                                    </div>
                                    <div>
                                        <Typography.Text type="secondary">{t('None completed yet')}</Typography.Text>
                                        <strong>{data.notServedGrowth === null ? '—' : `${signed(data.notServedGrowth)}%`}</strong>
                                        <small>{t('{count} SMEs', undefined, { count: data.notServedCount })}</small>
                                    </div>
                                </div>
                                <Typography.Text type="secondary" className="impact-footnote">
                                    {t('Median revenue growth since joining. A comparison, not proof of cause: the groups can differ in other ways.')}
                                </Typography.Text>
                            </>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Needs revenue recorded for at least two periods.')} />
                        )}
                    </Card>
                </Col>
                <Col xs={24} xl={16}>
                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Outcomes by area of support')}>
                        {outcomesChart
                            ? <ThemedHighcharts options={outcomesChart} />
                            : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No completed interventions yet.')} />}
                    </Card>
                </Col>
                <Col xs={24} xl={8}>
                    {/* The facilitator check-backs behind the outcome figures: are they being answered, and how? */}
                    <Card loading={pageLoading} className="dashboard-section-card motion-card" title={t('Check-backs')}>
                        {data && (data.checkbacks.answered || data.checkbacks.overdue || data.outcomes.checkback_due) ? (
                            <div className="impact-checkbacks">
                                <div>
                                    <strong>{data.checkbacks.answered}</strong>
                                    <span>{t('Answers recorded')}</span>
                                    <small>{data.checkbacks.answered ? t('{percent}% on WhatsApp', undefined, { percent: Math.round((data.checkbacks.viaWhatsapp / data.checkbacks.answered) * 100) }) : '—'}</small>
                                </div>
                                <div className={data.checkbacks.overdue ? 'is-risk' : undefined}>
                                    <strong>{data.checkbacks.overdue}</strong>
                                    <span>{t('Overdue')}</span>
                                    <small>{t('Waiting on an answer past its date')}</small>
                                </div>
                                <div>
                                    <strong>{data.checkbacks.achievedFirstTime}</strong>
                                    <span>{t('Achieved first time')}</span>
                                    <small>{t('At the first check-back')}</small>
                                </div>
                                <div>
                                    <strong>{data.checkbacks.achievedAfterRecheck}</strong>
                                    <span>{t('Achieved after a re-check')}</span>
                                    <small>{t('Needed more than one check-back')}</small>
                                </div>
                                {/* The SME's side: how many rounds they answered, and how often they agreed with the facilitator. */}
                                <div>
                                    <strong>{data.smeCheckbacks.answered}</strong>
                                    <span>{t('SME answers')}</span>
                                    <small>{t('For {rounds} facilitator rounds', undefined, { rounds: data.smeCheckbacks.facilitatorRounds })}</small>
                                </div>
                                <div>
                                    <strong>{data.smeCheckbacks.agreementRate === null ? '—' : `${data.smeCheckbacks.agreementRate}%`}</strong>
                                    <span>{t('Agreement')}</span>
                                    <small>{data.smeCheckbacks.pairs ? t('{agreed} of {pairs} rounds both answered', undefined, { agreed: data.smeCheckbacks.agreed, pairs: data.smeCheckbacks.pairs }) : t('No rounds both answered yet')}</small>
                                </div>
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No check-backs yet. They start once an intervention with an outcome is completed.')} />
                        )}
                        <Typography.Text type="secondary" className="impact-footnote">
                            {t('Facilitators record the official result; SMEs answer the same question for themselves, in the app or on WhatsApp.')}
                        </Typography.Text>
                    </Card>
                </Col>
                {!!data?.smeCheckbacks.disputes.length && (
                    <Col span={24}>
                        {/* Achieved by the facilitator, but the SME said No for the same round: worth a conversation. */}
                        <Card className="dashboard-section-card motion-card" title={t('Disputed outcomes')}>
                            <div className="impact-disputes">
                                {data.smeCheckbacks.disputes.map((dispute) => (
                                    <div key={dispute.id}>
                                        <Typography.Text strong>{dispute.title}</Typography.Text>
                                        <Typography.Text type="secondary">{dispute.smeName}</Typography.Text>
                                        <Typography.Text>{t('Facilitator: Achieved · SME: No')}</Typography.Text>
                                        {dispute.note && <Typography.Text type="secondary" italic>“{dispute.note}”</Typography.Text>}
                                    </div>
                                ))}
                            </div>
                        </Card>
                    </Col>
                )}
            </Row>

            <FilterBar compact primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search SMEs')} allowClear />} />
            <Card className="dashboard-section-card motion-card" title={t('Impact by SME')}>
                <ResponsiveDataView<SmeImpact>
                    rowKey="id"
                    rows={rows}
                    columns={columns}
                    loading={pageLoading}
                    emptyText={t('No SMEs in this programme yet.')}
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
                            </dl>
                        </div>
                    )}
                />
            </Card>
        </DashboardPage>
    )
}
