import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Avatar, Card, Col, DatePicker, Empty, Row, Segmented, Select, Space, Typography } from 'antd'
import {
    BarChartOutlined,
    ClockCircleOutlined,
    LoginOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { AdminKpiTile, AdminMiniBars, AdminRoleTag, AdminShareRing } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { USER_ROLES, USER_ROLE_LABELS, type UserRole } from '@/config/roles'
import { useCompanyScope } from '@/hooks/useCompanyScope'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    listUsagePageViews,
    listUsageSessions,
    type UsagePageViewRecord,
    type UsageSessionRecord,
} from '@/services/usageTrackingService'
import '@/styles/usage-analytics.css'
import { formatUsageRoute } from '@/utils/usageRoutes'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'

const { RangePicker } = DatePicker
dayjs.extend(isBetween)

const ACCENT = '#6d5dfb'
const ACCENT_SOFT = 'rgba(109, 93, 251, .32)'
const ACCENT_DEEP = '#4338ca'
const ROLE_COLORS = [ACCENT, '#a99ffc', ACCENT_DEEP, '#0d9488', '#d97706', '#94a3b8', '#db2777', '#0891b2']
const initialsOf = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

type UserUsageRow = {
    key: string
    name: string
    email: string
    role: string
    sessions: number
    durationSeconds: number
    lastSeenAt: Date
}

type PageUsageRow = {
    key: string
    path: string
    routeLabel: string
    visits: number
    durationSeconds: number
    users: number
}

const adminRoles = [USER_ROLES.SYSTEM_ADMIN]

const formatDuration = (seconds: number) => {
    const roundedMinutes = Math.max(0, Math.round(seconds / 60))
    const hours = Math.floor(roundedMinutes / 60)
    const minutes = roundedMinutes % 60

    if (!hours) return `${minutes}m`
    return `${hours}h ${minutes}m`
}

