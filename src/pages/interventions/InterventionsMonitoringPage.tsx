import { App, Button, Card, Col, Descriptions, Input, Modal, Progress, Rate, Row, Segmented, Select, Space, Tag, Typography, type TableProps } from 'antd'
import { AlertOutlined, BarChartOutlined, BellOutlined, BulbOutlined, ClockCircleOutlined, EyeOutlined, FieldTimeOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '@/firebase'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { InterventionOpsActions } from '@/components/interventions/InterventionOpsActions'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { createInterventionReminder, listInterventionAssignmentApplications, type InterventionAssignmentApplicationLookup } from '@/services/assignedInterventionsService'
import { generateInterventionMonitoringInsights, type InterventionMonitoringInsights, type MonitoringInsight } from '@/services/interventionMonitoringInsightsService'
import { getParticipants } from '@/services/participantService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { Participant } from '@/types/participant.types'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type AssignmentKind = 'all' | 'single' | 'grouped'
type HealthFilter = 'all' | 'on_track' | 'held_up' | 'overdue' | 'completed'
type DeliveryFilter = 'all' | 'human' | 'agent' | 'unmarked'
type MonitorSection = 'overview' | 'insights' | 'assignments'
type StandardStatus =
    | 'Assigned'
    | 'Awaiting Assignee Acceptance'
    | 'Awaiting SME Acceptance'
    | 'In Progress'
    | 'Awaiting Completion Confirmation'
    | 'Completed'
    | 'Declined'
type StandardStatusFilter = 'all' | StandardStatus

type MonitorRow = {
    id: string
    title: string
    participantName: string
    participantEmail: string
    programName: string
    programId: string
    assigneeName: string
    assigneeEmail: string
    deliveryActorType: 'human' | 'agent' | null
    deliveryStrategy: string
    agentName: string
    agentWorkStatus: string
    reviewStatus: string
    reviewerType: string
    agentRating: number | null
    agentRatingCount: number
    kind: 'single' | 'grouped'
    status: StandardStatus
    rawStatus: string
    progress: number
    implementationDate: Date | null
    dueDate: Date | null
    assignedAt: Date | null
    isCompleted: boolean
    isOverdue: boolean
    health: Exclude<HealthFilter, 'all'>
    holdUp: string
    reason: string
    raw: AssignedIntervention
}

type GroupRow = {
    id: string
    groupName: string
    kind: 'grouped'
    assignments: MonitorRow[]
    assignedCount: number
    completedCount: number
    overdueCount: number
    heldUpCount: number
    averageProgress: number
    earliestDueDate: Date | null
    reason: string
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const semanticPalette = {
    assigned: '#64748b',
    awaiting: '#f59e0b',
    progress: '#2563eb',
    confirmation: '#7c3aed',
    completed: '#16a34a',
    declined: '#dc2626',
    overdue: '#dc2626',
    heldUp: '#f97316',
    onTrack: '#0d9488',
}

const toDate = (value: unknown) => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return value.toDate()
    if (typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
    const parsed = new Date(String(value))
    return Number.isNaN(+parsed) ? null : parsed
}

const clampProgress = (value: unknown) => {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.min(100, Math.round(parsed)))
}

const isGroupedAssignment = (assignment: AssignedIntervention) => {
    const type = normalize(assignment.type || (assignment as Record<string, unknown>).assignmentType)
    return type === 'grouped' || !!assignment.groupId
}

const deriveCompleted = (assignment: AssignedIntervention, progress: number) => {
    const status = normalize(assignment.status)
    const completion = normalize(
        assignment.participantCompletionStatus ||
        assignment.assigneeCompletionStatus ||
        (assignment as Record<string, unknown>).completionStatus,
    )

    return status === 'completed' || completion === 'confirmed' || progress >= 100
}

const deriveStandardStatus = (assignment: AssignedIntervention, progress: number): StandardStatus => {
    const rawStatus = normalize(assignment.status)
    const assigneeStatus = normalize(assignment.assigneeStatus)
    const participantStatus = normalize(assignment.participantStatus)
    const assigneeCompletion = normalize(assignment.assigneeCompletionStatus)
    const participantCompletion = normalize(assignment.participantCompletionStatus)

    if (rawStatus === 'declined' || assigneeStatus === 'declined' || participantStatus === 'declined') return 'Declined'
    if (rawStatus === 'completed' || participantCompletion === 'confirmed' || (progress >= 100 && participantCompletion === 'confirmed')) return 'Completed'
    if (assigneeCompletion === 'done' || rawStatus === 'awaiting_confirmation' || rawStatus.includes('awaiting')) return 'Awaiting Completion Confirmation'
    if (assigneeStatus !== 'accepted') return 'Awaiting Assignee Acceptance'
    if (participantStatus !== 'accepted') return 'Awaiting SME Acceptance'
    if (rawStatus === 'in-progress' || rawStatus === 'in_progress' || progress > 0) return 'In Progress'
    return 'Assigned'
}

const deriveHoldUp = (assignment: AssignedIntervention, progress: number, isCompleted: boolean) => {
    if (isCompleted) return { holdUp: 'Completed', reason: 'Completion has been recorded.' }

    const status = normalize(assignment.status)
    const assigneeStatus = normalize(assignment.assigneeStatus)
    const participantStatus = normalize(assignment.participantStatus)
    const assigneeCompletion = normalize(assignment.assigneeCompletionStatus)
    const participantCompletion = normalize(assignment.participantCompletionStatus)
    const declineReason = String((assignment as Record<string, unknown>).declineReason || '').trim()
    const assignmentRecord = assignment as Record<string, unknown>
    const agentWorkStatus = normalize(assignmentRecord.agentWorkStatus)
    const reviewStatus = normalize(assignmentRecord.reviewStatus)

    if (assignment.deliveryActorType === 'agent' && agentWorkStatus === 'awaiting_review' && reviewStatus !== 'approved') {
        return { holdUp: 'Human review', reason: `Agent work is ready for ${String(assignmentRecord.reviewerType || 'operations')} review.` }
    }
    if (assignment.deliveryActorType === 'agent' && agentWorkStatus === 'draft_ready') {
        return { holdUp: 'Agent work in progress', reason: 'The SME has a generated draft and is preparing the final deliverable.' }
    }

    if (assigneeStatus === 'pending' || assigneeStatus === '') {
        return { holdUp: 'Assignee acceptance', reason: 'The assigned facilitator has not accepted the intervention yet.' }
    }

    if (assigneeStatus === 'declined') {
        return { holdUp: 'Assignee declined', reason: declineReason || 'The assigned facilitator declined the intervention.' }
    }

    if (participantStatus === 'pending' || participantStatus === '') {
        return { holdUp: 'SME acceptance', reason: 'The SME has not accepted the intervention or first appointment yet.' }
    }

    if (participantStatus === 'declined') {
        return { holdUp: 'SME declined', reason: declineReason || 'The SME declined the intervention.' }
    }

    if (progress >= 100 && participantCompletion !== 'confirmed') {
        return { holdUp: 'SME completion confirmation', reason: 'Delivery is marked complete and needs SME confirmation.' }
    }

    if (assigneeCompletion === 'done' && participantCompletion !== 'confirmed') {
        return { holdUp: 'SME completion confirmation', reason: 'The assignee submitted completion and the SME has not confirmed it.' }
    }

    if (status.includes('awaiting')) {
        return { holdUp: 'Awaiting next action', reason: `Current status is ${String(assignment.status || 'awaiting action')}.` }
    }

    if (progress > 0) {
        return { holdUp: 'In delivery', reason: 'The intervention is in progress.' }
    }

    return { holdUp: 'Not started', reason: 'The intervention has been assigned but progress has not started.' }
}

const healthColor = (health: MonitorRow['health']) => {
    if (health === 'completed') return 'green'
    if (health === 'overdue') return 'red'
    if (health === 'held_up') return 'orange'
    return 'blue'
}

const statusColor = (status: StandardStatus) => {
    if (status === 'Completed') return 'green'
    if (status === 'Declined') return 'red'
    if (status === 'In Progress') return 'blue'
    if (status === 'Awaiting Completion Confirmation') return 'purple'
    if (status.includes('Acceptance')) return 'gold'
    return 'default'
}

const chartColorForStatus = (status: StandardStatus) => {
    if (status === 'Completed') return semanticPalette.completed
    if (status === 'Declined') return semanticPalette.declined
    if (status === 'In Progress') return semanticPalette.progress
    if (status === 'Awaiting Completion Confirmation') return semanticPalette.confirmation
    if (status.includes('Acceptance')) return semanticPalette.awaiting
    return semanticPalette.assigned
}

const insightTextType = (severity: MonitoringInsight['severity']) => {
    if (severity === 'danger') return 'danger'
    if (severity === 'warning') return 'warning'
    if (severity === 'success') return 'success'
    return undefined
}

const STANDARD_STATUS_OPTIONS: Array<{ value: StandardStatusFilter; label: string }> = [
    { value: 'all', get label() { return tr('All statuses') } },
    { value: 'Assigned', get label() { return tr('Assigned') } },
    { value: 'Awaiting Assignee Acceptance', get label() { return tr('Awaiting assignee acceptance') } },
    { value: 'Awaiting SME Acceptance', get label() { return tr('Awaiting SME acceptance') } },
    { value: 'In Progress', get label() { return tr('In Progress') } },
    { value: 'Awaiting Completion Confirmation', get label() { return tr('Awaiting completion confirmation') } },
    { value: 'Completed', get label() { return tr('Completed') } },
    { value: 'Declined', get label() { return tr('Declined') } },
]

const dueLabel = (date: Date | null) => date ? dayjs(date).format('DD MMM YYYY') : 'No due date'

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const firstText = (...values: unknown[]) => {
    for (const value of values) {
        const text = String(value ?? '').trim()
        if (text) return text
    }
    return ''
}

export const InterventionsMonitoringPage = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { assignments, loading, refresh } = useAssignedInterventions()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { user } = useFullIdentity()
    const [view, setView] = useState<AssignmentKind>('all')
    const [health, setHealth] = useState<HealthFilter>('all')
    const [delivery, setDelivery] = useState<DeliveryFilter>('all')
    const [status, setStatus] = useState<StandardStatusFilter>('all')
    const [section, setSection] = useState<MonitorSection>('overview')
    const [programme, setProgramme] = useState('All')
    const [search, setSearch] = useState('')
    const [selected, setSelected] = useState<MonitorRow>()
    const [selectedGroup, setSelectedGroup] = useState<GroupRow>()
    const [remindingId, setRemindingId] = useState<string>()
    const [aiLoading, setAiLoading] = useState(false)
    const [aiResult, setAiResult] = useState<InterventionMonitoringInsights>()
    const [aiMeta, setAiMeta] = useState<{ model?: string; generatedAt?: string; fallback?: boolean }>({})
    const [participants, setParticipants] = useState<Participant[]>([])
    const [applications, setApplications] = useState<InterventionAssignmentApplicationLookup[]>([])
    const [agentRatings, setAgentRatings] = useState<Array<{ assignmentId: string; interventionTitle: string; programId: string; rating: number }>>([])
    const [reviewSaving, setReviewSaving] = useState(false)

    useEffect(() => {
        let cancelled = false

        const loadLookups = async () => {
            if (!user?.companyCode) {
                setParticipants([])
                setApplications([])
                setAgentRatings([])
                return
            }

            try {
                const [participantRows, applicationRows, ratingsSnapshot] = await Promise.all([
                    getParticipants(),
                    listInterventionAssignmentApplications(user.companyCode),
                    getDocs(query(collection(db, 'agentConversationRatings'), where('companyCode', '==', user.companyCode))),
                ])
                if (cancelled) return
                setParticipants(participantRows.filter((row) => !row.companyCode || row.companyCode === user.companyCode))
                setApplications(applicationRows)
                setAgentRatings(ratingsSnapshot.docs.flatMap((record) => {
                    const data = record.data()
                    const rating = Number(data.rating)
                    if (!Number.isFinite(rating) || !data.interventionTitle) return []
                    return [{ assignmentId: String(data.assignmentId || ''), interventionTitle: String(data.interventionTitle), programId: String(data.programId || ''), rating }]
                }))
            } catch {
                if (!cancelled) {
                    setParticipants([])
                    setApplications([])
                    setAgentRatings([])
                }
            }
        }

        void loadLookups()

        return () => {
            cancelled = true
        }
    }, [user?.companyCode])

    const participantMap = useMemo(() => {
        const map = new Map<string, Participant>()
        participants.forEach((participant) => {
            map.set(participant.id, participant)
            if (participant.uid) map.set(participant.uid, participant)
            if (participant.email) map.set(normalize(participant.email), participant)
        })
        return map
    }, [participants])

    const applicationByParticipant = useMemo(() => {
        const map = new Map<string, InterventionAssignmentApplicationLookup>()
        applications.forEach((application) => {
            if (application.participantId) map.set(application.participantId, application)
            if (application.email) map.set(normalize(application.email), application)
        })
        return map
    }, [applications])

    const applicationById = useMemo(() => new Map(applications.map((application) => [application.id, application])), [applications])

    const monitorRows = useMemo<MonitorRow[]>(() => {
        return assignments
            .map((assignment) => {
                const assignmentRecord = assignment as Record<string, unknown>
                const participantId = String(assignment.participantId || '')
                const assignmentEmail = firstText(assignmentRecord.participantEmail, assignmentRecord.email)
                const participant = participantMap.get(participantId) || participantMap.get(normalize(assignmentEmail))
                const application = applicationByParticipant.get(participantId)
                    || applicationByParticipant.get(normalize(assignmentEmail))
                    || applicationById.get(String(assignmentRecord.applicationId || ''))
                const progress = clampProgress(assignment.progress)
                const isCompleted = deriveCompleted(assignment, progress)
                const standardStatus = deriveStandardStatus(assignment, progress)
                const dueDate = toDate(assignment.dueDate)
                const isOverdue = !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day') && !isCompleted
                const { holdUp, reason } = deriveHoldUp(assignment, progress, isCompleted)
                const hasHoldUp = !isCompleted && (holdUp !== 'In delivery' || progress === 0)
                const healthValue: MonitorRow['health'] = isCompleted ? 'completed' : isOverdue ? 'overdue' : hasHoldUp ? 'held_up' : 'on_track'

                const kind: MonitorRow['kind'] = isGroupedAssignment(assignment) ? 'grouped' : 'single'
                const matchingRatings = agentRatings.filter((rating) => rating.assignmentId === assignment.id || (!rating.assignmentId && rating.interventionTitle === assignment.interventionTitle && rating.programId === assignment.programId))

                return {
                    id: assignment.id,
                    title: String(assignment.interventionTitle || 'Intervention'),
                    participantName: firstText(
                        assignment.businessName,
                        assignmentRecord.participantName,
                        assignmentRecord.smeName,
                        assignmentRecord.smmeName,
                        assignmentRecord.companyName,
                        participant?.businessName,
                        participant?.name,
                        participant?.displayName,
                        participant?.participantName,
                        application?.businessName,
                        application?.participantName,
                        'Unassigned SME',
                    ),
                    participantEmail: firstText(assignmentRecord.participantEmail, assignmentRecord.email, participant?.email, application?.email),
                    programName: firstText(assignment.programName, application?.programName),
                    programId: firstText(assignment.programId, application?.programId),
                    assigneeName: String(assignment.assigneeName || 'Unassigned'),
                    assigneeEmail: String(assignment.assigneeEmail || ''),
                    deliveryActorType: assignment.deliveryActorType === 'human' || assignment.deliveryActorType === 'agent' ? assignment.deliveryActorType : null,
                    deliveryStrategy: String(assignmentRecord.deliveryStrategy || ''),
                    agentName: String(assignmentRecord.agentName || ''),
                    agentWorkStatus: String(assignmentRecord.agentWorkStatus || ''),
                    reviewStatus: String(assignmentRecord.reviewStatus || ''),
                    reviewerType: String(assignmentRecord.reviewerType || ''),
                    agentRating: matchingRatings.length ? matchingRatings.reduce((total, rating) => total + rating.rating, 0) / matchingRatings.length : null,
                    agentRatingCount: matchingRatings.length,
                    kind,
                    status: standardStatus,
                    rawStatus: String(assignment.status || 'assigned'),
                    progress,
                    implementationDate: toDate(assignmentRecord.implementationDate),
                    dueDate,
                    assignedAt: toDate(assignment.assignedAt || assignment.createdAt),
                    isCompleted,
                    isOverdue,
                    health: healthValue,
                    holdUp,
                    reason: isOverdue ? `Overdue since ${dueLabel(dueDate)}. ${reason}` : reason,
                    raw: assignment,
                }
            })
            .filter((row) => matchesActiveProgram(user, activeProgramId, row.programId))
    }, [activeProgramId, agentRatings, applicationById, applicationByParticipant, assignments, participantMap, user])

    const programmes = useMemo(() => ['All', ...Array.from(new Set(monitorRows.map((row) => row.programName).filter(Boolean))).sort()], [monitorRows])

    const filteredRows = useMemo(() => {
        const needle = normalize(search)
        return monitorRows.filter((row) => {
            const matchesSearch = !needle || normalize(`${row.title} ${row.participantName} ${row.assigneeName} ${row.reason}`).includes(needle)
            const matchesKind = view === 'all' || row.kind === view
            const matchesHealth = health === 'all' || row.health === health
            const matchesDelivery = delivery === 'all' || (delivery === 'unmarked' ? !row.deliveryActorType : row.deliveryActorType === delivery)
            const matchesStatus = status === 'all' || row.status === status
            const matchesProgramme = !isAllPrograms || programme === 'All' || row.programName === programme
            return matchesSearch && matchesKind && matchesHealth && matchesDelivery && matchesStatus && matchesProgramme
        })
    }, [delivery, health, isAllPrograms, monitorRows, programme, search, status, view])

    const groupedRows = useMemo<GroupRow[]>(() => {
        const groups = new Map<string, MonitorRow[]>()
        filteredRows.filter((row) => row.kind === 'grouped').forEach((row) => {
            const key = String(row.raw.groupId || row.raw.interventionId || row.title)
            groups.set(key, [...(groups.get(key) || []), row])
        })

        return Array.from(groups.entries()).map(([id, rows]) => {
            const overdueCount = rows.filter((row) => row.isOverdue).length
            const heldUpCount = rows.filter((row) => row.health === 'held_up').length
            const completedCount = rows.filter((row) => row.isCompleted).length
            const earliestDueDate = rows
                .map((row) => row.dueDate)
                .filter((date): date is Date => !!date)
                .sort((a, b) => a.getTime() - b.getTime())[0] || null
            const mainReason = overdueCount
                ? `${plural(overdueCount, 'assignment')} overdue`
                : heldUpCount
                    ? `${plural(heldUpCount, 'assignment')} held up`
                    : 'Group is moving'

            return {
                id,
                groupName: String(rows[0]?.raw.groupName || rows[0]?.title || 'Grouped intervention'),
                kind: 'grouped',
                assignments: rows,
                assignedCount: rows.length,
                completedCount,
                overdueCount,
                heldUpCount,
                averageProgress: Math.round(rows.reduce((total, row) => total + row.progress, 0) / Math.max(rows.length, 1)),
                earliestDueDate,
                reason: mainReason,
            }
        })
    }, [filteredRows])

    const metrics = useMemo(() => ({
        assigned: filteredRows.length,
        averageProgress: Math.round(filteredRows.reduce((total, row) => total + row.progress, 0) / Math.max(filteredRows.length, 1)),
        heldUp: filteredRows.filter((row) => row.health === 'held_up').length,
        overdue: filteredRows.filter((row) => row.isOverdue).length,
        human: filteredRows.filter((row) => row.deliveryActorType === 'human').length,
        agent: filteredRows.filter((row) => row.deliveryActorType === 'agent').length,
    }), [filteredRows])

    const holdUpCounts = useMemo(() => {
        const map = new Map<string, number>()
        filteredRows.filter((row) => row.health === 'held_up' || row.health === 'overdue').forEach((row) => {
            map.set(row.holdUp, (map.get(row.holdUp) || 0) + 1)
        })
        return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
    }, [filteredRows])

    const statusChartOptions = useMemo<Highcharts.Options>(() => {
        const counts = STANDARD_STATUS_OPTIONS
            .filter((option): option is { value: StandardStatus; label: string } => option.value !== 'all')
            .map((option) => ({
                name: option.value,
                y: filteredRows.filter((row) => row.status === option.value).length,
                color: chartColorForStatus(option.value),
            }))
            .filter((item) => item.y > 0)

        return {
            chart: { type: 'pie', height: 280 },
            title: { text: tr('Status mix') },
            tooltip: { pointFormat: '<b>{point.y}</b> assignments' },
            plotOptions: { pie: { innerSize: '58%', dataLabels: { enabled: true, format: '{point.name}: {point.y}' } } },
            series: [{ type: 'pie', name: tr('Assignments'), data: counts.length ? counts : [{ name: 'No data', y: 1, color: semanticPalette.assigned }] }],
        }
    }, [filteredRows])

    const holdUpChartOptions = useMemo<Highcharts.Options>(() => ({
        chart: { type: 'column', height: 280 },
        title: { text: tr('Hold-up reasons') },
        xAxis: { categories: holdUpCounts.map(([name]) => name) },
        yAxis: { title: { text: tr('Assignments') }, allowDecimals: false },
        tooltip: { pointFormat: '<b>{point.y}</b> assignments' },
        series: [{ type: 'column', name: tr('Held up / overdue'), color: semanticPalette.heldUp, data: holdUpCounts.map(([, count]) => count) }],
    }), [holdUpCounts])

    const progressChartOptions = useMemo<Highcharts.Options>(() => {
        const buckets = [
            { name: '0%', min: 0, max: 0 },
            { name: '1-49%', min: 1, max: 49 },
            { name: '50-99%', min: 50, max: 99 },
            { name: '100%', min: 100, max: 100 },
        ]

        return {
            chart: { type: 'bar', height: 260 },
            title: { text: tr('Progress spread') },
            xAxis: { categories: buckets.map((bucket) => bucket.name) },
            yAxis: { title: { text: tr('Assignments') }, allowDecimals: false },
            series: [{
                type: 'bar',
                name: tr('Assignments'),
                data: buckets.map((bucket) => ({
                    y: filteredRows.filter((row) => row.progress >= bucket.min && row.progress <= bucket.max).length,
                    color: bucket.name === '100%' ? semanticPalette.completed : bucket.name === '0%' ? semanticPalette.assigned : bucket.name === '50-99%' ? semanticPalette.progress : semanticPalette.awaiting,
                })),
            }],
        }
    }, [filteredRows])

    const aiInsights = useMemo(() => {
        const insights: Array<{ title: string; body: string; tone: 'danger' | 'warning' | 'info' | 'success' }> = []
        const topHoldUp = holdUpCounts[0]
        const overdueRows = filteredRows.filter((row) => row.isOverdue)
        const groupedAtRisk = groupedRows.filter((row) => row.overdueCount > 0 || row.heldUpCount > 0)
        const awaitingSme = filteredRows.filter((row) => row.status === 'Awaiting SME Acceptance' || row.status === 'Awaiting Completion Confirmation')

        if (overdueRows.length) {
            const oldest = [...overdueRows].sort((a, b) => (a.dueDate?.getTime() || 0) - (b.dueDate?.getTime() || 0))[0]
            insights.push({
                title: t('Overdue pressure is the first priority'),
                body: `${plural(overdueRows.length, 'assignment')} overdue. Oldest item is ${oldest.title} for ${oldest.participantName}, due ${dueLabel(oldest.dueDate)}.`,
                tone: 'danger',
            })
        }

        if (topHoldUp) {
            insights.push({
                title: `${topHoldUp[0]} is the main bottleneck`,
                body: `${plural(topHoldUp[1], 'assignment')} currently sit here. Use reminders on those rows before chasing broader progress updates.`,
                tone: 'warning',
            })
        }

        if (groupedAtRisk.length) {
            insights.push({
                title: t('Grouped interventions need coordination'),
                body: `${plural(groupedAtRisk.length, 'group')} have overdue or held-up assignments. Drill into grouped view to identify the specific SMEs blocking group completion.`,
                tone: 'info',
            })
        }

        if (awaitingSme.length) {
            insights.push({
                title: t('SME action is gating delivery'),
                body: `${plural(awaitingSme.length, 'assignment')} need SME acceptance or completion confirmation. Prioritize reminders to incubatees for these.`,
                tone: 'warning',
            })
        }

        if (!insights.length) {
            insights.push({
                title: t('Delivery looks stable'),
                body: 'No overdue or held-up interventions match the current filters. Keep monitoring progress drift and upcoming due dates.',
                tone: 'success',
            })
        }

        return insights.slice(0, 4)
    }, [filteredRows, groupedRows, holdUpCounts, t])

    const progressBuckets = useMemo(() => [
        { label: '0%', count: filteredRows.filter((row) => row.progress === 0).length },
        { label: '1-49%', count: filteredRows.filter((row) => row.progress >= 1 && row.progress <= 49).length },
        { label: '50-99%', count: filteredRows.filter((row) => row.progress >= 50 && row.progress <= 99).length },
        { label: '100%', count: filteredRows.filter((row) => row.progress === 100).length },
    ], [filteredRows])

    const aiPayload = useMemo(() => ({
        companyName: user?.companyCode || null,
        filters: { search, view, health, status, section, delivery, programme: isAllPrograms ? programme : activeProgramId },
        metrics,
        statusBreakdown: STANDARD_STATUS_OPTIONS
            .filter((option) => option.value !== 'all')
            .map((option) => ({ status: option.value, count: filteredRows.filter((row) => row.status === option.value).length })),
        holdUps: holdUpCounts.map(([reason, count]) => ({ reason, count })),
        progressBuckets,
        overdue: filteredRows
            .filter((row) => row.isOverdue)
            .slice(0, 15)
            .map((row) => ({
                intervention: row.title,
                participant: row.participantName,
                assignee: row.assigneeName,
                dueDate: row.dueDate ? dayjs(row.dueDate).format('YYYY-MM-DD') : null,
                reason: row.reason,
            })),
        groupedRisks: groupedRows
            .filter((row) => row.overdueCount > 0 || row.heldUpCount > 0)
            .slice(0, 12)
            .map((row) => ({
                group: row.groupName,
                assigned: row.assignedCount,
                averageProgress: row.averageProgress,
                overdue: row.overdueCount,
                heldUp: row.heldUpCount,
                reason: row.reason,
            })),
        sampleAssignments: filteredRows.slice(0, 20).map((row) => ({
            intervention: row.title,
            participant: row.participantName,
            assignee: row.assigneeName,
            type: row.kind,
            status: row.status,
            progress: row.progress,
            dueDate: row.dueDate ? dayjs(row.dueDate).format('YYYY-MM-DD') : null,
            holdUp: row.holdUp,
            reason: row.reason,
        })),
    }), [activeProgramId, delivery, filteredRows, groupedRows, health, holdUpCounts, isAllPrograms, metrics, programme, progressBuckets, search, section, status, user?.companyCode, view])

    const refreshAiInsights = async (showSuccess = true) => {
        try {
            setAiLoading(true)
            const response = await generateInterventionMonitoringInsights(aiPayload)
            setAiResult(response.insights)
            setAiMeta({ model: response.model, generatedAt: response.generatedAt })
            if (showSuccess) message.success(t('AI insights refreshed.'))
        } catch {
            setAiResult({
                summary: t('Operational signals from the current monitoring data.'),
                insights: aiInsights.map((insight) => ({
                    title: insight.title,
                    body: insight.body,
                    severity: insight.tone === 'danger' ? 'danger' : insight.tone === 'warning' ? 'warning' : insight.tone === 'success' ? 'success' : 'info',
                })),
                recommendedActions: [],
                riskLevel: metrics.overdue > 0 ? 'high' : metrics.heldUp > 0 ? 'medium' : 'low',
                focusAreas: holdUpCounts.slice(0, 3).map(([reason]) => reason),
            })
            setAiMeta({ fallback: true })
            if (showSuccess) message.warning(t('AI backend unavailable. Showing local insights.'))
        } finally {
            setAiLoading(false)
        }
    }

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshAiInsights(false)
        }, 600)

        return () => window.clearTimeout(timer)
    }, [aiPayload]) // eslint-disable-line react-hooks/exhaustive-deps

    const reminderRoleFor = (row: MonitorRow): 'consultant' | 'incubatee' | 'operations' => {
        if (row.holdUp.includes('SME')) return 'incubatee'
        if (row.holdUp.includes('Assignee') || row.holdUp === 'In delivery' || row.holdUp === 'Not started') return 'consultant'
        return 'operations'
    }

    const sendReminder = async (row: MonitorRow) => {
        try {
            setRemindingId(row.id)
            await createInterventionReminder(user, {
                assignment: row.raw,
                recipientRole: reminderRoleFor(row),
                reason: row.reason,
            })
            message.success(t('Reminder created.'))
        } catch {
            message.error(t('Reminder could not be created.'))
        } finally {
            setRemindingId(undefined)
        }
    }

    const remindGroup = async (group: GroupRow) => {
        const targets = group.assignments.filter((row) => row.health === 'held_up' || row.health === 'overdue')
        if (!targets.length) {
            message.info(t('This group has no held-up or overdue assignments to remind.'))
            return
        }

        try {
            setRemindingId(group.id)
            await Promise.all(targets.map((row) => createInterventionReminder(user, {
                assignment: row.raw,
                recipientRole: reminderRoleFor(row),
                reason: row.reason,
            })))
            message.success(`${plural(targets.length, 'reminder')} created.`)
        } catch {
            message.error(t('Group reminders could not be created.'))
        } finally {
            setRemindingId(undefined)
        }
    }

    useRegisterAgentPageContext({
        pageKey: 'operations-interventions-monitoring',
        pageName: 'Interventions monitoring',
        purpose: 'Monitor assigned interventions, progress, grouped delivery, overdue work, and hold-up reasons.',
        filters: { search, view, health, status, delivery, programme: isAllPrograms ? programme : activeProgramId },
        metrics,
        tables: { assignments: filteredRows.length, groups: groupedRows.length },
        selectedRecord: selected?.title || selectedGroup?.groupName,
    })

    const reviewAgentWork = async (row: MonitorRow, decision: 'approved' | 'changes_requested') => {
        setReviewSaving(true)
        try {
            const approved = decision === 'approved'
            await Promise.all([
                updateDoc(doc(db, 'assignedInterventions', row.id), {
                    reviewStatus: decision,
                    agentWorkStatus: approved ? 'completed' : 'changes_requested',
                    progress: approved ? 100 : 75,
                    assigneeCompletionStatus: approved ? 'done' : 'in_progress',
                    status: approved ? 'awaiting_confirmation' : 'in-progress',
                    reviewedAt: serverTimestamp(),
                    reviewedByUid: user?.uid || null,
                    reviewedByEmail: user?.email || null,
                    updatedAt: serverTimestamp(),
                }),
                updateDoc(doc(db, 'agentWorkRuns', row.id), {
                    status: approved ? 'completed' : 'changes_requested',
                    reviewStatus: decision,
                    reviewedAt: serverTimestamp(),
                    reviewedByUid: user?.uid || null,
                    reviewedByEmail: user?.email || null,
                    updatedAt: serverTimestamp(),
                }),
            ])
            message.success(approved ? t('Agent work approved.') : t('Agent work returned for changes.'))
            setSelected(undefined)
            await refresh()
        } catch {
            message.error(t('The agent work review could not be saved.'))
        } finally {
            setReviewSaving(false)
        }
    }

    const assignmentColumns: TableProps<MonitorRow>['columns'] = [
        { title: t('Intervention'), dataIndex: 'title', render: (value: string, row) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{row.participantName}</Typography.Text></Space> },
        { title: t('Delivery'), dataIndex: 'deliveryActorType', width: 170, render: (value: MonitorRow['deliveryActorType'], row) => value === 'agent' ? <Space direction="vertical" size={0}><Tag icon={<RobotOutlined />} color="purple">{row.agentName || t('Agent')}</Tag>{row.reviewStatus && <Typography.Text type="secondary">{t('Review:')} {row.reviewStatus}</Typography.Text>}</Space> : value === 'human' ? <Tag icon={<TeamOutlined />} color="blue">{t('Human')}</Tag> : <Tag>{t('Unmarked')}</Tag> },
        { title: t('Rating'), key: 'agentRating', width: 145, render: (_, row) => row.deliveryActorType === 'agent' && row.agentRating ? <Space direction="vertical" size={0}><Rate disabled allowHalf value={row.agentRating} style={{ fontSize: 14 }} /><Typography.Text type="secondary">{row.agentRating.toFixed(1)} · {plural(row.agentRatingCount, 'rating')}</Typography.Text></Space> : <Typography.Text type="secondary">—</Typography.Text> },
        { title: t('Type'), dataIndex: 'kind', render: (value: MonitorRow['kind']) => <Tag color={value === 'grouped' ? 'purple' : 'default'}>{value === 'grouped' ? t('Grouped') : t('Single')}</Tag> },
        { title: t('Status'), dataIndex: 'status', render: (value: StandardStatus) => <Tag color={statusColor(value)}>{value}</Tag> },
        { title: t('Progress'), dataIndex: 'progress', render: (value: number) => <Progress percent={value} size="small" /> },
        { title: t('Hold-up'), dataIndex: 'holdUp', render: (value: string, row) => <Space direction="vertical" size={0}><Tag color={healthColor(row.health)}>{value}</Tag><Typography.Text type="secondary">{row.reason}</Typography.Text></Space> },
        { title: t('Due'), dataIndex: 'dueDate', render: (value: Date | null, row) => <Tag color={row.isOverdue ? 'red' : 'default'}>{dueLabel(value)}</Tag> },
        { title: t('Actions'), render: (_, row) => <Space><Button icon={<BellOutlined />} loading={remindingId === row.id} disabled={row.isCompleted} onClick={() => void sendReminder(row)}>{t('Remind')}</Button><Button icon={<EyeOutlined />} onClick={() => setSelected(row)}>{t('Drill down')}</Button></Space> },
    ]

    const groupColumns: TableProps<GroupRow>['columns'] = [
        { title: t('Group'), dataIndex: 'groupName', render: (value: string, row) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{plural(row.assignedCount, 'assignment')}</Typography.Text></Space> },
        { title: t('Progress'), dataIndex: 'averageProgress', render: (value: number) => <Progress percent={value} size="small" /> },
        { title: t('Completed'), dataIndex: 'completedCount' },
        { title: t('Held up'), dataIndex: 'heldUpCount', render: (value: number) => <Tag color={value ? 'orange' : 'green'}>{value}</Tag> },
        { title: t('Overdue'), dataIndex: 'overdueCount', render: (value: number) => <Tag color={value ? 'red' : 'green'}>{value}</Tag> },
        { title: t('Reason'), dataIndex: 'reason' },
        { title: t('Actions'), render: (_, row) => <Space><Button icon={<BellOutlined />} loading={remindingId === row.id} onClick={() => void remindGroup(row)}>{t('Remind blockers')}</Button><Button icon={<EyeOutlined />} onClick={() => setSelectedGroup(row)}>{t('Drill down')}</Button></Space> },
    ]

    const rowsToShow = view === 'grouped' ? groupedRows : filteredRows

    return (
        <DashboardPage className="operations-interventions-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={4}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Assigned')} value={metrics.assigned} /></Col>
                <Col xs={12} lg={4}><DashboardMetricCard loading={loading} icon={<BarChartOutlined />} label={t('Avg progress')} value={`${metrics.averageProgress}%`} /></Col>
                <Col xs={12} lg={4}><DashboardMetricCard loading={loading} icon={<FieldTimeOutlined />} label={t('Held up')} value={metrics.heldUp} /></Col>
                <Col xs={12} lg={4}><DashboardMetricCard loading={loading} icon={<AlertOutlined />} label={t('Overdue')} value={metrics.overdue} /></Col>
                <Col xs={12} lg={4}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Human delivery')} value={metrics.human} /></Col>
                <Col xs={12} lg={4}><DashboardMetricCard loading={loading} icon={<RobotOutlined />} label={t('Agent delivery')} value={metrics.agent} /></Col>
            </Row>

            <FilterBar
                title={t('Interventions monitoring')}
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search intervention, SME, assignee, or reason')} allowClear />
                        {isAllPrograms && <Select value={programme} onChange={setProgramme} options={programmes.map((value) => ({ value, label: value }))} />}
                        <Select value={status} onChange={setStatus} options={STANDARD_STATUS_OPTIONS} />
                        <Select value={health} onChange={setHealth} options={[
                            { value: 'all', label: t('All health') },
                            { value: 'on_track', label: t('On track') },
                            { value: 'held_up', label: t('Held up') },
                            { value: 'overdue', label: t('Overdue') },
                            { value: 'completed', label: t('Completed') },
                        ]} />
                        <Select value={delivery} onChange={setDelivery} options={[
                            { value: 'all', label: t('All delivery') },
                            { value: 'human', label: t('Human delivery') },
                            { value: 'agent', label: t('Agent delivery') },
                            { value: 'unmarked', label: t('Unmarked delivery') },
                        ]} />
                    </>
                )}
                actions={(
                    <>
                        <Segmented value={view} onChange={(value) => setView(value as AssignmentKind)} options={[
                            { value: 'all', label: t('All') },
                            { value: 'single', label: t('Single') },
                            { value: 'grouped', label: t('Grouped') },
                        ]} />
                        <Button icon={<ReloadOutlined />} onClick={() => { void refresh(); message.success(t('Monitoring refreshed.')) }}>{t('Refresh')}</Button>
                    </>
                )}
            />

            <Card style={{ marginBottom: 12 }}>
                <Segmented
                    block
                    value={section}
                    onChange={(value) => setSection(value as MonitorSection)}
                    options={[
                        { value: 'overview', label: t('Overview') },
                        { value: 'insights', label: t('AI insights') },
                        { value: 'assignments', label: view === 'grouped' ? t('Groups') : t('Assignments') },
                    ]}
                />
            </Card>

            {section === 'overview' && (
                <Row gutter={[12, 12]}>
                    <Col xs={24} xl={12}>
                        <Card>
                            <ThemedHighcharts options={statusChartOptions} />
                        </Card>
                    </Col>
                    <Col xs={24} xl={12}>
                        <Card>
                            <ThemedHighcharts options={holdUpChartOptions} />
                        </Card>
                    </Col>
                    <Col span={24}>
                        <Card>
                            <ThemedHighcharts options={progressChartOptions} />
                        </Card>
                    </Col>
                </Row>
            )}

            {section === 'insights' && (
                <Row gutter={[12, 12]}>
                    <Col xs={24} xl={14}>
                        <Card
                            title={<Space><RobotOutlined />{t('AI insights')}</Space>}
                            extra={<Button size="small" icon={<ReloadOutlined />} loading={aiLoading} onClick={() => void refreshAiInsights()}>{t('Refresh AI')}</Button>}
                        >
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {aiResult?.summary && (
                                    <Typography.Paragraph style={{ marginBottom: 0 }}>
                                        {aiResult.summary}
                                    </Typography.Paragraph>
                                )}
                                <Space wrap>
                                    {aiResult?.riskLevel && <Tag color={aiResult.riskLevel === 'critical' || aiResult.riskLevel === 'high' ? 'red' : aiResult.riskLevel === 'medium' ? 'orange' : 'green'}>{aiResult.riskLevel.toUpperCase()} {t('risk')}</Tag>}
                                    {aiMeta.model && <Tag color="blue">{aiMeta.model}</Tag>}
                                    {aiMeta.fallback && <Tag>{t('Local fallback')}</Tag>}
                                    {aiMeta.generatedAt && <Typography.Text type="secondary">{dayjs(aiMeta.generatedAt).format('DD MMM HH:mm')}</Typography.Text>}
                                </Space>
                                {(aiResult?.insights || []).map((insight) => (
                                    <Card key={insight.title} size="small">
                                        <Space align="start">
                                            <BulbOutlined />
                                            <Space direction="vertical" size={2}>
                                                <Typography.Text strong type={insightTextType(insight.severity)}>{insight.title}</Typography.Text>
                                                <Typography.Text type="secondary">{insight.body}</Typography.Text>
                                            </Space>
                                        </Space>
                                    </Card>
                                ))}
                            </Space>
                        </Card>
                    </Col>
                    <Col xs={24} xl={10}>
                        <Card title={t('Recommended actions')}>
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {aiResult?.recommendedActions?.length ? aiResult.recommendedActions.slice(0, 6).map((action) => (
                                    <Card key={`${action.action}-${action.owner}`} size="small">
                                        <Space direction="vertical" size={2}>
                                            <Typography.Text strong>{action.action}</Typography.Text>
                                            <Typography.Text type="secondary">{action.owner} - {action.priority} - {action.due}</Typography.Text>
                                            <Typography.Text>{action.reason}</Typography.Text>
                                        </Space>
                                    </Card>
                                )) : <Typography.Text type="secondary">{t('Refresh AI insights to generate recommended actions.')}</Typography.Text>}
                                {aiResult?.focusAreas?.length ? (
                                    <Space wrap>
                                        {aiResult.focusAreas.map((area) => <Tag key={area}>{area}</Tag>)}
                                    </Space>
                                ) : null}
                            </Space>
                        </Card>
                    </Col>
                </Row>
            )}

            {section === 'assignments' && (
                <Card>
                    {view === 'grouped' ? (
                        <ResponsiveDataView
                            rowKey="id"
                            rows={rowsToShow as GroupRow[]}
                            columns={groupColumns}
                            loading={loading}
                            emptyText={t('No grouped interventions match the selected filters.')}
                            renderCard={(row) => <Space direction="vertical" size={8}><Typography.Text strong>{row.groupName}</Typography.Text><Progress percent={row.averageProgress} /><Space wrap><Tag>{plural(row.assignedCount, 'assignment')}</Tag><Tag color="orange">{row.heldUpCount} {t('held up')}</Tag><Tag color="red">{row.overdueCount} {t('overdue')}</Tag></Space><Space><Button icon={<BellOutlined />} loading={remindingId === row.id} onClick={() => void remindGroup(row)}>{t('Remind blockers')}</Button><Button onClick={() => setSelectedGroup(row)}>{t('Drill down')}</Button></Space></Space>}
                        />
                    ) : (
                        <ResponsiveDataView
                            rowKey="id"
                            rows={rowsToShow as MonitorRow[]}
                            columns={assignmentColumns}
                            loading={loading}
                            emptyText={t('No assigned interventions match the selected filters.')}
                            renderCard={(row) => <Space direction="vertical" size={8}><Typography.Text strong>{row.title}</Typography.Text><Typography.Text type="secondary">{row.participantName}</Typography.Text><Progress percent={row.progress} /><Space wrap>{row.deliveryActorType === 'agent' ? <Tag icon={<RobotOutlined />} color="purple">{t('Agent')}</Tag> : row.deliveryActorType === 'human' ? <Tag icon={<TeamOutlined />} color="blue">{t('Human')}</Tag> : <Tag>{t('Unmarked')}</Tag>}<Tag color={row.kind === 'grouped' ? 'purple' : 'default'}>{row.kind === 'grouped' ? t('Grouped') : t('Single')}</Tag><Tag color={statusColor(row.status)}>{row.status}</Tag><Tag color={healthColor(row.health)}>{row.holdUp}</Tag>{row.isOverdue && <Tag color="red">{t('Overdue')}</Tag>}</Space><Space><Button icon={<BellOutlined />} loading={remindingId === row.id} disabled={row.isCompleted} onClick={() => void sendReminder(row)}>{t('Remind')}</Button><Button onClick={() => setSelected(row)}>{t('Drill down')}</Button></Space></Space>}
                        />
                    )}
                </Card>
            )}

            <Modal open={!!selected} title={selected?.title} onCancel={() => setSelected(undefined)} footer={null} width={820}>
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={[
                            { key: 'sme', label: t('SME'), children: selected.participantName },
                            { key: 'email', label: t('SME email'), children: selected.participantEmail || 'No email' },
                            { key: 'assignee', label: t('Assignee'), children: selected.assigneeName },
                            { key: 'assigneeEmail', label: t('Assignee email'), children: selected.assigneeEmail || 'No email' },
                            { key: 'delivery', label: t('Delivery'), children: selected.deliveryActorType === 'agent' ? <Tag icon={<RobotOutlined />} color="purple">{t('Agent')}</Tag> : selected.deliveryActorType === 'human' ? <Tag icon={<TeamOutlined />} color="blue">{t('Human')}</Tag> : <Tag>{t('Unmarked')}</Tag> },
                            { key: 'agent', label: t('Agent workspace'), children: selected.deliveryActorType === 'agent' ? `${selected.agentName || 'Agent'} · ${selected.agentWorkStatus || 'ready'}` : 'Not applicable' },
                            { key: 'review', label: t('Review layer'), children: selected.deliveryActorType === 'agent' && selected.reviewerType ? `${selected.reviewerType} · ${selected.reviewStatus || 'not started'}` : 'No review required' },
                            { key: 'rating', label: t('Agent rating'), children: selected.agentRating ? <Space><Rate disabled allowHalf value={selected.agentRating} /><Typography.Text>{selected.agentRating.toFixed(1)} {t('from')} {plural(selected.agentRatingCount, 'rating')}</Typography.Text></Space> : 'No ratings yet' },
                            { key: 'type', label: t('Type'), children: <Tag color={selected.kind === 'grouped' ? 'purple' : 'default'}>{selected.kind === 'grouped' ? t('Grouped') : t('Single')}</Tag> },
                            { key: 'status', label: t('Status'), children: <Tag color={statusColor(selected.status)}>{selected.status}</Tag> },
                            { key: 'rawStatus', label: t('Firestore status'), children: selected.rawStatus },
                            { key: 'assigned', label: t('Assigned'), children: selected.assignedAt ? dayjs(selected.assignedAt).format('DD MMM YYYY') : 'No assigned date' },
                            { key: 'implementation', label: t('Implementation'), children: selected.implementationDate ? dayjs(selected.implementationDate).format('DD MMM YYYY') : 'No implementation date' },
                            { key: 'due', label: t('Due'), children: <Tag color={selected.isOverdue ? 'red' : 'default'}>{dueLabel(selected.dueDate)}</Tag> },
                            { key: 'holdUp', label: t('Hold-up'), children: <Tag color={healthColor(selected.health)}>{selected.holdUp}</Tag> },
                            { key: 'reason', label: t('Reason'), span: 2, children: selected.reason },
                        ]} />
                        {selected.deliveryActorType === 'agent' && selected.reviewerType === 'operations' && selected.agentWorkStatus === 'awaiting_review' && (
                            <Card size="small" title={t('Operations review required')}>
                                <Space wrap>
                                    <Button type="primary" loading={reviewSaving} onClick={() => void reviewAgentWork(selected, 'approved')}>{t('Approve agent work')}</Button>
                                    <Button danger loading={reviewSaving} onClick={() => void reviewAgentWork(selected, 'changes_requested')}>{t('Request changes')}</Button>
                                </Space>
                            </Card>
                        )}
                        <InterventionOpsActions
                            assignment={{ id: selected.id, companyCode: selected.raw.companyCode, assigneeId: selected.raw.assigneeId, assigneeName: selected.raw.assigneeName }}
                            title={selected.title}
                            participantName={selected.participantName}
                            isCompleted={selected.isCompleted}
                            onChanged={() => { setSelected(undefined); void refresh() }}
                        />
                        <Progress percent={selected.progress} />
                        <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                            <Button icon={<BellOutlined />} loading={remindingId === selected.id} disabled={selected.isCompleted} onClick={() => void sendReminder(selected)}>{t('Create reminder')}</Button>
                        </Space>
                    </Space>
                )}
            </Modal>

            <Modal open={!!selectedGroup} title={selectedGroup?.groupName} onCancel={() => setSelectedGroup(undefined)} footer={null} width={980}>
                {selectedGroup && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Assigned')} value={selectedGroup.assignedCount} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<BarChartOutlined />} label={t('Avg progress')} value={`${selectedGroup.averageProgress}%`} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<ClockCircleOutlined />} label={t('Held up')} value={selectedGroup.heldUpCount} /></Col>
                            <Col xs={12} md={6}><DashboardMetricCard loading={loading} icon={<AlertOutlined />} label={t('Overdue')} value={selectedGroup.overdueCount} /></Col>
                        </Row>
                        <ResponsiveDataView
                            rowKey="id"
                            rows={selectedGroup.assignments}
                            columns={assignmentColumns}
                            emptyText={t('This group has no assignments.')}
                            renderCard={(row) => <Space direction="vertical" size={8}><Typography.Text strong>{row.participantName}</Typography.Text><Progress percent={row.progress} /><Tag color={healthColor(row.health)}>{row.holdUp}</Tag><Space><Button icon={<BellOutlined />} loading={remindingId === row.id} disabled={row.isCompleted} onClick={() => void sendReminder(row)}>{t('Remind')}</Button><Button onClick={() => setSelected(row)}>{t('Open assignment')}</Button></Space></Space>}
                        />
                    </Space>
                )}
            </Modal>
        </DashboardPage>
    )
}

export default InterventionsMonitoringPage
