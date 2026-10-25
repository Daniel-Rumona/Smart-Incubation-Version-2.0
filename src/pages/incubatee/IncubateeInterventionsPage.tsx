import { App, Button, Card, Col, Descriptions, Divider, Empty, Form, Grid, Input, List, Progress, Rate, Row, Segmented, Select, Skeleton, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckCircleFilled, CheckCircleOutlined, ClockCircleOutlined, DownOutlined, ExclamationCircleFilled, EyeOutlined, FileDoneOutlined, LineChartOutlined, PlusOutlined, RobotOutlined, SearchOutlined, SendOutlined, UpOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import SignDocumentModal from '@/components/shared/SignDocumentModal'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { AppointmentInvitations } from '@/components/incubatee/AppointmentInvitations'
import { SmeCheckbacks } from '@/components/incubatee/SmeCheckbacks'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tEnglish } from '@/providers/LanguageProvider'
import { guideTarget, useRegisterPageGuide, type PageGuideRegistration } from '@/components/guide/PageGuideContext'
import { meetingTypeLabel, toDayjs } from '@/components/interventions/appointmentSchedule'
import {
    canConfirmIncubateeIntervention,
    confirmIncubateeCompletion,
    confirmIncubateeGrowthPlan,
    requestInterventionChange,
    loadIncubateeInterventionAppointments,
    loadIncubateeWorkspace,
    rejectIncubateeCompletion,
    requestIncubateeIntervention,
} from '@/services/incubateeWorkspaceService'
import type { IncubateeIntervention, IncubateeInterventionAppointment, IncubateeWorkspace } from '@/types/incubatee'
import { openChangeRequest, type InterventionChangeKind } from '@/utils/interventionStart'
import { getAgentWorkspaceUrl } from '@/services/agentOrchestrationService'
import { listAgents } from '@/services/agentRegistryService'
import type { AgentDefinition } from '@/types/agentOrchestration'
import type { Dayjs } from 'dayjs'
import type { DriveStep, Driver } from 'driver.js'
import '@/styles/incubatee.css'
import '@/styles/incubatee-interventions.css'

type Action = 'change' | 'confirm' | 'reject'

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
    if (status === 'Not Started') return 'gold'
    if (status === 'Awaiting Facilitator') return 'cyan'
    return 'orange'
}

type GroupKey = 'action' | 'active' | 'waiting' | 'done'

/** Above this many interventions a search box earns its place; below it the groups are enough. */
const SEARCH_THRESHOLD = 8

const groupOf = (item: IncubateeIntervention): GroupKey => {
    if (canConfirmIncubateeIntervention(item)) return 'action'
    if (item.status === 'In Progress') return 'active'
    if (item.status === 'Completed' || item.status === 'Declined' || item.status === 'Rejected') return 'done'
    return 'waiting'
}

/** An agent-delivered intervention can be opened once it is assigned: opening it is what starts the work. */
const canOpenAgent = (item: IncubateeIntervention) => !!item.agentId && (item.status === 'In Progress' || item.status === 'Not Started')

const GROUPS: { key: GroupKey, label: string, icon: ReactNode }[] = [
    { key: 'action', label: 'Needs your action', icon: <ExclamationCircleFilled /> },
    { key: 'active', label: 'In progress', icon: <LineChartOutlined /> },
    { key: 'waiting', label: 'Not started yet', icon: <ClockCircleOutlined /> },
    { key: 'done', label: 'Completed', icon: <CheckCircleOutlined /> },
]

