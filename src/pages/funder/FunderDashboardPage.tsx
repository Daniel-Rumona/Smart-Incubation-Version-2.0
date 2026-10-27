import { useMemo } from 'react'
import { Alert, Button, Card, Col, Empty, Row, Skeleton } from 'antd'
import { AimOutlined, DollarOutlined, RightOutlined, RiseOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type Highcharts from 'highcharts'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { AdminKpiTile, AdminMiniBars } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import type { FunderActivity } from '@/services/funderService'
import { buildSectorRollups } from '@/services/directorPortfolioService'
import { useFunderData } from '@/pages/funder/useFunderData'
import '@/styles/admin-dashboard.css'
import '@/styles/funder.css'

dayjs.extend(relativeTime)

const ACCENT = '#6d5dfb'
const ACCENT_DEEP = '#4338ca'
const ACCENT_LIGHT = '#a99ffc'

const KIND: Record<FunderActivity['kind'], { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'good' },
  joined: { label: 'Joined', tone: 'good' },
  meeting: { label: 'Meeting held', tone: 'neutral' },
  at_risk: { label: 'At risk', tone: 'bad' },
}

/** Funder home: what the funded programmes are achieving, as totals, trends and milestones. */
export const FunderDashboardPage = () => {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { data, loading, error, user } = useFunderData()
  const months = useMemo(() => data?.months || [], [data])
  const last6 = useMemo(() => months.slice(-6), [months])
  const bars = (pick: (month: (typeof months)[number]) => number) => last6.map((month) => ({ key: month.key, label: month.label.slice(0, 1), value: pick(month) }))
  const sectors = useMemo(() => buildSectorRollups(data?.portfolio || []).sort((left, right) => right.avgProgress - left.avgProgress).slice(0, 6), [data])
  const programmeNames = (data?.programmes || []).map((row) => row.name)
  const firstName = (user?.name || user?.displayName || '').split(' ')[0]

  useRegisterAgentPageContext({
    pageKey: 'funder-dashboard',
    pageName: 'Funder dashboard',
    purpose: 'Results of the programmes this funder supports: SMEs supported, progress, revenue, jobs and recent milestones.',
    metrics: { smes: data?.totals.smes || 0, avgProgress: data?.totals.avgProgress || 0, revenue: data?.totals.revenue || 0, jobs: data?.totals.employees || 0 },
  })

  const trendChart = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'areaspline', height: 290, spacing: [12, 4, 4, 4] },
    title: { text: undefined },
    legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
    tooltip: { shared: true },
    xAxis: { categories: months.map((month) => month.label), lineWidth: 0, tickLength: 0 },
    yAxis: [
      { title: { text: undefined }, min: 0, gridLineDashStyle: 'Dash', labels: { formatter() { return `R ${compactAmount(Number(this.value))}` } } },
      { title: { text: undefined }, min: 0, opposite: true, gridLineWidth: 0, allowDecimals: false },
    ],
    plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
    series: [
      { type: 'areaspline', name: t('Revenue'), color: ACCENT, data: months.map((month) => month.revenue), fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(109, 93, 251, .32)'], [1, 'rgba(109, 93, 251, 0)']] } },
      { type: 'areaspline', name: t('Jobs'), yAxis: 1, color: ACCENT_DEEP, fillColor: 'transparent', dashStyle: 'ShortDash', data: months.map((month) => month.employees) },
    ],
  }), [months, t])

  const supportChart = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'column', height: 290, spacing: [12, 4, 4, 4] },
    title: { text: undefined },
    legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
    tooltip: { shared: true },
    xAxis: { categories: last6.map((month) => month.label), lineWidth: 0, tickLength: 0 },
    yAxis: { title: { text: undefined }, min: 0, allowDecimals: false, gridLineDashStyle: 'Dash' },
    plotOptions: { column: { borderRadius: 5, grouping: false, pointPadding: 0.12, groupPadding: 0.14 } },
    series: [
      { type: 'column', name: t('Planned'), color: ACCENT_LIGHT, opacity: 0.55, data: last6.map((month) => month.planned) },
      { type: 'column', name: t('Completed'), color: ACCENT, pointPadding: 0.26, data: last6.map((month) => month.completed) },
    ],
  }), [last6, t])

  const hasTrend = months.some((month) => month.revenue || month.employees)
  const hasSupport = last6.some((month) => month.completed || month.planned)

  return (
    <DashboardPage className="funder-page admin-overview">
      <header className="admin-hero">
        <div>
          <h2>{firstName ? t('Welcome back, {name}!', undefined, { name: firstName }) : t('Funder dashboard')}</h2>
          <p>{programmeNames.length ? t('What your funding is achieving across {programmes}.', undefined, { programmes: programmeNames.join(', ') }) : t('What your funding is achieving.')}</p>
        </div>
      </header>
      {error && <Alert type="error" showIcon message={t('Your programme results could not be loaded.')} style={{ marginBottom: 16 }} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<TeamOutlined />} label={t('SMEs supported')} value={data?.totals.smes || 0} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<AimOutlined />} label={t('Average progress')} value={`${data?.totals.avgProgress || 0}%`} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<DollarOutlined />} label={t('Portfolio revenue')} value={formatCurrencyZAR(data?.totals.revenue || 0)} visual={<AdminMiniBars bars={bars((month) => month.revenue)} />} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<RiseOutlined />} label={t('Jobs supported')} value={data?.totals.employees || 0} visual={<AdminMiniBars bars={bars((month) => month.employees)} />} /></Col>
      </Row>

      <Row gutter={[16, 16]} className="funder-row">
        <Col xs={24} lg={14}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div><h3>{t('Revenue and jobs')}</h3><span>{t('Portfolio totals from monthly SME reporting, last 12 months')}</span></div></div>
            {loading ? <Skeleton active /> : hasTrend ? <ThemedHighcharts options={trendChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SME reporting yet.')} />}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div><h3>{t('Support delivered')}</h3><span>{t('Interventions completed against plan')}</span></div></div>
            {loading ? <Skeleton active /> : hasSupport ? <ThemedHighcharts options={supportChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No interventions due in the last six months.')} />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="funder-row">
        <Col xs={24} lg={15}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div><h3>{t('Recent activity')}</h3><span>{t('Milestones across your programmes, newest first')}</span></div></div>
            <ResponsiveDataView
              rowKey="id"
              loading={loading}
              rows={(data?.activity || []).slice(0, 8)}
              emptyText={t('No activity yet.')}
              columns={[
                { title: t('When'), dataIndex: 'at', width: 120, render: (_, row) => <span className="funder-muted">{row.at.fromNow()}</span> },
                { title: t('SME'), dataIndex: 'smeName', render: (value: string) => <strong>{value}</strong> },
                { title: t('What happened'), dataIndex: 'detail', render: (_, row) => <span><span className={`funder-pill is-${KIND[row.kind].tone}`}>{t(KIND[row.kind].label)}</span> {row.detail}</span> },
                { title: t('Programme'), dataIndex: 'programName', render: (value: string) => <span className="funder-muted">{value}</span> },
              ]}
              renderCard={(row) => <div className="funder-activity-card"><span className={`funder-pill is-${KIND[row.kind].tone}`}>{t(KIND[row.kind].label)}</span><strong>{row.smeName}</strong><span>{row.detail}</span><small>{row.at.fromNow()}{row.programName ? ` · ${row.programName}` : ''}</small></div>}
            />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head">
              <div><h3>{t('Top sectors')}</h3><span>{t('Average SME progress by sector')}</span></div>
              <Button type="text" size="small" onClick={() => navigate('/funder/sectors')}>{t('View more')} <RightOutlined /></Button>
            </div>
            {loading ? <Skeleton active /> : sectors.length ? (
              <ul className="funder-sectors">
                {sectors.map((row) => (
                  <li key={row.sector}>
                    <span>{row.sector}</span>
                    <span className="funder-track"><b style={{ width: `${row.avgProgress}%` }} /></span>
                    <strong>{row.avgProgress}%</strong>
                  </li>
                ))}
              </ul>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
      </Row>
    </DashboardPage>
  )
}

/** 3 400 000 → "3.4m", 12 500 → "12.5k". */
const compactAmount = (value: number) => value >= 1_000_000 ? `${Math.round(value / 100_000) / 10}m` : value >= 1_000 ? `${Math.round(value / 100) / 10}k` : String(value)

export default FunderDashboardPage
