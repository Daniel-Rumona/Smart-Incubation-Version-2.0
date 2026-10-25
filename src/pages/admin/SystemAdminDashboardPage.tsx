import { Alert, Button, Card, Col, DatePicker, Empty, Grid, Progress, Row, Tag, Typography } from 'antd'
import { BankOutlined, CheckCircleOutlined, RightOutlined, TeamOutlined, UserOutlined, WarningOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import { AdminKpiTile, AdminMiniBars, type AdminKpiTrend } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { USER_ROLE_LABELS } from '@/config/roles'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { FilterBar } from '@/components/shared/FilterBar'
import { useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getAdminDashboardSummary, type AdminApplicationStatus, type AdminDashboardMonth, type AdminDashboardSummary } from '@/services/adminDashboardService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/admin-dashboard.css'

const ACCENT = '#6d5dfb'
const ACCENT_SOFT = 'rgba(109, 93, 251, .28)'
// Purple shades for a second series, grey for negative outcomes; no near-black, it reads too heavy in light mode.
const ACCENT_DEEP = '#4338ca'
const ACCENT_LIGHT = '#a99ffc'
const dateFormatter = new Intl.DateTimeFormat('en-ZA', { dateStyle: 'medium', timeStyle: 'short' })
const { RangePicker } = DatePicker
const previousRange = (range: [Dayjs, Dayjs]) => {
  const days = range[1].diff(range[0], 'day') + 1
  const end = range[0].subtract(1, 'day').endOf('day')
  return [end.subtract(days - 1, 'day').startOf('day'), end] as [Dayjs, Dayjs]
}

const ROLE_LABELS: Record<string, string> = USER_ROLE_LABELS
const ROLE_COLORS = [ACCENT, ACCENT_LIGHT, ACCENT_DEEP, '#0d9488', '#d97706', '#94a3b8', '#db2777', '#0891b2']
const STATUS_META: Array<{ key: AdminApplicationStatus; label: string; color: string }> = [
  { key: 'accepted', label: 'Accepted', color: ACCENT },
  { key: 'pending', label: 'In review', color: ACCENT_LIGHT },
  { key: 'rejected', label: 'Declined', color: '#94a3b8' },
  { key: 'other', label: 'Other', color: '#dde3ea' },
]

/** Small monthly columns beside a KPI; the latest month is drawn in the accent colour. */
const MiniBars = ({ months, pick }: { months: AdminDashboardMonth[]; pick: (month: AdminDashboardMonth) => number }) => (
  <AdminMiniBars bars={months.map((month) => ({ key: month.month.getTime(), label: dayjs(month.month).format('MMM'), value: pick(month) }))} />
)

export const SystemAdminDashboardPage = () => {
  const { user } = useFullIdentity()
  const { t } = useLanguage()
  const navigate = useNavigate()
  const isMobile = !Grid.useBreakpoint().md
  const [summary, setSummary] = useState<AdminDashboardSummary>()
  // The request the figures on screen came from; while it differs from the current one, the cards show loading.
  const [loadedKey, setLoadedKey] = useState<string>()
  const [error, setError] = useState<string>()
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')])
  const { activeCompanyCode, isAllCompanies } = useActiveCompanyCode()

  const requestKey = `${activeCompanyCode}|${dateRange[0].valueOf()}|${dateRange[1].valueOf()}`
  const loading = loadedKey !== requestKey

  useEffect(() => {
    if (!user || !['systemadmin', 'admin'].includes(user.role)) return
    let active = true
    const prior = previousRange(dateRange)
    // The company picked in the top bar narrows the whole overview.
    getAdminDashboardSummary(user, [dateRange[0].toDate(), dateRange[1].toDate()], [prior[0].toDate(), prior[1].toDate()], isAllCompanies ? undefined : activeCompanyCode)
      .then((nextSummary) => {
        if (!active) return
        setSummary(nextSummary)
        setError(undefined)
      })
      .catch(() => { if (active) setError(t('admin.dashboard.loadError')) })
      .finally(() => { if (active) setLoadedKey(requestKey) })
    return () => { active = false }
  }, [activeCompanyCode, dateRange, isAllCompanies, requestKey, t, user])

  /** Higher is good for most figures; for errors a rise is bad news. */
  const trend = (current = 0, previous = 0, higherIsGood = true): AdminKpiTrend => {
    const change = current - previous
    const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'
    const percent = previous ? Math.round((Math.abs(change) / previous) * 100) : undefined
    return {
      amount: percent !== undefined ? `${percent}%` : String(Math.abs(change)),
      direction,
      tone: change === 0 ? 'neutral' : (change > 0) === higherIsGood ? 'good' : 'bad',
      text: t('{change} vs previous period', undefined, { change: `${change >= 0 ? '+' : ''}${change}` }),
    }
  }

  const months = useMemo(() => summary?.months || [], [summary])
  const recentMonths = months.slice(-6)
  const firstName = (user?.name || user?.displayName || '').split(' ')[0]

  const growthChart = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'areaspline', height: 290, spacing: [12, 4, 4, 4] },
    title: { text: undefined },
    xAxis: { categories: months.map((month) => dayjs(month.month).format('MMM')), lineWidth: 0, tickLength: 0 },
    yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
    legend: { align: 'right', verticalAlign: 'top', floating: false, itemDistance: 16, symbolRadius: 6 },
    tooltip: { shared: true },
    plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
    series: [
      { type: 'areaspline', name: t('New users'), data: months.map((month) => month.newUsers), color: ACCENT, fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(109, 93, 251, .32)'], [1, 'rgba(109, 93, 251, 0)']] } },
      { type: 'areaspline', name: t('Applications'), data: months.map((month) => month.applications), color: ACCENT_DEEP, fillColor: 'transparent', dashStyle: 'ShortDash' },
    ],
  }), [months, t])

  const roleEntries = useMemo(() => Object.entries(summary?.usersByRole || {}).sort((a, b) => b[1] - a[1]), [summary])
  const roleTotal = roleEntries.reduce((total, [, count]) => total + count, 0)
  const roleChart = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0] },
    title: { text: undefined },
    tooltip: { pointFormat: '<b>{point.y}</b> ({point.percentage:.0f}%)' },
    plotOptions: { pie: { innerSize: '74%', borderWidth: 3, borderRadius: 6, dataLabels: { enabled: false } } },
    series: [{
      type: 'pie',
      name: t('Users'),
      data: roleEntries.map(([role, count], index) => ({ name: t(ROLE_LABELS[role] || role), y: count, color: ROLE_COLORS[index % ROLE_COLORS.length] })),
    }],
  }), [roleEntries, t])

  const activityChart = useMemo<Highcharts.Options>(() => {
    const days = summary?.dailySessions || []
    return {
      chart: { type: 'column', height: 230, spacing: [8, 0, 0, 0] },
      title: { text: undefined },
      legend: { enabled: false },
      xAxis: { categories: days.map((day) => dayjs(day.day).format('D MMM')), lineWidth: 0, tickLength: 0, labels: { step: Math.max(1, Math.ceil(days.length / 6)) } },
      yAxis: { title: { text: undefined }, allowDecimals: false, gridLineDashStyle: 'Dash' },
      tooltip: { shared: true },
      plotOptions: { column: { borderRadius: 4, pointPadding: 0.08, groupPadding: 0.12 } },
      series: [
        { type: 'column', name: t('Sessions'), data: days.map((day) => day.sessions), color: ACCENT_SOFT, states: { hover: { color: ACCENT } } },
        { type: 'spline', name: t('Users signed in'), data: days.map((day) => day.users), color: ACCENT, marker: { enabled: false }, lineWidth: 2 },
      ],
    }
  }, [summary, t])

  const statuses = summary?.applicationsByStatus
  const applicationTotal = summary?.applications || 0
  const acceptedShare = applicationTotal && statuses ? Math.round((statuses.accepted / applicationTotal) * 100) : 0
  const totalSessions = (summary?.dailySessions || []).reduce((total, day) => total + day.sessions, 0)

  const rangePicker = <RangePicker value={dateRange} allowClear={false} onChange={(value) => value && setDateRange(value as [Dayjs, Dayjs])} />

  return (
    <DashboardPage className="dashboard-home-page admin-overview">
      <header className="admin-hero">
        <div>
          <h2>{firstName ? t('Welcome back, {name}!', undefined, { name: firstName }) : t('admin.dashboard.title')}</h2>
          <p>{t('admin.dashboard.subtitle')}</p>
        </div>
        <div className="admin-hero-actions">
          {!isMobile && rangePicker}
          <Button type="primary" shape="round" size="large" icon={<UserOutlined />} onClick={() => navigate('/admin/users')}>{t('Manage users')}</Button>
        </div>
      </header>
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
      {isMobile && <FilterBar title={t('common.filters')} primary={rangePicker} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<TeamOutlined />} label={t('admin.dashboard.users')} value={summary?.users || 0} trend={trend(summary?.users, summary?.previous.users)} visual={<MiniBars months={recentMonths} pick={(month) => month.totalUsers} />} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<CheckCircleOutlined />} label={t('admin.dashboard.activeUsers')} value={summary?.activeUsers || 0} trend={trend(summary?.activeUsers, summary?.previous.activeUsers)} visual={<MiniBars months={recentMonths} pick={(month) => month.activeUsers} />} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<BankOutlined />} label={t('admin.dashboard.companies')} value={summary?.companies || 0} trend={trend(summary?.companies, summary?.previous.companies)} visual={<MiniBars months={recentMonths} pick={(month) => month.companies} />} /></Col>
        <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<WarningOutlined />} label={t('admin.dashboard.recentErrors')} value={summary?.errors || 0} trend={trend(summary?.errors, summary?.previous.errors, false)} visual={<MiniBars months={recentMonths} pick={(month) => month.errors} />} /></Col>
      </Row>

      <Row gutter={[16, 16]} className="admin-overview-row">
        <Col xs={24} lg={16}>
          <Card className="admin-card" bordered={false} loading={loading}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Platform growth')}</h3>
                <span>{t('New users and applications over the last 12 months')}</span>
              </div>
            </div>
            <ThemedHighcharts options={growthChart} />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card className="admin-card" bordered={false} loading={loading}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Users by role')}</h3>
                <span>{t('Active accounts')}</span>
              </div>
            </div>
            {roleTotal ? (
              <>
                <div className="admin-donut">
                  <ThemedHighcharts options={roleChart} />
                  <div className="admin-donut-center"><strong>{roleTotal.toLocaleString()}</strong><span>{t('Users')}</span></div>
                </div>
                <ul className="admin-legend">
                  {roleEntries.slice(0, 6).map(([role, count], index) => (
                    <li key={role}><i style={{ background: ROLE_COLORS[index % ROLE_COLORS.length] }} />{t(ROLE_LABELS[role] || role)}<b>{count}</b></li>
                  ))}
                </ul>
              </>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} className="admin-overview-row">
        <Col xs={24} md={12} xl={8}>
          <Card className="admin-card admin-card-accent" bordered={false} loading={loading}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Applications')}</h3>
                <span>{t('In the selected period')}</span>
              </div>
              <Button type="text" size="small" onClick={() => navigate('/admin/usage')}>{t('View more')} <RightOutlined /></Button>
            </div>
            <div className="admin-pipeline-hero">
              <span className="admin-pipeline-total">{applicationTotal.toLocaleString()}</span>
              <span>{t('applications received')}</span>
            </div>
            <div className="admin-pipeline-bar" aria-hidden="true">
              {STATUS_META.map((status) => statuses?.[status.key] ? <span key={status.key} style={{ flex: statuses[status.key], background: status.color }} /> : null)}
            </div>
            <ul className="admin-pipeline-steps">
              {STATUS_META.filter((status) => status.key !== 'other' || statuses?.other).map((status) => (
                <li key={status.key}><i style={{ background: status.color }} /><span>{t(status.label)}</span><b>{statuses?.[status.key] || 0}</b></li>
              ))}
            </ul>
            <div className="admin-pipeline-foot">
              <Progress type="circle" percent={acceptedShare} size={34} strokeColor={ACCENT} showInfo={false} strokeWidth={12} />
              <span><b>{acceptedShare}%</b> {t('accepted')}</span>
            </div>
          </Card>
        </Col>
        <Col xs={24} md={12} xl={8}>
          <Card className="admin-card" bordered={false} loading={loading}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Platform activity')}</h3>
                <span>{t('{count} sessions', undefined, { count: totalSessions.toLocaleString() })}</span>
              </div>
              <Button type="text" size="small" onClick={() => navigate('/admin/usage')}>{t('View more')} <RightOutlined /></Button>
            </div>
            {totalSessions ? <ThemedHighcharts options={activityChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No sign-ins in this period.')} />}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card className="admin-card" bordered={false} loading={loading}>
            <div className="admin-card-head">
              <div>
                <h3>{t('Delivery errors')}</h3>
                <span>{t('Most recent failures')}</span>
              </div>
              <Button type="text" size="small" onClick={() => navigate('/admin/email-operations')}>{t('View more')} <RightOutlined /></Button>
            </div>
            {summary?.recentErrors.length ? (
              <ol className="admin-timeline">
                {summary.recentErrors.slice(0, 5).map((row) => (
                  <li key={row.id}>
                    <div className="admin-timeline-top">
                      <Tag color="orange" bordered={false}>{row.source}</Tag>
                      <time>{row.createdAt ? dateFormatter.format(row.createdAt) : t('N/A')}</time>
                    </div>
                    <Typography.Paragraph ellipsis={{ rows: 2, tooltip: row.message }}>{row.message}</Typography.Paragraph>
                  </li>
                ))}
              </ol>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('admin.dashboard.noErrors')} />}
          </Card>
        </Col>
      </Row>
    </DashboardPage>
  )
}
