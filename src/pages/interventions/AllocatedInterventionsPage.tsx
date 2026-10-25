import { Alert, App, Button, Card, Col, Descriptions, Input, Modal, Progress, Row, Segmented, Select, Space, Tag, Timeline, Typography, type TableProps } from 'antd'
import { CheckOutlined, ClockCircleOutlined, CloseOutlined, EyeOutlined, FieldTimeOutlined, PaperClipOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, TeamOutlined, ToolOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc, writeBatch } from 'firebase/firestore'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { db } from '@/firebase'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import AIInterventionUpdateModal from '@/components/interventions/AIInterventionUpdateModal'
import { pendingChangeRequest, uploadEvidenceFiles } from '@/services/interventionOverrideService'
import { ChangeRequestModal } from '@/components/interventions/ChangeRequestModal'
import { FOLLOW_UP_RESULT_OPTIONS, buildFollowUpResult, deliverableLabel, followUpState, type FollowUpResult } from '@/services/interventionOutcomeConfig'
import { SME_CHECKBACK_ANSWERS, smeAnswerForRound, smeCheckbackHistory } from '@/services/smeCheckbackService'
import type { AssignedInterventionLike, InterventionRow, ProgressUpdateForm, StatusFilter, UpdateMode } from '@/types/interventions'
import { formatStatus } from '@/utils/status'
import { hasWorkStarted } from '@/utils/interventionStart'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type ViewFilter = 'active' | 'history' | 'followups'

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const toDate = (value: unknown) => {
    if (!value) return null
    if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return value.toDate()
    if (typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
    const parsed = new Date(String(value))
    return Number.isNaN(+parsed) ? null : parsed
}

const deriveStatus = (assignment: AssignedInterventionLike): StatusFilter => {
    const rawStatus = normalize(assignment.status)
    const assigneeStatus = normalize(assignment.assigneeStatus)
    const participantStatus = normalize(assignment.participantStatus)
    const assigneeCompletion = normalize(assignment.assigneeCompletionStatus)
    const participantCompletion = normalize(assignment.participantCompletionStatus)

    if (rawStatus === 'cancelled' || assigneeStatus === 'declined' || participantStatus === 'declined' || participantCompletion === 'rejected') return 'Rejected'
    if (rawStatus === 'completed' || participantCompletion === 'confirmed') return 'Completed'
    if (assigneeCompletion === 'done' || rawStatus === 'awaiting_confirmation') return 'In progress'
    // In progress only once real work exists (an appointment accepted or attended, progress logged, an agent run).
    if (assigneeStatus === 'accepted' && hasWorkStarted(assignment as Record<string, unknown>)) return 'In progress'
    return 'Pending'
}

const statusColor = (status: StatusFilter) => {
    if (status === 'Completed') return 'green'
    if (status === 'Rejected') return 'red'
    if (status === 'In progress') return 'blue'
    if (status === 'Pending') return 'gold'
    return 'default'
}

/** What the status tag says. Pending splits three ways: your acceptance, the SME's plan sign-off, or simply not started. */
const statusLabel = (row: Pick<InterventionRow, 'status' | 'assigneeStatus' | 'participantStatus'>) => {
    if (row.status !== 'Pending' || normalize(row.assigneeStatus) !== 'accepted') return tr(row.status)
    return ['', 'pending'].includes(normalize(row.participantStatus)) ? tr('Awaiting plan sign-off') : tr('Not started')
}

/** A follow-up can be recorded once it is due (or overdue), and never for agent-delivered work. */
const followUpDue = (row: InterventionRow) => {
    const followUp = followUpState(row.raw as Record<string, unknown>)
    return !!followUp && (followUp.state === 'due_soon' || followUp.state === 'overdue') && row.raw.deliveryActorType !== 'agent'
}

const STATUS_OPTIONS: Record<ViewFilter, StatusFilter[]> = {
    active: ['All', 'Pending', 'In progress'],
    history: ['All', 'Completed', 'Rejected'],
    followups: ['All', 'Pending', 'In progress', 'Completed'],
}

const progressFor = (assignment: AssignedInterventionLike, status: StatusFilter) => {
    const explicit = Number(assignment.progress)
    if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)))
    if (status === 'Completed') return 100
    if (status === 'In progress') return 50
    return 0
}

