import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App, Button, Card, Checkbox, Col, DatePicker, Empty, Form, Grid, Input, InputNumber,
  Modal, Pagination, Progress, Row, Select, Skeleton, Space, Tag, Typography, Upload,
} from 'antd'
import type { UploadFile } from 'antd/es/upload/interface'
import {
  CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined,
  DollarCircleOutlined, EditOutlined, FileAddOutlined,
  PlusOutlined, ReloadOutlined, SearchOutlined, TeamOutlined, UploadOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import type Highcharts from 'highcharts'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  listSmeMetrics, listSmeOpportunities, monthToDate, saveAssistedMonthly,
  saveAssistedOpportunity, type MetricField, type MetricSection, type MonthlyRecord,
  type OpportunityStage, type OpportunityType, type SmeOpportunity, type SmeRow,
} from '@/services/smeMetricsService'
import '@/styles/sme-metrics.css'

dayjs.extend(quarterOfYear)
const { Text } = Typography
const { useBreakpoint } = Grid
/** Businesses shown per page in the reporting list. */
const LIST_PAGE_SIZE = 5
const money = (n: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n)
const count = (n: number) => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(n)
const monthId = (d: Dayjs) => d.format('MMMM YYYY')
const has = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const sections: { key: MetricSection; label: string; fields: MetricField[] }[] = [
  { key: 'revenue', label: 'Revenue', fields: ['revenue'] },
  { key: 'employees', label: 'Employees', fields: ['headPermanent', 'headTemporary'] },
  { key: 'sales', label: 'Orders & customers', fields: ['orders', 'customers'] },
  { key: 'traffic', label: 'Website traffic', fields: ['traffic'] },
  { key: 'networking', label: 'Networking', fields: ['networking'] },
]
const opportunityStages: OpportunityStage[] = ['identified', 'preparing', 'submitted', 'shortlisted', 'awarded', 'unsuccessful', 'withdrawn']
const stageColor: Record<OpportunityStage, string> = {
  identified: 'blue', preparing: 'gold', submitted: 'processing', shortlisted: 'cyan',
  awarded: 'green', unsuccessful: 'red', withdrawn: 'default',
}
const formatStage = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
const fieldLabel: Record<MetricField, string> = {
  revenue: 'Revenue (R)', headPermanent: 'Permanent employees', headTemporary: 'Temporary employees',
  orders: 'Orders', customers: 'New customers', traffic: 'Website visits', networking: 'Networking events',
}
const emptyMetric = (record: MonthlyRecord | undefined, field: MetricField) => record && has(record[field]) ? record[field] : undefined
const asDate = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (value instanceof Date) return dayjs(value)
  if (typeof value === 'string' || typeof value === 'number') return dayjs(value)
  if (typeof value === 'object' && value !== null) {
    const dateObject = value as { toDate?: () => Date; seconds?: number }
    if (typeof dateObject.toDate === 'function') return dayjs(dateObject.toDate())
    if (typeof dateObject.seconds === 'number') return dayjs(dateObject.seconds * 1000)
  }
  return null
}
const rangeMonths = (start: Dayjs, end: Dayjs) => {
  const result: Dayjs[] = []
  let cursor = start.startOf('month')
  while (!cursor.isAfter(end, 'month')) { result.push(cursor); cursor = cursor.add(1, 'month') }
  return result
}
const periodMetrics = (row: SmeRow, start: Dayjs, end: Dayjs) => {
  const selected = row.monthly.filter(m => {
    const date = monthToDate(m.month)
    return date && !date.isBefore(start, 'month') && !date.isAfter(end, 'month')
  })
  const revenueValues = selected.filter(m => has(m.revenue))
  const revenue = revenueValues.reduce((sum, m) => sum + (m.revenue || 0), 0)
  const employeeRecord = selected.find(m => has(m.headPermanent) || has(m.headTemporary))
  const employees = employeeRecord && has(employeeRecord.headPermanent) && has(employeeRecord.headTemporary)
    ? employeeRecord.headPermanent + employeeRecord.headTemporary : null
  const customers = selected.filter(m => has(m.customers)).reduce((sum, m) => sum + (m.customers || 0), 0)
  const accepted = asDate(row.acceptedAt)
  const monthCount = rangeMonths(start, end).filter(d => !d.isAfter(dayjs(), 'month') && (!accepted || !d.isBefore(accepted, 'month'))).length
  const reported = new Set(selected.filter(m => { const d = monthToDate(m.month); return d && !d.isAfter(dayjs(), 'month') && (!accepted || !d.isBefore(accepted, 'month')) }).map(m => monthToDate(m.month)?.format('YYYY-MM')).filter(Boolean)).size
  return {
    revenue, revenueReported: revenueValues.length > 0, employees,
    customers, customersReported: selected.some(m => has(m.customers)),
    reported, expected: monthCount, outstanding: Math.max(0, monthCount - reported),
  }
}