export const UsageAnalyticsPage = () => {
    const { user } = useFullIdentity()
    const { t, language } = useLanguage()
    const [allSessions, setSessions] = useState<UsageSessionRecord[]>([])
    const [allPageViews, setPageViews] = useState<UsagePageViewRecord[]>([])
    const [fetching, setLoading] = useState(true)
    const [error, setError] = useState<string>()
    const [roleFilter, setRoleFilter] = useState('all')
    const [userFilter, setUserFilter] = useState('all')
    const [routeFilter, setRouteFilter] = useState('all')
    const [section, setSection] = useState('overview')
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const canView = !!user && adminRoles.includes(user.role as (typeof adminRoles)[number])

    useEffect(() => {
        if (!canView) {
            return
        }

        Promise.all([listUsageSessions(), listUsagePageViews()])
            .then(([nextSessions, nextPageViews]) => {
                setSessions(nextSessions)
                setPageViews(nextPageViews)
                setError(undefined)
            })
            .catch(() => setError(t('usage.loadError')))
            .finally(() => setLoading(false))
    }, [canView, t])

    // The company picked in the top bar: usage records carry no company, so they follow its users by uid.
    const scope = useCompanyScope()
    const loading = fetching || !scope.ready
    const sessions = useMemo(() => scope.companyCode ? allSessions.filter((session) => scope.uids.has(session.uid)) : allSessions, [allSessions, scope.companyCode, scope.uids])
    const pageViews = useMemo(() => scope.companyCode ? allPageViews.filter((pageView) => scope.uids.has(pageView.uid)) : allPageViews, [allPageViews, scope.companyCode, scope.uids])

    const withinDateRange = useCallback((date: Date) => !dateRange || dayjs(date).isBetween(dateRange[0], dateRange[1], 'day', '[]'), [dateRange])
    const filteredSessions = useMemo(() => sessions.filter((session) =>
        (roleFilter === 'all' || session.role === roleFilter)
        && (userFilter === 'all' || session.uid === userFilter)
        && withinDateRange(session.startedAt)), [roleFilter, sessions, userFilter, withinDateRange])
    const filteredPageViews = useMemo(() => pageViews.filter((pageView) =>
        (roleFilter === 'all' || pageView.role === roleFilter)
        && (userFilter === 'all' || pageView.uid === userFilter)
        && (routeFilter === 'all' || pageView.path === routeFilter)
        && withinDateRange(pageView.startedAt)), [pageViews, roleFilter, routeFilter, userFilter, withinDateRange])
    const roleOptions = useMemo(() => [...new Set([...sessions.map((session) => session.role), ...pageViews.map((pageView) => pageView.role)])].filter(Boolean).sort().map((role) => ({ value: role, label: role })), [pageViews, sessions])
    const userOptions = useMemo(() => [...new Map([...sessions, ...pageViews].map((record) => [record.uid, { value: record.uid, label: record.displayName || record.email || t('usage.unknownUser') }])).values()], [pageViews, sessions, t])
    const routeOptions = useMemo(() => [...new Set(pageViews.map((pageView) => pageView.path))].sort().map((path) => ({ value: path, label: formatUsageRoute(path) })), [pageViews])

    const userRows = useMemo<UserUsageRow[]>(() => {
        const totals = new Map<string, UserUsageRow>()

        for (const session of filteredSessions) {
            const current = totals.get(session.uid)

            totals.set(session.uid, {
                key: session.uid,
                name: session.displayName || session.email || t('usage.unknownUser'),
                email: session.email,
                role: session.role,
                sessions: (current?.sessions || 0) + 1,
                durationSeconds: (current?.durationSeconds || 0) + session.durationSeconds,
                lastSeenAt: current && current.lastSeenAt > session.endedAt ? current.lastSeenAt : session.endedAt,
            })
        }

        return [...totals.values()].sort((a, b) => b.durationSeconds - a.durationSeconds)
    }, [filteredSessions, t])

    const pageRows = useMemo<PageUsageRow[]>(() => {
        const totals = new Map<string, { durationSeconds: number; visits: number; users: Set<string> }>()

        for (const pageView of filteredPageViews) {
            const current = totals.get(pageView.path) || { durationSeconds: 0, visits: 0, users: new Set<string>() }
            current.durationSeconds += pageView.durationSeconds
            current.visits += 1
            current.users.add(pageView.uid)
            totals.set(pageView.path, current)
        }

        return [...totals.entries()]
            .map(([path, total]) => ({
                key: path,
                path,
                routeLabel: formatUsageRoute(path),
                visits: total.visits,
                durationSeconds: total.durationSeconds,
                users: total.users.size,
            }))
            .sort((a, b) => b.durationSeconds - a.durationSeconds)
    }, [filteredPageViews])

    const totalDurationSeconds = filteredSessions.reduce((sum, session) => sum + session.durationSeconds, 0)
    // Online now: a heartbeat (every 30s) in the last 2 minutes. The `active` flag alone isn't enough, because it
    // is only cleared when a session closes cleanly, so closed tabs and sleeping laptops stay "active" for good.
    // Ignores the date range (it is about right now), but follows the role and user filters.
    const onlineCutoff = dayjs().subtract(2, 'minute')
    const activeSessions = new Set(sessions
        .filter((session) => session.active && dayjs(session.endedAt).isAfter(onlineCutoff)
            && (roleFilter === 'all' || session.role === roleFilter)
            && (userFilter === 'all' || session.uid === userFilter))
        .map((session) => session.uid)).size
    const topPage = pageRows[0]?.routeLabel || t('usage.noData')
    const dateFormatter = useMemo(
        () => new Intl.DateTimeFormat(language === 'zu' ? 'zu-ZA' : 'en-ZA', {
            dateStyle: 'medium',
            timeStyle: 'short',
        }),
        [language],
    )

    const rangeEnd = dateRange?.[1] || dayjs()
    const lastSevenDays = Array.from({ length: 7 }, (_, index) => rangeEnd.subtract(6 - index, 'day'))
    const dailyBars = (pick: (session: UsageSessionRecord) => number) => lastSevenDays.map((day) => ({
        key: day.valueOf(),
        label: day.format('dd').slice(0, 1),
        value: filteredSessions.filter((session) => dayjs(session.startedAt).isSame(day, 'day')).reduce((sum, session) => sum + pick(session), 0),
    }))
    const totalPageSeconds = pageRows.reduce((sum, row) => sum + row.durationSeconds, 0)
    const roleTime = useMemo(() => {
        const totals = new Map<string, number>()
        filteredSessions.forEach((session) => totals.set(session.role || 'unknown', (totals.get(session.role || 'unknown') || 0) + session.durationSeconds))
        return [...totals.entries()].sort((a, b) => b[1] - a[1])
    }, [filteredSessions])

    const pagesChartOptions = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'bar', height: 340 },
        title: { text: undefined },
        legend: { enabled: false },
        xAxis: { categories: pageRows.slice(0, 8).map((row) => row.routeLabel), lineWidth: 0, tickLength: 0 },
        yAxis: { min: 0, title: { text: t('usage.minutes') }, gridLineDashStyle: 'Dash' },
        plotOptions: { bar: { borderRadius: 6, pointPadding: 0.12, groupPadding: 0.08 } },
        series: [{
            type: 'bar',
            name: t('usage.timeUsed'),
            color: ACCENT,
            data: pageRows.slice(0, 8).map((row) => Math.round(row.durationSeconds / 60)),
        }],
    }), [pageRows, t])

    const usersChartOptions = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'column', height: 340 },
        title: { text: undefined },
        legend: { enabled: false },
        xAxis: { categories: userRows.slice(0, 8).map((row) => row.name), lineWidth: 0, tickLength: 0 },
        yAxis: { min: 0, title: { text: t('usage.minutes') }, gridLineDashStyle: 'Dash' },
        plotOptions: { column: { borderRadius: 6, pointPadding: 0.1, groupPadding: 0.12 } },
        series: [{
            type: 'column',
            name: t('usage.loggedInTime'),
            // The busiest user in full accent, the rest in a lighter shade, like the KPI bars.
            data: userRows.slice(0, 8).map((row, index) => ({ y: Math.round(row.durationSeconds / 60), color: index === 0 ? ACCENT : ACCENT_SOFT })),
        }],
    }), [t, userRows])

    const trendChartOptions = useMemo<Highcharts.Options>(() => {
        const days = new Map<string, { visits: number, durationSeconds: number }>()
        filteredPageViews.forEach((pageView) => {
            const key = dayjs(pageView.startedAt).format('YYYY-MM-DD')
            const current = days.get(key) || { visits: 0, durationSeconds: 0 }
            current.visits += 1
            current.durationSeconds += pageView.durationSeconds
            days.set(key, current)
        })
        const entries = [...days.entries()].sort(([left], [right]) => left.localeCompare(right))
        return {
            chart: { type: 'areaspline', height: 300, spacing: [12, 4, 4, 4] },
            title: { text: undefined },
            legend: { align: 'right', verticalAlign: 'top', itemDistance: 16, symbolRadius: 6 },
            tooltip: { shared: true },
            xAxis: { categories: entries.map(([date]) => dayjs(date).format('DD MMM')), lineWidth: 0, tickLength: 0 },
            yAxis: [
                { min: 0, title: { text: t('usage.visits') }, allowDecimals: false, gridLineDashStyle: 'Dash' },
                { min: 0, opposite: true, title: { text: t('usage.minutes') }, gridLineWidth: 0 },
            ],
            plotOptions: { areaspline: { marker: { radius: 3, symbol: 'circle' }, lineWidth: 2.5 } },
            series: [
                { type: 'areaspline', name: t('usage.visits'), color: ACCENT, data: entries.map(([, total]) => total.visits), fillColor: { linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 }, stops: [[0, 'rgba(109, 93, 251, .32)'], [1, 'rgba(109, 93, 251, 0)']] } },
                { type: 'areaspline', name: t('usage.minutes'), yAxis: 1, color: ACCENT_DEEP, fillColor: 'transparent', dashStyle: 'ShortDash', data: entries.map(([, total]) => Math.round(total.durationSeconds / 60)) },
            ],
        }
    }, [filteredPageViews, t])

    const roleChartOptions = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'pie', height: 220, spacing: [0, 0, 0, 0] },
        title: { text: undefined },
        tooltip: { pointFormatter() { return `<b>${formatDuration(this.y || 0)}</b> (${Math.round(this.percentage || 0)}%)` } },
        plotOptions: { pie: { innerSize: '74%', borderWidth: 3, borderRadius: 6, dataLabels: { enabled: false } } },
        series: [{
            type: 'pie',
            name: t('usage.loggedInTime'),
            data: roleTime.map(([role, seconds], index) => ({ name: t(USER_ROLE_LABELS[role as UserRole] || role), y: seconds, color: ROLE_COLORS[index % ROLE_COLORS.length] })),
        }],
    }), [roleTime, t])

    if (!canView) {
        return (
            <DashboardPage>
                <Alert type="error" showIcon message={t('usage.forbidden')} />
            </DashboardPage>
        )
    }

    const cardHead = (title: string, hint?: string) => (
        <div className="admin-card-head">
            <div>
                <h3>{title}</h3>
                {hint && <span>{hint}</span>}
            </div>
        </div>
    )

    return (
        <DashboardPage className="usage-analytics-page admin-overview">
            {error && <Alert type="error" showIcon message={error} className="usage-analytics-alert" />}
            <Row gutter={[16, 16]} className="usage-analytics-metrics">
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact loading={loading} icon={<ClockCircleOutlined />} label={t('usage.totalTime')} value={formatDuration(totalDurationSeconds)} visual={<AdminMiniBars bars={dailyBars((session) => session.durationSeconds)} />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact loading={loading} icon={<LoginOutlined />} label={t('usage.sessions')} value={filteredSessions.length} visual={<AdminMiniBars bars={dailyBars(() => 1)} />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact loading={loading} icon={<TeamOutlined />} label={t('usage.activeNow')} value={activeSessions} visual={<span className="usage-live-pill"><i />{t('Live')}</span>} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact loading={loading} icon={<BarChartOutlined />} label={t('usage.mostUsed')} value={topPage} visual={pageRows[0] ? <AdminShareRing size={44} value={pageRows[0].durationSeconds} total={totalPageSeconds} muted /> : undefined} /></Col>
            </Row>
            <FilterBar primary={<><Select value={roleFilter} onChange={setRoleFilter} options={[{ value: 'all', label: t('usage.allRoles') }, ...roleOptions]} /><Select value={userFilter} onChange={setUserFilter} options={[{ value: 'all', label: t('usage.allUsers') }, ...userOptions]} /><Select value={routeFilter} onChange={setRouteFilter} options={[{ value: 'all', label: t('usage.allRoutes') }, ...routeOptions]} /><RangePicker value={dateRange} onChange={(value) => setDateRange(value as [Dayjs, Dayjs] | null)} /></>} />
            <Segmented className="usage-analytics-segments" block value={section} onChange={setSection} options={[
                { value: 'overview', label: t('usage.overview') },
                { value: 'users', label: t('usage.users') },
                { value: 'pages', label: t('usage.pages') },
            ]} />

            {section === 'overview' && <>
                <Row gutter={[16, 16]}>
                    <Col xs={24} lg={16}>
                        <Card className="admin-card" bordered={false} loading={loading}>
                            {cardHead(t('usage.activityTrend'), t('Page visits and minutes per day'))}
                            {filteredPageViews.length ? <ThemedHighcharts options={trendChartOptions} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                        </Card>
                    </Col>
                    <Col xs={24} lg={8}>
                        <Card className="admin-card" bordered={false} loading={loading}>
                            {cardHead(t('Time by role'), t('Share of logged-in time'))}
                            {roleTime.length ? (
                                <>
                                    <div className="admin-donut">
                                        <ThemedHighcharts options={roleChartOptions} />
                                        <div className="admin-donut-center"><strong className="is-text">{formatDuration(totalDurationSeconds)}</strong><span>{t('usage.totalTime')}</span></div>
                                    </div>
                                    <ul className="admin-legend">
                                        {roleTime.slice(0, 6).map(([role, seconds], index) => (
                                            <li key={role}><i style={{ background: ROLE_COLORS[index % ROLE_COLORS.length] }} />{t(USER_ROLE_LABELS[role as UserRole] || role)}<b>{formatDuration(seconds)}</b></li>
                                        ))}
                                    </ul>
                                </>
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                        </Card>
                    </Col>
                </Row>
                <Row gutter={[16, 16]} className="usage-analytics-row">
                    <Col xs={24} lg={12}>
                        <Card className="admin-card" bordered={false} loading={loading}>
                            {cardHead(t('usage.pagesChart'), t('Ranked by time spent'))}
                            {pageRows.length ? (
                                <ol className="usage-rank-list">
                                    {pageRows.slice(0, 6).map((row, index) => (
                                        <li key={row.key}>
                                            <span className="usage-rank-index">{index + 1}</span>
                                            <div className="usage-rank-copy">
                                                <div className="usage-rank-top"><strong title={row.path}>{row.routeLabel}</strong><b>{formatDuration(row.durationSeconds)}</b></div>
                                                <div className="usage-rank-bar"><span style={{ width: `${Math.max(4, (row.durationSeconds / (pageRows[0].durationSeconds || 1)) * 100)}%` }} /></div>
                                                <small>{t('{visits} visits · {users} users', undefined, { visits: row.visits, users: row.users })}</small>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                        </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Card className="admin-card" bordered={false} loading={loading}>
                            {cardHead(t('Most active users'), t('Ranked by logged-in time'))}
                            {userRows.length ? (
                                <ol className="usage-rank-list">
                                    {userRows.slice(0, 6).map((row) => (
                                        <li key={row.key}>
                                            <Avatar size={36} className="usage-rank-avatar">{initialsOf(row.name)}</Avatar>
                                            <div className="usage-rank-copy">
                                                <div className="usage-rank-top"><strong title={row.email}>{row.name}</strong><b>{formatDuration(row.durationSeconds)}</b></div>
                                                <div className="usage-rank-bar"><span style={{ width: `${Math.max(4, (row.durationSeconds / (userRows[0].durationSeconds || 1)) * 100)}%` }} /></div>
                                                <small><AdminRoleTag role={row.role} /> {t('{count} sessions', undefined, { count: row.sessions })}</small>
                                            </div>
                                        </li>
                                    ))}
                                </ol>
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                        </Card>
                    </Col>
                </Row>
            </>}

            {section === 'users' && <>
                <Card className="admin-card usage-analytics-table-card" bordered={false}>
                    {cardHead(t('usage.usersChart'), t('Top 8 users, in minutes'))}
                    {userRows.length ? <ThemedHighcharts options={usersChartOptions} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </Card>
                <Card className="admin-card usage-analytics-table-card" bordered={false}>
                    {cardHead(t('usage.usersTable'))}
                    <ResponsiveDataView
                        rowKey="key"
                        rows={userRows}
                        emptyText={t('usage.noData')}
                        columns={[
                            { title: t('usage.user'), dataIndex: 'name', key: 'name', render: (_, row) => <Space size={10}><Avatar size={32} className="usage-rank-avatar">{initialsOf(row.name)}</Avatar><Space direction="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text></Space></Space> },
                            { title: t('usage.role'), dataIndex: 'role', key: 'role', render: (role) => <AdminRoleTag role={role} /> },
                            { title: t('usage.sessions'), dataIndex: 'sessions', key: 'sessions' },
                            { title: t('usage.loggedInTime'), dataIndex: 'durationSeconds', key: 'durationSeconds', render: formatDuration },
                            { title: t('usage.lastSeen'), dataIndex: 'lastSeenAt', key: 'lastSeenAt', render: (date) => dateFormatter.format(date) },
                        ]}
                        renderCard={(row) => <Space orientation="vertical"><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text><AdminRoleTag role={row.role} /><Typography.Text>{t('usage.loggedInTime')}: {formatDuration(row.durationSeconds)}</Typography.Text></Space>}
                    />
                </Card>
            </>}

            {section === 'pages' && <>
                <Card className="admin-card usage-analytics-table-card" bordered={false}>
                    {cardHead(t('usage.pagesChart'), t('Top 8 pages, in minutes'))}
                    {pageRows.length ? <ThemedHighcharts options={pagesChartOptions} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </Card>
                <Card className="admin-card usage-analytics-table-card" bordered={false}>
                    {cardHead(t('usage.pagesTable'))}
                    <ResponsiveDataView
                        rowKey="key"
                        rows={pageRows}
                        emptyText={t('usage.noData')}
                        columns={[
                            { title: t('usage.page'), dataIndex: 'routeLabel', key: 'routeLabel', render: (_, row) => <Space orientation="vertical" size={0}><Typography.Text strong>{row.routeLabel}</Typography.Text><Typography.Text type="secondary">{row.path}</Typography.Text></Space> },
                            { title: t('usage.visits'), dataIndex: 'visits', key: 'visits' },
                            { title: t('usage.uniqueUsers'), dataIndex: 'users', key: 'users' },
                            { title: t('usage.timeUsed'), dataIndex: 'durationSeconds', key: 'durationSeconds', render: formatDuration },
                        ]}
                        renderCard={(row) => <Space orientation="vertical"><Typography.Text strong>{row.routeLabel}</Typography.Text><Typography.Text type="secondary">{row.path}</Typography.Text><Typography.Text>{t('usage.visits')}: {row.visits}</Typography.Text><Typography.Text>{t('usage.timeUsed')}: {formatDuration(row.durationSeconds)}</Typography.Text></Space>}
                    />
                </Card>
            </>}
        </DashboardPage>
    )
}
