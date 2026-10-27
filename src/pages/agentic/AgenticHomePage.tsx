import {
    App,
    Button,
    DatePicker,
    Input,
    Modal,
    Tag,
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
    RightOutlined,
    RobotOutlined,
    SendOutlined,
    ThunderboltOutlined,
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
import { listMyApplications } from '@/services/applicantService'
import { loadFunderData, type FunderData } from '@/services/funderService'
import type { AgentChatMessage, AgentPageContext, AgentProposalStatus } from '@/types/agent'
import { AgentProposalCard } from '@/components/agent/AgentProposalCard'
import { AgentGuidedAction, type GuidedActionKind } from '@/components/agent/AgentGuidedAction'
import { hasRolePermission } from '@/config/permissions'
import type { UserRole } from '@/config/roles'
import { guideTarget, useRegisterPageGuide, type PageGuideRegistration } from '@/components/guide/PageGuideContext'
import { ConversationMode } from '@/components/agent/ConversationMode'
import { TypingGreeting } from '@/components/agent/TypingGreeting'
import { summariseConsultantWork } from '@/pages/consultant/consultantWorkSummary'
import '@/styles/agentic-home.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import { singleActionFooter } from '@/components/shared/modalFooter'

/**
 * What a metric counts. Drill-downs, actions and the agent's context are keyed on this, never on the
 * (translated) label, so they behave the same in every language.
 */
type MetricKey =
    | 'attention' | 'ongoing' | 'completed'
    | 'action' | 'documents' | 'applications'
    | 'pending' | 'smes'
    | 'accept' | 'due' | 'overdue'
    | 'errors' | 'users' | 'companies'
    | 'risk' | 'decisions'

type Metric = {
    key: MetricKey
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
    /** Stable English name for the agent's context (labels are translated for display). */
    key: string
    label: string
    value: string | number
    detail: string
    positive?: boolean
}

type AgenticOverview = {
    roleLabel: string
    /** Phrases the greeting types in turn after "Ready to work on". */
    focus: string[]
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

/** English names for each metric, for the agent's context and task titles (never the translated label). */
const METRIC_NAMES: Record<MetricKey, string> = {
    attention: 'Needs your attention',
    ongoing: 'Ongoing interventions',
    completed: 'Completed',
    action: 'Needs your action',
    documents: 'Pending documents',
    applications: 'Open applications',
    pending: 'Pending assignments',
    accept: 'To accept',
    due: 'Due this week',
    overdue: 'Overdue on your side',
    smes: 'Active SMEs',
    errors: 'Delivery errors',
    users: 'Active users',
    companies: 'Companies',
    risk: 'Items at risk',
    decisions: 'Pending decisions',
}

// Same limits as the compliance page.
const COMPLIANCE_FILE_TYPES = '.pdf,.png,.jpg,.jpeg,.webp'
const COMPLIANCE_MAX_MB = 10

/**
 * Suggests dates from the file name, only when written unambiguously as YYYY-MM-DD (a name like
 * "03-04-2025" could be March or April, so it is ignored). The SME always confirms before saving.
 */
const inferComplianceDates = async (file: File) => {
    const matches = file.name.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []
    const dates = matches.map((value) => dayjs(value, 'YYYY-MM-DD')).filter((value) => value.isValid())
    return { issueDate: dates[0] || null, expiryDate: dates[1] || null }
}

const actionForPrompt = (prompt: string, role?: UserRole): AgentAction | undefined => {
    const request = prompt.toLowerCase()
    if (role === 'consultant' && /appointment|meeting|schedule/.test(request)) {
        return { label: tr('Schedule an appointment'), description: tr('Open the appointment form with your assigned interventions already available.'), path: '/shared/interventions/appointments?create=1' }
    }
    if (role === 'incubatee' && /document|compliance|upload/.test(request)) {
        return { label: tr('Upload a document'), description: tr('Open the compliance upload form and save the document to your workspace.'), path: '/incubatee/compliance?upload=1' }
    }
    if (role === 'incubatee' && /intervention|support|work on/.test(request)) {
        return { label: tr('Open interventions'), description: tr('Review the intervention tracker and continue with the right item.'), path: '/incubatee/interventions' }
    }
    return undefined
}

const COORDINATOR_ROLES: UserRole[] = ['operations', 'projectadmin', 'projectmanager']

/** Short requests like "schedule an appointment" open the guided form; a detailed sentence goes straight to the agent. */
const guidedActionForPrompt = (prompt: string): GuidedActionKind | undefined => {
    const request = prompt.toLowerCase().trim()
    if (request.split(/\s+/).length > 8) return undefined
    if (/appointment|meeting|schedule/.test(request)) return 'appointment'
    if (/\b(assign|allocate)\b/.test(request)) return 'assignment'
    return undefined
}

const roleNames: Record<UserRole, string> = {
    get systemadmin() { return tr('System administrator') },
    get admin() { return tr('Administrator') },
    get director() { return tr('Director') },
    get projectadmin() { return tr('Project administrator') },
    get projectmanager() { return tr('Project manager') },
    get operations() { return tr('Operations') },
    get consultant() { return tr('Consultant') },
    get incubatee() { return tr('Incubatee') },
    get funder() { return tr('Funder') },
}

const roleWorkspacePaths: Record<UserRole, string> = {
    systemadmin: '/dashboard',
    admin: '/reception',
    director: '/director',
    projectadmin: '/projectadmin',
    projectmanager: '/operations',
    operations: '/operations',
    consultant: '/consultant',
    incubatee: '/incubatee',
    funder: '/funder',
}


const inWeek = (value: Date | null | undefined, weekOffset = 0) => {
    if (!value) return false
    const start = dayjs().startOf('week').add(weekOffset, 'week')
    const end = start.endOf('week')
    return dayjs(value).isAfter(start.subtract(1, 'millisecond')) && dayjs(value).isBefore(end.add(1, 'millisecond'))
}

/** This week and last week, as the admin summary expects them (shared by the card and its drill-down so they agree). */
const thisAndLastWeek = (): [[Date, Date], [Date, Date]] => [
    [dayjs().startOf('week').toDate(), dayjs().endOf('week').toDate()],
    [dayjs().subtract(1, 'week').startOf('week').toDate(), dayjs().subtract(1, 'week').endOf('week').toDate()],
]

/** A funded SME is behind with two or more overdue interventions (the funder pages' rule). */
const isFunderSmeBehind = (sme: FunderData['portfolio'][number]) => sme.execution.overdue >= 2

/** Required interventions completed, across these SMEs. */
const funderDelivery = (smes: FunderData['portfolio']) => {
    const required = smes.reduce((sum, row) => sum + row.execution.required, 0)
    const completed = smes.reduce((sum, row) => sum + Math.min(row.execution.completed, row.execution.required), 0)
    return { required, completed, rate: required ? Math.round((completed / required) * 100) : null }
}

/** Revenue growth and net jobs since joining: each SME's first reported figure against its latest. */
const funderGrowth = (smes: FunderData['portfolio']) => {
    const withRevenue = smes.filter((row) => row.growth?.revenue)
    const start = withRevenue.reduce((sum, row) => sum + (row.growth?.revenue?.start || 0), 0)
    const latest = withRevenue.reduce((sum, row) => sum + (row.growth?.revenue?.latest || 0), 0)
    return {
        revenueGrowth: start > 0 ? Math.round(((latest - start) / start) * 100) : null,
        netJobs: smes.reduce((sum, row) => sum + ((row.growth?.jobs?.latest || 0) - (row.growth?.jobs?.start || 0)), 0),
    }
}

/** "+2 vs last week", in the user's language. `unit` is already translated by the caller. */
const signedDelta = (current: number, previous: number, unit: string) => {
    const difference = current - previous
    return tr('{change} {unit} vs last week', undefined, { change: `${difference >= 0 ? '+' : ''}${difference}`, unit })
}

const emptyOverview = (role?: UserRole): AgenticOverview => ({
    roleLabel: role ? roleNames[role] : tr('Workspace'),
    focus: [tr('your priorities'), tr('your next steps')],
    metrics: [
        { key: 'attention', label: tr('Needs your attention'), value: 0, detail: tr('Items waiting for action'), tone: 'amber' },
        { key: 'ongoing', label: tr('Ongoing work'), value: 0, detail: tr('Currently in progress'), tone: 'blue' },
        { key: 'completed', label: tr('Completed'), value: 0, detail: tr('Across your workspace'), tone: 'violet' },
    ],
    insights: [
        { key: 'Completed this week', label: tr('Completed this week'), value: 0, detail: tr('No change vs last week'), positive: true },
        { key: 'Workspace health', label: tr('Workspace health'), value: tr('Ready'), detail: tr('No urgent signals detected'), positive: true },
        { key: 'Current scope', label: tr('Current scope'), value: tr('All'), detail: tr('Using your permitted workspace data'), positive: true },
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
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { token } = theme.useToken()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { queueTask } = useBackgroundTasks()
    const { assignments, loading: assignmentsLoading, isMine } = useAssignedInterventions()
    const openWorkspace = useOpenWorkspace()
    const [overview, setOverview] = useState<AgenticOverview>(() => emptyOverview(user?.role))
    const workspaceRef = useRef<Awaited<ReturnType<typeof loadProjectAdminWorkspace>> | undefined>(undefined)
    const funderRef = useRef<FunderData | undefined>(undefined)
    const [focusedItem, setFocusedItem] = useState<{ metric: MetricKey; row: MetricDetailRow; facts: Record<string, unknown> }>()
    const [scopeFacts, setScopeFacts] = useState<Record<string, unknown> | undefined>()
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

    // Only facilitators' cards are built from the shared assignments list; for everyone else its live
    // updates must not re-run (and re-skeleton) the whole overview.
    const consultantAssignments = user?.role === 'consultant' ? assignments : null
    const consultantIsMine = user?.role === 'consultant' ? isMine : null
    const overviewLoaded = useRef(false)

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            if (!user) {
                setOverview(emptyOverview())
                setLoading(false)
                return
            }

            // Skeletons only on the first load; later refreshes update the numbers in place.
            if (!overviewLoaded.current) setLoading(true)
            try {
                if (user.role === 'incubatee') {
                    const workspace = user.isApplicant ? null : await loadIncubateeWorkspace(user)
                    if (cancelled) return
                    if (!workspace) {
                        if (!user.isApplicant) {
                            setOverview(emptyOverview(user.role))
                            return
                        }
                        // Applicants: independent SMEs use the marketplace and programmes; programme applicants follow their application.
                        const applications = await listMyApplications(user.uid).catch(() => [])
                        if (cancelled) return
                        const open = applications.filter((item) => isOpenApplicationStatus(String(item.applicationStatus || 'pending'))).length
                        const independent = user.smeJourney === 'independent'
                        setOverview({
                            roleLabel: independent ? t('SME') : t('Applicant'),
                            focus: independent
                                ? [t('your business profile'), t('finding a programme'), t('your next step')]
                                : [t('your application'), t('your documents'), t('your next step')],
                            metrics: [
                                { key: 'applications', label: t('Open applications'), value: open, detail: t('Applications waiting for a decision'), tone: 'amber' },
                            ],
                            insights: independent
                                ? [
                                    { key: 'Consultant marketplace', label: t('Consultant marketplace'), value: t('Open'), detail: t('Request support from consultants'), positive: true },
                                    { key: 'Programmes', label: t('Programmes'), value: applications.length ? t('{count} applied', undefined, { count: applications.length }) : t('Find one'), detail: t('Programmes open to SMEs like yours'), positive: true },
                                    { key: 'Agent support', label: t('Agent support'), value: t('Ready'), detail: t('Ask for help with any business task'), positive: true },
                                ]
                                : [
                                    { key: 'Applications', label: t('Applications'), value: applications.length, detail: open ? t('Waiting for a decision') : t('No open applications'), positive: true },
                                    { key: 'Workspace status', label: t('Workspace status'), value: t('Applicant'), detail: t('Incubatee tools unlock after acceptance'), positive: true },
                                    { key: 'Agent support', label: t('Agent support'), value: t('Ready'), detail: t('Ask for help with any application step'), positive: true },
                                ],
                            prompts: independent
                                ? ['Help me find the right consultant', 'Which programme suits my business?', 'Help me plan my next growth step']
                                : ['What should I complete next?', 'Help me strengthen my application', 'Explain the programme requirements'],
                            workspacePath: independent ? '/applicant/marketplace' : '/applicant/application-tracker',
                        })
                        return
                    }
                    const needsAction = workspace.assignedInterventions.filter(canConfirmIncubateeIntervention).length
                        + workspace.forms.filter((item) => !['completed', 'submitted'].includes(item.status.toLowerCase())).length
                    const ongoing = workspace.assignedInterventions.filter((item) => item.status === 'In Progress').length
                    const completed = workspace.assignedInterventions.filter((item) => item.status === 'Completed')
                    const unread = workspace.notifications.filter((item) => !item.read).length
                    setOverview({
                        roleLabel: roleNames[user.role],
                        focus: [t('your compliance documents'), t('your interventions'), t('your next milestone'), t('your growth plan')],
                        metrics: [
                            { key: 'action', label: t('Needs your action'), value: needsAction, detail: t('Confirmations, forms and decisions'), tone: 'amber' },
                            { key: 'ongoing', label: t('Ongoing interventions'), value: ongoing, detail: t('Support currently in progress'), tone: 'blue' },
                            { key: 'documents', label: t('Pending documents'), value: workspace.outstandingDocuments, detail: t('Compliance items still outstanding'), tone: 'violet' },
                        ],
                        insights: [
                            { key: 'Completed interventions', label: t('Completed interventions'), value: completed.length, detail: t('Across your current programme'), positive: true },
                            { key: 'Growth plan', label: t('Growth plan'), value: workspace.growthPlanConfirmed ? t('Confirmed') : workspace.growthPlanAvailable ? t('Ready') : t('Pending'), detail: workspace.programName || t('Current programme'), positive: workspace.growthPlanConfirmed },
                            { key: 'Unread updates', label: t('Unread updates'), value: unread, detail: unread ? t('New workspace notifications') : t('You are all caught up'), positive: unread === 0 },
                        ],
                        prompts: ['What do I need to complete today?', 'Summarise my intervention progress', 'Help me prepare for my next milestone'],
                        workspacePath: '/incubatee',
                    })
                    return
                }

                if (user.role === 'consultant') {
                    // The same counts the Workspace dashboard greeting gives, so both modes agree.
                    const mine = (consultantAssignments || []).filter((item) => consultantIsMine?.(item))
                    const work = summariseConsultantWork(mine)
                    const completed = work.completed.length
                    const budget = typeof user.consultingBudget === 'number'
                        ? new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(user.consultingBudget)
                        : t('Not set')
                    setOverview({
                        roleLabel: roleNames[user.role],
                        focus: [t('your assigned interventions'), t('client follow-ups'), t('proof of evidence')],
                        metrics: [
                            { key: 'accept', label: t('To accept'), value: work.toAccept.length, detail: t('Waiting for you to accept'), tone: 'amber' },
                            { key: 'due', label: t('Due this week'), value: work.yourDue.length, detail: t('On your side, in the next 7 days'), tone: 'blue' },
                            { key: 'overdue', label: t('Overdue'), value: work.yourLate.length, detail: t('On your side, past the due date'), tone: 'violet' },
                        ],
                        insights: [
                            { key: 'Waiting on others', label: t('Waiting on others'), value: work.waitingOnOthers.length, detail: t('Late or due work waiting on SMEs or reviewers'), positive: work.waitingOnOthers.length === 0 },
                            { key: 'Completed interventions', label: t('Completed interventions'), value: completed, detail: t('{rate}% completion rate', undefined, { rate: mine.length ? Math.round((completed / mine.length) * 100) : 0 }), positive: true },
                            { key: 'Consulting budget', label: t('Consulting budget'), value: budget, detail: t('Current account allocation'), positive: true },
                        ],
                        prompts: ['Prioritise my intervention queue', 'Which SMEs need attention?', 'Draft a plan for my active assignments'],
                        workspacePath: '/consultant',
                    })
                    return
                }

                if (user.role === 'systemadmin') {
                    const summary = await getAdminDashboardSummary(user, ...thisAndLastWeek())
                    if (cancelled) return
                    setOverview({
                        roleLabel: roleNames[user.role],
                        focus: [t('user access'), t('platform health'), t('delivery errors')],
                        metrics: [
                            { key: 'errors', label: t('Delivery errors'), value: summary.errors, detail: t('Failed operations this week'), tone: 'amber' },
                            { key: 'users', label: t('Active users'), value: summary.activeUsers, detail: t('Accounts currently enabled'), tone: 'blue' },
                            { key: 'companies', label: t('Companies'), value: summary.companies, detail: t('Organisations on the platform'), tone: 'violet' },
                        ],
                        insights: [
                            { key: 'Applications this week', label: t('Applications this week'), value: summary.applications, detail: signedDelta(summary.applications, summary.previous.applications, t('applications')), positive: summary.applications >= summary.previous.applications },
                            { key: 'User growth', label: t('User growth'), value: summary.users, detail: signedDelta(summary.users, summary.previous.users, t('users')), positive: summary.users >= summary.previous.users },
                            { key: 'System health', label: t('System health'), value: summary.errors ? t('Attention') : t('Healthy'), detail: summary.errors ? t('{count} failures need review', undefined, { count: summary.errors }) : t('No delivery failures this week'), positive: summary.errors === 0 },
                        ],
                        prompts: ['Summarise platform risks', 'Which errors need immediate attention?', 'Show me adoption changes this week'],
                        workspacePath: '/dashboard',
                    })
                    return
                }

                if (user.role === 'funder') {
                    const data = await loadFunderData(user, activeProgramId)
                    if (cancelled) return
                    funderRef.current = data
                    const behind = data.portfolio.filter(isFunderSmeBehind)
                    const delivery = funderDelivery(data.portfolio)
                    const { revenueGrowth, netJobs } = funderGrowth(data.portfolio)
                    setScopeFacts({
                        smesSupported: data.totals.smes,
                        averageProgress: data.totals.avgProgress,
                        smesBehind: behind.length,
                        smesBehindList: behind.slice(0, 40).map((row) => ({ name: row.name, overdueInterventions: row.execution.overdue, progress: row.progress })),
                        deliveryRate: delivery.rate,
                        revenueGrowthSinceJoining: revenueGrowth,
                        netJobsSinceJoining: netJobs,
                        programmes: data.programmes.map((row) => ({ name: row.name, smes: row.smes, delivery: funderDelivery(data.portfolio.filter((sme) => sme.programId === row.id)).rate })),
                    })
                    setOverview({
                        roleLabel: roleNames[user.role],
                        focus: [t('funding impact'), t('SMEs falling behind'), t('portfolio growth')],
                        metrics: [
                            { key: 'smes', label: t('SMEs supported'), value: data.totals.smes, detail: t('Businesses in your funded programmes'), tone: 'violet' },
                            { key: 'completed', label: t('Support delivered'), value: delivery.rate === null ? '—' : `${delivery.rate}%`, detail: t('{done} of {total} required interventions completed', undefined, { done: delivery.completed, total: delivery.required }), tone: 'blue' },
                            { key: 'risk', label: t('SMEs falling behind'), value: behind.length, detail: t('Two or more interventions overdue'), tone: 'amber' },
                        ],
                        insights: [
                            { key: 'Revenue growth', label: t('Revenue growth'), value: revenueGrowth === null ? '—' : `${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth}%`, detail: t('Since joining, across SMEs reporting revenue'), positive: (revenueGrowth ?? 0) >= 0 },
                            { key: 'Net jobs', label: t('Net jobs'), value: `${netJobs >= 0 ? '+' : ''}${netJobs}`, detail: t('Jobs added since joining'), positive: netJobs >= 0 },
                            { key: 'Average progress', label: t('Average progress'), value: `${data.totals.avgProgress}%`, detail: t('Required support done, per SME'), positive: data.totals.avgProgress >= 50 },
                        ],
                        prompts: ['Give me a funding impact brief', 'Which SMEs are falling behind?', 'How are revenue and jobs growing?'],
                        workspacePath: roleWorkspacePaths[user.role],
                    })
                    return
                }

                const workspace = await loadProjectAdminWorkspace(user, activeProgramId)
                if (cancelled) return
                workspaceRef.current = workspace
                const openApplications = workspace.applications.filter((item) => isOpenApplicationStatus(item.status)).length
                const completed = workspace.interventions.filter((item) => isCompletedInterventionStatus(item.status))
                const ongoing = workspace.interventions.length - completed.length
                const complianceAttention = workspace.complianceDocuments.filter((item) => isComplianceAttentionStatus(item.status)).length
                const overdue = workspace.interventions.filter((item) => isOverdueIntervention(item)).length
                const completedThisWeek = completed.filter((item) => inWeek(item.completedAt)).length
                const completedLastWeek = completed.filter((item) => inWeek(item.completedAt, -1)).length
                const completionRate = workspace.interventions.length ? Math.round((completed.length / workspace.interventions.length) * 100) : 0
                const isExecutive = user.role === 'director'
                const participantNameById = new Map(workspace.participants.map((item) => [item.id, item.businessName]))
                const riskBySme = new Map<string, { overdueInterventions: number; complianceIssues: number }>()
                const bumpRisk = (name: string, key: 'overdueInterventions' | 'complianceIssues') => {
                    if (!name) return
                    const row = riskBySme.get(name) || { overdueInterventions: 0, complianceIssues: 0 }
                    row[key] += 1
                    riskBySme.set(name, row)
                }
                workspace.interventions.filter((item) => isOverdueIntervention(item)).forEach((item) => bumpRisk(item.participantName, 'overdueInterventions'))
                workspace.complianceDocuments.filter((item) => isComplianceAttentionStatus(item.status)).forEach((item) => bumpRisk(participantNameById.get(item.participantId) || '', 'complianceIssues'))
                const atRiskSmes = [...riskBySme.entries()]
                    .map(([name, counts]) => ({ name, ...counts }))
                    .sort((a, b) => (b.overdueInterventions + b.complianceIssues) - (a.overdueInterventions + a.complianceIssues))
                setScopeFacts({
                    activeSmes: workspace.participants.length,
                    smesAtRisk: atRiskSmes.length,
                    overdueInterventions: overdue,
                    complianceItemsNeedingAttention: complianceAttention,
                    smesAtRiskList: atRiskSmes.slice(0, 40),
                })
                setOverview({
                    roleLabel: roleNames[user.role],
                    focus: isExecutive
                        ? [t('programme performance'), t('risk hotspots'), t('your next decision')]
                        : [t('participant progress'), t('delivery risks'), t('overdue interventions')],
                    metrics: [
                        isExecutive
                            ? { key: 'risk', label: t('Items at risk'), value: overdue + complianceAttention, detail: t('Overdue and compliance signals'), tone: 'amber' }
                            : { key: 'decisions', label: t('Pending decisions'), value: openApplications + complianceAttention, detail: t('Applications and compliance reviews'), tone: 'amber' },
                        { key: 'ongoing', label: t('Ongoing interventions'), value: ongoing, detail: t('Active delivery across the programme'), tone: 'blue' },
                        { key: 'smes', label: t('Active SMEs'), value: workspace.participants.length, detail: t('Businesses in the current scope'), tone: 'violet' },
                    ],
                    insights: [
                        { key: 'Completed this week', label: t('Completed this week'), value: completedThisWeek, detail: signedDelta(completedThisWeek, completedLastWeek, t('interventions')), positive: completedThisWeek >= completedLastWeek },
                        { key: 'Completion rate', label: t('Completion rate'), value: `${completionRate}%`, detail: t('{done} of {total} interventions completed', undefined, { done: completed.length, total: workspace.interventions.length }), positive: completionRate >= 60 },
                        { key: 'Portfolio risk', label: t('Portfolio risk'), value: overdue, detail: overdue ? t('Overdue interventions need attention') : t('No overdue interventions'), positive: overdue === 0 },
                    ],
                    prompts: isExecutive
                        ? ['Give me an executive programme brief', 'Where are our biggest delivery risks?', 'Compare this week’s intervention progress']
                        : [
                            ...(COORDINATOR_ROLES.includes(user.role) && hasRolePermission(user.role, 'assign_interventions', user.permissions) ? ['Assign an intervention', 'Schedule an appointment'] : []),
                            'Build my priority list for today',
                            'Which interventions are falling behind?',
                            'Summarise programme delivery this week',
                        ],
                    workspacePath: roleWorkspacePaths[user.role],
                })
            } catch {
                if (!cancelled) {
                    setOverview(emptyOverview(user.role))
                    message.error(t('The agentic overview could not load all workspace metrics.'))
                }
            } finally {
                if (!cancelled) {
                    overviewLoaded.current = true
                    setLoading(false)
                }
            }
        }

        void load()
        return () => { cancelled = true }
    }, [activeProgramId, consultantAssignments, consultantIsMine, message, user, t])

    // The agent always gets English (labels on screen may be isiZulu), keyed by what each metric counts.
    const pageContext = useMemo<AgentPageContext>(() => ({
        pageKey: 'agentic-home',
        pageName: 'Agentic overview',
        purpose: `Role-aware command centre for ${user?.role || 'workspace'}.`,
        currentFilters: { activeProgramId, programmeScope: activeProgramId === 'all' ? 'All programmes' : `Single programme (id ${activeProgramId})` },
        metrics: Object.fromEntries([
            ...overview.metrics.map((item) => [METRIC_NAMES[item.key], item.value]),
            ...overview.insights.map((item) => [item.key, item.value]),
        ]),
        dataSummary: {
            metricDefinitions: {
                'Items at risk': 'COUNT OF ITEMS, not SMEs: overdue interventions + compliance documents needing attention. One SME can account for several items.',
                'Active SMEs': 'Number of SMEs in the current programme scope.',
                'Ongoing interventions': 'Assigned interventions not yet completed in the current programme scope.',
                'To accept': 'Interventions assigned to the consultant that they have not accepted yet.',
                'Due this week': 'Open interventions due in the next 7 days where the next move is the consultant’s.',
                'Overdue on your side': 'Interventions past their due date where the next move is the consultant’s (not counting ones still to accept).',
                'Portfolio risk': 'Number of overdue interventions.',
            },
            scopeFacts,
            focusedItem: focusedItem ? { fromMetric: METRIC_NAMES[focusedItem.metric], item: focusedItem.row.item, status: focusedItem.row.status, detail: focusedItem.row.detail, facts: focusedItem.facts, note: 'The user picked this item from a list; questions like "tell me more", "this", "it" refer to it.' } : undefined,
            role: user?.role,
            selectedMetric: selectedMetric ? {
                metric: METRIC_NAMES[selectedMetric.key],
                value: selectedMetric.value,
                visibleRows: metricRows.slice(0, 50),
            } : undefined,
        },
        updatedAt: new Date().toISOString(),
    }), [activeProgramId, metricRows, overview, scopeFacts, focusedItem, selectedMetric, user?.role])

    const [guidedKind, setGuidedKind] = useState<GuidedActionKind | null>(null)
    const canGuide = (kind: GuidedActionKind) => !!user && COORDINATOR_ROLES.includes(user.role)
        && (kind === 'assignment'
            ? hasRolePermission(user.role, 'assign_interventions', user.permissions)
            : hasRolePermission(user.role, 'assign_interventions', user.permissions) || hasRolePermission(user.role, 'track_interventions', user.permissions))

    const send = (content = draft, display?: string) => {
        const nextContent = content.trim()
        if (!nextContent) return
        const guided = display ? undefined : guidedActionForPrompt(nextContent)
        if (guided && canGuide(guided)) {
            setDraft('')
            setGuidedKind(guided)
            return
        }
        const userMessage = makeMessage('user', display || nextContent)
        // The pending flag (not the text) marks "thinking", so the wording can be translated.
        const pendingMessage = { ...makeMessage('agent', t('Working on this in the background…')), pending: true }
        const action = actionForPrompt(nextContent, user?.role)
        const history = messages.filter((item) => !item.pending)
        setMessages((current) => [...current, userMessage, pendingMessage])
        setDraft('')
        queueTask({
            title: selectedMetric ? `${METRIC_NAMES[selectedMetric.key]}: ${nextContent}` : undefined,
            prompt: nextContent,
            page: pageContext,
            history,
            onCompleted: (result, proposal) => {
                setMessages((current) => current.map((item) => item.id === pendingMessage.id
                    ? { ...item, content: result, pending: false, ...(proposal ? { proposal, proposalStatus: 'pending' as const } : {}) }
                    : item))
                if (action) setMessageActions((current) => ({ ...current, [pendingMessage.id]: action }))
            },
            onFailed: (error) => setMessages((current) => current.map((item) => item.id === pendingMessage.id
                ? { ...item, content: error, pending: false }
                : item)),
        })
    }

    const updateProposal = (messageId: string, proposalStatus: AgentProposalStatus, proposalNote?: string) => {
        setMessages((current) => current.map((item) => item.id === messageId
            ? { ...item, proposalStatus, proposalNote }
            : item))
    }

    // Each drill-down gets a number; a reply that arrives after the user opened another metric (or closed
    // the window) is ignored, so the window can always be closed while it loads.
    const metricRequest = useRef(0)

    const closeMetric = () => {
        metricRequest.current += 1
        setSelectedMetric(undefined)
        setMetricLoading(false)
    }

    const loadMetricDetails = async (metric: Metric) => {
        if (!user) return
        const request = ++metricRequest.current
        const isCurrent = () => request === metricRequest.current
        const showRows = (rows: MetricDetailRow[]) => { if (isCurrent()) setMetricRows(rows) }
        setSelectedMetric(metric)
        setMetricRows([])
        setMetricPage(1)
        setMetricLoading(true)

        const assignmentRow = (item: typeof assignments[number]): MetricDetailRow => {
            const raw = item as unknown as Record<string, unknown>
            return {
                id: item.id,
                item: String(item.interventionTitle || raw.title || t('Intervention')),
                status: String(item.status || raw.completionStatus || t('Pending')),
                detail: String(raw.participantName || raw.businessName || item.participantId || t('Assigned workspace item')),
            }
        }

        try {
            if (user.role === 'incubatee') {
                if (metric.key === 'applications') {
                    const applications = await listMyApplications(user.uid)
                    showRows(applications
                        .filter((item) => isOpenApplicationStatus(String(item.applicationStatus || 'pending')))
                        .map((item) => ({ id: item.id, item: item.programName || t('Programme application'), status: String(item.applicationStatus || t('Pending')), detail: t('Waiting for a decision') })))
                    return
                }

                const workspace = await loadIncubateeWorkspace(user)
                if (!workspace) {
                    showRows([])
                    return
                }

                if (metric.key === 'action') {
                    const interventions = workspace.assignedInterventions
                        .filter(canConfirmIncubateeIntervention)
                        .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: item.areaOfSupport || t('Intervention') }))
                    const forms = workspace.forms
                        .filter((item) => !['completed', 'submitted'].includes(item.status.toLowerCase()))
                        .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: item.kind === 'survey' ? t('Survey') : t('Assessment') }))
                    showRows([...interventions, ...forms])
                } else if (metric.key === 'ongoing') {
                    showRows(workspace.assignedInterventions
                        .filter((item) => item.status === 'In Progress')
                        .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: item.areaOfSupport || item.assigneeName || t('Intervention') })))
                } else if (metric.key === 'documents') {
                    const documents = await listIncubateeOutstandingComplianceDocuments(user)
                    showRows(documents.map((document) => ({
                        id: document.id,
                        item: document.title,
                        status: document.status,
                        detail: document.fileName
                            ? document.expiryDate
                                ? t('Uploaded file: {file} · Expires {date}. Review or replace it.', undefined, { file: document.fileName, date: document.expiryDate })
                                : t('Uploaded file: {file}. Review or replace it.', undefined, { file: document.fileName })
                            : t('Not yet uploaded'),
                    })))
                } else {
                    showRows([])
                }
                return
            }

            if (user.role === 'consultant') {
                // The same groups as the cards' counts.
                const work = summariseConsultantWork(assignments.filter(isMine))
                const groups: Partial<Record<MetricKey, typeof assignments>> = { accept: work.toAccept, due: work.yourDue, overdue: work.yourLate }
                showRows((groups[metric.key] || work.open).map(assignmentRow))
                return
            }

            if (user.role === 'systemadmin') {
                // Same week range as the card, so the list matches its count.
                const summary = await getAdminDashboardSummary(user, ...thisAndLastWeek())
                if (metric.key === 'errors') {
                    showRows(summary.recentErrors.map((item) => ({ id: item.id, item: item.source, status: t('Failed'), detail: item.message })))
                } else {
                    showRows([{ id: metric.key, item: metric.label, status: String(metric.value), detail: metric.detail }])
                }
                return
            }

            if (user.role === 'funder') {
                const data = funderRef.current || await loadFunderData(user, activeProgramId)
                const smeRow = (row: FunderData['portfolio'][number]) => ({
                    id: row.id,
                    item: row.name,
                    status: t('{percent}% done', undefined, { percent: row.progress }),
                    detail: [row.programName, row.execution.overdue ? t('{count} overdue', undefined, { count: row.execution.overdue }) : ''].filter(Boolean).join(' · '),
                })
                if (metric.key === 'risk') {
                    showRows(data.portfolio.filter(isFunderSmeBehind).sort((a, b) => b.execution.overdue - a.execution.overdue).map(smeRow))
                } else if (metric.key === 'completed') {
                    showRows(data.programmes.map((row) => {
                        const done = funderDelivery(data.portfolio.filter((sme) => sme.programId === row.id))
                        return {
                            id: row.id,
                            item: row.name,
                            status: done.rate === null ? '—' : `${done.rate}%`,
                            detail: t('{done} of {total} required interventions completed', undefined, { done: done.completed, total: done.required }),
                        }
                    }))
                } else {
                    showRows(data.portfolio.map(smeRow))
                }
                return
            }

            const workspace = await loadProjectAdminWorkspace(user, activeProgramId)
            const participantNameById = new Map(workspace.participants.map((item) => [item.id, item.businessName]))
            if (metric.key === 'ongoing') {
                showRows(workspace.interventions
                    .filter((item) => !isCompletedInterventionStatus(item.status))
                    .map((item) => ({ id: item.id, item: item.title, status: item.status, detail: `${item.participantName} · ${item.owner}` })))
            } else if (metric.key === 'smes') {
                showRows(workspace.participants.map((item) => ({ id: item.id, item: item.businessName, status: item.status, detail: item.programName })))
            } else {
                const applicationRows = workspace.applications
                    .filter((item) => isOpenApplicationStatus(item.status))
                    .map((item) => ({ id: item.id, item: item.businessName, status: item.status, detail: item.programName }))
                const riskRows = workspace.interventions
                    .filter((item) => isOverdueIntervention(item))
                    .map((item) => ({ id: item.id, item: item.title, status: t('Overdue'), detail: item.participantName }))
                // The document's name and the SME's business name, not a raw participant id.
                const complianceRows = workspace.complianceDocuments
                    .filter((item) => isComplianceAttentionStatus(item.status))
                    .map((item) => ({ id: item.id, item: item.type, status: item.status, detail: participantNameById.get(item.participantId) || t('Unknown SME') }))
                showRows(metric.key === 'risk' ? [...riskRows, ...complianceRows] : [...applicationRows, ...complianceRows])
            }
        } catch {
            if (!isCurrent()) return
            setMetricRows([])
            message.error(t('Could not load the details for {metric}.', undefined, { metric: metric.label }))
        } finally {
            if (isCurrent()) setMetricLoading(false)
        }
    }

    const focusRow = (row: MetricDetailRow) => {
        const workspace = workspaceRef.current
        const metric = selectedMetric?.key || 'attention'
        const facts: Record<string, unknown> = {}
        const fmt = (value: Date | null) => value ? dayjs(value).format('YYYY-MM-DD') : undefined
        const participant = workspace?.participants.find((item) => item.id === row.id)
        const intervention = workspace?.interventions.find((item) => item.id === row.id)
        if (workspace && participant) {
            facts.type = 'SME'
            facts.programme = participant.programName
            facts.status = participant.status
            facts.onboarded = fmt(participant.onboardedAt)
            facts.interventions = workspace.interventions
                .filter((item) => item.participantName === participant.businessName)
                .map((item) => ({ title: item.title, status: item.status, progress: item.progress, due: fmt(item.dueDate), owner: item.owner, overdue: isOverdueIntervention(item) }))
            facts.complianceDocuments = workspace.complianceDocuments
                .filter((item) => item.participantId === participant.id)
                .map((item) => ({ type: item.type, status: item.status, expires: fmt(item.expiryDate) }))
        } else if (workspace && intervention) {
            facts.type = 'Intervention'
            facts.sme = intervention.participantName
            facts.owner = intervention.owner
            facts.programme = intervention.programName
            facts.progress = intervention.progress
            facts.due = fmt(intervention.dueDate)
            facts.overdue = isOverdueIntervention(intervention)
        }
        const funderSme = !workspace && funderRef.current?.portfolio.find((item) => item.id === row.id)
        if (funderSme) {
            facts.type = 'SME'
            facts.programme = funderSme.programName
            facts.sector = funderSme.sector
            facts.progress = funderSme.progress
            facts.interventions = funderSme.execution
            facts.revenue = funderSme.metrics.revenue
            facts.employees = funderSme.metrics.employees
        }
        setFocusedItem({ metric, row, facts })
        closeMetric()
        window.setTimeout(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 250)
    }

    // The prompt sent to the agent stays English; the button shows the translated wording.
    const focusPrompts = focusedItem
        ? [
            { prompt: `Tell me more about ${focusedItem.row.item}`, label: t('Tell me more about {item}', undefined, { item: focusedItem.row.item }) },
            { prompt: `What are the risks or issues with ${focusedItem.row.item}?`, label: t('What are the risks or issues with {item}?', undefined, { item: focusedItem.row.item }) },
            { prompt: `What should I do next for ${focusedItem.row.item}?`, label: t('What should I do next for {item}?', undefined, { item: focusedItem.row.item }) },
        ]
        : []

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
            message.success(t('{document} uploaded for compliance review.', undefined, { document: upload.type }))
            setPendingComplianceUpload(undefined)
            if (selectedMetric) void loadMetricDetails(selectedMetric)
        } catch {
            message.error(t('The document could not be uploaded. Please try again.'))
        } finally {
            setComplianceUploading(false)
        }
    }

    // Same rules as the compliance page; the dates are always shown for confirmation, never saved on a guess.
    const chooseComplianceFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        const type = requestedComplianceTypeRef.current
        event.target.value = ''
        if (!file || !type) return
        const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
        if (!COMPLIANCE_FILE_TYPES.split(',').includes(extension)) {
            message.error(t('Please choose a PDF or an image (PNG, JPG, WEBP).'))
            return
        }
        if (file.size > COMPLIANCE_MAX_MB * 1024 * 1024) {
            message.error(t('That file is larger than {size} MB.', undefined, { size: COMPLIANCE_MAX_MB }))
            return
        }
        setPendingComplianceUpload({ type, file, ...await inferComplianceDates(file) })
    }

    const pendingDatesInvalid = Boolean(pendingComplianceUpload?.issueDate && pendingComplianceUpload.expiryDate
        && pendingComplianceUpload.expiryDate.isBefore(pendingComplianceUpload.issueDate, 'day'))

    const firstName = String(user?.displayName || user?.name || '').trim().split(/\s+/)[0]
    const visibleMetrics = overview.metrics
        .filter((metric) => typeof metric.value === 'number' && metric.value > 0)
        .slice(0, 4)
    const activeMode = messages.length > 0
    const selectedMetricAction = selectedMetric && user?.role === 'incubatee'
        ? selectedMetric.key === 'documents'
            ? { label: t('Upload document'), path: '/incubatee/compliance?upload=1' }
            : selectedMetric.key === 'ongoing'
                ? { label: t('Work on interventions'), path: '/incubatee/interventions' }
                : selectedMetric.key === 'applications'
                    ? { label: t('Open application tracker'), path: '/applicant/application-tracker' }
                    : undefined
        : undefined
    const isDocumentMetric = selectedMetric?.key === 'documents'
    const metricPageSize = selectedMetric?.key === 'ongoing' ? 3 : 5
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
                id: 'agentic-quick-tour', title: t('Quick tour'), description: t('Learn where to start, what needs attention and how agentic work changes after your first message.'), kind: 'page', order: 1,
                steps: [
                    { element: guideTarget('agentic-command'), popover: { title: t('Your agentic workspace'), description: t('Start here with a question or an action. The agent uses your role and current workspace scope to respond.'), side: 'bottom' } },
                    { element: guideTarget('agentic-priority-metrics'), skipMissingElement: true, popover: { title: t('Priority signals'), description: t('Only items that need attention are shown. Select one to inspect the live records behind its count.'), side: 'bottom' } },
                    { element: guideTarget('agentic-composer'), popover: { title: t('Ask or direct the agent'), description: t('Use this one-line composer for a question, a summary, or a task. Once you start, it stays docked below the conversation.'), side: 'top' } },
                    { element: guideTarget('agentic-suggestions'), skipMissingElement: true, popover: { title: t('Suggested starting points'), description: t('These role-aware prompts are shortcuts. Select one to start a focused conversation immediately.'), side: 'top' } },
                ],
            },
            ...(visibleMetrics.length ? [{
                id: 'agentic-priority-detail', title: t('Explore priority details'), description: t('Open a live metric and review the exact records behind it.'), kind: 'task' as const, order: 2,
                steps: [
                    { element: guideTarget('agentic-priority-metrics'), advanceOnClick: true, popover: { title: t('Choose a priority signal'), description: t('Select the signal you want to investigate. The guide follows your choice and waits for its live detail view.'), side: 'bottom' as const, showButtons: ['close'] as Array<'close'> } },
                    { element: '.agentic-metric-modal .ant-modal-content', waitForElement: 5000, popover: { title: t('Live workspace records'), description: t('This view loads the exact records behind the signal you chose, including each item, status and context. Use the footer action to continue the work in the right workspace.'), side: 'left' as const } },
                    { element: guideTarget('agentic-metric-footer'), waitForElement: 5000, skipMissingElement: true, popover: { title: t('Continue from the result'), description: t('Use the relevant next action here, or page through the records when there are more than fit comfortably in this view.'), side: 'top' as const } },
                ],
            }] : []),
            {
                id: 'agentic-start-conversation', title: t('Start a conversation'), description: t('Use a suggested prompt or write a focused question for your workspace.'), kind: 'task', order: 3,
                steps: [
                    { element: guideTarget('agentic-composer'), popover: { title: t('Write a focused request'), description: t('Ask for a priority list, progress update, risk review or help with a particular item.'), side: 'top' } },
                    { element: guideTarget('agentic-suggestions'), skipMissingElement: true, popover: { title: t('Use a suggested prompt'), description: t('Choose one of these to send a ready-made role-specific request and begin the conversation.'), side: 'top' } },
                ],
            },
        ],
    }), [visibleMetrics.length, t])

    useRegisterPageGuide(guideRegistration)

    return (
        <main className={`agentic-home ${activeMode ? 'is-conversing' : ''} ${!loading && visibleMetrics.length === 0 ? 'has-no-metrics' : ''}`}>
            {(loading || visibleMetrics.length > 0) && <section data-guide-target="agentic-priority-metrics" className="agentic-summary" aria-label={t('Priority metrics')}>
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
                                className={`agentic-metric-card is-${metric.tone} ${selectedMetric?.key === metric.key ? 'is-selected' : ''}`}
                                key={metric.key}
                                onClick={() => void loadMetricDetails(metric)}
                                aria-label={t('View {metric} details', undefined, { metric: metric.label })}
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
                        <Typography.Title level={1}>
                            <TypingGreeting
                                lead={firstName ? t('{name}, ready to work on', undefined, { name: firstName }) : t('Ready to work on')}
                                words={overview.focus}
                            />
                        </Typography.Title>
                        <Typography.Paragraph>{t('Ask across your permitted workspace data, or start with a suggested action.')}</Typography.Paragraph>
                    </>
                )}

                {messages.length > 0 && (
                    <div className="agentic-conversation" aria-live="polite" ref={conversationRef}>
                        {messages.map((item) => (
                            <div
                                className={`agentic-chat-message is-${item.role} ${item.pending ? 'is-pending' : ''}`}
                                key={item.id}
                                ref={(node) => { messageRefs.current[item.id] = node }}
                            >
                                {item.role === 'agent' && <span><RobotOutlined /></span>}
                                {item.role === 'agent'
                                    ? <div className="agentic-message-content">
                                        {item.pending
                                            ? <span className="agentic-pending-copy"><LoadingOutlined spin />{item.content}</span>
                                            : renderAgentContent(item.content)}
                                        {item.proposal && (
                                            <AgentProposalCard
                                                proposal={item.proposal}
                                                status={item.proposalStatus ?? 'pending'}
                                                note={item.proposalNote}
                                                onChange={(status, note) => updateProposal(item.id, status, note)}
                                            />
                                        )}
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
                    <aside className="agentic-chat-activity-rail" aria-label={t('Conversation message navigator')}>
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
                                    aria-label={t('Jump to conversation turn {number}', undefined, { number: index + 1 })}
                                >
                                    <span />
                                    <div>
                                        <strong>{t('Conversation turn')} {conversationTurns.length - Math.min(10, conversationTurns.length) + index + 1}</strong>
                                        <p>{preview}</p>
                                    </div>
                                </button>
                            )
                        })}
                    </aside>
                )}

                {/* Suggestions sit above the box; in a conversation the whole dock stays pinned to the bottom. */}
                <div className="agentic-composer-dock">
                    {focusedItem && (
                        <div className="agentic-suggestions" style={{ alignItems: 'center' }}>
                            <Tag closable color="blue" onClose={() => setFocusedItem(undefined)}>{t('Focused: {item}', undefined, { item: focusedItem.row.item })}</Tag>
                            {focusPrompts.map(({ prompt, label }) => <Button key={prompt} type="primary" ghost onClick={() => void send(prompt, label)}>{label}</Button>)}
                        </div>
                    )}

                    {!activeMode && !focusedItem && (
                        <div data-guide-target="agentic-suggestions" className="agentic-suggestions">
                            {overview.prompts.map((prompt) => (
                                <Button key={prompt} onClick={() => void send(prompt)}>
                                    <span>{t(prompt)}</span>
                                    <RightOutlined className="agentic-suggestion-arrow" aria-hidden="true" />
                                </Button>
                            ))}
                        </div>
                    )}

                    <div data-guide-target="agentic-composer" className="agentic-composer" ref={composerRef}>
                        <Button
                            type="text"
                            shape="circle"
                            className="agentic-composer-mic-button"
                            icon={<AudioOutlined />}
                            onClick={() => setVoiceMode(true)}
                            aria-label={t('Start voice conversation')}
                        />
                        <Input
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onPressEnter={() => void send()}
                            placeholder={focusedItem ? t('Ask about {item}…', undefined, { item: focusedItem.row.item }) : t('Ask about priorities, progress, risks or next steps…')}
                        />
                        <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => void send()} disabled={!draft.trim()} aria-label={t('Send message')} />
                    </div>
                </div>

            </section>


            <AgentGuidedAction
                kind={guidedKind}
                assignments={assignments}
                onClose={() => setGuidedKind(null)}
                onSubmit={(prompt, display) => send(prompt, display)}
            />

            <Modal
                open={Boolean(selectedMetric)}
                onCancel={() => {
                    closeMetric()
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
                        className="agentic-metric-scroll"
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
                                        role="button"
                                        tabIndex={0}
                                        title={t('Ask the agent about this')}
                                        onClick={() => focusRow(row)}
                                        onKeyDown={(event) => { if (event.key === 'Enter') focusRow(row) }}
                                        style={{
                                            cursor: 'pointer',
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
                                            aria-label={t('Upload {document}', undefined, { document: row.item })}
                                            onClick={(event) => {
                                                event.stopPropagation()
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
                                        {t('Nothing to show')}
                                    </Typography.Title>
                                    <Typography.Text type="secondary">
                                        {t('No matching workspace items were found for this metric.')}
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
                        {selectedMetricAction && <Button type="primary" block onClick={() => openWorkspace(selectedMetricAction.path)}>{isDocumentMetric ? t('Manage compliance') : selectedMetricAction.label}</Button>}
                    </footer>}
                </div>
            </Modal>

            <input ref={complianceFileInputRef} type="file" hidden accept={COMPLIANCE_FILE_TYPES} onChange={(event) => void chooseComplianceFile(event)} />
            <Modal
                open={Boolean(pendingComplianceUpload)}
                title={t('Confirm document dates')}
                okText={t('Save document')}
                {...singleActionFooter({ disabled: pendingDatesInvalid })}
                confirmLoading={complianceUploading}
                onCancel={() => !complianceUploading && setPendingComplianceUpload(undefined)}
                onOk={() => pendingComplianceUpload && void saveComplianceUpload(pendingComplianceUpload)}
            >
                <Typography.Paragraph>
                    {t('Check the dates for {file} before saving it for review. Leave the expiry date empty if it has none.', undefined, { file: pendingComplianceUpload?.file.name || '' })}
                </Typography.Paragraph>
                <DatePicker
                    value={pendingComplianceUpload?.issueDate || null}
                    onChange={(issueDate) => setPendingComplianceUpload((current) => current ? { ...current, issueDate } : current)}
                    placeholder={t('Issue date')}
                    style={{ width: '100%', marginBottom: 12 }}
                />
                <DatePicker
                    value={pendingComplianceUpload?.expiryDate || null}
                    onChange={(expiryDate) => setPendingComplianceUpload((current) => current ? { ...current, expiryDate } : current)}
                    placeholder={t('Expiry date')}
                    style={{ width: '100%' }}
                    status={pendingDatesInvalid ? 'error' : undefined}
                />
                {pendingDatesInvalid && <Typography.Text type="danger">{t('The expiry date must be after the issue date.')}</Typography.Text>}
            </Modal>

            {voiceMode && (
                <ConversationMode
                    messages={messages}
                    isTyping={Boolean(messages.at(-1)?.pending)}
                    onSend={(content) => send(content)}
                    onClose={() => setVoiceMode(false)}
                />
            )}
        </main>
    )
}

export default AgenticHomePage
