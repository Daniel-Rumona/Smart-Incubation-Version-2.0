import {
    App,
    Button,
    DatePicker,
    Input,
    Modal,
    Pagination,
    Skeleton,
    Typography,
    theme,
} from 'antd'
import {
    AudioOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    FileDoneOutlined,
    LoadingOutlined,
    PlusOutlined,
    RobotOutlined,
    SendOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useAssignedInterventions } from '@/contexts/AssignedInterventionsContext'
import { useBackgroundTasks } from '@/providers/BackgroundTasksProvider'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useOpenWorkspace } from '@/contexts/WorkspaceShellContext'
import { getAdminDashboardSummary } from '@/services/adminDashboardService'
import {
    canAcceptIncubateeIntervention,
    canConfirmIncubateeIntervention,
    listIncubateeOutstandingComplianceDocuments,
    loadIncubateeWorkspace,
} from '@/services/incubateeWorkspaceService'
import {
    isCompletedInterventionStatus,
    isComplianceAttentionStatus,
    isOpenApplicationStatus,
    isOverdueIntervention,
    loadProjectAdminWorkspace,
} from '@/services/projectAdminWorkspaceService'
import { uploadIncubateeComplianceDocument } from '@/services/incubateeComplianceUploadService'
import type { AgentChatMessage, AgentPageContext } from '@/types/agent'
import type { UserRole } from '@/config/roles'
import { guideTarget, useRegisterPageGuide, type PageGuideRegistration } from '@/components/guide/PageGuideContext'
import { ConversationMode } from '@/components/agent/ConversationMode'
import '@/styles/agentic-home.css'

type Metric = {
    label: string
    value: string | number
    detail: string
    tone: 'violet' | 'amber' | 'blue'
}

type MetricDetailRow = {
    id: string
    item: string
    status: string
    detail: string
}

type Insight = {
    label: string
    value: string | number
    detail: string
    positive?: boolean
}

type AgenticOverview = {
    roleLabel: string
    headline: string
    metrics: Metric[]
    insights: Insight[]
    prompts: string[]
    workspacePath: string
}

type AgentAction = {
    label: string
    description: string
    path: string
}

type PendingComplianceUpload = {
    type: string
    file: File
    issueDate: dayjs.Dayjs | null
    expiryDate: dayjs.Dayjs | null
}

const inferComplianceDates = async (file: File) => {
    const source = `${file.name} ${file.type.startsWith('text/') ? await file.text().catch(() => '') : ''}`
    const matches = source.match(/\b(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b/g) || []
    const dates = matches.map((value) => dayjs(value)).filter((value) => value.isValid())
    return { issueDate: dates[0] || null, expiryDate: dates[1] || null }
}

const actionForPrompt = (prompt: string, role?: UserRole): AgentAction | undefined => {
    const request = prompt.toLowerCase()
    if (role === 'consultant' && /appointment|meeting|schedule/.test(request)) {
        return { label: 'Schedule an appointment', description: 'Open the appointment form with your assigned interventions already available.', path: '/consultant/appointments?create=1' }
    }
    if (role === 'incubatee' && /document|compliance|upload/.test(request)) {
        return { label: 'Upload a document', description: 'Open the compliance upload form and save the document to your workspace.', path: '/incubatee/compliance?upload=1' }
    }
    if (role === 'incubatee' && /intervention|support|work on/.test(request)) {
        return { label: 'Open interventions', description: 'Review the intervention tracker and continue with the right item.', path: '/incubatee/interventions' }
    }
    return undefined
}

const roleNames: Record<UserRole, string> = {
    systemadmin: 'System administrator',
    admin: 'Administrator',
    director: 'Director',
    projectadmin: 'Project administrator',
    projectmanager: 'Project manager',
    operations: 'Operations',
    consultant: 'Consultant',
    incubatee: 'Incubatee',
}

const roleWorkspacePaths: Record<UserRole, string> = {
    systemadmin: '/dashboard',
    admin: '/dashboard',
    director: '/director',
    projectadmin: '/projectadmin',
    projectmanager: '/operations',
    operations: '/operations',
    consultant: '/consultant',
    incubatee: '/incubatee',
}


const inWeek = (value: Date | null | undefined, weekOffset = 0) => {
    if (!value) return false
    const start = dayjs().startOf('week').add(weekOffset, 'week')
    const end = start.endOf('week')
    return dayjs(value).isAfter(start.subtract(1, 'millisecond')) && dayjs(value).isBefore(end.add(1, 'millisecond'))
}

const signedDelta = (current: number, previous: number, unit: string) => {
    const difference = current - previous
    return `${difference >= 0 ? '+' : ''}${difference} ${unit} vs last week`
}

const emptyOverview = (role?: UserRole): AgenticOverview => ({
    roleLabel: role ? roleNames[role] : 'Workspace',
    headline: 'What would you like to move forward today?',
    metrics: [
        { label: 'Needs your attention', value: 0, detail: 'Items waiting for action', tone: 'amber' },
        { label: 'Ongoing work', value: 0, detail: 'Currently in progress', tone: 'blue' },
        { label: 'Completed', value: 0, detail: 'Across your workspace', tone: 'violet' },
    ],
    insights: [
        { label: 'Completed this week', value: 0, detail: 'No change vs last week', positive: true },
        { label: 'Workspace health', value: 'Ready', detail: 'No urgent signals detected', positive: true },
        { label: 'Current scope', value: 'All', detail: 'Using your permitted workspace data', positive: true },
    ],
    prompts: ['Summarise what needs my attention', 'What should I work on next?', 'Show me this week’s progress'],
    workspacePath: role ? roleWorkspacePaths[role] : '/dashboard',
})

const makeMessage = (role: AgentChatMessage['role'], content: string): AgentChatMessage => ({
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
})

const renderInlineFormatting = (text: string): ReactNode[] =>
    text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => (
        part.startsWith('**') && part.endsWith('**')
            ? <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>
            : <span key={`${part}-${index}`}>{part}</span>
    ))

