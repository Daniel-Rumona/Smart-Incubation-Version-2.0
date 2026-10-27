import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Card, Col, Progress, Row, Tag, Typography, type TableProps } from 'antd'
import {
    AimOutlined,
    ArrowRightOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    RiseOutlined,
    TeamOutlined,
    UserDeleteOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { KpiStatusList } from '@/components/director/KpiStatusList'
import { OverdueUpdatesModal } from '@/components/director/OverdueUpdatesModal'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadDirectorBriefing, type AttentionItem, type DirectorBriefing, type DirectorProgrammeRow, type KpiTally } from '@/services/directorDashboardService'
import '@/styles/director.css'

const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)}`

const ATTENTION_ICONS: Record<AttentionItem['key'], React.ReactNode> = {
    overdue: <ClockCircleOutlined />,
    kpis_behind: <AimOutlined />,
    low_completion: <ExclamationCircleOutlined />,
    unresponsive: <UserDeleteOutlined />,
    high_risk: <WarningOutlined />,
}

const completionColor =(rate: number) => (rate >= 75 ? '#16a34a' : rate >= 40 ? '#f59e0b' : '#ef4444')

/**
 * The director's briefing for the active programme (or all of them): growth, KPIs and delivery up top, one row per
 * programme, and the few things that need attention, each linking to the page that explains it.
 */
const DirectorDashboard: React.FC = () => {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [data, setData] = useState<DirectorBriefing | null>(null)
    const [loading, setLoading] = useState(true)
    const [overdueOpen, setOverdueOpen] = useState(false)
    const programmeNames = useMemo(() => new Map((data?.programmes || []).map((row) => [row.id, row.name])), [data])

    const load = useCallback(async () => {
        if (identityLoading || !user) return
        setLoading(true)
        try {
            setData(await loadDirectorBriefing(user, { activeProgramId, isAllPrograms }))
        } catch (error) {
            console.error('[DIRECTOR] Failed to load the dashboard:', error)
            message.error(t('The dashboard could not be loaded.'))
            setData(null)
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, identityLoading, isAllPrograms, message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const pageLoading = identityLoading || loading

    const kpiText = (tally: KpiTally) => tally.withTarget
        ? t('{onTrack} of {count} on track', undefined, { onTrack: tally.onTrack, count: tally.withTarget })
        : t('No targets set')

    const attentionText = (item: AttentionItem) => {
        const one = item.count === 1
        switch (item.key) {
            case 'overdue':
                return [
                    one ? t('1 intervention is overdue.') : t('{count} interventions are overdue.', undefined, { count: item.count }),
                    item.programme ? t('{programme} has the most.', undefined, { programme: item.programme }) : '',
                ].filter(Boolean).join(' ')
            case 'kpis_behind':
                return one
                    ? t('1 KPI is behind target: {names}.', undefined, { names: (item.names || []).join(', ') })
                    : t('{count} KPIs are behind target, including {names}.', undefined, { count: item.count, names: (item.names || []).join(', ') })
            case 'low_completion':
                return t('{programme} has completed only {count}% of its required support.', undefined, { programme: item.programme || '', count: item.count })
            case 'unresponsive':
                return one
                    ? t('1 SME hasn’t accepted its support after 7 days or more.')
                    : t('{count} SMEs haven’t accepted their support after 7 days or more.', undefined, { count: item.count })
            case 'high_risk':
                return one ? t('1 SME is flagged high risk.') : t('{count} SMEs are flagged high risk.', undefined, { count: item.count })
        }
    }

    const programmeName = (row: DirectorProgrammeRow) => (row.id === 'unassigned' ? t('No programme') : row.name)

    const completionCell = (row: DirectorProgrammeRow) => row.completion === null
        ? <Typography.Text type="secondary">{t('Nothing required yet')}</Typography.Text>
        : (
            <div className="director-completion">
                <Progress percent={row.completion} size="small" strokeColor={completionColor(row.completion)} showInfo={false} />
                <Typography.Text type="secondary">{t('{completed} of {required}', undefined, { completed: row.completed, required: row.required })}</Typography.Text>
            </div>
        )
    const kpiCell = (row: DirectorProgrammeRow) => row.kpis.withTarget
        ? <Tag bordered={false} color={row.kpis.behind ? 'orange' : 'green'}>{kpiText(row.kpis)}</Tag>
        : <Typography.Text type="secondary">—</Typography.Text>
    const growthCell = (row: DirectorProgrammeRow) => row.revenueGrowth === null
        ? <Typography.Text type="secondary">—</Typography.Text>
        : <Tag bordered={false} color={row.revenueGrowth > 0 ? 'green' : row.revenueGrowth < 0 ? 'red' : undefined}>{signed(row.revenueGrowth)}%</Tag>
    const flagsCell = (row: DirectorProgrammeRow) => (
        <span className="director-flags">
            {row.overdue > 0 && <Tag bordered={false} color="red">{t('{count} overdue', undefined, { count: row.overdue })}</Tag>}
            {row.highRisk > 0 && <Tag bordered={false} color="orange">{t('{count} high risk', undefined, { count: row.highRisk })}</Tag>}
            {!row.overdue && !row.highRisk && <Typography.Text type="secondary">—</Typography.Text>}
        </span>
    )

    const columns: TableProps<DirectorProgrammeRow>['columns'] = [
        { title: t('Programme'), key: 'name', render: (_, row) => <Typography.Text strong>{programmeName(row)}</Typography.Text> },
        { title: t('SMEs'), dataIndex: 'smes', width: 80, align: 'center' },
        { title: t('Completion'), key: 'completion', width: 200, render: (_, row) => completionCell(row) },
        { title: t('KPIs'), key: 'kpis', width: 150, render: (_, row) => kpiCell(row) },
        { title: t('Revenue growth'), key: 'growth', width: 130, align: 'center', render: (_, row) => growthCell(row) },
        { title: t('Flags'), key: 'flags', render: (_, row) => flagsCell(row) },
    ]

    // Programmes with SMEs or overdue work; brand-new empty ones are left to Programme performance.
    const activeProgrammes = (data?.programmes || []).filter((row) => row.smes > 0 || row.overdue > 0)
    const showProgrammes = pageLoading || activeProgrammes.length > 1

    return (
        <DashboardPage className="director-dashboard-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row director-dashboard-metrics">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<RiseOutlined />}
                        iconClassName="is-participants"
                        label={t('Revenue growth')}
                        value={data?.revenueGrowth !== null && data?.revenueGrowth !== undefined ? `${signed(data.revenueGrowth)}%` : '—'}
                        hint={data?.smesWithRevenue
                            ? t('{growing} of {count} SMEs growing since joining', undefined, { growing: data.growingSmes, count: data.smesWithRevenue })
                            : t('No revenue history yet')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<TeamOutlined />}
                        iconClassName="is-users"
                        label={t('Jobs created')}
                        value={data?.smesWithJobs ? signed(data.netJobs) : '—'}
                        hint={data?.smesWithJobs ? t('Net change across {count} SMEs', undefined, { count: data.smesWithJobs }) : t('No headcount history yet')}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<AimOutlined />}
                        iconClassName="is-attention"
                        label={t('KPIs on track')}
                        value={data?.kpis.withTarget ? `${data.kpis.onTrack} / ${data.kpis.withTarget}` : '—'}
                        hint={data
                            ? data.kpis.withTarget
                                ? t('{count} behind target', undefined, { count: data.kpis.behind })
                                : t('No targets set')
                            : undefined}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="is-delivery"
                        label={t('Completion')}
                        value={data?.completion !== null && data?.completion !== undefined ? `${data.completion}%` : '—'}
                        hint={data?.required
                            ? t('{completed} of {required} required interventions', undefined, { completed: data.completed, required: data.required })
                            : t('Nothing required yet')}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={9}>
                    <Card loading={pageLoading} className="dashboard-section-card motion-card director-attention-card" title={t('Needs your attention')}>
                        {data && (data.attention.length ? (
                            <ul className="director-attention">
                                {data.attention.map((item) => (
                                    <li key={`${item.key}-${item.programme || ''}`}>
                                        <button type="button" onClick={() => (item.key === 'overdue' ? setOverdueOpen(true) : navigate(item.path))}>
                                            <span className={`director-attention-icon is-${item.key}`}>{ATTENTION_ICONS[item.key]}</span>
                                            <span className="director-attention-text">{attentionText(item)}</span>
                                            <ArrowRightOutlined className="director-attention-go" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <div className="director-all-clear">
                                <CheckCircleOutlined />
                                <div>
                                    <Typography.Text strong>{t('Nothing needs your attention right now.')}</Typography.Text>
                                    <Typography.Text type="secondary">{t('Nothing is overdue, behind target or flagged high risk.')}</Typography.Text>
                                </div>
                            </div>
                        ))}
                    </Card>
                </Col>
                {showProgrammes && (
                    <Col xs={24} xl={15}>
                        <Card
                            className="dashboard-section-card motion-card"
                            title={t('Programmes at a glance')}
                            extra={<Typography.Link onClick={() => navigate('/director/programs')}>{t('Programme performance')} <ArrowRightOutlined /></Typography.Link>}
                        >
                            <ResponsiveDataView<DirectorProgrammeRow>
                                rowKey="id"
                                rows={activeProgrammes}
                                columns={columns}
                                loading={pageLoading}
                                emptyText={t('No programmes with SMEs yet.')}
                                onRowClick={() => navigate('/director/programs')}
                                rowClassName={() => 'director-programme-row'}
                                renderCard={(row) => (
                                    <div className="director-programme-card">
                                        <span className="director-programme-head">
                                            <Typography.Text strong>{programmeName(row)}</Typography.Text>
                                            {growthCell(row)}
                                        </span>
                                        {completionCell(row)}
                                        <span className="director-flags">
                                            <Typography.Text type="secondary">{t('{count} SMEs', undefined, { count: row.smes })}</Typography.Text>
                                            {kpiCell(row)}
                                            {flagsCell(row)}
                                        </span>
                                    </div>
                                )}
                            />
                        </Card>
                    </Col>
                )}
                {/* One programme in view: its KPIs take the place of the programmes table. */}
                {!showProgrammes && (
                    <Col xs={24} xl={15}>
                        <Card
                            className="dashboard-section-card motion-card"
                            title={t('KPI status')}
                            extra={<Typography.Link onClick={() => navigate('/kpis')}>{t('KPIs')} <ArrowRightOutlined /></Typography.Link>}
                        >
                            {data && <KpiStatusList items={data.kpiItems} emptyText={t('No KPI targets set for this programme yet. Set them on the KPIs page.')} />}
                        </Card>
                    </Col>
                )}
            </Row>

            {user && (
                <OverdueUpdatesModal
                    open={overdueOpen}
                    onClose={() => setOverdueOpen(false)}
                    user={user}
                    activeProgramId={activeProgramId}
                    programmeNames={programmeNames}
                />
            )}
        </DashboardPage>
    )
}

export default DirectorDashboard
