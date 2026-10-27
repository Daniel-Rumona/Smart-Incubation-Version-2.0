import { useEffect, useMemo, useState } from 'react'
import { Alert, Card, Col, Empty, Row, Skeleton } from 'antd'
import type Highcharts from 'highcharts'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useLanguage } from '@/providers/LanguageProvider'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import { loadFunderCompliance, type FunderComplianceSummary } from '@/services/funderComplianceService'
import type { FunderKpi } from '@/services/funderService'
import type { KpiUnit } from '@/types/kpi'
import { useFunderData } from '@/pages/funder/useFunderData'
import '@/styles/admin-dashboard.css'
import '@/styles/funder.css'

const ACCENT = '#6d5dfb'
const GOOD = '#16a34a'
const WARN = CHART_COLORS.amber
const BAD = CHART_COLORS.danger
const STATUS_LABEL: Record<FunderKpi['status'], string> = { met: 'Met', on_track: 'On track', behind: 'Behind', no_target: 'No target', no_data: 'No data yet' }
const LABEL_STYLE = { textOutline: 'none', fontWeight: '600' }

const formatKpi = (value: number | null, unit: KpiUnit) => {
  if (value === null) return '—'
  if (unit === 'percent') return `${value}%`
  if (unit === 'currency') return formatCurrencyZAR(value)
  if (unit === 'days') return `${value} d`
  if (unit === 'rating') return `${value} / 5`
  return value.toLocaleString()
}

/** Red below 45%, amber below 65%, green from there: the lines the director's sectors page uses. */
const rateColour = (rate: number) => (rate < 45 ? BAD : rate < 65 ? WARN : GOOD)

/**
 * The funder's "is it getting better, and where is it stuck?" page: one chart per question, each with its headline
 * figure in the title. The dashboard holds the totals, so there are no cards here. Delivery is required
 * interventions completed throughout; compliance comes from a server summary (counts only).
 */
