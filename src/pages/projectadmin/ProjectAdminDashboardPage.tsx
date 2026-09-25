import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { App, Card, Col, Empty, Progress, Row, theme, Typography } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { UpcomingWeekCard, type InterventionDueItem } from '@/pages/dashboards/operations/UpcomingWeekCard'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    isComplianceAttentionStatus,
    isCompletedInterventionStatus,
    isOpenApplicationStatus,
    isOverdueIntervention,
    loadProjectAdminWorkspace,
    type ProjectAdminWorkspaceData,
} from '@/services/projectAdminWorkspaceService'
import '@/styles/dashboard.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const emptyWorkspace: ProjectAdminWorkspaceData = {
    applications: [],
    participants: [],
    interventions: [],
    complianceDocuments: [],
    staff: [],
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const labelize = (value: string) =>
    value
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ') || 'Unspecified'

const statusLabel = (value: string) => {
    const status = normalize(value)
    if (['awaiting_confirmation', 'awaiting confirmation'].includes(status)) return 'Awaiting SME Confirmation'
    if (['awaiting_sme_acceptance', 'awaiting sme acceptance'].includes(status)) return 'Awaiting SME Acceptance'
    if (['awaiting_assignee_acceptance', 'awaiting assignee acceptance'].includes(status)) return 'Awaiting Facilitator Acceptance'
    return labelize(value)
}

const statusColor = (value: string) => {
    const status = normalize(value).replace(/[\s-]+/g, '_')
    if (['accepted', 'approved', 'complete', 'completed', 'confirmed', 'done', 'valid', 'active', 'clear'].includes(status)) {
        return '#22C55E'
    }
    if (['rejected', 'declined', 'failed', 'overdue', 'expired', 'invalid', 'cancelled', 'changes_requested', 'inactive'].includes(status)) {
        return '#EF4444'
    }
    if (status.includes('pending') || status.includes('awaiting') || ['submitted', 'under_review', 'queried', 'missing'].includes(status)) {
        return '#F59E0B'
    }
    if (['in_progress', 'open', 'assigned'].includes(status)) return '#3B82F6'
    return '#64748B'
}

const countBy = <T,>(rows: T[], readKey: (row: T) => string) =>
    rows.reduce<Record<string, number>>((acc, row) => {
        const key = labelize(readKey(row))
        acc[key] = (acc[key] || 0) + 1
        return acc
    }, {})

const mapCountSeries = (counts: Record<string, number>, colorForName?: (name: string, index: number) => string) =>
    Object.entries(counts)
        .sort((left, right) => right[1] - left[1])
        .map(([name, y], index) => ({ name: statusLabel(name), y, color: colorForName?.(name, index) }))

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.round((numerator / denominator) * 100) : 0)

const QuickProgressCard = ({ icon, iconClassName, label, value, total, loading, danger }: {
    icon: ReactNode
    iconClassName?: string
    label: string
    value: number
    total: number
    loading?: boolean
    danger?: boolean
}) => {
    const { t } = useLanguage()
    const { token } = theme.useToken()
    return (
        <Card loading={loading} bordered className="dashboard-metric-card motion-card">
            <div className="dashboard-metric-row">
                <span className={`dashboard-metric-icon ${iconClassName || ''}`}>{icon}</span>
                <div className="dashboard-metric-copy" style={{ width: '100%' }}>
                    <Typography.Text type="secondary" className="dashboard-metric-label">{label}</Typography.Text>
                    <span className="dashboard-metric-value">{value}</span>
                    <Progress
                        percent={percent(value, total)}
                        size="small"
                        showInfo={false}
                        strokeColor={danger ? token.colorError : token.colorPrimary}
                        style={{ marginTop: 6 }}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 11 }}>{value} {t('of')} {total}</Typography.Text>
                </div>
            </div>
        </Card>
    )
}

const HorizontalRateBar = ({ label, value, caption, color }: { label: string, value: number, caption: string, color: string }) => (
    <div style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Typography.Text strong style={{ fontSize: 13 }}>{label}</Typography.Text>
            <Typography.Text strong style={{ fontSize: 18 }}>{value}%</Typography.Text>
        </div>
        <Progress percent={value} size="small" showInfo={false} strokeColor={color} style={{ marginTop: 6 }} />
        <Typography.Text type="secondary" style={{ fontSize: 11 }}>{caption}</Typography.Text>
    </div>
)

