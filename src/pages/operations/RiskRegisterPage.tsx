import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Input, Modal, Pagination, Row, Segmented, Select, Space, Table, Tag, theme, Typography, message } from 'antd'
import { ClockCircleOutlined, ExclamationCircleOutlined, FileDoneOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'

import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { db } from '@/firebase/config'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listComplianceRows } from '@/services/complianceService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { formatStatus } from '@/utils/status'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type Status = 'missing' | 'uploaded' | 'pending' | 'valid' | 'rejected' | 'invalid' | 'expired' | 'queried'
type Filter = 'all' | Severity
type EntityFilter = 'all' | RiskRow['entityType']

type RiskDetailItem = { label: string, status: string }

type RiskRow = {
    key: string
    category: string
    entityType: 'SME' | 'Intervention' | 'Consultant'
    entityName: string
    owner: string
    issue: string
    /** Per-item breakdown (e.g. one row per document) shown as a small table in the detail modal. */
    detail?: RiskDetailItem[]
    severity: Severity
    dueDate: Dayjs | null
    action: string
    actionRoute: string
    /** The record this risk is actually about, so "Take Action" can land on it instead of just the list page. */
    focus: { kind: 'participant', participantId: string } | { kind: 'intervention', interventionId: string }
}

type ParticipantRow = {
    participantId: string
    businessName: string
    required: Array<{ key: string, title: string, hasExpiry?: boolean }>
    documents: Array<{
        key?: string
        type?: string
        currentStatus?: Status
        currentFile?: { expiryDate?: string | null }
    }>
}

type InterventionRow = {
    id: string
    programId?: string | null
    participantId?: string | null
    smmeId?: string | null
    smeId?: string | null
    participantName?: string | null
    beneficiaryName?: string | null
    businessName?: string | null
    smmeName?: string | null
    companyName?: string | null
    interventionTitle?: string | null
    title?: string | null
    assigneeName?: string | null
    status?: string | null
    assigneeCompletionStatus?: string | null
    participantCompletionStatus?: string | null
    participantStatus?: string | null
    dueDate?: unknown
    completedAt?: unknown
    completionConfirmedAt?: unknown
}

const cleanKey = (value?: string) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const toDayjs = (value: unknown) => {
    if (!value) return dayjs('')
    if (value instanceof Date) return dayjs(value)
    if (typeof value === 'string') return dayjs(value)
    if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return dayjs(value.toDate())
    if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') return dayjs(value.seconds * 1000)
    return dayjs('')
}

const isCompleted = (row: InterventionRow) => {
    const status = String(row.status || '').toLowerCase()
    const assignee = String(row.assigneeCompletionStatus || '').toLowerCase()
    const participant = String(row.participantCompletionStatus || '').toLowerCase()

    return status === 'completed' || Boolean(row.completedAt) || Boolean(row.completionConfirmedAt) || (assignee === 'done' && participant === 'confirmed')
}

const includesAny = (value: unknown, terms: string[]) => {
    const normalized = String(value || '').toLowerCase()
    return terms.some(term => normalized.includes(term))
}

const BLOCKING_STATUSES = ['missing', 'expired', 'invalid', 'rejected']
const PENDING_STATUSES = ['pending', 'uploaded', 'queried']
const STATUS_SUMMARY_ORDER = [...BLOCKING_STATUSES, ...PENDING_STATUSES]

/** "2 missing, 1 expired" instead of either a flat count (which hides what's actually wrong) or a full list of every document name (which is too much for a card). */
const summarizeByReason = (items: RiskDetailItem[]) => {
    const counts = new Map<string, number>()
    items.forEach(item => counts.set(item.status, (counts.get(item.status) || 0) + 1))
    return STATUS_SUMMARY_ORDER
        .filter(status => counts.has(status))
        .map(status => `${counts.get(status)} ${status}`)
        .join(', ')
}

