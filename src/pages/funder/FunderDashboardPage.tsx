import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Row, Segmented, Skeleton } from 'antd'
import { CheckCircleOutlined, DollarOutlined, RightOutlined, RiseOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type Highcharts from 'highcharts'
import { AdminKpiTile, type AdminKpiTrend } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import type { FunderActivity } from '@/services/funderService'
import { useFunderData } from '@/pages/funder/useFunderData'
import '@/styles/admin-dashboard.css'
import '@/styles/funder.css'

const ACCENT = '#6d5dfb'

const KIND: Record<FunderActivity['kind'], { label: string; tone: string }> = {
  completed: { label: 'Completed', tone: 'good' },
  joined: { label: 'Joined', tone: 'good' },
  meeting: { label: 'Meeting held', tone: 'accent' },
  at_risk: { label: 'Behind', tone: 'bad' },
}

type FeedItem =
  | { type: 'event'; at: number; row: FunderActivity }
  | { type: 'behind'; at: number; rows: FunderActivity[] }

/** Funder home: is the money working? Delivery, growth and jobs, the revenue or jobs trend, and what happened lately. */
export const FunderDashboardPage = () => {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const { data, loading, error, user } = useFunderData()
  const [metric, setMetric] = useState<'revenue' | 'jobs'>('revenue')
  const months = useMemo(() => data?.months || [], [data])
  const summary = data?.summary
  const reporting = summary?.reporting
  // The current month is shown, but marked, while SMEs are still reporting it, so a part-reported month can't read as a drop.
  const monthOpen = !!reporting && reporting.total > 0 && reporting.reported < reporting.total
  const programmeNames = (data?.programmes || []).map((row) => row.name)
  const firstName = (user?.name || user?.displayName || '').split(' ')[0]

  // Delivery by sector, on the same rule as the Delivery card.
  const sectors = useMemo(() => {
    const map = new Map<string, { required: number; completed: number }>()
    ;(data?.portfolio || []).forEach((row) => {
      const entry = map.get(row.sector) || { required: 0, completed: 0 }
      entry.required += row.execution.required
      entry.completed += row.execution.completed
      map.set(row.sector, entry)
    })
    return Array.from(map.entries())
      .filter(([, entry]) => entry.required > 0)
      .map(([sector, entry]) => ({ sector, rate: Math.min(100, Math.round((entry.completed / entry.required) * 100)), detail: `${entry.completed} of ${entry.required}` }))
      .sort((left, right) => right.rate - left.rate)
      .slice(0, 6)
  }, [data])

  // Newest first; SMEs that fell behind fold into one line so they don't push the milestones out.
  const feed = useMemo<FeedItem[]>(() => {
    const rows = data?.activity || []
    const behind = rows.filter((row) => row.kind === 'at_risk')
    const items: FeedItem[] = rows.filter((row) => row.kind !== 'at_risk').slice(0, 7).map((row) => ({ type: 'event', at: row.at.valueOf(), row }))
    if (behind.length) items.push({ type: 'behind', at: Math.max(...behind.map((row) => row.at.valueOf())), rows: behind })
    return items.sort((left, right) => right.at - left.at)
  }, [data])

  useRegisterAgentPageContext({
    pageKey: 'funder-dashboard',
    pageName: 'Funder dashboard',
    purpose: 'Results of the programmes this funder supports: SMEs supported, delivery of required support, revenue growth and jobs since joining, and recent milestones.',
    metrics: { smes: data?.totals.smes || 0, delivery: summary?.delivery.rate ?? 0, revenueGrowth: summary?.revenueGrowth ?? 0, netJobs: summary?.netJobs || 0 },
  })

  const trendChart = useMemo<Highcharts.Options>(() => {
    const revenue = metric === 'revenue'
    const lastIndex = months.length - 1
    const figure = (value: number) => (revenue ? `R ${compactAmount(value)}` : value.toLocaleString())
    return {
      // Revenue reads as a running level (area); jobs as a monthly headcount (columns).
      chart: { type: revenue ? 'areaspline' : 'column', height: 280, spacing: [16, 4, 4, 4] },
      title: { text: undefined },
      legend: { enabled: false },
      xAxis: { categories: months.map((month, index) => (monthOpen && index === lastIndex ? `${month.label}*` : month.label)), lineWidth: 0, tickLength: 0 },
      yAxis: {
        title: { text: undefined },
        min: 0,
        allowDecimals: false,
        gridLineDashStyle: 'Dash',
        labels: { formatter() { return figure(Number(this.value)) } },
      },
      tooltip: {
        formatter() {
          const index = Number(this.index ?? 0)
          const value = revenue ? formatCurrencyZAR(Number(this.y)) : Number(this.y).toLocaleString()
          const note = monthOpen && index === lastIndex && reporting ? `<br/>${t('{reported} of {total} SMEs have reported so far', undefined, { reported: reporting.reported, total: reporting.total })}` : ''
          return `<b>${months[index]?.label || ''}</b><br/>${revenue ? t('Revenue') : t('Jobs')}: ${value}${note}`
        },
      },
      plotOptions: {
        series: {
          // Every month's figure on the chart; empty months stay unlabelled.
          dataLabels: { enabled: true, crop: false, overflow: 'allow', style: { fontSize: '11px', fontWeight: '600', textOutline: 'none' }, formatter() { return this.y ? figure(Number(this.y)) : null } },
        },
        column: { borderRadius: 6, pointPadding: 0.08, groupPadding: 0.08 },
        areaspline: { lineWidth: 2.5, marker: { radius: 3, symbol: 'circle' } },
      },
      series: [revenue ? {
        type: 'areaspline',
        name: t('Revenue'),
        color: ACCENT,
        fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(109, 93, 251, .32)'], [1, 'rgba(109, 93, 251, 0)']] },
        // The month still being reported has no point yet: a part-reported total would read as a fall.
        data: months.map((month, index) => (monthOpen && index === lastIndex ? null : month.revenue)),
      } : {
        type: 'column',
        name: t('Jobs'),
        color: ACCENT,
        data: months.map((month, index) => (monthOpen && index === lastIndex
          ? { y: month.employees, color: 'rgba(109, 93, 251, .22)', borderColor: ACCENT, borderWidth: 1, dashStyle: 'Dash' as const }
          : month.employees)),
      }],
    }
  }, [metric, monthOpen, months, reporting, t])

  const hasTrend = months.some((month) => (metric === 'revenue' ? month.revenue : month.employees))
  const deliveryTrend = (): AdminKpiTrend | undefined => {
    const now = summary?.delivery.rate
    const before = summary?.delivery.previousRate
    if (now === null || now === undefined || before === null || before === undefined) return undefined
    const diff = now - before
    const amount = `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)} ${t('pts')}`
    return { amount, direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat', tone: diff > 0 ? 'good' : diff < 0 ? 'bad' : 'neutral', text: t('{amount} on three months ago', undefined, { amount }) }
  }
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value.toLocaleString()}`

  return (
    <DashboardPage className="funder-page admin-overview">
      <header className="admin-hero funder-hero">
        <div>
          <h2>{firstName ? t('Welcome back, {name}!', undefined, { name: firstName }) : t('Funder dashboard')}</h2>
          <p>{programmeNames.length ? t('What your funding is achieving across {programmes}.', undefined, { programmes: programmeNames.join(', ') }) : t('What your funding is achieving.')}</p>
        </div>
        {!loading && monthOpen && reporting && (
          <span className="funder-chip">{t('{month} reporting is open ({reported} of {total} in)', undefined, { month: t(reporting.label), reported: reporting.reported, total: reporting.total })}</span>
        )}
      </header>
      {error && <Alert type="error" showIcon message={t('Your programme results could not be loaded.')} style={{ marginBottom: 16 }} />}

      <Row gutter={[16, 16]}>
        <Col xs={12} md={6} className="funder-kpi-extra">
          <AdminKpiTile
            compact
            loading={loading}
            icon={<TeamOutlined />}
            label={t('SMEs supported')}
            value={data?.totals.smes || 0}
            note={summary?.joinedRecently ? t('{count} joined in 3 months', undefined, { count: summary.joinedRecently }) : undefined}
          />
        </Col>
        <Col xs={12} md={6}>
          <AdminKpiTile
            compact
            loading={loading}
            icon={<CheckCircleOutlined />}
            label={t('Delivery')}
            value={summary?.delivery.rate === null || summary?.delivery.rate === undefined ? '—' : `${summary.delivery.rate}%`}
            trend={deliveryTrend()}
            note={summary?.delivery.required ? t('{completed} of {required} required done', undefined, { completed: summary.delivery.completed, required: summary.delivery.required }) : t('No required support yet')}
          />
        </Col>
        <Col xs={12} md={6}>
          <AdminKpiTile
            compact
            loading={loading}
            icon={<DollarOutlined />}
            label={t('Revenue growth')}
            value={summary?.revenueGrowth === null || summary?.revenueGrowth === undefined ? '—' : `${summary.revenueGrowth > 0 ? '+' : ''}${summary.revenueGrowth}%`}
            note={summary?.smesWithRevenue
              ? t('Since joining · {growing} of {total} growing', undefined, { growing: summary.growingSmes, total: summary.smesWithRevenue })
              : t('Needs two months of reports')}
          />
        </Col>
        <Col xs={12} md={6} className="funder-kpi-extra">
          <AdminKpiTile
            compact
            loading={loading}
            icon={<RiseOutlined />}
            label={t('Jobs')}
            value={summary?.smesWithJobs ? signed(summary.netJobs) : '—'}
            note={t('Since joining · {count} now', undefined, { count: (data?.totals.employees || 0).toLocaleString() })}
          />
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="funder-row funder-row-top">
        <Col xs={24} lg={14}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head">
              <div>
                <h3>{metric === 'revenue' ? t('Portfolio revenue') : t('Jobs')}</h3>
                <span>{metric === 'revenue' ? t('Monthly total from SME reporting') : t('Monthly headcount from SME reporting')}</span>
              </div>
              <Segmented
                size="small"
                value={metric}
                onChange={(value) => setMetric(value as 'revenue' | 'jobs')}
                options={[{ value: 'revenue', label: t('Revenue') }, { value: 'jobs', label: t('Jobs') }]}
              />
            </div>
            {loading ? <Skeleton active /> : hasTrend ? (
              <>
                {/* Remounts on the switch so no revenue setting (rand axis, area) carries over to jobs. */}
                <ThemedHighcharts key={metric} options={trendChart} />
                {monthOpen && reporting && <p className="funder-footnote">{t('* {month} is still being reported ({reported} of {total} SMEs).', undefined, { month: t(reporting.label), reported: reporting.reported, total: reporting.total })}</p>}
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SME reporting yet.')} />}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card className="admin-card funder-fit-card" bordered={false}>
            <div className="admin-card-head">
              <div><h3>{t('Sectors')}</h3><span>{t('Required support done, by sector')}</span></div>
              <Button type="text" size="small" onClick={() => navigate('/funder/sectors')}>{t('View more')} <RightOutlined /></Button>
            </div>
            {loading ? <Skeleton active /> : sectors.length ? (
              <ul className="funder-sectors">
                {sectors.map((row) => (
                  <li key={row.sector} title={t('{detail} required interventions done', undefined, { detail: row.detail })}>
                    <span>{row.sector}</span>
                    <span className="funder-track"><b style={{ width: `${row.rate}%` }} /></span>
                    <strong>{row.rate}%</strong>
                  </li>
                ))}
              </ul>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No required support yet.')} />}
          </Card>
        </Col>
      </Row>

      <Card className="admin-card funder-row" bordered={false}>
        <div className="admin-card-head"><div><h3>{t('Recent activity')}</h3><span>{t('What happened across your programmes, newest first')}</span></div></div>
        {loading ? <Skeleton active /> : feed.length ? (
          <ul className="funder-feed">
            {feed.map((item) => item.type === 'event' ? (
              <li key={item.row.id}>
                <time>{item.row.at.format('D MMM YYYY')}</time>
                <div>
                  <strong>{item.row.smeName}</strong>
                  <span>{item.row.kind === 'meeting' ? t('Meeting: {title}', undefined, { title: item.row.detail }) : item.row.detail}{item.row.programName && programmeNames.length > 1 ? ` · ${item.row.programName}` : ''}</span>
                </div>
                <span className={`funder-pill is-${KIND[item.row.kind].tone}`}>{t(KIND[item.row.kind].label)}</span>
              </li>
            ) : (
              <li key="behind" className="is-behind">
                <time>{t('Since {date}', undefined, { date: item.rows.reduce((earliest, row) => (row.at.isBefore(earliest) ? row.at : earliest), item.rows[0].at).format('D MMM') })}</time>
                <div>
                  <strong>{item.rows.length === 1 ? t('1 SME fell behind') : t('{count} SMEs fell behind', undefined, { count: item.rows.length })}</strong>
                  <span>{behindNames(item.rows, t)}</span>
                </div>
                <span className="funder-pill is-bad">{t('Behind')}</span>
              </li>
            ))}
          </ul>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No activity yet.')} />}
      </Card>
    </DashboardPage>
  )
}

/** "Vula Vineyards, Lekgotla Greens, Dumisani Beekeeping and 2 more". */
const behindNames = (rows: FunderActivity[], t: ReturnType<typeof useLanguage>['t']) => {
  const names = rows.map((row) => row.smeName)
  return names.length > 3
    ? t('{names} and {count} more', undefined, { names: names.slice(0, 3).join(', '), count: names.length - 3 })
    : names.join(', ')
}

/** 3 400 000 → "3.4m", 12 500 → "12.5k". */
const compactAmount = (value: number) => value >= 1_000_000 ? `${Math.round(value / 100_000) / 10}m` : value >= 1_000 ? `${Math.round(value / 100) / 10}k` : String(value)

export default FunderDashboardPage
