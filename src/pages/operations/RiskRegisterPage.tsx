import { useCallback, useEffect, useMemo, useState } from 'react'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { Button, Card, Checkbox, Col, DatePicker, Dropdown, Empty, Grid, Input, Pagination, Popconfirm, Row, Select, Table, Tag, Typography, message } from 'antd'
import { ArrowRightOutlined, ClockCircleOutlined, DownOutlined, ExclamationCircleOutlined, FlagOutlined, PhoneOutlined, SearchOutlined, WarningOutlined, WhatsAppOutlined } from '@ant-design/icons'
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
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { listComplianceRows } from '@/services/complianceService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { outcomeRiskFlags } from '@/services/interventionOutcomeConfig'
import { smeAnswerForRound } from '@/services/smeCheckbackService'
import { chaseSme, listRiskReviews, newRiskReview, riskReviewDocId, saveRiskReview, syncRiskReviews, type RiskChase, type RiskChaseKind, type RiskReview, type RiskReviewNote, type RiskReviewStatus } from '@/services/riskReviewService'
import { formatStatus } from '@/utils/status'
import { listDirectorPortfolio } from '@/services/directorPortfolioService'
import { buildRiskReasons } from '@/components/director/SmeRiskReasons'
import type { DirectorPortfolioSme } from '@/types/director'
import { listGrowthLadder, STUCK_QUARTERS } from '@/services/growthLadderService'
import { LADDER_STEPS } from '@/services/growthLadder'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/risk-register.css'

type Severity = 'critical' | 'high' | 'medium' | 'low'
type Status = 'missing' | 'uploaded' | 'pending' | 'valid' | 'rejected' | 'invalid' | 'expired' | 'queried'
type Translate = (key: string, fallback?: string, vars?: Record<string, string | number>) => string
/** Who has to make the next move: our own team, the SME, or the facilitator delivering the intervention. */
type Actor = 'us' | 'sme' | 'facilitator'
type ActorFilter = 'all' | Actor
type StatusFilter = 'all' | RiskReviewStatus
/** Translation plus the company's own word for facilitators (singular, lower case), for sentences that name them. */
type Words = { t: Translate, role: string }

type RiskDetailItem = { label: string, status: string }

type InterventionRef = { id: string, title: string, owner: string }

/**
 * One thing wrong with an SME or one of its interventions. Kept as data and only turned into words when shown,
 * so the register reads in the user's language while everything underneath stays English.
 */
type Problem = {
    severity: Severity
    /** Set when the problem is on one of the SME's interventions rather than the SME itself. */
    intervention?: InterventionRef
} & (
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
    // Business health, from the SME's own monthly figures (the same lines as the director's risk reasons).
    | { kind: 'notReporting', months: number | null }
    | { kind: 'revenueDown', growth: number }
    | { kind: 'jobsDown', start: number, latest: number }
    // On the same growth-ladder step for STUCK_QUARTERS or more (services/growthLadder.ts).
    | { kind: 'stuckOnLadder', step: number, stepTitle: string, quarters: number }
)

/**
 * One line per SME, carrying every problem found on the SME and on its interventions, worst first.
 * The register counts businesses at risk, so an SME never shows more than once.
 */
type RiskRow = {
    key: string
    /** Participant id, or `name:<sme name>` for an intervention whose SME has no participant record; keys the stored review. */
    smeKey: string
    /** Empty when the SME has no participant record. */
    participantId: string
    entityName: string
    problems: Problem[]
    severity: Severity
    /** Days the most overdue intervention is past its due date. */
    daysOverdue: number | null
    /** Per-document breakdown shown as a table in the detail. */
    detail?: RiskDetailItem[]
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
const STAFF_ROLES = ['systemadmin', 'projectadmin', 'projectmanager', 'operations']

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }
const SEVERITY_TAG_COLOR: Record<Severity, string> = { critical: 'red', high: 'volcano', medium: 'orange', low: 'blue' }
const STATUS_LABEL: Record<RiskReviewStatus, string> = { open: 'Open', in_hand: 'In hand', waiting: 'Waiting' }
const STATUS_TAG_COLOR: Record<RiskReviewStatus, string> = { open: 'red', in_hand: 'green', waiting: 'gold' }
/** "Open" alone is the verb in the catalog, so the status has its own key (English falls back to "Open"). */
const statusLabel = (status: RiskReviewStatus, t: Translate) => status === 'open' ? t('Open (risk status)', 'Open') : t(STATUS_LABEL[status])
const LIST_PAGE_SIZE = 15
const CARD_PAGE_SIZE = 8

/** Medium and low are a watch list, hidden unless asked for: the register leads with what needs acting on. */
const isWatch = (row: RiskRow) => SEVERITY_RANK[row.severity] >= SEVERITY_RANK.medium

/**
 * Intervention problems open on Monitoring, which lists every intervention in the company and opens the flagged
 * one's drill-down (with Remind). Not /operations/interventions: that page only lists the signed-in user's own.
 */
const MONITORING_ROUTE = '/operations/interventions/monitoring'
const ASSIGN_ROUTE = '/operations/interventions/assign'
/** The intervention pages are narrower than the register's own roles (routes.tsx); other actions' pages allow every register role. */
const ROUTE_ROLES: Record<string, string[]> = {
    [MONITORING_ROUTE]: ['projectadmin', 'operations'],
    [ASSIGN_ROUTE]: ['projectadmin', 'projectmanager', 'operations'],
}
const canOpenRoute = (route: string, role?: string) => !ROUTE_ROLES[route] || ROUTE_ROLES[route].includes(String(role || ''))
/** The SME's own page (routes.tsx, open to every register role): where support is reviewed. */
const CONTROL_TOWER_ROUTE = '/operations/participants/control-tower'

/**
 * Category, the next step (may name the facilitator as {role}), and how it is done, per kind of problem: a `chase`
 * sends the SME a reminder from the register itself (in the app and on WhatsApp); otherwise the button opens
 * `route`, on the SME's own page when `toSme`.
 */
