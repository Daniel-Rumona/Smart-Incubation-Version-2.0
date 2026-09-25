/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Col,
    Progress,
    Row,
    Space,
    Tag,
    Typography,
    message,
    Empty,
    Button,
    Modal,
    List
} from 'antd'
import dayjs, { Dayjs } from 'dayjs'

import { db } from '@/firebase'
import {
    collection,
    doc,
    getDoc,
    onSnapshot,
    query,
    where,
    Timestamp
} from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { UpcomingWeekCard, type InterventionDueItem } from '@/pages/dashboards/operations/UpcomingWeekCard'
import { useNavigate } from 'react-router-dom'
import {
    ShopOutlined,
    SolutionOutlined,
    CheckCircleOutlined,
    FileProtectOutlined,
    WarningOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    ArrowRightOutlined
} from '@ant-design/icons'
import '@/styles/director.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text } = Typography

type AssignmentModel = 'ops_assign_consultant' | 'consultant_self_assign'
type SmeDivisionModel =
    | 'system_equal_random'
    | 'ops_assign_smes_to_consultants'
    | 'consultants_register_their_smes'

type SystemSettingsDoc = {
    companyCode: string
    companyName?: string
    hasDepartments: boolean
    hasBranches: boolean
    assignmentModel: AssignmentModel
    smeDivisionModel?: SmeDivisionModel
    branchScopedManagement?: boolean
    locked: true
    createdAt: Timestamp
    createdByUid: string
    createdByEmail?: string
}

type InterventionMeta = {
    id: string
    areaOfSupport?: string
    department?: string
    companyCode?: string
    [k: string]: any
}

type RequiredInterventionRef = {
    interventionId?: string
    id?: string
    areaOfSupport?: string
    department?: string
    [k: string]: any
}

type AnyAssignedIntervention = {
    id: string
    companyCode?: string
    interventionId?: string

    // sometimes stored directly; we override using interventions map
    department?: string
    areaOfSupport?: string

    // SME identity (varies across your docs)
    enterpriseName?: string
    beneficiaryName?: string
    participantName?: string
    smmEName?: string
    smeName?: string
    companyName?: string
    participantId?: string
    smeId?: string
    email?: string

    dueDate?: any
    createdAt?: any

    assigneeStatus?: string
    participantStatus?: string
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string

    [k: string]: any
}

type BottleneckKey =
    | 'pending_consultant'
    | 'pending_sme_acceptance'
    | 'pending'
    | 'awaiting_sme_completion'

const norm = (v?: any) => String(v ?? '').trim().toLowerCase()

const tsToDayjs = (v: any): Dayjs | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return dayjs(v.toDate())
    if (typeof v === 'string') {
        const d = dayjs(v)
        return d.isValid() ? d : null
    }
    if (v instanceof Date) return dayjs(v)
    return null
}

const getSmeLabel = (x: AnyAssignedIntervention) =>
    x.businessName ||
    x.enterpriseName ||
    x.beneficiaryName ||
    x.participantName ||
    x.smmEName ||
    x.smeName ||
    x.companyName ||
    x.participantId ||
    x.smeId ||
    x.email ||
    '—'

const classifyBottleneck = (x: AnyAssignedIntervention): BottleneckKey => {
    const consultantAccepted = norm(x.assigneeStatus) === 'accepted'
    const smeAccepted = norm(x.participantStatus) === 'accepted'

    const consultantCompleted = norm(x.assigneeCompletionStatus) === 'done'
    const smeCompleted = norm(x.participantCompletionStatus) === 'confirmed'

    if (consultantCompleted && smeCompleted) return 'pending' // not used here, completion handled separately
    if (!consultantAccepted) return 'pending_consultant'
    if (consultantAccepted && !smeAccepted) return 'pending_sme_acceptance'
    if (consultantCompleted && !smeCompleted) return 'awaiting_sme_completion'
    return 'pending'
}

const prettyBottleneck = (k: BottleneckKey) => {
    switch (k) {
        case 'pending_consultant':
            return 'Pending Consultant'
        case 'pending_sme_acceptance':
            return 'Pending SME Acceptance'
        case 'awaiting_sme_completion':
            return 'Awaiting SME Completion'
        case 'pending':
            return 'Pending'
    }
}

