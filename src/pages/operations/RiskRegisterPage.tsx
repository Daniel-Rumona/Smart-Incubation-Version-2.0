import { useCallback, useEffect, useMemo, useState } from 'react'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { Button, Card, Col, Descriptions, Empty, Grid, Input, Pagination, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import { ClockCircleOutlined, ExclamationCircleOutlined, SearchOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'

import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { FilterBar } from '@/components/shared/FilterBar'
import { db } from '@/firebase/config'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listComplianceRows } from '@/services/complianceService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { outcomeRiskFlags } from '@/services/interventionOutcomeConfig'
import { smeAnswerForRound } from '@/services/smeCheckbackService'
import { formatStatus } from '@/utils/status'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/risk-register.css'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type Status = 'missing' | 'uploaded' | 'pending' | 'valid' | 'rejected' | 'invalid' | 'expired' | 'queried'
type Filter = 'all' | Severity
type EntityFilter = 'all' | RiskRow['entityType']
type Translate = (key: string, fallback?: string, vars?: Record<string, string | number>) => string

type RiskDetailItem = { label: string, status: string }

/**
 * One thing wrong with a record. Kept as data and only turned into words when shown, so the register
 * reads in the user's language while everything underneath stays English.
 */
type Problem = { severity: Severity } & (
    | { kind: 'compliance', blocking: RiskDetailItem[], pending: RiskDetailItem[] }
    | { kind: 'nonServiced' }
    | { kind: 'overdue', daysLate: number, due: Dayjs }
    | { kind: 'outcomeUnresolved', rounds: number, lastNote?: string }
    | { kind: 'followUpOverdue', days: number }
    | { kind: 'notAccepted' }
    | { kind: 'notConfirmed' }
    | { kind: 'completionRejected' }
    | { kind: 'noConsultant' }
    | { kind: 'outcomeDisputed', note?: string }
)

/** One card per SME or intervention, carrying every problem found on it, worst first. */
type RiskRow = {
    key: string
    entityType: 'SME' | 'Intervention'
    entityName: string
    /** The SME an intervention is for. */
    smeName?: string
    owner: string
    problems: Problem[]
    severity: Severity
    dueDate: Dayjs | null
    /** Days past the due date, when overdue. */
    daysOverdue: number | null
    /** Per-document breakdown shown as a table in the detail modal. */
    detail?: RiskDetailItem[]
    actionRoute: string
    /** The record this risk is about, so the action lands on it instead of just the list page. */
    focus: { kind: 'participant', participantId: string } | { kind: 'intervention', interventionId: string }
}

type ParticipantRow = {
    participantId: string
    businessName: string
    status?: string
    discontinuedAt?: unknown
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
    followUpStatus?: string | null
    followUpDueAt?: unknown
    outcomeHistory?: unknown
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

const lower = (value: unknown) => String(value || '').trim().toLowerCase()

const isCompleted = (row: InterventionRow) => {
    const assignee = lower(row.assigneeCompletionStatus)
    const participant = lower(row.participantCompletionStatus)
    return lower(row.status) === 'completed' || Boolean(row.completedAt) || Boolean(row.completionConfirmedAt) || (assignee === 'done' && participant === 'confirmed')
}

const isDiscontinuedParticipant = (row: ParticipantRow) => Boolean(row.discontinuedAt) || lower(row.status) === 'discontinued'

const BLOCKING_STATUSES = ['missing', 'expired', 'invalid', 'rejected']
const PENDING_STATUSES = ['pending', 'uploaded', 'queried']
const STATUS_SUMMARY_ORDER = [...BLOCKING_STATUSES, ...PENDING_STATUSES]

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const SEVERITY_TAG_COLOR: Record<Severity, string> = { critical: 'red', high: 'volcano', medium: 'orange', low: 'blue' }
const CARD_PAGE_SIZE = 8

/** Category, the next step, and where that step happens, per kind of problem. */
const PROBLEM_META: Record<Problem['kind'], { category: string, action: string, route: string }> = {
    compliance: { category: 'Compliance readiness', action: 'Clear required document blockers', route: '/operations/participants/compliance' },
    nonServiced: { category: 'Interventions: non-serviced', action: 'Assign first intervention', route: '/operations/interventions/assign' },
    overdue: { category: 'Interventions: overdue', action: 'Escalate overdue intervention', route: '/operations/interventions' },
    outcomeUnresolved: { category: 'Outcome: unresolved', action: 'Review why the change has not stuck', route: '/operations/interventions' },
    followUpOverdue: { category: 'Outcome: follow-up overdue', action: 'Ask the facilitator to record the follow-up', route: '/operations/interventions' },
    notAccepted: { category: 'SME non-responsive', action: 'Contact the SME and record their answer', route: '/operations/interventions' },
    notConfirmed: { category: 'SME non-responsive', action: 'Contact the SME and record their answer', route: '/operations/interventions' },
    completionRejected: { category: 'Consultant follow-up', action: 'Follow up with the consultant', route: '/operations/interventions' },
    noConsultant: { category: 'Consultant follow-up', action: 'Assign a consultant', route: '/operations/interventions/assign' },
    outcomeDisputed: { category: 'Outcome: disputed', action: 'Talk to the facilitator and the SME', route: '/operations/interventions' },
}

const problemAction = (problem: Problem) =>
    problem.kind === 'compliance' && !problem.blocking.length ? 'Review pending documents' : PROBLEM_META[problem.kind].action

/** "2 missing, 1 expired": what's wrong, without listing every document on a card. */
const summarizeByReason = (items: RiskDetailItem[], t: Translate) => {
    const counts = new Map<string, number>()
    items.forEach(item => counts.set(item.status, (counts.get(item.status) || 0) + 1))
    return STATUS_SUMMARY_ORDER
        .filter(status => counts.has(status))
        .map(status => `${counts.get(status)} ${t(formatStatus(status)).toLowerCase()}`)
        .join(', ')
}

const describeProblem = (problem: Problem, row: RiskRow, t: Translate) => {
    const sme = row.smeName || row.entityName
    switch (problem.kind) {
        case 'compliance':
            return [
                problem.blocking.length ? t('Blocking: {items}', undefined, { items: summarizeByReason(problem.blocking, t) }) : '',
                problem.pending.length ? t('Pending review: {items}', undefined, { items: summarizeByReason(problem.pending, t) }) : '',
            ].filter(Boolean).join(' · ')
        case 'nonServiced': return t('No intervention has been assigned to this SME yet.')
        case 'overdue': return problem.daysLate === 1
            ? t('1 day overdue (was due {date}).', undefined, { date: problem.due.format('DD MMM YYYY') })
            : t('{days} days overdue (was due {date}).', undefined, { days: problem.daysLate, date: problem.due.format('DD MMM YYYY') })
        case 'outcomeUnresolved': return t('The intended change still isn’t fully achieved after {rounds} follow-up checks.', undefined, { rounds: problem.rounds })
            + (problem.lastNote ? ` ${t('Latest note: {note}', undefined, { note: problem.lastNote })}` : '')
        case 'followUpOverdue': return t('The outcome follow-up has waited {days} days with no result recorded.', undefined, { days: problem.days })
        case 'notAccepted': return t('{sme} hasn’t accepted this intervention yet.', undefined, { sme })
        case 'notConfirmed': return t('Delivery is marked done, but {sme} hasn’t confirmed it.', undefined, { sme })
        case 'completionRejected': return t('{sme} didn’t confirm that this was delivered.', undefined, { sme })
        case 'noConsultant': return t('No consultant is assigned.')
        case 'outcomeDisputed': return t('The facilitator recorded the change as achieved, but {sme} said it has not happened.', undefined, { sme })
            + (problem.note ? ` ${t('Their note: {note}', undefined, { note: problem.note })}` : '')
    }
}

const worst = (problems: Problem[]) => problems.reduce<Severity>((current, problem) => SEVERITY_RANK[problem.severity] < SEVERITY_RANK[current] ? problem.severity : current, 'low')
const byRisk = (left: RiskRow, right: RiskRow) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || (right.daysOverdue ?? -1) - (left.daysOverdue ?? -1)
    || (left.dueDate?.valueOf() ?? Infinity) - (right.dueDate?.valueOf() ?? Infinity)
    || String(left.entityName || '').localeCompare(String(right.entityName || ''))

const buildRows = (participants: ParticipantRow[], interventions: InterventionRow[]): RiskRow[] => {
    const rows: RiskRow[] = []
    // Discontinued SMEs are no longer a risk to manage: drop them and any assignments still pointing at them.
    const activeParticipants = participants.filter(participant => !isDiscontinuedParticipant(participant))
    const discontinuedIds = new Set(participants.filter(isDiscontinuedParticipant).map(participant => participant.participantId))
    // Some participant records have no business name; fall back to the person, then a placeholder.
    const nameOf = (row: ParticipantRow) => String(row.businessName || (row as ParticipantRow & { participantName?: string }).participantName || '').trim() || 'Unnamed SME'
    const participantNames = new Map(activeParticipants.map(row => [row.participantId, nameOf(row)]))
    const interventionParticipantIds = new Set(interventions.map(row => row.participantId || row.smmeId || row.smeId).filter(Boolean))

    activeParticipants.forEach(participant => {
        const blocking: RiskDetailItem[] = []
        const pending: RiskDetailItem[] = []
        participant.required.forEach(req => {
            const doc = participant.documents.find(item => cleanKey(item.key || item.type) === req.key)
            const expiry = doc?.currentFile?.expiryDate ? dayjs(doc.currentFile.expiryDate) : null
            const status = !doc
                ? 'missing'
                : req.hasExpiry && expiry?.isValid() && expiry.isBefore(dayjs(), 'day')
                    ? 'expired'
                    : doc.currentStatus || 'pending'
            if (BLOCKING_STATUSES.includes(status)) blocking.push({ label: req.title, status })
            else if (PENDING_STATUSES.includes(status)) pending.push({ label: req.title, status })
        })

        const problems: Problem[] = []
        if (blocking.length || pending.length) {
            problems.push({ kind: 'compliance', blocking, pending, severity: blocking.length >= 3 ? 'critical' : blocking.length ? 'high' : 'medium' })
        }
        if (!interventionParticipantIds.has(participant.participantId)) problems.push({ kind: 'nonServiced', severity: 'high' })
        if (!problems.length) return

        problems.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])
        rows.push({
            key: `sme-${participant.participantId}`,
            entityType: 'SME',
            entityName: nameOf(participant),
            owner: 'Operations',
            problems,
            severity: worst(problems),
            dueDate: null,
            daysOverdue: null,
            detail: [...blocking, ...pending],
            actionRoute: PROBLEM_META[problems[0].kind].route,
            focus: { kind: 'participant', participantId: participant.participantId },
        })
    })

    interventions.forEach(row => {
        const participantId = row.participantId || row.smmeId || row.smeId || ''
        if (discontinuedIds.has(participantId)) return
        const completed = isCompleted(row)
        const dueDate = toDayjs(row.dueDate)
        const daysLate = dueDate.isValid() && !completed ? dayjs().startOf('day').diff(dueDate.startOf('day'), 'day') : 0
        const overdue = daysLate > 0
        const participantStatus = lower(row.participantStatus)
        const assigneeStatus = lower(row.assigneeCompletionStatus)
        const confirmation = lower(row.participantCompletionStatus)
        const problems: Problem[] = []

        if (overdue) problems.push({ kind: 'overdue', daysLate, due: dueDate, severity: daysLate >= 14 ? 'critical' : 'high' })
        if (!completed && participantStatus !== 'declined') {
            // Waiting on the SME: they haven't accepted the intervention, or haven't confirmed a finished one.
            if (participantStatus === 'pending') problems.push({ kind: 'notAccepted', severity: overdue ? 'high' : 'medium' })
            else if (assigneeStatus === 'done' && confirmation !== 'confirmed' && confirmation !== 'rejected') problems.push({ kind: 'notConfirmed', severity: overdue ? 'high' : 'medium' })
            // Waiting on the consultant: the SME disputed delivery, or nobody is assigned to deliver it.
            if (confirmation === 'rejected') problems.push({ kind: 'completionRejected', severity: overdue ? 'high' : 'medium' })
            if (!String(row.assigneeName || '').trim()) problems.push({ kind: 'noConsultant', severity: overdue ? 'high' : 'medium' })
        }
        // Achieved per the facilitator, but the SME answered No for the same check-back round.
        const facilitatorRounds = Array.isArray((row as Record<string, unknown>).outcomeHistory) ? ((row as Record<string, unknown>).outcomeHistory as unknown[]).length : 0
        if (completed && lower((row as Record<string, unknown> & { outcomeResult?: { result?: unknown } }).outcomeResult?.result) === 'achieved' && facilitatorRounds) {
            const sme = smeAnswerForRound(row as Record<string, unknown>, facilitatorRounds)
            if (sme?.answer === 'no') problems.push({ kind: 'outcomeDisputed', note: sme.note || undefined, severity: 'medium' })
        }
        outcomeRiskFlags(row as Record<string, unknown>).forEach(flag => {
            if (flag.kind === 'unresolved_outcome') problems.push({ kind: 'outcomeUnresolved', rounds: flag.rounds, lastNote: flag.lastNote, severity: 'medium' })
            else problems.push({ kind: 'followUpOverdue', days: flag.daysOverdue, severity: 'medium' })
        })
        if (!problems.length) return

        problems.sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])
        rows.push({
            key: `intervention-${row.id}`,
            entityType: 'Intervention',
            entityName: row.interventionTitle || row.title || 'Untitled intervention',
            smeName: row.beneficiaryName || row.participantName || row.businessName || row.smmeName || row.companyName || participantNames.get(participantId) || 'Unknown SME',
            owner: row.assigneeName || 'Operations',
            problems,
            severity: worst(problems),
            dueDate: dueDate.isValid() ? dueDate : null,
            daysOverdue: overdue ? daysLate : null,
            actionRoute: PROBLEM_META[problems[0].kind].route,
            focus: { kind: 'intervention', interventionId: row.id },
        })
    })

    return rows.sort(byRisk)
}