const PROBLEM_META: Record<Problem['kind'], { category: string, action: string, route: string, chase?: RiskChaseKind, toSme?: boolean }> = {
    compliance: { category: 'Compliance readiness', action: 'Clear required document blockers', route: '/operations/participants/compliance' },
    nonServiced: { category: 'Interventions: non-serviced', action: 'Assign first intervention', route: ASSIGN_ROUTE },
    overdue: { category: 'Interventions: overdue', action: 'Remind the {role}', route: MONITORING_ROUTE },
    outcomeUnresolved: { category: 'Outcome: unresolved', action: 'Review why the change has not stuck', route: MONITORING_ROUTE },
    followUpOverdue: { category: 'Outcome: follow-up overdue', action: 'Ask the {role} to record the follow-up', route: MONITORING_ROUTE },
    notAccepted: { category: 'SME non-responsive', action: 'Send WhatsApp reminder', route: MONITORING_ROUTE, chase: 'sign_plan' },
    notConfirmed: { category: 'SME non-responsive', action: 'Ask the SME to confirm', route: MONITORING_ROUTE, chase: 'confirm_delivery' },
    completionRejected: { category: 'Delivery disputed', action: 'Follow up with the {role}', route: MONITORING_ROUTE },
    noConsultant: { category: 'Interventions: unassigned', action: 'Assign a {role}', route: ASSIGN_ROUTE },
    outcomeDisputed: { category: 'Outcome: disputed', action: 'Talk to the {role} and the SME', route: MONITORING_ROUTE },
    notReporting: { category: 'Business health', action: 'Ask for monthly figures', route: '/operations/participants/metrics', chase: 'monthly_figures' },
    revenueDown: { category: 'Business health', action: 'Review support', route: CONTROL_TOWER_ROUTE, toSme: true },
    jobsDown: { category: 'Business health', action: 'Review support', route: CONTROL_TOWER_ROUTE, toSme: true },
    stuckOnLadder: { category: 'Growth ladder', action: 'Review support', route: CONTROL_TOWER_ROUTE, toSme: true },
}

/** Which problem a reminder is about, so a reminder stops counting once its problem has gone. */
const CHASE_PROBLEM: Record<RiskChaseKind, Problem['kind']> = { sign_plan: 'notAccepted', confirm_delivery: 'notConfirmed', monthly_figures: 'notReporting' }
/** Days without a reply before the register suggests a call. */
const NO_REPLY_DAYS = 3

/** The latest reminder still waiting on the SME: no reply, and the problem it was about is still there. */
const waitingChase = (row: RiskRow, review?: RiskReview) => {
    const latest = Object.values(review?.chases || {})
        .filter(chase => !chase.reply && row.problems.some(problem => problem.kind === CHASE_PROBLEM[chase.kind]
            && (!chase.assignmentId || problem.intervention?.id === chase.assignmentId)))
        .sort((left, right) => right.at.localeCompare(left.at))[0]
    if (!latest) return null
    const days = dayjs().diff(dayjs(latest.at), 'day')
    return { chase: latest, days, needsCall: days >= NO_REPLY_DAYS }
}

/** Who makes the next move on each kind of problem. */
const actorOf = (problem: Problem): Actor => {
    switch (problem.kind) {
        // Missing or expired documents are the SME's to supply; documents waiting for review are ours.
        case 'compliance': return problem.blocking.length ? 'sme' : 'us'
        case 'notAccepted':
        case 'notConfirmed':
        case 'notReporting':
            return 'sme'
        case 'overdue':
        case 'outcomeUnresolved':
        case 'followUpOverdue':
        case 'completionRejected':
            return 'facilitator'
        default: return 'us'
    }
}

const problemAction = (problem: Problem, w: Words) =>
    problem.kind === 'compliance' && !problem.blocking.length ? w.t('Review pending documents') : w.t(PROBLEM_META[problem.kind].action, undefined, { role: w.role })

/** "2 missing, 1 expired": what's wrong, without listing every document. */
const summarizeByReason = (items: RiskDetailItem[], t: Translate) => {
    const counts = new Map<string, number>()
    items.forEach(item => counts.set(item.status, (counts.get(item.status) || 0) + 1))
    return STATUS_SUMMARY_ORDER
        .filter(status => counts.has(status))
        .map(status => `${counts.get(status)} ${t(formatStatus(status)).toLowerCase()}`)
        .join(', ')
}

const describeProblem = (problem: Problem, sme: string, w: Words) => {
    const { t, role } = w
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
        case 'notAccepted': return t('{sme} hasn’t signed their plan yet, so this intervention can’t start.', undefined, { sme })
        case 'notConfirmed': return t('Delivery is marked done, but {sme} hasn’t confirmed it.', undefined, { sme })
        case 'completionRejected': return t('{sme} didn’t confirm that this was delivered.', undefined, { sme })
        case 'noConsultant': return t('No {role} is assigned.', undefined, { role })
        case 'outcomeDisputed': return t('The {role} recorded the change as achieved, but {sme} said it has not happened.', undefined, { role, sme })
            + (problem.note ? ` ${t('Their note: {note}', undefined, { note: problem.note })}` : '')
        case 'notReporting': return problem.months === null
            ? t('No monthly figures reported since joining.')
            : t('No monthly figures reported for {months} months.', undefined, { months: problem.months })
        case 'revenueDown': return problem.growth < 0
            ? t('Revenue has fallen {change}% over the last six months.', undefined, { change: Math.abs(problem.growth) })
            : t('Revenue grew only {change}% over the last six months.', undefined, { change: problem.growth })
        case 'jobsDown': return t('Jobs went from {start} to {latest} since joining.', undefined, { start: problem.start, latest: problem.latest })
        case 'stuckOnLadder': return problem.step === 0
            ? t('Not on the growth ladder after {quarters} quarters.', undefined, { quarters: problem.quarters })
            : t('On step {step} ({title}) of the growth ladder for {quarters} quarters.', undefined, { step: problem.step, title: t(problem.stepTitle), quarters: problem.quarters })
    }
}

/** The problem as a list line shows it: an intervention's problem says which intervention. */
const describeWithContext = (problem: Problem, sme: string, w: Words) =>
    problem.intervention ? `${problem.intervention.title}: ${describeProblem(problem, sme, w)}` : describeProblem(problem, sme, w)

/** Why a problem has the severity it has, in one line (the rules in buildRows, healthProblems and load). */
const severityReason = (problem: Problem, t: Translate) => {
    switch (problem.kind) {
        case 'compliance': return problem.blocking.length >= 3
            ? t('Critical: 3 or more required documents are blocking')
            : problem.blocking.length ? t('High: a required document is blocking') : t('Medium: documents are waiting for review')
        case 'nonServiced': return t('High: no support has started')
        case 'overdue': return problem.severity === 'critical' ? t('Critical: more than 2 weeks late') : t('High: past its due date')
        case 'notAccepted':
        case 'notConfirmed':
        case 'completionRejected':
        case 'noConsultant':
            return problem.severity === 'high' ? t('High: the intervention is also overdue') : t('Medium: the intervention is not overdue yet')
        case 'outcomeUnresolved':
        case 'followUpOverdue':
        case 'outcomeDisputed':
            return t('Medium: the outcome needs checking')
        case 'revenueDown': return problem.growth < 0 ? t('High: revenue is falling') : t('Medium: growth is under 20%')
        case 'stuckOnLadder': return problem.severity === 'high'
            ? t('High: on one step 2 or more quarters longer than expected')
            : t('Medium: on one step for {quarters} quarters or more', undefined, { quarters: STUCK_QUARTERS })
        default: return problem.severity === 'high' ? t('High: from the SME\'s monthly figures') : t('Medium: from the SME\'s monthly figures')
    }
}

