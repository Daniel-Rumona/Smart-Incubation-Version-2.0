import { Alert, App, Button, Card, Col, DatePicker, Form, Input, Modal, Progress, Row, Select, Space, Tag, theme, TimePicker, Typography, type TableProps } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DatabaseOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    PhoneOutlined,
    PlusOutlined,
    ReloadOutlined,
    SearchOutlined,
    TeamOutlined,
    ToolOutlined,
    UserSwitchOutlined,
    VideoCameraOutlined,
} from '@ant-design/icons'
import { addDoc, collection, doc, getDocs, query, serverTimestamp, Timestamp, where, writeBatch } from 'firebase/firestore'
import type { Dayjs } from 'dayjs'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { hasRolePermission } from '@/config/permissions'
import { db } from '@/firebase'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { isAgentStrategy } from '@/services/agentOrchestrationService'
import { listActiveAgents } from '@/services/agentRegistryService'
import type { AgentDefinition, InterventionDeliveryStrategy } from '@/types/agentOrchestration'

type RequiredIntervention = {
    interventionId?: string
    title?: string
    areaOfSupport?: string
    area?: string
    executionMode?: 'single_session' | 'multi_step'
    steps?: Array<{ id?: string, title?: string, description?: string, weight?: number }>
    deliveryStrategy?: InterventionDeliveryStrategy
    agentId?: string
    reviewRequired?: boolean
    reviewerType?: 'operations' | 'consultant'
}

/** Put on the diagnostic plan when operations confirms an SME's decline, so it is never reassigned. */
type DeclinedTag = {
    title?: string
    reason?: string
    reasonCode?: string
    workRetained?: boolean
}

type DeclineRequest = {
    status?: string
    reasonCode?: string
    reasonText?: string
    appointmentId?: string
}

type ParticipantRow = {
    id: string
    applicationId: string
    beneficiaryName: string
    email?: string
    programName?: string
    programId?: string
    sector?: string
    declinedInterventions?: Record<string, DeclinedTag>
    requiredInterventions: RequiredIntervention[]
}

type AssigneeRow = {
    id: string
    name: string
    email?: string
    role?: string
}

type AssignmentForm = {
    participantId?: string
    interventionId?: string
    assigneeId?: string
    deliveryMode?: 'human' | 'agent'
    assignedAgentId?: string
    dueDate?: Dayjs
    targetMetric?: string
    targetValue?: number
    appointmentDate?: Dayjs
    appointmentTimeRange?: [Dayjs, Dayjs]
    meetingType?: 'telephonic' | 'online' | 'in_person'
    meetingLink?: string
    location?: string
}

type AssignStep = 'details' | 'appointmentGate' | 'appointment'

type ManageInterventionRow = {
    id: string
    title: string
    area?: string
    deliveryStrategy?: InterventionDeliveryStrategy
    agentId?: string
    reviewRequired?: boolean
    reviewerType?: 'operations' | 'consultant'
    executionMode?: 'single_session' | 'multi_step'
    steps?: Array<{ id?: string, title?: string, description?: string, weight?: number }>
    assigned?: AssignedIntervention
    matchingAssignments?: AssignedIntervention[]
    nextStep?: { id?: string, title?: string, description?: string, weight?: number }
    activeStep?: AssignedIntervention
    declinedTag?: DeclinedTag
    /** An assignment whose SME asked to drop the intervention and is waiting for operations to confirm. */
    declineRequestAssignment?: AssignedIntervention
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
/** Key of an intervention in diagnosticPlans.declinedInterventions (same rule as the ai-backend and WhatsApp router). */
const declinedKey = (id: unknown) => String(id ?? '').trim().replace(/[./]/g, '_')
const declinedTagsOf = (plan: unknown): Record<string, DeclinedTag> => {
    const tags = (plan as { declinedInterventions?: unknown } | undefined)?.declinedInterventions
    return tags && typeof tags === 'object' ? tags as Record<string, DeclinedTag> : {}
}
const declineRequestOf = (assignment?: AssignedIntervention) => (assignment as (AssignedIntervention & { declineRequest?: DeclineRequest }) | undefined)?.declineRequest
const hasRecordedWork = (assignment: AssignedIntervention) => {
    const raw = assignment as AssignedIntervention & { timeSpent?: number, progressSteps?: unknown[] }
    return Number(raw.progress || 0) > 0 || Number(raw.timeSpent || 0) > 0 || (raw.progressSteps?.length || 0) > 0
        || ['completed', 'awaiting_confirmation'].includes(normalize(raw.status))
}
const interventionTitle = (item: RequiredIntervention) => String(item.title || 'Intervention')
const interventionArea = (item: RequiredIntervention) => String(item.areaOfSupport || item.area || '').trim()
const slug = (value: unknown) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const interventionId = (item: RequiredIntervention) => String(item.interventionId || slug(interventionTitle(item))).trim()
const assignmentMatches = (assignment: AssignedIntervention, item: RequiredIntervention) => {
    const assignmentTitle = String((assignment as AssignedIntervention & { interventionTitle?: string }).interventionTitle || '')
    return normalize(assignment.interventionId) === normalize(interventionId(item))
        || (slug(assignmentTitle) && slug(assignmentTitle) === slug(interventionTitle(item)))
}
const assignmentStepComplete = (assignment: AssignedIntervention) => normalize(assignment.participantCompletionStatus) === 'confirmed'
    || normalize(assignment.status) === 'completed'
    || normalize((assignment as AssignedIntervention & { completionStatus?: string }).completionStatus) === 'confirmed'

/**
 * A declined/cancelled assignment shouldn't permanently block reassigning a single-session
 * intervention - only an assignment still actually in play (pending, in progress, or completed)
 * should count as "this SME already has this intervention".
 */
const assignmentIsActive = (assignment: AssignedIntervention) => {
    const status = normalize(assignment.status)
    const assigneeStatus = normalize(assignment.assigneeStatus)
    const participantStatus = normalize(assignment.participantStatus)
    const participantCompletion = normalize(assignment.participantCompletionStatus)
    const isRejected = status === 'cancelled' || assigneeStatus === 'declined' || participantStatus === 'declined' || participantCompletion === 'rejected'
    return !isRejected
}

type ManageStatusFilter = 'All' | 'Assigned' | 'Unassigned' | 'InProgress' | 'Completed'

const rowIsAssigned = (row: ManageInterventionRow) => row.executionMode === 'multi_step'
    ? (row.matchingAssignments?.length || 0) > 0
    : !!row.assigned
const rowIsCompleted = (row: ManageInterventionRow) => row.executionMode === 'multi_step'
    ? (row.matchingAssignments?.length || 0) > 0 && !row.activeStep && !row.nextStep
    : !!row.assigned && assignmentStepComplete(row.assigned)
const rowIsInProgress = (row: ManageInterventionRow) => rowIsAssigned(row) && !rowIsCompleted(row)

const TARGET_METRIC_OPTIONS = [
    { value: 'Hours', label: 'Hours of Support' },
    { value: 'Sessions', label: 'Sessions Completed' },
    { value: 'Evidence Documents', label: 'Evidence / Support Documents' },
    { value: 'Implementation Deliverables', label: 'Implementation Deliverables' },
    { value: 'Progress Reports', label: 'Progress Reports' },
]

const MEETING_TYPE_OPTIONS: Array<{ value: NonNullable<AssignmentForm['meetingType']>; label: string; icon: ReactNode }> = [
    { value: 'in_person', label: 'In-Person', icon: <EnvironmentOutlined /> },
    { value: 'online', label: 'Online', icon: <VideoCameraOutlined /> },
    { value: 'telephonic', label: 'Telephonic', icon: <PhoneOutlined /> },
]

/** A selectable card used both for the meeting-type picker and the appointment yes/no gate. */
const OptionCard = ({ icon, title, description, selected, onClick }: { icon: ReactNode, title: string, description?: string, selected?: boolean, onClick: () => void }) => {
    const { token } = theme.useToken()
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                textAlign: 'center',
                padding: description ? '16px 12px' : '14px 8px',
                borderRadius: 10,
                border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                cursor: 'pointer',
            }}
        >
            <span style={{ fontSize: 22, color: selected ? token.colorPrimary : token.colorTextSecondary }}>{icon}</span>
            <strong>{title}</strong>
            {description && <span style={{ fontSize: 12, color: token.colorTextSecondary, fontWeight: 400 }}>{description}</span>}
        </button>
    )
}