type MonthlyForm = Partial<Record<MetricField, number>> & { month: Dayjs }
type OpportunityForm = { title: string; buyer: string; type: OpportunityType; stage: OpportunityStage; value?: number; submittedAt?: Dayjs; closingAt?: Dayjs; notes?: string }

export const SmeMetricsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const screens = useBreakpoint()
  const mobile = !screens.md
  const [rows, setRows] = useState<SmeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('all')
  const [status, setStatus] = useState('all')
  const [start, setStart] = useState(dayjs().startOf('year'))
  const [end, setEnd] = useState(dayjs().endOf('month'))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [monthlyOpen, setMonthlyOpen] = useState(false)
  const [opportunityOpen, setOpportunityOpen] = useState(false)
  const [editingOpportunity, setEditingOpportunity] = useState<string | null>(null)
  const [opportunities, setOpportunities] = useState<SmeOpportunity[]>([])
  const [opportunitiesLoading, setOpportunitiesLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [chosenSections, setChosenSections] = useState<MetricSection[]>(['revenue', 'employees'])
  const [revenueFiles, setRevenueFiles] = useState<UploadFile[]>([])
  const [employeeFiles, setEmployeeFiles] = useState<UploadFile[]>([])
  const [monthlyForm] = Form.useForm<MonthlyForm>()
  const [opportunityForm] = Form.useForm<OpportunityForm>()

  useEffect(() => {
    let active = true
    setLoading(true)
    void listSmeMetrics({
      activeProgramId, isAllPrograms, companyCode: user?.companyCode,
      canAccessProgram: (programId) => matchesActiveProgram(user, activeProgramId, programId),
    }).then(items => { if (active) setRows(items) }).catch(error => {
      console.error(error)
      if (active) message.error(t('Unable to load SME performance. Please retry.'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [activeProgramId, isAllPrograms, user, reload, message, t])

  const selected = rows.find(row => row.id === selectedId) || null
  const sectorOptions = useMemo(() => [...new Set(rows.map(r => r.sector))].sort(), [rows])
  const stats = useMemo(() => rows.map(row => ({ ...row, ...periodMetrics(row, start, end) })), [rows, start, end])
  const filtered = useMemo(() => stats.filter(row => {
    if (sector !== 'all' && row.sector !== sector) return false
    if (status === 'missing' && row.outstanding === 0) return false
    if (status === 'reported' && row.reported === 0) return false
    if (status === 'awaiting' && !row.monthly.some(m => m.verificationStatus === 'awaiting_confirmation')) return false
    return `${row.businessName} ${row.sector} ${row.programName}`.toLowerCase().includes(search.trim().toLowerCase())
  }), [stats, search, sector, status])
  // The business list shows a few at a time; changing the filters goes back to the first page.
  const [listPage, setListPage] = useState(1)
  useEffect(() => { setListPage(1) }, [search, sector, status, start, end, activeProgramId])
  const lastListPage = Math.max(1, Math.ceil(filtered.length / LIST_PAGE_SIZE))
  const currentListPage = Math.min(listPage, lastListPage)
  const pagedRows = useMemo(() => filtered.slice((currentListPage - 1) * LIST_PAGE_SIZE, currentListPage * LIST_PAGE_SIZE), [filtered, currentListPage])
  const totals = useMemo(() => {
    const revenue = filtered.reduce((sum, row) => sum + row.revenue, 0)
    const employees = filtered.reduce((sum, row) => sum + (row.employees || 0), 0)
    return {
      revenue, employees, reported: filtered.filter(r => r.reported > 0).length,
      missing: filtered.filter(r => r.outstanding > 0).length,
      employeeCoverage: filtered.filter(r => r.employees !== null).length,
      revenueCoverage: filtered.filter(r => r.revenueReported).length,
    }
  }, [filtered])

  useRegisterAgentPageContext({
    pageKey: 'operations-sme-metrics', pageName: 'SME Metrics',
    purpose: 'Portfolio performance, reporting coverage and authorized operations-assisted reporting.',
    currentFilters: { program: isAllPrograms ? 'all' : activeProgramId, search, sector, status, from: start.format('YYYY-MM'), to: end.format('YYYY-MM') },
    metrics: { smes: filtered.length, reportedSmes: totals.reported, revenueReported: totals.revenue, employeesWithReportedHeadcount: totals.employees, smesWithMissingMonths: totals.missing },
    dataSummary: { businesses: filtered.slice(0, 15).map(r => ({ name: r.businessName, reportedMonths: r.reported, outstandingMonths: r.outstanding })), selectedSme: selected?.businessName || null },
  })

  const loadOpportunities = useCallback(async (id: string) => {
    setOpportunitiesLoading(true)
    try { setOpportunities(await listSmeOpportunities(id)) }
    catch (error) { console.error(error); message.error(t('Unable to load market opportunities.')) }
    finally { setOpportunitiesLoading(false) }
  }, [message, t])
  const openDetail = (id: string) => { setSelectedId(id); setOpportunities([]); void loadOpportunities(id) }
  const openMonthly = (row: SmeRow) => {
    setSelectedId(row.id)
    const month = dayjs().startOf('month')
    setChosenSections(['revenue', 'employees'])
    setRevenueFiles([]); setEmployeeFiles([])
    const existing = row.monthly.find(m => monthToDate(m.month)?.isSame(month, 'month'))
    monthlyForm.resetFields()
    monthlyForm.setFieldsValue({ month, revenue: emptyMetric(existing, 'revenue'), headPermanent: emptyMetric(existing, 'headPermanent'), headTemporary: emptyMetric(existing, 'headTemporary') })
    setMonthlyOpen(true)
  }
  const setMonthlyMonth = (next: Dayjs | null) => {
    if (!next || !selected) return
    const existing = selected.monthly.find(m => monthToDate(m.month)?.isSame(next, 'month'))
    monthlyForm.setFieldsValue({
      month: next, revenue: emptyMetric(existing,'revenue'), headPermanent: emptyMetric(existing,'headPermanent'),
      headTemporary: emptyMetric(existing,'headTemporary'), orders: emptyMetric(existing,'orders'),
      customers: emptyMetric(existing,'customers'), traffic: emptyMetric(existing,'traffic'), networking: emptyMetric(existing,'networking'),
    })
    setRevenueFiles([]); setEmployeeFiles([])
  }
  const submitMonthly = async (values: MonthlyForm) => {
    if (!selected || !user?.uid) return message.error(t('No authorized SME or staff account selected.'))
    try {
      setSaving(true)
      const data: Partial<Record<MetricField, number>> = {}
      for (const section of sections.filter(s => chosenSections.includes(s.key))) {
        for (const field of section.fields) {
          const value = values[field]
          if (!has(value) || value < 0) throw new Error(`Enter a valid ${fieldLabel[field].toLowerCase()}.`)
          data[field] = value
        }
      }
      const record = await saveAssistedMonthly({
        participantId: selected.id, month: monthId(values.month), values: data,
        sections: chosenSections, actorUid: user.uid, actorEmail: user.email || '',
        revenueFiles: revenueFiles.map(f => f.originFileObj).filter((f): f is NonNullable<typeof f> => f instanceof File),
        employeeFiles: employeeFiles.map(f => f.originFileObj).filter((f): f is NonNullable<typeof f> => f instanceof File),
      })
      setRows(current => current.map(row => row.id === selected.id ? {
        ...row, monthly: [record, ...row.monthly.filter(m => !monthToDate(m.month)?.isSame(values.month, 'month'))]
          .sort((a,b) => (monthToDate(b.month)?.valueOf() || 0) - (monthToDate(a.month)?.valueOf() || 0)),
      } : row))
      setMonthlyOpen(false)
      message.success(t('Metrics saved. Awaiting SME confirmation.'))
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : t('Could not save this report.'))
    } finally { setSaving(false) }
  }
  const openOpportunity = (opportunity?: SmeOpportunity) => {
    setEditingOpportunity(opportunity?.id || null)
    opportunityForm.resetFields()
    opportunityForm.setFieldsValue(opportunity ? {
      title: opportunity.title, buyer: opportunity.buyer, type: opportunity.type, stage: opportunity.stage,
      value: opportunity.value, submittedAt: opportunity.submittedAt ? dayjs(opportunity.submittedAt) : undefined,
      closingAt: opportunity.closingAt ? dayjs(opportunity.closingAt) : undefined, notes: opportunity.notes,
    } : { type: 'RFQ', stage: 'identified' })
    setOpportunityOpen(true)
  }
  const submitOpportunity = async (values: OpportunityForm) => {
    if (!selected || !user?.uid) return
    try {
      setSaving(true)
      await saveAssistedOpportunity({
        participantId: selected.id, opportunityId: editingOpportunity || undefined, actorUid: user.uid,
        title: values.title, buyer: values.buyer || '', type: values.type, stage: values.stage,
        value: values.value, submittedAt: values.submittedAt?.format('YYYY-MM-DD'),
        closingAt: values.closingAt?.format('YYYY-MM-DD'), notes: values.notes,
      })
      await loadOpportunities(selected.id)
      setOpportunityOpen(false)
      message.success(t('Opportunity saved. Awaiting SME confirmation.'))
    } catch (error) {
      console.error(error); message.error(t('Unable to save opportunity.'))
    } finally { setSaving(false) }
  }

  const trendMonths = useMemo(() => rangeMonths(start, end).slice(-12), [start, end])
  const chartOptions = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'column', height: mobile ? 245 : 290, backgroundColor: 'transparent' },
    title: { text: undefined },
    xAxis: { categories: trendMonths.map(d => d.format('MMM YY')) },
    yAxis: [{ title: { text: undefined } }, { title: { text: undefined }, opposite: true }],
    tooltip: { shared: true },
    series: [
      { type: 'column', name: t('Revenue'), data: trendMonths.map(month => {
        const values = filtered.map(row => row.monthly.find(m => monthToDate(m.month)?.isSame(month, 'month'))?.revenue).filter(has)
        return values.length ? values.reduce((sum, n) => sum + n, 0) : null
      }), yAxis: 0 },
      { type: 'spline', name: t('Employees'), data: trendMonths.map(month => {
        const values = filtered.map(row => row.monthly.find(m => monthToDate(m.month)?.isSame(month,'month')))
          .filter((m): m is MonthlyRecord => !!m && has(m.headPermanent) && has(m.headTemporary))
        return values.length ? values.reduce((sum, m) => sum + (m.headPermanent || 0) + (m.headTemporary || 0), 0) : null
      }), yAxis: 1 },
    ],
  }), [filtered, mobile, t, trendMonths])

  return (
    <DashboardPage className="sme-metrics-page">
      <Row gutter={[10, 10]} className="dashboard-metrics-row">
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('SMEs in scope')} value={filtered.length} hint={`${totals.reported} ${t('have reported')}`} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<DollarCircleOutlined />} label={t('Reported revenue')} value={money(totals.revenue)} hint={`${totals.revenueCoverage}/${filtered.length} ${t('with revenue data')}`} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Reported headcount')} value={count(totals.employees)} hint={`${totals.employeeCoverage}/${filtered.length} ${t('with headcount data')}`} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ClockCircleOutlined />} label={t('SMEs with gaps')} value={totals.missing} hint={t('Missing one or more monthly reports')} /></Col>
      </Row>

      <FilterBar primary={<>
        <Input prefix={<SearchOutlined />} placeholder={t('Search businesses')} value={search} onChange={e => setSearch(e.target.value)} allowClear />
        <Select value={sector} onChange={setSector} options={[{ value: 'all', label: t('All sectors') }, ...sectorOptions.map(s => ({ value: s, label: s }))]} />
        <Select value={status} onChange={setStatus} options={[
          { value:'all', label:t('All reporting') }, { value:'missing', label:t('Missing reports') },
          { value:'reported', label:t('Reported') }, { value:'awaiting', label:t('Awaiting confirmation') },
        ]} />
        <DatePicker.RangePicker picker="month" value={[start, end]} allowClear={false} onChange={v => {
          if (v?.[0] && v?.[1]) { setStart(v[0].startOf('month')); setEnd(v[1].endOf('month')) }
        }} />
      </>} actions={<Button icon={<ReloadOutlined />} onClick={() => setReload(v => v + 1)} loading={loading}>{t('Refresh')}</Button>} />

      <div className="sme-metrics-main-grid">
        <Card className="sme-metrics-compact-card" title={t('Business reporting')} extra={<Text type="secondary">{filtered.length} {t('SMEs')}</Text>}>
          {loading ? <Skeleton active paragraph={{ rows: 8 }} /> : !filtered.length ? <Empty description={t('No SMEs match these filters.')} /> : (
            <div className="sme-metrics-business-list">
              {pagedRows.map(row => {
                const awaiting = row.monthly.some(m => m.verificationStatus === 'awaiting_confirmation')
                return <div className="sme-metrics-business" key={row.id}>
                  <div className="sme-metrics-business-top">
                    <div className="sme-metrics-business-name">
                      <Text strong>{row.businessName}</Text>
                      <Text type="secondary" className="sme-metrics-muted">{row.sector} · {row.programName}</Text>
                    </div>
                    <Tag color={awaiting ? 'gold' : row.outstanding ? 'orange' : 'green'}>{awaiting ? t('Awaiting SME') : row.outstanding ? t('Incomplete') : t('Up to date')}</Tag>
                  </div>
                  <div className="sme-metrics-business-stats">
                    <div><span>{t('Revenue')}</span><strong>{row.revenueReported ? money(row.revenue) : '—'}</strong></div>
                    <div><span>{t('Employees')}</span><strong>{row.employees !== null ? count(row.employees) : '—'}</strong></div>
                    <div><span>{t('Months reported')}</span><strong>{row.reported}/{row.expected}</strong></div>
                  </div>
                  {row.historyError ? <Text type="danger" className="sme-metrics-muted">{t('Reporting history could not be loaded')}</Text> : null}
                  <div className="sme-metrics-business-actions">
                    <Button size="small" onClick={() => openDetail(row.id)}>{t('View details')}</Button>
                    <Button size="small" type="primary" icon={<EditOutlined />} onClick={() => openMonthly(row)}>{t('Record metrics')}</Button>
                  </div>
                </div>
              })}
              {filtered.length > LIST_PAGE_SIZE && (
                <Pagination className="sme-metrics-list-pagination" size="small" align="center" current={currentListPage} pageSize={LIST_PAGE_SIZE} total={filtered.length} onChange={setListPage} showSizeChanger={false} />
              )}
            </div>
          )}
        </Card>
        <div className="sme-metrics-right-stack">
          <Card className="sme-metrics-compact-card" title={t('Portfolio trend')} extra={<Text type="secondary">{start.format('MMM YY')} – {end.format('MMM YY')}</Text>}>
            {filtered.some(r => r.monthly.length) ? <ThemedHighcharts options={chartOptions} /> : <Empty description={t('No monthly figures yet')} />}
            <Text type="secondary" className="sme-metrics-muted">{t('Only submitted monthly data is included. Missing figures are not treated as zero.')}</Text>
          </Card>
          <Card className="sme-metrics-compact-card" title={t('Reporting coverage')}>
            <div className="sme-metrics-coverage-line"><Text>{t('SMEs with a report')}</Text><Text strong>{totals.reported}/{filtered.length}</Text></div>
            <Progress percent={filtered.length ? Math.round(totals.reported / filtered.length * 100) : 0} showInfo={false} />
            <div className="sme-metrics-coverage-line"><Text>{t('Revenue coverage')}</Text><Text strong>{totals.revenueCoverage}/{filtered.length}</Text></div>
            <Progress percent={filtered.length ? Math.round(totals.revenueCoverage / filtered.length * 100) : 0} showInfo={false} />
            <div className="sme-metrics-coverage-line"><Text>{t('Employee coverage')}</Text><Text strong>{totals.employeeCoverage}/{filtered.length}</Text></div>
            <Progress percent={filtered.length ? Math.round(totals.employeeCoverage / filtered.length * 100) : 0} showInfo={false} />
            <Text type="secondary" className="sme-metrics-muted">{t('Coverage reflects SMEs with actual reported values, not profile estimates.')}</Text>
          </Card>
        </div>
      </div>

      <Modal open={!!selected && !monthlyOpen && !opportunityOpen} centered width={850} footer={null} onCancel={() => setSelectedId(null)} title={selected?.businessName} className="sme-metrics-modal">
        {selected && <div className="sme-metrics-detail">
          <div className="sme-metrics-detail-toolbar"><Text type="secondary">{selected.programName} · {selected.sector}</Text><Space wrap>
            <Button icon={<PlusOutlined />} onClick={() => openOpportunity()}>{t('Add opportunity')}</Button>
            <Button type="primary" icon={<EditOutlined />} onClick={() => openMonthly(selected)}>{t('Record metrics')}</Button>
          </Space></div>
          <Row gutter={[10,10]}>
            <Col xs={12} md={6}><DashboardMetricCard icon={<DollarCircleOutlined />} label={t('Revenue')} value={money(periodMetrics(selected,start,end).revenue)} /></Col>
            <Col xs={12} md={6}><DashboardMetricCard icon={<TeamOutlined />} label={t('Headcount')} value={periodMetrics(selected,start,end).employees ?? '—'} /></Col>
            <Col xs={12} md={6}><DashboardMetricCard icon={<CalendarOutlined />} label={t('Reported months')} value={periodMetrics(selected,start,end).reported} /></Col>
            <Col xs={12} md={6}><DashboardMetricCard icon={<ClockCircleOutlined />} label={t('Missing months')} value={periodMetrics(selected,start,end).outstanding} /></Col>
          </Row>
          <div className="sme-metrics-subtitle">{t('Monthly reporting history')}</div>
          {selected.monthly.length ? selected.monthly.map(record => <div className="sme-metrics-history-row" key={record.month}>
            <div><Text strong>{record.month}</Text><div><Text type="secondary" className="sme-metrics-muted">{has(record.revenue) ? money(record.revenue) : t('Revenue not reported')} · {has(record.headPermanent) && has(record.headTemporary) ? `${record.headPermanent + record.headTemporary} ${t('employees')}` : t('Headcount not reported')}</Text></div></div>
            <Tag color={record.verificationStatus === 'awaiting_confirmation' ? 'gold' : record.verificationStatus === 'confirmed' ? 'green' : 'blue'}>{formatStage(record.verificationStatus || 'self_reported')}</Tag>
          </div>) : <Empty description={t('No monthly reports yet')} />}
          <div className="sme-metrics-subtitle">{t('Market opportunities')}</div>
          {opportunitiesLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : opportunities.length ? opportunities.map(opp => <div className="sme-metrics-history-row" key={opp.id}>
            <div><Text strong>{opp.title}</Text><div><Text type="secondary" className="sme-metrics-muted">{opp.type} · {opp.buyer || t('No buyer')} · {has(opp.value) ? money(opp.value) : t('Value not set')}</Text></div></div>
            <Space><Tag color={stageColor[opp.stage] || 'default'}>{formatStage(opp.stage)}</Tag><Button size="small" type="text" icon={<EditOutlined />} onClick={() => openOpportunity(opp)} /></Space>
          </div>) : <Empty description={t('No market opportunities recorded')} />}
        </div>}
      </Modal>

      <Modal open={monthlyOpen} centered destroyOnHidden width={660} onCancel={() => { if (!saving) setMonthlyOpen(false) }}
        title={`${t('Record SME metrics')} · ${selected?.businessName || ''}`} className="sme-metrics-modal"
        footer={<div className="sme-metrics-modal-actions"><Button onClick={() => setMonthlyOpen(false)} disabled={saving}>{t('Cancel')}</Button><Button type="primary" loading={saving} onClick={() => monthlyForm.submit()} icon={<CheckCircleOutlined />}>{t('Save for SME')}</Button></div>}>
        <Text type="secondary">{t('Operations-assisted entries will be marked as awaiting SME confirmation. Existing values in other sections will remain unchanged.')}</Text>
        <Form form={monthlyForm} layout="vertical" onFinish={submitMonthly} className="sme-metrics-form" requiredMark={false}>
          <Form.Item name="month" label={t('Reporting month')} rules={[{ required: true }]}>
            <DatePicker picker="month" style={{ width: '100%' }} disabledDate={date => date.isAfter(dayjs(), 'month')} onChange={setMonthlyMonth} />
          </Form.Item>
          <div className="sme-metrics-subtitle">{t('What are you reporting?')}</div>
          <Checkbox.Group value={chosenSections} onChange={v => setChosenSections(v as MetricSection[])} className="sme-metrics-section-grid">
            {sections.map(s => <Checkbox key={s.key} value={s.key}>{t(s.label)}</Checkbox>)}
          </Checkbox.Group>
          {chosenSections.length === 0 && <Text type="danger">{t('Select at least one metric section.')}</Text>}
          <Row gutter={[12, 0]}>
            {sections.filter(s => chosenSections.includes(s.key)).flatMap(s => s.fields.map(field => <Col xs={24} sm={field === 'headPermanent' || field === 'headTemporary' ? 12 : 24} key={field}>
              <Form.Item name={field} label={t(fieldLabel[field])} rules={[{ required: true, message: t('Required') }]}>
                <InputNumber min={0} precision={field === 'revenue' ? 2 : 0} style={{ width:'100%' }} />
              </Form.Item>
            </Col>))}
          </Row>
          {chosenSections.includes('revenue') && <Form.Item label={t('Additional revenue evidence (optional)')}>
            <Upload beforeUpload={() => false} multiple fileList={revenueFiles} onChange={info => setRevenueFiles(info.fileList)} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.csv"><Button block icon={<UploadOutlined />}>{t('Attach statement or report')}</Button></Upload>
          </Form.Item>}
          {chosenSections.includes('employees') && <Form.Item label={t('Additional employment evidence (optional)')}>
            <Upload beforeUpload={() => false} multiple fileList={employeeFiles} onChange={info => setEmployeeFiles(info.fileList)} accept=".pdf,.jpg,.jpeg,.png,.xlsx,.csv"><Button block icon={<UploadOutlined />}>{t('Attach supporting document')}</Button></Upload>
          </Form.Item>}
        </Form>
      </Modal>

      <Modal open={opportunityOpen} centered destroyOnHidden width={610} onCancel={() => { if (!saving) setOpportunityOpen(false) }} className="sme-metrics-modal"
        title={`${editingOpportunity ? t('Update opportunity') : t('Add opportunity')} · ${selected?.businessName || ''}`}
        footer={<div className="sme-metrics-modal-actions"><Button onClick={() => setOpportunityOpen(false)} disabled={saving}>{t('Cancel')}</Button><Button type="primary" loading={saving} icon={<FileAddOutlined />} onClick={() => opportunityForm.submit()}>{t('Save opportunity')}</Button></div>}>
        <Form form={opportunityForm} layout="vertical" requiredMark={false} onFinish={submitOpportunity}>
          <Form.Item name="title" label={t('Opportunity name')} rules={[{ required:true }]}><Input /></Form.Item>
          <Row gutter={12}>
            <Col xs={24} sm={12}><Form.Item name="buyer" label={t('Buyer / organisation')}><Input /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item name="type" label={t('Type')} rules={[{ required:true }]}><Select options={(['EOI','RFQ','RFP','Tender','Funding','Pitch','Other'] as OpportunityType[]).map(v => ({ value:v, label:v }))} /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item name="stage" label={t('Stage')} rules={[{ required:true }]}><Select options={opportunityStages.map(v => ({ value:v, label:t(formatStage(v)) }))} /></Form.Item></Col>
            <Col xs={24} sm={12}><Form.Item name="value" label={t('Estimated value (R)')}><InputNumber min={0} style={{ width:'100%' }} /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item name="submittedAt" label={t('Submitted')}><DatePicker style={{ width:'100%' }} /></Form.Item></Col>
            <Col xs={12} sm={6}><Form.Item name="closingAt" label={t('Closing')}><DatePicker style={{ width:'100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="notes" label={t('Progress notes')}><Input.TextArea rows={3} /></Form.Item>
          <Text type="secondary" className="sme-metrics-muted">{t('Staff-entered opportunities are awaiting SME confirmation.')}</Text>
        </Form>
      </Modal>
    </DashboardPage>
  )
}
export default SmeMetricsPage
