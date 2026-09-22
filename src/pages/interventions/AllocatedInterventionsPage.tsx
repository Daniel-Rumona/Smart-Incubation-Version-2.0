import { App, Button, Card, Col, Descriptions, Input, Modal, Progress, Row, Segmented, Select, Space, Tag, Timeline, Typography, type TableProps } from 'antd'
import { CheckOutlined, ClockCircleOutlined, CloseOutlined, EyeOutlined, PaperClipOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, TeamOutlined, ToolOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { arrayUnion, doc, serverTimestamp, Timestamp, updateDoc } from 'firebase/firestore'
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
import type { AssignedInterventionLike, InterventionRow, ProgressUpdateForm, StatusFilter, UpdateMode } from '@/types/interventions'
import { formatStatus } from '@/utils/status'

type ViewFilter = 'active' | 'history'

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
    if (assigneeCompletion === 'done' || rawStatus.includes('awaiting')) return 'In progress'
    if (assigneeStatus === 'accepted' && participantStatus === 'accepted') return 'In progress'
    return 'Pending'
}

const statusColor = (status: StatusFilter) => {
    if (status === 'Completed') return 'green'
    if (status === 'Rejected') return 'red'
    if (status === 'In progress') return 'blue'
    if (status === 'Pending') return 'gold'
    return 'default'
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
        title: String(assignment.interventionTitle || 'Intervention'),
        beneficiaryName: String(assignment.businessName || 'Unassigned SME'),
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
    const { message } = App.useApp()
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
    const [updateMode, setUpdateMode] = useState<UpdateMode>('manual')
    const [updateOpen, setUpdateOpen] = useState(false)
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

    const activeRows = useMemo(() => visibleByProgramme.filter((row) => !['Completed', 'Rejected'].includes(row.status)), [visibleByProgramme])
    const historyRows = useMemo(() => visibleByProgramme.filter((row) => ['Completed', 'Rejected'].includes(row.status)), [visibleByProgramme])
    const baseRows = view === 'active' ? activeRows : historyRows

    const programmes = useMemo(() => {
        return ['All', ...Array.from(new Set(visibleByProgramme.map((row) => row.programmeName).filter(Boolean))).sort()]
    }, [visibleByProgramme])

    const filteredRows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return baseRows.filter((row) => {
            const matchesSearch = !needle || `${row.title} ${row.beneficiaryName} ${row.programmeName}`.toLowerCase().includes(needle)
            const matchesStatus = status === 'All' || row.status === status
            const matchesProgramme = !isAllPrograms || programme === 'All' || row.programmeName === programme
            return matchesSearch && matchesStatus && matchesProgramme
        })
    }, [baseRows, isAllPrograms, programme, search, status])

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

    const updateAcceptance = async (row: InterventionRow, accepted: boolean) => {
        try {
            setSaving(true)
            await updateDoc(doc(db, 'assignedInterventions', row.id), {
                assigneeStatus: accepted ? 'accepted' : 'declined',
                status: accepted ? 'awaiting_sme_acceptance' : 'declined',
                updatedAt: serverTimestamp(),
            })
            message.success(accepted ? 'Intervention accepted.' : 'Intervention declined.')
            setSelected(undefined)
            await refresh()
        } catch {
            message.error('Intervention status could not be updated.')
        } finally {
            setSaving(false)
        }
    }

    const openUpdate = (mode: UpdateMode) => {
        setUpdateMode(mode)
        setUpdateOpen(true)
    }

    const persistProgressUpdate = async (values: ProgressUpdateForm, source: UpdateMode) => {
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

        if (progressAfter >= 100 && evidenceFiles.length === 0) {
            message.error('Attach proof of evidence before marking this 100% complete.')
            return
        }

        try {
            setSaving(true)
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
                }),
            })
            message.success('Progress updated.')
            setUpdateOpen(false)
            setSelected(undefined)
            await refresh()
        } catch {
            message.error('Progress could not be updated.')
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
            await Promise.all([
                updateDoc(doc(db, 'assignedInterventions', selected.id), {
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
                updateDoc(doc(db, 'agentWorkRuns', selected.id), {
                    status: approved ? 'completed' : 'changes_requested',
                    reviewStatus: decision,
                    reviewedAt: serverTimestamp(),
                    reviewedByUid: user?.uid || null,
                    reviewedByEmail: user?.email || null,
                    updatedAt: serverTimestamp(),
                }),
            ])
            message.success(approved ? 'Agent work approved.' : 'Agent work returned for changes.')
            setSelected(undefined)
            await refresh()
        } catch {
            message.error('The agent work review could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    const programColumns: NonNullable<TableProps<InterventionRow>['columns']> = isAllPrograms
        ? [{ title: 'Program', dataIndex: 'programmeName', render: (value?: string) => value || 'Unassigned' }]
        : []

    const columns: TableProps<InterventionRow>['columns'] = [
        {
            title: 'Intervention',
            dataIndex: 'title',
            render: (value: string, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">{row.beneficiaryName}</Typography.Text>
                </Space>
            ),
        },
        ...programColumns,
        { title: 'Status', dataIndex: 'status', render: (value: StatusFilter) => <Tag color={statusColor(value)}>{value}</Tag> },
        { title: 'Progress', dataIndex: 'progress', render: (value: number) => <Progress percent={value} size="small" /> },
        { title: 'Due', dataIndex: 'dueDate', render: (value: unknown) => { const date = toDate(value); return date ? dayjs(date).format('DD MMM YYYY') : 'No due date' } },
        { title: 'Actions', render: (_, row) => <Button icon={<EyeOutlined />} onClick={() => setSelected(row)}>View</Button> },
    ]

    return (
        <DashboardPage className="operations-interventions-page ai-intervention-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label="Assigned" value={metrics.assigned} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ClockCircleOutlined />} label="Pending" value={metrics.pending} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ToolOutlined />} label="In progress" value={metrics.active} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckOutlined />} label="Completed" value={metrics.completed} /></Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <Input
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)} placeholder="Search intervention or SME name"
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
                            options={['All', 'Pending', 'In progress', 'Completed', 'Rejected'].map((value) =>
                                ({ value, label: value }))
                            } />
                    </>
                }
                actions={
                    <>
                        <Segmented value={view} onChange={(value) => setView(value as ViewFilter)} options={[{ value: 'active', label: `Active (${activeRows.length})` }, { value: 'history', label: `History (${historyRows.length})` }]} />
                        <Button icon={<ReloadOutlined />} onClick={() => void refresh()}>Refresh</Button>
                    </>
                }
            />

            <Card>
                <ResponsiveDataView
                    rowKey="id"
                    rows={filteredRows}
                    columns={columns}
                    loading={loading}
                    emptyText="No assigned interventions match the selected filters."
                    renderCard={(row) => (
                        <Space direction="vertical" size={8}>
                            <Typography.Text strong>{row.title}</Typography.Text>
                            <Typography.Text type="secondary">{row.beneficiaryName}</Typography.Text>
                            <Space wrap><Tag color={statusColor(row.status)}>{row.status}</Tag><Tag>{row.progress}%</Tag></Space>
                            <Button onClick={() => setSelected(row)}>View</Button>
                        </Space>
                    )}
                />
            </Card>

            <Modal open={!!selected} title={selected?.title} onCancel={() => setSelected(undefined)} footer={null} width={820}>
                {selected && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Descriptions bordered size="small" column={{ xs: 1, md: 2 }} items={[
                            { key: 'beneficiary', label: 'SME Name', children: selected.beneficiaryName },
                            { key: 'status', label: 'Status', children: <Tag color={statusColor(selected.status)}>{selected.status}</Tag> },
                            { key: 'assignee', label: 'Facilitator acceptance', children: formatStatus(selected.assigneeStatus) },
                            { key: 'participant', label: 'SME acceptance', children: formatStatus(selected.participantStatus) },
                            { key: 'completion', label: 'Completion confirmation', children: formatStatus(selected.completionStatus) },
                            { key: 'due', label: 'Due date', children: toDate(selected.dueDate) ? dayjs(toDate(selected.dueDate)!).format('DD MMM YYYY') : 'No due date' },
                            { key: 'delivery', label: 'Delivery', children: selected.raw.deliveryActorType === 'agent' ? <Tag color="purple">{String((selected.raw as Record<string, unknown>).agentName || 'Agent')}</Tag> : <Tag color="blue">Human</Tag> },
                            { key: 'review', label: 'Review status', children: formatStatus(String((selected.raw as Record<string, unknown>).reviewStatus || 'Not required')) },
                        ]} />
                        <Progress percent={selected.progress} />

                        {(selected.raw.progressSteps?.length ?? 0) > 0 && (
                            <Card size="small" title="Progress history">
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
                                                    {toDate(step.createdAt) ? dayjs(toDate(step.createdAt)!).format('DD MMM YYYY, HH:mm') : 'Unknown date'}
                                                    {step.actorRole ? ` · ${formatStatus(step.actorRole)}` : ''}
                                                </Typography.Text>
                                                {step.notes && <Typography.Text>{step.notes}</Typography.Text>}
                                                {(step.evidenceFiles?.length ?? 0) > 0 && (
                                                    <Space wrap>
                                                        {step.evidenceFiles!.map((file) => <Tag key={file} icon={<PaperClipOutlined />}>{file}</Tag>)}
                                                    </Space>
                                                )}
                                            </Space>
                                        ),
                                    }))}
                                />
                            </Card>
                        )}

                        <Space wrap style={{ justifyContent: 'flex-end', width: '100%' }}>
                            <Button onClick={() => setSelected(undefined)}>Close</Button>
                            {selected.raw.deliveryActorType !== 'agent' && !['Completed', 'Rejected'].includes(selected.status) && <Button icon={<SaveOutlined />} onClick={() => openUpdate('manual')}>Update</Button>}
                            {selected.raw.deliveryActorType === 'agent' && (selected.raw as Record<string, unknown>).reviewerType === 'consultant' && (selected.raw as Record<string, unknown>).agentWorkStatus === 'awaiting_review' && (
                                <>
                                    <Button type="primary" loading={saving} onClick={() => void reviewAgentWork('approved')}>Approve agent work</Button>
                                    <Button danger loading={saving} onClick={() => void reviewAgentWork('changes_requested')}>Request changes</Button>
                                </>
                            )}
                            {canAcceptOrDecline(selected) && (
                                <>
                                    <Button icon={<CloseOutlined />} danger loading={saving} onClick={() => void updateAcceptance(selected, false)}>Decline</Button>
                                    <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void updateAcceptance(selected, true)}>Accept</Button>
                                </>
                            )}
                        </Space>
                    </Space>
                )}
            </Modal>

            <AIInterventionUpdateModal
                open={updateOpen}
                row={selected}
                mode={updateMode}
                saving={saving}
                onCancel={() => setUpdateOpen(false)}
                onApply={(values, source) => void persistProgressUpdate(values, source)}
            />
        </DashboardPage>
    )
}

export default AllocatedInterventions