const MeetingTypeField = ({ value, onChange }: { value?: AssignmentForm['meetingType'], onChange?: (value: AssignmentForm['meetingType']) => void }) => (
    <Row gutter={8}>
        {MEETING_TYPE_OPTIONS.map((option) => (
            <Col span={8} key={option.value}>
                <OptionCard icon={option.icon} title={option.label} selected={value === option.value} onClick={() => onChange?.(option.value)} />
            </Col>
        ))}
    </Row>
)

const getRequiredInterventions = (application: Record<string, any>, diagnosticPlan: Record<string, any> = {}): RequiredIntervention[] => {
    const candidates = [
        diagnosticPlan.interventions,
        application.interventions?.required,
        application.growthPlan?.interventions,
        application.growthPlan?.requiredInterventions,
        application.diagnosticPlan?.interventions,
        application.requiredInterventions,
    ]
    const found = candidates.find((value) => Array.isArray(value))
    if (!Array.isArray(found)) return []
    const seen = new Set<string>()
    return found.filter(Boolean).filter((item: RequiredIntervention) => {
        const key = slug(interventionTitle(item)) || normalize(interventionId(item))
        if (!key || seen.has(key)) return false
        seen.add(key)
        return true
    })
}

const isAcceptedGrowthPlan = (application: Record<string, any>, diagnosticPlan: Record<string, any> = {}) => {
    const required = getRequiredInterventions(application, diagnosticPlan)
    const confirmedBy = diagnosticPlan.confirmedBy || application.interventions?.confirmedBy || application.growthPlan?.confirmedBy || {}
    const operationsConfirmed = confirmedBy.operations === true || confirmedBy.ops === true || confirmedBy.projectAdmin === true
        || (confirmedBy.operations && typeof confirmedBy.operations === 'object')
        || diagnosticPlan.confirmed === true
        || normalize(diagnosticPlan.status) === 'confirmed'
    return normalize(application.applicationStatus) === 'accepted'
        && required.length > 0
        && operationsConfirmed
}