const worst = (problems: Problem[]) => problems.reduce<Severity>((current, problem) => SEVERITY_RANK[problem.severity] < SEVERITY_RANK[current] ? problem.severity : current, 'low')
const bySeverity = (left: Problem, right: Problem) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
const byRisk = (left: RiskRow, right: RiskRow) =>
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || (right.daysOverdue ?? -1) - (left.daysOverdue ?? -1)
    || right.problems.length - left.problems.length
    || String(left.entityName || '').localeCompare(String(right.entityName || ''))

/** With a "who has to act" filter on, that person's problems lead; otherwise worst first. */
const orderedProblems = (row: RiskRow, actor: ActorFilter) => actor === 'all'
    ? row.problems
    : [...row.problems.filter(problem => actorOf(problem) === actor), ...row.problems.filter(problem => actorOf(problem) !== actor)]

/** Business-health problems per SME, from the portfolio's figures (see SmeRiskReasons for the lines used). */
type HealthBySme = Map<string, { name: string, problems: Problem[] }>

const healthProblems = (sme: DirectorPortfolioSme): Problem[] => buildRiskReasons(sme).flatMap((reason): Problem[] => {
    const severity: Severity = reason.severity === 'High' ? 'high' : 'medium'
    if (reason.key === 'reporting') {
        const months = sme.lastReport ? Math.floor(dayjs().diff(dayjs(sme.lastReport), 'day') / 30) : null
        return [{ kind: 'notReporting', months, severity }]
    }
    // Only weak or falling revenue (under the 20% line): the register lists what needs acting on, not every dip.
    if (reason.key === 'growth' && sme.metrics.growthRate < 20) return [{ kind: 'revenueDown', growth: sme.metrics.growthRate, severity: sme.metrics.growthRate < 0 ? 'high' : 'medium' }]
    if (reason.key === 'jobs' && sme.growth?.jobs) return [{ kind: 'jobsDown', start: sme.growth.jobs.start, latest: sme.growth.jobs.latest, severity }]
    // Progress, overdue and unresponsive are covered by the intervention problems below.
    return []
})

/** The register's rows, plus every SME in view (at risk or not), so cleared reviews can be told apart from out-of-view ones. */
const buildRows = (participants: ParticipantRow[], interventions: InterventionRow[], health: HealthBySme = new Map(), graduatedIds: Set<string> = new Set()) => {
    // Everything found is gathered per SME, so each business ends up as one row.
    type Entry = { participantId: string, name: string, problems: Problem[], detail?: RiskDetailItem[], daysOverdue: number | null }
    const bySme = new Map<string, Entry>()
    const entryFor = (key: string, participantId: string, name: string) => {
        let entry = bySme.get(key)
        if (!entry) {
            entry = { participantId, name, problems: [], daysOverdue: null }
            bySme.set(key, entry)
        }
        return entry
    }
    // Discontinued and graduated SMEs are no longer a risk to manage: drop them and any assignments still pointing at them.
    const hasLeft = (participant: ParticipantRow) => isDiscontinuedParticipant(participant) || graduatedIds.has(participant.participantId)
    const activeParticipants = participants.filter(participant => !hasLeft(participant))
    const discontinuedIds = new Set([...participants.filter(hasLeft).map(participant => participant.participantId), ...graduatedIds])
    // Some participant records have no business name; fall back to the person, then a placeholder.
    const nameOf = (row: ParticipantRow) => String(row.businessName || (row as ParticipantRow & { participantName?: string }).participantName || '').trim() || 'Unnamed SME'
    const participantNames = new Map(activeParticipants.map(row => [row.participantId, nameOf(row)]))
    const interventionParticipantIds = new Set(interventions.map(row => row.participantId || row.smmeId || row.smeId).filter(Boolean))
    const inView = new Set<string>(activeParticipants.map(row => row.participantId))
    health.forEach((_, participantId) => { if (!discontinuedIds.has(participantId)) inView.add(participantId) })

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
        problems.push(...(health.get(participant.participantId)?.problems || []))
        if (!problems.length) return

        const entry = entryFor(participant.participantId, participant.participantId, nameOf(participant))
        entry.problems.push(...problems)
        if (blocking.length || pending.length) entry.detail = [...blocking, ...pending]
    })

    // SMEs the compliance list doesn't carry (no required documents) still show their business-health problems.
    const listed = new Set(activeParticipants.map(row => row.participantId))
    health.forEach((entry, participantId) => {
        if (listed.has(participantId) || discontinuedIds.has(participantId) || !entry.problems.length) return
        entryFor(participantId, participantId, entry.name).problems.push(...entry.problems)
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
            // Waiting on the facilitator: the SME disputed delivery, or nobody is assigned to deliver it.
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

        const smeName = participantNames.get(participantId) || row.beneficiaryName || row.participantName || row.businessName || row.smmeName || row.companyName || 'Unknown SME'
        // An intervention with no SME id is grouped by the SME name it carries.
        const entry = entryFor(participantId || `name:${lower(smeName)}`, participantId, smeName)
        const intervention: InterventionRef = { id: row.id, title: row.interventionTitle || row.title || 'Untitled intervention', owner: String(row.assigneeName || '').trim() || 'Operations' }
        entry.problems.push(...problems.map(problem => ({ ...problem, intervention })))
        if (overdue && daysLate > (entry.daysOverdue ?? 0)) entry.daysOverdue = daysLate
    })

    const rows = Array.from(bySme.entries())
        .map(([smeKey, entry]): RiskRow => {
            const problems = [...entry.problems].sort(bySeverity)
            return {
                key: `sme-${smeKey}`,
                smeKey,
                participantId: entry.participantId,
                entityName: entry.name,
                problems,
                severity: worst(problems),
                daysOverdue: entry.daysOverdue,
                detail: entry.detail,
            }
        })
        .sort(byRisk)
    return { rows, inView }
}

/** The status as shown: a status set before the SME got worse goes back to open, so nothing hides behind "In hand". */
const statusOf = (row: RiskRow, review?: RiskReview) => {
    if (!review || review.clearedAt) return { status: 'open' as RiskReviewStatus, worse: false }
    const worse = review.status !== 'open' && !!review.severityAtStatus
        && SEVERITY_RANK[row.severity] < SEVERITY_RANK[review.severityAtStatus as Severity]
    return { status: worse ? 'open' as RiskReviewStatus : review.status, worse }
}

const openDaysOf = (review?: RiskReview) => review?.firstSeenAt && !review.clearedAt ? dayjs().diff(dayjs(review.firstSeenAt), 'day') : null