const getSeverityTag = (severity: Severity) => {
    if (severity === 'critical') return <Tag color="red">Critical</Tag>
    if (severity === 'high') return <Tag color="volcano">High</Tag>
    if (severity === 'medium') return <Tag color="orange">Medium</Tag>
    return <Tag color="blue">Low</Tag>
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_COLOR: Record<Severity, string> = { critical: '#EF4444', high: '#F97316', medium: '#F59E0B', low: '#3B82F6' }
const CARD_PAGE_SIZE = 8

const hexToRgba = (hex: string, alpha: number) => {
    const value = hex.replace('#', '')
    const r = parseInt(value.substring(0, 2), 16)
    const g = parseInt(value.substring(2, 4), 16)
    const b = parseInt(value.substring(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const RiskCategoryRow = ({ label, count, severity, selected, onClick }: {
    label: string
    count: number
    severity: Severity | null
    selected: boolean
    onClick: () => void
}) => {
    const { token } = theme.useToken()
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 10,
                border: `1px solid ${selected ? token.colorPrimary : 'transparent'}`,
                background: selected ? token.colorPrimaryBg : 'transparent',
                cursor: 'pointer',
            }}
        >
            <Space size={8} style={{ minWidth: 0 }}>
                {severity && <span style={{ width: 8, height: 8, borderRadius: '50%', background: SEVERITY_COLOR[severity], flexShrink: 0 }} />}
                <Typography.Text ellipsis style={{ fontWeight: selected ? 600 : 400 }}>{label}</Typography.Text>
            </Space>
            <Tag style={{ marginInlineEnd: 0, flexShrink: 0 }}>{count}</Tag>
        </button>
    )
}

const RiskCard = ({ row, onClick }: { row: RiskRow, onClick: () => void }) => {
    const overdue = row.dueDate?.isValid() && row.dueDate.isBefore(dayjs(), 'day')
    const accent = SEVERITY_COLOR[row.severity]
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '16px 18px',
                borderRadius: 16,
                border: `1px solid ${hexToRgba(accent, 0.35)}`,
                background: `linear-gradient(135deg, ${hexToRgba(accent, 0.2)}, ${hexToRgba(accent, 0.06)})`,
                backdropFilter: 'blur(14px)',
                WebkitBackdropFilter: 'blur(14px)',
                boxShadow: `0 8px 24px ${hexToRgba(accent, 0.16)}, inset 0 1px 0 ${hexToRgba('#ffffff', 0.15)}`,
                cursor: 'pointer',
                transition: 'transform .15s ease, box-shadow .15s ease',
            }}
        >
            <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
                <div style={{ minWidth: 0 }}>
                    <Typography.Text strong ellipsis style={{ display: 'block', maxWidth: 260 }}>{row.entityName}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.entityType} · {row.category}</Typography.Text>
                </div>
                {getSeverityTag(row.severity)}
            </Space>
            <Typography.Text style={{ fontSize: 13 }}>{row.issue}</Typography.Text>
            <Space size={10} wrap style={{ fontSize: 12 }}>
                <Typography.Text type="secondary">Owner: {row.owner}</Typography.Text>
                {row.dueDate?.isValid()
                    ? <Tag color={overdue ? 'red' : undefined} style={{ marginInlineEnd: 0 }}>{row.dueDate.format('DD MMM YYYY')}</Tag>
                    : <Tag style={{ marginInlineEnd: 0 }}>Operational follow-up</Tag>}
            </Space>
        </button>
    )
}

