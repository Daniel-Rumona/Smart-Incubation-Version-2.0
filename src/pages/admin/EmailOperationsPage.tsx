import { App, Button, Card, Col, Empty, Form, Input, Row, Segmented, Select, Space, Typography } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, EditOutlined, InfoCircleOutlined, MailOutlined, ReloadOutlined, SearchOutlined, SendOutlined, StopOutlined, UserOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import type Highcharts from 'highcharts'
import dayjs from 'dayjs'
import { AdminFormSectionHead } from '@/components/admin/AdminFormSectionHead'
import { AdminKpiTile, AdminMiniBars, AdminShareRing } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { sentToScope, useCompanyScope } from '@/hooks/useCompanyScope'
import { getEmailOperations, sendAdminEmail, type EmailDeliveryLog, type EmailOperations } from '@/services/emailOperationsService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/email-operations.css'

type SendForm = { to: string, subject: string, message: string }
const dateFormatter = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })

const ACCENT = '#6d5dfb'
const FAILED = '#dc2626'
const WARNING = '#d97706'
/** Outcome colours: delivered in the accent, problems in red/amber, the rest in greys. */
const OUTCOMES = [
  { key: 'sent', labelKey: 'emailOps.sent', color: ACCENT },
  { key: 'failed', labelKey: 'emailOps.failed', color: FAILED },
  { key: 'rejected', labelKey: 'emailOps.rejected', color: WARNING },
  { key: 'bounced', labelKey: 'emailOps.bounced', color: '#a99ffc' },
  { key: 'invalid', labelKey: 'emailOps.invalid', color: '#94a3b8' },
  { key: 'suppressed', labelKey: 'emailOps.suppressed', color: '#cbd5e1' },
] as const

const isProblem = (status: string) => status === 'failed' || status === 'rejected'
const logDate = (row: EmailDeliveryLog) => row.createdAt ? dayjs(row.createdAt) : null

const StatusPill = ({ status }: { status: string }) => {
  const { t } = useLanguage()
  const tone = status === 'sent' ? 'good' : isProblem(status) ? 'bad' : 'neutral'
  const label = ['sent', 'failed', 'rejected', 'bounced', 'suppressed'].includes(status) ? t(`emailOps.${status}`) : status
  return <span className={`email-status-pill is-${tone}`}><i />{label}</span>
}