const renderAgentContent = (content: string): ReactNode[] => {
    const blocks: Array<{ type: 'paragraph' | 'heading' | 'ordered' | 'unordered'; items: string[]; start?: number }> = []
    let orderedSequence = 0

    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim()
        if (!line) continue

        const heading = line.match(/^#{1,4}\s+(.+)$/)
        const ordered = line.match(/^\d+[.)]\s+(.+)$/)
        const unordered = line.match(/^[-*]\s+(.+)$/)
        const type = heading ? 'heading' : ordered ? 'ordered' : unordered ? 'unordered' : 'paragraph'
        const value = heading?.[1] || ordered?.[1] || unordered?.[1] || line
        const previous = blocks.at(-1)

        if ((type === 'ordered' || type === 'unordered') && previous?.type === type) {
            previous.items.push(value)
        } else {
            blocks.push({ type, items: [value], start: type === 'ordered' ? orderedSequence + 1 : undefined })
        }

        if (type === 'ordered') orderedSequence += 1
    }

    return blocks.map((block, index) => {
        if (block.type === 'heading') return <h3 key={index}>{renderInlineFormatting(block.items[0])}</h3>
        if (block.type === 'ordered') return <ol key={index} start={block.start}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineFormatting(item)}</li>)}</ol>
        if (block.type === 'unordered') return <ul key={index}>{block.items.map((item, itemIndex) => <li key={itemIndex}>{renderInlineFormatting(item)}</li>)}</ul>
        return <p key={index}>{renderInlineFormatting(block.items[0])}</p>
    })
}