const SeverityTag = ({ severity }: { severity: Severity }) => {
    const { t } = useLanguage()
    return <Tag color={SEVERITY_TAG_COLOR[severity]} className="risk-severity-tag">{t(SEVERITY_LABEL[severity])}</Tag>
}

const StatusTag = ({ status }: { status: RiskReviewStatus }) => {
    const { t } = useLanguage()
    return <Tag color={STATUS_TAG_COLOR[status]} className="risk-severity-tag">{statusLabel(status, t)}</Tag>
}

const overdueLabel = (days: number, t: Translate) => days === 1 ? t('1 day overdue') : t('{days} days overdue', undefined, { days })
const openForLabel = (days: number | null, t: Translate) => days === null ? '—' : days === 1 ? t('1 day') : t('{days} days', undefined, { days })
const ownerLabel = (problem: Problem, t: Translate) => {
    const owner = problem.intervention?.owner || 'Operations'
    return t('Owner: {owner}', undefined, { owner: owner === 'Operations' ? t('Operations') : owner })
}

type ReviewChange = { status: RiskReviewStatus, reviewOn: string | null, note: string }
const LOG_PREVIEW = 5

/** One log line's heading: when, who, and what the update changed besides the note. */
const logMeta = (item: RiskReviewNote, t: Translate) => [
    dayjs(item.at).format('DD MMM'),
    item.byName,
    item.status ? t('set to {status}', undefined, { status: statusLabel(item.status, t) }) : '',
    item.reviewOn !== undefined
        ? item.reviewOn ? t('review {date}', undefined, { date: dayjs(item.reviewOn).format('DD MMM') }) : t('review date cleared')
        : '',
].filter(Boolean).join(' · ')

/** What a reminder asked for, as a log line. */
const chaseText = (chase: RiskChase, t: Translate) => chase.kind === 'sign_plan'
    ? t('Sent a reminder to sign their plan ({title})', undefined, { title: chase.title || '' })
    : chase.kind === 'confirm_delivery'
        ? t('Asked them to confirm delivery of {title}', undefined, { title: chase.title || '' })
        : t('Asked for their monthly figures')

/** How far a reminder got: the SME's reply if any, else how it went out and (on WhatsApp) how far it got. */
const chaseProgress = (chase: RiskChase, t: Translate) => {
    if (chase.reply) return chase.reply.answer === 'yes' ? t('Replied: yes, it was delivered') : t('Replied: no, not delivered yet')
    if (chase.channel === 'none') return t('Not sent: the SME has no account')
    if (chase.channel === 'in_app') return t('In the app only (no WhatsApp)')
    if (chase.channel === 'whatsapp_failed' || chase.whatsappStatus === 'failed') return t('WhatsApp failed; in the app only')
    return chase.whatsappStatus === 'read' ? t('WhatsApp: read')
        : chase.whatsappStatus === 'delivered' ? t('WhatsApp: delivered')
            : t('WhatsApp: sent')
}

/** Logged call results. Saved in English (nothing in Firestore is translated) and translated when shown. */
const CALL_RESULTS = ['Called: reached them', 'Called: no answer'] as const
const noteText = (text: string, t: Translate) => {
    const call = CALL_RESULTS.find(result => text === result || text.startsWith(`${result}: `))
    return call ? `${t(call)}${text.slice(call.length)}` : text
}

/** A note or a reminder, in one timeline. */
type LogEntry = { at: string, key: string, note?: RiskReviewNote, chase?: RiskChase }

/**
 * Everything about one SME: its problems with their reasons and next steps, then "What's being done": the log of
 * updates and reminders, newest first, with a one-line bar to add the next update (status, note, review date).
 */