export const InterventionsAssignemnts = () => {
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const { assignments, loading: assignmentsLoading, refresh } = useAssignedInterventions()
    const { consultantLabel, getSetting } = useSystemSettings()
    const interventionDeliveryRoles = getSetting<string[]>('interventionDeliveryRoles', ['consultant', 'projectadmin', 'operations'])
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const location = useLocation()
    const navigate = useNavigate()
    const [form] = Form.useForm<AssignmentForm>()
    const meetingType = Form.useWatch('meetingType', form)
    const targetMetric = Form.useWatch('targetMetric', form)
    const deliveryMode = Form.useWatch('deliveryMode', form)
    const assigneeIdWatch = Form.useWatch('assigneeId', form)
    const [participants, setParticipants] = useState<ParticipantRow[]>([])
    const [assignees, setAssignees] = useState<AssigneeRow[]>([])
    const [agents, setAgents] = useState<AgentDefinition[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState('')
    const [programme, setProgramme] = useState('All')
    const [selected, setSelected] = useState<ParticipantRow>()
    const [manageFilter, setManageFilter] = useState<ManageStatusFilter>('All')
    const [assignmentTarget, setAssignmentTarget] = useState<ManageInterventionRow>()
    const [assignmentOpen, setAssignmentOpen] = useState(false)
    const [assignStep, setAssignStep] = useState<AssignStep>('details')
    const [emptyReason, setEmptyReason] = useState('No SMEs have confirmed interventions matching the selected filters.')
    const canAssign = !!user && hasRolePermission(user.role, 'assign_interventions', user.permissions)
    const consultantSingular = consultantLabel.endsWith('s') ? consultantLabel.slice(0, -1) : consultantLabel
    const selfAssignee = useMemo<AssigneeRow | null>(() => {
        if (!user || !canAssign) return null
        return {
            id: user.uid,
            name: String((user as any).displayName || (user as any).name || (user as any).fullName || user.email || 'Me'),
            email: user.email,
            role: user.role,
        }
    }, [canAssign, user])
    const isSelfAssign = !!user && !!assigneeIdWatch && assigneeIdWatch === user.uid
    const assigneeRoleLabel = (role?: string) => {
        const normalizedRole = normalize(role)
        if (normalizedRole === 'operations') return 'Operations'
        if (normalizedRole === 'projectadmin' || normalizedRole === 'project_admin') return 'Project Admin'
        if (normalizedRole === 'consultant') return consultantSingular || 'Consultant'
        return role || 'Delivery owner'
    }

    const loadParticipants = async () => {
        if (!user?.companyCode) return
        try {
            setLoading(true)
            const [applicationsSnapshot, participantsSnapshot, diagnosticPlansSnapshot, assigneesSnapshot, usersSnapshot, interventionsSnapshot] = await Promise.all([
                getDocs(query(collection(db, 'applications'), where('companyCode', '==', user.companyCode))),
                getDocs(collection(db, 'participants')),
                getDocs(query(collection(db, 'diagnosticPlans'), where('companyCode', '==', user.companyCode))),
                getDocs(query(collection(db, 'assignees'), where('companyCode', '==', user.companyCode))),
                getDocs(query(collection(db, 'users'), where('companyCode', '==', user.companyCode))),
                getDocs(query(collection(db, 'interventions'), where('companyCode', '==', user.companyCode))),
            ])
            const participantMap = new Map(participantsSnapshot.docs.map((docRef) => [docRef.id, docRef.data() as Record<string, any>]))
            const diagnosticPlanMap = new Map(diagnosticPlansSnapshot.docs.map((docRef) => [docRef.id, { ...(docRef.data() as Record<string, any>), id: docRef.id }]))
            const applicationRows: Array<Record<string, any>> = applicationsSnapshot.docs.map((docRef) => ({
                ...(docRef.data() as Record<string, any>),
                applicationId: docRef.id,
            }))
            const acceptedApplications = applicationRows.filter((application) => normalize(application.applicationStatus) === 'accepted')
            const catalogue = interventionsSnapshot.docs.map(record => ({ id: record.id, ...record.data() } as Record<string, any>))
            const catalogueById = new Map(catalogue.map(item => [normalize(item.id || item.interventionId), item]))
            const catalogueByTitle = new Map(catalogue.map(item => [slug(item.interventionTitle || item.title), item]))
            const confirmedApplications = acceptedApplications.filter((application) => {
                const diagnosticPlan = diagnosticPlanMap.get(String(application.applicationId)) || {}
                return isAcceptedGrowthPlan(application, diagnosticPlan)
            })
            setEmptyReason(
                !applicationRows.length
                    ? 'No application records were found for this company.'
                    : !acceptedApplications.length
                        ? 'No accepted applications were found for this company.'
                        : !confirmedApplications.length
                            ? 'Accepted applications exist, but none have an Operations-confirmed diagnostic plan with readable required interventions.'
                            : 'No SMEs have confirmed interventions matching the selected filters.'
            )
            setParticipants(confirmedApplications
                .map((application) => {
                    const profile = participantMap.get(String(application.participantId)) || {}
                    const diagnosticPlan = diagnosticPlanMap.get(String(application.applicationId)) || {}
                    const configuredInterventions = getRequiredInterventions(application, diagnosticPlan)
                    const requiredInterventions = configuredInterventions.map(item => {
                        const configured = catalogueById.get(normalize(interventionId(item))) || catalogueByTitle.get(slug(interventionTitle(item))) || {}
                        return {
                            ...configured,
                            ...item,
                            interventionId: interventionId(item),
                            title: interventionTitle(item),
                            areaOfSupport: interventionArea(item) || String(configured.areaOfSupport || configured.area || ''),
                            executionMode: item.executionMode || configured.executionMode,
                            steps: item.steps || configured.steps,
                            deliveryStrategy: item.deliveryStrategy || configured.deliveryStrategy,
                            agentId: item.agentId || configured.agentId,
                        } as RequiredIntervention
                    })
                    return {
                        id: String(application.participantId),
                        applicationId: application.applicationId,
                        beneficiaryName: String(application.beneficiaryName || profile.beneficiaryName || profile.businessName || 'SME'),
                        email: String(profile.email || application.email || ''),
                        programName: String(application.programName || ''),
                        programId: String(application.programId || ''),
                        sector: String(profile.sector || application.sector || ''),
                        declinedInterventions: declinedTagsOf(diagnosticPlan),
                        requiredInterventions,
                    }
                }))

            const directAssignees: Array<Record<string, any>> = assigneesSnapshot.docs.map((docRef) => ({ id: docRef.id, ...(docRef.data() as Record<string, any>) }))
            const userRows: Array<Record<string, any>> = usersSnapshot.docs.map((docRef) => ({ id: docRef.id, ...(docRef.data() as Record<string, any>) }))
            const allowedDeliveryRoles = new Set(interventionDeliveryRoles.map(normalize))
            const fallbackUsers = userRows.filter((row) => allowedDeliveryRoles.has(normalize(row.role)))
            const source: Array<Record<string, any>> = [...directAssignees, ...fallbackUsers]
                .filter((row) => !row.role || allowedDeliveryRoles.has(normalize(row.role)))
            if (selfAssignee && allowedDeliveryRoles.has(normalize(selfAssignee.role))) source.unshift(selfAssignee)
            const assigneeMap = new Map<string, AssigneeRow>()
            source.forEach((row) => {
                const id = String(row.uid || row.id || '').trim()
                const email = row.email ? String(row.email).trim() : undefined
                const key = id || email?.toLowerCase()
                if (!key || assigneeMap.has(key)) return
                assigneeMap.set(key, {
                    id: id || key,
                    name: String(row.name || row.displayName || row.fullName || row.email || 'Delivery owner'),
                    email,
                    role: row.role ? String(row.role) : undefined,
                })
            })
            setAssignees(Array.from(assigneeMap.values()))
        } catch {
            message.error('Intervention assignment data could not be loaded.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void loadParticipants()
    }, [user?.companyCode, interventionDeliveryRoles.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        void listActiveAgents().then(setAgents)
    }, [])

    const assignmentsByParticipant = useMemo(() => {
        const grouped = new Map<string, AssignedIntervention[]>()
        assignments.forEach((assignment) => {
            const key = String(assignment.participantId || '')
            if (!key) return
            grouped.set(key, [...(grouped.get(key) || []), assignment])
        })
        return grouped
    }, [assignments])

    const visibleParticipants = useMemo(() => {
        return participants.filter((participant) => matchesActiveProgram(user, activeProgramId, participant.programId))
    }, [activeProgramId, participants, user])

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return visibleParticipants.filter((participant) => {
            const matchesSearch = !needle || `${participant.beneficiaryName} ${participant.email} ${participant.programName}`.toLowerCase().includes(needle)
            const matchesProgramme = !isAllPrograms || programme === 'All' || participant.programName === programme
            return matchesSearch && matchesProgramme
        })
    }, [isAllPrograms, programme, search, visibleParticipants])

    const programmes = useMemo(() => ['All', ...Array.from(new Set(visibleParticipants.map((participant) => participant.programName).filter(Boolean))).sort()], [visibleParticipants])
    const metrics = useMemo(() => {
        const required = visibleParticipants.reduce((total, participant) => total + participant.requiredInterventions.length, 0)
        const assigned = visibleParticipants.reduce((total, participant) => total + (assignmentsByParticipant.get(participant.id)?.length || 0), 0)
        return { participants: visibleParticipants.length, required, assigned, unassigned: Math.max(0, required - assigned) }
    }, [assignmentsByParticipant, visibleParticipants])

    useRegisterAgentPageContext({
        pageKey: 'operations-intervention-assignments',
        pageName: 'Intervention assignments',
        purpose: 'Assign confirmed growth-plan interventions to consultants or operations facilitators.',
        filters: { search, programme: isAllPrograms ? programme : activeProgramId },
        metrics,
        tables: { visibleParticipants: rows.length, assignees: assignees.length },
        selectedRecord: selected?.beneficiaryName,
    })

    const openParticipant = (participant: ParticipantRow) => {
        setSelected(participant)
        setAssignmentTarget(undefined)
        setManageFilter('All')
    }

    // Landed here from the risk register's "Take Action" for an SME with no assigned
    // intervention yet - open their Manage panel instead of leaving them to search for it.
    useEffect(() => {
        const focusParticipantId = (location.state as { focusParticipantId?: string } | null)?.focusParticipantId
        if (!focusParticipantId) return
        const participant = participants.find((row) => row.id === focusParticipantId)
        if (!participant) return
        openParticipant(participant)
        navigate(location.pathname, { replace: true, state: null })
    }, [location.pathname, location.state, navigate, participants]) // eslint-disable-line react-hooks/exhaustive-deps

    const managedRows = useMemo<ManageInterventionRow[]>(() => {
        if (!selected) return []
        const assigned = assignmentsByParticipant.get(selected.id) || []
        return selected.requiredInterventions.map((item) => {
            const id = interventionId(item)
            const matchingAssignments = assigned.filter((assignment) => assignmentMatches(assignment, item))
            const activeAssignments = matchingAssignments.filter(assignmentIsActive)
            const assignedStepIds = new Set(activeAssignments.map(assignment => assignment.assignedStepId).filter(Boolean))
            const nextStep = item.executionMode === 'multi_step'
                ? (item.steps || []).find((step, index) => !assignedStepIds.has(step.id) && index >= activeAssignments.filter(assignment => !assignment.assignedStepId).length)
                : undefined
            const activeStep = activeAssignments.find(assignment => !assignmentStepComplete(assignment))
            const tags = selected.declinedInterventions || {}
            const declinedTag = tags[declinedKey(id)]
                || Object.values(tags).find((tag) => slug(tag?.title) && slug(tag?.title) === slug(interventionTitle(item)))
            const declineRequestAssignment = declinedTag
                ? undefined
                : matchingAssignments.find((assignment) => normalize(declineRequestOf(assignment)?.status) === 'requested')
            return {
                id,
                title: interventionTitle(item),
                area: item.areaOfSupport,
                executionMode: item.executionMode,
                steps: item.steps,
                deliveryStrategy: item.deliveryStrategy,
                agentId: item.agentId,
                reviewRequired: item.reviewRequired,
                reviewerType: item.reviewerType,
                assigned: item.executionMode === 'multi_step' ? matchingAssignments[0] : activeAssignments[0],
                matchingAssignments: item.executionMode === 'multi_step' ? activeAssignments : matchingAssignments,
                nextStep,
                activeStep,
                declinedTag,
                declineRequestAssignment,
            }
        })
    }, [assignmentsByParticipant, selected])

    const manageMetrics = useMemo(() => {
        const total = managedRows.length
        const assignedCount = managedRows.filter(rowIsAssigned).length
        const completedCount = managedRows.filter(rowIsCompleted).length
        return {
            total,
            assignedCount,
            unassignedCount: total - assignedCount,
            inProgressCount: assignedCount - completedCount,
            completedCount,
        }
    }, [managedRows])

    const filteredManagedRows = useMemo(() => managedRows.filter((row) => {
        if (manageFilter === 'Assigned') return rowIsAssigned(row)
        if (manageFilter === 'Unassigned') return !rowIsAssigned(row)
        if (manageFilter === 'InProgress') return rowIsInProgress(row)
        if (manageFilter === 'Completed') return rowIsCompleted(row)
        return true
    }), [managedRows, manageFilter])

    const startAssign = (row: ManageInterventionRow) => {
        setAssignmentTarget(row)
        setAssignmentOpen(true)
        setAssignStep('details')
        form.resetFields()
        form.setFieldsValue({ deliveryMode: isAgentStrategy(row.deliveryStrategy) ? 'agent' : 'human', assignedAgentId: row.agentId })
    }

    const startGlobalAssign = () => {
        setSelected(undefined)
        setAssignmentTarget(undefined)
        setAssignmentOpen(true)
        setAssignStep('details')
        form.resetFields()
    }

    /**
     * Operations confirms an SME's "no longer need this intervention". The assignment is closed as declined
     * (never deleted), its open appointments are cancelled, and the diagnostic plan is tagged so it cannot be
     * assigned again. Anything already done (progress, hours, completed sessions) stays on the record.
     */
    const confirmSmeDecline = async (row: ManageInterventionRow) => {
        const assignment = row.declineRequestAssignment
        const participant = selected
        if (!assignment || !participant || !user) return
        const request = declineRequestOf(assignment)
        try {
            const appointmentSnapshot = await getDocs(query(
                collection(db, 'appointments'),
                where('assignedInterventionId', '==', assignment.id),
                where('companyCode', '==', user.companyCode),
            ))
            const sessionHeld = appointmentSnapshot.docs.some((row) => normalize(row.data().status) === 'completed')
            const siblingWork = (assignmentsByParticipant.get(participant.id) || []).some((other) => assignmentMatches(other, { interventionId: row.id, title: row.title } as RequiredIntervention) && hasRecordedWork(other))
            const workDone = sessionHeld || siblingWork || hasRecordedWork(assignment)
            const openAppointments = appointmentSnapshot.docs.filter((item) => ['pending', 'accepted'].includes(normalize(item.data().status)))

            modal.confirm({
                title: `Confirm decline of ${row.title}?`,
                width: 520,
                okText: 'Confirm decline',
                okButtonProps: { danger: true },
                content: (
                    <Space direction="vertical" size={8}>
                        <Typography.Text>{participant.beneficiaryName} no longer needs this intervention{request?.reasonText ? ` (“${request.reasonText}”)` : ''}.</Typography.Text>
                        <Typography.Text type="secondary">
                            It will be closed and can&apos;t be assigned again to this SME.
                            {openAppointments.length ? ` ${openAppointments.length} open appointment${openAppointments.length === 1 ? '' : 's'} will be cancelled.` : ''}
                        </Typography.Text>
                        {workDone && <Alert type="warning" showIcon message="Work is already recorded for this intervention. It is kept in history and reports; only further work is stopped." />}
                    </Space>
                ),
                onOk: async () => {
                    const batch = writeBatch(db)
                    batch.update(doc(db, 'assignedInterventions', assignment.id), {
                        status: 'declined',
                        participantStatus: 'declined',
                        declinedBySme: true,
                        closedReason: 'declined_by_sme',
                        workRetained: workDone,
                        declineRequest: { ...request, status: 'confirmed', confirmedByUid: user.uid, confirmedByEmail: user.email, confirmedAt: serverTimestamp() },
                        updatedAt: serverTimestamp(),
                    })
                    appointmentSnapshot.docs.forEach((item) => {
                        const status = normalize(item.data().status)
                        if (['pending', 'accepted'].includes(status)) {
                            batch.update(item.ref, {
                                status: 'cancelled',
                                cancellationReason: 'Intervention declined by the SME',
                                cancelledByUid: user.uid,
                                cancelledAt: serverTimestamp(),
                                declineNeedsReview: false,
                                updatedAt: serverTimestamp(),
                            })
                        } else if (item.id === request?.appointmentId) {
                            batch.update(item.ref, { declineNeedsReview: false, updatedAt: serverTimestamp() })
                        }
                    })
                    batch.set(doc(db, 'diagnosticPlans', participant.applicationId), {
                        companyCode: user.companyCode || null,
                        participantId: participant.id,
                        applicationId: participant.applicationId,
                        declinedInterventions: {
                            [declinedKey(row.id)]: {
                                interventionId: row.id,
                                title: row.title,
                                reason: request?.reasonText || 'No longer needed',
                                reasonCode: request?.reasonCode || 'no_longer_needed',
                                assignmentId: assignment.id,
                                workRetained: workDone,
                                declinedAt: serverTimestamp(),
                                confirmedByUid: user.uid,
                            },
                        },
                        updatedAt: serverTimestamp(),
                    }, { merge: true })
                    batch.set(doc(collection(db, 'notifications')), {
                        companyCode: user.companyCode || null,
                        participantId: participant.id,
                        interventionId: row.id,
                        interventionTitle: row.title,
                        type: 'intervention_decline_confirmed',
                        recipientRoles: ['incubatee', 'consultant', 'operations'],
                        message: `${row.title} was closed at ${participant.beneficiaryName}'s request${workDone ? '; work already recorded has been kept' : ''}.`,
                        createdAt: serverTimestamp(),
                        readBy: {},
                    })
                    try {
                        await batch.commit()
                    } catch (error) {
                        message.error('The decline could not be confirmed. Please try again.')
                        throw error
                    }
                    message.success(`${row.title} has been closed and cannot be reassigned.`)
                    await Promise.all([refresh(), loadParticipants()])
                },
            })
        } catch {
            message.error('The decline details could not be loaded. Please try again.')
        }
    }

    const saveAssignment = async (values: AssignmentForm) => {
        const targetParticipant = selected || participants.find((participant) => participant.id === values.participantId)
        const targetIntervention = assignmentTarget || targetParticipant?.requiredInterventions
            .map((item) => ({ id: interventionId(item), title: interventionTitle(item), area: interventionArea(item), executionMode: item.executionMode, steps: item.steps, deliveryStrategy: item.deliveryStrategy, agentId: item.agentId, reviewRequired: item.reviewRequired, reviewerType: item.reviewerType }))
            .find((item) => item.id === values.interventionId)

        if (!user || !targetParticipant || !targetIntervention) return
        if ((targetParticipant.declinedInterventions || {})[declinedKey(targetIntervention.id)]) {
            message.error('The SME declined this intervention, so it cannot be assigned again.')
            return
        }
        const existingAssignment = (assignmentsByParticipant.get(targetParticipant.id) || []).find((assignment) => assignmentMatches(assignment, {
            interventionId: targetIntervention.id,
            title: targetIntervention.title,
        }) && assignmentIsActive(assignment))
        if (existingAssignment && targetIntervention.executionMode !== 'multi_step') {
            message.warning('This intervention already has a current assignment for this SME.')
            return
        }
        const matchingAssignments = (assignmentsByParticipant.get(targetParticipant.id) || []).filter((assignment) => assignmentMatches(assignment, { interventionId: targetIntervention.id, title: targetIntervention.title }) && assignmentIsActive(assignment))
        const activeStep = matchingAssignments.find((assignment) => !assignmentStepComplete(assignment))
        if (targetIntervention.executionMode === 'multi_step' && activeStep) {
            message.warning(`${activeStep.assignedStepTitle || 'The current step'} must be completed before the next step is assigned.`)
            return
        }
        const assignedStepIds = new Set(matchingAssignments.map((assignment) => assignment.assignedStepId).filter(Boolean))
        const legacyStepCount = matchingAssignments.filter((assignment) => !assignment.assignedStepId).length
        const nextStepIndex = (targetIntervention.steps || []).findIndex((step, index) => !assignedStepIds.has(step.id) && index >= legacyStepCount)
        const assignedStep = targetIntervention.executionMode === 'multi_step' && nextStepIndex >= 0 ? targetIntervention.steps?.[nextStepIndex] : undefined
        if (targetIntervention.executionMode === 'multi_step' && !assignedStep) {
            message.info('All intervention steps have already been assigned.')
            return
        }
        const configuredDeliveryStrategy = targetIntervention.deliveryStrategy || 'human_only'
        const deliveryStrategy: InterventionDeliveryStrategy = values.deliveryMode === 'agent' ? 'agent_only' : 'human_only'
        const agent = agents.find((item) => item.id === values.assignedAgentId)
        const humanAssignee = assignees.find((row) => row.id === values.assigneeId)
        if (values.deliveryMode === 'agent' && !agent) {
            message.error('Choose an agent for this assignment.')
            return
        }
        if (values.deliveryMode === 'human' && !humanAssignee) {
            message.error('Choose a human delivery owner.')
            return
        }
        const assignee = humanAssignee || { id: `agent:${agent!.id}`, name: agent!.name, email: undefined, role: 'agent' }

        try {
            setSaving(true)
            const assignmentRef = await addDoc(collection(db, 'assignedInterventions'), {
                companyCode: user.companyCode,
                participantId: targetParticipant.id,
                applicationId: targetParticipant.applicationId,
                interventionId: targetIntervention.id,
                interventionTitle: targetIntervention.title,
                areaOfSupport: targetIntervention.area || null,
                businessName: targetParticipant.beneficiaryName,
                programName: targetParticipant.programName || null,
                programId: (targetParticipant as any).programId || null,
                assigneeId: assignee.id,
                assigneeName: assignee.name,
                assigneeEmail: assignee.email || null,
                assigneeType: normalize(assignee.role) || 'consultant',
                deliveryActorType: isAgentStrategy(deliveryStrategy) ? 'agent' : 'human',
                deliveryStrategy,
                configuredDeliveryStrategy,
                deliveryComparisonGroup: targetIntervention.id,
                executionMode: targetIntervention.executionMode || 'single_session',
                steps: assignedStep ? [{ ...assignedStep, status: 'not_started' }] : [],
                assignedStepId: assignedStep?.id || null,
                assignedStepTitle: assignedStep?.title || null,
                assignedStepDescription: assignedStep?.description || null,
                stepIndex: assignedStep ? nextStepIndex : null,
                stepNumber: assignedStep ? nextStepIndex + 1 : null,
                stepCount: targetIntervention.steps?.length || null,
                agentId: agent?.id || null,
                agentName: agent?.name || null,
                reviewRequired: false,
                reviewerType: null,
                reviewerId: null,
                reviewerName: null,
                reviewStatus: null,
                agentWorkStatus: isAgentStrategy(deliveryStrategy) ? 'ready' : null,
                type: 'singular',
                status: 'assigned',
                assigneeStatus: isAgentStrategy(deliveryStrategy) ? 'accepted' : 'pending',
                participantStatus: 'pending',
                assigneeCompletionStatus: 'pending',
                participantCompletionStatus: 'pending',
                progress: 0,
                dueDate: values.dueDate ? Timestamp.fromDate(values.dueDate.toDate()) : null,
                targetMetric: values.targetMetric || null,
                targetValue: values.targetValue ?? null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdByUid: user.uid,
                createdByEmail: user.email,
            })

            if (!isAgentStrategy(deliveryStrategy) && values.appointmentDate && values.appointmentTimeRange?.[0] && values.appointmentTimeRange?.[1] && values.meetingType) {
                const startTime = values.appointmentDate.hour(values.appointmentTimeRange[0].hour()).minute(values.appointmentTimeRange[0].minute()).second(0).millisecond(0)
                const endTime = values.appointmentDate.hour(values.appointmentTimeRange[1].hour()).minute(values.appointmentTimeRange[1].minute()).second(0).millisecond(0)
                await addDoc(collection(db, 'appointments'), {
                    companyCode: user.companyCode,
                    assignedInterventionId: assignmentRef.id,
                    interventionId: targetIntervention.id,
                    interventionTitle: targetIntervention.title,
                    participantId: targetParticipant.id,
                    participantName: targetParticipant.beneficiaryName,
                    participantEmail: targetParticipant.email || null,
                    programId: targetParticipant.programId || null,
                    programName: targetParticipant.programName || null,
                    assigneeId: assignee.id,
                    assigneeEmail: assignee.email || null,
                    meetingType: values.meetingType,
                    meetingLink: values.meetingLink || null,
                    location: values.location || null,
                    startTime: Timestamp.fromDate(startTime.toDate()),
                    endTime: Timestamp.fromDate(endTime.toDate()),
                    status: 'pending',
                    requiresSmeAcceptance: true,
                    acceptanceBundle: 'intervention_and_first_appointment',
                    firstAppointmentForAssignment: true,
                    attendance: {},
                    createdByUid: user.uid,
                    createdByEmail: user.email,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                })
            }
            await addDoc(collection(db, 'notifications'), {
                companyCode: user.companyCode,
                participantId: targetParticipant.id,
                interventionId: targetIntervention.id,
                interventionTitle: targetIntervention.title,
                type: 'intervention_assigned',
                recipientRoles: ['consultant', 'operations', 'incubatee'],
                message: values.appointmentDate
                    ? `${targetIntervention.title} has been assigned to ${assignee.name} with a first appointment awaiting SME acceptance.`
                    : `${targetIntervention.title} has been assigned to ${assignee.name}.`,
                createdAt: serverTimestamp(),
                readBy: {},
            })
            message.success('Intervention assigned.')
            setAssignmentTarget(undefined)
            setAssignmentOpen(false)
            await refresh()
        } catch {
            message.error('Intervention could not be assigned.')
        } finally {
            setSaving(false)
        }
    }

    const closeAssignmentModal = () => {
        setAssignmentOpen(false)
        setAssignmentTarget(undefined)
    }

    /** Details step "Continue"/"Assign" - agent delivery has no appointment step, so it saves immediately. */
    const handleDetailsContinue = async () => {
        const fields: Array<keyof AssignmentForm> = [
            ...(!assignmentTarget ? (['participantId', 'interventionId'] as const) : []),
            'deliveryMode',
            ...(deliveryMode === 'agent' ? (['assignedAgentId'] as const) : (['assigneeId'] as const)),
        ]
        try {
            await form.validateFields(fields)
        } catch {
            return
        }
        if (deliveryMode === 'agent') {
            await saveAssignment(form.getFieldsValue())
            return
        }
        setAssignStep(isSelfAssign ? 'appointment' : 'appointmentGate')
    }

    /** Appointment gate "No" - save the assignment now, schedule the appointment separately later. */
    const handleSkipAppointment = async () => {
        await saveAssignment(form.getFieldsValue())
    }

    const handleFinalAssign = async () => {
        const fields: Array<keyof AssignmentForm> = [
            'appointmentDate',
            'appointmentTimeRange',
            'meetingType',
            ...(meetingType === 'online' ? (['meetingLink'] as const) : []),
            ...(meetingType === 'in_person' ? (['location'] as const) : []),
        ]
        try {
            await form.validateFields(fields)
        } catch {
            return
        }
        await saveAssignment(form.getFieldsValue())
    }

    const programColumns: NonNullable<TableProps<ParticipantRow>['columns']> = isAllPrograms
        ? [{ title: 'Program', dataIndex: 'programName', render: (value?: string) => value || 'Unassigned' }]
        : []

    const columns: TableProps<ParticipantRow>['columns'] = [
        { title: 'SME Name', dataIndex: 'beneficiaryName', render: (value: string, row) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{row.email || 'No email'}</Typography.Text></Space> },
        ...programColumns,
        { title: 'Required', render: (_, row) => row.requiredInterventions.length },
        { title: 'Assigned', render: (_, row) => assignmentsByParticipant.get(row.id)?.length || 0 },
        { title: 'Progress', render: (_, row) => <Progress percent={Math.round(((assignmentsByParticipant.get(row.id)?.length || 0) / Math.max(row.requiredInterventions.length, 1)) * 100)} size="small" /> },
        { title: 'Actions', render: (_, row) => <Button onClick={() => openParticipant(row)}>Manage</Button> },
    ]

    return (
        <DashboardPage className="operations-interventions-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading || assignmentsLoading} icon={<TeamOutlined />} label="SMEs" value={metrics.participants} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading || assignmentsLoading} icon={<DatabaseOutlined />} label="Required" value={metrics.required} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading || assignmentsLoading} icon={<CheckCircleOutlined />} label="Assigned" value={metrics.assigned} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading || assignmentsLoading} icon={<CalendarOutlined />} label="Unassigned" value={metrics.unassigned} /></Col>
            </Row>

            <FilterBar
                primary={<><Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SME name, email, or program" allowClear />{isAllPrograms && <Select value={programme} onChange={setProgramme} options={programmes.map((value) => ({ value, label: value }))} />}</>}
                actions={<><Button type="primary" icon={<PlusOutlined />} disabled={!canAssign || !participants.length} onClick={startGlobalAssign}>Assign intervention</Button><Button icon={<ReloadOutlined />} onClick={() => { void loadParticipants(); void refresh() }}>Refresh</Button></>}
            />

            <Card>
                <ResponsiveDataView
                    rowKey="id"
                    rows={rows}
                    columns={columns}
                    loading={loading || assignmentsLoading}
                    emptyText={emptyReason}
                    renderCard={(row) => <Space direction="vertical" size={8}><Typography.Text strong>{row.beneficiaryName}</Typography.Text><Typography.Text type="secondary">{row.programName || 'Unassigned'}</Typography.Text><Space wrap><Tag>{row.requiredInterventions.length} required</Tag><Tag color="blue">{assignmentsByParticipant.get(row.id)?.length || 0} assigned</Tag></Space><Button onClick={() => openParticipant(row)}>Manage</Button></Space>}
                />
            </Card>

            <Modal open={!!selected} onCancel={() => setSelected(undefined)} title={selected?.beneficiaryName} footer={null} width={920}>
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[12, 12]}>
                            {manageMetrics.total > 0 && (
                                <Col flex="1" key="required">
                                    <DashboardMetricCard
                                        icon={<DatabaseOutlined />}
                                        label="Required"
                                        value={manageMetrics.total}
                                        hint={manageFilter === 'All' ? 'Showing all' : 'Click to show all'}
                                        clickable
                                        onClick={() => setManageFilter('All')}
                                    />
                                </Col>
                            )}
                            {manageMetrics.assignedCount > 0 && (
                                <Col flex="1" key="assigned">
                                    <DashboardMetricCard
                                        icon={<CheckCircleOutlined />}
                                        label="Assigned"
                                        value={manageMetrics.assignedCount}
                                        hint={manageFilter === 'Assigned' ? 'Filter active — click to clear' : 'Click to filter'}
                                        clickable
                                        onClick={() => setManageFilter((current) => current === 'Assigned' ? 'All' : 'Assigned')}
                                    />
                                </Col>
                            )}
                            {manageMetrics.unassignedCount > 0 && (
                                <Col flex="1" key="unassigned">
                                    <DashboardMetricCard
                                        icon={<ExclamationCircleOutlined />}
                                        label="Unassigned"
                                        value={manageMetrics.unassignedCount}
                                        hint={manageFilter === 'Unassigned' ? 'Filter active — click to clear' : 'Click to filter'}
                                        clickable
                                        onClick={() => setManageFilter((current) => current === 'Unassigned' ? 'All' : 'Unassigned')}
                                    />
                                </Col>
                            )}
                            {manageMetrics.inProgressCount > 0 && (
                                <Col flex="1" key="inprogress">
                                    <DashboardMetricCard
                                        icon={<ToolOutlined />}
                                        label="In progress"
                                        value={manageMetrics.inProgressCount}
                                        hint={manageFilter === 'InProgress' ? 'Filter active — click to clear' : 'Click to filter'}
                                        clickable
                                        onClick={() => setManageFilter((current) => current === 'InProgress' ? 'All' : 'InProgress')}
                                    />
                                </Col>
                            )}
                            {manageMetrics.completedCount > 0 && (
                                <Col flex="1" key="completed">
                                    <DashboardMetricCard
                                        icon={<CheckCircleOutlined />}
                                        label="Completed"
                                        value={manageMetrics.completedCount}
                                        hint={manageFilter === 'Completed' ? 'Filter active — click to clear' : 'Click to filter'}
                                        clickable
                                        onClick={() => setManageFilter((current) => current === 'Completed' ? 'All' : 'Completed')}
                                    />
                                </Col>
                            )}
                        </Row>
                        {managedRows.some((row) => row.declineRequestAssignment) && (
                            <Alert
                                type="warning"
                                showIcon
                                message="The SME asked to drop an intervention"
                                description={managedRows
                                    .filter((row) => row.declineRequestAssignment)
                                    .map((row) => `${row.title}${declineRequestOf(row.declineRequestAssignment)?.reasonText ? `: ${declineRequestOf(row.declineRequestAssignment)?.reasonText}` : ''}`)
                                    .join(' · ')}
                            />
                        )}
                        <ResponsiveDataView
                            rowKey="id"
                            rows={filteredManagedRows}
                            loading={assignmentsLoading}
                            emptyText={manageFilter === 'All' ? 'No required interventions found for this SME.' : 'No interventions match this filter.'}
                            columns={[
                                { title: 'Intervention', dataIndex: 'title' },
                                { title: 'Area', dataIndex: 'area', render: (value?: string) => value || 'N/A' },
                                { title: 'Execution', render: (_, row) => <Tag color={row.executionMode === 'multi_step' ? 'purple' : 'default'}>{row.executionMode === 'multi_step' ? `Multi-step (${row.steps?.length || 0})` : 'Single session'}</Tag> },
                                {
                                    title: 'Status',
                                    render: (_, row) => {
                                        if (row.declinedTag) {
                                            return (
                                                <Space direction="vertical" size={0}>
                                                    <Tag color="red">Declined by SME</Tag>
                                                    {row.declinedTag.workRetained && <Typography.Text type="secondary">Work kept</Typography.Text>}
                                                </Space>
                                            )
                                        }
                                        const label = rowIsCompleted(row) ? 'Completed' : rowIsInProgress(row) ? 'In progress' : 'Unassigned'
                                        const color = rowIsCompleted(row) ? 'green' : rowIsInProgress(row) ? 'blue' : 'default'
                                        const detail = row.executionMode === 'multi_step'
                                            ? (row.activeStep
                                                ? `Step ${Number(row.activeStep.stepIndex || 0) + 1}: ${row.activeStep.assignedStepTitle || ''}`
                                                : row.nextStep
                                                    ? `Next: ${row.nextStep.title}`
                                                    : `${row.matchingAssignments?.length || 0}/${row.steps?.length || 0} steps assigned`)
                                            : undefined
                                        return (
                                            <Space direction="vertical" size={0}>
                                                <Space size={4} wrap>
                                                    <Tag color={color}>{label}</Tag>
                                                    {row.declineRequestAssignment && <Tag color="orange">Decline requested</Tag>}
                                                </Space>
                                                {detail && <Typography.Text type="secondary">{detail}</Typography.Text>}
                                            </Space>
                                        )
                                    },
                                },
                                {
                                    title: 'Assignee',
                                    render: (_, row) => {
                                        const current = row.executionMode === 'multi_step' ? row.activeStep : row.assigned
                                        if (!current) return <Typography.Text type="secondary">Not assigned</Typography.Text>
                                        return <Space size={4}><Tag color={current.deliveryActorType === 'agent' ? 'purple' : 'blue'} style={{ marginInlineEnd: 0 }}>{current.deliveryActorType === 'agent' ? 'Agent' : 'Human'}</Tag>{current.assigneeName || 'Unnamed'}</Space>
                                    },
                                },
                                { title: 'Actions', render: (_, row) => row.declinedTag ? <Tag color="red">Declined</Tag> : row.declineRequestAssignment ? <Button danger disabled={!canAssign} onClick={() => void confirmSmeDecline(row)}>Confirm decline</Button> : row.assigned && row.executionMode !== 'multi_step' ? <Tag color="green">Assigned</Tag> : <Button disabled={!canAssign || !!row.activeStep || (row.executionMode === 'multi_step' && !row.nextStep)} icon={<PlusOutlined />} onClick={() => startAssign(row)}>{row.executionMode === 'multi_step' ? row.matchingAssignments?.length ? 'Assign next step' : 'Assign first step' : 'Assign'}</Button> },
                            ]}
                            renderCard={(row) => {
                                const current = row.executionMode === 'multi_step' ? row.activeStep : row.assigned
                                const statusLabel = rowIsCompleted(row) ? 'Completed' : rowIsInProgress(row) ? 'In progress' : 'Unassigned'
                                const statusColor = rowIsCompleted(row) ? 'green' : rowIsInProgress(row) ? 'blue' : 'default'
                                return (
                                    // Plain flex div, not Space: this card mixes tags/text with a conditional
                                    // Button, which trips the global .ant-space:has(>.ant-space-item>.ant-btn)
                                    // modal-body rule (see the appointmentGate step above for the full story).
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                        <Typography.Text strong>{row.title}</Typography.Text>
                                        <Space wrap>
                                            <Tag>{row.area || 'General support'}</Tag>
                                            <Tag>{row.executionMode === 'multi_step' ? `Multi-step (${row.steps?.length || 0})` : 'Single session'}</Tag>
                                            {row.declinedTag ? <Tag color="red">Declined by SME</Tag> : <Tag color={statusColor}>{statusLabel}</Tag>}
                                            {row.declineRequestAssignment && <Tag color="orange">Decline requested</Tag>}
                                        </Space>
                                        {row.executionMode === 'multi_step' && (
                                            <Typography.Text type="secondary">
                                                {row.activeStep ? `Step ${Number(row.activeStep.stepIndex || 0) + 1}: ${row.activeStep.assignedStepTitle}` : row.nextStep ? `Next: ${row.nextStep.title}` : `${row.matchingAssignments?.length || 0}/${row.steps?.length || 0} steps assigned`}
                                            </Typography.Text>
                                        )}
                                        {row.declinedTag ? (
                                            <Tag color="red" style={{ width: 'fit-content' }}>Cannot be reassigned</Tag>
                                        ) : row.declineRequestAssignment ? (
                                            <Button danger disabled={!canAssign} onClick={() => void confirmSmeDecline(row)}>Confirm decline</Button>
                                        ) : current ? (
                                            <Space size={4}>
                                                <Tag color={current.deliveryActorType === 'agent' ? 'purple' : 'blue'} style={{ marginInlineEnd: 0 }}>{current.deliveryActorType === 'agent' ? 'Agent' : 'Human'}</Tag>
                                                <Typography.Text type="secondary">{current.assigneeName}</Typography.Text>
                                            </Space>
                                        ) : (
                                            <Button disabled={!canAssign || !!row.activeStep || (row.executionMode === 'multi_step' && !row.nextStep)} icon={<PlusOutlined />} onClick={() => startAssign(row)}>
                                                {row.executionMode === 'multi_step' ? (row.matchingAssignments?.length ? 'Assign next step' : 'Assign first step') : 'Assign'}
                                            </Button>
                                        )}
                                    </div>
                                )
                            }}
                        />
                    </Space>
                )}
            </Modal>

            <Modal open={assignmentOpen} onCancel={closeAssignmentModal} title={`Assign ${assignmentTarget?.nextStep?.title || assignmentTarget?.title || 'intervention'}`} footer={null} destroyOnClose>
                <Form form={form} layout="vertical">
                    {assignStep === 'details' && (
                        <>
                            {!assignmentTarget && (
                                <>
                                    <Form.Item name="participantId" label="SME Name" rules={[{ required: true, message: 'Choose an SME.' }]}>
                                        <Select
                                            showSearch
                                            optionFilterProp="label"
                                            options={rows.map((participant) => ({ value: participant.id, label: `${participant.beneficiaryName}${participant.programName ? ` - ${participant.programName}` : ''}` }))}
                                        />
                                    </Form.Item>
                                    <Form.Item noStyle dependencies={['participantId']}>
                                        {({ getFieldValue }) => {
                                            const participant = participants.find((row) => row.id === getFieldValue('participantId'))
                                            const options = (participant?.requiredInterventions || []).map((item) => ({ value: interventionId(item), label: interventionTitle(item) }))
                                            return (
                                                <Form.Item name="interventionId" label="Intervention" rules={[{ required: true, message: 'Choose an intervention.' }]}>
                                                    <Select showSearch optionFilterProp="label" options={options} disabled={!participant} onChange={(value) => {
                                                        const item = participant?.requiredInterventions.find(row => interventionId(row) === value)
                                                        form.setFieldsValue({ deliveryMode: isAgentStrategy(item?.deliveryStrategy) ? 'agent' : 'human', assignedAgentId: item?.agentId, assigneeId: undefined })
                                                    }} />
                                                </Form.Item>
                                            )
                                        }}
                                    </Form.Item>
                                </>
                            )}
                            <Form.Item name="deliveryMode" label="Delivery for this assignment" rules={[{ required: true, message: 'Choose human or agent delivery.' }]} help="Preselected from the catalogue — you can still change it.">
                                <Select options={[{ value: 'human', label: 'Human delivery' }, { value: 'agent', label: 'Agent delivery' }]} />
                            </Form.Item>
                            {deliveryMode === 'agent' && <Form.Item name="assignedAgentId" label="Delivery agent" rules={[{ required: true, message: 'Choose an agent.' }]}>
                                <Select options={agents.map(agent => ({ value: agent.id, label: agent.name }))} />
                            </Form.Item>}
                            {deliveryMode === 'human' && (
                                <Form.Item name="assigneeId" label="Human delivery owner" rules={[{ required: true, message: 'Choose a delivery owner.' }]}>
                                    <Select showSearch optionFilterProp="label" options={assignees.map((assignee) => ({ value: assignee.id, label: `${assignee.name}${assignee.id === user?.uid ? ' (Me)' : ''} (${assigneeRoleLabel(assignee.role)})${assignee.email ? ` - ${assignee.email}` : ''}` }))} />
                                </Form.Item>
                            )}
                            <Form.Item name="dueDate" label="Due date">
                                <DatePicker style={{ width: '100%' }} />
                            </Form.Item>
                            <Row gutter={12}>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name="targetMetric"
                                        label="Target type"
                                    >
                                        <Select allowClear options={TARGET_METRIC_OPTIONS} placeholder="Select how progress will be measured" />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item
                                        name="targetValue"
                                        label="Target amount"
                                        help={targetMetric ? `How many ${String(targetMetric).toLowerCase()}?` : 'Optional completion target.'}
                                    >
                                        <Input type="number" min={0} placeholder="e.g. 3" />
                                    </Form.Item>
                                </Col>
                            </Row>
                            <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                                <Button onClick={closeAssignmentModal}>Cancel</Button>
                                <Button type="primary" icon={<UserSwitchOutlined />} loading={saving} onClick={() => void handleDetailsContinue()}>
                                    {deliveryMode === 'agent' ? 'Assign' : 'Continue'}
                                </Button>
                            </Space>
                        </>
                    )}

                    {assignStep === 'appointmentGate' && (
                        /*
                          Plain flex div, not antd's Space: a global rule (.ant-modal .ant-modal-body
                          .ant-space:has(> .ant-space-item > .ant-btn)) forces ANY Space in a modal body
                          that has a button among its direct children into a horizontal, equal-width row -
                          meant for footer-style action rows, but it doesn't care that this one also holds
                          a heading and a row of cards. Same bug as AIInterventionUpdateModal.tsx earlier.
                        */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%' }}>
                            <div>
                                <Typography.Text strong>Set up the first appointment now?</Typography.Text>
                                <br />
                                <Typography.Text type="secondary">Scheduling it now lets the SME accept the intervention and the appointment together.</Typography.Text>
                            </div>
                            <Row gutter={16}>
                                <Col span={12}>
                                    <OptionCard
                                        icon={<CalendarOutlined />}
                                        title="Yes, schedule now"
                                        description="Set the date, time and meeting details."
                                        onClick={() => setAssignStep('appointment')}
                                    />
                                </Col>
                                <Col span={12}>
                                    <OptionCard
                                        icon={<ClockCircleOutlined />}
                                        title="Not now"
                                        description="Assign it now and schedule the appointment separately later."
                                        onClick={() => void handleSkipAppointment()}
                                    />
                                </Col>
                            </Row>
                            <Button onClick={() => setAssignStep('details')} loading={saving}>Back</Button>
                        </div>
                    )}

                    {assignStep === 'appointment' && (
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                            <Typography.Text type="secondary">Schedule the first appointment so the SME accepts the intervention and appointment together.</Typography.Text>
                            <Row gutter={12}>
                                <Col xs={24} md={12}>
                                    <Form.Item name="appointmentDate" label="Appointment date" rules={[{ required: true, message: 'Choose the appointment date.' }]}>
                                        <DatePicker style={{ width: '100%' }} />
                                    </Form.Item>
                                </Col>
                                <Col xs={24} md={12}>
                                    <Form.Item name="appointmentTimeRange" label="Time" rules={[{ required: true, message: 'Choose the start and end time.' }]}>
                                        <TimePicker.RangePicker style={{ width: '100%' }} format="HH:mm" minuteStep={15} />
                                    </Form.Item>
                                </Col>
                            </Row>
                            <Form.Item name="meetingType" label="Meeting type" rules={[{ required: true, message: 'Choose meeting type.' }]}>
                                <MeetingTypeField />
                            </Form.Item>
                            {meetingType === 'online' && (
                                <Form.Item name="meetingLink" label="Meeting link" rules={[{ required: true, message: 'Add the meeting link.' }]}>
                                    <Input placeholder="Paste Zoom, Google Meet, Teams, or any online meeting link" />
                                </Form.Item>
                            )}
                            {meetingType === 'in_person' && (
                                <Form.Item name="location" label="Location" rules={[{ required: true, message: 'Add the appointment location.' }]}>
                                    <Input />
                                </Form.Item>
                            )}
                            <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Button onClick={() => setAssignStep(isSelfAssign ? 'details' : 'appointmentGate')}>Back</Button>
                                <Space>
                                    <Button onClick={closeAssignmentModal}>Cancel</Button>
                                    <Button type="primary" icon={<UserSwitchOutlined />} loading={saving} onClick={() => void handleFinalAssign()}>Assign</Button>
                                </Space>
                            </Space>
                        </Space>
                    )}
                </Form>
            </Modal>
        </DashboardPage>
    )
}

export default InterventionsAssignemnts
