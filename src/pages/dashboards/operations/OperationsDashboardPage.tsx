import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Button,
    Card,
    Col,
    Empty,
    List,
    Progress,
    Row,
    Space,
    Spin,
    Typography,
    message,
    theme,
} from 'antd'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import isoWeek from 'dayjs/plugin/isoWeek'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import {
    ExclamationCircleOutlined,
    ExpandAltOutlined,
    FileDoneOutlined,
    SafetyCertificateOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import { useWindowSize } from '@/hooks/useWindowSize'
import { useNavigate } from 'react-router-dom'
import {
    collection,
    getDocs,
    query,
    where,
    type QueryConstraint,
} from 'firebase/firestore'

import { db } from '@/firebase/config'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { listComplianceRows } from '@/services/complianceService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { UpcomingWeekCard, type InterventionDueItem } from './UpcomingWeekCard'
import '@/styles/dashboard.css'
import '@/styles/compliance-tracker.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

dayjs.extend(isBetween)
dayjs.extend(isoWeek)
dayjs.extend(isSameOrBefore)
dayjs.extend(quarterOfYear)

const { Text } = Typography

const RISK_REGISTER_ROUTE = '/operations/risk-register'

type FilterPreset = 'today' | 'week' | 'month' | 'custom'

type ComplianceStatus =
    | 'missing'
    | 'uploaded'
    | 'pending'
    | 'valid'
    | 'rejected'
    | 'invalid'
    | 'expired'
    | 'queried'

type FirestoreDate =
    | {
        toDate?: () => Date
        seconds?: number
    }
    | Date
    | string
    | null
    | undefined

type RequiredDoc = {
    id: string
    key: string
    title: string
    type: 'upload'
    group?: string
    requiredAt: 'registration' | 'program'
    hasExpiry: boolean
    expiryMonths?: number | null
    presetId?: string
}

type ParticipantComplianceTimeline = {
    id: string
    participantId: string
    programId?: string | null
    branchId?: string | null
    key: string
    type: string
    group?: string
    currentStatus: ComplianceStatus
    currentFile?: {
        url?: string | null
        fileName?: string | null
        issueDate?: string | null
        expiryDate?: string | null
        uploadedAt?: FirestoreDate
    } | null
    trail?: Array<{
        status: ComplianceStatus
        action: string
        performedAt?: FirestoreDate
    }>
    queryReason?: string | null
    updatedAt?: FirestoreDate
    createdAt?: FirestoreDate
}

type ParticipantRow = {
    id: string
    participantId: string
    businessName: string
    contactEmail: string
    programId?: string | null
    programName?: string | null
    branchName?: string | null
    createdAt?: FirestoreDate
    acceptedAt?: FirestoreDate
    approvedAt?: FirestoreDate
    onboardedAt?: FirestoreDate
    employeeCount?: number | string | null
    employees?: number | string | null
    numberOfEmployees?: number | string | null
    staffCount?: number | string | null
    jobsCreated?: number | string | null
    revenue?: number | string | null
    annualRevenue?: number | string | null
    monthlyRevenue?: number | string | null
    turnover?: number | string | null
    annualTurnover?: number | string | null
    documents: ParticipantComplianceTimeline[]
    required: RequiredDoc[]
}

type AssignedInterventionRow = {
    id: string
    participantId?: string | null
    smmeId?: string | null
    smeId?: string | null
    participantName?: string | null
    businessName?: string | null
    smmeName?: string | null
    companyName?: string | null
    assigneeName?: string | null
    interventionTitle?: string | null
    status?: string | null
    assigneeCompletionStatus?: string | null
    participantCompletionStatus?: string | null
    progress?: number | string | null
    programId?: string | null
    dueDate?: FirestoreDate
    startDate?: FirestoreDate
    assignedAt?: FirestoreDate
    createdAt?: FirestoreDate
    updatedAt?: FirestoreDate
    completedAt?: FirestoreDate
    completionConfirmedAt?: FirestoreDate
}

type RiskLevel = 'critical' | 'high' | 'medium' | 'low'

type RiskCategoryRow = {
    key: string
    label: string
    description: string
    count: number
    critical: number
    high: number
    medium: number
    low: number
    action: string
}

type RiskRegisterRow = {
    key: string
    category: string
    entityType: 'SME' | 'Intervention' | 'Consultant'
    entityName: string
    owner: string
    issue: string
    severity: RiskLevel
    dueDate: Dayjs | null
    action: string
}

type InterventionBucket = {
    key: string
    label: string
    start: Dayjs
    end: Dayjs
}

const cleanKey = (value?: string) =>
    (value || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

const toDayjs = (value: FirestoreDate): Dayjs => {
    if (!value) return dayjs('')
    if (dayjs.isDayjs(value)) return value
    if (value instanceof Date) return dayjs(value)
    if (typeof value === 'string') return dayjs(value)
    if (typeof value === 'object' && value?.toDate) return dayjs(value.toDate())
    if (typeof value === 'object' && value?.seconds) return dayjs(value.seconds * 1000)

    return dayjs('')
}

const getRangeFromPreset = (preset: FilterPreset): [Dayjs, Dayjs] | null => {
    const now = dayjs()

    if (preset === 'today') return [now.startOf('day'), now.endOf('day')]
    if (preset === 'week') return [now.startOf('isoWeek'), now.endOf('isoWeek')]
    if (preset === 'month') return [now.startOf('month'), now.endOf('month')]

    return null
}

const getPreviousRange = (range: [Dayjs, Dayjs] | null): [Dayjs, Dayjs] | null => {
    if (!range) return null

    const [start, end] = range
    const days = end.startOf('day').diff(start.startOf('day'), 'day') + 1
    const previousEnd = start.subtract(1, 'day').endOf('day')
    const previousStart = previousEnd.subtract(days - 1, 'day').startOf('day')

    return [previousStart, previousEnd]
}

const clampRangeToToday = (range: [Dayjs, Dayjs] | null): [Dayjs, Dayjs] | null => {
    if (!range) return null

    const today = dayjs().endOf('day')
    const [start, end] = range

    if (start.isAfter(today, 'day')) {
        return null
    }

    return [start, end.isAfter(today, 'day') ? today : end]
}

const isInRange = (date: Dayjs, range: [Dayjs, Dayjs] | null) => {
    if (!range) return true
    return date.isValid() && date.isBetween(range[0], range[1], 'day', '[]')
}

const getDelta = (current: number, previous: number) => {
    const difference = current - previous

    if (previous === 0) {
        const percent = current > 0 ? 100 : 0
        return {
            label: current > 0 ? '+100%' : '0%',
            positive: difference >= 0,
            percent,
        }
    }

    const percent = Number(((difference / previous) * 100).toFixed(1))

    return {
        label: `${percent > 0 ? '+' : ''}${percent}%`,
        positive: difference >= 0,
        percent,
    }
}

const documentMatchesRequirement = (
    docItem: ParticipantComplianceTimeline,
    requirement: RequiredDoc,
) => {
    return cleanKey(docItem.key || docItem.type) === requirement.key
}

const getDocStatus = (
    docItem: ParticipantComplianceTimeline | undefined,
    requirement?: RequiredDoc,
): ComplianceStatus => {
    if (!docItem) return 'missing'

    const expiry = docItem.currentFile?.expiryDate
        ? dayjs(docItem.currentFile.expiryDate)
        : null

    if (requirement?.hasExpiry && expiry?.isValid() && expiry.isBefore(dayjs(), 'day')) {
        return 'expired'
    }

    return docItem.currentStatus || 'pending'
}

const getCoverage = (row: ParticipantRow) => {
    const uploaded = row.required.filter(req =>
        row.documents.some(docItem => documentMatchesRequirement(docItem, req)),
    ).length

    const valid = row.required.filter(req => {
        const docItem = row.documents.find(item => documentMatchesRequirement(item, req))
        return getDocStatus(docItem, req) === 'valid'
    }).length

    const pending = row.required.filter(req => {
        const docItem = row.documents.find(item => documentMatchesRequirement(item, req))
        const status = getDocStatus(docItem, req)

        return ['pending', 'uploaded', 'queried'].includes(status)
    }).length

    const problem = row.required.filter(req => {
        const docItem = row.documents.find(item => documentMatchesRequirement(item, req))
        const status = getDocStatus(docItem, req)

        return ['missing', 'expired', 'invalid', 'rejected'].includes(status)
    }).length

    return {
        uploaded,
        valid,
        pending,
        problem,
        total: row.required.length,
        percent: row.required.length ? Math.round((valid / row.required.length) * 100) : 0,
    }
}

const getParticipantAnchorDate = (row: ParticipantRow) => {
    const candidates = [
        row.onboardedAt,
        row.acceptedAt,
        row.approvedAt,
        row.createdAt,
        ...row.documents.flatMap(docItem => [
            docItem.createdAt,
            docItem.updatedAt,
            docItem.currentFile?.uploadedAt,
        ]),
    ]

    for (const candidate of candidates) {
        const dt = toDayjs(candidate)
        if (dt.isValid()) return dt
    }

    return null
}

const getInterventionAssignedDate = (row: AssignedInterventionRow) => {
    const candidates = [row.assignedAt, row.startDate, row.createdAt, row.updatedAt]

    for (const candidate of candidates) {
        const dt = toDayjs(candidate)
        if (dt.isValid()) return dt
    }

    return dayjs('')
}

const getInterventionCompletedDate = (row: AssignedInterventionRow) => {
    const candidates = [row.completedAt, row.completionConfirmedAt]

    for (const candidate of candidates) {
        const dt = toDayjs(candidate)
        if (dt.isValid()) return dt
    }

    return dayjs('')
}

const isCompletedIntervention = (row: AssignedInterventionRow) => {
    const status = String(row.status || '').toLowerCase()
    const assignee = String(row.assigneeCompletionStatus || '').toLowerCase()
    const participant = String(row.participantCompletionStatus || '').toLowerCase()

    return (
        status === 'completed' ||
        Boolean(row.completedAt) ||
        Boolean(row.completionConfirmedAt) ||
        (assignee === 'done' && participant === 'confirmed')
    )
}

const riskRank: Record<RiskLevel, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const getInterventionParticipantId = (row: AssignedInterventionRow) =>
    row.participantId || row.smmeId || row.smeId || ''

const getInterventionParticipantName = (row: AssignedInterventionRow) =>
    row.participantName || row.businessName || row.smmeName || row.companyName || 'Unknown SME'

const getInterventionTitle = (row: AssignedInterventionRow) =>
    row.interventionTitle || 'Untitled intervention'

const getInterventionOwner = (row: AssignedInterventionRow) =>
    row.assigneeName || 'Operations'

const includesAny = (value: unknown, terms: string[]) => {
    const normalized = String(value || '').toLowerCase()
    return terms.some(term => normalized.includes(term))
}

const getComplianceRiskRegisterRows = (rows: ParticipantRow[]): RiskRegisterRow[] => {
    return rows.flatMap(row => {
        const coverage = getCoverage(row)
        if (coverage.problem === 0 && coverage.pending === 0) return []

        const statusCounts = row.required.reduce(
            (counts, req) => {
                const docItem = row.documents.find(item => documentMatchesRequirement(item, req))
                const status = getDocStatus(docItem, req)
                counts[status] = (counts[status] || 0) + 1
                return counts
            },
            {} as Partial<Record<ComplianceStatus, number>>,
        )

        const missing = statusCounts.missing || 0
        const expired = statusCounts.expired || 0
        const rejected = (statusCounts.rejected || 0) + (statusCounts.invalid || 0)
        const queried = statusCounts.queried || 0
        const pendingReview = (statusCounts.pending || 0) + (statusCounts.uploaded || 0)
        const blockers = missing + expired + rejected
        const severity: RiskLevel =
            blockers >= 3 ? 'critical' : blockers > 0 ? 'high' : queried > 0 ? 'medium' : 'low'

        return [{
            key: `compliance-${row.participantId}`,
            category: 'Compliance readiness',
            entityType: 'SME' as const,
            entityName: row.businessName,
            owner: 'Operations',
            issue: `${coverage.percent}% ready; ${blockers} blocking, ${queried + pendingReview} pending/query`,
            severity,
            dueDate: null,
            action: blockers > 0 ? 'Clear required document blockers' : 'Review pending/queried documents',
        }]
    })
}

const getInterventionRiskRegisterRows = (
    participants: ParticipantRow[],
    interventions: AssignedInterventionRow[],
): RiskRegisterRow[] => {
    const today = dayjs().endOf('day')
    const rows: RiskRegisterRow[] = []
    const participantIds = new Set(participants.map(row => row.participantId).filter(Boolean))
    const interventionParticipantIds = new Set(
        interventions.map(getInterventionParticipantId).filter(Boolean),
    )

    participants.forEach(row => {
        if (!participantIds.has(row.participantId)) return
        if (interventionParticipantIds.has(row.participantId)) return

        rows.push({
            key: `non-serviced-${row.participantId}`,
            category: 'Interventions: non-serviced',
            entityType: 'SME',
            entityName: row.businessName,
            owner: 'Operations',
            issue: 'No assigned intervention recorded for this SME',
            severity: 'high',
            dueDate: null,
            action: 'Assign first intervention or confirm support plan',
        })
    })

    interventions.forEach(row => {
        const dueDate = toDayjs(row.dueDate)
        const isOverdue = dueDate.isValid() && dueDate.isBefore(today, 'day') && !isCompletedIntervention(row)
        const daysLate = isOverdue ? today.diff(dueDate, 'day') : 0
        const participantWaiting = [row.status, row.participantCompletionStatus].some(value =>
            includesAny(value, ['participant', 'beneficiary', 'sme', 'smme', 'acceptance', 'confirmation', 'response']),
        )
        const consultantWaiting = [row.status, row.assigneeCompletionStatus].some(value =>
            includesAny(value, ['assignee', 'consultant', 'coordinator', 'provider', 'delivery']),
        )

        if (isOverdue) {
            rows.push({
                key: `overdue-${row.id}`,
                category: 'Interventions: overdue',
                entityType: 'Intervention',
                entityName: getInterventionTitle(row),
                owner: getInterventionOwner(row),
                issue: `${getInterventionParticipantName(row)} is ${daysLate} day${daysLate === 1 ? '' : 's'} overdue`,
                severity: daysLate >= 14 ? 'critical' : 'high',
                dueDate,
                action: 'Escalate overdue intervention',
            })
        }

        if (participantWaiting && !isCompletedIntervention(row)) {
            rows.push({
                key: `non-responsive-${row.id}`,
                category: 'SME non-responsive',
                entityType: 'SME',
                entityName: getInterventionParticipantName(row),
                owner: 'Operations',
                issue: `Waiting on SME for ${getInterventionTitle(row)}`,
                severity: isOverdue ? 'high' : 'medium',
                dueDate: dueDate.isValid() ? dueDate : null,
                action: 'Contact SME and record outcome',
            })
        }

        if (consultantWaiting && !isCompletedIntervention(row)) {
            rows.push({
                key: `consultant-${row.id}`,
                category: 'Consultant follow-up',
                entityType: 'Consultant',
                entityName: getInterventionOwner(row),
                owner: 'Operations',
                issue: `${getInterventionTitle(row)} needs consultant/coordinator action`,
                severity: isOverdue ? 'high' : 'medium',
                dueDate: dueDate.isValid() ? dueDate : null,
                action: 'Follow up with delivery owner',
            })
        }
    })

    return rows
}

const buildRiskRegisterRows = (
    participants: ParticipantRow[],
    interventions: AssignedInterventionRow[],
) => [
    ...getComplianceRiskRegisterRows(participants),
    ...getInterventionRiskRegisterRows(participants, interventions),
].sort((a, b) => {
    const severityDiff = riskRank[a.severity] - riskRank[b.severity]
    if (severityDiff !== 0) return severityDiff

    const aDue = a.dueDate?.valueOf() || Number.MAX_SAFE_INTEGER
    const bDue = b.dueDate?.valueOf() || Number.MAX_SAFE_INTEGER
    return aDue - bDue
})

const buildRiskCategoryRows = (registerRows: RiskRegisterRow[]): RiskCategoryRow[] => {
    const metadata: Record<string, Pick<RiskCategoryRow, 'label' | 'description' | 'action'>> = {
        'Compliance readiness': {
            label: tr('Compliance'),
            description: tr('SMEs blocked or slowed by required document readiness'),
            action: 'Clear document blockers',
        },
        'Interventions: non-serviced': {
            label: tr('Non-serviced SMEs'),
            description: tr('Active SMEs without an assigned intervention record'),
            action: 'Assign support',
        },
        'Interventions: overdue': {
            label: tr('Overdue interventions'),
            description: tr('Interventions past due and not completed'),
            action: 'Escalate delivery',
        },
        'SME non-responsive': {
            label: tr('SME non-responsive'),
            description: tr('Workflow steps waiting on SME response or confirmation'),
            action: 'Contact SME',
        },
        'Consultant follow-up': {
            label: tr('Consultant follow-up'),
            description: tr('Delivery owner, consultant, or coordinator action required'),
            action: 'Follow up owner',
        },
    }

    return Object.entries(metadata).map(([category, details]) => {
        const rows = registerRows.filter(row => row.category === category)
        return {
            key: category,
            ...details,
            count: rows.length,
            critical: rows.filter(row => row.severity === 'critical').length,
            high: rows.filter(row => row.severity === 'high').length,
            medium: rows.filter(row => row.severity === 'medium').length,
            low: rows.filter(row => row.severity === 'low').length,
        }
    }).sort((a, b) => b.critical - a.critical || b.high - a.high || b.count - a.count)
}

const toMetricNumber = (...values: unknown[]) => {
    for (const value of values) {
        if (value === null || value === undefined || value === '') continue
        const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
        if (Number.isFinite(parsed)) return parsed
    }

    return 0
}

const getSmeEmployees = (row: ParticipantRow) =>
    toMetricNumber(
        row.employeeCount,
        row.employees,
        row.numberOfEmployees,
        row.staffCount,
        row.jobsCreated,
    )

const getSmeRevenue = (row: ParticipantRow) =>
    toMetricNumber(
        row.revenue,
        row.annualRevenue,
        row.turnover,
        row.annualTurnover,
        row.monthlyRevenue,
    )

const buildSmeImpactBuckets = (rows: ParticipantRow[], range: [Dayjs, Dayjs] | null) => {
    const buckets = buildInterventionBuckets(clampRangeToToday(range))

    return buckets.map(bucket => {
        const activeRows = rows.filter(row => {
            const anchor = getParticipantAnchorDate(row)
            return !anchor || anchor.isSameOrBefore(bucket.end, 'day')
        })

        return {
            key: bucket.key,
            label: bucket.label,
            employees: activeRows.reduce((sum, row) => sum + getSmeEmployees(row), 0),
            revenue: activeRows.reduce((sum, row) => sum + getSmeRevenue(row), 0),
        }
    })
}

const formatCompactCurrency = (value: number) =>
    new Intl.NumberFormat('en-ZA', {
        style: 'currency',
        currency: 'ZAR',
        maximumFractionDigits: 0,
        notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard',
    }).format(value)

const buildInterventionBuckets = (range: [Dayjs, Dayjs] | null): InterventionBucket[] => {
    if (!range) return []

    const [start, end] = range
    const days = end.diff(start, 'day') + 1
    const buckets: InterventionBucket[] = []

    if (days <= 14) {
        let cursor = start.startOf('day')

        while (cursor.isSameOrBefore(end, 'day')) {
            buckets.push({
                key: cursor.format('YYYY-MM-DD'),
                label: cursor.format('DD MMM'),
                start: cursor.startOf('day'),
                end: cursor.endOf('day'),
            })

            cursor = cursor.add(1, 'day')
        }

        return buckets
    }

    if (days <= 90) {
        let cursor = start.startOf('isoWeek')

        while (cursor.isSameOrBefore(end, 'day')) {
            const bucketStart = cursor.startOf('isoWeek')
            const bucketEnd = cursor.endOf('isoWeek')

            buckets.push({
                key: bucketStart.format('YYYY-[W]WW'),
                label: bucketStart.format('DD MMM'),
                start: bucketStart,
                end: bucketEnd,
            })

            cursor = cursor.add(1, 'week')
        }

        return buckets
    }

    let cursor = start.startOf('month')

    while (cursor.isSameOrBefore(end, 'day')) {
        buckets.push({
            key: cursor.format('YYYY-MM'),
            label: cursor.format('MMM YYYY'),
            start: cursor.startOf('month'),
            end: cursor.endOf('month'),
        })

        cursor = cursor.add(1, 'month')
    }

    return buckets
}

const isCarriedOverIntoBucket = (
    row: AssignedInterventionRow,
    bucket: InterventionBucket,
) => {
    const today = dayjs().endOf('day')
    const effectiveBucketEnd = bucket.end.isAfter(today, 'day') ? today : bucket.end

    const assignedDate = getInterventionAssignedDate(row)
    const completedDate = getInterventionCompletedDate(row)
    const dueDate = toDayjs(row.dueDate)

    if (!assignedDate.isValid()) return false
    if (!dueDate.isValid()) return false

    const wasAssignedBeforeBucketEnds = assignedDate.isSameOrBefore(effectiveBucketEnd, 'day')

    const notCompletedByBucketEnd =
        !isCompletedIntervention(row) ||
        !completedDate.isValid() ||
        completedDate.isAfter(effectiveBucketEnd, 'day')

    const dueBeforeOrInsideBucket = dueDate.isSameOrBefore(effectiveBucketEnd, 'day')

    return wasAssignedBeforeBucketEnds && notCompletedByBucketEnd && dueBeforeOrInsideBucket
}

export default function OperationsDashboard() {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const { token } = theme.useToken()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { user, loading: identityLoading } = useFullIdentity()
    const { width } = useWindowSize()

    const isMobile = width < 768
    const departmentId = user?.departmentId || null
    const hasLoadedOnce = useRef(false)

    const [initialLoading, setInitialLoading] = useState(true)
    const [cardLoading, setCardLoading] = useState(false)
    const [filterPreset] = useState<FilterPreset>('month')
    const [dateRange] = useState<[Dayjs, Dayjs] | null>(
        getRangeFromPreset('month'),
    )
    const [rows, setRows] = useState<ParticipantRow[]>([])
    const [interventions, setInterventions] = useState<AssignedInterventionRow[]>([])

    const fetchDashboardData = useCallback(async () => {
        if (identityLoading) return

        if (hasLoadedOnce.current) {
            setCardLoading(true)
        } else {
            setInitialLoading(true)
        }

        try {
            const complianceResult = await listComplianceRows({
                activeProgramId,
                departmentId,
                user,
            })

            const constraints: QueryConstraint[] = []

            if (!isAllPrograms && activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const interventionSnap = await getDocs(
                query(collection(db, 'assignedInterventions'), ...constraints),
            )

            setRows(complianceResult.rows as ParticipantRow[])
            setInterventions(
                interventionSnap.docs
                    .map(doc => ({
                        id: doc.id,
                        ...doc.data(),
                    }) as AssignedInterventionRow)
                    .filter(row => matchesActiveProgram(user, activeProgramId, row.programId)),
            )

            hasLoadedOnce.current = true
        } catch (error) {
            console.error('[OPERATIONS DASHBOARD] Failed loading dashboard data:', error)
            message.error(t('Failed to load operations dashboard data.'))
            setRows([])
            setInterventions([])
            hasLoadedOnce.current = true
        } finally {
            setInitialLoading(false)
            setCardLoading(false)
        }
    }, [activeProgramId, departmentId, identityLoading, isAllPrograms, user, t])

    useEffect(() => {
        const timeout = window.setTimeout(() => void fetchDashboardData(), 0)
        return () => window.clearTimeout(timeout)
    }, [fetchDashboardData])

    const previousRange = useMemo(() => getPreviousRange(dateRange), [dateRange])

    const interventionDueItems = useMemo<InterventionDueItem[]>(() => {
        return interventions
            .map((row) => ({ row, dueDate: toDayjs(row.dueDate) }))
            .filter(({ row, dueDate }) => dueDate.isValid() && !isCompletedIntervention(row))
            .map(({ row, dueDate }) => ({
                id: row.id,
                title: getInterventionTitle(row),
                participantName: getInterventionParticipantName(row),
                owner: getInterventionOwner(row),
                dueDate,
            }))
    }, [interventions])

    const computed = useMemo(() => {
        const currentEnd = dateRange?.[1] || null
        const previousEnd = previousRange?.[1] || null

        const isRowActiveBy = (row: ParticipantRow, endDate: Dayjs | null) => {
            if (!endDate) return true

            const anchor = getParticipantAnchorDate(row)

            if (!anchor) return true

            return anchor.isSameOrBefore(endDate, 'day')
        }

        const currentRows = rows.filter(row => isRowActiveBy(row, currentEnd))
        const previousRows = rows.filter(row => isRowActiveBy(row, previousEnd))

        const currentCoverage = currentRows.map(row => ({ row, coverage: getCoverage(row) }))
        const previousCoverage = previousRows.map(row => ({ row, coverage: getCoverage(row) }))

        const currentFullyOnboarded = currentCoverage.filter(
            item =>
                item.coverage.total > 0 &&
                item.coverage.percent === 100 &&
                item.coverage.pending === 0 &&
                item.coverage.problem === 0,
        ).length

        const previousFullyOnboarded = previousCoverage.filter(
            item =>
                item.coverage.total > 0 &&
                item.coverage.percent === 100 &&
                item.coverage.pending === 0 &&
                item.coverage.problem === 0,
        ).length

        const currentNeedsAction = currentCoverage.filter(item => item.coverage.problem > 0).length
        const previousNeedsAction = previousCoverage.filter(item => item.coverage.problem > 0).length

        const getInterventionsActiveBy = (endDate: Dayjs | null) =>
            interventions.filter(row => {
                if (!endDate) return true

                const assignedDate = getInterventionAssignedDate(row)
                const dueDate = toDayjs(row.dueDate)

                return (
                    (assignedDate.isValid() && assignedDate.isSameOrBefore(endDate, 'day')) ||
                    (dueDate.isValid() && dueDate.isSameOrBefore(endDate, 'day'))
                )
            })

        const currentRiskRegisterRows = buildRiskRegisterRows(
            currentRows,
            getInterventionsActiveBy(currentEnd),
        )
        const previousRiskRegisterRows = buildRiskRegisterRows(
            previousRows,
            getInterventionsActiveBy(previousEnd),
        )
        const currentRiskCategories = buildRiskCategoryRows(currentRiskRegisterRows)
        const previousRiskCategories = buildRiskCategoryRows(previousRiskRegisterRows)
        const currentEmployees = currentRows.reduce((sum, row) => sum + getSmeEmployees(row), 0)
        const previousEmployees = previousRows.reduce((sum, row) => sum + getSmeEmployees(row), 0)
        const currentRevenue = currentRows.reduce((sum, row) => sum + getSmeRevenue(row), 0)
        const previousRevenue = previousRows.reduce((sum, row) => sum + getSmeRevenue(row), 0)
        const impactBuckets = buildSmeImpactBuckets(rows, dateRange)

        const interventionRange = clampRangeToToday(dateRange)
        const interventionPreviousRange = getPreviousRange(interventionRange)
        const buckets = buildInterventionBuckets(interventionRange)

        const assignedCounts = Object.fromEntries(buckets.map(bucket => [bucket.key, 0]))
        const completedCounts = Object.fromEntries(buckets.map(bucket => [bucket.key, 0]))
        const carriedOverCounts = Object.fromEntries(buckets.map(bucket => [bucket.key, 0]))

        buckets.forEach(bucket => {
            interventions.forEach(row => {
                const assignedDate = getInterventionAssignedDate(row)
                const completedDate = getInterventionCompletedDate(row)

                if (
                    assignedDate.isValid() &&
                    assignedDate.isBetween(bucket.start, bucket.end, 'day', '[]')
                ) {
                    assignedCounts[bucket.key] = (assignedCounts[bucket.key] || 0) + 1
                }

                if (
                    isCompletedIntervention(row) &&
                    completedDate.isValid() &&
                    completedDate.isBetween(bucket.start, bucket.end, 'day', '[]')
                ) {
                    completedCounts[bucket.key] = (completedCounts[bucket.key] || 0) + 1
                }

                if (isCarriedOverIntoBucket(row, bucket)) {
                    carriedOverCounts[bucket.key] = (carriedOverCounts[bucket.key] || 0) + 1
                }
            })
        })

        const currentAssigned = Object.values(assignedCounts).reduce(
            (sum, value) => sum + Number(value),
            0,
        )

        const currentCompleted = Object.values(completedCounts).reduce(
            (sum, value) => sum + Number(value),
            0,
        )

        const currentCarriedOver = Object.values(carriedOverCounts).reduce(
            (sum, value) => sum + Number(value),
            0,
        )

        const previousAssigned = interventions.filter(row =>
            isInRange(getInterventionAssignedDate(row), interventionPreviousRange),
        ).length

        const previousCompleted = interventions.filter(
            row =>
                isCompletedIntervention(row) &&
                isInRange(getInterventionCompletedDate(row), interventionPreviousRange),
        ).length

        const readinessCounts = {
            clear: currentRows.filter(row => {
                const coverage = getCoverage(row)

                return (
                    coverage.total > 0 &&
                    coverage.percent === 100 &&
                    coverage.pending === 0 &&
                    coverage.problem === 0
                )
            }).length,
            attention: currentRows.filter(row => {
                const coverage = getCoverage(row)

                return coverage.problem === 0 && coverage.pending > 0
            }).length,
            needsAction: currentRows.filter(row => getCoverage(row).problem > 0).length,
        }

        return {
            activeSMEs: currentRows.length,
            previousActiveSMEs: previousRows.length,

            fullyOnboarded: currentFullyOnboarded,
            previousFullyOnboarded,

            needsAction: currentNeedsAction,
            previousNeedsAction,

            pendingActions: currentRiskRegisterRows.length,
            previousPendingActions: previousRiskRegisterRows.length,
            employees: currentEmployees,
            previousEmployees,
            revenue: currentRevenue,
            previousRevenue,
            impactCategories: impactBuckets.map(bucket => bucket.label),
            employeeSeries: impactBuckets.map(bucket => bucket.employees),
            revenueSeries: impactBuckets.map(bucket => bucket.revenue),

            riskRegisterRows: currentRiskRegisterRows.slice(0, 12),
            riskCategoryRows: currentRiskCategories,
            riskCounts: {
                critical: currentRiskRegisterRows.filter(row => row.severity === 'critical').length,
                high: currentRiskRegisterRows.filter(row => row.severity === 'high').length,
                medium: currentRiskRegisterRows.filter(row => row.severity === 'medium').length,
                low: currentRiskRegisterRows.filter(row => row.severity === 'low').length,
            },
            previousRiskCategories,

            readinessCounts,

            interventionCategories: buckets.map(bucket => bucket.label),
            assignedSeries: buckets.map(bucket => assignedCounts[bucket.key] || 0),
            completedSeries: buckets.map(bucket => completedCounts[bucket.key] || 0),
            carriedOverSeries: buckets.map(bucket => carriedOverCounts[bucket.key] || 0),

            currentAssigned,
            currentCompleted,
            currentCarriedOver,

            previousAssigned,
            previousCompleted,
        }
    }, [dateRange, interventions, previousRange, rows])

    const smeDelta = getDelta(computed.activeSMEs, computed.previousActiveSMEs)
    const onboardedDelta = getDelta(computed.fullyOnboarded, computed.previousFullyOnboarded)
    const needsActionDelta = getDelta(computed.needsAction, computed.previousNeedsAction)
    const employeesDelta = getDelta(computed.employees, computed.previousEmployees)
    const revenueDelta = getDelta(computed.revenue, computed.previousRevenue)

    const smesHealthPercent = computed.activeSMEs > 0
        ? Math.round(((computed.activeSMEs - computed.needsAction) / computed.activeSMEs) * 100)
        : 0
    const complianceHealthPercent = computed.activeSMEs > 0
        ? Math.round((computed.readinessCounts.clear / computed.activeSMEs) * 100)
        : 0

    useRegisterAgentPageContext({
        pageName: 'Delivery Overview',
        pagePurpose:
            'Shows onboarding and compliance readiness using the same compliance coverage rules as the Compliance Tracker, plus assigned versus completed intervention progress.',
        metrics: [
            {
                label: t('Active SMEs'),
                value: computed.activeSMEs,
                hint: `${smeDelta.label} from previous period`,
            },
            {
                label: t('Fully onboarded'),
                value: computed.fullyOnboarded,
                hint: `${onboardedDelta.label} from previous period`,
            },
            {
                label: t('Needs action'),
                value: computed.needsAction,
                hint: `${needsActionDelta.label} from previous period`,
            },
            {
                label: t('Employees'),
                value: computed.employees,
                hint: `${employeesDelta.label} from previous period`,
            },
            {
                label: t('SME revenue'),
                value: formatCompactCurrency(computed.revenue),
                hint: `${revenueDelta.label} from previous period`,
            },
        ],
        tables: [
            {
                name: 'Risk classification',
                rowCount: computed.riskCategoryRows.length,
                columns: ['Risk class', 'Description', 'Open risks', 'Severity split', 'Action'],
                visibleStatuses: {
                    Critical: computed.riskCounts.critical,
                    High: computed.riskCounts.high,
                    Medium: computed.riskCounts.medium,
                    Low: computed.riskCounts.low,
                },
            },
            {
                name: 'SME impact',
                rowCount: computed.impactCategories.length,
                columns: ['Period', 'Employees', 'Revenue'],
                visibleStatuses: {
                    Employees: computed.employees,
                    Revenue: computed.revenue,
                },
            },
        ],
        filters: {
            activeProgramId: isAllPrograms ? 'all' : activeProgramId || null,
            departmentId,
            filterPreset,
            dateRange: dateRange
                ? {
                    from: dateRange[0].format('YYYY-MM-DD'),
                    to: dateRange[1].format('YYYY-MM-DD'),
                }
                : null,
        },
        selectedRecord: null,
        formFields: [],
        notes: [
            'The date range affects all operations dashboard metrics, risk classification, SME impact, and intervention progress.',
            'Active SMEs means SMEs active as of the selected range end date, not only SMEs changed inside the selected range.',
            'Needs Action means at least one SME has a required item missing, expired, invalid, or rejected.',
            'Registered risks classify compliance, non-serviced SMEs, overdue interventions, SME non-response, and consultant follow-up items.',
            'The risk register is available as a dedicated page for at-risk SMEs, consultants, and interventions.',
            'Intervention progress compares assigned versus completed interventions over the selected period, with carry-over showing overdue pressure.',
            'Future dates are excluded from the intervention progress buckets.',
        ],
    })

    const interventionOptions: Highcharts.Options = {
        chart: {
            height: isMobile ? 260 : 300,
            backgroundColor: 'transparent',
        },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: {
            categories: computed.interventionCategories,
            crosshair: true,
        },
        yAxis: {
            min: 0,
            allowDecimals: false,
            title: {
                text: tr('Interventions'),
            },
        },
        legend: {
            shadow: false,
        },
        tooltip: {
            shared: true,
        },
        plotOptions: {
            column: {
                grouping: false,
                shadow: false,
                borderWidth: 0,
                borderRadius: 8,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return this.y && this.y > 0 ? String(this.y) : ''
                    },
                    style: {
                        textOutline: 'none',
                        fontSize: isMobile ? '10px' : '11px',
                    },
                },
            },
            spline: {
                marker: {
                    enabled: true,
                    radius: 4,
                },
                lineWidth: 3,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return this.y && this.y > 0 ? String(this.y) : ''
                    },
                    style: {
                        textOutline: 'none',
                        fontSize: isMobile ? '10px' : '11px',
                    },
                },
            },
        },
        series: [
            {
                type: 'column',
                name: tr('Assigned'),
                color: 'rgba(245, 158, 11, 0.35)',
                data: computed.assignedSeries,
                pointPadding: 0.2,
                pointPlacement: 0,
            },
            {
                type: 'column',
                name: tr('Completed'),
                color: 'rgba(34, 197, 94, 0.9)',
                data: computed.completedSeries,
                pointPadding: 0.38,
                pointPlacement: 0,
            },
            {
                type: 'spline',
                name: tr('Carry-over / Overdue'),
                color: '#ef4444',
                data: computed.carriedOverSeries,
                zIndex: 5,
            },
        ],
    }

    const riskClassificationOptions: Highcharts.Options = {
        chart: { type: 'bar', height: isMobile ? 280 : 320, backgroundColor: 'transparent' },
        title: { text: undefined },
        credits: { enabled: false },
        xAxis: {
            categories: computed.riskCategoryRows.map(row => row.label),
            labels: { style: { fontSize: isMobile ? '10px' : '11px' } },
        },
        yAxis: { min: 0, allowDecimals: false, title: { text: tr('Open risks') } },
        legend: { enabled: true },
        tooltip: { shared: true },
        plotOptions: {
            series: {
                stacking: 'normal',
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return this.y && this.y > 0 ? String(this.y) : ''
                    },
                    style: { textOutline: 'none', fontSize: isMobile ? '10px' : '11px' },
                },
            },
        },
        series: [
            {
                type: 'bar',
                name: tr('Critical'),
                color: '#ef4444',
                data: computed.riskCategoryRows.map(row => row.critical),
            },
            {
                type: 'bar',
                name: tr('High'),
                color: '#f97316',
                data: computed.riskCategoryRows.map(row => row.high),
            },
            {
                type: 'bar',
                name: tr('Medium'),
                color: '#f59e0b',
                data: computed.riskCategoryRows.map(row => row.medium),
            },
            {
                type: 'bar',
                name: tr('Low'),
                color: '#60a5fa',
                data: computed.riskCategoryRows.map(row => row.low),
            },
        ],
    }

    const upcomingWeekCard = (
        <UpcomingWeekCard
            interventionDueItems={interventionDueItems}
            loading={cardLoading}
            onViewSchedule={() => navigate('/operations/interventions/appointments')}
        />
    )

    const activeSmesCard = (
        <DashboardMetricCard
            loading={identityLoading || initialLoading}
            icon={<TeamOutlined />}
            iconClassName="dashboard-icon-blue"
            label={t('Active SMEs')}
            value={computed.activeSMEs}
            hint={`${smeDelta.label} from previous`}
        />
    )

    const smesHealthCard = (
        <DashboardMetricCard
            loading={identityLoading || initialLoading}
            icon={<TeamOutlined />}
            iconClassName="dashboard-icon-green"
            label={t('SMEs Health')}
            value={`${smesHealthPercent}%`}
            hint={`${computed.needsAction} SMEs need action`}
        />
    )

    const revenueEmployeesCard = (
        <DashboardMetricCard
            loading={identityLoading || initialLoading}
            icon={<TeamOutlined />}
            iconClassName="dashboard-icon-orange"
            label={t('Revenue & Employees')}
            value={`${formatCompactCurrency(computed.revenue)} / ${computed.employees}`}
            hint={`${revenueDelta.label} revenue · ${employeesDelta.label} employees`}
        />
    )

    const complianceHealthCard = (
        <DashboardMetricCard
            loading={identityLoading || initialLoading}
            icon={<SafetyCertificateOutlined />}
            iconClassName="dashboard-icon-red"
            label={t('Compliance Health')}
            value={`${complianceHealthPercent}%`}
            hint={`${computed.readinessCounts.clear} of ${computed.activeSMEs} SMEs fully compliant`}
            clickable
            onClick={() => navigate('/operations/participants/compliance')}
        />
    )

    const interventionCard = (
        <Card
            className="dashboard-section-card"
            bordered={false}
            loading={cardLoading}
            title={
                <Space>
                    <FileDoneOutlined />
                    <span>{t('Intervention Progress')}</span>
                </Space>
            }
            extra={
                <Text type="secondary">
                    {computed.currentAssigned} {t('assigned /')} {computed.currentCompleted} {t('completed /')}{' '}
                    {computed.currentCarriedOver} {t('carried over')}
                </Text>
            }
        >
            {computed.interventionCategories.length === 0 ||
                computed.currentAssigned + computed.currentCompleted + computed.currentCarriedOver === 0 ? (
                <Empty description={t('No intervention activity found for this selected period.')} />
            ) : (
                <ThemedHighcharts options={interventionOptions} />
            )}
        </Card>
    )

    const riskClassificationCard = (
        <Card
            className="dashboard-section-card"
            bordered={false}
            loading={cardLoading}
            title={
                <Space>
                    <ExclamationCircleOutlined />
                    <span>{t('Risk Classification')}</span>
                </Space>
            }
            extra={
                <Button
                    shape="round"
                    type="primary"
                    onClick={() => navigate(RISK_REGISTER_ROUTE)}
                    icon={<ExpandAltOutlined />}
                >
                    {t('Open Register')}
                </Button>
            }
        >
            {computed.riskRegisterRows.length === 0 ? (
                <Empty description={t('No operational risks found for this program.')} />
            ) : (
                <ThemedHighcharts options={riskClassificationOptions} />
            )}
        </Card>
    )

    const smeImpactCard = (
        <Card
            className="dashboard-section-card"
            style={{ height: 'auto' }}
            bordered={false}
            loading={cardLoading}
            title={
                <Space>
                    <TeamOutlined />
                    <span>{t('SME Impact')}</span>
                </Space>
            }
        >
            <Space size={32} wrap style={{ width: '100%', justifyContent: 'space-evenly' }}>
                <div style={{ textAlign: 'center' }}>
                    <Progress
                        type="circle"
                        size={110}
                        percent={Math.min(100, Math.abs(revenueDelta.percent))}
                        strokeColor={revenueDelta.positive ? token.colorSuccess : token.colorError}
                        format={() => revenueDelta.label}
                    />
                    <div style={{ marginTop: 10 }}>
                        <Text strong>{t('Impact on revenue')}</Text>
                        <br />
                        <Text type="secondary">
                            {formatCompactCurrency(computed.revenue)} {t('vs')} {formatCompactCurrency(computed.previousRevenue)} {t('previous')}
                        </Text>
                    </div>
                </div>

                <div style={{ textAlign: 'center' }}>
                    <Progress
                        type="circle"
                        size={110}
                        percent={Math.min(100, Math.abs(employeesDelta.percent))}
                        strokeColor={employeesDelta.positive ? token.colorSuccess : token.colorError}
                        format={() => employeesDelta.label}
                    />
                    <div style={{ marginTop: 10 }}>
                        <Text strong>{t('Impact on employees')}</Text>
                        <br />
                        <Text type="secondary">
                            {computed.employees} {t('vs')} {computed.previousEmployees} {t('previous')}
                        </Text>
                    </div>
                </div>
            </Space>
        </Card>
    )
    return (
        <DashboardPage className="dashboard-home-page operations-dashboard-page">
            {cardLoading ? (
                <Card loading={identityLoading || initialLoading} className="dashboard-section-card" bordered={false}>
                    <div style={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                        <Spin description={t('Refreshing operations dashboard...')} />
                    </div>
                </Card>
            ) : (
                <>
                    <Row gutter={[12, 12]} className="dashboard-metrics-row" style={{ marginBottom: 16 }}>
                        <Col xs={12} lg={6}>
                            {activeSmesCard}
                        </Col>

                        <Col xs={12} lg={6}>
                            {smesHealthCard}
                        </Col>

                        <Col xs={12} lg={6}>
                            {revenueEmployeesCard}
                        </Col>

                        <Col xs={12} lg={6}>
                            {complianceHealthCard}
                        </Col>
                    </Row>

                    {isMobile ? (
                        <List
                            split={false}
                            dataSource={[interventionCard, upcomingWeekCard, riskClassificationCard, smeImpactCard]}
                            renderItem={(item, index) => (
                                <List.Item style={{ padding: index === 3 ? 0 : '0 0 16px' }}>
                                    {item}
                                </List.Item>
                            )}
                        />
                    ) : (
                        <>
                            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                                <Col xs={24} lg={12}>
                                    {interventionCard}
                                </Col>

                                <Col xs={24} lg={12}>
                                    {upcomingWeekCard}
                                </Col>
                            </Row>

                            <Row gutter={[16, 16]}>
                                <Col xs={24} lg={12}>
                                    {riskClassificationCard}
                                </Col>

                                <Col xs={24} lg={12}>
                                    {smeImpactCard}
                                </Col>
                            </Row>
                        </>
                    )}
                </>
            )}
        </DashboardPage>
    )
}