const RiskDetail = ({ row, review, problems, words, canEdit, canAct, onAction, onSave, onNext }: {
    row: RiskRow
    review?: RiskReview
    problems: Problem[]
    words: Words
    canEdit: boolean
    /** False when the viewer's role can't open the page the action goes to; the action is then left out. */
    canAct: (problem: Problem) => boolean
    /** Opens the action's page, or sends the reminder (resolving when it has gone). */
    onAction: (problem: Problem) => void | Promise<void>
    /** Resolves true once saved; the save shows its own error message. */
    onSave: (change: ReviewChange) => Promise<boolean>
    /** Opens the next SME in the list; absent on the last one. */
    onNext?: () => void
}) => {
    const { t } = words
    const shown = statusOf(row, review)
    const savedReviewOn = review?.reviewOn ? dayjs(review.reviewOn) : null
    const [status, setStatus] = useState<RiskReviewStatus>(shown.status)
    const [note, setNote] = useState('')
    const [reviewOn, setReviewOn] = useState<Dayjs | null>(savedReviewOn)
    const [saving, setSaving] = useState(false)
    const [showAll, setShowAll] = useState(false)
    const log: LogEntry[] = [
        ...(review?.notes || []).map((note, index) => ({ at: note.at, key: `note-${index}-${note.at}`, note })),
        ...Object.values(review?.chases || {}).map(chase => ({ at: chase.at, key: `chase-${chase.id}`, chase })),
    ].sort((left, right) => right.at.localeCompare(left.at))
    const visibleLog = showAll ? log : log.slice(0, LOG_PREVIEW)
    const waiting = waitingChase(row, review)

    const save = async (callResult?: string) => {
        const reviewOnValue = reviewOn ? reviewOn.format('YYYY-MM-DD') : null
        // A logged call leads the note, followed by anything typed.
        const text = callResult ? [callResult, note.trim()].filter(Boolean).join(': ') : note
        if (!text.trim() && status === (review?.status || 'open') && reviewOnValue === (review?.reviewOn || null)) {
            message.info(t('Add an update or change the status first.'))
            return
        }
        setSaving(true)
        try {
            if (await onSave({ status, reviewOn: reviewOnValue, note: text })) setNote('')
        } finally {
            setSaving(false)
        }
    }

    const actionButton = (problem: Problem) => {
        const meta = PROBLEM_META[problem.kind]
        if (!meta.chase) return <Button size="small" onClick={() => void onAction(problem)}>{problemAction(problem, words)}</Button>
        // Sending reaches the SME, so it asks first.
        return (
            <Popconfirm
                title={t('Send this reminder?')}
                description={t('{sme} gets it in the app, and on WhatsApp if they can receive it.', undefined, { sme: row.entityName })}
                okText={t('Send')}
                cancelText={t('Cancel')}
                onConfirm={() => onAction(problem)}
            >
                <Button size="small" icon={<WhatsAppOutlined />}>{problemAction(problem, words)}</Button>
            </Popconfirm>
        )
    }

    return (
        <div className="risk-detail">
            <ul className="risk-problem-list">
                {problems.map((problem, index) => (
                    <li key={`${problem.kind}-${problem.intervention?.id || 'sme'}-${index}`} className={`risk-sev-${problem.severity}`}>
                        <span className="risk-dot" aria-hidden />
                        <span className="risk-problem-body">
                            <span className="risk-problem-head">
                                <Typography.Text strong>{t(PROBLEM_META[problem.kind].category)}</Typography.Text>
                                {canAct(problem) && actionButton(problem)}
                            </span>
                            {problem.intervention && (
                                <Typography.Text type="secondary" className="risk-problem-context">{`${problem.intervention.title} · ${ownerLabel(problem, t)}`}</Typography.Text>
                            )}
                            <Typography.Text className="risk-problem-text">{describeProblem(problem, row.entityName, words)}</Typography.Text>
                            <Typography.Text type="secondary" className="risk-problem-why">{severityReason(problem, t)}</Typography.Text>
                        </span>
                    </li>
                ))}
            </ul>
            {!!row.detail?.length && (
                <Table<RiskDetailItem>
                    size="small"
                    rowKey="label"
                    pagination={false}
                    dataSource={row.detail}
                    columns={[
                        { title: t('Document'), dataIndex: 'label' },
                        {
                            title: t('Reason'),
                            dataIndex: 'status',
                            width: 130,
                            render: (value: string) => <Tag color={BLOCKING_STATUSES.includes(value) ? 'red' : 'gold'}>{t(formatStatus(value))}</Tag>,
                        },
                    ]}
                />
            )}

            <section className="risk-log" aria-label={t('What\'s being done')}>
                <Typography.Text strong className="risk-log-title">{t('What\'s being done')}</Typography.Text>
                {shown.worse && (
                    <Typography.Text type="danger" className="risk-log-worse">
                        <WarningOutlined /> {t('Got worse since it was marked {status}.', undefined, { status: statusLabel(review!.status, t).toLowerCase() })}
                    </Typography.Text>
                )}
                {waiting?.needsCall && (
                    <Typography.Text type="warning" className="risk-log-worse">
                        <PhoneOutlined /> {waiting.chase.phone
                            ? t('No reply in {days} days. Call them on {phone}.', undefined, { days: waiting.days, phone: waiting.chase.phone })
                            : t('No reply in {days} days. Give them a call.', undefined, { days: waiting.days })}
                    </Typography.Text>
                )}
                {log.length ? (
                    <ol className="risk-log-list">
                        {visibleLog.map(entry => entry.chase ? (
                            <li key={entry.key} className="risk-log-chase">
                                <Typography.Text type="secondary" className="risk-log-meta">
                                    {`${dayjs(entry.chase.at).format('DD MMM')} · ${entry.chase.byName}`}
                                </Typography.Text>
                                <Typography.Text><WhatsAppOutlined /> {chaseText(entry.chase, t)}</Typography.Text>
                                <Typography.Text type={entry.chase.reply ? undefined : 'secondary'} className="risk-log-meta">{chaseProgress(entry.chase, t)}</Typography.Text>
                            </li>
                        ) : entry.note && (
                            <li key={entry.key}>
                                <Typography.Text type="secondary" className="risk-log-meta">{logMeta(entry.note, t)}</Typography.Text>
                                {entry.note.text && <Typography.Text>{noteText(entry.note.text, t)}</Typography.Text>}
                            </li>
                        ))}
                    </ol>
                ) : (
                    <Typography.Text type="secondary" className="risk-log-empty">{t('Nothing recorded yet.')}</Typography.Text>
                )}
                {log.length > LOG_PREVIEW && (
                    <Button type="link" size="small" className="risk-log-more" onClick={() => setShowAll(value => !value)}>
                        {showAll ? t('Show fewer') : t('Show {count} earlier', undefined, { count: log.length - LOG_PREVIEW })}
                    </Button>
                )}

                {canEdit ? (
                    <div className="risk-log-composer">
                        <Select<RiskReviewStatus>
                            value={status}
                            onChange={setStatus}
                            className="risk-log-status"
                            aria-label={t('Status')}
                            options={(['open', 'in_hand', 'waiting'] as RiskReviewStatus[]).map(value => ({ value, label: statusLabel(value, t) }))}
                        />
                        <Input
                            value={note}
                            onChange={event => setNote(event.target.value)}
                            onPressEnter={() => void save()}
                            placeholder={t('Add an update')}
                            aria-label={t('Add an update')}
                            className="risk-log-note"
                        />
                        <DatePicker
                            value={reviewOn}
                            onChange={setReviewOn}
                            format="DD MMM"
                            placeholder={t('Review date')}
                            aria-label={t('Review date')}
                            className="risk-log-date"
                        />
                        <Button type="primary" loading={saving} onClick={() => void save()}>{t('Save')}</Button>
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: [
                                    { key: 'reached', label: t('Reached them') },
                                    { key: 'no_answer', label: t('No answer') },
                                ],
                                onClick: ({ key }) => void save(key === 'reached' ? CALL_RESULTS[0] : CALL_RESULTS[1]),
                            }}
                        >
                            <Button icon={<PhoneOutlined />}>{t('Log a call')}</Button>
                        </Dropdown>
                    </div>
                ) : (
                    <Typography.Text type="secondary" className="risk-log-meta">
                        <StatusTag status={shown.status} />
                        {review?.reviewOn ? t('Review on {date}', undefined, { date: dayjs(review.reviewOn).format('DD MMM YYYY') }) : ''}
                    </Typography.Text>
                )}
            </section>

            {onNext && (
                <div className="risk-detail-next">
                    <Button type="link" size="small" onClick={onNext}>{t('Next SME')} <ArrowRightOutlined /></Button>
                </div>
            )}
        </div>
    )
}