const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)))

const numberOrUndefined = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

const isHoursMetric = (metric: unknown) => normalize(metric).includes('hour')

const calculateProgressAfter = (assignment: AssignedInterventionLike, values: ProgressUpdateForm) => {
    const explicitProgress = numberOrUndefined(values.progressAfter)
    if (explicitProgress != null) return clampProgress(explicitProgress)

    const targetType = normalize(assignment.targetType)
    const targetValue = numberOrUndefined(assignment.targetValue)
    if (targetType !== 'number' || !targetValue || targetValue <= 0) {
        return clampProgress(Number(assignment.progress || 0))
    }

    const currentActual = numberOrUndefined(assignment.targetActual) || 0
    const unitIncrement = isHoursMetric(assignment.targetMetric)
        ? numberOrUndefined(values.hoursAdded) || 0
        : numberOrUndefined(values.unitsAdded) || 0

    return clampProgress(((currentActual + unitIncrement) / targetValue) * 100)
}

const calculateTargetActualAfter = (assignment: AssignedInterventionLike, values: ProgressUpdateForm) => {
    const targetType = normalize(assignment.targetType)
    if (targetType !== 'number') return numberOrUndefined(assignment.targetActual)

    const currentActual = numberOrUndefined(assignment.targetActual) || 0
    const unitIncrement = isHoursMetric(assignment.targetMetric)
        ? numberOrUndefined(values.hoursAdded) || 0
        : numberOrUndefined(values.unitsAdded) || 0

    return currentActual + unitIncrement
}

const makeRow = (assignment: AssignedInterventionLike, localOnly = false): InterventionRow => {
    const derived = deriveStatus(assignment)
    return {
        id: assignment.id,
        title: String(assignment.interventionTitle || tr('Intervention')),
        beneficiaryName: String(assignment.businessName || tr('Unassigned SME')),
        programmeName: String(assignment.programName || ''),
        programmeId: String(assignment.programId || ''),
        assigneeStatus: String(assignment.assigneeStatus || 'pending'),
        participantStatus: String(assignment.participantStatus || 'pending'),
        completionStatus: String(assignment.participantCompletionStatus || 'pending'),
        status: derived,
        dueDate: assignment.dueDate,
        progress: progressFor(assignment, derived),
        raw: assignment,
        localOnly,
    }
}