export const AgenticHomePage = () => {
    const { message } = App.useApp()
    const { token } = theme.useToken()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { queueTask } = useBackgroundTasks()
    const { assignments, loading: assignmentsLoading, isMine } = useAssignedInterventions()
    const openWorkspace = useOpenWorkspace()
    const [overview, setOverview] = useState<AgenticOverview>(() => emptyOverview(user?.role))
    const [loading, setLoading] = useState(true)
    const [draft, setDraft] = useState('')
    const [messages, setMessages] = useState<AgentChatMessage[]>([])
    const [voiceMode, setVoiceMode] = useState(false)
    const [selectedMetric, setSelectedMetric] = useState<Metric>()
    const [metricRows, setMetricRows] = useState<MetricDetailRow[]>([])
    const [metricLoading, setMetricLoading] = useState(false)
    const [metricPage, setMetricPage] = useState(1)
    const [messageActions, setMessageActions] = useState<Record<string, AgentAction>>({})
    const [pendingComplianceUpload, setPendingComplianceUpload] = useState<PendingComplianceUpload>()
    const [complianceUploading, setComplianceUploading] = useState(false)
    const conversationRef = useRef<HTMLDivElement>(null)
    const composerRef = useRef<HTMLDivElement>(null)
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const complianceFileInputRef = useRef<HTMLInputElement>(null)
    const requestedComplianceTypeRef = useRef('')

    useEffect(() => {
        composerRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }, [messages])

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            if (!user) {
                setOverview(emptyOverview())
                setLoading(false)
                return
            }

            setLoading(true)
            try {
                if (user.role === 'incubatee') {
                    const workspace = await loadIncubateeWorkspace(user)
                    if (cancelled || !workspace) {
                        if (!cancelled) setOverview(user.isApplicant ? {
                            roleLabel: 'Applicant',
                            headline: 'Let’s get your application moving.',
                            metrics: [
                                { label: 'Application steps', value: 'Open', detail: 'Continue your active application', tone: 'amber' },
                                { label: 'Programmes', value: 'Explore', detail: 'Find the right support programme', tone: 'blue' },
                                { label: 'Profile readiness', value: 'Review', detail: 'Keep your business details current', tone: 'violet' },
                            ],
                            insights: [
                                { label: 'Next best action', value: 'Continue', detail: 'Open your application tracker', positive: true },
                                { label: 'Workspace status', value: 'Applicant', detail: 'Incubatee tools unlock after acceptance', positive: true },
                                { label: 'Agent support', value: 'Ready', detail: 'Ask for help with any application step', positive: true },
                            ],
                            prompts: ['What should I complete next?', 'Help me strengthen my application', 'Explain the programme requirements'],
                            workspacePath: '/applicant/application-tracker',
                        } : emptyOverview(user.role))
                        return
                    }
                    const needsAction = workspace.assignedInterventions.filter((item) => canAcceptIncubateeIntervention(item) || canConfirmIncubateeIntervention(item)).length
                        + workspace.forms.filter((item) => !['completed', 'submitted'].includes(item.status.toLowerCase())).length
                    const ongoing = workspace.assignedInterventions.filter((item) => item.status === 'In Progress').length
                    const completed = workspace.assignedInterventions.filter((item) => item.status === 'Completed')
                    const unread = workspace.notifications.filter((item) => !item.read).length
                    setOverview({
                        roleLabel: user.isApplicant ? 'Applicant' : roleNames[user.role],
                        headline: user.isApplicant ? 'Let’s get your application moving.' : 'What can we move forward in your business today?',
                        metrics: [
                            { label: 'Needs your action', value: needsAction, detail: 'Confirmations, forms and decisions', tone: 'amber' },
                            { label: 'Ongoing interventions', value: ongoing, detail: 'Support currently in progress', tone: 'blue' },
                            { label: 'Pending documents', value: workspace.outstandingDocuments, detail: 'Compliance items still outstanding', tone: 'violet' },
                        ],
                        insights: [
                            { label: 'Completed interventions', value: completed.length, detail: 'Across your current programme', positive: true },
                            { label: 'Growth plan', value: workspace.growthPlanConfirmed ? 'Confirmed' : workspace.growthPlanAvailable ? 'Ready' : 'Pending', detail: workspace.programName || 'Current programme', positive: workspace.growthPlanConfirmed },
                            { label: 'Unread updates', value: unread, detail: unread ? 'New workspace notifications' : 'You are all caught up', positive: unread === 0 },
                        ],
                        prompts: ['What do I need to complete today?', 'Summarise my intervention progress', 'Help me prepare for my next milestone'],
                        workspacePath: user.isApplicant ? '/applicant/application-tracker' : '/incubatee',
                    })
                    return
                }

                if (user.role === 'consultant') {
                    const mine = assignments.filter(isMine)
                    const normalized = mine.map((item) => String(
                        item.status || (item as unknown as Record<string, unknown>).completionStatus || '',
                    ).toLowerCase())
                    const completed = normalized.filter((status) => ['completed', 'complete', 'done', 'closed', 'confirmed'].includes(status)).length
                    const ongoing = normalized.filter((status) => status.includes('progress') || status === 'active').length
                    const pending = Math.max(0, mine.length - completed - ongoing)
                    const budget = typeof user.consultingBudget === 'number'
                        ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(user.consultingBudget)
                        : 'Not set'
                    setOverview({
                        roleLabel: roleNames[user.role],
                        headline: 'Where should we focus your delivery time today?',
                        metrics: [
                            { label: 'Pending assignments', value: pending, detail: 'Waiting to be started', tone: 'amber' },
                            { label: 'Ongoing interventions', value: ongoing, detail: 'Active client delivery', tone: 'blue' },
                            { label: 'Assigned SMEs', value: new Set(mine.map((item) => item.participantId).filter(Boolean)).size, detail: 'Businesses in your portfolio', tone: 'violet' },
                        ],
                        insights: [
                            { label: 'Completed interventions', value: completed, detail: `${mine.length ? Math.round((completed / mine.length) * 100) : 0}% completion rate`, positive: true },
                            { label: 'Consulting budget', value: budget, detail: 'Current account allocation', positive: true },
                            { label: 'Delivery load', value: ongoing + pending, detail: 'Open assignments requiring capacity', positive: ongoing + pending < 10 },
                        ],
                        prompts: ['Prioritise my intervention queue', 'Which SMEs need attention?', 'Draft a plan for my active assignments'],
                        workspacePath: '/consultant',
                    })
                    return
                }

                if (['systemadmin', 'admin'].includes(user.role)) {
                    const currentStart = dayjs().startOf('week').toDate()
                    const currentEnd = dayjs().endOf('week').toDate()
                    const previousStart = dayjs().subtract(1, 'week').startOf('week').toDate()
                    const previousEnd = dayjs().subtract(1, 'week').endOf('week').toDate()
                    const summary = await getAdminDashboardSummary(user, [currentStart, currentEnd], [previousStart, previousEnd])
                    if (cancelled) return
                    setOverview({
                        roleLabel: roleNames[user.role],
                        headline: 'What should we improve across the platform today?',
                        metrics: [
                            { label: 'Delivery errors', value: summary.errors, detail: 'Failed operations this week', tone: 'amber' },
                            { label: 'Active users', value: summary.activeUsers, detail: 'Accounts currently enabled', tone: 'blue' },
                            { label: 'Companies', value: summary.companies, detail: 'Organisations on the platform', tone: 'violet' },
                        ],
                        insights: [
                            { label: 'Applications this week', value: summary.applications, detail: signedDelta(summary.applications, summary.previous.applications, 'applications'), positive: summary.applications >= summary.previous.applications },
                            { label: 'User growth', value: summary.users, detail: signedDelta(summary.users, summary.previous.users, 'users'), positive: summary.users >= summary.previous.users },
                            { label: 'System health', value: summary.errors ? 'Attention' : 'Healthy', detail: summary.errors ? `${summary.errors} failures need review` : 'No delivery failures this week', positive: summary.errors === 0 },
                        ],
                        prompts: ['Summarise platform risks', 'Which errors need immediate attention?', 'Show me adoption changes this week'],
                        workspacePath: '/dashboard',
                    })
                    return
                }

                const workspace = await loadProjectAdminWorkspace(user, activeProgramId)
                if (cancelled) return
                const openApplications = workspace.applications.filter((item) => isOpenApplicationStatus(item.status)).length
                const completed = workspace.interventions.filter((item) => isCompletedInterventionStatus(item.status))
                const ongoing = workspace.interventions.length - completed.length
                const complianceAttention = workspace.complianceDocuments.filter((item) => isComplianceAttentionStatus(item.status)).length
                const overdue = workspace.interventions.filter((item) => isOverdueIntervention(item)).length
                const completedThisWeek = completed.filter((item) => inWeek(item.completedAt)).length
                const completedLastWeek = completed.filter((item) => inWeek(item.completedAt, -1)).length
                const completionRate = workspace.interventions.length ? Math.round((completed.length / workspace.interventions.length) * 100) : 0
                const isExecutive = user.role === 'director'
                setOverview({
                    roleLabel: roleNames[user.role],
                    headline: isExecutive ? 'What decision can I help you make today?' : 'What should the programme team move forward today?',
                    metrics: [
                        { label: isExecutive ? 'Items at risk' : 'Pending decisions', value: isExecutive ? overdue + complianceAttention : openApplications + complianceAttention, detail: isExecutive ? 'Overdue and compliance signals' : 'Applications and compliance reviews', tone: 'amber' },
                        { label: 'Ongoing interventions', value: ongoing, detail: 'Active delivery across the programme', tone: 'blue' },
                        { label: 'Active SMEs', value: workspace.participants.length, detail: 'Businesses in the current scope', tone: 'violet' },
                    ],
                    insights: [
                        { label: 'Completed this week', value: completedThisWeek, detail: signedDelta(completedThisWeek, completedLastWeek, 'interventions'), positive: completedThisWeek >= completedLastWeek },
                        { label: 'Completion rate', value: `${completionRate}%`, detail: `${completed.length} of ${workspace.interventions.length} interventions completed`, positive: completionRate >= 60 },
                        { label: 'Portfolio risk', value: overdue, detail: overdue ? 'Overdue interventions need attention' : 'No overdue interventions', positive: overdue === 0 },
                    ],
                    prompts: isExecutive
                        ? ['Give me an executive programme brief', 'Where are our biggest delivery risks?', 'Compare this week’s intervention progress']
                        : ['Build my priority list for today', 'Which interventions are falling behind?', 'Summarise programme delivery this week'],
                    workspacePath: roleWorkspacePaths[user.role],
                })
            } catch {
                if (!cancelled) {
                    setOverview(emptyOverview(user.role))
                    message.error('The agentic overview could not load all workspace metrics.')
                }
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()
        return () => { cancelled = true }
    }, [activeProgramId, assignments, isMine, message, user])

    const pageContext = useMemo<AgentPageContext>(() => ({
        pageKey: 'agentic-home',
        pageName: 'Agentic overview',
        purpose: `Role-aware command centre for ${overview.roleLabel}.`,
        currentFilters: { activeProgramId },
        metrics: Object.fromEntries([...overview.metrics, ...overview.insights].map((item) => [item.label, item.value])),
        dataSummary: {
            role: user?.role,
            roleLabel: overview.roleLabel,
            selectedMetric: selectedMetric ? {
                label: selectedMetric.label,
                value: selectedMetric.value,
                detail: selectedMetric.detail,
                visibleRows: metricRows.slice(0, 50),
            } : undefined,
        },
        updatedAt: new Date().toISOString(),
    }), [activeProgramId, metricRows, overview, selectedMetric, user?.role])

    const send = (content = draft) => {
        const nextContent = content.trim()
        if (!nextContent) return
        const userMessage = makeMessage('user', nextContent)
        const pendingMessage = makeMessage('agent', 'Working on this in the background…')
        const action = actionForPrompt(nextContent, user?.role)
        const history = messages
        setMessages((current) => [...current, userMessage, pendingMessage])
        setDraft('')
        queueTask({
            title: selectedMetric ? `${selectedMetric.label}: ${nextContent}` : undefined,
            prompt: nextContent,
            page: pageContext,
            history,
            onCompleted: (result) => {
                setMessages((current) => current.map((item) => item.id === pendingMessage.id
                    ? { ...item, content: result }
                    : item))
                if (action) setMessageActions((current) => ({ ...current, [pendingMessage.id]: action }))
            },
            onFailed: (error) => setMessages((current) => current.map((item) => item.id === pendingMessage.id
                ? { ...item, content: error }
                : item)),
        })
    }

    const loadMetricDetails = async (metric: Metric) => {
        if (!user || metricLoading) return
        setSelectedMetric(metric)
        setMetricRows([])
        setMetricPage(1)
        setMetricLoading(true)

        const label = metric.label.toLowerCase()
        const assignmentRow = (item: typeof assignments[number]): MetricDetailRow => {
            const raw = item as unknown as Record<string, unknown>
            return {
                id: item.id,
                item: String(item.interventionTitle || raw.title || 'Intervention'),
                status: String(item.status || raw.completionStatus || 'Pending'),
                detail: String(raw.participantName || raw.businessName || item.participantId || 'Assigned workspace item'),
            }
        }

        try {
            if (user.role === 'incubatee') {
                const workspace = await loadIncubateeWorkspace(user)
                if (!workspace) {
                    setMetricRows([])
                    return
                }

                if (label.includes('action')) {
                    const interventions = workspace.assignedInterventions
                        .filter((item) => canAcceptIncubateeIntervention(item) || canConfirmIncubateeIntervention(item))
                        .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: item.areaOfSupport || 'Intervention' }))
                    const forms = workspace.forms
                        .filter((item) => !['completed', 'submitted'].includes(item.status.toLowerCase()))
                        .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: item.kind === 'survey' ? 'Survey' : 'Assessment' }))
                    setMetricRows([...interventions, ...forms])
                } else if (label.includes('ongoing')) {
                    setMetricRows(workspace.assignedInterventions
                        .filter((item) => item.status === 'In Progress')
                        .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: item.areaOfSupport || item.assigneeName || 'Intervention' })))
                } else {
                    const documents = await listIncubateeOutstandingComplianceDocuments(user)
                    setMetricRows(documents.map((document) => ({
                        id: document.id,
                        item: document.title,
                        status: document.status,
                        detail: document.fileName
                            ? `Uploaded file: ${document.fileName}${document.expiryDate ? ` · Expires ${document.expiryDate}` : ''}. Review or replace it.`
                            : 'Not yet uploaded',
                    })))
                }
                return
            }

            if (user.role === 'consultant') {
                const mine = assignments.filter(isMine)
                const rows = mine.map(assignmentRow)
                if (label.includes('pending')) setMetricRows(rows.filter((row) => !['completed', 'complete', 'done', 'closed', 'confirmed', 'in-progress', 'in progress', 'active'].includes(row.status.toLowerCase())))
                else if (label.includes('ongoing')) setMetricRows(rows.filter((row) => ['in-progress', 'in progress', 'active'].includes(row.status.toLowerCase())))
                else if (label.includes('sme')) {
                    const uniqueSmes = new Map(rows.map((row) => [row.detail, row]))
                    setMetricRows([...uniqueSmes.values()].map((row) => ({ ...row, item: row.detail, detail: 'Assigned SME' })))
                } else setMetricRows(rows)
                return
            }

            if (['systemadmin', 'admin'].includes(user.role)) {
                const summary = await getAdminDashboardSummary(user)
                if (label.includes('error')) {
                    setMetricRows(summary.recentErrors.map((item) => ({ id: item.id, item: item.source, status: 'Failed', detail: item.message })))
                } else {
                    setMetricRows([{ id: label, item: metric.label, status: String(metric.value), detail: metric.detail }])
                }
                return
            }

            const workspace = await loadProjectAdminWorkspace(user, activeProgramId)
            if (label.includes('ongoing')) {
                setMetricRows(workspace.interventions
                    .filter((item) => !isCompletedInterventionStatus(item.status))
                    .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: `${item.participantName} · ${item.owner}` })))
            } else if (label.includes('sme')) {
                setMetricRows(workspace.participants.map((item) => ({ id: item.id, item: item.businessName, status: item.status, detail: item.programName })))
            } else {
                const applicationRows = workspace.applications
                    .filter((item) => isOpenApplicationStatus(item.status))
                    .map((item) => ({ id: item.id, item: item.businessName, status: item.status, detail: item.programName }))
                const riskRows = workspace.interventions
                    .filter((item) => isOverdueIntervention(item))
                    .map((item) => ({ id: item.id, item: item.title, status: 'Overdue', detail: item.participantName }))
                const complianceRows = workspace.complianceDocuments
                    .filter((item) => isComplianceAttentionStatus(item.status))
                    .map((item) => ({ id: item.id, item: 'Compliance document', status: item.status, detail: item.participantId }))
                setMetricRows(label.includes('risk') ? [...riskRows, ...complianceRows] : [...applicationRows, ...complianceRows])
            }
        } catch {
            setMetricRows([])
            message.error(`Could not load ${metric.label.toLowerCase()} details.`)
        } finally {
            setMetricLoading(false)
        }
    }

    const saveComplianceUpload = async (upload: PendingComplianceUpload) => {
        if (!user) return
        try {
            setComplianceUploading(true)
            await uploadIncubateeComplianceDocument(user, {
                type: upload.type,
                file: upload.file,
                issueDate: upload.issueDate?.format('YYYY-MM-DD'),
                expiryDate: upload.expiryDate?.format('YYYY-MM-DD'),
            })
            message.success(`${upload.type} uploaded for compliance review.`)
            setPendingComplianceUpload(undefined)
            if (selectedMetric) void loadMetricDetails(selectedMetric)
        } catch {
            message.error('The document could not be uploaded. Please try again.')
        } finally {
            setComplianceUploading(false)
        }
    }

    const chooseComplianceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        const type = requestedComplianceTypeRef.current
        event.target.value = ''
        if (!file || !type) return
        const upload = { type, file, ...await inferComplianceDates(file) }
        if (upload.issueDate && upload.expiryDate) {
            void saveComplianceUpload(upload)
            return
        }
        setPendingComplianceUpload(upload)
    }

    const firstName = String(user?.displayName || user?.name || '').trim().split(/\s+/)[0]
    const visibleMetrics = overview.metrics
        .filter((metric) => typeof metric.value === 'number' && metric.value > 0)
        .slice(0, 4)
    const activeMode = messages.length > 0
    const selectedMetricAction = selectedMetric && user?.role === 'incubatee'
        ? selectedMetric.label.toLowerCase().includes('document')
            ? { label: 'Upload document', path: '/incubatee/compliance?upload=1' }
            : selectedMetric.label.toLowerCase().includes('ongoing')
                ? { label: 'Work on interventions', path: '/incubatee/interventions' }
                : undefined
        : undefined
    const isDocumentMetric = Boolean(selectedMetric?.label.toLowerCase().includes('document'))
    const metricPageSize = selectedMetric?.label.toLowerCase().includes('document') ? 5 : selectedMetric?.label.toLowerCase().includes('intervention') || selectedMetric?.label.toLowerCase().includes('ongoing') ? 3 : 5
    const visibleMetricRows = metricRows.slice((metricPage - 1) * metricPageSize, metricPage * metricPageSize)
    const conversationTurns = messages.reduce<Array<{ id: string; prompt?: AgentChatMessage; response?: AgentChatMessage }>>((turns, item) => {
        if (item.role === 'user') {
            turns.push({ id: item.id, prompt: item })
        } else if (turns.length && !turns.at(-1)?.response) {
            turns[turns.length - 1].response = item
        } else {
            turns.push({ id: item.id, response: item })
        }
        return turns
    }, [])

    const guideRegistration = useMemo<PageGuideRegistration>(() => ({
        pageId: 'agentic-home',
        pageTitle: 'Agentic workspace',
        guides: [
            {
                id: 'agentic-quick-tour', title: 'Quick tour', description: 'Learn where to start, what needs attention and how agentic work changes after your first message.', kind: 'page', order: 1,
                steps: [
                    { element: guideTarget('agentic-command'), popover: { title: 'Your agentic workspace', description: 'Start here with a question or an action. The agent uses your role and current workspace scope to respond.', side: 'bottom' } },
                    { element: guideTarget('agentic-priority-metrics'), skipMissingElement: true, popover: { title: 'Priority signals', description: 'Only items that need attention are shown. Select one to inspect the live records behind its count.', side: 'bottom' } },
                    { element: guideTarget('agentic-composer'), popover: { title: 'Ask or direct the agent', description: 'Use this one-line composer for a question, a summary, or a task. Once you start, it stays docked below the conversation.', side: 'top' } },
                    { element: guideTarget('agentic-suggestions'), skipMissingElement: true, popover: { title: 'Suggested starting points', description: 'These role-aware prompts are shortcuts. Select one to start a focused conversation immediately.', side: 'top' } },
                    { element: guideTarget('agentic-insights'), skipMissingElement: true, popover: { title: 'Role insights', description: 'This landing-only snapshot highlights progress, health and the scope currently used by the agent.', side: 'top' } },
                ],
            },
            ...(visibleMetrics.length ? [{
                id: 'agentic-priority-detail', title: 'Explore priority details', description: 'Open a live metric and review the exact records behind it.', kind: 'task' as const, order: 2,
                steps: [
                    { element: guideTarget('agentic-priority-metrics'), advanceOnClick: true, popover: { title: 'Choose a priority signal', description: 'Select the signal you want to investigate. The guide follows your choice and waits for its live detail view.', side: 'bottom' as const, showButtons: ['close'] as Array<'close'> } },
                    { element: '.agentic-metric-modal .ant-modal-content', waitForElement: 5000, popover: { title: 'Live workspace records', description: 'This view loads the exact records behind the signal you chose, including each item, status and context. Use the footer action to continue the work in the right workspace.', side: 'left' as const } },
                    { element: guideTarget('agentic-metric-footer'), waitForElement: 5000, skipMissingElement: true, popover: { title: 'Continue from the result', description: 'Use the relevant next action here, or page through the records when there are more than fit comfortably in this view.', side: 'top' as const } },
                ],
            }] : []),
            {
                id: 'agentic-start-conversation', title: 'Start a conversation', description: 'Use a suggested prompt or write a focused question for your workspace.', kind: 'task', order: 3,
                steps: [
                    { element: guideTarget('agentic-composer'), popover: { title: 'Write a focused request', description: 'Ask for a priority list, progress update, risk review or help with a particular item.', side: 'top' } },
                    { element: guideTarget('agentic-suggestions'), skipMissingElement: true, popover: { title: 'Use a suggested prompt', description: 'Choose one of these to send a ready-made role-specific request and begin the conversation.', side: 'top' } },
                ],
            },
        ],
    }), [visibleMetrics.length])

    useRegisterPageGuide(guideRegistration)

    return (
        <main className={`agentic-home ${activeMode ? 'is-conversing' : ''} ${!loading && visibleMetrics.length === 0 ? 'has-no-metrics' : ''}`}>
            {(loading || visibleMetrics.length > 0) && <section data-guide-target="agentic-priority-metrics" className="agentic-summary" aria-label="Priority metrics">
                <div className="agentic-metric-grid">
                    {loading || (user?.role === 'consultant' && assignmentsLoading)
                        ? Array.from({ length: 3 }).map((_, index) => (
                            <div
                                className="agentic-metric-card agentic-metric-card-skeleton"
                                key={index}
                            >
                                <Skeleton.Avatar
                                    active
                                    shape="circle"
                                    size={38}
                                />

                                <div className="agentic-metric-skeleton-copy">
                                    <Skeleton.Input
                                        active
                                        size="small"
                                        className="agentic-metric-skeleton-label"
                                    />

                                    <Skeleton.Input
                                        active
                                        size="small"
                                        className="agentic-metric-skeleton-value"
                                    />
                                </div>
                            </div>
                        ))
                        : visibleMetrics.map((metric) => (
                            <button
                                type="button"
                                data-guide="agentic-metric"
                                data-guide-modal-trigger
                                className={`agentic-metric-card is-${metric.tone} ${selectedMetric?.label === metric.label ? 'is-selected' : ''}`}
                                key={metric.label}
                                onClick={() => void loadMetricDetails(metric)}
                                aria-label={`View ${metric.label} details`}
                            >
                                <div className="agentic-metric-icon">{metric.tone === 'amber' ? <ClockCircleOutlined /> : metric.tone === 'blue' ? <FileDoneOutlined /> : <ThunderboltOutlined />}</div>
                                <div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>
                            </button>
                        ))}
                </div>
            </section>}

            <section data-guide-target="agentic-command" className={`agentic-command ${activeMode ? 'has-conversation' : ''}`}>
                {!activeMode && (
                    <>
                        <Typography.Title level={1}>{firstName ? `${firstName}, ${overview.headline.charAt(0).toLowerCase()}${overview.headline.slice(1)}` : overview.headline}</Typography.Title>
                        <Typography.Paragraph>Ask across your permitted workspace data, or start with a suggested action.</Typography.Paragraph>
                    </>
                )}

                {messages.length > 0 && (
                    <div className="agentic-conversation" aria-live="polite" ref={conversationRef}>
                        {messages.map((item) => (
                            <div
                                className={`agentic-chat-message is-${item.role} ${item.content === 'Working on this in the background…' ? 'is-pending' : ''}`}
                                key={item.id}
                                ref={(node) => { messageRefs.current[item.id] = node }}
                            >
                                {item.role === 'agent' && <span><RobotOutlined /></span>}
                                {item.role === 'agent'
                                    ? <div className="agentic-message-content">
                                        {item.content === 'Working on this in the background…'
                                            ? <span className="agentic-pending-copy"><LoadingOutlined spin />{item.content}</span>
                                            : renderAgentContent(item.content)}
                                    </div>
                                    : <p>{item.content}</p>}
                                {item.role === 'agent' && messageActions[item.id] && <div className="agentic-message-action">
                                    <Typography.Text type="secondary">{messageActions[item.id].description}</Typography.Text>
                                    <Button type="primary" onClick={() => openWorkspace(messageActions[item.id].path)}>{messageActions[item.id].label}</Button>
                                </div>}
                            </div>
                        ))}
                    </div>
                )}

                {messages.length > 0 && (
                    <aside className="agentic-chat-activity-rail" aria-label="Conversation message navigator">
                        {conversationTurns.slice(-10).map((turn, index) => {
                            const targetId = turn.response?.id || turn.prompt?.id || turn.id
                            const preview = [turn.prompt?.content, turn.response?.content].filter(Boolean).join('\n\n')
                            return (
                                <button
                                    type="button"
                                    className="agentic-chat-activity-bar is-turn"
                                    key={turn.id}
                                    style={{ '--chat-bar-width': `${12 + Math.min(18, Math.round(preview.length / 110))}px` } as CSSProperties}
                                    onClick={() => messageRefs.current[targetId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                                    aria-label={`Jump to conversation turn ${index + 1}`}
                                >
                                    <span />
                                    <div>
                                        <strong>Conversation turn {conversationTurns.length - Math.min(10, conversationTurns.length) + index + 1}</strong>
                                        <p>{preview}</p>
                                    </div>
                                </button>
                            )
                        })}
                    </aside>
                )}

                <div data-guide-target="agentic-composer" className="agentic-composer" ref={composerRef}>
                    <Button
                        type="text"
                        shape="circle"
                        className="agentic-composer-mic-button"
                        icon={<AudioOutlined />}
                        onClick={() => setVoiceMode(true)}
                        aria-label="Start voice conversation"
                    />
                    <Input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onPressEnter={() => void send()}
                        placeholder={selectedMetric ? `Ask a follow-up about ${selectedMetric.label.toLowerCase()}…` : 'Ask about priorities, progress, risks or next steps…'}
                    />
                    <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => void send()} disabled={!draft.trim()} aria-label="Send message" />
                </div>

                {!activeMode && (
                    <div data-guide-target="agentic-suggestions" className="agentic-suggestions">
                        {overview.prompts.map((prompt) => <Button key={prompt} onClick={() => void send(prompt)}>{prompt}</Button>)}
                    </div>
                )}
            </section>

            {!activeMode && (
                <section data-guide-target="agentic-insights" className="agentic-insights" aria-label="Role insights">
                    <div className="agentic-insight-grid">
                        {overview.insights.map((insight) => (
                            <article className="agentic-insight-card" key={insight.label}>
                                <div className={insight.positive ? 'is-positive' : 'is-attention'}>{insight.positive ? <CheckCircleOutlined /> : <WarningOutlined />}</div>
                                <span>{insight.label}</span>
                                <strong>{insight.value}</strong>
                                <small>{insight.detail}</small>
                            </article>
                        ))}
                    </div>
                </section>
            )}

            <Modal
                open={Boolean(selectedMetric)}
                onCancel={() => {
                    if (!metricLoading) setSelectedMetric(undefined)
                }}
                footer={null}
                centered
                width={760}
                destroyOnHidden
                title={null}
                className="agentic-metric-modal"
                styles={{
                    body: {
                        padding: 0,
                    },
                }}
            >
                <div className="agentic-metric-modal-shell" aria-live="polite">
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            justifyContent: 'space-between',
                            gap: 16,
                            padding: '20px 22px 16px',
                            borderBottom: `1px solid ${token.colorBorderSecondary}`,
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <Typography.Title level={3} style={{ margin: 0 }}>
                                {selectedMetric?.label}
                            </Typography.Title>

                            {selectedMetric && (
                                <Typography.Text type="secondary">
                                    {selectedMetric.detail}
                                </Typography.Text>
                            )}
                        </div>

                        {selectedMetric && (
                            <div
                                style={{
                                    minWidth: 54,
                                    height: 54,
                                    padding: '0 14px',
                                    borderRadius: 18,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 22,
                                    fontWeight: 800,
                                    color: token.colorPrimary,
                                    background: token.colorPrimaryBg,
                                    border: `1px solid ${token.colorPrimaryBorder}`,
                                }}
                            >
                                {selectedMetric.value}
                            </div>
                        )}
                    </div>

                    <div
                        style={{
                            padding: 18,
                            maxHeight: metricLoading ? undefined : 'min(52vh, 460px)',
                            overflowY: metricLoading ? 'hidden' : 'auto',
                        }}
                    >
                        {metricLoading ? (
                            <div style={{ display: 'grid', gap: 10 }}>
                                {Array.from({ length: 3 }).map((_, index) => (
                                    <div
                                        key={index}
                                        style={{
                                            padding: 14,
                                            borderRadius: 16,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                        }}
                                    >
                                        <Skeleton active paragraph={{ rows: 1 }} title={{ width: '45%' }} />
                                    </div>
                                ))}
                            </div>
                        ) : metricRows.length ? (
                            <div style={{ display: 'grid', gap: 10 }}>
                                {visibleMetricRows.map((row) => (
                                    <div
                                        key={row.id}
                                        style={{
                                            display: 'grid',
                                            gridTemplateColumns: isDocumentMetric ? 'minmax(0, 1fr) auto auto' : 'minmax(0, 1fr) auto',
                                            gap: 12,
                                            alignItems: 'start',
                                            padding: '14px 16px',
                                            borderRadius: 16,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            background: token.colorFillQuaternary,
                                        }}
                                    >
                                        <div style={{ minWidth: 0 }}>
                                            <Typography.Text
                                                strong
                                                style={{
                                                    display: 'block',
                                                    marginBottom: 3,
                                                }}
                                            >
                                                {row.item}
                                            </Typography.Text>

                                            <Typography.Text type="secondary">
                                                {row.detail}
                                            </Typography.Text>
                                        </div>

                                        <span
                                            style={{
                                                maxWidth: 180,
                                                padding: '5px 10px',
                                                borderRadius: 999,
                                                border: `1px solid ${token.colorPrimaryBorder}`,
                                                background: token.colorPrimaryBg,
                                                color: token.colorPrimary,
                                                fontSize: 12,
                                                fontWeight: 700,
                                                lineHeight: 1.3,
                                                textAlign: 'center',
                                            }}
                                        >
                                            {row.status}
                                        </span>
                                        {isDocumentMetric && <Button
                                            type="text"
                                            shape="circle"
                                            icon={<PlusOutlined />}
                                            aria-label={`Upload ${row.item}`}
                                            onClick={() => {
                                                requestedComplianceTypeRef.current = row.item
                                                complianceFileInputRef.current?.click()
                                            }}
                                        />}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div
                                style={{
                                    minHeight: 180,
                                    display: 'grid',
                                    placeItems: 'center',
                                    textAlign: 'center',
                                    padding: 24,
                                }}
                            >
                                <div>
                                    <CheckCircleOutlined
                                        style={{
                                            fontSize: 28,
                                            color: token.colorPrimary,
                                            marginBottom: 10,
                                        }}
                                    />
                                    <Typography.Title level={5} style={{ margin: 0 }}>
                                        Nothing to show
                                    </Typography.Title>
                                    <Typography.Text type="secondary">
                                        No matching workspace items were found for this metric.
                                    </Typography.Text>
                                </div>
                            </div>
                        )}
                    </div>
                    {!metricLoading && (selectedMetricAction || metricRows.length > metricPageSize) && <footer data-guide-target="agentic-metric-footer" className="agentic-metric-modal-footer">
                        {metricRows.length > metricPageSize && <Pagination
                            current={metricPage}
                            pageSize={metricPageSize}
                            total={metricRows.length}
                            size="small"
                            showSizeChanger={false}
                            onChange={setMetricPage}
                        />}
                        {selectedMetricAction && <Button type="primary" block onClick={() => openWorkspace(selectedMetricAction.path)}>{isDocumentMetric ? 'Manage compliance' : selectedMetricAction.label}</Button>}
                    </footer>}
                </div>
            </Modal>

            <input ref={complianceFileInputRef} type="file" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={(event) => void chooseComplianceFile(event)} />
            <Modal
                open={Boolean(pendingComplianceUpload)}
                title="Confirm document dates"
                okText="Save document"
                confirmLoading={complianceUploading}
                onCancel={() => !complianceUploading && setPendingComplianceUpload(undefined)}
                onOk={() => pendingComplianceUpload && void saveComplianceUpload(pendingComplianceUpload)}
            >
                <Typography.Paragraph>
                    We could not confidently read both dates from <strong>{pendingComplianceUpload?.file.name}</strong>. Confirm the values before saving it for review.
                </Typography.Paragraph>
                <DatePicker
                    value={pendingComplianceUpload?.issueDate || null}
                    onChange={(issueDate) => setPendingComplianceUpload((current) => current ? { ...current, issueDate } : current)}
                    placeholder="Issue date"
                    style={{ width: '100%', marginBottom: 12 }}
                />
                <DatePicker
                    value={pendingComplianceUpload?.expiryDate || null}
                    onChange={(expiryDate) => setPendingComplianceUpload((current) => current ? { ...current, expiryDate } : current)}
                    placeholder="Expiry date"
                    style={{ width: '100%' }}
                />
            </Modal>

            {voiceMode && (
                <ConversationMode
                    messages={messages}
                    isTyping={Boolean(messages.at(-1)?.role === 'agent' && messages.at(-1)?.content === 'Working on this in the background…')}
                    onSend={(content) => send(content)}
                    onClose={() => setVoiceMode(false)}
                />
            )}
        </main>
    )
}

export default AgenticHomePage