const categoriesOf = (row: RiskRow) => [...new Set(row.problems.map(problem => PROBLEM_META[problem.kind].category))]

const SeverityTag = ({ severity }: { severity: Severity }) => {
    const { t } = useLanguage()
    return <Tag color={SEVERITY_TAG_COLOR[severity]} className="risk-severity-tag">{t(SEVERITY_LABEL[severity])}</Tag>
}

const dueLabel = (row: RiskRow, t: Translate) => {
    if (row.daysOverdue) return row.daysOverdue === 1 ? t('1 day overdue') : t('{days} days overdue', undefined, { days: row.daysOverdue })
    if (row.dueDate) return t('Due {date}', undefined, { date: row.dueDate.format('DD MMM YYYY') })
    return t('No due date')
}

const RiskCard = ({ row, onClick }: { row: RiskRow, onClick: () => void }) => {
    const { t } = useLanguage()
    const [primary, ...others] = row.problems
    return (
        <button type="button" onClick={onClick} className={`risk-card risk-sev-${row.severity}`}>
            <span className="risk-card-head">
                <span className="risk-dot" aria-hidden />
                <span className="risk-card-title">
                    <Typography.Text strong ellipsis>{row.entityName}</Typography.Text>
                    <Typography.Text type="secondary" ellipsis className="risk-card-sub">
                        {row.entityType === 'Intervention' ? `${t('Intervention')} · ${row.smeName}` : `${t('SME')} · ${t(PROBLEM_META[primary.kind].category)}`}
                    </Typography.Text>
                </span>
                <SeverityTag severity={row.severity} />
            </span>
            <Typography.Paragraph className="risk-card-issue" ellipsis={{ rows: 2 }}>{describeProblem(primary, row, t)}</Typography.Paragraph>
            <span className="risk-card-foot">
                <Typography.Text type="secondary" ellipsis>{t('Owner: {owner}', undefined, { owner: row.owner === 'Operations' ? t('Operations') : row.owner })}</Typography.Text>
                <span className="risk-card-tags">
                    {others.length > 0 && <Tag bordered={false}>{t('+{count} more', undefined, { count: others.length })}</Tag>}
                    <Tag bordered={false} color={row.daysOverdue ? 'red' : undefined}>{dueLabel(row, t)}</Tag>
                </span>
            </span>
        </button>
    )
}