const percent = (num: number, den: number) => (den <= 0 ? 0 : Math.round((num / den) * 100))

const DirectorDashboard: React.FC = () => {
    const { t } = useLanguage()
    const navigate = useNavigate()

    const { user } = useFullIdentity()
    const companyCode = String((user as any)?.companyCode || '').trim()

    const [systemSettings, setSystemSettings] = useState<SystemSettingsDoc | null>(null)

    // The dashboard always reports on the current month.
    const [range] = useState<[Dayjs, Dayjs]>(() => [dayjs().startOf('month'), dayjs().endOf('month')])

    // Counts
    const [smesCount, setSmesCount] = useState(0)
    const [compliance, setCompliance] = useState({ total: 0, attention: 0 })
    const [dueItems, setDueItems] = useState<InterventionDueItem[]>([])

    // Intervention meta map
    const [interventionMetaById, setInterventionMetaById] = useState<Record<string, InterventionMeta>>({})

    // Accepted SME filters
    const [acceptedParticipantIds, setAcceptedParticipantIds] = useState<Set<string>>(new Set())
    const [acceptedEmails, setAcceptedEmails] = useState<Set<string>>(new Set())

    // Required vs Completed per scope
    const [requiredByScope, setRequiredByScope] = useState<Record<string, number>>({})
    const [completedByScope, setCompletedByScope] = useState<Record<string, number>>({})

    // Risk signals (instead of overdue table)
    const [riskCounts, setRiskCounts] = useState({
        overdue: 0,
        upcoming7: 0,
        upcoming14: 0,
        unresponsiveSMEs: 0
    })

    const [riskLists, setRiskLists] = useState<{
        overdue: any[]
        upcoming: any[]
        unresponsive: any[]
    }>({ overdue: [], upcoming: [], unresponsive: [] })

    const [riskModal, setRiskModal] = useState<{ open: boolean; title: string; items: any[] }>({
        open: false,
        title: '',
        items: []
    })

    // ----------- Load system settings -----------
    useEffect(() => {
        if (!companyCode) return
        getDoc(doc(db, 'companies', companyCode))
            .then(snap => setSystemSettings(snap.exists() ? (snap.data() as SystemSettingsDoc) : null))
            .catch(e => message.error(e?.message || t('Failed to load system settings')))
    }, [companyCode])

    const modeHasDepartments = !!systemSettings?.hasDepartments
    const scopeOf = (interventionId?: string, fallback?: { areaOfSupport?: string; department?: string }) => {
        const iid = String(interventionId || '').trim()
        const meta = iid ? interventionMetaById[iid] : undefined
        return modeHasDepartments
            ? String(meta?.department || fallback?.department || 'Unassigned Department')
            : String(meta?.areaOfSupport || fallback?.areaOfSupport || 'Unassigned Area')
    }

    const inRange = (d: Dayjs | null) => {
        if (!d) return true
        const [from, to] = range
        const start = from.startOf('day')
        const end = to.endOf('day')
        return (d.isAfter(start) || d.isSame(start)) && (d.isBefore(end) || d.isSame(end))
    }

    // ----------- Interventions meta -----------
    useEffect(() => {
        if (!companyCode) return

        const unsub = onSnapshot(
            query(collection(db, 'interventions'), where('companyCode', '==', companyCode)),
            snap => {
                const map: Record<string, InterventionMeta> = {}
                snap.forEach(d => {
                    map[d.id] = { id: d.id, ...(d.data() as any) }
                })
                setInterventionMetaById(map)
            },
            err => message.error(err?.message || t('Failed to load interventions'))
        )

        return () => unsub()
    }, [companyCode])

    // ----------- Accepted apps (SMEs set + total required from accepted) -----------
    useEffect(() => {
        if (!companyCode) return

        const unsub = onSnapshot(
            query(
                collection(db, 'applications'),
                where('companyCode', '==', companyCode),
                where('applicationStatus', '==', 'accepted')
            ),
            snap => {
                // 1) SME count = accepted applications
                setSmesCount(snap.size)

                // 2) Accepted SME identity sets (to filter assignedInterventions)
                const pidSet = new Set<string>()
                const emailSet = new Set<string>()

                snap.forEach(d => {
                    const app: any = d.data()

                    if (app?.participantId) pidSet.add(String(app.participantId))
                    if (app?.email) emailSet.add(String(app.email).trim().toLowerCase())
                })

                setAcceptedParticipantIds(pidSet)
                setAcceptedEmails(emailSet)
            },
            err => message.error(err?.message || t('Failed to read accepted applications'))
        )

        return () => unsub()
    }, [companyCode])




    // ----------- Compliance (share of documents not needing attention) -----------
    useEffect(() => {
        if (!companyCode) return
        const attentionStatuses = ['missing', 'pending', 'rejected', 'invalid', 'expired', 'queried']
        const unsub = onSnapshot(
            query(collection(db, 'complianceDocuments'), where('companyCode', '==', companyCode)),
            snap => {
                let attention = 0
                snap.forEach(d => {
                    const data: any = d.data()
                    if (attentionStatuses.includes(norm(data.verificationStatus || data.currentStatus || data.status || 'pending'))) attention++
                })
                setCompliance({ total: snap.size, attention })
            },
            err => message.error(err?.message || t('Failed to load compliance documents'))
        )
        return () => unsub()
    }, [companyCode])

    // ----------- REQUIRED BY SCOPE (ONLY accepted apps, and in range) -----------
    useEffect(() => {
        if (!companyCode) return

        const unsub = onSnapshot(
            query(
                collection(db, 'applications'),
                where('companyCode', '==', companyCode),
                where('applicationStatus', '==', 'accepted')
            ),
            snap => {
                const req: Record<string, number> = {}

                snap.forEach(d => {
                    const app: any = d.data()
                    // const appDate = getDocDate(app, 'createdAtOrAccepted')
                    // if (!inRange(appDate)) return

                    const required: RequiredInterventionRef[] =
                        app?.interventions?.required || app?.interventionsRequired || app?.requiredInterventions || []

                    if (!Array.isArray(required)) return

                    required.forEach(r => {
                        const iid = String(r?.interventionId || r?.id || '').trim()
                        const scope = scopeOf(iid, { areaOfSupport: r?.areaOfSupport, department: r?.department })
                        req[scope] = (req[scope] || 0) + 1
                    })
                })

                setRequiredByScope(req)
            },
            err => message.error(err?.message || t('Failed to load required interventions'))
        )

        return () => unsub()
    }, [companyCode, interventionMetaById, modeHasDepartments, range])

    // ----------- COMPLETED + BOTTLENECKS + RISKS (accepted SMEs only) -----------
    useEffect(() => {
        if (!companyCode) return

        const qAssigned = query(collection(db, 'assignedInterventions'), where('companyCode', '==', companyCode))

        const unsub = onSnapshot(
            qAssigned,
            snap => {
                const completed: Record<string, number> = {}
                const dueList: InterventionDueItem[] = []

                // Risk derivations
                const now = dayjs()
                const overdue: any[] = []
                const upcoming: any[] = []
                const unresponsive: any[] = []

                let overdueCount = 0
                let upcoming7 = 0
                let upcoming14 = 0
                let unresponsiveCount = 0

                snap.forEach(d => {
                    const ai = { id: d.id, ...(d.data() as any) } as AnyAssignedIntervention

                    // Filter to accepted SMEs (strict)
                    const pid = ai.participantId ? String(ai.participantId) : ''
                    const em = ai.email ? String(ai.email).toLowerCase() : ''
                    const isAcceptedSme = (pid && acceptedParticipantIds.has(pid)) || (em && acceptedEmails.has(em))
                    if (!isAcceptedSme) return

                    const iid = String(ai.interventionId || '').trim()
                    const scope = scopeOf(iid, { areaOfSupport: ai.areaOfSupport, department: ai.department })
                    const meta = iid ? interventionMetaById[iid] : undefined

                    const consultantAccepted = norm(ai.assigneeStatus) === 'accepted'
                    const smeAccepted = norm(ai.participantStatus) === 'accepted'
                    const consultantCompleted = norm(ai.assigneeCompletionStatus) === 'done'
                    const smeCompleted = norm(ai.participantCompletionStatus) === 'confirmed'
                    const isCompleted = consultantCompleted && smeCompleted

                    // Efficiency compares against ALL required interventions, so completions are all-time too
                    if (isCompleted) completed[scope] = (completed[scope] || 0) + 1

                    // Month filter: use createdAt (best), otherwise dueDate
                    const aiDate = tsToDayjs(ai.createdAt) || tsToDayjs(ai.dueDate) || null
                    if (!inRange(aiDate)) return

                    // Risk signals
                    const due = tsToDayjs(ai.dueDate)
                    const created = tsToDayjs(ai.createdAt)

                    // Overdue
                    if (due && due.isBefore(now, 'day') && !isCompleted) {
                        overdueCount++
                        overdue.push({
                            id: ai.id,
                            sme: getSmeLabel(ai),
                            scope,
                            area: String(meta?.areaOfSupport || ai.areaOfSupport || '—'),
                            dept: String(meta?.department || ai.department || '—'),
                            dueDate: due.format('YYYY-MM-DD'),
                            reason: prettyBottleneck(classifyBottleneck(ai))
                        })
                    }

                    if (due && !isCompleted) {
                        dueList.push({
                            id: ai.id,
                            title: String(ai.interventionTitle || meta?.title || meta?.name || 'Intervention'),
                            participantName: getSmeLabel(ai),
                            owner: String(ai.assigneeName || ai.consultantName || 'Unassigned'),
                            dueDate: due
                        })
                    }

                    // Upcoming deadlines (7 / 14 days)
                    if (due && !isCompleted) {
                        const diffDays = due.startOf('day').diff(now.startOf('day'), 'day')
                        if (diffDays >= 0 && diffDays <= 7) upcoming7++
                        if (diffDays >= 0 && diffDays <= 14) upcoming14++
                        if (diffDays >= 0 && diffDays <= 14) {
                            upcoming.push({
                                id: ai.id,
                                sme: getSmeLabel(ai),
                                scope,
                                dueDate: due.format('YYYY-MM-DD'),
                                reason: prettyBottleneck(classifyBottleneck(ai))
                            })
                        }
                    }

                    // Unresponsive SMEs = consultant accepted but SME not accepted after 7 days
                    if (consultantAccepted && !smeAccepted) {
                        const ageDays = created ? now.diff(created, 'day') : 0
                        if (ageDays >= 7) {
                            unresponsiveCount++
                            unresponsive.push({
                                id: ai.id,
                                sme: getSmeLabel(ai),
                                scope,
                                ageDays,
                                dueDate: due ? due.format('YYYY-MM-DD') : '—'
                            })
                        }
                    }
                })

                overdue.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
                upcoming.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
                unresponsive.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0))

                setCompletedByScope(completed)
                setDueItems(dueList)
                setRiskCounts({
                    overdue: overdueCount,
                    upcoming7,
                    upcoming14,
                    unresponsiveSMEs: unresponsiveCount
                })
                setRiskLists({
                    overdue: overdue.slice(0, 20),
                    upcoming: upcoming.slice(0, 20),
                    unresponsive: unresponsive.slice(0, 20)
                })
            },
            err => message.error(err?.message || t('Failed to load assigned interventions'))
        )

        return () => unsub()
    }, [companyCode, acceptedParticipantIds, acceptedEmails, interventionMetaById, modeHasDepartments, range])

    // ----------- Totals -----------
    const totals = useMemo(() => {
        const totalRequiredInRange = Object.values(requiredByScope).reduce((a, b) => a + (b || 0), 0)
        const totalCompletedInRange = Object.values(completedByScope).reduce((a, b) => a + (b || 0), 0)
        const completionRateInRange = percent(totalCompletedInRange, totalRequiredInRange)
        return { totalRequiredInRange, totalCompletedInRange, completionRateInRange }
    }, [requiredByScope, completedByScope])

    // ----------- Area / department efficiency (completed vs required) -----------
    const efficiencyRows = useMemo(() => {
        return Object.keys({ ...requiredByScope, ...completedByScope })
            .map(name => {
                const required = requiredByScope[name] || 0
                const completed = completedByScope[name] || 0
                return { name, required, completed, rate: Math.min(percent(completed, required), 100) }
            })
            .filter(row => row.required > 0)
            .sort((a, b) => b.required - a.required || b.rate - a.rate)
    }, [requiredByScope, completedByScope])

    const rateColor = (rate: number) => (rate >= 75 ? '#16a34a' : rate >= 40 ? '#f59e0b' : '#ef4444')

    const openRiskModal = (title: string, items: any[]) => setRiskModal({ open: true, title, items })

    return (
        <DashboardPage className="director-dashboard-page">
            <div className="director-dashboard-inner">
                {/* Metrics */}
                <Row gutter={[12, 12]} className="dashboard-metrics-row director-dashboard-metrics">
                    <Col xs={12} md={6}>
                        <DashboardMetricCard icon={<ShopOutlined />} iconClassName="is-participants" label={t('SMEs')} value={smesCount} hint={t('Accepted SMEs')} />
                    </Col>

                    <Col xs={12} md={6}>
                        <DashboardMetricCard icon={<SolutionOutlined />} iconClassName="is-delivery" label={t('Required Interventions')} mobileTitle={tr('Required')} value={totals.totalRequiredInRange} hint={t('All accepted SMEs')} />
                    </Col>

                    <Col xs={12} md={6}>
                        <DashboardMetricCard icon={<CheckCircleOutlined />} iconClassName="is-users" label={t('Completion')} value={`${totals.completionRateInRange}%`} hint={`${totals.totalCompletedInRange} of ${totals.totalRequiredInRange} completed`} />
                    </Col>

                    <Col xs={12} md={6}>
                        <DashboardMetricCard icon={<FileProtectOutlined />} iconClassName="is-attention" label={t('Compliance')} value={`${percent(compliance.total - compliance.attention, compliance.total)}%`} hint={`${compliance.attention} of ${compliance.total} need attention`} />
                    </Col>
                </Row>

                {/* Risk Assessment (replaces overdue table) */}
                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                    <Col xs={24} lg={10}>
                        <Card style={{ borderRadius: 16, height: '100%' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                <div>
                                    <Text strong style={{ fontSize: 16 }}>{t('Risk Assessment')}</Text>
                                    <div style={{ marginTop: 4 }}>
                                        <Text type='secondary'>{t('Fast signals: overdue, unresponsive SMEs, upcoming deadlines.')}</Text>
                                    </div>
                                </div>
                                <Button
                                    type='default'
                                    icon={<ArrowRightOutlined />}
                                    onClick={() => navigate('/director')}
                                >
                                    {t('View')}
                                </Button>
                            </div>

                            <Row gutter={[10, 10]} style={{ marginTop: 14 }}>
                                <Col span={12}>
                                    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(255,77,79,0.08)', border: '1px solid rgba(255,77,79,0.18)' }}>
                                        <Space align="start">
                                            <WarningOutlined style={{ color: '#ff4d4f', marginTop: 2 }} />
                                            <div>
                                                <Text strong>{t('Overdue')}</Text>
                                                <div style={{ fontSize: 22, fontWeight: 700 }}>{riskCounts.overdue}</div>
                                                <Button
                                                    size='small'
                                                    type='link'
                                                    style={{ padding: 0 }}
                                                    onClick={() => openRiskModal('Overdue Interventions', riskLists.overdue)}
                                                >
                                                    {t('View list')}
                                                </Button>
                                            </div>
                                        </Space>
                                    </div>
                                </Col>

                                <Col span={12}>
                                    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(250,173,20,0.10)', border: '1px solid rgba(250,173,20,0.22)' }}>
                                        <Space align="start">
                                            <ExclamationCircleOutlined style={{ color: '#faad14', marginTop: 2 }} />
                                            <div>
                                                <Text strong>{t('Unresponsive SMEs')}</Text>
                                                <div style={{ fontSize: 22, fontWeight: 700 }}>{riskCounts.unresponsiveSMEs}</div>
                                                <Button
                                                    size='small'
                                                    type='link'
                                                    style={{ padding: 0 }}
                                                    onClick={() => openRiskModal('Unresponsive SMEs (≥7 days pending acceptance)', riskLists.unresponsive)}
                                                >
                                                    {t('View list')}
                                                </Button>
                                            </div>
                                        </Space>
                                    </div>
                                </Col>

                                <Col span={12}>
                                    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(24,144,255,0.08)', border: '1px solid rgba(24,144,255,0.18)' }}>
                                        <Space align="start">
                                            <ClockCircleOutlined style={{ color: '#1677ff', marginTop: 2 }} />
                                            <div>
                                                <Text strong>{t('Due in 7 days')}</Text>
                                                <div style={{ fontSize: 22, fontWeight: 700 }}>{riskCounts.upcoming7}</div>
                                                <Button
                                                    size='small'
                                                    type='link'
                                                    style={{ padding: 0 }}
                                                    onClick={() => openRiskModal('Upcoming Deadlines (≤14 days)', riskLists.upcoming)}
                                                >
                                                    {t('View list')}
                                                </Button>
                                            </div>
                                        </Space>
                                    </div>
                                </Col>

                                <Col span={12}>
                                    <div style={{ padding: 12, borderRadius: 12, background: 'rgba(82,196,26,0.10)', border: '1px solid rgba(82,196,26,0.18)' }}>
                                        <Space align="start">
                                            <ClockCircleOutlined style={{ color: '#52c41a', marginTop: 2 }} />
                                            <div>
                                                <Text strong>{t('Due in 14 days')}</Text>
                                                <div style={{ fontSize: 22, fontWeight: 700 }}>{riskCounts.upcoming14}</div>
                                                <div style={{ marginTop: 2 }}>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>{t('Includes 7-day count')}</Text>
                                                </div>
                                            </div>
                                        </Space>
                                    </div>
                                </Col>
                            </Row>
                        </Card>
                    </Col>

                    <Col xs={24} lg={14}>
                        <Card
                            style={{ borderRadius: 16, height: '100%' }}
                            title={modeHasDepartments ? t('Department Efficiency') : t('Area Efficiency')}
                            extra={<Text type='secondary'>{t('Completed vs required')}</Text>}
                        >
                            {efficiencyRows.length ? (
                                <div style={{ maxHeight: 330, overflowY: 'auto', paddingRight: 6 }}>
                                    <Space direction='vertical' size={14} style={{ width: '100%' }}>
                                        {efficiencyRows.map(row => (
                                            <div key={row.name}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
                                                    <Text ellipsis style={{ maxWidth: '70%' }}>{row.name}</Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>{row.completed}/{row.required}</Text>
                                                </div>
                                                <Progress
                                                    percent={row.rate}
                                                    strokeColor={rateColor(row.rate)}
                                                    format={value => <span style={{ fontWeight: 600 }}>{value}%</span>}
                                                />
                                            </div>
                                        ))}
                                    </Space>
                                </div>
                            ) : (
                                <Empty description={t('No required interventions found yet')} />
                            )}
                        </Card>
                    </Col>
                </Row>

                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                    <Col xs={24}>
                        <UpcomingWeekCard interventionDueItems={dueItems} />
                    </Col>
                </Row>

                <Modal
                    open={riskModal.open}
                    title={riskModal.title}
                    onCancel={() => setRiskModal(s => ({ ...s, open: false }))}
                    footer={null}
                >
                    <List
                        dataSource={riskModal.items}
                        locale={{ emptyText: t('Nothing to show 🎉') }}
                        renderItem={(item: any) => (
                            <List.Item>
                                <List.Item.Meta
                                    title={<Text strong>{item.sme || item.name || '—'}</Text>}
                                    description={
                                        <Space wrap>
                                            {item.scope && <Tag>{item.scope}</Tag>}
                                            {item.dueDate && <Tag color="blue">{t('Due:')} {item.dueDate}</Tag>}
                                            {typeof item.ageDays === 'number' && <Tag color="orange">{item.ageDays} {t('days')}</Tag>}
                                            {item.reason && <Tag color="volcano">{item.reason}</Tag>}
                                        </Space>
                                    }
                                />
                            </List.Item>
                        )}
                    />
                </Modal>
            </div>
        </DashboardPage>
    )
}

export default DirectorDashboard
