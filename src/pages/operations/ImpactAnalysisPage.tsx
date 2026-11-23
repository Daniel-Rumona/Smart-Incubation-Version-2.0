import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Col, Empty, Input, InputNumber, Row, Segmented, Select, Space, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { CarryOutOutlined, CheckCircleOutlined, CloseOutlined, InfoCircleOutlined, RiseOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
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
import MatchedImpactPanel from '@/components/interventions/MatchedImpactPanel'

// Below this many SMEs a median says little, so the headline figure is left out.
const MIN_SMES_FOR_MEDIAN = 5

type Metric = 'revenue' | 'jobs'

// Change after support, grouped into bands so the chart reads the same for 8 SMEs or 800. Revenue bands are a
// percentage; jobs bands count people, since most SMEs are small and 2 → 3 staff would read as "+50%".
type Band = { key: string, label: string, color: string, matches: (change: number) => boolean }
const BANDS: Record<Metric, Band[]> = {
    revenue: [
        { key: 'down_big', label: 'Down more than 20%', color: CHART_COLORS.danger, matches: (change) => change < -20 },
        { key: 'down', label: 'Down 5–20%', color: '#f87171', matches: (change) => change >= -20 && change < -5 },
        { key: 'flat', label: 'About the same', color: CHART_COLORS.slate, matches: (change) => change >= -5 && change <= 5 },
        { key: 'up', label: 'Up 5–20%', color: '#34d399', matches: (change) => change > 5 && change <= 20 },
        { key: 'up_big', label: 'Up more than 20%', color: CHART_COLORS.success, matches: (change) => change > 20 },
    ],
    jobs: [
        { key: 'lost', label: 'Lost jobs', color: CHART_COLORS.danger, matches: (change) => change < 0 },
        { key: 'none', label: 'No change', color: CHART_COLORS.slate, matches: (change) => change === 0 },
        { key: 'small', label: '+1 to 2', color: '#6ee7b7', matches: (change) => change >= 1 && change <= 2 },
        { key: 'mid', label: '+3 to 5', color: '#34d399', matches: (change) => change >= 3 && change <= 5 },
        { key: 'big', label: '+6 or more', color: CHART_COLORS.success, matches: (change) => change >= 6 },
    ],
}
const changeFor = (sme: SmeImpact, metric: Metric) => (metric === 'revenue' ? sme.beforeAfterChange : sme.jobsBeforeAfterChange)
const bandOf = (change: number, metric: Metric) => BANDS[metric].find((band) => band.matches(change))?.key

type SortKey = 'name' | 'gains' | 'drops' | 'jobs'

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`
const compactRand = (value: number) => (Math.abs(value) >= 1_000_000
    ? `R${(value / 1_000_000).toFixed(1)}m`
    : Math.abs(value) >= 1_000 ? `R${Math.round(value / 1_000)}k` : `R${Math.round(value)}`)

/** A green, red or neutral tag for a change; `suffix` is "%" for revenue and empty for people. */
const ChangeTag = ({ value, suffix = '%' }: { value: number | null, suffix?: string }) => {
    if (value === null) return <Typography.Text type="secondary">—</Typography.Text>
    return <Tag color={value > 0 ? 'green' : value < 0 ? 'red' : undefined} variant="filled">{signed(value)}{suffix}</Tag>
}

export default function ImpactAnalysisPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [data, setData] = useState<ImpactAnalytics | null>(null)
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [band, setBand] = useState<{ metric: Metric, key: string } | null>(null)
    const [sort, setSort] = useState<SortKey>('name')
    const [metric, setMetric] = useState<Metric>('revenue')
    const [section, setSection] = useState('overview')
    const [interventionView, setInterventionView] = useState('matched')
    const [rankingView, setRankingView] = useState('chart')
    const [overviewView, setOverviewView] = useState('growth')
    const [topN, setTopN] = useState(5)
    const [lagMonths, setLagMonths] = useState(0)
    const interventionCohorts = data?.interventionImpactByLag[lagMonths] || []
    const rankedInterventions = useMemo(() => {
        const rows = data?.interventionImpactByLag[lagMonths] || []
        return rows.map(row => ({
            ...row,
            value: metric === 'revenue' ? row.revenueChange : row.jobsChange,
            compared: metric === 'revenue' ? row.revenueSmes : row.jobsSmes,
        })).filter((row): row is typeof row & { value: number } => row.value !== null)
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.title.localeCompare(b.title)).slice(0, topN)
    }, [data, metric, lagMonths, topN])
    const interventionChart = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'bar', height: Math.max(260, rankedInterventions.length * 42 + 90) },
        title: { text: undefined },
        xAxis: { categories: rankedInterventions.map(row => row.title), labels: { style: { fontSize: '12px', textOverflow: 'ellipsis' } } },
        yAxis: { tickAmount: 5, title: { text: t(metric === 'revenue' ? 'Median revenue change (%)' : 'Median jobs change') }, plotLines: [{ value: 0, width: 1, color: CHART_COLORS.slate }] },
        legend: { enabled: false },
        tooltip: {
            formatter() {
                const row = rankedInterventions[this.index]
                return `${signed(row.value)}${metric === 'revenue' ? '%' : ''} · ${row.compared} ${t('SMEs with comparable reports')}`
            }
        },
        plotOptions: { bar: { borderRadius: 4, dataLabels: { enabled: true, format: metric === 'revenue' ? '{point.y}%' : '{point.y}' } } },
        series: [{ type: 'bar', name: t('Observed change'), data: rankedInterventions.map(row => ({ y: row.value, color: row.value < 0 ? CHART_COLORS.danger : row.value > 0 ? CHART_COLORS.success : CHART_COLORS.slate })) }],
    }), [rankedInterventions, metric, t])

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

    // Which views have something to show; a toggle never lands on an empty one.
    const has = useMemo(() => ({
        revenueTrend: !!data?.trend.some((point) => point.revenueSmes),
        jobsTrend: !!data?.trend.some((point) => point.jobsSmes),
        revenueBeforeAfter: !!data?.beforeAfter.count,
        jobsBeforeAfter: !!data?.jobsBeforeAfter.count,
    }), [data])
    const activeTrend = metric
    const activeBeforeAfter = metric

    const trendChart = useMemo<Highcharts.Options | null>(() => {
        if (!data?.trend.length || !(metric === 'revenue' ? has.revenueTrend : has.jobsTrend)) return null
        const categories = data.trend.map((point) => dayjs(`${point.period}-01`).format('MMM YY'))
        if (activeTrend === 'revenue') {
            return {
                chart: { type: 'column', height: 280 },
                title: { text: undefined },
                xAxis: { categories },
                yAxis: { min: 0, title: { text: undefined }, labels: { formatter() { return compactRand(Number(this.value)) } } },
                legend: { enabled: false },
                tooltip: {
                    formatter() {
                        const point = data.trend[this.index]
                        return `<b>${categories[this.index]}</b><br/>${formatCurrencyZAR(point.revenue)}<br/>`
                            + t('{count} SMEs reported', undefined, { count: point.revenueSmes })
                    },
                },
                plotOptions: { column: { borderRadius: 4, maxPointWidth: 28 } },
                series: [{ type: 'column', name: t('Revenue'), color: CHART_COLORS.primary, data: data.trend.map((point) => point.revenue) }],
            }
        }
        const series: Highcharts.SeriesColumnOptions[] = [
            { type: 'column', name: t('Permanent'), color: CHART_COLORS.primary, data: data.trend.map((point) => point.permanent) },
            { type: 'column', name: t('Temporary'), color: '#93c5fd', data: data.trend.map((point) => point.temporary) },
            { type: 'column', name: t('Not split'), color: '#94a3b8', data: data.trend.map((point) => point.unsplit) },
        ].filter((item) => (item.data as number[]).some(Boolean)) as Highcharts.SeriesColumnOptions[]
        // With no split recorded anywhere, the one series is just "people employed" in the main colour.
        if (series.length === 1 && series[0].name === t('Not split')) series[0] = { ...series[0], name: t('People employed'), color: CHART_COLORS.primary }
        return {
            chart: { type: 'column', height: 280 },
            title: { text: undefined },
            xAxis: { categories },
            yAxis: { min: 0, allowDecimals: false, title: { text: t('People employed') }, reversedStacks: false },
            legend: { enabled: series.length > 1 },
            tooltip: {
                shared: true,
                footerFormat: '',
                formatter() {
                    const index = this.points?.[0]?.index ?? this.index ?? 0
                    const point = data.trend[index]
                    const lines = (this.points || []).map((item) => `${item.series.name}: <b>${formatMetricNumber(Number(item.y))}</b>`)
                    return [`<b>${categories[index]}</b>`, ...lines, t('{count} SMEs counted', undefined, { count: point.jobsSmes })].join('<br/>')
                },
            },
            plotOptions: { column: { stacking: 'normal', borderRadius: 3, maxPointWidth: 28 } },
            series,
        }
    }, [activeTrend, data, has.jobsTrend, has.revenueTrend, t])

    const bandCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        BANDS[activeBeforeAfter].forEach((item) => { counts[item.key] = 0 })
            ; (data?.smes || []).forEach((sme) => {
                const change = changeFor(sme, activeBeforeAfter)
                const key = change === null ? undefined : bandOf(change, activeBeforeAfter)
                if (key) counts[key] += 1
            })
        return counts
    }, [activeBeforeAfter, data])

    const beforeAfterChart = useMemo<Highcharts.Options | null>(() => {
        if (!(metric === 'revenue' ? has.revenueBeforeAfter : has.jobsBeforeAfter)) return null
        const bands = BANDS[activeBeforeAfter]
        const selected = band?.metric === activeBeforeAfter ? band.key : null
        return {
            chart: { type: 'column', height: 250 },
            title: { text: undefined },
            xAxis: { categories: bands.map((item) => t(item.label)) },
            yAxis: { min: 0, allowDecimals: false, title: { text: t('SMEs') } },
            legend: { enabled: false },
            tooltip: { pointFormat: `<b>{point.y}</b> ${t('SMEs')}` },
            plotOptions: {
                column: { cursor: 'pointer', borderRadius: 4, maxPointWidth: 48, dataLabels: { enabled: true } },
                series: {
                    point: {
                        // Clicking a band filters the SME table to it; clicking it again clears the filter.
                        events: {
                            click(this: Highcharts.Point) {
                                const key = bands[this.index]?.key
                                if (key) { setSection('smes'); setBand((current) => (current?.metric === activeBeforeAfter && current.key === key ? null : { metric: activeBeforeAfter, key })) }
                            },
                        },
                    },
                },
            },
            series: [{
                type: 'column',
                name: t('SMEs'),
                data: bands.map((item) => ({ y: bandCounts[item.key] || 0, color: item.color, opacity: selected && selected !== item.key ? 0.35 : 1 })),
            }],
        }
    }, [activeBeforeAfter, band, bandCounts, has.jobsBeforeAfter, has.revenueBeforeAfter, t])

    // Supported against not yet supported: one small chart per measure, each on its own scale.
    const [revenueComparison, jobsComparison] = useMemo(() => {
        const chart = (served: number, notServed: number, format: (value: number) => string): Highcharts.Options => ({
            chart: { type: 'bar', height: 110 },
            title: { text: undefined },
            xAxis: { categories: [t('Supported'), t('Not yet supported')] },
            yAxis: { title: { text: undefined }, labels: { enabled: false }, gridLineWidth: 0, plotLines: [{ value: 0, width: 1, color: '#94a3b8' }] },
            legend: { enabled: false },
            tooltip: { enabled: false },
            plotOptions: { bar: { borderRadius: 4, maxPointWidth: 22, dataLabels: { enabled: true, formatter() { return format(Number(this.y)) } } } },
            series: [{ type: 'bar', data: [{ y: served, color: CHART_COLORS.primary }, { y: notServed, color: '#94a3b8' }] }],
        })
        return [
            data && data.servedGrowth !== null && data.notServedGrowth !== null
                ? chart(data.servedGrowth, data.notServedGrowth, (value) => `${signed(value)}%`)
                : null,
            data && data.servedJobs !== null && data.notServedJobs !== null
                ? chart(data.servedJobs, data.notServedJobs, (value) => signed(value))
                : null,
        ]
    }, [data, t])

    const outcomesChart = useMemo<Highcharts.Options | null>(() => {
        if (!data?.areas.length) return null
        return {
            chart: { type: 'bar', height: Math.max(220, data.areas.length * 36 + 90) },
            title: { text: undefined },
            xAxis: { categories: data.areas.map((area) => area.area) },
            yAxis: { min: 0, allowDecimals: false, title: { text: t('Completed interventions') }, reversedStacks: false },
            legend: { enabled: true },
            tooltip: { shared: true },
            plotOptions: { series: { stacking: 'normal' }, bar: { maxPointWidth: 22 } },
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

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        const filtered = (data?.smes || []).filter((sme) => {
            if (needle && !sme.name.toLowerCase().includes(needle)) return false
            if (!band) return true
            const change = changeFor(sme, band.metric)
            return change !== null && bandOf(change, band.metric) === band.key
        })
        if (sort === 'name') return filtered
        // SMEs without the figure go last either way.
        const value = (sme: SmeImpact) => (sort === 'jobs' ? sme.jobsChange : sme.beforeAfterChange)
        const direction = sort === 'drops' ? 1 : -1
        return [...filtered].sort((left, right) => {
            const a = value(left)
            const b = value(right)
            if (a === null) return b === null ? 0 : 1
            if (b === null) return -1
            return (a - b) * direction
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
                {sme.jobsChange !== null && <ChangeTag value={sme.jobsChange} suffix="" />}
            </span>
        )
    const outcomesCell = (sme: SmeImpact) => sme.outcomesRecorded
        ? t('{achieved} of {recorded} achieved', undefined, { achieved: sme.outcomesAchieved, recorded: sme.outcomesRecorded })
        : <Typography.Text type="secondary">{sme.completedInterventions ? t('Awaiting follow-up') : '—'}</Typography.Text>
    const afterSupportCell = (sme: SmeImpact) => (sme.beforeAfterChange === null && sme.jobsBeforeAfterChange === null
        ? <Typography.Text type="secondary">—</Typography.Text>
        : (
            <span className="impact-after-support">
                {sme.beforeAfterChange !== null && <span><Typography.Text type="secondary">{t('Revenue')}</Typography.Text> <ChangeTag value={sme.beforeAfterChange} /></span>}
                {sme.jobsBeforeAfterChange !== null && <span><Typography.Text type="secondary">{t('Jobs')}</Typography.Text> <ChangeTag value={sme.jobsBeforeAfterChange} suffix="" /></span>}
            </span>
        ))

    const columns: TableProps<SmeImpact>['columns'] = [
        { title: t('SME'), dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
        { title: t('Revenue'), key: 'revenue', render: (_, sme) => revenueCell(sme) },
        { title: t('Employees'), key: 'jobs', render: (_, sme) => jobsCell(sme) },
        { title: t('Completed'), dataIndex: 'completedInterventions', width: 110, align: 'center' },
        { title: t('Outcomes'), key: 'outcomes', width: 150, render: (_, sme) => outcomesCell(sme) },
        { title: t('After support'), key: 'beforeAfter', width: 170, render: (_, sme) => afterSupportCell(sme) },
    ]

    const followedUp = data ? data.outcomes.achieved + data.outcomes.partially + data.outcomes.not_yet : 0
    const outcomesHint = !data
        ? undefined
        : data.outcomes.achieved
            ? t('{confirmed} of {achieved} confirmed by the SME', undefined, { confirmed: data.smeCheckbacks.confirmedAchieved, achieved: data.outcomes.achieved })
            : t('Of {count} followed-up interventions', undefined, { count: followedUp })
    const jobsHint = !data?.smesWithJobs
        ? t('No headcount history yet')
        : data.jobsSplit && data.jobsSplit.smes === data.smesWithJobs
            ? t('{permanent} permanent · {temporary} temporary', undefined, { permanent: signed(data.jobsSplit.permanent), temporary: signed(data.jobsSplit.temporary) })
            : t('Net change across {count} SMEs', undefined, { count: data.smesWithJobs })

    // Sections without enough data are left out; one note says what will appear and when.
    const missing = data && !pageLoading
        ? [
            data.smesWithRevenue === 0 && data.smesWithJobs === 0 && t('Growth figures appear once SMEs have revenue or headcount recorded for two periods. SMEs add these on their metrics page.'),
            !data.areas.length && t('Outcomes by area appear once interventions are completed.'),
            !has.revenueBeforeAfter && !has.jobsBeforeAfter && t('Before and after support appears once SMEs have monthly revenue or headcount on both sides of their first completed intervention.'),
        ].filter((line): line is string => Boolean(line))
        : []

    const showTrend = pageLoading || !!trendChart
    const showBeforeAfter = pageLoading || !!beforeAfterChart
    const showComparison = pageLoading || !!(metric === 'revenue' ? revenueComparison : jobsComparison)
    const showOutcomes = pageLoading || !!outcomesChart
    const bandLabel = band ? BANDS[band.metric].find((item) => item.key === band.key)?.label : undefined
    // A card on its own in a row takes the full width.
    const pairSpan = (both: boolean) => (both ? 12 : 24)

    const beforeAfterHeadline = () => {
        if (!data) return null
        if (activeBeforeAfter === 'jobs') {
            const jobs = data.jobsBeforeAfter
            return (
                <div className="impact-headline">
                    <strong className={jobs.netChange >= 0 ? 'is-up' : 'is-down'}>{signed(jobs.netChange)}</strong>
                    <span>
                        {t('Net change in people employed after support. {improved} of {count} SMEs added staff.', undefined, { improved: jobs.improved, count: jobs.count })}
                        {' '}
                        {t('Based on {count} of {total} SMEs.', undefined, { count: jobs.count, total: data.totalSmes })}
                    </span>
                </div>
            )
        }
        const enough = data.beforeAfter.count >= MIN_SMES_FOR_MEDIAN
        return (
            <div className="impact-headline">
                {enough && <strong className={(data.beforeAfter.medianChange || 0) >= 0 ? 'is-up' : 'is-down'}>{signed(data.beforeAfter.medianChange || 0)}%</strong>}
                <span>
                    {enough
                        ? t('Median revenue change after support. {improved} of {count} SMEs improved.', undefined, { improved: data.beforeAfter.improved, count: data.beforeAfter.count })
                        : t('Only {count} SMEs have enough data so far, too few for a reliable median.', undefined, { count: data.beforeAfter.count })}
                    {' '}
                    {t('Based on {count} of {total} SMEs.', undefined, { count: data.beforeAfter.count, total: data.totalSmes })}
                </span>
            </div>
        )
    }

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
                        hint={data?.smesWithRevenue
                            ? t('{growing} of {count} SMEs growing since joining', undefined, { growing: data.growingSmes, count: data.smesWithRevenue })
                            : t('No revenue history yet')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<TeamOutlined />}
                        iconClassName="dashboard-icon-blue"
                        label={t('Jobs created')}
                        value={data?.smesWithJobs ? signed(data.netJobs) : '—'}
                        hint={jobsHint}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="dashboard-icon-orange"
                        label={t('Outcomes achieved')}
                        value={data?.achievedRate !== null && data?.achievedRate !== undefined ? `${data.achievedRate}%` : '—'}
                        hint={outcomesHint}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<CarryOutOutlined />}
                        iconClassName="dashboard-icon-red"
                        label={t('SMEs supported')}
                        value={data ? `${data.supportedSmes} / ${data.totalSmes}` : '—'}
                        hint={t('With at least one completed intervention')}
                    />
                </Col>
            </Row>

            <Segmented className="impact-main-nav" block value={section} onChange={setSection} options={[
                { value: 'overview', label: t('Overview') }, { value: 'interventions', label: t('Interventions') },
                { value: 'smes', label: t('SMEs') }, { value: 'method', label: t('Method') },
            ]} />
            {section !== 'method' && <div className="impact-global-filters">
                <div className="impact-control"><Typography.Text type="secondary">{t('Measure')}</Typography.Text><Segmented value={metric} onChange={value => { setMetric(value as Metric); setBand(null) }} options={[{ value: 'revenue', label: t('Revenue') }, { value: 'jobs', label: t('Jobs') }]} /></div>
                {section === 'overview' && <Select aria-label={t('Overview view')} value={overviewView} onChange={setOverviewView} options={[{ value: 'growth', label: t('Growth') }, { value: 'outcomes', label: t('Outcomes & comparison') }]} />}
                {section === 'interventions' && <>

                    <div className="impact-control impact-analysis-choice">
                        <Typography.Text type="secondary">{t('Analysis')}</Typography.Text>
                        <Select aria-label={t('Analysis')} value={interventionView} onChange={setInterventionView} options={[{ value: 'matched', label: t('Compared with similar SMEs') }, { value: 'observed', label: t('Observed change') }]} />
                    </div>
                    {interventionView === 'observed' && <>
                        <div className="impact-control impact-number-control"><Typography.Text type="secondary">{t('Top interventions')}</Typography.Text><InputNumber aria-label={t('Top interventions')} min={1} max={50} precision={0} value={topN} onChange={value => setTopN(value ?? 5)} /></div>
                        <div className="impact-control impact-number-control"><Typography.Text type="secondary">{t('Lag (months)')}</Typography.Text><InputNumber aria-label={t('Lag (months)')} min={0} max={12} precision={0} value={lagMonths} onChange={value => setLagMonths(value ?? 0)} /></div>
                        <div className="impact-control impact-display-control"><Typography.Text type="secondary">{t('Display')}</Typography.Text><Segmented value={rankingView} onChange={setRankingView} options={[{ value: 'chart', label: t('Chart') }, { value: 'table', label: t('Results') }]} /></div>
                    </>}

                </>}
            </div>}
            {section === 'overview' && <>
                {!pageLoading && overviewView === 'growth' && !showTrend && !showBeforeAfter && <Empty description={t('No reports available for the selected measure.')} />}
                <div className="impact-view-heading"><div><Typography.Title level={4}>{t('Portfolio overview')}</Typography.Title><Typography.Text type="secondary">{t('Growth, delivery outcomes and the SMEs behind them.')}</Typography.Text></div></div>
                {missing.length > 0 && (
                    <Card className="dashboard-section-card motion-card impact-note">
                        {missing.map((line) => <Typography.Paragraph key={line} type="secondary">{line}</Typography.Paragraph>)}
                    </Card>
                )}

                {overviewView === 'growth' && (showTrend || showBeforeAfter) && (
                    <Row gutter={[16, 16]}>
                        {showTrend && (
                            <Col xs={24} xl={pairSpan(showBeforeAfter)}>
                                <Card
                                    loading={pageLoading}
                                    className="dashboard-section-card motion-card impact-chart-card"
                                    title={(
                                        <span className="impact-card-title">
                                            {t('Portfolio over time')}
                                            <Tooltip title={activeTrend === 'revenue'
                                                ? t('Total revenue the SMEs reported each month.')
                                                : t('People employed across the SMEs each month. An SME that skips a month keeps its last reported headcount.')}
                                            >
                                                <InfoCircleOutlined />
                                            </Tooltip>
                                        </span>
                                    )}
                                >
                                    {trendChart && <ThemedHighcharts options={trendChart} />}
                                </Card>
                            </Col>
                        )}
                        {showBeforeAfter && (
                            <Col xs={24} xl={pairSpan(showTrend)}>
                                <Card
                                    loading={pageLoading}
                                    className="dashboard-section-card motion-card impact-chart-card"
                                    title={(
                                        <span className="impact-card-title">
                                            {t('Before and after support')}
                                            <Tooltip title={activeBeforeAfter === 'revenue'
                                                ? t('Change in average monthly revenue: {months} months before against {months} months after each SME’s first completed intervention.', undefined, { months: BEFORE_AFTER_WINDOW_MONTHS })
                                                : t('Change in people employed: the last headcount in the {months} months before each SME’s first completed intervention against the last in the {months} months after.', undefined, { months: BEFORE_AFTER_WINDOW_MONTHS })}
                                            >
                                                <InfoCircleOutlined />
                                            </Tooltip>
                                        </span>
                                    )}
                                >
                                    {beforeAfterChart && (
                                        <>
                                            {beforeAfterHeadline()}
                                            <ThemedHighcharts options={beforeAfterChart} />
                                            <Typography.Text type="secondary" className="impact-footnote">{t('Click a bar to open those SMEs in the SMEs view.')}</Typography.Text>
                                        </>
                                    )}
                                </Card>
                            </Col>
                        )}
                    </Row>
                )}

                {overviewView === 'outcomes' && (showComparison || showOutcomes) && (
                    <Row gutter={[16, 16]}>
                        {showComparison && (
                            <Col xs={24} xl={pairSpan(showOutcomes)}>
                                <Card loading={pageLoading} className="dashboard-section-card motion-card impact-chart-card" title={t('Supported vs not yet supported')}>
                                    {metric === 'revenue' && revenueComparison && (
                                        <div className="impact-compare-block">
                                            <Typography.Text strong>{t('Revenue growth since joining (median)')}</Typography.Text>
                                            <ThemedHighcharts options={revenueComparison} />
                                        </div>
                                    )}
                                    {metric === 'jobs' && jobsComparison && (
                                        <div className="impact-compare-block">
                                            <Typography.Text strong>{t('Jobs added per SME (average)')}</Typography.Text>
                                            <ThemedHighcharts options={jobsComparison} />
                                        </div>
                                    )}
                                    {data && (
                                        <Typography.Text type="secondary" className="impact-footnote">
                                            {t('{served} SMEs with completed support, {notServed} without.', undefined, { served: data.supportedSmes, notServed: data.totalSmes - data.supportedSmes })}
                                            {' '}
                                            {t('A comparison, not proof of cause.')}
                                        </Typography.Text>
                                    )}
                                </Card>
                            </Col>
                        )}
                        {showOutcomes && (
                            <Col xs={24} xl={pairSpan(showComparison)}>
                                <Card loading={pageLoading} className="dashboard-section-card motion-card impact-chart-card" title={t('Outcomes by area of support')}>
                                    {outcomesChart && <ThemedHighcharts options={outcomesChart} />}
                                </Card>
                            </Col>
                        )}
                    </Row>
                )}

            </>}
            {section === 'interventions' && <Card loading={pageLoading} className="dashboard-section-card motion-card impact-chart-card" title={t('Impact by intervention')}>
                {interventionView === 'matched' ? <MatchedImpactPanel key={activeProgramId + metric} rows={(data?.matchedImpact || []).filter(row => row.metric === metric)} programNames={data?.programNames || {}} showProgramme={isAllPrograms} /> : <>
                    <Typography.Paragraph type="secondary">
                        {t('Largest observed changes after completed support. Declines are included; missing reports are excluded.')}
                    </Typography.Paragraph>
                    {rankedInterventions.length ? <>
                        {rankingView === 'chart' && <div className="impact-ranking-chart"><ThemedHighcharts options={interventionChart} /></div>}
                        {rankingView === 'table' && <ResponsiveDataView
                            rowKey="id" rows={rankedInterventions} emptyText={t('No comparable reports')}
                            columns={[
                                { title: t('Intervention'), dataIndex: 'title' },
                                { title: t('SMEs completed'), dataIndex: 'smes', align: 'right' },
                                { title: t('SMEs compared'), dataIndex: 'compared', render: (value: number) => <Space>{value}{value < MIN_SMES_FOR_MEDIAN && <Tag>{t('Small sample')}</Tag>}</Space> },
                                { title: t('Median change'), dataIndex: 'value', align: 'right', render: (value: number) => <ChangeTag value={value} suffix={metric === 'revenue' ? '%' : ''} /> },
                            ]}
                            renderCard={row => <Space direction="vertical"><Typography.Text strong>{row.title}</Typography.Text><ChangeTag value={row.value} suffix={metric === 'revenue' ? '%' : ''} /><Typography.Text>{row.compared} {t('SMEs compared')} / {row.smes} {t('completed')}</Typography.Text>{row.compared < MIN_SMES_FOR_MEDIAN && <Tag>{t('Small sample')}</Tag>}</Space>}
                        />}
                    </> : <Empty description={t('No comparable before-and-after reports for this lag. Try a shorter lag or collect more monthly reports.')} />}
                    <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
                        {interventionCohorts.length} {t('interventions with dated completions in scope')}. {t('Observed change does not prove causation.')} <Button type="link" size="small" onClick={() => setSection('method')}>{t('How this is measured')}</Button>
                    </Typography.Paragraph>
                </>}
            </Card>}
            {section === 'method' && <Card title={t('How impact is measured')}>
                <Typography.Title level={5}>Compared with similar SMEs</Typography.Title>
                <Typography.Paragraph>Uses SME-confirmed completions, once per SME at its first completion. Compares the three months before with months 3–6 after; at least two recorded months are required on each side. Comparison SMEs have not completed that intervention by the end of the window. Matching uses sector and size, then sector, then programme.</Typography.Paragraph>
                <Typography.Paragraph>Revenue is percentage growth; the difference is percentage points. Jobs are the change in average headcount per SME. The 90% range resamples SME-level differences 1,000 times. Reportable means at least 10 SMEs on each side; early signals need at least 5 on each side. Smaller samples show no estimate. These thresholds describe sample coverage, not proof of an effect.</Typography.Paragraph>
                <Typography.Title level={5}>Observed change</Typography.Title>
                <Typography.Paragraph>Ranks the median before-and-after change without a comparison group, after all recorded assignments are complete. Uses six-month windows and an optional lag. Completion and unfinished calendar months are excluded. An SME can appear under several interventions; results should not be added together.</Typography.Paragraph>
                <Typography.Paragraph>Both views use this app's monthly SME reports and saved monthly histories. Missing values are excluded, not replaced with zero. Demo data is marked when source records identify it. Results describe associations, not causation.</Typography.Paragraph>
            </Card>}
            {section === 'smes' && <>
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
                                    { value: 'jobs', label: t('Sort: most jobs added') },
                                ]}
                            />
                            {band && bandLabel && (
                                <Tag className="impact-band-filter" closable closeIcon={<CloseOutlined />} onClose={() => setBand(null)}>
                                    {band.metric === 'revenue' ? t('Revenue after support') : t('Jobs after support')}: {t(bandLabel)}
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
                                    <dt>{t('After support')}</dt><dd>{afterSupportCell(sme)}</dd>
                                </dl>
                            </div>
                        )}
                    />
                </Card>
            </>}
        </DashboardPage>
    )
}