export const AllocatedInterventions = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { assignments, loading, refresh, isMine } = useAssignedInterventions()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { user } = useFullIdentity()
    const location = useLocation()
    const navigate = useNavigate()
    const [view, setView] = useState<ViewFilter>('active')
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<StatusFilter>('All')
    const [programme, setProgramme] = useState('All')
    const [selected, setSelected] = useState<InterventionRow>()
    const [saving, setSaving] = useState(false)
    const [requesting, setRequesting] = useState<{ id: string; title: string; participant: string } | null>(null)
    const [updateMode, setUpdateMode] = useState<UpdateMode>('manual')
    const [updateOpen, setUpdateOpen] = useState(false)
    const [followUpOpen, setFollowUpOpen] = useState(false)
    const [followUpResult, setFollowUpResult] = useState<FollowUpResult>('achieved')
    const [followUpNote, setFollowUpNote] = useState('')
    const realRows = useMemo<InterventionRow[]>(() => {
        return assignments.filter(isMine).map((assignment) => makeRow(assignment as AssignedIntervention))
    }, [assignments, isMine])

    const scopedRealRows = useMemo(() => realRows.filter((row) => {
        return matchesActiveProgram(user, activeProgramId, row.programmeId)
    }), [activeProgramId, realRows, user])

    const visibleByProgramme = useMemo(() => {
        return scopedRealRows
    }, [scopedRealRows])

    // Landed here from the risk register's "Take Action" - open the specific intervention it flagged
    // instead of leaving the user to find it themselves in the list.
    useEffect(() => {
        const focusInterventionId = (location.state as { focusInterventionId?: string } | null)?.focusInterventionId
        if (!focusInterventionId) return
        const row = visibleByProgramme.find((candidate) => candidate.id === focusInterventionId)
        if (!row) return
        setSelected(row)
        setView(['Completed', 'Rejected'].includes(row.status) ? 'history' : 'active')
        navigate(location.pathname, { replace: true, state: null })
    }, [location.pathname, location.state, navigate, visibleByProgramme])

    // Landed here from the dashboard's "Needs you" list: show just those interventions until the user clears it.
    const [onlyIds, setOnlyIds] = useState<string[] | null>(null)
    useEffect(() => {
        const needsYouIds = (location.state as { needsYouIds?: string[] } | null)?.needsYouIds
        if (!needsYouIds) return
        setOnlyIds(needsYouIds)
        setView('active')
        setStatus('All')
        setSearch('')
        navigate(location.pathname, { replace: true, state: null })
    }, [location.pathname, location.state, navigate])

    const activeRows = useMemo(() => visibleByProgramme.filter((row) => !['Completed', 'Rejected'].includes(row.status)), [visibleByProgramme])
    const historyRows = useMemo(() => visibleByProgramme.filter((row) => ['Completed', 'Rejected'].includes(row.status)), [visibleByProgramme])
    const followUpRows = useMemo(() => visibleByProgramme.filter(followUpDue), [visibleByProgramme])
    const baseRows = view === 'active' ? activeRows : view === 'followups' ? followUpRows : historyRows

    const programmes = useMemo(() => {
        return ['All', ...Array.from(new Set(visibleByProgramme.map((row) => row.programmeName).filter(Boolean))).sort()]
    }, [visibleByProgramme])

    const filteredRows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return baseRows.filter((row) => {
            const matchesSearch = !needle || `${row.title} ${row.beneficiaryName} ${row.programmeName}`.toLowerCase().includes(needle)
            const matchesStatus = status === 'All' || row.status === status
            const matchesProgramme = !isAllPrograms || programme === 'All' || row.programmeName === programme
            const matchesNeedsYou = !onlyIds || onlyIds.includes(row.id)
            return matchesSearch && matchesStatus && matchesProgramme && matchesNeedsYou
        })
    }, [baseRows, isAllPrograms, onlyIds, programme, search, status])

    const metrics = useMemo(() => ({
        assigned: visibleByProgramme.length,
        pending: visibleByProgramme.filter((row) => row.status === 'Pending').length,
        active: activeRows.length,
        completed: visibleByProgramme.filter((row) => row.status === 'Completed').length,
    }), [activeRows.length, visibleByProgramme])

    useRegisterAgentPageContext({
        pageKey: 'operations-assigned-interventions',
        pageName: 'Assigned interventions',
        purpose: 'Track assigned interventions and demonstrate AI-assisted progress updates from unstructured notes.',
        filters: { search, status, view, programme: isAllPrograms ? programme : activeProgramId },
        metrics,
        tables: { visibleInterventions: filteredRows.length, active: activeRows.length, history: historyRows.length },
        selectedRecord: selected?.title,
    })

    const canAcceptOrDecline = (row: InterventionRow) => row.status === 'Pending' && normalize(row.assigneeStatus) === 'pending'

    const updateAcceptance = async (row: InterventionRow, accepted: boolean, declineReason = '') => {
        try {
            setSaving(true)
            await updateDoc(doc(db, 'assignedInterventions', row.id), {
                assigneeStatus: accepted ? 'accepted' : 'declined',
                // The SME accepts by signing the plan; only if they haven't yet is this waiting on them.
                status: accepted ? (normalize(row.participantStatus) === 'accepted' ? 'accepted' : 'awaiting_sme_acceptance') : 'declined',
                ...(accepted ? {} : { declineReason: declineReason.trim() || null, declinedAt: serverTimestamp() }),
                updatedAt: serverTimestamp(),
            })
            message.success(accepted ? t('Intervention accepted.') : t('Intervention declined.'))
            setSelected(undefined)
            await refresh()
        } catch {
            message.error(t('Intervention status could not be updated.'))
        } finally {
            setSaving(false)
        }
    }

    /** Declining can't be undone from here, so it asks first and keeps the reason for the programme team. */
    const confirmDecline = (row: InterventionRow) => {
        let reason = ''
        modal.confirm({
            title: t('Decline this intervention?'),
            content: (
                <Input.TextArea
                    rows={3}
                    maxLength={300}
                    placeholder={t('Why are you declining? (optional)')}
                    onChange={(event) => { reason = event.target.value }}
                    style={{ marginTop: 8 }}
                />
            ),
            closable: true,
            okText: t('Decline'),
            okButtonProps: { danger: true },
            footer: (_, { OkBtn }) => <OkBtn />,
            onOk: () => updateAcceptance(row, false, reason),
        })
    }

    const openUpdate = (mode: UpdateMode) => {
        setUpdateMode(mode)
        setUpdateOpen(true)
    }

    const canRecordFollowUp = followUpDue

    const saveFollowUp = async () => {
        if (!selected || !user) return
        const { entry, fields } = buildFollowUpResult(selected.raw as Record<string, unknown>, {
            result: followUpResult,
            note: followUpNote,
            actor: { uid: user.uid, name: user.displayName || user.email || '', role: user.role || '' },
        })
        try {
            setSaving(true)
            await updateDoc(doc(db, 'assignedInterventions', selected.id), { ...fields, outcomeHistory: arrayUnion(entry), updatedAt: serverTimestamp() })
            message.success(followUpResult === 'achieved' ? t('Follow-up recorded and closed.') : t('Follow-up recorded. A re-check is scheduled in 30 days.'))
            setFollowUpOpen(false)
            setSelected(undefined)
            await refresh()
        } catch {
            message.error(t('The follow-up could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const persistProgressUpdate =async (values: ProgressUpdateForm, source: UpdateMode) => {
        if (!selected) return

        const assignment = selected.raw
        const progressBefore = Number(assignment.progress || 0)
        const targetActualBefore = numberOrUndefined(assignment.targetActual) || 0
        const timeSpentBefore = numberOrUndefined(assignment.timeSpent) || 0
        const hoursAdded = numberOrUndefined(values.hoursAdded) || 0
        const unitsAdded = numberOrUndefined(values.unitsAdded) || 0
        const progressAfter = calculateProgressAfter(assignment, values)
        const targetActualAfter = calculateTargetActualAfter(assignment, values)
        const nextStatus = progressAfter >= 100 ? 'awaiting_confirmation' : 'in-progress'
        const evidenceFiles = values.evidenceFiles || []

        const hasEarlierEvidence = (assignment.progressSteps || []).some((step) => (step.evidenceFiles?.length ?? 0) > 0)
        if (progressAfter >= 100 && evidenceFiles.length === 0 && !hasEarlierEvidence) {
            message.error(`${t('Attach')} ${deliverableLabel(assignment.outcomeDefinition, t('proof of evidence'))} ${t('before marking this 100% complete.')}`)
            return
        }

        try {
            setSaving(true)
            let evidenceLinks: { name: string, url: string }[] = []
            try {
                const uploaded = await uploadEvidenceFiles(String(assignment.companyCode || user?.companyCode || ''), selected.id, values.evidenceUploads || [])
                evidenceLinks = uploaded.map(({ name, url }) => ({ name, url }))
            } catch {
                message.error(t('The evidence files could not be uploaded. Nothing was saved.'))
                return
            }
            await updateDoc(doc(db, 'assignedInterventions', selected.id), {
                progress: progressAfter,
                targetActual: targetActualAfter ?? null,
                timeSpent: timeSpentBefore + hoursAdded,
                notes: values.notes || '',
                status: nextStatus,
                assigneeStatus: 'accepted',
                assigneeCompletionStatus: progressAfter >= 100 ? 'done' : 'pending',
                updatedAt: serverTimestamp(),
                progressSteps: arrayUnion({
                    createdAt: Timestamp.now(),
                    actorUid: user?.uid || null,
                    actorRole: user?.role || null,
                    source,
                    hoursAdded,
                    unitsAdded,
                    progressBefore,
                    progressAfter,
                    timeSpentBefore,
                    timeSpentAfter: timeSpentBefore + hoursAdded,
                    targetActualBefore,
                    targetActualAfter: targetActualAfter ?? null,
                    notes: values.notes || '',
                    evidenceFiles,
                    evidenceLinks,
                }),
            })
            message.success(t('Progress updated.'))
            setUpdateOpen(false)
            setSelected(undefined)
            await refresh()
        } catch {
            message.error(t('Progress could not be updated.'))
        } finally {
            setSaving(false)
        }
    }

    const reviewAgentWork = async (decision: 'approved' | 'changes_requested') => {
        if (!selected) return
        const assignment = selected.raw as AssignedIntervention & Record<string, unknown>
        if (assignment.deliveryActorType !== 'agent' || assignment.reviewerType !== 'consultant') return
        setSaving(true)
        try {
            const approved = decision === 'approved'
            // One batch: the assignment and its agent run can't end up disagreeing about the review.
            const batch = writeBatch(db)
            batch.update(doc(db, 'assignedInterventions', selected.id), {
                reviewStatus: decision,
                agentWorkStatus: approved ? 'completed' : 'changes_requested',
                progress: approved ? 100 : 75,
                assigneeCompletionStatus: approved ? 'done' : 'in_progress',
                status: approved ? 'awaiting_confirmation' : 'in-progress',
                reviewedAt: serverTimestamp(),
                reviewedByUid: user?.uid || null,
                reviewedByEmail: user?.email || null,
                updatedAt: serverTimestamp(),
            })
            batch.update(doc(db, 'agentWorkRuns', selected.id), {
                status: approved ? 'completed' : 'changes_requested',
                reviewStatus: decision,
                reviewedAt: serverTimestamp(),
                reviewedByUid: user?.uid || null,
                reviewedByEmail: user?.email || null,
                updatedAt: serverTimestamp(),
            })
            await batch.commit()
            message.success(approved ? t('Agent work approved.') : t('Agent work returned for changes.'))
            setSelected(undefined)
            await refresh()
        } catch {
            message.error(t('The agent work review could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    // Overdue work you still hold can be put to operations: move the due date, or close it as no longer needed.
    const canAskForChange = (row: InterventionRow) => {
        const due = toDate(row.dueDate)
        return !!due && dayjs(due).isBefore(dayjs(), 'day') && !['Completed', 'Rejected'].includes(row.status) && !pendingChangeRequest(row.raw as { changeRequest?: unknown })
    }

    /** The detail modal's footer: only the actions this intervention allows right now, or no footer at all. */
    const detailActions = (row: InterventionRow) => {
        const raw = row.raw as Record<string, unknown>
        const awaitingAgentReview = row.raw.deliveryActorType === 'agent' && raw.reviewerType === 'consultant' && raw.agentWorkStatus === 'awaiting_review'
        // Accept or decline comes first; progress can only be logged on work you have accepted.
        const canUpdate = row.raw.deliveryActorType !== 'agent' && !['Completed', 'Rejected'].includes(row.status) && !canAcceptOrDecline(row)
        const actions = [
            canAcceptOrDecline(row) && <Button key="decline" icon={<CloseOutlined />} danger loading={saving} onClick={() => confirmDecline(row)}>{t('Decline')}</Button>,
            canAcceptOrDecline(row) && <Button key="accept" type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void updateAcceptance(row, true)}>{t('Accept')}</Button>,
            canUpdate && <Button key="update" icon={<SaveOutlined />} onClick={() => openUpdate('manual')}>{t('Update')}</Button>,
            canRecordFollowUp(row) && <Button key="followup" type="primary" onClick={() => { setFollowUpResult('achieved'); setFollowUpNote(''); setFollowUpOpen(true) }}>{t('Record follow-up')}</Button>,
            awaitingAgentReview && <Button key="changes" danger loading={saving} onClick={() => void reviewAgentWork('changes_requested')}>{t('Request changes')}</Button>,
            awaitingAgentReview && <Button key="approve" type="primary" loading={saving} onClick={() => void reviewAgentWork('approved')}>{t('Approve agent work')}</Button>,
            canAskForChange(row) && <Button key="change" icon={<FieldTimeOutlined />} onClick={() => setRequesting({ id: row.id, title: row.title, participant: row.beneficiaryName })}>{t('Extend or close')}</Button>,
        ].filter(Boolean)
        return actions.length ? actions : null
    }

    const programColumns: NonNullable<TableProps<InterventionRow>['columns']> = isAllPrograms
        ? [{ title: t('Program'), dataIndex: 'programmeName', render: (value?: string) => value || t('Unassigned') }]
        : []

    const columns: TableProps<InterventionRow>['columns'] = [
        {
            title: t('Intervention'),
            dataIndex: 'title',
            render: (value: string, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">{row.beneficiaryName}</Typography.Text>
                </Space>
            ),
        },
        ...programColumns,
        { title: t('Status'), dataIndex: 'status', render: (value: StatusFilter, row) => <Tag color={statusColor(value)}>{statusLabel(row)}</Tag> },
        { title: t('Progress'), dataIndex: 'progress', render: (value: number) => <Progress percent={value} size="small" /> },
        { title: t('Due'), dataIndex: 'dueDate', render: (value: unknown) => { const date = toDate(value); return date ? dayjs(date).format('DD MMM YYYY') : t('No due date') } },
        { title: t('Actions'), render: (_, row) => <Button icon={<EyeOutlined />} onClick={() => setSelected(row)}>{t('View')}</Button> },
    ]

    return (
        <DashboardPage className="operations-interventions-page ai-intervention-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Assigned')} value={metrics.assigned} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ClockCircleOutlined />} label={t('Pending')} value={metrics.pending} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ToolOutlined />} label={t('In progress')} value={metrics.active} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckOutlined />} label={t('Completed')} value={metrics.completed} /></Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <Input
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)} placeholder={t('Search intervention or SME name')}
                            allowClear
                        />
                        {isAllPrograms &&
                            <Select
                                value={programme}
                                onChange={setProgramme}
                                options={programmes.map((value) =>
                                    ({ value, label: value }))} />
                        }
                        <Select
                            value={status}
                            onChange={setStatus}
                            options={STATUS_OPTIONS[view].map((value) =>
                                ({ value, label: value === 'All' ? t('All statuses') : t(value) }))
                            } />
                    </>
                }
                actions={
                    <>
                        <Segmented value={view} onChange={(value) => { setView(value as ViewFilter); setStatus('All') }} options={[{ value: 'active', label: `${t('Active')} (${activeRows.length})` }, { value: 'history', label: `${t('History')} (${historyRows.length})` }, { value: 'followups', label: `${t('Follow-ups')} (${followUpRows.length})` }]} />
                        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>{t('Refresh')}</Button>
                    </>
                }
            />

            {onlyIds && (() => {
                // Counted against what's visible: the top-bar programme can hide some of the dashboard's list.
                const shown = visibleByProgramme.filter((row) => onlyIds.includes(row.id)).length
                return (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={shown === 1 ? t('Showing the intervention that needs you, from your dashboard.') : t('Showing the {count} interventions that need you, from your dashboard.', undefined, { count: shown })}
                    action={<Button size="small" onClick={() => setOnlyIds(null)}>{t('Show all')}</Button>}
                />
                )
            })()}
            <Card>
                <ResponsiveDataView
                    rowKey="id"
                    rows={filteredRows}
                    columns={columns}
                    loading={loading}
                    emptyText={t('No assigned interventions match the selected filters.')}
                    renderCard={(row) => (
                        <Space direction="vertical" size={8}>
                            <Typography.Text strong>{row.title}</Typography.Text>
                            <Typography.Text type="secondary">{row.beneficiaryName}</Typography.Text>
                            <Space wrap><Tag color={statusColor(row.status)}>{statusLabel(row)}</Tag><Tag>{row.progress}%</Tag></Space>
                            <Button onClick={() => setSelected(row)}>{t('View')}</Button>
                        </Space>
                    )}
                />
            </Card>

            <Modal
                open={!!selected}
                title={selected?.title}
                onCancel={() => setSelected(undefined)}
                width={820}
                // No Close button (the X does that): the footer holds only real actions, sharing the full row.
                footer={selected ? detailActions(selected) : null}
            >
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={[
                            { key: 'beneficiary', label: t('SME Name'), children: selected.beneficiaryName },
                            { key: 'status', label: t('Status'), children: <Tag color={statusColor(selected.status)}>{statusLabel(selected)}</Tag> },
                            { key: 'assignee', label: t('Facilitator acceptance'), children: formatStatus(selected.assigneeStatus) },
                            { key: 'participant', label: t('SME plan sign-off'), children: normalize(selected.participantStatus) === 'accepted' ? t('Signed') : normalize(selected.participantStatus) === 'declined' ? t('Declined') : t('Not signed yet') },
                            { key: 'completion', label: t('Completion confirmation'), children: formatStatus(selected.completionStatus) },
                            { key: 'due', label: t('Due date'), children: toDate(selected.dueDate) ? dayjs(toDate(selected.dueDate)!).format('DD MMM YYYY') : t('No due date') },
                            { key: 'delivery', label: t('Delivery'), children: selected.raw.deliveryActorType === 'agent' ? <Tag color="purple">{String((selected.raw as Record<string, unknown>).agentName || t('Agent'))}</Tag> : <Tag color="blue">{t('Human')}</Tag> },
                            ...(() => { const followUp = followUpState(selected.raw as Record<string, unknown>); if (!followUp) return []; const color = followUp.state === 'overdue' ? 'red' : followUp.state === 'due_soon' ? 'gold' : followUp.state === 'done' ? 'green' : 'blue'; const label = followUp.state === 'overdue' ? t('Follow-up overdue') : followUp.state === 'done' ? t('Follow-up done') : t('Follow-up due'); return [{ key: 'followUp', label: t('Follow-up'), children: <Tag color={color}>{`${label} · ${dayjs(followUp.dueAt).format('DD MMM YYYY')}`}</Tag> }] })(),
                            ...(() => {
                                const last = (selected.raw as Record<string, unknown>).outcomeResult as { result?: FollowUpResult; note?: string } | undefined
                                if (!last?.result) return []
                                const option = FOLLOW_UP_RESULT_OPTIONS.find((item) => item.value === last.result)
                                return [{ key: 'lastOutcome', label: t('Last follow-up result'), children: `${t(option?.label || '')}${last.note ? ` - ${last.note}` : ''}` }]
                            })(),
                            ...(() => {
                                // The SME's own check-back, next to the facilitator's result (src/services/smeCheckbackService.ts).
                                const sme = smeCheckbackHistory(selected.raw as Record<string, unknown>).at(-1)
                                if (!sme) return []
                                const option = SME_CHECKBACK_ANSWERS.find((item) => item.value === sme.answer)
                                return [{ key: 'smeCheckback', label: t('SME check-back'), children: `${t(option?.label || '')}${sme.note ? ` - ${sme.note}` : ''}` }]
                            })(),
                            { key: 'review', label: t('Review status'), children: formatStatus(String((selected.raw as Record<string, unknown>).reviewStatus || 'Not required')) },
                        ]} />
                        <Progress percent={selected.progress} />

                        {(selected.raw.progressSteps?.length ?? 0) > 0 && (
                            <Card size="small" title={t('Progress history')}>
                                <Timeline
                                    items={[...selected.raw.progressSteps!].reverse().map((step, index) => ({
                                        key: index,
                                        color: (step.progressAfter ?? 0) >= 100 ? 'green' : 'blue',
                                        children: (
                                            <Space direction="vertical" size={2}>
                                                <Space wrap>
                                                    <Typography.Text strong>{step.progressBefore ?? 0}% {'→'} {step.progressAfter ?? 0}%</Typography.Text>
                                                    <Tag>{formatStatus(step.source || 'manual')}</Tag>
                                                </Space>
                                                <Typography.Text type="secondary">
                                                    {toDate(step.createdAt) ? dayjs(toDate(step.createdAt)!).format('DD MMM YYYY, HH:mm') : t('Unknown date')}
                                                    {step.actorRole ? ` · ${formatStatus(step.actorRole)}` : ''}
                                                </Typography.Text>
                                                {step.notes && <Typography.Text>{step.notes}</Typography.Text>}
                                                {(step.evidenceFiles?.length ?? 0) > 0 && (
                                                    <Space wrap>
                                                        {step.evidenceFiles!.map((file) => {
                                                            // Agent deliverables carry a link, so the evidence can be opened right here.
                                                            const link = step.evidenceLinks?.find((item) => item.name === file)
                                                            return link
                                                                ? <Tag key={file} icon={<PaperClipOutlined />} color="purple"><a href={link.url} target="_blank" rel="noopener noreferrer">{file}</a></Tag>
                                                                : <Tag key={file} icon={<PaperClipOutlined />}>{file}</Tag>
                                                        })}
                                                    </Space>
                                                )}
                                            </Space>
                                        ),
                                    }))}
                                />
                            </Card>
                        )}

                    </Space>
                )}
            </Modal>

            <Modal
                open={followUpOpen}
                title={t('Record follow-up')}
                onCancel={() => setFollowUpOpen(false)}
                footer={<Button type="primary" loading={saving} onClick={() => void saveFollowUp()}>{t('Save')}</Button>}
                destroyOnClose
            >
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {selected?.raw.outcomeDefinition?.intendedOutcome && (
                        <Typography.Text type="secondary">{t('Intended outcome')}: {selected.raw.outcomeDefinition.intendedOutcome}</Typography.Text>
                    )}
                    {/* Shown only once the SME has answered this round themselves, so it informs the facilitator rather than leading. */}
                    {(() => {
                        const raw = (selected?.raw || {}) as Record<string, unknown>
                        const round = Math.max(Number(raw.followUpRound || 0), Array.isArray(raw.outcomeHistory) ? raw.outcomeHistory.length : 0) + 1
                        const sme = smeAnswerForRound(raw, round)
                        if (!sme) return null
                        const option = SME_CHECKBACK_ANSWERS.find((item) => item.value === sme.answer)
                        return <Alert type="info" showIcon title={t('The SME said: {answer}', undefined, { answer: t(option?.label || '') })} description={sme.note || undefined} />
                    })()}
                    <Typography.Text strong>{t('Has this change happened?')}</Typography.Text>
                    <Segmented block value={followUpResult} onChange={(value) => setFollowUpResult(value as FollowUpResult)} options={FOLLOW_UP_RESULT_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))} />
                    <Input.TextArea rows={3} maxLength={500} value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} placeholder={t('What did you observe? (optional)')} />
                    <Typography.Text type="secondary">{t('Recorded as your observation as facilitator. Not yet or Partially schedules another check in 30 days.')}</Typography.Text>
                </Space>
            </Modal>

            <AIInterventionUpdateModal
                open={updateOpen}
                row={selected}
                mode={updateMode}
                saving={saving}
                onCancel={() => setUpdateOpen(false)}
                onApply={(values, source) => void persistProgressUpdate(values, source)}
            />
            <ChangeRequestModal assignment={requesting} onClose={() => setRequesting(null)} onSent={() => { setSelected(undefined); void refresh() }} />
        </DashboardPage>
    )
}

export default AllocatedInterventions