export default function RiskRegisterPage() {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const isMobile = !Grid.useBreakpoint().md
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

    // Changing what is shown starts again from every category and the first page.
    const resetView = () => {
        setSelectedCategory('all')
        setCardPage(1)
    }

    const load = useCallback(async () => {
        if (identityLoading) return
        setLoading(true)
        try {
            const compliance = await listComplianceRows({ activeProgramId, departmentId: user?.departmentId || null, user })
            // The assignedInterventions rule only allows reading one's own company, so the query must say so;
            // without a company there is nothing this page may read.
            const companyCode = String(user?.companyCode || '').trim()
            const constraints: QueryConstraint[] = [where('companyCode', '==', companyCode)]
            if (!isAllPrograms && activeProgramId) constraints.push(where('programId', '==', activeProgramId))
            const assignments = companyCode ? (await getDocs(query(collection(db, 'assignedInterventions'), ...constraints))).docs : []
            setRows(buildRows(
                compliance.rows as unknown as ParticipantRow[],
                assignments
                    .map(doc => ({ id: doc.id, ...doc.data() }) as InterventionRow)
                    .filter(row => matchesActiveProgram(user, activeProgramId, row.programId))
                    .filter(row => !isDiscontinuedRecord(row as { participantDiscontinuedAt?: unknown })),
            ))
        } catch (error) {
            console.error('[RISK REGISTER] Failed loading risk register:', error)
            message.error(t('Risk register could not be loaded.'))
            setRows([])
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, identityLoading, isAllPrograms, user, t])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const baseFilteredRows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rows.filter(row => {
            if (filter !== 'all' && row.severity !== filter) return false
            if (entityFilter !== 'all' && row.entityType !== entityFilter) return false
            if (!needle) return true
            return [
                row.entityName,
                row.smeName || '',
                row.owner,
                ...categoriesOf(row).map(category => t(category)),
                ...row.problems.map(problem => describeProblem(problem, row, t)),
            ].some(value => value.toLowerCase().includes(needle))
        })
    }, [entityFilter, filter, rows, search, t])

    const categorySummaries = useMemo(() => {
        const map = new Map<string, { count: number, worst: Severity }>()
        baseFilteredRows.forEach(row => {
            row.problems.forEach(problem => {
                const category = PROBLEM_META[problem.kind].category
                const existing = map.get(category)
                if (!existing) map.set(category, { count: 0, worst: problem.severity })
                else if (SEVERITY_RANK[problem.severity] < SEVERITY_RANK[existing.worst]) existing.worst = problem.severity
            })
            categoriesOf(row).forEach(category => { map.get(category)!.count += 1 })
        })
        return Array.from(map.entries())
            .map(([category, info]) => ({ category, ...info }))
            .sort((a, b) => SEVERITY_RANK[a.worst] - SEVERITY_RANK[b.worst] || b.count - a.count)
    }, [baseFilteredRows])

    const filteredRows = useMemo(
        () => selectedCategory === 'all' ? baseFilteredRows : baseFilteredRows.filter(row => categoriesOf(row).includes(selectedCategory)),
        [baseFilteredRows, selectedCategory],
    )

    const pagedRows = useMemo(() => {
        const start = (cardPage - 1) * CARD_PAGE_SIZE
        return filteredRows.slice(start, start + CARD_PAGE_SIZE)
    }, [filteredRows, cardPage])

    const metrics = useMemo(() => ({
        total: rows.length,
        urgent: rows.filter(row => row.severity === 'critical' || row.severity === 'high').length,
        overdue: rows.filter(row => row.daysOverdue).length,
        unserviced: rows.filter(row => row.problems.some(problem => problem.kind === 'nonServiced')).length,
    }), [rows])

    const pageLoading = identityLoading || loading

    const takeAction = () => {
        if (!selectedRisk) return
        const state = selectedRisk.focus.kind === 'participant'
            ? { focusParticipantId: selectedRisk.focus.participantId }
            : { focusInterventionId: selectedRisk.focus.interventionId }
        navigate(selectedRisk.actionRoute, { state })
        setSelectedRisk(null)
    }

    return (
        <DashboardPage className="operations-risk-register-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<ExclamationCircleOutlined />} iconClassName="dashboard-icon-red" label={t('Open risks')} value={metrics.total} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<WarningOutlined />} iconClassName="dashboard-icon-orange" label={t('Critical or high')} value={metrics.urgent} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<ClockCircleOutlined />} iconClassName="dashboard-icon-blue" label={t('Overdue')} value={metrics.overdue} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<TeamOutlined />} iconClassName="dashboard-icon-green" label={t('SMEs without interventions')} mobileTitle={t('Not serviced')} value={metrics.unserviced} />
                </Col>
            </Row>

            <FilterBar
                compact
                primary={
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={event => { setSearch(event.target.value); resetView() }} placeholder={t('Search risk, owner, SME, intervention...')} allowClear className="risk-search" />
                        <Select value={filter} onChange={value => { setFilter(value); resetView() }} className="risk-filter-select" aria-label={t('Severity')} options={[{ label: t('All severities'), value: 'all' }, ...(['critical', 'high', 'medium', 'low'] as Severity[]).map(value => ({ label: t(SEVERITY_LABEL[value]), value }))]} />
                        <Select value={entityFilter} onChange={value => { setEntityFilter(value); resetView() }} className="risk-filter-select" aria-label={t('Record type')} options={[{ label: t('All records'), value: 'all' }, { label: t('SMEs'), value: 'SME' }, { label: t('Interventions'), value: 'Intervention' }]} />
                    </>
                }
            />

            <Card loading={pageLoading} className="dashboard-section-card motion-card risk-register-card">
                {/* Categories as a chip row: counts are records with at least one problem of that kind. */}
                <div className="risk-chips" role="tablist" aria-label={t('Risk categories')}>
                    <button type="button" role="tab" aria-selected={selectedCategory === 'all'} className={`risk-chip${selectedCategory === 'all' ? ' is-selected' : ''}`} onClick={() => { setSelectedCategory('all'); setCardPage(1) }}>
                        {t('All')} <span className="risk-chip-count">{baseFilteredRows.length}</span>
                    </button>
                    {categorySummaries.map(summary => (
                        <button
                            key={summary.category}
                            type="button"
                            role="tab"
                            aria-selected={selectedCategory === summary.category}
                            className={`risk-chip risk-sev-${summary.worst}${selectedCategory === summary.category ? ' is-selected' : ''}`}
                            onClick={() => { setSelectedCategory(summary.category); setCardPage(1) }}
                        >
                            <span className="risk-dot" aria-hidden />
                            {t(summary.category)} <span className="risk-chip-count">{summary.count}</span>
                        </button>
                    ))}
                </div>

                {filteredRows.length ? (
                    <>
                        <div className="risk-card-grid">
                            {pagedRows.map(row => <RiskCard key={row.key} row={row} onClick={() => setSelectedRisk(row)} />)}
                        </div>
                        {filteredRows.length > CARD_PAGE_SIZE && (
                            <div className="risk-pagination">
                                <Pagination current={cardPage} pageSize={CARD_PAGE_SIZE} total={filteredRows.length} onChange={setCardPage} showSizeChanger={false} />
                            </div>
                        )}
                    </>
                ) : <Empty description={rows.length ? t('No risk register entries match this filter.') : t('Nothing needs attention right now.')} />}
            </Card>

            {/* One action, full width; the modal closes with its ✕ (or as a bottom sheet on phones). */}
            <ResponsiveModal
                open={!!selectedRisk}
                onClose={() => setSelectedRisk(null)}
                footer={<Button type="primary" block onClick={takeAction}>{selectedRisk ? t(problemAction(selectedRisk.problems[0])) : t('Take action')}</Button>}
                title={selectedRisk && (
                    <span className="risk-modal-title">
                        <span>{selectedRisk.entityName}</span>
                        <SeverityTag severity={selectedRisk.severity} />
                    </span>
                )}
                width={selectedRisk?.detail?.length ? 680 : 600}
                centered
            >
                {selectedRisk && (
                    <Space orientation="vertical" size={16} style={{ width: '100%' }}>
                        <Descriptions
                            size="small"
                            column={isMobile ? 1 : 2}
                            items={[
                                { key: 'type', label: t('Record'), children: selectedRisk.entityType === 'Intervention' ? t('Intervention') : t('SME') },
                                ...(selectedRisk.smeName ? [{ key: 'sme', label: t('SME'), children: selectedRisk.smeName }] : []),
                                { key: 'owner', label: t('Owner'), children: selectedRisk.owner === 'Operations' ? t('Operations') : selectedRisk.owner },
                                { key: 'due', label: t('Due'), children: <Typography.Text type={selectedRisk.daysOverdue ? 'danger' : undefined}>{dueLabel(selectedRisk, t)}</Typography.Text> },
                            ]}
                        />
                        <ul className="risk-problem-list">
                            {selectedRisk.problems.map((problem, index) => (
                                <li key={`${problem.kind}-${index}`} className={`risk-sev-${problem.severity}`}>
                                    <span className="risk-dot" aria-hidden />
                                    <span>
                                        <Typography.Text strong>{t(PROBLEM_META[problem.kind].category)}</Typography.Text>
                                        <Typography.Paragraph type="secondary">{describeProblem(problem, selectedRisk, t)}</Typography.Paragraph>
                                    </span>
                                </li>
                            ))}
                        </ul>
                        {!!selectedRisk.detail?.length && (
                            <Table<RiskDetailItem>
                                size="small"
                                rowKey="label"
                                pagination={false}
                                dataSource={selectedRisk.detail}
                                columns={[
                                    { title: t('Document'), dataIndex: 'label' },
                                    {
                                        title: t('Reason'),
                                        dataIndex: 'status',
                                        width: 130,
                                        render: (status: string) => <Tag color={BLOCKING_STATUSES.includes(status) ? 'red' : 'gold'}>{t(formatStatus(status))}</Tag>,
                                    },
                                ]}
                            />
                        )}
                    </Space>
                )}
            </ResponsiveModal>
        </DashboardPage>
    )
}
