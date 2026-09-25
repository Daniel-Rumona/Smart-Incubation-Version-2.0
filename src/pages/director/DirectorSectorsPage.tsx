import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { App, Avatar, Button, Card, Col, Empty, Input, Modal, Progress, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import {
  AreaChartOutlined,
  CheckSquareOutlined,
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DollarOutlined,
  ExclamationCircleOutlined,
  FallOutlined,
  LineChartOutlined,
  SearchOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS, CHART_PALETTE } from '@/config/chartPalette'
import dayjs from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type Highcharts from 'highcharts'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { buildSectorRollups, listDirectorPortfolio } from '@/services/directorPortfolioService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import type { DirectorPortfolioSme } from '@/types/director'
import '@/styles/dashboard.css'
import '@/styles/director.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text } = Typography

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0, notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard' }).format(value || 0)

const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

const compactCurrency = (value: number) => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `R${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `R${Math.round(value / 1_000)}K`
  return `R${Math.round(value)}`
}

type AreaMetric = 'revenue' | 'employees' | 'completions'

const toMonthKey = (value: unknown) => {
  const date = value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
    ? (value as { toDate: () => Date }).toDate()
    : null
  return date ? dayjs(date).format('YYYY-MM') : null
}

const riskColor = (risk: string) => risk === 'High' ? 'red' : risk === 'Medium' ? 'orange' : 'green'
const initials = (name: string) => name.split(' ').filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')

type RiskReason = {
  key: string
  severity: 'High' | 'Medium'
  icon: ReactNode
  title: string
  detail: string
  short: string
  gauge?: { value: number; max: number; mediumAt: number; highAt: number }
}

/** Mirrors deriveRisk in directorPortfolioService: progress < 45 / growth < 20 is High, < 65 / < 40 is Medium. */
const buildRiskReasons = (sme: DirectorPortfolioSme): RiskReason[] => {
  const reasons: RiskReason[] = []
  const { progress, execution, metrics } = sme

  if (progress < 65) {
    reasons.push({
      key: 'progress',
      severity: progress < 45 ? 'High' : 'Medium',
      icon: <CheckCircleOutlined />,
      title: tr('Delivery progress is behind'),
      detail: `Average intervention progress is ${progress}%${progress < 45 ? ', under the 45% high-risk line' : ', under the 65% healthy line'}.${execution.required ? ` ${execution.completed} of ${execution.required} required interventions are complete.` : ''}`,
      short: `${progress}% progress`,
      gauge: { value: progress, max: 100, mediumAt: 65, highAt: 45 },
    })
  }

  if (metrics.growthRate < 40) {
    reasons.push({
      key: 'growth',
      severity: metrics.growthRate < 20 ? 'High' : 'Medium',
      icon: <FallOutlined />,
      title: metrics.growthRate < 0 ? 'Revenue is declining' : 'Revenue growth is weak',
      detail: metrics.growthRate < 0
        ? `Revenue has fallen ${Math.abs(metrics.growthRate)}% over the last six months of recorded history.`
        : `Revenue grew only ${metrics.growthRate}% over the last six months, under the ${metrics.growthRate < 20 ? '20% high-risk' : '40% healthy'} line.`,
      short: metrics.growthRate < 0 ? `Revenue ${metrics.growthRate}%` : `Growth ${metrics.growthRate}%`,
      gauge: { value: Math.max(metrics.growthRate, 0), max: 100, mediumAt: 40, highAt: 20 },
    })
  }

  if (execution.overdue > 0) {
    reasons.push({
      key: 'overdue',
      severity: execution.overdue >= 2 ? 'High' : 'Medium',
      icon: <ClockCircleOutlined />,
      title: `${execution.overdue} overdue intervention${execution.overdue === 1 ? '' : 's'}`,
      detail: tr('These were due before today and are not yet completed.'),
      short: `${execution.overdue} overdue`,
    })
  }

  if (execution.unresponsive > 0) {
    reasons.push({
      key: 'unresponsive',
      severity: 'Medium',
      icon: <ExclamationCircleOutlined />,
      title: `Slow to respond (${execution.unresponsive})`,
      detail: tr('The consultant accepted these interventions but the SME has not responded for 7 or more days.'),
      short: `${execution.unresponsive} unresponsive`,
    })
  }

  return reasons.sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'High' ? -1 : 1))
}

const severityColor = (severity: 'High' | 'Medium') => (severity === 'High' ? CHART_COLORS.danger : CHART_COLORS.amber)

export const DirectorSectorsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const { activeProgramId } = useActiveProgramId()
  const [rows, setRows] = useState<DirectorPortfolioSme[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('All')
  const [drilldownSector, setDrilldownSector] = useState<string | null>(null)
  const [riskSme, setRiskSme] = useState<DirectorPortfolioSme | null>(null)
  const [areaMetric, setAreaMetric] = useState<AreaMetric>('completions')
  const [completions, setCompletions] = useState<Array<{ participantId: string; month: string }>>([])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!user) return
      setLoading(true)
      try {
        const data = await listDirectorPortfolio(user, activeProgramId)
        const assignmentDocs = await getDocs(query(collection(getFirebaseDb(), 'assignedInterventions'), ...(user.companyCode ? [where('companyCode', '==', user.companyCode)] : [])))
          .then(snapshot => snapshot.docs.map(row => row.data()))
          .catch(() => [])
        if (mounted) {
          setRows(data)
          setCompletions(assignmentDocs.flatMap(item => {
            const finished = norm(item.status) === 'completed' || norm(item.completionStatus) === 'completed'
              || (norm(item.assigneeCompletionStatus) === 'done' && norm(item.participantCompletionStatus) === 'confirmed')
            const month = toMonthKey(item.completedAt) || toMonthKey(item.completionConfirmedAt)
            return finished && month ? [{ participantId: String(item.participantId || ''), month }] : []
          }))
        }
      } catch (error) {
        console.error(error)
        message.error(t('Sector data could not be loaded.'))
        if (mounted) setRows([])
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [activeProgramId, message, user, t])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter(row => (!term || [row.name, row.sector].some(value => value.toLowerCase().includes(term))) && (sector === 'All' || row.sector === sector))
  }, [rows, search, sector])

  const watchlist = useMemo(
    () => filteredRows.filter(row => row.risk !== 'Low').sort((a, b) => (a.risk === b.risk ? a.progress - b.progress : a.risk === 'High' ? -1 : 1)),
    [filteredRows],
  )

  const rollups = useMemo(() => buildSectorRollups(filteredRows), [filteredRows])
  const metrics = useMemo(() => ({
    sectors: rollups.length,
    smes: filteredRows.length,
    revenue: filteredRows.reduce((sum, row) => sum + row.metrics.revenue, 0),
    highRisk: filteredRows.filter(row => row.risk === 'High').length,
  }), [filteredRows, rollups.length])

  useRegisterAgentPageContext({
    pageKey: 'director-sectors',
    pageName: 'Director Sectors',
    purpose: 'Shows sector-level performance, revenue concentration and risk distribution.',
    currentFilters: { search, sector },
    metrics,
    dataSummary: { sectors: rollups.length, visibleSmes: filteredRows.length },
  })

  const maxSectorRevenue = useMemo(() => Math.max(1, ...rollups.map(row => row.totalRevenue)), [rollups])

  const drilldownRollup = useMemo(() => rollups.find(row => row.sector === drilldownSector) || null, [drilldownSector, rollups])

  const monthlyRevenueOptions = useMemo<Highcharts.Options>(() => {
    const byMonth = new Map<string, number>()
    drilldownRollup?.smes.forEach(sme => sme.trend.forEach(point => byMonth.set(point.key, (byMonth.get(point.key) || 0) + point.revenue)))
    const months = Array.from(byMonth.entries()).sort((left, right) => left[0].localeCompare(right[0]))
    return {
      chart: { type: 'spline', height: 320 },
      title: { text: undefined },
      xAxis: { categories: months.map(([key]) => dayjs(`${key}-01`).format('MMM YY')) },
      yAxis: { min: 0, title: { text: undefined }, labels: { formatter() { return compactCurrency(Number(this.value)) } } },
      tooltip: { pointFormatter() { return `<b>${formatCurrency(Number(this.y))}</b>` } },
      legend: { enabled: false },
      plotOptions: { spline: { lineWidth: 3, marker: { enabled: true, radius: 5 }, dataLabels: { enabled: true, formatter() { return compactCurrency(Number(this.y)) } } } },
      series: [{ type: 'spline' as const, name: tr('Revenue'), color: CHART_COLORS.violet, data: months.map(([, revenue]) => revenue) }],
    }
  }, [drilldownRollup])

  const areaSeries = useMemo(() => {
    if (areaMetric === 'completions') {
      const keys = Array.from({ length: 12 }, (_, index) => dayjs().subtract(11 - index, 'month').format('YYYY-MM'))
      const sectorByParticipant = new Map<string, string>()
      rollups.forEach(row => row.smes.forEach(sme => sectorByParticipant.set(sme.id, row.sector)))
      const counts = new Map<string, Map<string, number>>()
      completions.forEach(item => {
        const sectorName = sectorByParticipant.get(item.participantId)
        if (!sectorName) return
        const bySector = counts.get(sectorName) || new Map<string, number>()
        bySector.set(item.month, (bySector.get(item.month) || 0) + 1)
        counts.set(sectorName, bySector)
      })
      return {
        keys,
        series: rollups.map(row => ({ name: row.sector, data: keys.map(key => counts.get(row.sector)?.get(key) || 0) })).filter(item => item.data.some(value => value > 0)),
      }
    }
    const months = new Set<string>()
    rollups.forEach(row => row.smes.forEach(sme => sme.trend.forEach(point => months.add(point.key))))
    const keys = Array.from(months).sort()
    return {
      keys,
      series: rollups.map(row => ({
        name: row.sector,
        data: keys.map(key => row.smes.reduce((sum, sme) => {
          const point = sme.trend.find(item => item.key === key)
          return sum + (point ? (areaMetric === 'revenue' ? point.revenue : point.employees) : 0)
        }, 0)),
      })).filter(item => item.data.some(value => value > 0)),
    }
  }, [areaMetric, completions, rollups])

  const areaOptions = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'areaspline', height: 320 },
    title: { text: undefined },
    xAxis: { categories: areaSeries.keys.map(key => dayjs(`${key}-01`).format('MMM YY')), tickmarkPlacement: 'on' },
    yAxis: {
      min: 0,
      title: { text: undefined },
      allowDecimals: false,
      labels: { formatter() { return areaMetric === 'revenue' ? compactCurrency(Number(this.value)) : String(this.value) } },
    },
    tooltip: { shared: true, valuePrefix: areaMetric === 'revenue' ? 'R ' : undefined },
    plotOptions: { areaspline: { stacking: 'normal', fillOpacity: 0.35, lineWidth: 2, marker: { enabled: false } } },
    series: areaSeries.series.map((item, index) => ({ type: 'areaspline' as const, name: item.name, data: item.data, color: CHART_PALETTE[index % CHART_PALETTE.length] })),
  }), [areaMetric, areaSeries])

  return (
    <DashboardPage>
      <FilterBar
        primary={
          <>
            <Input prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Search sector or SME')} allowClear />
            <Select value={sector} onChange={setSector} options={[{ value: 'All', label: t('All sectors') }, ...Array.from(new Set(rows.map(row => row.sector))).sort().map(value => ({ value, label: value }))]} />
          </>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            loading={loading}
            className="dashboard-section-card motion-card"
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 } }}
            title={<Space>{drilldownRollup ? <LineChartOutlined /> : <DollarOutlined />}{drilldownRollup ? `${drilldownRollup.sector} · monthly revenue` : t('Sector Revenue')}</Space>}
            extra={drilldownRollup
              ? <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setDrilldownSector(null)}>{t('Back')}</Button>
              : <Text type="secondary">{t('Click a bar for month-on-month')}</Text>}
          >
            {!rollups.length ? <Empty description={t('No sector revenue found.')} /> : drilldownRollup ? (
              drilldownRollup.smes.some(sme => sme.trend.length) ? <ThemedHighcharts options={monthlyRevenueOptions} /> : <Empty description={t('No monthly revenue history recorded for this sector.')} />
            ) : (
              <div style={{ flex: 1, maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
                {rollups.map((row, index) => (
                  <button key={row.sector} type="button" className="director-click-row" style={{ flex: '1 0 auto', flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 2 }} onClick={() => setDrilldownSector(row.sector)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <Text strong>{row.sector}</Text>
                      <Space size={6}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{row.companies} {t('SME')}{row.companies === 1 ? '' : 's'} · {row.avgProgress}{t('% progress')}</Text>
                        {row.highRisk > 0 && <Tag color="red" bordered={false} style={{ margin: 0 }}>{row.highRisk} {t('high')}</Tag>}
                        {row.mediumRisk > 0 && <Tag color="orange" bordered={false} style={{ margin: 0 }}>{row.mediumRisk} {t('medium')}</Tag>}
                      </Space>
                    </div>
                    <Progress
                      percent={Math.round((row.totalRevenue / maxSectorRevenue) * 100)}
                      strokeColor={[CHART_COLORS.primary, CHART_COLORS.success, CHART_COLORS.violet, CHART_COLORS.teal, CHART_COLORS.amber, CHART_COLORS.pink, CHART_COLORS.cyan, CHART_COLORS.danger][index % 8]}
                      format={() => <strong>{compactCurrency(row.totalRevenue)}</strong>}
                    />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><WarningOutlined /> {t('Risk Watchlist')}</Space>} extra={<Text type="secondary">{t('Click an SME to see why')}</Text>} style={{ height: '100%' }}>
            {watchlist.length ? (
              <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
                {watchlist.map(row => (
                  <button key={row.id} type="button" className="director-click-row" onClick={() => setRiskSme(row)}>
                    <Avatar shape="circle" src={row.photoUrl || undefined} style={{ flexShrink: 0 }}>{initials(row.name)}</Avatar>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Text strong ellipsis>{row.name}</Text>
                        <Tag color={riskColor(row.risk)} style={{ marginInlineEnd: 0 }}>{row.risk}</Tag>
                      </div>
                      <Text type="secondary" style={{ fontSize: 12 }}>{row.sector}</Text>
                      <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {buildRiskReasons(row).slice(0, 3).map(reason => <Tag key={reason.key} bordered={false} color={reason.severity === 'High' ? 'red' : 'orange'} style={{ margin: 0 }}>{reason.short}</Tag>)}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : <Empty description={t('No high or medium risk SMEs found.')} />}
          </Card>
        </Col>
        <Col span={24}>
          <Card
            loading={loading}
            className="dashboard-section-card motion-card"
            title={<Space><AreaChartOutlined /> {areaMetric === 'completions' ? t('Interventions Completed · Month on Month') : t('Month on Month')}</Space>}
            extra={(
              <Segmented<AreaMetric>
                value={areaMetric}
                onChange={setAreaMetric}
                options={[
                  { label: t('Revenue'), value: 'revenue', icon: <DollarOutlined /> },
                  { label: t('Employees'), value: 'employees', icon: <TeamOutlined /> },
                  { label: t('Completions'), value: 'completions', icon: <CheckSquareOutlined /> },
                ]}
              />
            )}
          >
            {areaSeries.series.length ? <ThemedHighcharts options={areaOptions} /> : <Empty description={t('No monthly history recorded yet.')} />}
          </Card>
        </Col>
      </Row>

      <Modal
        open={!!riskSme}
        onCancel={() => setRiskSme(null)}
        footer={null}
        width={760}
        destroyOnClose
        title={riskSme ? (
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, lineHeight: 1.2 }}>{riskSme.name}</div>
            <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7 }}>{[riskSme.sector, riskSme.programName].filter(Boolean).join(' · ')}</div>
          </div>
        ) : ''}
      >
        {riskSme && (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><DashboardMetricCard icon={<WarningOutlined />} iconClassName="is-attention" label={t('Risk level')} value={riskSme.risk} /></Col>
              <Col xs={12} md={6}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('Progress')} value={`${riskSme.progress}%`} hint={`${riskSme.execution.completed}/${riskSme.execution.required} completed`} /></Col>
              <Col xs={12} md={6}><DashboardMetricCard icon={<FallOutlined />} label={t('Revenue growth')} value={`${riskSme.metrics.growthRate > 0 ? '+' : ''}${riskSme.metrics.growthRate}%`} hint={t('Last 6 months')} /></Col>
              <Col xs={12} md={6}><DashboardMetricCard icon={<ClockCircleOutlined />} label={t('Overdue')} value={riskSme.execution.overdue} hint={`${riskSme.execution.unresponsive} unresponsive`} /></Col>
            </Row>

            <div>
              <Text strong style={{ display: 'block', marginBottom: 10 }}>{t('Why this SME is')} {riskSme.risk.toLowerCase()} {t('risk')}</Text>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {buildRiskReasons(riskSme).map(reason => (
                  <div key={reason.key} style={{ display: 'flex', gap: 14, padding: '12px 14px', borderRadius: 14, background: `${severityColor(reason.severity)}12` }}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: severityColor(reason.severity), background: `${severityColor(reason.severity)}22`, flexShrink: 0 }}>{reason.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <Text strong>{reason.title}</Text>
                        <Tag color={reason.severity === 'High' ? 'red' : 'orange'} style={{ marginInlineEnd: 0 }}>{reason.severity}</Tag>
                      </div>
                      <Text type="secondary" style={{ fontSize: 13 }}>{reason.detail}</Text>
                      {reason.gauge && (
                        <div style={{ marginTop: 6 }}>
                          <Progress percent={Math.min(100, Math.round((reason.gauge.value / reason.gauge.max) * 100))} strokeColor={severityColor(reason.severity)} size="small" format={() => `${reason.gauge!.value}%`} />
                          <Text type="secondary" style={{ fontSize: 11 }}>{t('High risk below')} {reason.gauge.highAt}{t('% · healthy from')} {reason.gauge.mediumAt}%</Text>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </Space>
            </div>
          </Space>
        )}
      </Modal>
    </DashboardPage>
  )
}

export default DirectorSectorsPage
