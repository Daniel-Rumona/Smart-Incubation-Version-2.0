import { Alert, App, Button, Card, Col, Descriptions, Divider, Empty, Form, Grid, Input, List, Modal, Progress, Rate, Row, Segmented, Select, Skeleton, Space, Tag, Typography, type TableProps } from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, EyeOutlined, FileSearchOutlined, LineChartOutlined, PlusOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { AppointmentInvitations } from '@/components/incubatee/AppointmentInvitations'
import MetricsGrid from '@/components/shared/MetricsGrid'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { guideTarget, useRegisterPageGuide, type PageGuideRegistration } from '@/components/guide/PageGuideContext'
import { meetingTypeLabel, toDayjs } from '@/components/interventions/appointmentSchedule'
import {
    acceptIncubateeIntervention,
    canAcceptIncubateeIntervention,
    canConfirmIncubateeIntervention,
    confirmIncubateeCompletion,
    confirmIncubateeGrowthPlan,
    declineIncubateeIntervention,
    loadIncubateeInterventionAppointments,
    loadIncubateeWorkspace,
    rejectIncubateeCompletion,
    requestIncubateeIntervention,
} from '@/services/incubateeWorkspaceService'
import type { IncubateeIntervention, IncubateeInterventionAppointment, IncubateeWorkspace } from '@/types/incubatee'
import { getAgentWorkspaceUrl } from '@/services/agentOrchestrationService'
import { listAgents } from '@/services/agentRegistryService'
import type { AgentDefinition } from '@/types/agentOrchestration'
import type { Dayjs } from 'dayjs'
import type { DriveStep, Driver } from 'driver.js'
import '@/styles/incubatee.css'

type Action = 'decline' | 'confirm' | 'reject'

type ProgressEventKind = 'assigned' | 'appointment' | 'completed'

type ProgressEvent = {
    key: string
    kind: ProgressEventKind
    date: Dayjs
    status?: string
    meetingType?: string
    received?: boolean
}

type ProgressMonthGroup = {
    key: string
    label: string
    events: ProgressEvent[]
    appointmentCount: number
    receivedCount: number
}

const openGuideTargetThenContinue = (selector: string) => (
    _element: Element | undefined,
    _step: DriveStep,
    { driver }: { driver: Driver },
) => {
    const trigger = Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => element.offsetParent !== null)
    trigger?.click()
    window.setTimeout(() => driver.moveNext(), 180)
}

const statusColor = (status: string) => {
    if (status === 'Completed') return 'green'
    if (status === 'Declined' || status === 'Rejected') return 'red'
    if (status === 'In Progress') return 'blue'
    if (status === 'Awaiting Confirmation') return 'purple'
    if (status === 'Awaiting Your Acceptance') return 'gold'
    if (status === 'Awaiting Facilitator') return 'cyan'
    return 'orange'
}