const buildRows = (participants: ParticipantRow[], interventions: InterventionRow[]): RiskRow[] => {
    const rows: RiskRow[] = []
    const participantNames = new Map(participants.map(row => [row.participantId, row.businessName]))
    const interventionParticipantIds = new Set(interventions.map(row => row.participantId || row.smmeId || row.smeId).filter(Boolean))

    participants.forEach(participant => {
        const blockingDocs: RiskDetailItem[] = []
        const pendingDocs: RiskDetailItem[] = []
        participant.required.forEach(req => {
            const doc = participant.documents.find(item => cleanKey(item.key || item.type) === req.key)
            const expiry = doc?.currentFile?.expiryDate ? dayjs(doc.currentFile.expiryDate) : null
            const status = !doc
                ? 'missing'
                : req.hasExpiry && expiry?.isValid() && expiry.isBefore(dayjs(), 'day')
                    ? 'expired'
                    : doc.currentStatus || 'pending'

            if (BLOCKING_STATUSES.includes(status)) blockingDocs.push({ label: req.title, status })
            else if (PENDING_STATUSES.includes(status)) pendingDocs.push({ label: req.title, status })
        })
        const blockers = blockingDocs.length
        const pending = pendingDocs.length

        if (blockers || pending) {
            const issueParts = [
                blockingDocs.length ? `Blocking: ${summarizeByReason(blockingDocs)}` : null,
                pendingDocs.length ? `Pending review: ${summarizeByReason(pendingDocs)}` : null,
            ].filter(Boolean)
            rows.push({
                key: `compliance-${participant.participantId}`,
                category: 'Compliance readiness',
                entityType: 'SME',
                entityName: participant.businessName,
                owner: 'Operations',
                issue: issueParts.join(' · '),
                detail: [...blockingDocs, ...pendingDocs],
                severity: blockers >= 3 ? 'critical' : blockers > 0 ? 'high' : 'medium',
                dueDate: null,
                action: blockers ? 'Clear required document blockers' : 'Review pending/queried documents',
                actionRoute: '/operations/participants/compliance',
                focus: { kind: 'participant', participantId: participant.participantId },
            })
        }

        if (!interventionParticipantIds.has(participant.participantId)) {
            rows.push({
                key: `non-serviced-${participant.participantId}`,
                category: 'Interventions: non-serviced',
                entityType: 'SME',
                entityName: participant.businessName,
                owner: 'Operations',
                issue: 'No assigned intervention recorded for this SME',
                severity: 'high',
                dueDate: null,
                action: 'Assign first intervention',
                actionRoute: '/operations/interventions/assign',
                focus: { kind: 'participant', participantId: participant.participantId },
            })
        }
    })

    interventions.forEach(row => {
        const dueDate = toDayjs(row.dueDate)
        const overdue = dueDate.isValid() && dueDate.isBefore(dayjs(), 'day') && !isCompleted(row)
        const participantId = row.participantId || row.smmeId || row.smeId || ''
        const participantName = row.beneficiaryName || row.participantName || row.businessName || row.smmeName || row.companyName || participantNames.get(participantId) || 'Unknown SME'
        const title = row.interventionTitle || 'Untitled intervention'
        const owner = row.assigneeName || 'Operations'

        if (overdue) {
            const daysLate = dayjs().diff(dueDate, 'day')
            rows.push({
                key: `overdue-${row.id}`,
                category: 'Interventions: overdue',
                entityType: 'Intervention',
                entityName: title,
                owner,
                issue: `${participantName} is ${daysLate} day${daysLate === 1 ? '' : 's'} overdue (was due ${dueDate.format('DD MMM YYYY')}, status: ${formatStatus(row.status || 'pending')})`,
                severity: daysLate >= 14 ? 'critical' : 'high',
                dueDate,
                action: 'Escalate overdue intervention',
                actionRoute: '/operations/interventions',
                focus: { kind: 'intervention', interventionId: row.id },
            })
        }

        const participantStatus = String((row as InterventionRow & { participantStatus?: string }).participantStatus || '').toLowerCase()
        const waitingOnParticipant = participantStatus !== 'accepted'
            && participantStatus !== 'declined'
            && [row.status, row.participantCompletionStatus, participantStatus].some(value => includesAny(value, ['participant', 'beneficiary', 'sme', 'smme', 'acceptance', 'confirmation', 'response']))
        if (!isCompleted(row) && waitingOnParticipant) {
            rows.push({ key: `sme-${row.id}`, category: 'SME non-responsive', entityType: 'SME', entityName: participantName, owner: 'Operations', issue: `Waiting on SME response for "${title}" (current status: ${formatStatus(row.participantStatus || row.status || 'pending')})`, severity: overdue ? 'high' : 'medium', dueDate: dueDate.isValid() ? dueDate : null, action: 'Contact SME and record outcome', actionRoute: '/operations/interventions', focus: { kind: 'intervention', interventionId: row.id } })
        }

        if (!isCompleted(row) && [row.status, row.assigneeCompletionStatus].some(value => includesAny(value, ['assignee', 'consultant', 'coordinator', 'provider', 'delivery']))) {
            rows.push({ key: `consultant-${row.id}`, category: 'Consultant follow-up', entityType: 'Consultant', entityName: owner, owner: 'Operations', issue: `"${title}" for ${participantName} needs ${owner}'s action (current status: ${formatStatus(row.assigneeCompletionStatus || row.status || 'pending')})`, severity: overdue ? 'high' : 'medium', dueDate: dueDate.isValid() ? dueDate : null, action: 'Follow up with delivery owner', actionRoute: '/operations/interventions', focus: { kind: 'intervention', interventionId: row.id } })
        }
    })

    return rows.sort((a, b) => ({ critical: 0, high: 1, medium: 2, low: 3 }[a.severity] - { critical: 0, high: 1, medium: 2, low: 3 }[b.severity]))
}