export default function ProjectAdminDashboardPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<ProjectAdminWorkspaceData>(emptyWorkspace)

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            if (identityLoading || !user) return

            try {
                setLoading(true)
                const result = await loadProjectAdminWorkspace(user, activeProgramId)
                if (!cancelled) setData(result)
            } catch (error) {
                console.error('[PROJECT ADMIN DASHBOARD] Failed loading workspace:', error)
                if (!cancelled) {
                    setData(emptyWorkspace)
                    message.error(t('Failed to load project admin dashboard data.'))
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()

        return () => {
            cancelled = true
        }
    }, [activeProgramId, identityLoading, message, user, t])

    const metrics = useMemo(() => {
        const totalParticipants = data.participants.length
        const activeParticipants = data.participants.filter((participant) =>
            !['inactive', 'exited', 'removed'].includes(normalize(participant.status)),
        ).length

        const totalApplications = data.applications.length
        const openApplications = data.applications.filter((application) => isOpenApplicationStatus(application.status)).length
        const acceptedApplications = data.applications.filter((application) =>
            ['accepted', 'approved'].includes(normalize(application.status)),
        ).length

        const totalInterventions = data.interventions.length
        const completedInterventions = data.interventions.filter((intervention) => isCompletedInterventionStatus(intervention.status)).length
        const interventionsInProgress = totalInterventions - completedInterventions
        const overdueInterventions = data.interventions.filter((intervention) => isOverdueIntervention(intervention)).length

        const totalComplianceDocuments = data.complianceDocuments.length
        const complianceAttention = data.complianceDocuments.filter((document) =>
            isComplianceAttentionStatus(document.status),
        ).length
        const compliantDocuments = Math.max(0, totalComplianceDocuments - complianceAttention)

        const totalStaff = data.staff.length
        const activeStaff = data.staff.filter((staff) => normalize(staff.status) !== 'inactive').length

        return {
            totalParticipants,
            activeParticipants,
            totalApplications,
            openApplications,
            totalInterventions,
            completedInterventions,
            interventionsInProgress,
            overdueInterventions,
            totalComplianceDocuments,
            complianceAttention,
            totalStaff,
            activeStaff,
            acceptanceRate: percent(acceptedApplications, totalApplications),
            deliveryRate: percent(completedInterventions, totalInterventions),
            complianceRate: percent(compliantDocuments, totalComplianceDocuments),
        }
    }, [data])

    const interventionChart = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'pie', height: 220 },
        title: { text: undefined },
        tooltip: { pointFormat: '<b>{point.y}</b> interventions' },
        plotOptions: { pie: { innerSize: '55%', dataLabels: { enabled: true, style: { fontSize: '11px', textOutline: 'none' } } } },
        series: [{
            type: 'pie',
            name: tr('Interventions'),
            data: mapCountSeries(countBy(data.interventions, (intervention) => intervention.status), statusColor),
        }],
    }), [data.interventions])

    const interventionDueItems = useMemo<InterventionDueItem[]>(() =>
        data.interventions
            .filter((intervention) => intervention.dueDate && !isCompletedInterventionStatus(intervention.status))
            .map((intervention) => ({
                id: intervention.id,
                title: intervention.title,
                participantName: intervention.participantName,
                owner: intervention.owner,
                dueDate: dayjs(intervention.dueDate as Date),
            })),
    [data.interventions])

    const cardsLoading = identityLoading || loading

    return (
        <DashboardPage className="dashboard-home-page project-admin-dashboard-page project-admin-dashboard-compact">
            <Row gutter={[16, 16]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <QuickProgressCard loading={cardsLoading} icon={<TeamOutlined />} iconClassName="dashboard-icon-green" label={t('Active SMEs')} value={metrics.activeParticipants} total={metrics.totalParticipants} />
                </Col>
                <Col xs={12} lg={6}>
                    <QuickProgressCard loading={cardsLoading} icon={<CheckCircleOutlined />} iconClassName="dashboard-icon-blue" label={t('Interventions in progress')} value={metrics.interventionsInProgress} total={metrics.totalInterventions} />
                </Col>
                <Col xs={12} lg={6}>
                    <QuickProgressCard loading={cardsLoading} icon={<ExclamationCircleOutlined />} iconClassName="dashboard-icon-red" label={t('Overdue interventions')} value={metrics.overdueInterventions} total={metrics.totalInterventions} danger />
                </Col>
                <Col xs={12} lg={6}>
                    <QuickProgressCard loading={cardsLoading} icon={<CalendarOutlined />} iconClassName="dashboard-icon-green" label={t('Active staff')} value={metrics.activeStaff} total={metrics.totalStaff} />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <Card loading={cardsLoading} className="dashboard-section-card motion-card" title={t('Intervention Delivery')}>
                        {data.interventions.length ? <ThemedHighcharts options={interventionChart} /> : <Empty description={t('No intervention data yet.')} />}
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card loading={cardsLoading} className="dashboard-section-card motion-card" title={t('Rates')}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, padding: '4px 0' }}>
                            <HorizontalRateBar
                                label={t('Acceptance')}
                                value={metrics.acceptanceRate}
                                color="#3B82F6"
                                caption={`${metrics.openApplications} of ${metrics.totalApplications} still open`}
                            />
                            <HorizontalRateBar
                                label={t('Delivery')}
                                value={metrics.deliveryRate}
                                color="#22C55E"
                                caption={`${metrics.completedInterventions} of ${metrics.totalInterventions} completed`}
                            />
                            <HorizontalRateBar
                                label={t('Compliance')}
                                value={metrics.complianceRate}
                                color="#F59E0B"
                                caption={`${metrics.complianceAttention} of ${metrics.totalComplianceDocuments} need attention`}
                            />
                        </div>
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col span={24}>
                    <UpcomingWeekCard interventionDueItems={interventionDueItems} loading={cardsLoading} />
                </Col>
            </Row>
        </DashboardPage>
    )
}