export const IncubateeInterventionsPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const [requestForm] = Form.useForm<{ areaOfSupport: string, interventionTitle: string, reason: string }>()
    const [actionForm] = Form.useForm<{ reason?: string, rating?: number, feedback?: string }>()
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [status, setStatus] = useState('All')
    const [search, setSearch] = useState('')
    const [trackerView, setTrackerView] = useState<'interventions' | 'requests'>('interventions')
    const [requestOpen, setRequestOpen] = useState(false)
    const [requestedArea, setRequestedArea] = useState('')
    const [selected, setSelected] = useState<IncubateeIntervention>()
    const [action, setAction] = useState<Action>()
    const [agentsById, setAgentsById] = useState<Record<string, AgentDefinition>>({})
    // "View Progress" (human-delivered interventions only — agent-delivered work has
    // no appointments and keeps the existing Review modal / agent workspace flow).
    const [progressItem, setProgressItem] = useState<IncubateeIntervention>()
    const [progressAppointments, setProgressAppointments] = useState<IncubateeInterventionAppointment[]>([])
    const [progressLoading, setProgressLoading] = useState(false)
    const [progressSelectedMonth, setProgressSelectedMonth] = useState<string | null>(null)

    useEffect(() => {
        void listAgents().then((agents) => {
            setAgentsById(Object.fromEntries(agents.map((agent) => [agent.id, agent])))
        })
    }, [])

    const agentNameFor = (agentId?: string | null) => (agentId ? agentsById[agentId]?.name : undefined)

    const openAgentWorkspace = async (agentId: string, assignmentId: string) => {
        const workspaceUrl = await getAgentWorkspaceUrl(agentId, assignmentId)
        if (workspaceUrl) navigate(workspaceUrl)
        else message.error('This agent workspace is not currently available.')
    }

    const load = async () => {
        if (!user) return
        try {
            setWorkspace(await loadIncubateeWorkspace(user))
        } catch {
            message.error(t('incubatee.common.loadError'))
            setWorkspace(null)
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => workspace?.assignedInterventions.filter((item) => {
        const needle = search.trim().toLowerCase()
        const matchesStatus = status === 'All' || item.status === status
        const matchesSearch = !needle || `${item.title} ${item.areaOfSupport || ''} ${item.assigneeName || ''}`.toLowerCase().includes(needle)
        return matchesStatus && matchesSearch
    }) || [], [search, status, workspace])

    const areas = useMemo(() => [...new Set((workspace?.requiredInterventions || []).map((item) => item.areaOfSupport).filter(Boolean))] as string[], [workspace])

    const interventionOptionsByArea = useMemo(() => {
        const options = new Map<string, Array<{ value: string, label: string }>>()
        for (const intervention of workspace?.requiredInterventions || []) {
            const area = String(intervention.areaOfSupport || '').trim()
            if (!area) continue
            const current = options.get(area) || []
            if (!current.some((item) => item.value === intervention.title)) {
                current.push({ value: intervention.title, label: intervention.title })
            }
            options.set(area, current)
        }
        return options
    }, [workspace])

    const metrics = useMemo(() => ({
        required: workspace?.requiredInterventions.length || 0,
        inProgress: workspace?.assignedInterventions.filter((item) => item.status === 'In Progress').length || 0,
        awaiting: workspace?.assignedInterventions.filter(canConfirmIncubateeIntervention).length || 0,
        completed: workspace?.assignedInterventions.filter((item) => item.status === 'Completed').length || 0,
    }), [workspace])

    const guideRegistration = useMemo<PageGuideRegistration>(() => ({
        pageId: 'incubatee-interventions',
        pageTitle: 'Interventions Tracker',
        guides: [
            {
                id: 'interventions-overview', title: 'Quick tour', description: 'Understand the views, counts and filters on this tracker.', kind: 'page', order: 1,
                steps: [
                    { element: guideTarget('intervention-metrics'), popover: { title: 'Your current workload', description: 'These counts separate required, active, awaiting-confirmation and completed interventions so you can prioritise the next action.', side: 'bottom' } },
                    { element: guideTarget('intervention-view-switch'), popover: { title: 'Interventions and requests', description: 'Switch between assigned work and your submitted support requests.', side: 'bottom' } },
                    { element: guideTarget('intervention-table-filters'), popover: { title: 'Find the right intervention', description: 'Search by name, area or facilitator, then narrow the table by status.', side: 'bottom' } },
                    { element: guideTarget('intervention-records'), popover: { title: 'Your intervention records', description: 'Each row shows the support area, delivery owner, current status and actions that are available to you.', side: 'top' } },
                ],
            },
            {
                id: 'interventions-review-work', title: 'Review my work', description: 'Open an intervention and understand the details shown there.', kind: 'task', order: 2,
                steps: [
                    { element: '[data-guide="incubatee-intervention-review"]', waitForElement: 1200, popover: { title: 'Review an intervention', description: 'Use Open to inspect this intervention without leaving the guide.', side: 'left', nextBtnText: 'Open', onNextClick: openGuideTargetThenContinue('[data-guide="incubatee-intervention-review"]') } },
                    { element: guideTarget('intervention-detail-summary'), waitForElement: 5000, popover: { title: 'Intervention details', description: 'Confirm the support area, delivery owner and status before deciding what to do next.', side: 'left' } },
                    { element: guideTarget('intervention-detail-progress'), waitForElement: 5000, popover: { title: 'Progress and supporting material', description: 'Track completion here, then use any linked resources or feedback to continue the work.', side: 'left' } },
                ],
            },
            {
                id: 'interventions-request', title: 'Request intervention', description: 'Request the right support by area, intervention and reason.', kind: 'task', order: 3,
                steps: [
                    { element: guideTarget('request-intervention'), popover: { title: 'Request support', description: 'Choose Open to start a new intervention request.', side: 'bottom', nextBtnText: 'Open', onNextClick: openGuideTargetThenContinue(guideTarget('request-intervention')) } },
                    { element: guideTarget('request-intervention-form'), waitForElement: 5000, popover: { title: 'Choose support', description: 'This form keeps the request focused: area first, then its available interventions.', side: 'left' } },
                    { element: guideTarget('request-intervention-area'), waitForElement: 5000, popover: { title: '1. Choose an area', description: 'Select the support area that best matches what you need.', side: 'left' } },
                    { element: guideTarget('request-intervention-title'), waitForElement: 5000, popover: { title: '2. Select an intervention', description: 'Only interventions available for the selected area are shown here.', side: 'left' } },
                    { element: guideTarget('request-intervention-reason'), waitForElement: 5000, popover: { title: '3. Explain the request', description: 'Add the context that helps the team assess and route your request.', side: 'left' } },
                    { element: guideTarget('request-intervention-submit'), waitForElement: 5000, popover: { title: 'Submit when ready', description: 'Review the area, intervention and reason, then submit the request.', side: 'top' } },
                ],
            },
            ...(rows.some((item) => item.agentId && item.status === 'In Progress') ? [{
                id: 'interventions-agent-work', title: 'Continue with an agent', description: 'Open the agent-led workspace for the selected intervention.', kind: 'task' as const, order: 4,
                steps: [{ element: '[data-guide-agent-intervention]', waitForElement: 1200, popover: { title: 'Open the agent workspace', description: 'Use this for agent-led interventions. The agent workspace has its own focused guide menu.', side: 'left' as const } }],
            }] : []),
        ],
    }), [rows])

    useRegisterPageGuide(guideRegistration)

    useRegisterAgentPageContext({
        pageKey: 'incubatee-intervention-tracker',
        pageName: t('incubatee.tracker.title'),
        purpose: t('incubatee.tracker.subtitle'),
        filters: { search, status },
        metrics,
        tables: { visibleInterventions: rows.length },
        selectedRecord: selected?.title,
    })

    const act = async (item: IncubateeIntervention, nextAction: Action, values: { reason?: string, rating?: number, feedback?: string }) => {
        if (!workspace) return

        try {
            if (nextAction === 'decline') await declineIncubateeIntervention(workspace, item, values.reason || '')
            if (nextAction === 'confirm') await confirmIncubateeCompletion(workspace, item, values.rating || 0, values.feedback || '')
            if (nextAction === 'reject') await rejectIncubateeCompletion(workspace, item, values.reason || '')
            message.success(t('incubatee.tracker.updated'))
            setSelected(undefined)
            setAction(undefined)
            actionForm.resetFields()
            await load()
        } catch {
            message.error(t('incubatee.tracker.updateError'))
        }
    }

    const accept = async (item: IncubateeIntervention) => {
        if (!workspace) return

        try {
            await acceptIncubateeIntervention(workspace, item)
            message.success(t('incubatee.tracker.updated'))
            await load()
        } catch {
            message.error(t('incubatee.tracker.updateError'))
        }
    }

    const openProgressView = async (item: IncubateeIntervention) => {
        setProgressItem(item)
        setProgressSelectedMonth(null)
        setProgressAppointments([])
        setProgressLoading(true)
        try {
            setProgressAppointments(await loadIncubateeInterventionAppointments(item.id))
        } catch {
            message.error(t('incubatee.tracker.progressLoadError', "This intervention's appointment history could not be loaded."))
        } finally {
            setProgressLoading(false)
        }
    }

    // Every dated fact about this intervention — when it was assigned, each
    // appointment held, and when it was confirmed complete — grouped by the
    // calendar month it happened in.
    const progressMonths = useMemo<ProgressMonthGroup[]>(() => {
        if (!progressItem) return []
        const raw = progressItem.raw as Record<string, unknown>
        const events: ProgressEvent[] = []

        const assignedAt = toDayjs(raw.assignedAt || raw.createdAt)
        if (assignedAt) events.push({ key: 'assigned', kind: 'assigned', date: assignedAt })

        progressAppointments.forEach((appointment) => {
            const date = toDayjs(appointment.startTime)
            if (!date) return
            events.push({
                key: `appt-${appointment.id}`,
                kind: 'appointment',
                date,
                status: appointment.status,
                meetingType: appointment.meetingType,
                received: appointment.status === 'completed',
            })
        })

        const completedAt = toDayjs(raw.completedAt)
        if (completedAt) events.push({ key: 'completed', kind: 'completed', date: completedAt })

        const byMonth = new Map<string, ProgressEvent[]>()
        events.forEach((event) => {
            const key = event.date.format('YYYY-MM')
            byMonth.set(key, [...(byMonth.get(key) || []), event])
        })

        return [...byMonth.entries()]
            .sort(([left], [right]) => right.localeCompare(left))
            .map(([key, monthEvents]) => {
                const sorted = [...monthEvents].sort((left, right) => {
                    if (left.kind === 'assigned') return right.kind === 'assigned' ? 0 : -1
                    if (right.kind === 'assigned') return 1
                    return left.date.valueOf() - right.date.valueOf()
                })
                return {
                    key,
                    label: sorted[0].date.format('MMMM YYYY'),
                    events: sorted,
                    appointmentCount: sorted.filter((event) => event.kind === 'appointment').length,
                    receivedCount: sorted.filter((event) => event.kind === 'appointment' && event.received).length,
                } satisfies ProgressMonthGroup
            })
    }, [progressItem, progressAppointments])

    const renderProgressView = () => {
        if (!progressItem) return null

        const selectedGroup = progressMonths.find((group) => group.key === progressSelectedMonth) || null
        const desktopGroup = selectedGroup || progressMonths[0] || null

        const summary = (
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                <Space wrap align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Typography.Text strong style={{ fontSize: 16 }}>{progressItem.title}</Typography.Text>
                    <Tag color={statusColor(progressItem.status)}>{progressItem.status}</Tag>
                </Space>
                <Typography.Text type="secondary">
                    {progressItem.areaOfSupport || t('common.unassigned')}{progressItem.assigneeName ? ` · ${progressItem.assigneeName}` : ''}
                </Typography.Text>
                <Progress percent={progressItem.progress} size="small" status={progressItem.progress >= 100 ? 'success' : 'active'} />
            </Space>
        )

        const eventKindTag = (kind: ProgressEventKind) => {
            if (kind === 'assigned') return <Tag color="purple">{t('incubatee.tracker.progressAssigned', 'Assigned')}</Tag>
            if (kind === 'completed') return <Tag color="green">{t('incubatee.tracker.progressCompleted', 'Completed')}</Tag>
            return <Tag color="blue">{t('incubatee.tracker.progressAppointment', 'Appointment')}</Tag>
        }

        const renderMonthDetail = (group: ProgressMonthGroup | null) => {
            if (progressLoading) return <Skeleton active paragraph={{ rows: 3 }} />
            if (!group) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('incubatee.tracker.progressEmptyMonth', 'No activity recorded for this month yet.')} />
            return (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    {group.events.map((event) => (
                        <div key={event.key} className="incubatee-progress-event">
                            <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                    <Typography.Text strong>{event.date.format('DD MMM YYYY')}</Typography.Text>
                                    {eventKindTag(event.kind)}
                                </Space>
                                {event.kind === 'appointment' && (
                                    <Space wrap size={6}>
                                        <Tag color={event.received ? 'green' : ['cancelled', 'declined'].includes(event.status || '') ? 'red' : 'default'}>
                                            {event.received ? t('incubatee.tracker.progressReceived', 'Received') : (event.status || '').replace(/_/g, ' ')}
                                        </Tag>
                                        {event.meetingType && <Typography.Text type="secondary">{meetingTypeLabel(event.meetingType)}</Typography.Text>}
                                    </Space>
                                )}
                            </Space>
                        </div>
                    ))}
                </Space>
            )
        }

        const renderMonthsList = (onSelect: (key: string) => void, activeKey: string | null) => {
            if (progressLoading) return <Skeleton active paragraph={{ rows: 3 }} />
            return (
                <List
                    size="small"
                    split={false}
                    dataSource={progressMonths}
                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('incubatee.tracker.progressNoActivity', 'No activity recorded yet.')} /> }}
                    renderItem={(group) => (
                        <List.Item onClick={() => onSelect(group.key)} className={`incubatee-progress-month-item${activeKey === group.key ? ' is-active' : ''}`}>
                            <Space align="center" style={{ justifyContent: 'space-between', width: '100%', flexWrap: 'nowrap' }}>
                                <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{group.label}</Typography.Text>
                                {group.appointmentCount > 0 && (
                                    <Tag color="blue">{group.receivedCount}/{group.appointmentCount} {t('incubatee.tracker.progressSessions', 'sessions')}</Tag>
                                )}
                            </Space>
                        </List.Item>
                    )}
                />
            )
        }

        if (isMobile) {
            if (selectedGroup) {
                return (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Button icon={<ArrowLeftOutlined />} onClick={() => setProgressSelectedMonth(null)}>{t('incubatee.tracker.progressBackToMonths', 'Back to months')}</Button>
                        <Typography.Text strong style={{ fontSize: 15 }}>{selectedGroup.label}</Typography.Text>
                        {renderMonthDetail(selectedGroup)}
                    </Space>
                )
            }
            return (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    <Button icon={<ArrowLeftOutlined />} onClick={() => setProgressItem(undefined)}>{t('incubatee.tracker.progressBackToInterventions', 'Back to interventions')}</Button>
                    {summary}
                    <Divider style={{ margin: '4px 0' }} />
                    {renderMonthsList((key) => setProgressSelectedMonth(key), null)}
                </Space>
            )
        }

        return (
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Button icon={<ArrowLeftOutlined />} type="text" onClick={() => setProgressItem(undefined)}>{t('incubatee.tracker.progressBackToInterventions', 'Back to interventions')}</Button>
                <Card size="small">{summary}</Card>
                <Row gutter={16} align="top">
                    <Col span={9}>
                        <Card size="small" title={t('incubatee.tracker.progressMonths', 'Months')}>
                            {renderMonthsList((key) => setProgressSelectedMonth(key), desktopGroup?.key || null)}
                        </Card>
                    </Col>
                    <Col span={15}>
                        <Card size="small" title={desktopGroup?.label || t('incubatee.tracker.progressDetails', 'Details')}>
                            {renderMonthDetail(desktopGroup)}
                        </Card>
                    </Col>
                </Row>
            </Space>
        )
    }

    const actions = (item: IncubateeIntervention) => {
        const agentId = item.agentId
        return <Space wrap>
            {!agentId && !item.id.startsWith('unassigned-') && (
                <Button icon={<EyeOutlined />} onClick={() => void openProgressView(item)}>{t('incubatee.tracker.viewProgress', 'View Progress')}</Button>
            )}
            <Button data-guide="incubatee-intervention-review" onClick={() => { setSelected(item); setAction(undefined) }}>{t('common.review')}</Button>
            {agentId && item.status === 'In Progress' && (
                <Button data-guide-agent-intervention type="primary" icon={<RobotOutlined />} onClick={() => void openAgentWorkspace(agentId, item.id)}>
                    Open {item.agentName || agentNameFor(agentId) || 'agent'}
                </Button>
            )}
            {canAcceptIncubateeIntervention(item) && (
                <>
                    <Button type="primary" onClick={() => void accept(item)}>{t('incubatee.tracker.accept')}</Button>
                    <Button danger onClick={() => { setSelected(item); setAction('decline') }}>{t('incubatee.tracker.decline')}</Button>
                </>
            )}
            {canConfirmIncubateeIntervention(item) && (
                <>
                    <Button type="primary" onClick={() => { setSelected(item); setAction('confirm') }}>{t('incubatee.tracker.confirm')}</Button>
                    <Button danger onClick={() => { setSelected(item); setAction('reject') }}>{t('incubatee.tracker.reject')}</Button>
                </>
            )}
        </Space>
    }

    const columns: TableProps<IncubateeIntervention>['columns'] = [
        { title: t('incubatee.tracker.intervention'), dataIndex: 'title' },
        { title: t('incubatee.tracker.area'), dataIndex: 'areaOfSupport', render: (value?: string) => value || t('common.unassigned') },
        { title: 'Delivery', render: (_, item) => item.agentId ? <Space direction="vertical" size={0}><Tag icon={<RobotOutlined />} color="purple">{item.agentName || agentNameFor(item.agentId) || 'Agent'}</Tag>{item.reviewRequired && <Typography.Text type="secondary">{item.reviewerType === 'consultant' ? 'Consultant review' : 'Operations review'}</Typography.Text>}</Space> : <Tag color="blue">{item.assigneeName || t('common.unassigned')}</Tag> },
        { title: t('common.status'), dataIndex: 'status', render: (value: string) => <Tag color={statusColor(value)}>{value}</Tag> },
        { title: t('common.actions'), render: (_, item) => actions(item) },
    ]

    if (workspace === undefined) return <LoadingOverlay tip={t('incubatee.tracker.loading')} />
    if (!workspace) return <DashboardPage><Empty description={t('incubatee.common.noAcceptedProgram')} /></DashboardPage>

    return <DashboardPage className="incubatee-page">
        {progressItem ? renderProgressView() : <>
        {workspace.growthPlanAvailable && !workspace.growthPlanConfirmed && (
            <Alert
                type="info"
                showIcon
                message={t('incubatee.tracker.planReady')}
                action={
                    <Button
                        type="primary"
                        onClick={async () => {
                            if (!user) return
                            try {
                                await confirmIncubateeGrowthPlan(workspace, user)
                                message.success(t('incubatee.tracker.planConfirmed'))
                                await load()
                            } catch (error) {
                                message.error(error instanceof Error && error.message === 'missing-signature' ? 'Set up your signature before acknowledging the growth plan.' : t('incubatee.tracker.updateError'))
                            }
                        }}
                    >
                        {t('incubatee.tracker.confirmPlan')}
                    </Button>
                }
            />
        )}

        <AppointmentInvitations workspace={workspace} onChanged={() => void load()} />

        <div data-guide-target="intervention-metrics">
            <MetricsGrid>
                <DashboardMetricCard icon={<FileSearchOutlined />} label={t('incubatee.tracker.required')} value={metrics.required} />
                <DashboardMetricCard icon={<LineChartOutlined />} label={t('incubatee.tracker.inProgress')} mobileTitle={t('incubatee.tracker.inProgressMobile', 'Active')} value={metrics.inProgress} />
                <DashboardMetricCard icon={<ClockCircleOutlined />} label={t('incubatee.tracker.awaiting')} mobileTitle={t('incubatee.tracker.awaitingMobile', 'Awaiting')} value={metrics.awaiting} />
                <DashboardMetricCard icon={<CheckCircleOutlined />} label={t('incubatee.tracker.completed')} value={metrics.completed} />
            </MetricsGrid>
        </div>

        <Card className="incubatee-card incubatee-tracker-switcher" style={{ marginBottom: 12 }}>
            <div className="incubatee-tracker-switcher-row">
                <Segmented
                    id="guide-intervention-view-switch"
                    data-guide-target="intervention-view-switch"
                    block
                    value={trackerView}
                    onChange={(value) => setTrackerView(value as 'interventions' | 'requests')}
                    options={[
                        { value: 'interventions', label: <Space size={6}><FileSearchOutlined />Interventions <Tag>{workspace.assignedInterventions.length}</Tag></Space> },
                        { value: 'requests', label: <Space size={6}><SendOutlined />Requests <Tag>{workspace.requests.length}</Tag></Space> },
                    ]}
                />
                <Button id="guide-request-intervention" data-guide-target="request-intervention" data-guide-request-intervention block type="primary" icon={<PlusOutlined />} onClick={() => { setRequestedArea(''); requestForm.resetFields(); setRequestOpen(true) }}>{t('incubatee.tracker.request')}</Button>
            </div>
        </Card>

        <Card data-guide-target="intervention-records" className="incubatee-card">
            {trackerView === 'interventions' ? <>
                <div id="guide-intervention-table-filters" data-guide-target="intervention-table-filters" className="incubatee-table-filter-panel">
                    <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('incubatee.tracker.search')} allowClear />
                    <Select value={status} onChange={setStatus} options={['All', 'Pending Assignment', 'Awaiting Facilitator', 'Awaiting Your Acceptance', 'In Progress', 'Awaiting Confirmation', 'Completed', 'Declined', 'Rejected'].map((value) => ({ value, label: value === 'All' ? t('incubatee.tracker.allStatuses') : value }))} />
                </div>
                <ResponsiveDataView rowKey="id" rows={rows} columns={columns} emptyText={t('incubatee.tracker.empty')} renderCard={(item) => (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Typography.Text strong>{item.title}</Typography.Text>
                        <Space wrap><Tag color={statusColor(item.status)}>{item.status}</Tag>{item.agentId && <Tag icon={<RobotOutlined />} color="purple">{item.agentName || agentNameFor(item.agentId) || 'Agent'}</Tag>}<Typography.Text type="secondary">{item.areaOfSupport || t('common.unassigned')}</Typography.Text></Space>
                        <Progress percent={item.progress} size="small" />
                        {actions(item)}
                    </Space>
                )} />
            </> : <List dataSource={workspace.requests} locale={{ emptyText: <Empty description={t('incubatee.tracker.noRequests')} /> }} renderItem={(request) => (
                <List.Item><List.Item.Meta title={request.interventionTitle} description={<Space wrap><Typography.Text type="secondary">{request.areaOfSupport}</Typography.Text><Tag>{request.status}</Tag></Space>} /></List.Item>
            )} />}
        </Card>
        </>}

        <Modal className="guide-incubatee-intervention-detail" open={!!selected && !action} onCancel={() => setSelected(undefined)} title={selected?.title} footer={null}>
            {selected && (
                <Space direction="vertical" className="incubatee-detail" style={{ width: '100%' }}>
                    <Descriptions
                        data-guide-target="intervention-detail-summary"
                        bordered
                        size="small"
                        column={1}
                        items={[
                            { key: 'area', label: t('incubatee.tracker.area'), children: selected.areaOfSupport || t('common.unassigned') },
                            { key: 'facilitator', label: selected.agentId ? 'Agent and reviewer' : t('incubatee.tracker.facilitator'), children: selected.agentId ? `${selected.agentName || agentNameFor(selected.agentId) || 'Agent'}${selected.reviewRequired ? ` · ${selected.reviewerType === 'consultant' ? 'Consultant' : 'Operations'} review` : ''}` : selected.assigneeName || t('common.unassigned') },
                            { key: 'status', label: t('common.status'), children: <Tag color={statusColor(selected.status)}>{selected.status}</Tag> },
                        ]}
                    />
                    <div data-guide-target="intervention-detail-progress"><Progress percent={selected.progress} />
                        {selected.description && <Typography.Paragraph>{selected.description}</Typography.Paragraph>}
                        {!!selected.resources?.length && <List header={t('incubatee.tracker.resources')} dataSource={selected.resources} renderItem={(resource) => <List.Item><a href={resource.link} target="_blank" rel="noreferrer">{resource.label}</a></List.Item>} />}
                        {selected.feedback && <Card size="small" title={t('incubatee.tracker.feedback')}><Rate disabled value={selected.feedback.rating} /><Typography.Paragraph>{selected.feedback.comments}</Typography.Paragraph></Card>}</div>
                </Space>
            )}
        </Modal>

        <Modal open={!!action} onCancel={() => setAction(undefined)} title={t(`incubatee.tracker.${action || 'confirm'}`)} footer={null}>
            <Form form={actionForm} layout="vertical" onFinish={(values) => selected && action && void act(selected, action, values)}>
                {action === 'confirm' ? (
                    <>
                        <Form.Item name="rating" label={t('incubatee.tracker.rating')} rules={[{ required: true }]}><Rate /></Form.Item>
                        <Form.Item name="feedback" label={t('incubatee.tracker.feedback')} rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
                    </>
                ) : (
                    <Form.Item name="reason" label={t('incubatee.tracker.reason')} rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
                )}
                <Button block type="primary" danger={action !== 'confirm'} htmlType="submit">{t('common.continue')}</Button>
            </Form>
        </Modal>

        <Modal open={requestOpen} onCancel={() => { setRequestOpen(false); setRequestedArea(''); requestForm.resetFields() }} title={t('incubatee.tracker.request')} footer={null}>
            <Form
                id="guide-request-intervention-form"
                data-guide-target="request-intervention-form"
                form={requestForm}
                layout="vertical"
                onFinish={async (values) => {
                    await requestIncubateeIntervention(workspace, values)
                    message.success(t('incubatee.tracker.requested'))
                    setRequestOpen(false)
                    setRequestedArea('')
                    requestForm.resetFields()
                    await load()
                }}
            >
                <div data-guide-target="request-intervention-area"><Form.Item name="areaOfSupport" label={t('incubatee.tracker.area')} rules={[{ required: true }]}><Select placeholder="Choose an area of support" options={areas.map((value) => ({ value, label: value }))} onChange={(value) => { setRequestedArea(value); requestForm.setFieldValue('interventionTitle', undefined) }} /></Form.Item></div>
                <div data-guide-target="request-intervention-title"><Form.Item name="interventionTitle" label={t('incubatee.tracker.intervention')} rules={[{ required: true }]}><Select placeholder={requestedArea ? 'Choose an intervention' : 'Choose an area first'} disabled={!requestedArea} options={interventionOptionsByArea.get(requestedArea) || []} /></Form.Item></div>
                <div data-guide-target="request-intervention-reason"><Form.Item name="reason" label={t('incubatee.tracker.reason')} rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item></div>
                <div data-guide-target="request-intervention-submit"><Button block type="primary" htmlType="submit">{t('incubatee.tracker.submitRequest')}</Button></div>
            </Form>
        </Modal>
    </DashboardPage>
}

export default IncubateeInterventionsPage