export default function RiskRegisterPage() {
    const navigate = useNavigate()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { user, loading: identityLoading } = useFullIdentity()
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState<Filter>('all')
    const [entityFilter, setEntityFilter] = useState<EntityFilter>('all')
    const [selectedCategory, setSelectedCategory] = useState<string>('all')
    const [search, setSearch] = useState('')
    const [rows, setRows] = useState<RiskRow[]>([])
    const [selectedRisk, setSelectedRisk] = useState<RiskRow | null>(null)
    const [cardPage, setCardPage] = useState(1)

    const load = useCallback(async () => {
        if (identityLoading) return
        setLoading(true)
        try {
            const compliance = await listComplianceRows({ activeProgramId, departmentId: user?.departmentId || null, user })
            const constraints: QueryConstraint[] = []
            if (!isAllPrograms && activeProgramId) constraints.push(where('programId', '==', activeProgramId))
            const snap = await getDocs(query(collection(db, 'assignedInterventions'), ...constraints))
            setRows(buildRows(
                compliance.rows as unknown as ParticipantRow[],
                snap.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }) as InterventionRow)
                    .filter(row => matchesActiveProgram(user, activeProgramId, row.programId)),
            ))
        } catch (error) {
            console.error('[RISK REGISTER] Failed loading risk register:', error)
            message.error('Risk register could not be loaded.')
            setRows([])
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, identityLoading, isAllPrograms, user])

    useEffect(() => {
        void load()
    }, [load])

    const baseFilteredRows = useMemo(() => {
        const query = search.trim().toLowerCase()

        return rows.filter(row => {
            if (filter !== 'all' && row.severity !== filter) return false
            if (entityFilter !== 'all' && row.entityType !== entityFilter) return false
            if (!query) return true

            return [
                row.category,
                row.entityType,
                row.entityName,
                row.owner,
                row.issue,
                row.action,
            ].some(value => value.toLowerCase().includes(query))
        })
    }, [entityFilter, filter, rows, search])

    const categorySummaries = useMemo(() => {
        const map = new Map<string, { count: number, worst: Severity }>()
        baseFilteredRows.forEach(row => {
            const existing = map.get(row.category)
            if (!existing) map.set(row.category, { count: 1, worst: row.severity })
            else {
                existing.count += 1
                if (SEVERITY_RANK[row.severity] < SEVERITY_RANK[existing.worst]) existing.worst = row.severity
            }
        })
        return Array.from(map.entries())
            .map(([category, info]) => ({ category, ...info }))
            .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.count - a.count)
    }, [baseFilteredRows])

    useEffect(() => {
        setSelectedCategory('all')
        setCardPage(1)
    }, [filter, entityFilter, search])

    const filteredRows = useMemo(
        () => selectedCategory === 'all' ? baseFilteredRows : baseFilteredRows.filter(row => row.category === selectedCategory),
        [baseFilteredRows, selectedCategory],
    )

    const pagedRows = useMemo(() => {
        const start = (cardPage - 1) * CARD_PAGE_SIZE
        return filteredRows.slice(start, start + CARD_PAGE_SIZE)
    }, [filteredRows, cardPage])

    const metrics = useMemo(() => {
        const overdue = rows.filter(row => row.dueDate?.isValid() && row.dueDate.isBefore(dayjs(), 'day')).length
        return {
            total: rows.length,
            urgent: rows.filter(row => row.severity === 'critical' || row.severity === 'high').length,
            overdue,
            owners: new Set(rows.map(row => row.owner).filter(Boolean)).size,
        }
    }, [rows])

    return (
        <DashboardPage className="operations-risk-register-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={identityLoading || loading} icon={<ExclamationCircleOutlined />} iconClassName="dashboard-icon-red" label="Open Risks" value={metrics.total} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={identityLoading || loading} icon={<ClockCircleOutlined />} iconClassName="dashboard-icon-orange" label="Critical / High" value={metrics.urgent} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={identityLoading || loading} icon={<FileDoneOutlined />} iconClassName="dashboard-icon-blue" label="Overdue" value={metrics.overdue} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={identityLoading || loading} icon={<TeamOutlined />} iconClassName="dashboard-icon-green" label="Owners" value={metrics.owners} />
                </Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <Segmented value={filter} onChange={value => setFilter(value as Filter)} options={[{ label: 'All', value: 'all' }, { label: 'Critical', value: 'critical' }, { label: 'High', value: 'high' }, { label: 'Medium', value: 'medium' }, { label: 'Low', value: 'low' }]} />
                        <Select value={entityFilter} onChange={value => setEntityFilter(value)} options={[{ label: 'All records', value: 'all' }, { label: 'SMEs', value: 'SME' }, { label: 'Interventions', value: 'Intervention' }, { label: 'Consultants', value: 'Consultant' }]} />
                        <Input prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder="Search risk, owner, SME, intervention..." allowClear />
                    </>
                }
            />

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={5}>
                    <Card loading={identityLoading || loading} className="dashboard-section-card motion-card" title="Risk Categories">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <RiskCategoryRow
                                label="All categories"
                                count={baseFilteredRows.length}
                                severity={null}
                                selected={selectedCategory === 'all'}
                                onClick={() => { setSelectedCategory('all'); setCardPage(1) }}
                            />
                            {categorySummaries.map(summary => (
                                <RiskCategoryRow
                                    key={summary.category}
                                    label={summary.category}
                                    count={summary.count}
                                    severity={summary.worst}
                                    selected={selectedCategory === summary.category}
                                    onClick={() => { setSelectedCategory(summary.category); setCardPage(1) }}
                                />
                            ))}
                            {!categorySummaries.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No risks match this filter." style={{ margin: '20px 0' }} />}
                        </div>
                    </Card>
                </Col>
                <Col xs={24} lg={19}>
                    <Card
                        loading={identityLoading || loading}
                        className="dashboard-section-card motion-card"
                        title={selectedCategory === 'all' ? 'All Risks' : selectedCategory}
                        extra={<Typography.Text type="secondary">Click a risk for details</Typography.Text>}
                    >
                        {filteredRows.length ? (
                            <>
                                <Row gutter={[12, 12]}>
                                    {pagedRows.map(row => (
                                        <Col xs={24} md={12} key={row.key}>
                                            <RiskCard row={row} onClick={() => setSelectedRisk(row)} />
                                        </Col>
                                    ))}
                                </Row>
                                {filteredRows.length > CARD_PAGE_SIZE && (
                                    <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                                        <Pagination simple current={cardPage} pageSize={CARD_PAGE_SIZE} total={filteredRows.length} onChange={setCardPage} />
                                    </div>
                                )}
                            </>
                        ) : <Empty description="No risk register entries match this filter." />}
                    </Card>
                </Col>
            </Row>

            <Modal
                open={!!selectedRisk}
                onCancel={() => setSelectedRisk(null)}
                footer={(
                    <Space>
                        <Button onClick={() => setSelectedRisk(null)}>Close</Button>
                        <Button
                            type="primary"
                            onClick={() => {
                                if (!selectedRisk) return
                                const state = selectedRisk.focus.kind === 'participant'
                                    ? { focusParticipantId: selectedRisk.focus.participantId }
                                    : { focusInterventionId: selectedRisk.focus.interventionId }
                                navigate(selectedRisk.actionRoute, { state })
                                setSelectedRisk(null)
                            }}
                        >
                            {selectedRisk?.action || 'Take action'}
                        </Button>
                    </Space>
                )}
                title={selectedRisk?.entityName}
                width={selectedRisk?.detail?.length ? 680 : 600}
                destroyOnClose
            >
                {selectedRisk && (
                    <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 12]}>
                            <Col span={12}><Typography.Text type="secondary">Category</Typography.Text><div>{selectedRisk.category}</div></Col>
                            <Col span={12}><Typography.Text type="secondary">Severity</Typography.Text><div>{getSeverityTag(selectedRisk.severity)}</div></Col>
                            <Col span={12}><Typography.Text type="secondary">Entity</Typography.Text><div>{selectedRisk.entityType}: {selectedRisk.entityName}</div></Col>
                            <Col span={12}><Typography.Text type="secondary">Owner</Typography.Text><div>{selectedRisk.owner}</div></Col>
                            <Col span={24}>
                                <Typography.Text type="secondary">Due</Typography.Text>
                                <div>{selectedRisk.dueDate?.isValid() ? selectedRisk.dueDate.format('DD MMM YYYY') : 'Operational follow-up'}</div>
                            </Col>
                        </Row>
                        <div>
                            <Typography.Text type="secondary">Issue</Typography.Text>
                            <Typography.Paragraph style={{ marginBottom: 0 }}>{selectedRisk.issue}</Typography.Paragraph>
                        </div>
                        {!!selectedRisk.detail?.length && (
                            <Table<RiskDetailItem>
                                size="small"
                                rowKey="label"
                                pagination={false}
                                dataSource={selectedRisk.detail}
                                columns={[
                                    { title: 'Document', dataIndex: 'label' },
                                    {
                                        title: 'Reason',
                                        dataIndex: 'status',
                                        width: 130,
                                        render: (status: string) => <Tag color={BLOCKING_STATUSES.includes(status) ? 'red' : 'gold'}>{formatStatus(status)}</Tag>,
                                    },
                                ]}
                            />
                        )}
                    </Space>
                )}
            </Modal>
        </DashboardPage>
    )
}