export const EmailOperationsPage = () => {
  const { message } = App.useApp()
  const { t } = useLanguage()
  const [form] = Form.useForm<SendForm>()
  const [allData, setData] = useState<EmailOperations>()
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [section, setSection] = useState<string | number>('delivery')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')

  const load = async () => {
    try {
      setLoading(true)
      setData(await getEmailOperations())
    } catch {
      message.error(t('emailOps.loadError'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const send = async (values: SendForm) => {
    try {
      setSending(true)
      await sendAdminEmail(values)
      message.success(t('emailOps.queued'))
      setModalOpen(false)
      form.resetFields()
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('emailOps.sendError'))
    } finally {
      setSending(false)
    }
  }

  // The company picked in the top bar: logs and suppressions carry no company, so they follow its users' addresses.
  // The summary is rebuilt the way getEmailOperations builds it, from the same latest 200 logs.
  const scope = useCompanyScope()
  const data = useMemo<EmailOperations | undefined>(() => {
    if (!allData || !scope.companyCode) return allData
    if (!scope.ready) return undefined
    const logs = allData.logs.filter((row) => sentToScope(scope, row.recipients))
    const suppressions = allData.suppressions.filter((row) => sentToScope(scope, row.email))
    return {
      logs,
      suppressions,
      summary: {
        sent: logs.filter((row) => row.status === 'sent').length,
        failed: logs.filter((row) => row.status === 'failed').length,
        rejected: logs.reduce((total, row) => total + row.rejected.length, 0),
        bounced: logs.filter((row) => row.reason === 'bounced').length,
        suppressed: suppressions.length,
        invalid: logs.filter((row) => row.reason === 'invalid_email').length,
      },
    }
  }, [allData, scope])

  const summary = data?.summary
  const logs = useMemo(() => data?.logs || [], [data])
  const attempted = (summary?.sent || 0) + (summary?.failed || 0) + (summary?.rejected || 0)
  const problems = (summary?.failed || 0) + (summary?.rejected || 0)

  const lastDays = (count: number) => Array.from({ length: count }, (_, index) => dayjs().startOf('day').subtract(count - 1 - index, 'day'))
  const perDay = (days: dayjs.Dayjs[], match: (row: EmailDeliveryLog) => boolean) => days.map((day) => logs.filter((row) => match(row) && logDate(row)?.isSame(day, 'day')).length)
  const week = lastDays(7)
  const weekBars = (match: (row: EmailDeliveryLog) => boolean) => {
    const counts = perDay(week, match)
    return week.map((day, index) => ({ key: day.valueOf(), label: day.format('dd').slice(0, 1), value: counts[index] }))
  }

  const activityChart = useMemo<Highcharts.Options>(() => {
    const days = lastDays(14)
    return {
      chart: { type: 'column', height: 290, spacing: [12, 4, 4, 4] },
      title: { text: undefined },
      legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
      tooltip: { shared: true },
      xAxis: { categories: days.map((day) => day.format('D MMM')), lineWidth: 0, tickLength: 0, labels: { step: 2 } },
      yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, gridLineDashStyle: 'Dash' },
      plotOptions: { column: { stacking: 'normal', borderRadius: 4, pointPadding: 0.08, groupPadding: 0.12 } },
      series: [
        { type: 'column', name: t('emailOps.sent'), color: ACCENT, data: perDay(days, (row) => row.status === 'sent') },
        { type: 'column', name: t('emailOps.failed'), color: FAILED, data: perDay(days, (row) => row.status === 'failed') },
        { type: 'column', name: t('emailOps.rejected'), color: WARNING, data: perDay(days, (row) => row.status === 'rejected') },
      ],
    }
  }, [logs, t]) // eslint-disable-line react-hooks/exhaustive-deps

  const outcomes = OUTCOMES.map((outcome) => ({ ...outcome, value: summary?.[outcome.key] || 0 })).filter((outcome) => outcome.value)
  const outcomeTotal = outcomes.reduce((sum, outcome) => sum + outcome.value, 0)
  const outcomeChart = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0] },
    title: { text: undefined },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
    plotOptions: { pie: { innerSize: '74%', borderWidth: 3, borderRadius: 6, dataLabels: { enabled: false } } },
    series: [{ type: 'pie', name: t('emailOps.title'), data: OUTCOMES.map((outcome) => ({ name: t(outcome.labelKey), y: summary?.[outcome.key] || 0, color: outcome.color })).filter((point) => point.y) }],
  }), [summary, t])

  const sources = useMemo(() => {
    const totals = new Map<string, { total: number; problems: number }>()
    logs.forEach((row) => {
      const current = totals.get(row.source || 'email') || { total: 0, problems: 0 }
      current.total += 1
      if (isProblem(row.status)) current.problems += 1
      totals.set(row.source || 'email', current)
    })
    return [...totals.entries()].sort((a, b) => b[1].total - a[1].total)
  }, [logs])

  const statusOptions = [...new Set(logs.map((row) => row.status))].sort().map((value) => ({ value, label: ['sent', 'failed', 'rejected', 'bounced', 'suppressed'].includes(value) ? t(`emailOps.${value}`) : value }))
  const term = search.trim().toLowerCase()
  const visibleLogs = logs.filter((row) => (status === 'all' || row.status === status)
    && (!term || `${row.recipients.join(' ')} ${row.source} ${row.error} ${row.reason}`.toLowerCase().includes(term)))
  const visibleSuppressions = (data?.suppressions || []).filter((row) => !term || `${row.email} ${row.reason}`.toLowerCase().includes(term))

  const cardHead = (title: string, hint?: string) => (
    <div className="admin-card-head">
      <div>
        <h3>{title}</h3>
        {hint && <span>{hint}</span>}
      </div>
    </div>
  )

  return <DashboardPage className="email-operations-page admin-overview">
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={!data && (loading || !scope.ready)} icon={<CheckCircleOutlined />} label={t('emailOps.sent')} value={summary?.sent || 0} visual={<AdminMiniBars bars={weekBars((row) => row.status === 'sent')} />} /></Col>
      <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={!data && (loading || !scope.ready)} icon={<MailOutlined />} label={t('Delivery rate')} value={attempted ? `${Math.round(((summary?.sent || 0) / attempted) * 100)}%` : '—'} visual={<AdminShareRing value={summary?.sent || 0} total={attempted} />} /></Col>
      <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={!data && (loading || !scope.ready)} icon={<CloseCircleOutlined />} label={t('Failed or rejected')} value={problems} visual={<AdminMiniBars bars={weekBars((row) => isProblem(row.status))} />} /></Col>
      <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={!data && (loading || !scope.ready)} icon={<StopOutlined />} label={t('emailOps.suppressed')} value={summary?.suppressed || 0} /></Col>
    </Row>

    <Row gutter={[16, 16]} className="email-operations-row">
      <Col xs={24} lg={16}>
        <Card className="admin-card" bordered={false} loading={!data && (loading || !scope.ready)}>
          {cardHead(t('emailOps.delivery'), t('Last 14 days'))}
          {logs.length ? <ThemedHighcharts options={activityChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card className="admin-card" bordered={false} loading={!data && (loading || !scope.ready)}>
          {cardHead(t('Outcomes'), t('All recorded emails'))}
          {outcomeTotal ? (
            <>
              <div className="admin-donut">
                <ThemedHighcharts options={outcomeChart} />
                <div className="admin-donut-center"><strong>{outcomeTotal.toLocaleString()}</strong><span>{t('Emails')}</span></div>
              </div>
              <ul className="admin-legend">
                {outcomes.map((outcome) => <li key={outcome.key}><i style={{ background: outcome.color }} />{t(outcome.labelKey)}<b>{outcome.value.toLocaleString()}</b></li>)}
              </ul>
            </>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      </Col>
    </Row>

    <Row gutter={[16, 16]} className="email-operations-row">
      <Col xs={24} lg={8}>
        <Card className="admin-card" bordered={false} loading={!data && (loading || !scope.ready)}>
          {cardHead(t('By source'), t('Which part of the system sent them'))}
          {sources.length ? (
            <ol className="usage-rank-list email-source-list">
              {sources.slice(0, 6).map(([source, totals]) => (
                <li key={source}>
                  <span className="usage-rank-index"><MailOutlined /></span>
                  <div className="usage-rank-copy">
                    <div className="usage-rank-top"><strong>{source}</strong><b>{totals.total.toLocaleString()}</b></div>
                    <div className="usage-rank-bar"><span style={{ width: `${Math.max(4, (totals.total / sources[0][1].total) * 100)}%` }} /></div>
                    <small className={totals.problems ? 'is-bad' : undefined}>{totals.problems ? t('{count} failed or rejected', undefined, { count: totals.problems }) : t('No failures')}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        </Card>
      </Col>
      <Col xs={24} lg={16}>
        <Card className="admin-card" bordered={false}>
          <div className="admin-card-head">
            <div>
              <h3>{section === 'delivery' ? t('Delivery log') : t('Suppressed addresses')}</h3>
              <span>{section === 'delivery'
                ? t('{count} of {total} shown', undefined, { count: visibleLogs.length, total: logs.length })
                : t('Addresses the system no longer emails after repeated failures')}</span>
            </div>
            <Segmented value={section} onChange={setSection} options={[{ value: 'delivery', label: t('emailOps.delivery') }, { value: 'suppressed', label: t('emailOps.suppressed') }]} />
          </div>
          <FilterBar
            primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search recipients, sources or errors')} allowClear />}
            advanced={section === 'delivery' ? <Select value={status} onChange={setStatus} options={[{ value: 'all', label: t('All statuses') }, ...statusOptions]} /> : undefined}
            actions={<><Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>{t('common.refresh')}</Button><Button type="primary" icon={<SendOutlined />} onClick={() => setModalOpen(true)}>{t('emailOps.send')}</Button></>}
          />
          {section === 'delivery'
            ? <ResponsiveDataView rowKey="id" loading={loading} rows={visibleLogs} emptyText={t('usage.noData')} columns={[
              { title: t('emailOps.recipient'), dataIndex: 'recipients', render: (value: string[]) => <Typography.Text strong>{value.join(', ') || t('N/A')}</Typography.Text> },
              { title: t('emailOps.source'), dataIndex: 'source', render: (value: string) => <span className="admin-role-tag">{value || 'email'}</span> },
              { title: t('common.status'), dataIndex: 'status', render: (value: string) => <StatusPill status={value} /> },
              { title: t('emailOps.detail'), render: (_, row) => <Typography.Text type="secondary" ellipsis={{ tooltip: true }} style={{ maxWidth: 260 }}>{row.error || row.reason || row.rejected.join(', ') || t('N/A')}</Typography.Text> },
              { title: t('emailOps.recorded'), dataIndex: 'createdAt', render: (value?: string) => value ? dateFormatter.format(new Date(value)) : t('N/A') },
            ]} renderCard={(row) => <Space orientation="vertical"><Typography.Text strong>{row.recipients.join(', ') || t('N/A')}</Typography.Text><Space><StatusPill status={row.status} /><span className="admin-role-tag">{row.source || 'email'}</span></Space><Typography.Text type="secondary">{row.error || row.reason || (row.createdAt ? dateFormatter.format(new Date(row.createdAt)) : '')}</Typography.Text></Space>} />
            : <ResponsiveDataView rowKey="id" loading={loading} rows={visibleSuppressions} emptyText={t('usage.noData')} columns={[
              { title: t('common.email'), dataIndex: 'email', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
              { title: t('emailOps.reason'), dataIndex: 'reason', render: (value: string) => <span className="email-status-pill is-neutral"><i />{value}</span> },
              { title: t('emailOps.failures'), dataIndex: 'failureCount' },
              { title: t('emailOps.recorded'), dataIndex: 'updatedAt', render: (value?: string) => value ? dateFormatter.format(new Date(value)) : t('N/A') },
            ]} renderCard={(row) => <Space orientation="vertical"><Typography.Text strong>{row.email}</Typography.Text><span className="email-status-pill is-neutral"><i />{row.reason}</span><Typography.Text type="secondary">{t('emailOps.failures')}: {row.failureCount}</Typography.Text></Space>} />}
        </Card>
      </Col>
    </Row>

    <ResponsiveModal
      open={modalOpen}
      onClose={() => setModalOpen(false)}
      width={640}
      centered
      destroyOnHidden={false}
      className="admin-modal admin-form-modal is-plain-header"
      title={t('emailOps.send')}
      footer={<Button block shape="round" size="large" type="primary" icon={<SendOutlined />} loading={sending} onClick={() => form.submit()}>{t('emailOps.queue')}</Button>}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void send(values)}>
        <section className="admin-form-modal-section">
          <AdminFormSectionHead icon={<UserOutlined />} title={t('emailOps.recipient')} />
          <Form.Item name="to" label={t('common.email')} rules={[{ required: true }, { type: 'email' }]}><Input size="large" prefix={<MailOutlined />} placeholder="name@company.com" /></Form.Item>
        </section>
        <section className="admin-form-modal-section">
          <AdminFormSectionHead icon={<EditOutlined />} title={t('emailOps.message')} />
          <Form.Item name="subject" label={t('emailOps.subject')} rules={[{ required: true }]}><Input size="large" /></Form.Item>
          <Form.Item name="message" label={t('emailOps.message')} rules={[{ required: true }]}><Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} /></Form.Item>
        </section>
        <p className="admin-form-modal-note"><InfoCircleOutlined /> {t('emailOps.bounceHint')}</p>
      </Form>
    </ResponsiveModal>
  </DashboardPage>
}