/** Phones keep cards: one per SME, opening the same detail as a bottom sheet. */
const RiskCard = ({ row, review, actor, words, actorLabel, onClick }: { row: RiskRow, review?: RiskReview, actor: ActorFilter, words: Words, actorLabel: (actor: Actor) => string, onClick: () => void }) => {
    const { t } = words
    const [primary, ...others] = orderedProblems(row, actor)
    const { status } = statusOf(row, review)
    return (
        <button type="button" onClick={onClick} className={`risk-card risk-sev-${row.severity}`}>
            <span className="risk-card-head">
                <span className="risk-dot" aria-hidden />
                <span className="risk-card-title">
                    <Typography.Text strong ellipsis>{row.entityName}</Typography.Text>
                    <Typography.Text type="secondary" ellipsis className="risk-card-sub">{actorLabel(actorOf(primary))}</Typography.Text>
                </span>
                <StatusTag status={status} />
            </span>
            <Typography.Paragraph className="risk-card-issue" ellipsis={{ rows: 2 }}>{describeWithContext(primary, row.entityName, words)}</Typography.Paragraph>
            <span className="risk-card-foot">
                <Typography.Text type="secondary" ellipsis>{t('Open for {days}', undefined, { days: openForLabel(openDaysOf(review), t) })}</Typography.Text>
                <span className="risk-card-tags">
                    {others.length > 0 && <Tag variant="filled">{t('+{count} more', undefined, { count: others.length })}</Tag>}
                    {!!row.daysOverdue && <Tag variant="filled" color="red">{overdueLabel(row.daysOverdue, t)}</Tag>}
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
    const { consultantLabel } = useSystemSettings()
    const [loading, setLoading] = useState(true)
    const [actor, setActor] = useState<ActorFilter>('all')
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
    const [includeWatch, setIncludeWatch] = useState(false)
    const [search, setSearch] = useState('')
    const [rows, setRows] = useState<RiskRow[]>([])
    const [inViewCount, setInViewCount] = useState(0)
    const [reviews, setReviews] = useState<Map<string, RiskReview>>(new Map())
    const [expandedKey, setExpandedKey] = useState<string | null>(null)
    const [page, setPage] = useState(1)

    const canEdit = !!user?.companyCode && STAFF_ROLES.includes(String(user?.role || ''))
    // The company's own word for facilitators: plural for the filter, singular for sentences and "… to act".
    const rolePlural = consultantLabel || 'Facilitators'
    const roleSingular = rolePlural.endsWith('s') ? rolePlural.slice(0, -1) : rolePlural
    const words = useMemo<Words>(() => ({ t, role: roleSingular.toLowerCase() }), [roleSingular, t])
    const actorLabel = useCallback((value: Actor) => value === 'us' ? t('Us to act') : value === 'sme' ? t('SME to act') : t('{role} to act', undefined, { role: roleSingular }), [roleSingular, t])

    // Changing what is shown starts again from the first page with nothing open.
    const resetView = () => {
        setExpandedKey(null)
        setPage(1)
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
            const [assignments, portfolio, ladder, storedReviews] = await Promise.all([
                companyCode ? getDocs(query(collection(db, 'assignedInterventions'), ...constraints)).then(snapshot => snapshot.docs) : Promise.resolve([]),
                // Business figures, read the same way the director's portfolio reads them; the register still loads without them.
                user ? listDirectorPortfolio(user, activeProgramId).catch(() => []) : Promise.resolve([]),
                // The growth ladder, for SMEs stuck on one step (and to leave graduates out).
                user ? listGrowthLadder(user, activeProgramId).catch(() => []) : Promise.resolve([]),
                // What the team has recorded about each SME; the register still works without it.
                user && companyCode ? listRiskReviews(user).catch(error => { console.warn('[RISK REGISTER] Reviews unavailable:', error); return new Map<string, RiskReview>() }) : Promise.resolve(new Map<string, RiskReview>()),
            ])
            const health: HealthBySme = new Map(portfolio.map(sme => [sme.id, { name: sme.name, problems: healthProblems(sme) }]))
            ladder.filter(sme => sme.stuck).forEach(sme => {
                const problem: Problem = {
                    kind: 'stuckOnLadder',
                    step: sme.current.rung,
                    stepTitle: sme.current.rung ? LADDER_STEPS[sme.current.rung - 1].title : '',
                    quarters: sme.quartersOnStep,
                    severity: sme.quartersOnStep >= STUCK_QUARTERS + 2 ? 'high' : 'medium',
                }
                const entry = health.get(sme.id)
                if (entry) entry.problems.push(problem)
                else health.set(sme.id, { name: sme.name, problems: [problem] })
            })
            const graduatedIds = new Set(ladder.filter(sme => sme.status === 'graduated').map(sme => sme.id))
            const built = buildRows(
                compliance.rows as unknown as ParticipantRow[],
                assignments
                    .map(doc => ({ id: doc.id, ...doc.data() }) as InterventionRow)
                    .filter(row => matchesActiveProgram(user, activeProgramId, row.programId))
                    .filter(row => !isDiscontinuedRecord(row as { participantDiscontinuedAt?: unknown })),
                health,
                graduatedIds,
            )
            setRows(built.rows)
            setInViewCount(built.inView.size)
            let current = storedReviews
            if (user && canEdit) {
                // Date new arrivals and reopen returning SMEs. Only the all-programmes view sees every SME, so only it
                // may mark an SME as cleared: one programme's view would clear SMEs at risk in another.
                try {
                    current = await syncRiskReviews(user, storedReviews, built.rows.map(row => ({ smeKey: row.smeKey, smeName: row.entityName })), built.inView, isAllPrograms || !activeProgramId)
                } catch (error) {
                    console.warn('[RISK REGISTER] Could not update reviews:', error)
                }
            }
            setReviews(current)
        } catch (error) {
            console.error('[RISK REGISTER] Failed loading risk register:', error)
            message.error(t('Risk register could not be loaded.'))
            setRows([])
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, canEdit, identityLoading, isAllPrograms, user, t])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    // Search, watch list and status narrow the rows; the "who has to act" chips then pick from what is left.
    const baseRows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rows.filter(row => {
            if (!includeWatch && isWatch(row)) return false
            if (statusFilter !== 'all' && statusOf(row, reviews.get(row.smeKey)).status !== statusFilter) return false
            if (!needle) return true
            return [
                row.entityName,
                ...row.problems.flatMap(problem => [t(PROBLEM_META[problem.kind].category), describeWithContext(problem, row.entityName, words), problem.intervention?.owner || '']),
            ].some(value => value.toLowerCase().includes(needle))
        })
    }, [includeWatch, reviews, rows, search, statusFilter, t, words])

    const actorSummaries = useMemo(() => (['us', 'sme', 'facilitator'] as Actor[]).map(value => {
        const matching = baseRows.filter(row => row.problems.some(problem => actorOf(problem) === value))
        const worstSeverity = matching.reduce<Severity>((current, row) => {
            const rowWorst = worst(row.problems.filter(problem => actorOf(problem) === value))
            return SEVERITY_RANK[rowWorst] < SEVERITY_RANK[current] ? rowWorst : current
        }, 'low')
        return { actor: value, count: matching.length, worst: worstSeverity }
    }), [baseRows])

    const filteredRows = useMemo(
        () => actor === 'all' ? baseRows : baseRows.filter(row => row.problems.some(problem => actorOf(problem) === actor)),
        [actor, baseRows],
    )

    const pageSize = isMobile ? CARD_PAGE_SIZE : LIST_PAGE_SIZE
    const pagedRows = useMemo(() => filteredRows.slice((page - 1) * pageSize, page * pageSize), [filteredRows, page, pageSize])

    const metrics = useMemo(() => {
        const atRisk = rows.filter(row => !isWatch(row))
        const openDays = atRisk.map(row => openDaysOf(reviews.get(row.smeKey))).filter((days): days is number => days !== null)
        return {
            atRisk: atRisk.length,
            watch: rows.length - atRisk.length,
            newThisWeek: openDays.filter(days => days < 7).length,
            handled: atRisk.filter(row => statusOf(row, reviews.get(row.smeKey)).status !== 'open').length,
            longest: openDays.length ? Math.max(...openDays) : null,
        }
    }, [reviews, rows])

    // Bring a newly opened row into view (after "Save and open next" especially).
    useEffect(() => {
        if (!expandedKey || isMobile) return
        document.getElementById(`risk-${expandedKey}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, [expandedKey, isMobile])

    const takeAction = async (row: RiskRow, problem: Problem) => {
        const meta = PROBLEM_META[problem.kind]
        if (meta.chase) {
            await sendChase(row, problem, meta.chase)
            return
        }
        if (meta.toSme) {
            navigate(`${meta.route}/${row.participantId}`)
            return
        }
        const state = problem.intervention
            ? { focusInterventionId: problem.intervention.id }
            : row.participantId ? { focusParticipantId: row.participantId } : undefined
        navigate(meta.route, { state })
    }

    const sendChase = async (row: RiskRow, problem: Problem, kind: RiskChaseKind) => {
        if (!user?.companyCode) return
        try {
            const result = await chaseSme(
                { participantId: row.participantId, kind, ...(problem.intervention ? { assignmentId: problem.intervention.id } : {}) },
                riskReviewDocId(user.companyCode, row.smeKey),
            )
            if (result.review) setReviews(previous => new Map(previous).set(row.smeKey, result.review!))
            if (result.channel === 'whatsapp') message.success(t('Sent on WhatsApp and in the app.'))
            else if (result.channel === 'none') message.warning(t('This SME has no account to send to. Call them instead.'))
            else message.warning(t('Sent in the app only: no WhatsApp we can use for this SME.'))
        } catch (error) {
            console.error('[RISK REGISTER] Could not send reminder:', error)
            message.error(t('The reminder could not be sent. Try again.'))
        }
    }

    /** Whether this viewer can take a problem's action: reminders are for staff and need the SME's record. */
    const canAct = (row: RiskRow, problem: Problem) => {
        const meta = PROBLEM_META[problem.kind]
        if (meta.chase) return canEdit && !!row.participantId && (meta.chase === 'monthly_figures' || !!problem.intervention)
        if (meta.toSme) return !!row.participantId
        return canOpenRoute(meta.route, user?.role)
    }

    const saveReview = async (row: RiskRow, change: ReviewChange) => {
        if (!user?.companyCode) return false
        try {
            const current = reviews.get(row.smeKey) || newRiskReview(user.companyCode, row.smeKey, row.entityName)
            const saved = await saveRiskReview(user, current, { ...change, severity: row.severity })
            setReviews(previous => new Map(previous).set(row.smeKey, saved))
            message.success(t('Saved'))
            return true
        } catch (error) {
            console.error('[RISK REGISTER] Could not save review:', error)
            message.error(t('Could not save. Try again.'))
            return false
        }
    }

    // The status pill on a row changes just the status (and logs it), keeping the review date.
    const quickStatus = (row: RiskRow, status: RiskReviewStatus) =>
        void saveReview(row, { status, reviewOn: reviews.get(row.smeKey)?.reviewOn || null, note: '' })

    const openNextAfter = (row: RiskRow) => {
        const index = filteredRows.findIndex(item => item.key === row.key)
        const next = filteredRows[index + 1]
        setExpandedKey(next ? next.key : null)
        if (next) setPage(Math.floor((index + 1) / pageSize) + 1)
    }

    const pageLoading = identityLoading || loading
    const expandedRow = expandedKey ? filteredRows.find(row => row.key === expandedKey) || null : null
    const hasNextAfter = (row: RiskRow) => filteredRows.findIndex(item => item.key === row.key) < filteredRows.length - 1

    const detailFor = (row: RiskRow) => (
        <RiskDetail
            key={row.key}
            row={row}
            review={reviews.get(row.smeKey)}
            problems={orderedProblems(row, actor)}
            words={words}
            canEdit={canEdit}
            canAct={problem => canAct(row, problem)}
            onAction={problem => takeAction(row, problem)}
            onSave={change => saveReview(row, change)}
            onNext={hasNextAfter(row) ? () => openNextAfter(row) : undefined}
        />
    )

    /** The row's status pill: a menu for staff, a plain tag for everyone else. */
    const statusControl = (row: RiskRow, status: RiskReviewStatus) => canEdit ? (
        <Dropdown
            trigger={['click']}
            menu={{
                selectable: true,
                selectedKeys: [status],
                items: (['open', 'in_hand', 'waiting'] as RiskReviewStatus[]).map(value => ({ key: value, label: statusLabel(value, t) })),
                onClick: ({ key, domEvent }) => {
                    domEvent.stopPropagation()
                    if (key !== status) quickStatus(row, key as RiskReviewStatus)
                },
            }}
        >
            <button type="button" className="risk-status-trigger" aria-label={t('Change status')} onClick={event => event.stopPropagation()}>
                <StatusTag status={status} /><DownOutlined aria-hidden />
            </button>
        </Dropdown>
    ) : <StatusTag status={status} />

    const ofTotal = (value: number, total: number) => <>{value} <span className="risk-metric-of">{t('of {total}', undefined, { total })}</span></>

    return (
        <DashboardPage className="operations-risk-register-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={pageLoading}
                        icon={<ExclamationCircleOutlined />}
                        iconClassName="dashboard-icon-red"
                        label={t('SMEs at risk')}
                        value={ofTotal(metrics.atRisk, inViewCount)}
                        hint={metrics.watch ? t('{count} more on the watch list', undefined, { count: metrics.watch }) : undefined}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<FlagOutlined />} iconClassName="dashboard-icon-blue" label={t('New this week')} value={metrics.newThisWeek} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<WarningOutlined />} iconClassName="dashboard-icon-green" label={t('In hand')} value={ofTotal(metrics.handled, metrics.atRisk)} hint={t('In hand or waiting on someone')} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={pageLoading} icon={<ClockCircleOutlined />} iconClassName="dashboard-icon-orange" label={t('Open longest')} value={metrics.longest === null ? '—' : openForLabel(metrics.longest, t)} />
                </Col>
            </Row>

            <FilterBar
                compact
                primary={
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={event => { setSearch(event.target.value); resetView() }} placeholder={t('Search SME, problem, intervention...')} allowClear className="risk-search" />
                        <Select
                            value={statusFilter}
                            onChange={value => { setStatusFilter(value); resetView() }}
                            className="risk-filter-select"
                            aria-label={t('Status')}
                            options={[{ label: t('All statuses'), value: 'all' }, ...(['open', 'in_hand', 'waiting'] as RiskReviewStatus[]).map(value => ({ label: statusLabel(value, t), value }))]}
                        />
                        <Checkbox checked={includeWatch} onChange={event => { setIncludeWatch(event.target.checked); resetView() }}>
                            {t('Include watch list ({count})', undefined, { count: metrics.watch })}
                        </Checkbox>
                    </>
                }
            />

            <Card loading={pageLoading} className="dashboard-section-card motion-card risk-register-card">
                {/* Who has to make the next move. Counts are SMEs with at least one such problem, so an SME can count under more than one. */}
                <div className="risk-chips" role="tablist" aria-label={t('Who has to act')}>
                    <button type="button" role="tab" aria-selected={actor === 'all'} className={`risk-chip${actor === 'all' ? ' is-selected' : ''}`} onClick={() => { setActor('all'); resetView() }}>
                        {t('All')} <span className="risk-chip-count">{baseRows.length}</span>
                    </button>
                    {actorSummaries.map(summary => (
                        <button
                            key={summary.actor}
                            type="button"
                            role="tab"
                            aria-selected={actor === summary.actor}
                            className={`risk-chip${summary.count ? ` risk-sev-${summary.worst}` : ''}${actor === summary.actor ? ' is-selected' : ''}`}
                            onClick={() => { setActor(summary.actor); resetView() }}
                        >
                            {summary.count > 0 && <span className="risk-dot" aria-hidden />}
                            {summary.actor === 'us' ? t('Us') : summary.actor === 'sme' ? t('SMEs') : t(rolePlural)} <span className="risk-chip-count">{summary.count}</span>
                        </button>
                    ))}
                </div>

                {filteredRows.length ? (
                    <>
                        {isMobile ? (
                            <div className="risk-card-grid">
                                {pagedRows.map(row => (
                                    <RiskCard key={row.key} row={row} review={reviews.get(row.smeKey)} actor={actor} words={words} actorLabel={actorLabel} onClick={() => setExpandedKey(row.key)} />
                                ))}
                            </div>
                        ) : (
                            <div className="risk-list" role="list">
                                <div className="risk-list-head" aria-hidden>
                                    <span />
                                    <span>{t('SME')}</span>
                                    <span>{t('Lead problem')}</span>
                                    <span>{t('Open for')}</span>
                                    <span>{t('Status')}</span>
                                    <span />
                                </div>
                                {pagedRows.map(row => {
                                    const review = reviews.get(row.smeKey)
                                    const [lead, ...others] = orderedProblems(row, actor)
                                    const { status } = statusOf(row, review)
                                    const openDays = openDaysOf(review)
                                    const isOpen = expandedKey === row.key
                                    const reviewDue = review?.reviewOn && !dayjs(review.reviewOn).isAfter(dayjs(), 'day')
                                    const waiting = waitingChase(row, review)
                                    return (
                                        <div key={row.key} id={`risk-${row.key}`} role="listitem" className={`risk-list-item risk-sev-${row.severity}${isOpen ? ' is-open' : ''}`}>
                                            {/* A div acting as the button, because the status pill inside it is a control of its own. */}
                                            <div
                                                role="button"
                                                tabIndex={0}
                                                className="risk-list-row"
                                                aria-expanded={isOpen}
                                                onClick={() => setExpandedKey(isOpen ? null : row.key)}
                                                onKeyDown={event => {
                                                    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
                                                    event.preventDefault()
                                                    setExpandedKey(isOpen ? null : row.key)
                                                }}
                                            >
                                                <span className="risk-dot" aria-label={t(SEVERITY_LABEL[row.severity])} />
                                                <span className="risk-list-cell">
                                                    <span className="risk-list-name">
                                                        <Typography.Text strong ellipsis>{row.entityName}</Typography.Text>
                                                        {openDays !== null && openDays < 7 && <Tag color="blue" className="risk-severity-tag">{t('New')}</Tag>}
                                                    </span>
                                                    <Typography.Text type="secondary" ellipsis className="risk-list-sub">{actorLabel(actorOf(lead))}</Typography.Text>
                                                </span>
                                                <span className="risk-list-cell">
                                                    <Typography.Text ellipsis>{describeWithContext(lead, row.entityName, words)}</Typography.Text>
                                                    <Typography.Text type="secondary" ellipsis className="risk-list-sub">
                                                        {t(PROBLEM_META[lead.kind].category)}
                                                        {others.length > 0 ? ` · ${t('+{count} more', undefined, { count: others.length })}` : ''}
                                                    </Typography.Text>
                                                </span>
                                                <span className="risk-list-cell">
                                                    <Typography.Text>{openForLabel(openDays, t)}</Typography.Text>
                                                    {!!row.daysOverdue && <Typography.Text type="danger" className="risk-list-sub">{overdueLabel(row.daysOverdue, t)}</Typography.Text>}
                                                </span>
                                                <span className="risk-list-cell">
                                                    <span>{statusControl(row, status)}</span>
                                                    {/* A reminder waiting on the SME says so first; otherwise the review date. */}
                                                    {waiting ? (
                                                        <Typography.Text type={waiting.needsCall ? 'warning' : 'secondary'} className="risk-list-sub">
                                                            {waiting.needsCall ? t('No reply, call them') : t('Reminder sent')}
                                                        </Typography.Text>
                                                    ) : review?.reviewOn && (
                                                        <Typography.Text type={reviewDue ? 'danger' : 'secondary'} className="risk-list-sub">
                                                            {t('Review {date}', undefined, { date: dayjs(review.reviewOn).format('DD MMM') })}
                                                        </Typography.Text>
                                                    )}
                                                </span>
                                                <DownOutlined className="risk-list-chevron" aria-hidden />
                                            </div>
                                            {isOpen && <div className="risk-list-detail">{detailFor(row)}</div>}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                        {filteredRows.length > pageSize && (
                            <div className="risk-pagination">
                                <Pagination current={page} pageSize={pageSize} total={filteredRows.length} onChange={value => { setPage(value); setExpandedKey(null) }} showSizeChanger={false} />
                            </div>
                        )}
                    </>
                ) : (
                    <Empty description={rows.length ? t('No risk register entries match this filter.') : t('Nothing needs attention right now.')} />
                )}
            </Card>

            {/* Phones: the same detail as a bottom sheet. */}
            <ResponsiveModal
                open={isMobile && !!expandedRow}
                onClose={() => setExpandedKey(null)}
                title={expandedRow && (
                    <span className="risk-modal-title">
                        <span>{expandedRow.entityName}</span>
                        <SeverityTag severity={expandedRow.severity} />
                    </span>
                )}
                width={680}
                centered
            >
                {isMobile && expandedRow && detailFor(expandedRow)}
            </ResponsiveModal>
        </DashboardPage>
    )
}
