import { useEffect, useMemo, useState } from 'react'
import { Alert, Card, Col, Row } from 'antd'
import { BankOutlined, RiseOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type Highcharts from 'highcharts'
import { useNavigate } from 'react-router-dom'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CLIENT_MODULES } from '@/config/clientModules'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { getFunderSummary } from '@/services/clientRevenueService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { rand } from '@/utils/trainingFormat'
import type { ClientFunderSummary } from '@/types/clientRevenue'

/**
 * The Workspace home of an awareness training company (training is its home module): a short overview of the
 * company's results, four figures and two charts. The work itself has its own pages (Classes, Assessments, ESG
 * reports, Revenue). The figures come from the funder summary, so they match the funder report.
 */
export default function TrainingHomePage() {
    const { t } = useLanguage()
    const { settings } = useSystemSettings()
    const navigate = useNavigate()
    const esgOn = settings[CLIENT_MODULES.esgReporting.setting] === true
    // undefined while loading, null when it could not be loaded.
    const [summary, setSummary] = useState<ClientFunderSummary | null>()

    useEffect(() => {
        let cancelled = false
        getFunderSummary().then((value) => { if (!cancelled) setSummary(value) }, () => { if (!cancelled) setSummary(null) })
        return () => { cancelled = true }
    }, [])

    const revenueChart = useMemo(() => summary ? ({
        chart: { type: 'column', height: 280 },
        title: { text: undefined },
        xAxis: { categories: summary.revenue.byMonth.map((item) => dayjs(`${item.month}-01`).format('MMM YY')) },
        yAxis: { title: { text: undefined }, min: 0 },
        tooltip: { shared: true, valuePrefix: 'R ' },
        legend: { enabled: esgOn },
        plotOptions: { column: { stacking: 'normal' } },
        series: [
            { type: 'column', name: t('Training'), data: summary.revenue.byMonth.map((item) => item.training) },
            ...(esgOn ? [{ type: 'column', name: t('ESG reporting'), data: summary.revenue.byMonth.map((item) => item.esgReporting) }] : []),
            { type: 'column', name: t('Other'), data: summary.revenue.byMonth.map((item) => item.other), showInLegend: false },
        ],
    }) as Highcharts.Options : null, [esgOn, summary, t])

    const learnersChart = useMemo(() => summary ? ({
        chart: { type: 'column', height: 280 },
        title: { text: undefined },
        xAxis: { categories: summary.training.byMonth.map((item) => dayjs(`${item.month}-01`).format('MMM YY')) },
        yAxis: { title: { text: undefined }, min: 0, allowDecimals: false },
        legend: { enabled: false },
        series: [{ type: 'column', name: t('Learners trained'), data: summary.training.byMonth.map((item) => item.learners) }],
    }) as Highcharts.Options : null, [summary, t])

    useRegisterAgentPageContext({
        pageKey: 'training-home',
        pageName: 'Home',
        purpose: 'The facilitator\'s overview of the company\'s results: learners trained, pass rate, revenue and client organisations, with revenue and learners trained per month. The work itself is on the Classes, Assessments, ' + (esgOn ? 'ESG reports and Revenue pages.' : 'Surveys and Revenue pages. The company does not offer ESG reporting.'),
        metrics: summary ? {
            learnersTrained: summary.training.learners,
            learnersCertified: summary.training.learnersCertified,
            passRatePct: summary.training.passRatePct ?? 'none yet',
            revenueThisYearZar: summary.revenue.thisYear,
            outstandingZar: summary.revenue.outstanding,
            clientOrganisations: summary.organisations.length,
        } : {},
        dataSummary: summary ? { revenueByMonth: summary.revenue.byMonth, learnersByMonth: summary.training.byMonth } : {},
    })

    const loading = summary === undefined
    const passRate = summary?.training.passRatePct

    return (
        <DashboardPage className="training-page">
            <DashboardHeader title={t('Overview')} subtitle={dayjs().format('dddd, D MMMM YYYY')} />
            {summary === null && <Alert type="error" showIcon message={t('The overview could not be loaded.')} style={{ marginBottom: 14 }} />}

            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Learners trained')} value={summary ? summary.training.learners : '—'} onClick={() => navigate('/training/classes')} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<SafetyCertificateOutlined />} label={t('Pass rate')} value={passRate !== null && passRate !== undefined ? `${passRate}%` : '—'} onClick={() => navigate('/training/classes')} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<RiseOutlined />} label={t('Revenue this year')} mobileTitle={t('Revenue')} value={summary ? rand(summary.revenue.thisYear) : '—'} onClick={() => navigate('/training/revenue')} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<BankOutlined />} label={t('Client organisations')} mobileTitle={t('Organisations')} value={summary ? summary.organisations.length : '—'} />
                </Col>
            </Row>

            <Row gutter={[14, 14]}>
                <Col xs={24} lg={12}>
                    <Card title={t('Revenue per month')} loading={loading}>{revenueChart && <ThemedHighcharts options={revenueChart} />}</Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={t('Learners trained per month')} loading={loading}>{learnersChart && <ThemedHighcharts options={learnersChart} />}</Card>
                </Col>
            </Row>
        </DashboardPage>
    )
}