export const IncubateeInterventionsPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const [requestForm] = Form.useForm<{ areaOfSupport: string, interventionTitle: string, reason: string }>()
    const [actionForm] = Form.useForm<{ reason?: string, rating?: number, feedback?: string, kind?: InterventionChangeKind }>()
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [search, setSearch] = useState('')
    const [showDone, setShowDone] = useState(false)
    const [requestOpen, setRequestOpen] = useState(false)
    const [signingPlan, setSigningPlan] = useState(false)
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
        else message.error(t('This agent workspace is not currently available.'))
    }

    const load = async () => {
        if (!user) return
        try {
            setWorkspace(await loadIncubateeWorkspace(user))
        } catch (error) {
            console.error('Could not load the incubatee workspace.', error)
            message.error(t('incubatee.common.loadError'))
            setWorkspace(null)
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const showSearch = (workspace?.assignedInterventions.length || 0) > SEARCH_THRESHOLD
    const rows = useMemo(() => workspace?.assignedInterventions.filter((item) => {
        const needle = search.trim().toLowerCase()
        return !needle || `${item.title} ${item.areaOfSupport || ''} ${item.assigneeName || ''}`.toLowerCase().includes(needle)
    }) || [], [search, workspace])

    const grouped = useMemo(() => {
        const groups: Record<GroupKey, IncubateeIntervention[]> = { action: [], active: [], waiting: [], done: [] }
        rows.forEach((item) => groups[groupOf(item)].push(item))
        return groups
    }, [rows])

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

    const metrics = useMemo(() => {
        const assigned = workspace?.assignedInterventions || []
        const count = (group: GroupKey) => assigned.filter((item) => groupOf(item) === group).length
        return {
            required: workspace?.requiredInterventions.length || 0,
            needsYou: count('action'),
            inProgress: count('active'),
            notStarted: count('waiting'),
            completed: assigned.filter((item) => item.status === 'Completed').length,
        }
    }, [workspace])

    const guideRegistration = useMemo<PageGuideRegistration>(() => ({
        pageId: 'incubatee-interventions',
        pageTitle: 'Interventions Tracker',
        guides: [
            {
                id: 'interventions-overview', title: t('Quick tour'), description: t('Understand the views, counts and filters on this tracker.'), kind: 'page', order: 1,
                steps: [
                    { element: guideTarget('intervention-metrics'), popover: { title: t('Your current workload'), description: t('Your growth plan progress, then what needs you, what is under way, what has not started and what is complete.'), side: 'bottom' } },
                    { element: guideTarget('intervention-next-step'), popover: { title: t('Next step'), description: t('The most urgent thing for you to do, with the button to do it.'), side: 'bottom' } },
                    { element: guideTarget('intervention-records'), popover: { title: t('Your intervention records'), description: t('Interventions are grouped by what they need. Each row shows the support area, who delivers it and the action available to you.'), side: 'top' } },
                    ...(workspace?.requests.length ? [{ element: guideTarget('intervention-requests'), popover: { title: t('Your requests'), description: t('Support you asked for, and where each request stands.'), side: 'top' as const } }] : []),
                ],
            },
            {
                id: 'interventions-review-work', title: t('Review my work'), description: t('Open an intervention and understand the details shown there.'), kind: 'task', order: 2,
                steps: [
                    { element: '[data-guide="incubatee-intervention-review"]', waitForElement: 1200, popover: { title: t('Review an intervention'), description: t('Use Open to inspect this intervention without leaving the guide.'), side: 'left', nextBtnText: 'Open', onNextClick: openGuideTargetThenContinue('[data-guide="incubatee-intervention-review"]') } },
                    { element: guideTarget('intervention-detail-summary'), waitForElement: 5000, popover: { title: t('Intervention details'), description: t('Confirm the support area, delivery owner and status before deciding what to do next.'), side: 'left' } },
                    { element: guideTarget('intervention-detail-progress'), waitForElement: 5000, popover: { title: t('Progress and supporting material'), description: t('Track completion here, then use any linked resources or feedback to continue the work.'), side: 'left' } },
                ],
            },
            {
                id: 'interventions-request', title: t('Request intervention'), description: t('Request the right support by area, intervention and reason.'), kind: 'task', order: 3,
                steps: [
                    { element: guideTarget('request-intervention'), popover: { title: t('Request support'), description: t('Choose Open to start a new intervention request.'), side: 'bottom', nextBtnText: 'Open', onNextClick: openGuideTargetThenContinue(guideTarget('request-intervention')) } },
                    { element: guideTarget('request-intervention-form'), waitForElement: 5000, popover: { title: t('Choose support'), description: t('This form keeps the request focused: area first, then its available interventions.'), side: 'left' } },
                    { element: guideTarget('request-intervention-area'), waitForElement: 5000, popover: { title: t('1. Choose an area'), description: t('Select the support area that best matches what you need.'), side: 'left' } },
                    { element: guideTarget('request-intervention-title'), waitForElement: 5000, popover: { title: t('2. Select an intervention'), description: t('Only interventions available for the selected area are shown here.'), side: 'left' } },
                    { element: guideTarget('request-intervention-reason'), waitForElement: 5000, popover: { title: t('3. Explain the request'), description: t('Add the context that helps the team assess and route your request.'), side: 'left' } },
                    { element: guideTarget('request-intervention-submit'), waitForElement: 5000, popover: { title: t('Submit when ready'), description: t('Review the area, intervention and reason, then submit the request.'), side: 'top' } },
                ],
            },
            ...(rows.some(canOpenAgent) ? [{
                id: 'interventions-agent-work', title: t('Continue with an agent'), description: t('Open the agent-led workspace for the selected intervention.'), kind: 'task' as const, order: 4,
                steps: [{ element: '[data-guide-agent-intervention]', waitForElement: 1200, popover: { title: t('Open the agent workspace'), description: t('Use this for agent-led interventions. The agent workspace has its own focused guide menu.'), side: 'left' as const } }],
            }] : []),
        ],
    }), [rows, t, workspace?.requests.length])

    useRegisterPageGuide(guideRegistration)

    useRegisterAgentPageContext({
        pageKey: 'incubatee-intervention-tracker',
        pageName: tEnglish('incubatee.tracker.title'),
        purpose: tEnglish('incubatee.tracker.subtitle'),
        filters: { search },
        metrics,
        tables: { visibleInterventions: rows.length },
        selectedRecord: selected?.title,
    })

    const act = async (item: IncubateeIntervention, nextAction: Action, values: { reason?: string, rating?: number, feedback?: string, kind?: InterventionChangeKind }) => {
        if (!workspace || !user) return

        try {
            if (nextAction === 'change') await requestInterventionChange(item, user.uid, values.kind || 'change', values.reason || '')
            if (nextAction === 'confirm') await confirmIncubateeCompletion(workspace, item, values.rating || 0, values.feedback || '')
            if (nextAction === 'reject') await rejectIncubateeCompletion(workspace, item, values.reason || '')
            message.success(t('incubatee.tracker.updated'))
            setSelected(undefined)
            setAction(undefined)
            actionForm.resetFields()
            await load()
        } catch (error) {
            const reason = error instanceof Error && error.message.includes('has not been uploaded yet') ? error.message : ''
            message.error(reason || t('incubatee.tracker.updateError'))
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

    const deliveredBy = (item: IncubateeIntervention) => (item.agentId
        ? item.agentName || agentNameFor(item.agentId) || t('Agent')
        : item.assigneeName || '')

    const openReview = (item: IncubateeIntervention) => { setSelected(item); setAction(undefined) }
    const startAction = (item: IncubateeIntervention, nextAction: Action) => { setSelected(item); setAction(nextAction) }

    // Signing happens in SignDocumentModal, which writes the signature out while this saves.
    const confirmPlan = async () => {
        if (!user || !workspace) throw new Error('not-ready')
        await confirmIncubateeGrowthPlan(workspace, user)
    }
    const planSignError = (error: unknown) => (error instanceof Error && error.message === 'missing-signature'
        ? t('Set up your signature before acknowledging the growth plan.')
        : t('incubatee.tracker.updateError'))

    /** The one button a row offers; everything else lives behind Details. */
    const rowAction = (item: IncubateeIntervention) => {
        const agentId = item.agentId
        if (canConfirmIncubateeIntervention(item)) return <Button onClick={() => startAction(item, 'confirm')}>{t('incubatee.tracker.confirm')}</Button>
        if (agentId && canOpenAgent(item)) {
            return (
                <Button data-guide-agent-intervention icon={<RobotOutlined />} onClick={() => void openAgentWorkspace(agentId, item.id)}>
                    {t('Open agent')}
                </Button>
            )
        }
        return null
    }

    if (workspace === undefined) return <PageSkeleton variant="dashboard" label={t('incubatee.tracker.loading')} />
    if (!workspace) return <DashboardPage><Empty description={t('incubatee.common.noAcceptedProgram')} /></DashboardPage>

    const planTotal = metrics.required || workspace.assignedInterventions.length
    const planScore = planTotal ? Math.round((metrics.completed / planTotal) * 100) : 0
    const planPending = workspace.growthPlanAvailable && !workspace.growthPlanConfirmed
    // GROUPS order is the priority order: confirming finished work comes before accepting new work.
    const nextItem = grouped.action.find(canConfirmIncubateeIntervention)
        || grouped.action[0]
        || grouped.active.find((item) => item.agentId)

    const jumpTo = (group: GroupKey) => {
        if (group === 'done') setShowDone(true)
        window.setTimeout(() => window.document.getElementById(`intervention-group-${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
    }

    const tiles: { key: string, group: GroupKey, label: string, value: number, icon: ReactNode }[] = [
        { key: 'needs', group: 'action', label: t('Needs you'), value: metrics.needsYou, icon: <ExclamationCircleFilled /> },
        { key: 'active', group: 'active', label: t('incubatee.tracker.inProgress'), value: metrics.inProgress, icon: <LineChartOutlined /> },
        { key: 'waiting', group: 'waiting', label: t('Not started'), value: metrics.notStarted, icon: <ClockCircleOutlined /> },
        { key: 'done', group: 'done', label: t('incubatee.tracker.completed'), value: metrics.completed, icon: <CheckCircleOutlined /> },
    ]

    const nextStep = () => {
        if (planPending) {
            return {
                key: 'plan', tone: 'plan', icon: <FileDoneOutlined />, title: t('Acknowledge your growth plan'), text: t('incubatee.tracker.planReady'),
                buttons: <Button type="primary" size="large" onClick={() => setSigningPlan(true)}>{t('incubatee.tracker.confirmPlan')}</Button>,
            }
        }
        if (!nextItem) return null
        const who = deliveredBy(nextItem)
        if (canConfirmIncubateeIntervention(nextItem)) {
            return {
                key: nextItem.id, tone: 'confirm', icon: <CheckCircleOutlined />, title: t('Confirm "{title}" is complete', undefined, { title: nextItem.title }),
                text: who ? t('{name} marked this as done. Rate the support to close it off.', undefined, { name: who }) : t('This was marked as done. Rate the support to close it off.'),
                buttons: <>
                    <Button type="primary" size="large" onClick={() => startAction(nextItem, 'confirm')}>{t('incubatee.tracker.confirm')}</Button>
                    <Button size="large" onClick={() => startAction(nextItem, 'reject')}>{t('Not done')}</Button>
                </>,
            }
        }
        const agentId = nextItem.agentId as string
        return {
            key: nextItem.id, tone: 'agent', icon: <RobotOutlined />, title: t('Continue "{title}"', undefined, { title: nextItem.title }),
            text: t('Pick up where you left off with {name}.', undefined, { name: who }),
            buttons: <Button type="primary" size="large" icon={<RobotOutlined />} onClick={() => void openAgentWorkspace(agentId, nextItem.id)}>{t('Open agent')}</Button>,
        }
    }
    const step = nextStep()

    // Rows show one button; the rest of an intervention's actions sit in the Details footer.
    const detailActions: ReactNode[] = []
    if (selected) {
        const item = selected
        if (!item.agentId && !item.id.startsWith('unassigned-')) {
            detailActions.push(<Button key="progress" icon={<EyeOutlined />} onClick={() => { setSelected(undefined); void openProgressView(item) }}>{t('incubatee.tracker.viewProgress', 'View Progress')}</Button>)
        }
        if (item.agentId && canOpenAgent(item)) {
            const agentId = item.agentId
            detailActions.push(<Button key="agent" icon={<RobotOutlined />} onClick={() => void openAgentWorkspace(agentId, item.id)}>{t('Open agent')}</Button>)
        }
        // Not a decline: a request to the programme team, who decide whether to change or drop it.
        if (['Not Started', 'In Progress'].includes(item.status) && !item.id.startsWith('unassigned-') && !openChangeRequest(item.raw as Record<string, unknown>)) {
            detailActions.push(<Button key="change" onClick={() => { actionForm.setFieldsValue({ kind: 'change', reason: '' }); setAction('change') }}>{t('Ask for a change')}</Button>)
        }
        if (canConfirmIncubateeIntervention(item)) {
            detailActions.push(
                <Button key="reject" danger onClick={() => setAction('reject')}>{t('incubatee.tracker.reject')}</Button>,
                <Button key="confirm" type="primary" onClick={() => setAction('confirm')}>{t('incubatee.tracker.confirm')}</Button>,
            )
        }
    }

    return <DashboardPage className="incubatee-page incubatee-interventions-page">
        {progressItem ? renderProgressView() : <>
        <AppointmentInvitations workspace={workspace} onChanged={() => void load()} />

        <section data-guide-target="intervention-metrics" className="interventions-summary">
            {/* The shared metric card has no ring, so the plan score borrows its card styles. */}
            <Card className="dashboard-metric-card interventions-score-card" bordered>
                <div className="dashboard-metric-row">
                    <Progress
                        type="circle"
                        percent={planScore}
                        size={44}
                        strokeWidth={10}
                        strokeColor="#6d5dfb"
                        format={(percent) => <span className="interventions-score-value">{percent}%</span>}
                    />
                    <div className="dashboard-metric-copy">
                        <Typography.Text strong>{t('Growth plan')}</Typography.Text>
                        <Typography.Text type="secondary" className="dashboard-metric-label">
                            {t('{done} of {total} completed', undefined, { done: metrics.completed, total: planTotal })}
                        </Typography.Text>
                    </div>
                </div>
            </Card>

            {tiles.map((tile) => (
                <DashboardMetricCard
                    key={tile.key}
                    icon={tile.icon}
                    label={tile.label}
                    value={tile.value}
                    onClick={tile.value > 0 ? () => jumpTo(tile.group) : undefined}
                />
            ))}
        </section>

        <div data-guide-target="intervention-next-step">
            {step ? (
                <section className={`interventions-next is-${step.tone}`}>
                    <span className="interventions-next-eyebrow"><ArrowRightOutlined /> {t('Next step')}</span>
                    <div className="interventions-next-body">
                        <span className="interventions-next-icon" aria-hidden="true">{step.icon}</span>
                        <div className="interventions-next-text">
                            <Typography.Text strong className="interventions-next-title">{step.title}</Typography.Text>
                            <Typography.Text type="secondary">{step.text}</Typography.Text>
                        </div>
                        <div className="interventions-next-actions">{step.buttons}</div>
                    </div>
                </section>
            ) : (
                <section className="interventions-next is-done">
                    <div className="interventions-next-body">
                        <span className="interventions-next-icon" aria-hidden="true"><CheckCircleFilled /></span>
                        <div className="interventions-next-text">
                            <Typography.Text strong className="interventions-next-title">{t('Nothing needs your attention right now.')}</Typography.Text>
                            {metrics.inProgress + metrics.notStarted > 0 && (
                                <Typography.Text type="secondary">{t('Your facilitators will let you know when something needs you.')}</Typography.Text>
                            )}
                        </div>
                    </div>
                </section>
            )}
        </div>

        {workspace && <SmeCheckbacks interventions={workspace.assignedInterventions} onAnswered={() => void load()} />}

        <div className={`interventions-toolbar${showSearch ? ' has-search' : ''}`}>
            {showSearch ? (
                <Input
                    className="interventions-search"
                    prefix={<SearchOutlined />}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={t('incubatee.tracker.search')}
                    allowClear
                />
            ) : <span />}
            <Button id="guide-request-intervention" data-guide-target="request-intervention" data-guide-request-intervention icon={<PlusOutlined />} onClick={() => { setRequestedArea(''); requestForm.resetFields(); setRequestOpen(true) }}>
                {t('Request support')}
            </Button>
        </div>

        <div data-guide-target="intervention-records" className="interventions-groups">
            {rows.length === 0 && (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? t('No interventions match your search.') : t('incubatee.tracker.empty')} />
            )}
            {GROUPS.filter((group) => grouped[group.key].length > 0).map((group) => {
                const collapsed = group.key === 'done' && !showDone && !search
                return (
                    <section key={group.key} id={`intervention-group-${group.key}`} className={`interventions-group is-${group.key}`}>
                        <h3 className="interventions-group-head">
                            <span aria-hidden="true">{group.icon}</span> {t(group.label)}
                            {group.key === 'done' && !search && (
                                <Button type="link" size="small" className="interventions-group-toggle" onClick={() => setShowDone((value) => !value)} icon={showDone ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                                    {showDone ? t('Hide') : t('Show {count}', undefined, { count: grouped.done.length })}
                                </Button>
                            )}
                        </h3>
                        {!collapsed && (
                            <ul className="interventions-list">
                                {grouped[group.key].map((item) => {
                                    const who = deliveredBy(item)
                                    return (
                                        <li key={item.id} className={`interventions-row is-${group.key}${item.agentId ? ' is-agent' : ''}`}>
                                            <span className="interventions-row-icon" aria-hidden="true">
                                                {item.agentId ? <RobotOutlined /> : group.icon}
                                            </span>
                                            <div className="interventions-row-main">
                                                <Typography.Text strong>{item.title}</Typography.Text>
                                                <Typography.Text type="secondary" className="interventions-row-meta">
                                                    {[item.areaOfSupport || t('common.unassigned'), who, t(item.status)].filter(Boolean).join(' · ')}
                                                </Typography.Text>
                                                {group.key === 'active' && (
                                                    <Progress className="interventions-row-progress" percent={item.progress} size="small" strokeColor="#6d5dfb" />
                                                )}
                                            </div>
                                            <div className="interventions-row-actions">
                                                {rowAction(item)}
                                                <Button data-guide="incubatee-intervention-review" type="text" onClick={() => openReview(item)}>{t('Details')}</Button>
                                            </div>
                                        </li>
                                    )
                                })}
                            </ul>
                        )}
                    </section>
                )
            })}
        </div>

        {workspace.requests.length > 0 && (
            <section data-guide-target="intervention-requests" className="interventions-group is-requests">
                <h3 className="interventions-group-head"><SendOutlined aria-hidden="true" /> {t('Your requests')}</h3>
                <ul className="interventions-list">
                    {workspace.requests.map((request) => (
                        <li key={request.id} className="interventions-row is-request">
                            <div className="interventions-row-main">
                                <Typography.Text strong>{request.interventionTitle}</Typography.Text>
                                <Typography.Text type="secondary" className="interventions-row-meta">{request.areaOfSupport}</Typography.Text>
                            </div>
                            <Tag>{t(request.status)}</Tag>
                        </li>
                    ))}
                </ul>
            </section>
        )}
        </>}

        <ResponsiveModal className="guide-incubatee-intervention-detail" open={!!selected && !action} onClose={() => setSelected(undefined)} title={selected?.title} destroyOnHidden={false} footer={detailActions.length ? detailActions : null}>
            {selected && (
                <Space direction="vertical" className="incubatee-detail" style={{ width: '100%' }}>
                    <Descriptions
                        data-guide-target="intervention-detail-summary"
                        bordered
                        size="small"
                        column={1}
                        items={[
                            { key: 'area', label: t('incubatee.tracker.area'), children: selected.areaOfSupport || t('common.unassigned') },
                            { key: 'facilitator', label: selected.agentId ? t('Agent and reviewer') : t('incubatee.tracker.facilitator'), children: selected.agentId ? `${selected.agentName || agentNameFor(selected.agentId) || 'Agent'}${selected.reviewRequired ? ` · ${selected.reviewerType === 'consultant' ? 'Consultant' : 'Operations'} review` : ''}` : selected.assigneeName || t('common.unassigned') },
                            { key: 'status', label: t('common.status'), children: <Space wrap size={4}><Tag color={statusColor(selected.status)}>{t(selected.status)}</Tag>{openChangeRequest(selected.raw as Record<string, unknown>) && <Tag color="orange">{t('Change requested')}</Tag>}</Space> },
                        ]}
                    />
                    <div data-guide-target="intervention-detail-progress"><Progress percent={selected.progress} />
                        {selected.description && <Typography.Paragraph>{selected.description}</Typography.Paragraph>}
                        {!!selected.resources?.length && <List header={t('incubatee.tracker.resources')} dataSource={selected.resources} renderItem={(resource) => <List.Item><a href={resource.link} target="_blank" rel="noreferrer">{resource.label}</a></List.Item>} />}
                        {selected.feedback && <Card size="small" title={t('incubatee.tracker.feedback')}><Rate disabled value={selected.feedback.rating} /><Typography.Paragraph>{selected.feedback.comments}</Typography.Paragraph></Card>}</div>
                </Space>
            )}
        </ResponsiveModal>

        <ResponsiveModal open={!!action} onClose={() => setAction(undefined)} title={action === 'change' ? t('Ask for a change') : t(`incubatee.tracker.${action || 'confirm'}`)} destroyOnHidden={false}>
            <Form form={actionForm} layout="vertical" onFinish={(values) => selected && action && void act(selected, action, values)}>
                {action === 'confirm' ? (
                    <>
                        <Form.Item name="rating" label={t('incubatee.tracker.rating')} rules={[{ required: true }]}><Rate /></Form.Item>
                        <Form.Item name="feedback" label={t('incubatee.tracker.feedback')} rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
                    </>
                ) : action === 'change' ? (
                    <>
                        <Typography.Paragraph type="secondary">{t('Your programme team will look at this and get back to you. The intervention carries on as planned until they decide.')}</Typography.Paragraph>
                        <Form.Item name="kind" label={t('What would you like?')} initialValue="change" rules={[{ required: true }]}>
                            <Segmented block options={[{ value: 'change', label: t('Change it') }, { value: 'drop', label: t('I no longer need it') }]} />
                        </Form.Item>
                        <Form.Item name="reason" label={t('Tell us why')} rules={[{ required: true, message: t('Please tell the programme team why.') }]}><Input.TextArea rows={4} maxLength={500} /></Form.Item>
                    </>
                ) : (
                    <Form.Item name="reason" label={t('incubatee.tracker.reason')} rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item>
                )}
                <Button block type="primary" danger={action === 'reject'} htmlType="submit">{action === 'change' ? t('Send request') : t('common.continue')}</Button>
            </Form>
        </ResponsiveModal>

        <ResponsiveModal open={requestOpen} destroyOnHidden={false} onClose={() => { setRequestOpen(false); setRequestedArea(''); requestForm.resetFields() }} title={t('incubatee.tracker.request')}>
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
                <div data-guide-target="request-intervention-area"><Form.Item name="areaOfSupport" label={t('incubatee.tracker.area')} rules={[{ required: true }]}><Select placeholder={t('Choose an area of support')} options={areas.map((value) => ({ value, label: value }))} onChange={(value) => { setRequestedArea(value); requestForm.setFieldValue('interventionTitle', undefined) }} /></Form.Item></div>
                <div data-guide-target="request-intervention-title"><Form.Item name="interventionTitle" label={t('incubatee.tracker.intervention')} rules={[{ required: true }]}><Select placeholder={requestedArea ? t('Choose an intervention') : t('Choose an area first')} disabled={!requestedArea} options={interventionOptionsByArea.get(requestedArea) || []} /></Form.Item></div>
                <div data-guide-target="request-intervention-reason"><Form.Item name="reason" label={t('incubatee.tracker.reason')} rules={[{ required: true }]}><Input.TextArea rows={4} /></Form.Item></div>
                <div data-guide-target="request-intervention-submit"><Button block type="primary" htmlType="submit">{t('incubatee.tracker.submitRequest')}</Button></div>
            </Form>
        </ResponsiveModal>

        <SignDocumentModal
            open={signingPlan}
            onClose={() => setSigningPlan(false)}
            title={t('Sign your growth plan')}
            description={t('This applies your saved signature and accepts the interventions on the plan.')}
            signLabel={t('Sign and confirm')}
            onSign={confirmPlan}
            onSigned={() => void load()}
            signedText={t('incubatee.tracker.planConfirmed')}
            errorText={planSignError}
        />
    </DashboardPage>
}

export default IncubateeInterventionsPage
