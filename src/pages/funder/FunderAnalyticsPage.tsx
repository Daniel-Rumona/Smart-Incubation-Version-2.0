import { useMemo } from 'react'
import { Alert, Card, Col, Empty, Row, Skeleton } from 'antd'
import { AimOutlined, CheckCircleOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons'
import type Highcharts from 'highcharts'
import { AdminKpiTile, AdminShareRing } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import type { FunderKpi, FunderProgramme } from '@/services/funderService'
import type { KpiUnit } from '@/types/kpi'
import { useFunderData } from '@/pages/funder/useFunderData'
import '@/styles/admin-dashboard.css'
import '@/styles/funder.css'

const ACCENT = '#6d5dfb'
const ACCENT_DEEP = '#4338ca'
const STATUS_LABEL: Record<FunderKpi['status'], string> = { met: 'Met', on_track: 'On track', behind: 'Behind', no_target: 'No target', no_data: 'No data yet' }

const formatKpi = (value: number | null, unit: KpiUnit) => {
  if (value === null) return '—'
  if (unit === 'percent') return `${value}%`
  if (unit === 'currency') return formatCurrencyZAR(value)
  if (unit === 'days') return `${value} d`
  if (unit === 'rating') return `${value} / 5`
  return value.toLocaleString()
}

/** Programme results side by side, KPI targets against actuals, and how support is being delivered. */
export const FunderAnalyticsPage = () => {
  const { t } = useLanguage()
  const { data, loading, error } = useFunderData()
  const programmes = useMemo(() => data?.programmes || [], [data])
  const kpis = data?.kpis || []
  const delivered = programmes.reduce((sum, row) => sum + (row.completionRate === null ? 0 : 1), 0)
  const avgCompletion = delivered ? Math.round(programmes.reduce((sum, row) => sum + (row.completionRate || 0), 0) / delivered) : null
  const timed = programmes.filter((row) => row.onTimeRate !== null)
  const avgOnTime = timed.length ? Math.round(timed.reduce((sum, row) => sum + (row.onTimeRate || 0), 0) / timed.length) : null
  const highRisk = programmes.reduce((sum, row) => sum + row.highRisk, 0)
  const kpisOnTrack = kpis.filter((row) => row.status === 'met' || row.status === 'on_track').length
  const kpisWithTarget = kpis.filter((row) => row.target !== null).length

  useRegisterAgentPageContext({
    pageKey: 'funder-analytics',
    pageName: 'Funder analytics',
    purpose: 'Compare the funded programmes, KPI targets against actuals, and how support is being delivered.',
    metrics: { programmes: programmes.length, avgCompletion: avgCompletion ?? 0, avgOnTime: avgOnTime ?? 0, kpisOnTrack },
  })

  const comparison = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'bar', height: Math.max(220, programmes.length * 64 + 80) },
    title: { text: undefined },
    legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
    tooltip: { shared: true, valueSuffix: '%' },
    xAxis: { categories: programmes.map((row) => row.name), lineWidth: 0, tickLength: 0 },
    yAxis: { min: 0, max: 100, title: { text: undefined }, gridLineDashStyle: 'Dash', labels: { format: '{value}%' } },
    plotOptions: { bar: { borderRadius: 5, pointPadding: 0.1, groupPadding: 0.16 } },
    series: [
      { type: 'bar', name: t('Average SME progress'), color: ACCENT, data: programmes.map((row) => row.avgProgress) },
      { type: 'bar', name: t('Support completed'), color: ACCENT_DEEP, data: programmes.map((row) => row.completionRate ?? 0) },
    ],
  }), [programmes, t])

  return (
    <DashboardPage className="funder-page admin-overview">
      {error && <Alert type="error" showIcon message={t('Your programme results could not be loaded.')} style={{ marginBottom: 16 }} />}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<CheckCircleOutlined />} label={t('Support completed')} value={avgCompletion === null ? '—' : `${avgCompletion}%`} visual={avgCompletion === null ? undefined : <AdminShareRing value={avgCompletion} total={100} />} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<ClockCircleOutlined />} label={t('Delivered on time')} value={avgOnTime === null ? '—' : `${avgOnTime}%`} visual={avgOnTime === null ? undefined : <AdminShareRing value={avgOnTime} total={100} />} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<AimOutlined />} label={t('KPIs met or on track')} value={kpisWithTarget ? `${kpisOnTrack} / ${kpisWithTarget}` : '—'} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<WarningOutlined />} label={t('SMEs at high risk')} value={highRisk} /></Col>
      </Row>

      <Row gutter={[16, 16]} className="funder-row">
        <Col xs={24} lg={12}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div><h3>{t('Programmes compared')}</h3><span>{t('Average SME progress and support completed')}</span></div></div>
            {loading ? <Skeleton active /> : programmes.length ? <ThemedHighcharts options={comparison} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card className="admin-card" bordered={false}>
            <div className="admin-card-head"><div><h3>{t('KPIs')}</h3><span>{t('Targets against actuals for the current period')}</span></div></div>
            {loading ? <Skeleton active /> : kpis.length ? (
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
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Your programme has no KPIs set up yet.')} />}
          </Card>
        </Col>
      </Row>

      <Card className="admin-card funder-row" bordered={false}>
        <div className="admin-card-head"><div><h3>{t('Programme results')}</h3><span>{t('Totals for each programme you fund')}</span></div></div>
        <ResponsiveDataView<FunderProgramme>
          rowKey="id"
          loading={loading}
          rows={programmes}
          emptyText={t('No programmes linked to your account.')}
          columns={[
            { title: t('Programme'), dataIndex: 'name', render: (value: string) => <strong>{value}</strong> },
            { title: t('SMEs'), dataIndex: 'smes' },
            { title: t('Average progress'), dataIndex: 'avgProgress', render: (value: number) => `${value}%` },
            { title: t('Revenue'), dataIndex: 'revenue', render: (value: number) => formatCurrencyZAR(value) },
            { title: t('Jobs'), dataIndex: 'employees' },
            { title: t('Support completed'), dataIndex: 'completionRate', render: (value: number | null) => value === null ? '—' : `${value}%` },
            { title: t('On time'), dataIndex: 'onTimeRate', render: (value: number | null) => value === null ? '—' : `${value}%` },
            { title: t('Overdue'), dataIndex: 'overdue' },
            { title: t('High risk'), dataIndex: 'highRisk' },
          ]}
          renderCard={(row) => (
            <div className="funder-activity-card">
              <strong>{row.name}</strong>
              <span>{t('{count} SMEs · {progress}% average progress', undefined, { count: row.smes, progress: row.avgProgress })}</span>
              <small>{[formatCurrencyZAR(row.revenue), `${row.employees} ${t('Jobs').toLowerCase()}`, row.completionRate === null ? null : `${row.completionRate}% ${t('Support completed').toLowerCase()}`].filter(Boolean).join(' · ')}</small>
            </div>
          )}
        />
      </Card>
    </DashboardPage>
  )
}

export default FunderAnalyticsPage