export const FunderAnalyticsPage = () => {
  const { t } = useLanguage()
  const { data, loading, error } = useFunderData()
  const { activeProgramId } = useActiveProgramId()
  const [compliance, setCompliance] = useState<FunderComplianceSummary | null>(null)
  const [complianceState, setComplianceState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const analytics = data?.analytics
  const programmes = useMemo(() => data?.programmes || [], [data])
  const kpis = data?.kpis || []
  const delivery = data?.summary.delivery.rate ?? null
  const growth = data?.summary.revenueGrowth ?? null
  const pastHalfway = (analytics?.progressBands || []).filter((band) => band.from >= 50).reduce((sum, band) => sum + band.smes, 0)
  const withRequired = (analytics?.progressBands || []).reduce((sum, band) => sum + band.smes, 0)
  const slowestArea = analytics?.areas[0]

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(() => {
      setComplianceState('loading')
      loadFunderCompliance(activeProgramId)
        .then((summary) => { if (active) { setCompliance(summary); setComplianceState('ready') } })
        .catch((reason) => { console.error(reason); if (active) setComplianceState('failed') })
    }, 0)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [activeProgramId])

  useRegisterAgentPageContext({
    pageKey: 'funder-analytics',
    pageName: 'Funder analytics',
    purpose: 'Whether delivery is improving and where it is stuck: delivery by due month, SME progress, compliance, delivery by area of support, and support against revenue growth.',
    metrics: { delivery: delivery ?? 0, onTime: analytics?.onTimeRate ?? 0, pastHalfway, compliant: compliance?.compliant ?? 0, revenueGrowth: growth ?? 0 },
  })

  const dueChart = useMemo<Highcharts.Options>(() => {
    const months = analytics?.dueMonths || []
    return {
      chart: { type: 'column', height: 300, spacing: [16, 4, 4, 4] },
      title: { text: undefined },
      legend: { align: 'left', verticalAlign: 'top', symbolRadius: 4, itemDistance: 16 },
      xAxis: { categories: months.map((month) => month.label), lineWidth: 0, tickLength: 0 },
      yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, gridLineDashStyle: 'Dash', stackLabels: { enabled: true, style: LABEL_STYLE, formatter() { return this.total ? String(this.total) : '' } } },
      tooltip: { shared: true },
      plotOptions: { column: { stacking: 'normal', borderWidth: 0, borderRadius: 3, pointPadding: 0.06, groupPadding: 0.1 } },
      series: [
        { type: 'column', name: t('Not done yet'), color: BAD, data: months.map((month) => month.open) },
        { type: 'column', name: t('Done late'), color: WARN, data: months.map((month) => month.late) },
        { type: 'column', name: t('Done on time'), color: GOOD, data: months.map((month) => month.onTime) },
      ],
    }
  }, [analytics, t])

  const progressChart = useMemo<Highcharts.Options>(() => {
    const colours = [BAD, WARN, ACCENT, GOOD]
    return {
      chart: { type: 'pie', height: 260 },
      title: { text: `<b style="font-size:26px">${pastHalfway}</b><br/><span style="font-size:11px">${t('past halfway')}</span>`, useHTML: true, verticalAlign: 'middle', y: 6 },
      tooltip: { pointFormat: '<b>{point.y}</b> SMEs' },
      plotOptions: { pie: { innerSize: '64%', borderWidth: 2, dataLabels: { enabled: true, distance: 14, format: '{point.name}: {point.y}', style: LABEL_STYLE } } },
      series: [{
        type: 'pie',
        name: t('SMEs'),
        data: (analytics?.progressBands || []).map((band, index) => ({ name: band.label, y: band.smes, color: colours[index] })),
      }],
    }
  }, [analytics, pastHalfway, t])

  const complianceChart = useMemo<Highcharts.Options>(() => {
    const total = compliance?.total || 0
    const share = total ? Math.round(((compliance?.compliant || 0) / total) * 100) : 0
    return {
      chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0] },
      title: { text: `<b style="font-size:28px">${share}%</b><br/><span style="font-size:11px">${t('{count} of {total} SMEs', undefined, { count: compliance?.compliant || 0, total })}</span>`, useHTML: true, verticalAlign: 'middle', y: 36 },
      tooltip: { pointFormat: '<b>{point.y}</b> SMEs' },
      plotOptions: { pie: { startAngle: -90, endAngle: 90, center: ['50%', '78%'], size: '150%', innerSize: '68%', borderWidth: 2, dataLabels: { enabled: false } } },
      series: [{
        type: 'pie',
        name: t('SMEs'),
        data: [
          { name: t('Fully compliant'), y: compliance?.compliant || 0, color: GOOD },
          { name: t('Expiring within 30 days'), y: compliance?.expiring || 0, color: WARN },
          { name: t('Missing or expired'), y: compliance?.missing || 0, color: BAD },
        ],
      }],
    }
  }, [compliance, t])

  const areaChart = useMemo<Highcharts.Options>(() => {
    const areas = analytics?.areas || []
    return {
      chart: { type: 'column', height: 280, spacing: [16, 4, 4, 4] },
      title: { text: undefined },
      legend: { enabled: false },
      xAxis: { categories: areas.map((row) => row.area), lineWidth: 0, tickLength: 0 },
      yAxis: { min: 0, max: 100, title: { text: undefined }, gridLineDashStyle: 'Dash', labels: { format: '{value}%' } },
      tooltip: {
        formatter() {
          const row = areas[Number(this.index ?? 0)]
          return row ? `<b>${row.area}</b><br/>${t('{completed} of {required} required done', undefined, { completed: row.completed, required: row.required })}` : ''
        },
      },
      plotOptions: { column: { borderRadius: 6, borderWidth: 0, pointPadding: 0.12, dataLabels: { enabled: true, format: '{y}%', style: LABEL_STYLE } } },
      series: [{ type: 'column', name: t('Delivery'), data: areas.map((row) => ({ y: row.rate, color: rateColour(row.rate) })) }],
    }
  }, [analytics, t])

  const scatterChart = useMemo<Highcharts.Options>(() => {
    const points = (analytics?.supportGrowth || []).filter((row) => row.revenueChange !== null)
    // Corner labels, redrawn with the chart (and kept on it) so they stay in the corners at any width.
    return {
      chart: {
        type: 'scatter',
        height: 300,
        spacing: [16, 8, 8, 4],
        events: {
          render() {
            const chart = this as Highcharts.Chart & { quadrantLabels?: Highcharts.SVGElement[] }
            chart.quadrantLabels?.forEach((label) => label.destroy())
            const { plotLeft, plotTop, plotWidth, plotHeight } = chart
            const style = { fontSize: '10.5px', fontWeight: '600', color: 'var(--admin-muted, #8a8fa3)' }
            const add = (text: string, x: number, y: number, align: 'left' | 'right') => chart.renderer.text(text, x, y).attr({ align, zIndex: 3 }).css(style).add()
            chart.quadrantLabels = [
              add(t('Growing on their own'), plotLeft + 6, plotTop + 14, 'left'),
              add(t('More support, growing'), plotLeft + plotWidth - 6, plotTop + 14, 'right'),
              add(t('Less support, declining'), plotLeft + 6, plotTop + plotHeight - 8, 'left'),
              add(t('Supported, still declining'), plotLeft + plotWidth - 6, plotTop + plotHeight - 8, 'right'),
            ]
          },
        },
      },
      title: { text: undefined },
      legend: { enabled: false },
      xAxis: { min: 0, max: 100, title: { text: t('Required support done') }, labels: { format: '{value}%' }, gridLineWidth: 0, plotLines: [{ value: 50, width: 1, color: 'rgba(138, 143, 163, .45)' }] },
      yAxis: { title: { text: t('Revenue change since joining') }, labels: { format: '{value}%' }, gridLineDashStyle: 'Dash', plotLines: [{ value: 0, width: 1.5, color: 'rgba(138, 143, 163, .6)' }] },
      tooltip: { headerFormat: '', pointFormat: '<b>{point.name}</b><br/>{point.x}% support done · {point.y}% revenue' },
      plotOptions: { scatter: { marker: { radius: 6, symbol: 'circle' } } },
      series: [{
        type: 'scatter',
        name: t('SMEs'),
        data: points.map((row) => ({ x: row.delivery, y: row.revenueChange as number, name: row.name, color: (row.revenueChange as number) < 0 ? BAD : ACCENT })),
      }],
    }
  }, [analytics, t])

  const comparison = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'bar', height: Math.max(220, programmes.length * 64 + 80) },
    title: { text: undefined },
    legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
    tooltip: { shared: true, valueSuffix: '%' },
    xAxis: { categories: programmes.map((row) => row.name), lineWidth: 0, tickLength: 0 },
    yAxis: { title: { text: undefined }, gridLineDashStyle: 'Dash', labels: { format: '{value}%' } },
    plotOptions: { bar: { borderRadius: 5, pointPadding: 0.1, groupPadding: 0.16, dataLabels: { enabled: true, format: '{y}%', style: LABEL_STYLE } } },
    series: [
      { type: 'bar', name: t('Delivery'), color: ACCENT, data: programmes.map((row) => row.delivery ?? 0) },
      { type: 'bar', name: t('Revenue growth'), color: GOOD, data: programmes.map((row) => row.revenueGrowth ?? 0) },
    ],
  }), [programmes, t])

  const empty = (description: string) => <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} />
  const hasDue = (analytics?.dueMonths || []).some((month) => month.onTime + month.late + month.open > 0)
  const hasScatter = (analytics?.supportGrowth || []).some((row) => row.revenueChange !== null)

  return (
    <DashboardPage className="funder-page admin-overview">
      {error && <Alert type="error" showIcon message={t('Your programme results could not be loaded.')} style={{ marginBottom: 16 }} />}

      <Card className="admin-card" bordered={false}>
        <div className="admin-card-head">
          <div>
            <h3>{t('Delivery by due month')}{delivery !== null && <> · <b className="funder-accent">{t('{rate}% of required done', undefined, { rate: delivery })}</b></>}</h3>
            <span>{t("Each month's interventions by what happened to them")}</span>
          </div>
          {analytics?.onTimeRate !== null && analytics?.onTimeRate !== undefined && <span className="funder-pill is-good">{t('{rate}% of finished work on time', undefined, { rate: analytics.onTimeRate })}</span>}
        </div>
        {loading ? <Skeleton active /> : hasDue ? <ThemedHighcharts options={dueChart} /> : empty(t('No interventions due in the last 12 months.'))}
      </Card>

      <Row gutter={[16, 16]} className="funder-row">
        <Col xs={24} lg={12}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div>
              <h3>{t('SME progress')}{withRequired > 0 && <> · <b className="funder-accent">{t('{count} of {total} past halfway', undefined, { count: pastHalfway, total: withRequired })}</b></>}</h3>
              <span>{t('SMEs by their own required support done')}</span>
            </div></div>
            {loading ? <Skeleton active /> : withRequired ? <ThemedHighcharts options={progressChart} /> : empty(t('No required support yet.'))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div>
              <h3>{t('Compliance')}{compliance?.total ? <> · <b className="funder-accent">{t('{count} of {total} fully compliant', undefined, { count: compliance.compliant, total: compliance.total })}</b></> : null}</h3>
              <span>{t('SMEs by the state of their required documents')}</span>
            </div></div>
            {complianceState === 'loading' ? <Skeleton active /> : complianceState === 'failed' ? empty(t('Compliance could not be loaded.')) : !compliance?.total ? empty(t('No SMEs to report on yet.')) : (
              <div className="funder-gauge">
                <ThemedHighcharts options={complianceChart} />
                <div>
                  <ul className="funder-legend">
                    <li><i style={{ background: GOOD }} />{t('Fully compliant')} · {compliance.compliant}</li>
                    <li><i style={{ background: WARN }} />{t('Expiring within 30 days')} · {compliance.expiring}</li>
                    <li><i style={{ background: BAD }} />{t('Missing or expired')} · {compliance.missing}</li>
                  </ul>
                  {compliance.missingDocuments.length > 0 && (
                    <>
                      <p className="funder-muted" style={{ margin: '12px 0 6px' }}>{t('Most often missing or expired')}</p>
                      <div className="funder-chips">{compliance.missingDocuments.map((row) => <span key={row.name}>{t(row.name)} <b>{row.smes}</b></span>)}</div>
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="funder-row">
        <Col xs={24} lg={12}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div>
              <h3>{t('Delivery by area of support')}{slowestArea && <> · <b className="funder-accent">{t('{area} slowest', undefined, { area: slowestArea.area })}</b></>}</h3>
              <span>{t('Required interventions done in each area')}</span>
            </div></div>
            {loading ? <Skeleton active /> : analytics?.areas.length ? <ThemedHighcharts options={areaChart} /> : empty(t('No required support yet.'))}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div>
              <h3>{t('Support and growth')}{growth !== null && <> · <b className="funder-accent">{t('{growth} overall', undefined, { growth: `${growth > 0 ? '+' : ''}${growth}%` })}</b></>}</h3>
              <span>{t('Each dot is an SME: support done against revenue change since joining')}</span>
            </div></div>
            {loading ? <Skeleton active /> : hasScatter ? <ThemedHighcharts options={scatterChart} /> : empty(t('Needs two months of reports'))}
          </Card>
        </Col>
      </Row>

      {/* A comparison needs two programmes, and KPIs need the incubator to set some up. */}
      {(programmes.length > 1 || kpis.length > 0) && (
        <Row gutter={[16, 16]} className="funder-row">
          {programmes.length > 1 && (
            <Col xs={24} lg={kpis.length ? 12 : 24}>
              <Card className="admin-card" bordered={false}>
                <div className="admin-card-head"><div><h3>{t('Programmes compared')}</h3><span>{t('Delivery and revenue growth since joining')}</span></div></div>
                {loading ? <Skeleton active /> : <ThemedHighcharts options={comparison} />}
              </Card>
            </Col>
          )}
          {kpis.length > 0 && (
            <Col xs={24} lg={programmes.length > 1 ? 12 : 24}>
              <Card className="admin-card" bordered={false}>
                <div className="admin-card-head"><div><h3>{t('KPIs')}</h3><span>{t('Targets against actuals for the current period')}</span></div></div>
                {loading ? <Skeleton active /> : (
                  <ul className="funder-kpis">
                    {kpis.map((row) => {
                      const share = row.target && row.actual !== null ? Math.min(100, Math.round((row.kpi.direction === 'lower' ? (row.actual <= row.target ? 1 : row.target / row.actual) : row.actual / row.target) * 100)) : 0
                      return (
                        <li key={row.kpi.id}>
                          <div className="funder-kpi-top">
                            <strong>{row.kpi.name}</strong>
                            <span className={`funder-pill is-${row.status === 'met' ? 'good' : row.status === 'behind' ? 'bad' : row.status === 'on_track' ? 'accent' : 'neutral'}`}>{t(STATUS_LABEL[row.status])}</span>
                          </div>
                          <div className="funder-kpi-figure"><b>{formatKpi(row.actual, row.kpi.unit)}</b><span>{row.target === null ? t('No target') : `${t('Target')} ${formatKpi(row.target, row.kpi.unit)}`} · {row.periodLabel}</span></div>
                          <span className={`funder-track is-${row.status}`}><b style={{ width: `${share}%` }} /></span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Card>
            </Col>
          )}
        </Row>
      )}
    </DashboardPage>
  )
}

export default FunderAnalyticsPage
