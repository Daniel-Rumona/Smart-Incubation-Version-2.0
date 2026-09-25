import { Alert, Card, Col, DatePicker, Grid, Row, Tag, Typography, type TableProps } from 'antd'
import { AppstoreOutlined, BankOutlined, CheckCircleOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getAdminDashboardSummary, type AdminDashboardError, type AdminDashboardSummary } from '@/services/adminDashboardService'
import { useLanguage } from '@/providers/LanguageProvider'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'

const dateFormatter = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
const { RangePicker } = DatePicker
const delta = (current = 0, previous = 0) => `${current - previous >= 0 ? '+' : ''}${current - previous} vs previous period`
const previousRange = (range: [Dayjs, Dayjs]) => {
  const days = range[1].diff(range[0], 'day') + 1
  const end = range[0].subtract(1, 'day').endOf('day')
  return [end.subtract(days - 1, 'day').startOf('day'), end] as [Dayjs, Dayjs]
}

export const SystemAdminDashboardPage = () => {
  const { user } = useFullIdentity()
  const { t } = useLanguage()
  const isMobile = !Grid.useBreakpoint().md
  const [summary, setSummary] = useState<AdminDashboardSummary>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')])

  useEffect(() => {
    if (!user || !['systemadmin', 'admin'].includes(user.role)) return
    const prior = previousRange(dateRange)
    getAdminDashboardSummary(user, [dateRange[0].toDate(), dateRange[1].toDate()], [prior[0].toDate(), prior[1].toDate()])
      .then((nextSummary) => {
        setSummary(nextSummary)
        setError(undefined)
      })
      .catch(() => setError(t('admin.dashboard.loadError')))
      .finally(() => setLoading(false))
  }, [dateRange, t, user])

  const columns: TableProps<AdminDashboardError>['columns'] = [
    { title: t('admin.dashboard.source'), dataIndex: 'source', render: (value: string) => <Tag color="orange">{value}</Tag> },
    { title: t('admin.dashboard.error'), dataIndex: 'message' },
    { title: t('admin.dashboard.recorded'), dataIndex: 'createdAt', render: (value?: Date) => value ? dateFormatter.format(value) : t('N/A') },
  ]

  return (
    <DashboardPage className="dashboard-home-page">
      <DashboardHeader title={t('admin.dashboard.title')} subtitle={t('admin.dashboard.subtitle')} actions={!isMobile ? <RangePicker value={dateRange} allowClear={false} onChange={(value) => value && setDateRange(value as [Dayjs, Dayjs])} /> : undefined} />
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      <Row gutter={[14, 14]} className="dashboard-metrics-row">
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('admin.dashboard.users')} value={summary?.users || 0} hint={delta(summary?.users, summary?.previous.users)} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} label={t('admin.dashboard.activeUsers')} value={summary?.activeUsers || 0} hint={delta(summary?.activeUsers, summary?.previous.activeUsers)} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<BankOutlined />} label={t('admin.dashboard.companies')} value={summary?.companies || 0} hint={delta(summary?.companies, summary?.previous.companies)} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<WarningOutlined />} label={t('admin.dashboard.recentErrors')} value={summary?.errors || 0} hint={delta(summary?.errors, summary?.previous.errors)} /></Col>
      </Row>
      {isMobile && <FilterBar title={t('common.filters')} primary={<RangePicker value={dateRange} allowClear={false} onChange={(value) => value && setDateRange(value as [Dayjs, Dayjs])} />} />}
      <Card loading={loading} className="dashboard-section-card" title={<Typography.Text strong><AppstoreOutlined /> {t('nav.applications')}: {summary?.applications || 0}</Typography.Text>}>
        <ResponsiveDataView rowKey="id" columns={columns} rows={summary?.recentErrors || []} emptyText={t('admin.dashboard.noErrors')} renderCard={(row) => <Typography.Text><Tag color="orange">{row.source}</Tag> {row.message}</Typography.Text>} />
      </Card>
    </DashboardPage>
  )
}
