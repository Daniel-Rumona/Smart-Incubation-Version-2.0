import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Modal,
  Pagination,
  Progress,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  theme,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArrowLeftOutlined,
  AuditOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  DollarCircleOutlined,
  ExclamationCircleOutlined,
  FallOutlined,
  FileProtectOutlined,
  FundOutlined,
  RiseOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { collection, getDocs, query, where } from 'firebase/firestore'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS, CHART_PALETTE } from '@/config/chartPalette'
import { db } from '@/firebase/config'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { ReportExportButton } from '@/components/shared/ReportExportButton'
import type { ReportExportData } from '@/services/reportExport'
import {
  bucketRange as performanceBucketRange,
  computeMetricPerformance,
  employeesInRange,
  formatCurrencyZAR,
  formatMetricNumber,
  getPreviousRange,
  revenueInRange,
  type PerformanceSourceRow,
} from '@/services/smePerformanceMetrics'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import '@/styles/dashboard.css'
import '@/styles/operations-reports.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

dayjs.extend(isoWeek)
dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)
dayjs.extend(quarterOfYear)

const { RangePicker } = DatePicker
const { Text, Title } = Typography

type BucketGranularity = 'day' | 'week' | 'month'
type ReportView = 'overview' | 'applications' | 'interventions' | 'appointments' | 'workload' | 'participants' | 'performance'

type FirestoreDate =
  | Date
  | string
  | number
  | {
      toDate?: () => Date
      seconds?: number
      nanoseconds?: number
    }
  | null
  | undefined

type ApplicationDoc = {
  id: string
  participantId?: string | null
  programId?: string | null
  programName?: string | null
  beneficiaryName?: string | null
  businessName?: string | null
  companyName?: string | null
  companyCode?: string | null
  applicationStatus?: string | null
  status?: string | null
  stage?: string | null
  createdAt?: FirestoreDate
  submittedAt?: FirestoreDate
  updatedAt?: FirestoreDate
  acceptedAt?: FirestoreDate
  approvedAt?: FirestoreDate
  interventions?: {
    required?: Array<{ id?: string | null; title?: string | null; area?: string | null; areaOfSupport?: string | null }>
    completed?: Array<{ id?: string | null; title?: string | null }>
  }
  complianceDocuments?: Array<{
    docType?: string | null
    status?: string | null
    updatedAt?: FirestoreDate
    expiryDate?: FirestoreDate
  }>
}

type ParticipantDoc = {
  id: string
  participantId?: string | null
  programId?: string | null
  programName?: string | null
  beneficiaryName?: string | null
  businessName?: string | null
  companyName?: string | null
  sector?: string | null
  stage?: string | null
  province?: string | null
  hub?: string | null
  gender?: string | null
  beeLevel?: string | null
  femaleOwnedPercent?: number | string | null
  youthOwnedPercent?: number | string | null
  blackOwnedPercent?: number | string | null
  createdAt?: FirestoreDate
  acceptedAt?: FirestoreDate
  approvedAt?: FirestoreDate
  onboardedAt?: FirestoreDate
  revenue?: unknown
  annualRevenue?: unknown
  monthlyRevenue?: unknown
  turnover?: unknown
  annualTurnover?: unknown
  employeeCount?: unknown
  employees?: unknown
  numberOfEmployees?: unknown
  staffCount?: unknown
  jobsCreated?: unknown
  revenueHistory?: { monthly?: Record<string, unknown>; annual?: Record<string, unknown> }
  headcountHistory?: { monthly?: Record<string, unknown>; annual?: Record<string, unknown> }
}

type AssignmentDoc = {
  id: string
  participantId?: string | null
  smmeId?: string | null
  smeId?: string | null
  programId?: string | null
  programName?: string | null
  beneficiaryName?: string | null
  businessName?: string | null
  participantName?: string | null
  interventionId?: string | null
  interventionTitle?: string | null
  title?: string | null
  areaOfSupport?: string | null
  area?: string | null
  consultantId?: string | null
  assigneeName?: string | null
  deliveryActorType?: 'human' | 'agent' | string | null
  agentName?: string | null
  agentId?: string | null
  assignedAgentId?: string | null
  agentWorkStatus?: string | null
  deliveryStrategy?: string | null
  assigneeStatus?: string | null
  assigneeCompletionStatus?: string | null
  participantStatus?: string | null
  participantCompletionStatus?: string | null
  status?: string | null
  completionStatus?: string | null
  progress?: number | string | null
  assignedAt?: FirestoreDate
  createdAt?: FirestoreDate
  updatedAt?: FirestoreDate
  dueDate?: FirestoreDate
  completedAt?: FirestoreDate
  completionConfirmedAt?: FirestoreDate
}

type AppointmentDoc = {
  id: string
  companyCode?: string | null
  assignedInterventionId?: string | null
  interventionTitle?: string | null
  participantId?: string | null
  participantName?: string | null
  participantEmail?: string | null
  programId?: string | null
  programName?: string | null
  assigneeId?: string | null
  assigneeEmail?: string | null
  meetingType?: string | null
  startTime?: FirestoreDate
  endTime?: FirestoreDate
  status?: string | null
  attendance?: Record<string, 'present' | 'absent' | string>
  discussionSummary?: string | null
}

type SupportDemandRow = {
  key: string
  title: string
  area: string
  requested: number
  assigned: number
  completed: number
  gap: number
  completionRate: number
}

type AreaDemandRow = {
  key: string
  area: string
  requested: number
  assigned: number
  completed: number
  gap: number
  completionRate: number
}

type AttentionRow = {
  key: string
  intervention: string
  participant: string
  owner: string
  issue: string
  dueDate: string
  severity: 'high' | 'medium'
}

type AttendanceRow = {
  key: string
  appointment: string
  participant: string
  program: string
  date: string
  meetingType: string
  status: string
  attendance: 'Present' | 'Absent' | 'Not captured'
}

type WorkloadInterventionRow = {
  key: string
  title: string
  assigned: number
  inProgress: number
  completed: number
  overdue: number
  facilitatorHeld: number
  smeHeld: number
  riskScore: number
}

type FacilitatorHealthRow = {
  key: string
  name: string
  actorType: 'Facilitator' | 'Agent'
  assigned: number
  inProgress: number
  completed: number
  facilitatorHeld: number
  smeHeld: number
  riskScore: number
  health: 'On track' | 'Watch' | 'At risk'
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const toDate = (value: FirestoreDate): Date | null => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(+value) ? null : value
  if (typeof value === 'object' && typeof value.toDate === 'function') return value.toDate()
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6))
  }
  if (typeof value === 'number') return new Date(value > 1e12 ? value : value * 1000)
  const parsed = new Date(String(value))
  return Number.isNaN(+parsed) ? null : parsed
}

const primaryApplicationDate = (application: ApplicationDoc) =>
  toDate(application.submittedAt) || toDate(application.createdAt) || toDate(application.updatedAt)

const assignmentDate = (assignment: AssignmentDoc) =>
  toDate(assignment.assignedAt) || toDate(assignment.createdAt) || toDate(assignment.updatedAt) || toDate(assignment.dueDate)

const bucketGranularityForRange = (rangeStart: Dayjs, rangeEnd: Dayjs): BucketGranularity => {
  const days = rangeEnd.diff(rangeStart, 'day')
  if (days <= 45) return 'day'
  if (days <= 200) return 'week'
  return 'month'
}

const inRange = (date: Date | null, start: Dayjs, end: Dayjs) => {
  if (!date) return false
  const value = dayjs(date)
  return value.isSameOrAfter(start, 'day') && value.isSameOrBefore(end, 'day')
}

const percent = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : 0

const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const isAccepted = (application: ApplicationDoc) => {
  const status = normalize(application.applicationStatus || application.status)
  return ['accepted', 'approved', 'onboarded', 'enrolled'].includes(status)
}

const isCompletedAssignment = (assignment: AssignmentDoc) => {
  const status = normalize(assignment.status)
  const completion = normalize(assignment.completionStatus)
  const participantCompletion = normalize(assignment.participantCompletionStatus)
  return status === 'completed' || status === 'done' || completion === 'confirmed' || participantCompletion === 'confirmed'
}

const isInProgressAssignment = (assignment: AssignmentDoc) => {
  const status = normalize(assignment.status)
  return ['in-progress', 'in progress', 'active', 'started'].includes(status) || numberValue(assignment.progress) > 0
}

type AssignmentHoldUp = 'facilitator' | 'sme' | 'delivery' | 'complete'

const assignmentHoldUp = (assignment: AssignmentDoc): AssignmentHoldUp => {
  if (isCompletedAssignment(assignment)) return 'complete'
  const assigneeStatus = normalize(assignment.assigneeStatus)
  const participantStatus = normalize(assignment.participantStatus)
  const assigneeCompletion = normalize(assignment.assigneeCompletionStatus)
  const participantCompletion = normalize(assignment.participantCompletionStatus)
  const progress = numberValue(assignment.progress)

  if (assigneeStatus === 'pending' || assigneeStatus === 'declined') return 'facilitator'
  if (participantStatus === 'pending' || participantStatus === 'declined') return 'sme'
  if ((progress >= 100 || assigneeCompletion === 'done') && participantCompletion !== 'confirmed') return 'sme'
  return 'delivery'
}

const isDeliveryOwnerRisk = (assignment: AssignmentDoc) => {
  if (assignmentHoldUp(assignment) === 'sme' || isCompletedAssignment(assignment)) return false
  if (isAgentAssignment(assignment)) {
    return ['failed', 'error', 'blocked'].includes(normalize(assignment.agentWorkStatus))
  }
  const dueDate = toDate(assignment.dueDate)
  return !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day')
}

// Older agent assignments were not all backfilled with deliveryActorType. Treat the
// assignment's configured strategy and agent identity as authoritative fallbacks.
const isAgentAssignment = (assignment: AssignmentDoc) => {
  const strategy = normalize(assignment.deliveryStrategy)
  return normalize(assignment.deliveryActorType) === 'agent'
    || strategy.includes('agent')
    || Boolean(String(assignment.agentId || assignment.assignedAgentId || assignment.agentName || assignment.agentWorkStatus || '').trim())
}

const deliveryOwnerFor = (assignment: AssignmentDoc) => {
  if (isAgentAssignment(assignment)) {
    return {
      name: String(assignment.agentName || assignment.agentId || assignment.assignedAgentId || 'Unassigned agent'),
      actorType: 'Agent' as const,
    }
  }
  return { name: String(assignment.assigneeName || 'Unassigned facilitator'), actorType: 'Facilitator' as const }
}

const bucketLabel = (date: Date, granularity: BucketGranularity) => {
  const value = dayjs(date)
  if (granularity === 'week') return `W${value.isoWeek()} ${value.year()}`
  if (granularity === 'month') return value.format('MMM YYYY')
  return value.format('DD MMM')
}

const topEntries = (map: Map<string, number>, limit = 8) =>
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)

const areaAvatarColor = (area: string) => {
  let hash = 0
  for (let index = 0; index < area.length; index += 1) hash = (hash * 31 + area.charCodeAt(index)) >>> 0
  return CHART_PALETTE[hash % CHART_PALETTE.length]
}

const AREA_PAGE_SIZE = 9

const complianceStatusLabel = (status: string) => {
  const value = normalize(status)
  if (['valid', 'verified', 'completed', 'accepted', 'approved'].includes(value)) return 'Valid'
  if (['invalid', 'expired', 'rejected', 'cancelled', 'declined', 'not-valid', 'not valid', 'missing'].includes(value)) return 'Not Valid'
  if (['missing', 'pending', 'queried', 'expiring', 'uploaded'].includes(value)) return 'Pending Review'
  return status
    ? String(status).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Pending Review'
}

const complianceStatusColor = (status: string) => {
  const label = complianceStatusLabel(status)
  if (label === 'Valid') return 'success'
  if (label === 'Not Valid') return 'error'
  if (label === 'Pending Review') return 'warning'
  return 'default'
}

const appointmentStatusLabel = (status: string) => {
  const value = normalize(status)
  if (value === 'pending') return 'Scheduled'
  if (value === 'accepted') return 'Accepted'
  if (value === 'completed') return 'Completed'
  if (value === 'declined') return 'Declined'
  if (value === 'cancelled') return 'Cancelled'
  return String(status || 'Scheduled').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const AreaCard = ({ row, onClick }: { row: AreaDemandRow, onClick: () => void }) => {
  const { t } = useLanguage()
  const { token } = theme.useToken()
  const coverage = percent(row.assigned, row.requested)
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
        padding: '12px 14px',
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: token.boxShadowTertiary,
        cursor: 'pointer',
      }}
    >
      <Space align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size={8} align="center">
          <span style={{ width: 26, height: 26, borderRadius: '50%', background: areaAvatarColor(row.area), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
            {row.area.charAt(0).toUpperCase()}
          </span>
          <Typography.Text strong ellipsis style={{ maxWidth: 130 }}>{row.area}</Typography.Text>
        </Space>
        <Typography.Text strong style={{ color: coverage >= 75 ? token.colorSuccess : coverage >= 40 ? token.colorWarning : token.colorError }}>{coverage}%</Typography.Text>
      </Space>
      <Progress percent={coverage} size="small" showInfo={false} />
      <Space size={10} style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.requested} {t('requested ·')} {row.assigned} {t('assigned')}</Typography.Text>
        {row.gap > 0 && <Tag color="orange" style={{ marginInlineEnd: 0 }}>{t('Gap')} {row.gap}</Tag>}
      </Space>
    </button>
  )
}

const InterventionCoverageCard = ({ row }: { row: SupportDemandRow }) => {
  const { t } = useLanguage()
  const { token } = theme.useToken()
  return (
    <div
      style={{
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 12,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
      }}
    >
      <Typography.Text strong ellipsis>{row.title}</Typography.Text>
      <Progress percent={percent(row.assigned, row.requested)} size="small" status={row.gap > 0 ? 'active' : 'success'} />
      <Space size={10} wrap style={{ width: '100%', justifyContent: 'space-between' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.requested} {t('requested ·')} {row.assigned} {t('assigned ·')} {row.completed} {t('completed')}</Typography.Text>
        <Tag color={row.gap > 0 ? 'orange' : 'green'} style={{ marginInlineEnd: 0 }}>{row.gap > 0 ? `Gap ${row.gap}` : t('Covered')}</Tag>
      </Space>
    </div>
  )
}

const workloadRiskColor = (score: number) => score >= 60 ? 'red' : score >= 30 ? 'orange' : 'green'

const DeliveryOwnerWorkloadCard = ({ row, onClick }: { row: FacilitatorHealthRow, onClick: () => void }) => (
  <button type="button" className="operations-workload-card" onClick={onClick}>
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space size={6}><Tag color={row.actorType === 'Agent' ? 'purple' : 'blue'}>{row.actorType}</Tag><Text strong ellipsis style={{ maxWidth: 160 }}>{row.name}</Text></Space>
        <Tag color={workloadRiskColor(row.riskScore)} style={{ marginInlineEnd: 0 }}>{tr('Risk')} {row.riskScore}</Tag>
      </Space>
      <Progress percent={percent(row.completed, row.assigned)} size="small" showInfo={false} status={row.riskScore >= 60 ? 'exception' : 'active'} />
      <div className="operations-workload-counts">
        <span><strong>{row.assigned}</strong> {tr('assigned')}</span><span><strong>{row.inProgress}</strong> {tr('in progress')}</span><span><strong>{row.completed}</strong> {tr('complete')}</span>
      </div>
      <Space wrap size={[4, 4]}>
        {row.facilitatorHeld > 0 && <Tag color="red">{row.facilitatorHeld} {row.actorType.toLowerCase()}{tr('-held')}</Tag>}
        {row.smeHeld > 0 && <Tag color="gold">{row.smeHeld} {tr('awaiting SME')}</Tag>}
        {!row.facilitatorHeld && !row.smeHeld && <Tag color="green">{tr('No hold-ups')}</Tag>}
      </Space>
    </Space>
  </button>
)

const PerformanceStatCard = ({ title, icon, formattedValue, deltaLabel, deltaPositive, headline, caption, loading }: {
  title: string
  icon: ReactNode
  formattedValue: string
  deltaLabel: string
  deltaPositive: boolean
  headline: { label: string; value: number; positive: boolean }
  caption: string
  loading?: boolean
}) => {
  const { t } = useLanguage()
  const { token } = theme.useToken()
  const deltaColor = deltaPositive ? token.colorSuccess : token.colorError
  const DeltaIcon = deltaPositive ? RiseOutlined : FallOutlined
  const headlineColor = headline.positive ? token.colorSuccess : token.colorError
  return (
    <Card loading={loading} className="dashboard-section-card motion-card" title={<Space>{icon} {title}</Space>}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <Text strong style={{ fontSize: 28, lineHeight: 1 }}>{formattedValue}</Text>
        <Space size={4} style={{ color: deltaColor }}>
          <DeltaIcon />
          <Text strong style={{ color: deltaColor }}>{deltaLabel}</Text>
        </Space>
      </div>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>{t('vs previous period ·')} {caption}</Text>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <Text type="secondary" style={{ fontSize: 12 }}>{headline.label}</Text>
        <Text strong style={{ color: headlineColor }}>{headline.value}%</Text>
      </div>
    </Card>
  )
}

const FacilitatorHealthCard = ({ row, onClick }: { row: FacilitatorHealthRow, onClick: () => void }) => (
  <button type="button" className={`operations-facilitator-card is-${row.health.toLowerCase().replace(' ', '-')}`} onClick={onClick}>
    <Space direction="vertical" size={7} style={{ width: '100%' }}>
      <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}><Space size={6}><Tag color={row.actorType === 'Agent' ? 'purple' : 'blue'}>{row.actorType}</Tag><Text strong ellipsis style={{ maxWidth: 135 }}>{row.name}</Text></Space><Space size={4}><Tag color={row.health === 'On track' ? 'green' : row.health === 'Watch' ? 'orange' : 'red'}>{tr('Health:')} {row.health}</Tag><Tag color={workloadRiskColor(row.riskScore)} style={{ marginInlineEnd: 0 }}>{tr('Risk')} {row.riskScore}</Tag></Space></Space>
      <Progress percent={percent(row.completed, row.assigned)} size="small" showInfo={false} status={row.health === 'At risk' ? 'exception' : row.health === 'Watch' ? 'active' : 'success'} />
      <Text type="secondary">{row.assigned} {tr('assigned ·')} {row.inProgress} {tr('active ·')} {row.completed} {tr('complete')}</Text>
      <Space wrap size={[4, 4]}>{row.facilitatorHeld > 0 && <Tag color="red">{row.facilitatorHeld} {tr('held by')} {row.actorType.toLowerCase()}</Tag>}{row.smeHeld > 0 && <Tag color="gold">{row.smeHeld} {tr('awaiting SME')}</Tag>}{!row.facilitatorHeld && <Tag color="green">{tr('No')} {row.actorType.toLowerCase()} {tr('block')}</Tag>}</Space>
    </Space>
  </button>
)

export const OperationsReportsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const { token } = theme.useToken()
  const [view, setView] = useState<ReportView>('overview')
  const [[start, end], setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')])
  const [applications, setApplications] = useState<ApplicationDoc[]>([])
  const [participants, setParticipants] = useState<ParticipantDoc[]>([])
  const [assignments, setAssignments] = useState<AssignmentDoc[]>([])
  const [appointments, setAppointments] = useState<AppointmentDoc[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedArea, setSelectedArea] = useState<string>()
  const [selectedWorkloadIntervention, setSelectedWorkloadIntervention] = useState<string>()
  const [selectedDeliveryOwner, setSelectedDeliveryOwner] = useState<string>()
  const [areaPage, setAreaPage] = useState(1)

  const rangePresets = useMemo(() => {
    const now = dayjs()
    return [
      { label: t('This month'), value: [now.startOf('month'), now.endOf('month')] as [Dayjs, Dayjs] },
      { label: t('This quarter'), value: [now.startOf('quarter'), now.endOf('quarter')] as [Dayjs, Dayjs] },
      { label: t('Year to date'), value: [now.startOf('year'), now] as [Dayjs, Dayjs] },
    ]
  }, [t])

  useEffect(() => {
    let mounted = true

    const loadReports = async () => {
      setLoading(true)
      try {
        const appConstraints = user?.companyCode ? [where('companyCode', '==', user.companyCode)] : []
        const appointmentConstraints = user?.companyCode ? [where('companyCode', '==', user.companyCode)] : []
        const [applicationsSnap, participantsSnap, assignmentsSnap, appointmentsSnap] = await Promise.all([
          getDocs(query(collection(db, 'applications'), ...appConstraints)),
          getDocs(collection(db, 'participants')),
          getDocs(collection(db, 'assignedInterventions')),
          getDocs(query(collection(db, 'appointments'), ...appointmentConstraints)),
        ])

        if (!mounted) return

        setApplications(applicationsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ApplicationDoc, 'id'>) })))
        setParticipants(participantsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ParticipantDoc, 'id'>) })))
        setAssignments(assignmentsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AssignmentDoc, 'id'>) })))
        setAppointments(appointmentsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AppointmentDoc, 'id'>) })))
      } catch (error) {
        console.error(error)
        message.error(t('Failed to load report data'))
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadReports()
    return () => {
      mounted = false
    }
  }, [message, user?.companyCode, t])

  useEffect(() => {
    setAreaPage(1)
    setSelectedArea(undefined)
  }, [activeProgramId, start, end])

  const reportData = useMemo(() => {
    const acceptedIds = new Set(applications.filter(isAccepted).map((application) => application.participantId).filter(Boolean))
    const scopedApplications = applications
      .filter((application) => matchesActiveProgram(user, activeProgramId, String(application.programId || '')))
      .filter((application) => inRange(primaryApplicationDate(application), start, end))
    const scopedAccepted = scopedApplications.filter(isAccepted)

    const scopedParticipants = participants.filter((participant) => {
      const knownAccepted = acceptedIds.has(participant.id) || acceptedIds.has(participant.participantId || '')
      const hasProgram = Boolean(String(participant.programId || '').trim())
      const programMatches = hasProgram && matchesActiveProgram(user, activeProgramId, String(participant.programId || ''))
      return knownAccepted || (!isAllPrograms && programMatches)
    })

    const participantIds = new Set([
      ...scopedParticipants.map((participant) => participant.id),
      ...scopedParticipants.map((participant) => participant.participantId || ''),
      ...scopedAccepted.map((application) => application.participantId || ''),
    ].filter(Boolean))

    const scopedAssignments = assignments
      .filter((assignment) => {
        const programMatches = matchesActiveProgram(user, activeProgramId, String(assignment.programId || ''))
        const assignmentParticipantId = assignment.participantId || assignment.smmeId || assignment.smeId || ''
        return programMatches && (participantIds.size === 0 || participantIds.has(assignmentParticipantId) || isAllPrograms)
      })
      .filter((assignment) => inRange(assignmentDate(assignment), start, end))

    const assignmentById = new Map(scopedAssignments.map((assignment) => [assignment.id, assignment]))
    const scopedAppointments = appointments
      .filter((appointment) => {
        const assignment = appointment.assignedInterventionId ? assignmentById.get(appointment.assignedInterventionId) : undefined
        const programId = String(appointment.programId || assignment?.programId || '')
        return matchesActiveProgram(user, activeProgramId, programId)
      })
      .filter((appointment) => inRange(toDate(appointment.startTime), start, end))

    const completedAssignments = scopedAssignments.filter(isCompletedAssignment)
    const inProgressAssignments = scopedAssignments.filter((assignment) => isInProgressAssignment(assignment) && !isCompletedAssignment(assignment))
    const overdueAssignments = scopedAssignments.filter((assignment) => {
      const dueDate = toDate(assignment.dueDate)
      return !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day') && !isCompletedAssignment(assignment)
    })

    const complianceDocuments = scopedAccepted.flatMap((application) => application.complianceDocuments || [])
    const complianceAttention = complianceDocuments.filter((document) => {
      const status = normalize(document.status)
      const expiryDate = toDate(document.expiryDate)
      return ['missing', 'expired', 'pending', 'queried', 'rejected'].includes(status) || (!!expiryDate && dayjs(expiryDate).isBefore(dayjs(), 'day'))
    })

    const requestedMap = new Map<string, number>()
    const titleArea = new Map<string, string>()
    scopedApplications.forEach((application) => {
      ;(application.interventions?.required || []).forEach((intervention) => {
        const title = String(intervention.title || intervention.id || 'Unspecified intervention')
        const area = String(intervention.areaOfSupport || 'Unspecified')
        requestedMap.set(title, (requestedMap.get(title) || 0) + 1)
        if (!titleArea.has(title)) titleArea.set(title, area)
      })
    })

    const assignedMap = new Map<string, number>()
    const completedMap = new Map<string, number>()
    const areaDemand = new Map<string, number>()
    const areaDelivery = new Map<string, number>()
    const areaCompleted = new Map<string, number>()
    const consultantMap = new Map<string, { assigned: number; inProgress: number; completed: number; overdue: number }>()
    const workloadByIntervention = new Map<string, WorkloadInterventionRow>()
    const facilitatorHealth = new Map<string, Omit<FacilitatorHealthRow, 'health'>>()

    scopedApplications.forEach((application) => {
      ;(application.interventions?.required || []).forEach((intervention) => {
        const area = String(intervention.areaOfSupport || 'Unspecified')
        areaDemand.set(area, (areaDemand.get(area) || 0) + 1)
      })
    })

    scopedAssignments.forEach((assignment) => {
      const title = String(assignment.interventionTitle || 'Unspecified intervention')
      const area = String(assignment.areaOfSupport || 'Unspecified')
      const deliveryOwner = deliveryOwnerFor(assignment)
      const consultant = deliveryOwner.name
      assignedMap.set(title, (assignedMap.get(title) || 0) + 1)
      areaDelivery.set(area, (areaDelivery.get(area) || 0) + 1)
      if (!titleArea.has(title)) titleArea.set(title, area)
      if (isCompletedAssignment(assignment)) {
        completedMap.set(title, (completedMap.get(title) || 0) + 1)
        areaCompleted.set(area, (areaCompleted.get(area) || 0) + 1)
      }

      const current = consultantMap.get(consultant) || { assigned: 0, inProgress: 0, completed: 0, overdue: 0 }
      current.assigned += 1
      if (isCompletedAssignment(assignment)) current.completed += 1
      else if (isInProgressAssignment(assignment)) current.inProgress += 1
      if (overdueAssignments.some((item) => item.id === assignment.id)) current.overdue += 1
      consultantMap.set(consultant, current)

      const holdUp = assignmentHoldUp(assignment)
      const ownerRisk = isDeliveryOwnerRisk(assignment)
      const interventionWorkload = workloadByIntervention.get(title) || {
        key: title,
        title,
        assigned: 0,
        inProgress: 0,
        completed: 0,
        overdue: 0,
        facilitatorHeld: 0,
        smeHeld: 0,
        riskScore: 0,
      }
      interventionWorkload.assigned += 1
      if (isCompletedAssignment(assignment)) interventionWorkload.completed += 1
      else if (isInProgressAssignment(assignment)) interventionWorkload.inProgress += 1
      if (ownerRisk) interventionWorkload.overdue += 1
      if (holdUp === 'facilitator') interventionWorkload.facilitatorHeld += 1
      if (holdUp === 'sme') interventionWorkload.smeHeld += 1
      workloadByIntervention.set(title, interventionWorkload)

      const facilitator = facilitatorHealth.get(consultant) || {
        key: consultant,
        name: consultant,
        actorType: deliveryOwner.actorType,
        assigned: 0,
        inProgress: 0,
        completed: 0,
        facilitatorHeld: 0,
        smeHeld: 0,
        riskScore: 0,
      }
      facilitator.assigned += 1
      if (isCompletedAssignment(assignment)) facilitator.completed += 1
      else if (isInProgressAssignment(assignment)) facilitator.inProgress += 1
      if (holdUp === 'facilitator' || ownerRisk) facilitator.facilitatorHeld += 1
      if (holdUp === 'sme') facilitator.smeHeld += 1
      facilitatorHealth.set(consultant, facilitator)
    })

    const workloadRows = Array.from(workloadByIntervention.values()).map((row) => ({
      ...row,
      riskScore: Math.min(100, row.overdue * 35 + row.facilitatorHeld * 25 + Math.max(row.inProgress - row.completed, 0) * 5),
    })).sort((left, right) => right.riskScore - left.riskScore || right.assigned - left.assigned || left.title.localeCompare(right.title))

    const facilitatorRows = Array.from(facilitatorHealth.values()).map((row) => {
      const unstartedRisk = row.actorType === 'Agent' ? 0 : Math.max(row.assigned - row.completed - row.inProgress, 0) * 10
      const riskScore = Math.min(100, row.facilitatorHeld * 30 + unstartedRisk)
      return { ...row, riskScore, health: riskScore >= 60 ? 'At risk' as const : riskScore >= 30 ? 'Watch' as const : 'On track' as const }
    }).sort((left, right) => right.riskScore - left.riskScore || right.assigned - left.assigned || left.name.localeCompare(right.name))

    const supportRows: SupportDemandRow[] = Array.from(new Set([...requestedMap.keys(), ...assignedMap.keys()])).map((title) => {
      const requested = requestedMap.get(title) || 0
      const assigned = assignedMap.get(title) || 0
      const completed = completedMap.get(title) || 0
      return {
        key: title,
        title,
        area: titleArea.get(title) || 'Unspecified',
        requested,
        assigned,
        completed,
        gap: Math.max(requested - assigned, 0),
        completionRate: percent(completed, assigned),
      }
    }).sort((a, b) => b.gap - a.gap || b.requested - a.requested)

    const areaRows: AreaDemandRow[] = Array.from(new Set([...areaDemand.keys(), ...areaDelivery.keys()])).map((area) => {
      const requested = areaDemand.get(area) || 0
      const assigned = areaDelivery.get(area) || 0
      const completed = areaCompleted.get(area) || 0
      return {
        key: area,
        area,
        requested,
        assigned,
        completed,
        gap: Math.max(requested - assigned, 0),
        completionRate: percent(completed, assigned),
      }
    }).sort((a, b) => b.requested - a.requested || a.area.localeCompare(b.area))

    const attentionRows: AttentionRow[] = scopedAssignments
      .filter((assignment) => !isCompletedAssignment(assignment))
      .map((assignment) => {
        const dueDate = toDate(assignment.dueDate)
        const progress = numberValue(assignment.progress)
        const overdue = !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day')
        const issue = overdue ? 'Overdue delivery' : progress === 0 ? 'Not started' : 'In progress'
        const severity: AttentionRow['severity'] = overdue || progress === 0 ? 'high' : 'medium'
        return {
          key: assignment.id,
          intervention: String(assignment.interventionTitle || 'Intervention'),
          participant: String(assignment.beneficiaryName || assignment.businessName || assignment.participantName || 'Participant'),
          owner: String(assignment.assigneeName || 'Unassigned'),
          issue,
          dueDate: dueDate ? dayjs(dueDate).format('DD MMM YYYY') : 'No due date',
          severity,
        }
      })
      .sort((a, b) => (a.severity === b.severity ? a.dueDate.localeCompare(b.dueDate) : a.severity === 'high' ? -1 : 1))
      .slice(0, 8)

    const attendanceRows: AttendanceRow[] = scopedAppointments
      .map((appointment) => {
        const attendanceValues = Object.values(appointment.attendance || {}).map((value) => normalize(value))
        const attendance: AttendanceRow['attendance'] = attendanceValues.includes('present')
          ? 'Present'
          : attendanceValues.includes('absent')
            ? 'Absent'
            : 'Not captured'
        const startDate = toDate(appointment.startTime)
        return {
          key: appointment.id,
          appointment: String(appointment.interventionTitle || 'Appointment'),
          participant: String(appointment.participantName || appointment.participantEmail || 'Participant'),
          program: String(appointment.programName || 'Unassigned'),
          date: startDate ? dayjs(startDate).format('DD MMM YYYY HH:mm') : 'Not scheduled',
          meetingType: String(appointment.meetingType || 'Unspecified').replace(/_/g, ' '),
          status: String(appointment.status || 'pending'),
          attendance,
        }
      })
      .sort((left, right) => right.date.localeCompare(left.date))

    const granularity = bucketGranularityForRange(start, end)
    const intakeBuckets = new Map<string, { submitted: number; accepted: number }>()
    scopedApplications.forEach((application) => {
      const date = primaryApplicationDate(application)
      if (!date) return
      const label = bucketLabel(date, granularity)
      const bucket = intakeBuckets.get(label) || { submitted: 0, accepted: 0 }
      bucket.submitted += 1
      if (isAccepted(application)) bucket.accepted += 1
      intakeBuckets.set(label, bucket)
    })

    const appointmentBuckets = new Map<string, { total: number; attended: number; absent: number }>()
    scopedAppointments.forEach((appointment) => {
      const date = toDate(appointment.startTime)
      if (!date) return
      const label = bucketLabel(date, granularity)
      const bucket = appointmentBuckets.get(label) || { total: 0, attended: 0, absent: 0 }
      bucket.total += 1
      const attendanceValues = Object.values(appointment.attendance || {}).map((value) => normalize(value))
      if (attendanceValues.includes('present')) bucket.attended += 1
      else if (attendanceValues.includes('absent')) bucket.absent += 1
      appointmentBuckets.set(label, bucket)
    })

    const interventionStatusBuckets = new Map<string, { completed: number; inProgress: number; overdue: number; notStarted: number }>()
    scopedAssignments.forEach((assignment) => {
      const date = assignmentDate(assignment)
      if (!date) return
      const label = bucketLabel(date, granularity)
      const bucket = interventionStatusBuckets.get(label) || { completed: 0, inProgress: 0, overdue: 0, notStarted: 0 }
      const dueDate = toDate(assignment.dueDate)
      const overdue = !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day') && !isCompletedAssignment(assignment)
      if (isCompletedAssignment(assignment)) bucket.completed += 1
      else if (overdue) bucket.overdue += 1
      else if (isInProgressAssignment(assignment)) bucket.inProgress += 1
      else bucket.notStarted += 1
      interventionStatusBuckets.set(label, bucket)
    })

    return {
      scopedApplications,
      scopedAccepted,
      scopedParticipants,
      scopedAssignments,
      scopedAppointments,
      completedAssignments,
      inProgressAssignments,
      overdueAssignments,
      complianceDocuments,
      complianceAttention,
      requestedMap,
      assignedMap,
      completedMap,
      areaDemand,
      areaDelivery,
      consultantMap,
      workloadRows,
      facilitatorRows,
      supportRows,
      areaRows,
      attentionRows,
      attendanceRows,
      intakeBuckets,
      appointmentBuckets,
      interventionStatusBuckets,
    }
  }, [activeProgramId, applications, appointments, assignments, end, isAllPrograms, participants, start, user])

  const previousRange = useMemo<[Dayjs, Dayjs]>(() => getPreviousRange([start, end]), [start, end])

  const performanceData = useMemo(() => {
    const rows: PerformanceSourceRow[] = reportData.scopedParticipants
    const revenue = computeMetricPerformance(rows, revenueInRange, [start, end], previousRange)
    const employees = computeMetricPerformance(rows, employeesInRange, [start, end], previousRange)
    const trend = performanceBucketRange([start, end]).map((bucket) => ({
      label: bucket.label,
      revenue: rows.reduce((sum, row) => sum + revenueInRange(row, bucket.range), 0),
      employees: rows.reduce((sum, row) => sum + employeesInRange(row, bucket.range), 0),
    }))
    return { revenue, employees, trend, smeCount: rows.length }
  }, [end, previousRange, reportData.scopedParticipants, start])

  const performanceTrendOptions = useMemo<Highcharts.Options>(() => {
    const categories = performanceData.trend.map((bucket) => bucket.label)
    return {
      colors: [CHART_COLORS.success, CHART_COLORS.primary],
      chart: { height: 300 },
      title: { text: undefined },
      subtitle: { text: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}` },
      xAxis: { categories },
      yAxis: [
        { min: 0, title: { text: tr('Revenue') }, labels: { formatter() { return formatCurrencyZAR(Number(this.value)) } } },
        { min: 0, allowDecimals: false, title: { text: tr('Employees') }, opposite: true },
      ],
      tooltip: { shared: true },
      plotOptions: { column: { borderRadius: 4 }, spline: { marker: { enabled: true } } },
      series: [
        { name: tr('Revenue'), type: 'column', yAxis: 0, data: performanceData.trend.map((bucket) => bucket.revenue), tooltip: { valuePrefix: 'R ' } },
        { name: tr('Employees'), type: 'spline', yAxis: 1, data: performanceData.trend.map((bucket) => bucket.employees) },
      ],
    }
  }, [end, performanceData.trend, start])

  const summary = useMemo(() => {
    const submitted = reportData.scopedApplications.length
    const accepted = reportData.scopedAccepted.length
    const assigned = reportData.scopedAssignments.length
    const completed = reportData.completedAssignments.length
    const attended = reportData.attendanceRows.filter((row) => row.attendance === 'Present').length
    const absent = reportData.attendanceRows.filter((row) => row.attendance === 'Absent').length
    const notCaptured = reportData.attendanceRows.filter((row) => row.attendance === 'Not captured').length
    const topDemand = topEntries(reportData.requestedMap, 1)[0]
    const topGap = reportData.supportRows.find((row) => row.gap > 0)
    const busiestConsultant = Array.from(reportData.consultantMap.entries()).sort((a, b) => b[1].assigned - a[1].assigned)[0]

    return {
      submitted,
      accepted,
      participants: reportData.scopedParticipants.length || accepted,
      acceptanceRate: percent(accepted, submitted),
      assigned,
      completed,
      completionRate: percent(completed, assigned),
      overdue: reportData.overdueAssignments.length,
      complianceRisk: reportData.complianceAttention.length,
      appointments: reportData.scopedAppointments.length,
      attended,
      absent,
      notCaptured,
      attendanceRate: percent(attended, attended + absent),
      topDemand: topDemand ? `${topDemand[0]} (${topDemand[1]})` : 'No demand yet',
      topGap: topGap ? `${topGap.title} needs ${topGap.gap} more assignment${topGap.gap === 1 ? '' : 's'}` : 'Demand is covered',
      busiestConsultant: busiestConsultant ? `${busiestConsultant[0]} (${busiestConsultant[1].assigned})` : 'No delivery-owner workload yet',
    }
  }, [reportData])

  const overviewHighlights = useMemo(() => [
    {
      key: 'applications',
      label: t('Applications'),
      value: `${summary.acceptanceRate}%`,
      meta: `${summary.accepted} of ${summary.submitted} accepted`,
      tone: summary.acceptanceRate >= 50 ? 'good' : 'watch',
    },
    {
      key: 'delivery',
      label: t('Delivery'),
      value: `${summary.completionRate}%`,
      meta: `${summary.completed} of ${summary.assigned} completed`,
      tone: summary.completionRate >= 60 ? 'good' : 'watch',
    },
    {
      key: 'attendance',
      label: t('Attendance'),
      value: `${summary.attendanceRate}%`,
      meta: `${summary.attended} present, ${summary.absent} absent`,
      tone: summary.attendanceRate >= 75 ? 'good' : 'watch',
    },
    {
      key: 'compliance',
      label: t('Compliance'),
      value: String(summary.complianceRisk),
      meta: 'items need follow-up',
      tone: summary.complianceRisk > 0 ? 'risk' : 'good',
    },
  ], [summary, t])

  const overviewActions = useMemo(() => [
    {
      key: 'gap',
      title: t('Demand gap'),
      body: summary.topGap,
      target: 'interventions' as ReportView,
      tone: summary.topGap === 'Demand is covered' ? 'good' : 'watch',
    },
    {
      key: 'overdue',
      title: t('Overdue work'),
      body: summary.overdue ? `${summary.overdue} assignments need intervention.` : 'No overdue assignments in this period.',
      target: 'interventions' as ReportView,
      tone: summary.overdue ? 'risk' : 'good',
    },
    {
      key: 'attendance',
      title: t('Attendance capture'),
      body: summary.notCaptured ? `${summary.notCaptured} appointments still need attendance captured.` : 'Attendance is captured for all period appointments.',
      target: 'appointments' as ReportView,
      tone: summary.notCaptured ? 'watch' : 'good',
    },
  ], [summary, t])

  const intakeOptions = useMemo<Highcharts.Options>(() => {
    const categories = Array.from(reportData.intakeBuckets.keys())
    return {
      colors: [CHART_COLORS.primary, CHART_COLORS.success],
      chart: { type: 'column', height: 310 },
      title: { text: tr('Application Flow') },
      subtitle: { text: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}` },
      xAxis: { categories },
      yAxis: { min: 0, title: { text: tr('Applications') }, allowDecimals: false },
      tooltip: { shared: true },
      plotOptions: { column: { borderRadius: 4, dataLabels: { enabled: true } } },
      series: [
        { name: tr('Submitted'), type: 'column', data: categories.map((key) => reportData.intakeBuckets.get(key)?.submitted || 0) },
        { name: tr('Accepted'), type: 'column', data: categories.map((key) => reportData.intakeBuckets.get(key)?.accepted || 0) },
      ],
    }
  }, [end, reportData.intakeBuckets, start])

  const interventionHealthOptions = useMemo<Highcharts.Options>(() => ({
    colors: [CHART_COLORS.success, CHART_COLORS.primary, CHART_COLORS.danger, CHART_COLORS.amber],
    chart: { type: 'pie', height: 300 },
    title: { text: tr('Intervention Health') },
    tooltip: { pointFormat: '<b>{point.y}</b> assignments' },
    plotOptions: {
      pie: {
        innerSize: '58%',
        dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { textOutline: 'none' } },
      },
    },
    series: [{
      type: 'pie',
      name: tr('Assignments'),
      data: [
        { name: 'Completed', y: reportData.completedAssignments.length },
        { name: 'In progress', y: reportData.inProgressAssignments.length },
        { name: 'Overdue', y: reportData.overdueAssignments.length },
        { name: 'Not started', y: Math.max(reportData.scopedAssignments.length - reportData.completedAssignments.length - reportData.inProgressAssignments.length, 0) },
      ].filter((point) => point.y > 0),
    }],
  }), [reportData])

  const appointmentHealthOptions = useMemo<Highcharts.Options>(() => {
    const held = summary.attended + summary.absent
    return {
      chart: { type: 'column', height: 240 },
      title: { text: undefined },
      xAxis: { categories: ['Planned', 'Held'] },
      yAxis: { min: 0, title: { text: undefined }, allowDecimals: false },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y}</b> appointments' },
      plotOptions: { column: { borderRadius: 4, colorByPoint: true, dataLabels: { enabled: true } } },
      series: [{ type: 'column', name: tr('Appointments'), data: [summary.appointments, held] }],
    }
  }, [summary.absent, summary.appointments, summary.attended])

  const attendanceGaugeOptions = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'pie', height: 170, margin: [0, 0, 0, 0] },
    title: { text: undefined },
    tooltip: { enabled: false },
    plotOptions: {
      pie: {
        startAngle: -90,
        endAngle: 90,
        center: ['50%', '85%'],
        size: '170%',
        innerSize: '70%',
        borderWidth: 0,
        dataLabels: { enabled: false },
        states: { hover: { enabled: false } },
      },
    },
    series: [{
      type: 'pie',
      name: tr('Attendance'),
      data: [
        { name: 'Present', y: summary.attendanceRate, color: CHART_COLORS.success },
        { name: 'Remaining', y: Math.max(0, 100 - summary.attendanceRate), color: token.colorFillSecondary },
      ],
    }],
  }), [summary.attendanceRate, token.colorFillSecondary])

  const appointmentTrendOptions = useMemo<Highcharts.Options>(() => {
    const categories = Array.from(reportData.appointmentBuckets.keys())
    return {
      colors: [CHART_COLORS.primary, CHART_COLORS.success],
      chart: { height: 300 },
      title: { text: undefined },
      subtitle: { text: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}` },
      xAxis: { categories },
      yAxis: [
        { min: 0, allowDecimals: false, title: { text: tr('Appointments') } },
        { min: 0, max: 100, title: { text: tr('Attendance rate') }, labels: { format: '{value}%' }, opposite: true },
      ],
      tooltip: { shared: true },
      plotOptions: { column: { borderRadius: 4, opacity: 0.7 }, spline: { marker: { enabled: true } } },
      series: [
        {
          name: tr('Appointments'),
          type: 'spline',
          yAxis: 0,
          data: categories.map((key) => reportData.appointmentBuckets.get(key)?.total || 0),
        },
        {
          name: tr('Attendance rate'),
          type: 'column',
          yAxis: 1,
          tooltip: { valueSuffix: '%' },
          data: categories.map((key) => {
            const bucket = reportData.appointmentBuckets.get(key)
            return bucket ? percent(bucket.attended, bucket.attended + bucket.absent) : 0
          }),
        },
      ],
    }
  }, [end, reportData.appointmentBuckets, start])

  const interventionStatusTrendOptions = useMemo<Highcharts.Options>(() => {
    const categories = Array.from(reportData.interventionStatusBuckets.keys())
    const assignedPerBucket = categories.map((key) => {
      const bucket = reportData.interventionStatusBuckets.get(key)
      return bucket ? bucket.completed + bucket.inProgress + bucket.overdue + bucket.notStarted : 0
    })
    return {
      colors: [CHART_COLORS.slate, CHART_COLORS.success, CHART_COLORS.primary, CHART_COLORS.danger, CHART_COLORS.amber],
      chart: { height: 320 },
      title: { text: undefined },
      subtitle: { text: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}` },
      xAxis: { categories },
      yAxis: { min: 0, allowDecimals: false, title: { text: tr('Interventions') } },
      tooltip: { shared: true },
      plotOptions: {
        column: { stacking: 'normal', borderRadius: 4, dataLabels: { enabled: true } },
        spline: { dataLabels: { enabled: true, style: { fontWeight: 'bold', textOutline: 'none' } } },
      },
      series: [
        { name: tr('Assigned'), type: 'spline', data: assignedPerBucket, zIndex: 5, marker: { enabled: true } },
        { name: tr('Completed'), type: 'column', data: categories.map((key) => reportData.interventionStatusBuckets.get(key)?.completed || 0) },
        { name: tr('In progress'), type: 'column', data: categories.map((key) => reportData.interventionStatusBuckets.get(key)?.inProgress || 0) },
        { name: tr('Overdue'), type: 'column', data: categories.map((key) => reportData.interventionStatusBuckets.get(key)?.overdue || 0) },
        { name: tr('Not started'), type: 'column', data: categories.map((key) => reportData.interventionStatusBuckets.get(key)?.notStarted || 0) },
      ],
    }
  }, [end, reportData.interventionStatusBuckets, start])

  const participantOptions = useMemo<Highcharts.Options>(() => {
    const hubs = new Map<string, number>()
    reportData.scopedParticipants.forEach((participant) => {
      const key = String(participant.hub || participant.province || 'Unassigned')
      hubs.set(key, (hubs.get(key) || 0) + 1)
    })
    const rows = topEntries(hubs, 8)
    return {
      colors: [CHART_COLORS.cyan],
      chart: { type: 'bar', height: 300 },
      title: { text: tr('Participant Spread') },
      xAxis: { categories: rows.map(([label]) => label) },
      yAxis: { min: 0, title: { text: tr('Participants') }, allowDecimals: false },
      legend: { enabled: false },
      plotOptions: { series: { dataLabels: { enabled: true } } },
      series: [{ name: tr('Participants'), type: 'bar', data: rows.map(([, count]) => count) }],
    }
  }, [reportData.scopedParticipants])

  const genderOptions = useMemo<Highcharts.Options>(() => {
    const counts = new Map<string, number>()
    reportData.scopedParticipants.forEach((participant) => {
      const key = String(participant.gender || 'Unspecified')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    const rows = topEntries(counts, 8)
    return {
      chart: { type: 'pie', height: 280 },
      title: { text: tr('Gender Distribution') },
      plotOptions: {
        pie: {
          innerSize: '55%',
          dataLabels: { enabled: true, format: '{point.name}: {point.y}' },
        },
      },
      series: [{ name: tr('Participants'), type: 'pie', data: rows.map(([name, y]) => ({ name, y })) }],
    }
  }, [reportData.scopedParticipants])

  const beeOptions = useMemo<Highcharts.Options>(() => {
    const counts = new Map<string, number>()
    reportData.scopedParticipants.forEach((participant) => {
      const key = String(participant.beeLevel || 'Unspecified')
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    const rows = topEntries(counts, 8)
    return {
      chart: { type: 'column', height: 280 },
      title: { text: tr('B-BBEE Levels') },
      xAxis: { categories: rows.map(([label]) => label) },
      yAxis: { min: 0, title: { text: tr('Participants') }, allowDecimals: false },
      legend: { enabled: false },
      plotOptions: { column: { borderRadius: 4, colorByPoint: true, dataLabels: { enabled: true } } },
      series: [{ name: tr('Participants'), type: 'column', data: rows.map(([, count]) => count) }],
    }
  }, [reportData.scopedParticipants])

  const ownershipOptions = useMemo<Highcharts.Options>(() => {
    const participants = reportData.scopedParticipants
    const count = participants.length || 1
    const female = participants.reduce((sum, item) => sum + numberValue(item.femaleOwnedPercent), 0) / count
    const youth = participants.reduce((sum, item) => sum + numberValue(item.youthOwnedPercent), 0) / count
    const black = participants.reduce((sum, item) => sum + numberValue(item.blackOwnedPercent), 0) / count

    return {
      colors: [CHART_COLORS.pink, CHART_COLORS.amber, CHART_COLORS.success],
      chart: { type: 'bar', height: 260 },
      title: { text: tr('Ownership Profile') },
      xAxis: { categories: ['Female-owned', 'Youth-owned', 'Black-owned'] },
      yAxis: { min: 0, max: 100, labels: { format: '{value}%' }, title: { text: tr('Average ownership') } },
      legend: { enabled: false },
      tooltip: { pointFormat: '<b>{point.y:.0f}%</b>' },
      plotOptions: { series: { dataLabels: { enabled: true, format: '{point.y:.0f}%' } } },
      series: [{ name: tr('Average'), type: 'bar', data: [female, youth, black] }],
    }
  }, [reportData.scopedParticipants])

  const attentionColumns: ColumnsType<AttentionRow> = [
    { title: t('Issue'), dataIndex: 'issue', key: 'issue', width: 140, render: (issue: string, row) => <Tag color={row.severity === 'high' ? 'red' : 'orange'}>{issue}</Tag> },
    { title: t('Intervention'), dataIndex: 'intervention', key: 'intervention' },
    { title: t('Participant'), dataIndex: 'participant', key: 'participant' },
    { title: t('Owner'), dataIndex: 'owner', key: 'owner', width: 170 },
    { title: t('Due'), dataIndex: 'dueDate', key: 'dueDate', width: 130 },
  ]

  const complianceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    reportData.complianceDocuments.forEach((document) => {
      const status = complianceStatusLabel(String(document.status || 'pending'))
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return topEntries(counts, 6)
  }, [reportData.complianceDocuments])

  const interventionCoverageRows = useMemo(
    () => reportData.supportRows.filter((row) => row.area === selectedArea),
    [reportData.supportRows, selectedArea],
  )

  const pagedAreaRows = useMemo(() => {
    const pageStart = (areaPage - 1) * AREA_PAGE_SIZE
    return reportData.areaRows.slice(pageStart, pageStart + AREA_PAGE_SIZE)
  }, [reportData.areaRows, areaPage])

  const workloadDrilldownRows = useMemo(() => reportData.scopedAssignments
    .filter((assignment) => !selectedWorkloadIntervention || String(assignment.interventionTitle || assignment.title || 'Unspecified intervention') === selectedWorkloadIntervention)
    .filter((assignment) => {
      if (!selectedDeliveryOwner) return true
      return deliveryOwnerFor(assignment).name === selectedDeliveryOwner
    }), [reportData.scopedAssignments, selectedDeliveryOwner, selectedWorkloadIntervention])

  const workloadDrilldownColumns: ColumnsType<AssignmentDoc> = [
    { title: t('Intervention'), key: 'intervention', render: (_, row) => String(row.interventionTitle || row.title || 'Unspecified intervention') },
    { title: t('SME'), key: 'participant', render: (_, row) => String(row.beneficiaryName || row.businessName || row.participantName || 'Participant') },
    { title: t('Delivery owner'), key: 'facilitator', render: (_, row) => { const owner = deliveryOwnerFor(row); return <Tag color={owner.actorType === 'Agent' ? 'purple' : 'blue'}>{owner.actorType} · {owner.name}</Tag> } },
    { title: t('Workflow'), key: 'workflow', render: (_, row) => <Space direction="vertical" size={3}><Tag color={isCompletedAssignment(row) ? 'green' : numberValue(row.progress) >= 100 ? 'purple' : isInProgressAssignment(row) ? 'blue' : 'default'}>{isCompletedAssignment(row) ? t('Completed') : numberValue(row.progress) >= 100 ? t('Awaiting SME confirmation') : isInProgressAssignment(row) ? t('In progress') : t('Assigned')}</Tag><Progress percent={Math.min(100, numberValue(row.progress))} size="small" style={{ width: 110 }} /></Space> },
    { title: t('Hold-up'), key: 'holdUp', render: (_, row) => { const holdUp = assignmentHoldUp(row); const owner = deliveryOwnerFor(row); return <Tag color={holdUp === 'facilitator' ? 'red' : holdUp === 'sme' ? 'gold' : holdUp === 'complete' ? 'green' : 'blue'}>{holdUp === 'facilitator' ? `${owner.actorType} action` : holdUp === 'sme' ? t('Awaiting SME') : holdUp === 'complete' ? t('Completed') : t('In delivery')}</Tag> } },
    { title: t('Due'), key: 'due', render: (_, row) => { const dueDate = toDate(row.dueDate); return <Text type={isDeliveryOwnerRisk(row) ? 'danger' : undefined}>{dueDate ? dayjs(dueDate).format('DD MMM YYYY') : t('No due date')}</Text> } },
  ]

  const buildExportData = (): ReportExportData => {
    const rate = (value: number) => `${value}%`
    return {
      role: user?.role || 'operations',
      title: 'Operations Report',
      periodLabel: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}`,
      organisation: user?.companyCode || undefined,
      preparedBy: user?.name || user?.displayName || user?.email || 'Operations',
      kpis: [
        { label: 'Applications submitted', value: summary.submitted, note: `${rate(summary.acceptanceRate)} accepted` },
        { label: 'Active participants', value: summary.participants },
        { label: 'Interventions assigned', value: summary.assigned },
        { label: 'Interventions completed', value: summary.completed, note: `${rate(summary.completionRate)} completion rate`, tone: summary.completionRate >= 70 ? 'good' : summary.completionRate < 40 && summary.assigned ? 'risk' : 'watch' },
        { label: 'Overdue interventions', value: summary.overdue, tone: summary.overdue ? 'risk' : 'good' },
        { label: 'Compliance items needing follow-up', value: summary.complianceRisk, tone: summary.complianceRisk ? 'watch' : 'good' },
        { label: 'Appointments scheduled', value: summary.appointments },
        { label: 'Attendance rate', value: rate(summary.attendanceRate), note: `${summary.attended} present, ${summary.absent} absent, ${summary.notCaptured} not captured`, tone: summary.attendanceRate >= 80 ? 'good' : summary.attended + summary.absent && summary.attendanceRate < 60 ? 'risk' : 'watch' },
      ],
      tables: [
        {
          key: 'demand',
          title: 'Intervention demand and delivery',
          columns: [{ key: 'title', label: 'Intervention' }, { key: 'area', label: 'Area of support' }, { key: 'requested', label: 'Requested' }, { key: 'assigned', label: 'Assigned' }, { key: 'completed', label: 'Completed' }, { key: 'gap', label: 'Gap' }, { key: 'completionRate', label: 'Completion %' }],
          rows: reportData.supportRows.map((row) => ({ ...row })),
        },
        {
          key: 'attention',
          title: 'Items needing attention',
          columns: [{ key: 'intervention', label: 'Intervention' }, { key: 'participant', label: 'SME' }, { key: 'owner', label: 'Owner' }, { key: 'issue', label: 'Issue' }, { key: 'dueDate', label: 'Due' }, { key: 'severity', label: 'Severity' }],
          rows: reportData.attentionRows.map((row) => ({ ...row })),
        },
        {
          key: 'owners',
          title: 'Delivery owner health',
          columns: [{ key: 'name', label: 'Delivery owner' }, { key: 'actorType', label: 'Type' }, { key: 'assigned', label: 'Assigned' }, { key: 'inProgress', label: 'In progress' }, { key: 'completed', label: 'Completed' }, { key: 'facilitatorHeld', label: 'Held by owner' }, { key: 'health', label: 'Health' }],
          rows: reportData.facilitatorRows.map((row) => ({ ...row })),
        },
        {
          key: 'attendance',
          title: 'Appointments and attendance',
          columns: [{ key: 'appointment', label: 'Appointment' }, { key: 'participant', label: 'SME' }, { key: 'program', label: 'Programme' }, { key: 'date', label: 'Date' }, { key: 'meetingType', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'attendance', label: 'Attendance' }],
          rows: reportData.attendanceRows.map((row) => ({ ...row, status: appointmentStatusLabel(row.status) })),
        },
        {
          key: 'compliance',
          title: 'Compliance documents by status',
          columns: [{ key: 'status', label: 'Status' }, { key: 'documents', label: 'Documents' }],
          rows: complianceCounts.map(([status, documents]) => ({ status, documents })),
        },
      ],
    }
  }

  return (
    <DashboardPage className="operations-reports-page">
      {view === 'overview' && (
        <Row gutter={[16, 16]} className="dashboard-metrics-row operations-reports-metrics">
          <Col xs={12} lg={6}>
            <DashboardMetricCard loading={loading} icon={<AuditOutlined />} iconClassName="is-applications" label={t('Submitted')} value={summary.submitted} hint={`${summary.acceptanceRate}% accepted`} />
          </Col>
          <Col xs={12} lg={6}>
            <DashboardMetricCard loading={loading} icon={<TeamOutlined />} iconClassName="is-participants" label={t('Participants')} value={summary.participants} hint={t('Accepted or active SMEs')} />
          </Col>
          <Col xs={12} lg={6}>
            <DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} iconClassName="is-delivery" label={t('Completed')} value={summary.completed} hint={`${summary.completionRate}% delivery rate`} />
          </Col>
          <Col xs={12} lg={6}>
            <DashboardMetricCard loading={loading} icon={<ExclamationCircleOutlined />} iconClassName="is-attention" label={t('Attention')} value={summary.overdue + summary.complianceRisk} hint={`${summary.overdue} overdue, ${summary.complianceRisk} compliance`} />
          </Col>
        </Row>
      )}

      <FilterBar
        primary={
          <>
            <Segmented<ReportView>
              value={view}
              onChange={(value) => setView(value)}
              options={[
                { label: t('Overview'), value: 'overview', icon: <DashboardOutlined /> },
                { label: t('Applications'), value: 'applications', icon: <AuditOutlined /> },
                { label: t('Interventions'), value: 'interventions', icon: <RiseOutlined /> },
                { label: t('Appointments'), value: 'appointments', icon: <CalendarOutlined /> },
                { label: t('Workload'), value: 'workload', icon: <BarChartOutlined /> },
                { label: t('Participants'), value: 'participants', icon: <TeamOutlined /> },
                { label: t('Performance'), value: 'performance', icon: <FundOutlined /> },
              ]}
            />
            <RangePicker
              value={[start, end]}
              allowClear={false}
              presets={rangePresets}
              onChange={(value) => {
                if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
              }}
            />
          </>
        }
        actions={<ReportExportButton buildData={buildExportData} disabled={loading} />}
      />

      {view === 'overview' && (
        <>
          <Row gutter={[16, 16]} className="operations-overview-grid">
            <Col xs={24} xl={14}>
              <Card loading={loading} className="dashboard-section-card motion-card" title={t('Period Health')}>
                <div className="operations-health-grid">
                  {overviewHighlights.map((item) => (
                    <button
                      className={`operations-health-tile is-${item.tone}`}
                      key={item.key}
                      type="button"
                      onClick={() => setView(item.key === 'applications' ? 'applications' : item.key === 'compliance' ? 'participants' : item.key === 'attendance' ? 'appointments' : 'interventions')}
                    >
                      <Text type="secondary">{item.label}</Text>
                      <strong>{item.value}</strong>
                      <span>{item.meta}</span>
                    </button>
                  ))}
                </div>
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card loading={loading} className="dashboard-section-card motion-card" title={t('What Needs Attention')}>
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  {overviewActions.map((item) => (
                    <div className={`operations-action-brief is-${item.tone}`} key={item.key}>
                      <div>
                        <Text strong>{item.title}</Text>
                        <Text type="secondary">{item.body}</Text>
                      </div>
                      <Button size="small" onClick={() => setView(item.target)}>{t('Open detail')}</Button>
                    </div>
                  ))}
                </Space>
              </Card>
            </Col>
          </Row>
        </>
      )}

      {view === 'applications' && (
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={15}>
            <Card loading={loading} className="dashboard-section-card motion-card">
              {reportData.intakeBuckets.size ? <ThemedHighcharts options={intakeOptions} /> : <Empty description={t('No applications in this period')} />}
            </Card>
          </Col>
          <Col xs={24} xl={9}>
            <Card className="dashboard-section-card motion-card operations-insight-card">
              <Space direction="vertical" size={14}>
                <Title level={4}>{t('Intake Signals')}</Title>
                <Alert type="info" showIcon message={t('Top requested support')} description={summary.topDemand} />
                <Alert type={summary.acceptanceRate >= 50 ? 'success' : 'warning'} showIcon message={t('Conversion')} description={`${summary.acceptanceRate}% of submitted applications were accepted in this scope.`} />
                <Alert type={summary.topGap === 'Demand is covered' ? 'success' : 'warning'} showIcon message={t('Demand gap')} description={summary.topGap} />
              </Space>
            </Card>
          </Col>
        </Row>
      )}

      {view === 'interventions' && (
        <>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} lg={8}>
              <Card loading={loading} className="dashboard-section-card motion-card">
                {reportData.scopedAssignments.length ? <ThemedHighcharts options={interventionHealthOptions} /> : <Empty description={t('No assigned interventions')} />}
              </Card>
            </Col>
            <Col xs={24} lg={16}>
              <Card
                loading={loading}
                className="dashboard-section-card motion-card"
                title={selectedArea ? <Space><RiseOutlined /> {`Demand Coverage — ${selectedArea}`}</Space> : t('Demand vs Delivery by Support Area')}
                extra={selectedArea && <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => setSelectedArea(undefined)}>{t('Back to areas')}</Button>}
              >
                {selectedArea ? (
                  interventionCoverageRows.length ? (
                    <Row gutter={[10, 10]}>
                      {interventionCoverageRows.map((row) => (
                        <Col xs={24} sm={12} key={row.key}>
                          <InterventionCoverageCard row={row} />
                        </Col>
                      ))}
                    </Row>
                  ) : <Empty description={t('No intervention demand has been recorded for this area.')} />
                ) : reportData.areaRows.length ? (
                  <>
                    <Row gutter={[10, 10]}>
                      {pagedAreaRows.map((row) => (
                        <Col xs={12} sm={8} key={row.key}>
                          <AreaCard row={row} onClick={() => setSelectedArea(row.area)} />
                        </Col>
                      ))}
                    </Row>
                    {reportData.areaRows.length > AREA_PAGE_SIZE && (
                      <div style={{ marginTop: 14, textAlign: 'center' }}>
                        <Pagination simple current={areaPage} pageSize={AREA_PAGE_SIZE} total={reportData.areaRows.length} onChange={setAreaPage} />
                      </div>
                    )}
                  </>
                ) : <Empty description={t('No support-area data')} />}
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={24}>
              <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><BarChartOutlined /> {t('Intervention Status Over Time')}</Space>}>
                {reportData.interventionStatusBuckets.size ? <ThemedHighcharts options={interventionStatusTrendOptions} /> : <Empty description={t('No assigned interventions in this report period')} />}
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col span={24}>
              <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><ClockCircleOutlined /> {t('Needs Attention')}</Space>}>
                <Table
                  size="middle"
                  rowKey="key"
                  columns={attentionColumns}
                  dataSource={reportData.attentionRows}
                  pagination={false}
                  locale={{ emptyText: t('No overdue or stalled assignments in this period.') }}
                  scroll={{ x: 760 }}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}

      {view === 'appointments' && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={14}>
            <Card className="dashboard-section-card motion-card" title={<Space><ClockCircleOutlined /> {t('Appointment Health')}</Space>}>
              {summary.appointments ? (
                <>
                  <ThemedHighcharts options={appointmentHealthOptions} />
                  <Text type="secondary">
                    {summary.notCaptured
                      ? `${summary.notCaptured} appointment${summary.notCaptured === 1 ? '' : 's'} still awaiting attendance capture.`
                      : t('Attendance has been captured for every appointment in this period.')}
                  </Text>
                </>
              ) : <Empty description={t('No appointments were scheduled in this report period.')} />}
            </Card>
          </Col>
          <Col xs={24} lg={10}>
            <Card className="dashboard-section-card motion-card" title={<Space><CheckCircleOutlined /> {t('Attendance Rate')}</Space>}>
              {summary.attended + summary.absent ? (
                <div style={{ position: 'relative' }}>
                  <ThemedHighcharts options={attendanceGaugeOptions} />
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '66%', textAlign: 'center', pointerEvents: 'none' }}>
                    <Typography.Text strong style={{ fontSize: 30, display: 'block', lineHeight: 1 }}>{summary.attendanceRate}%</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{summary.attended} {t('present ·')} {summary.absent} {t('absent of')} {summary.attended + summary.absent} {t('held')}</Typography.Text>
                  </div>
                </div>
              ) : <Empty description={t('No appointments have been held yet in this period.')} />}
            </Card>
          </Col>
        </Row>
      )}

      {view === 'appointments' && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col span={24}>
            <Card className="dashboard-section-card motion-card" title={<Space><RiseOutlined /> {t('Appointments Over Time')}</Space>}>
              {reportData.appointmentBuckets.size ? <ThemedHighcharts options={appointmentTrendOptions} /> : <Empty description={t('No appointments were scheduled in this report period.')} />}
            </Card>
          </Col>
        </Row>
      )}

      {view === 'participants' && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}>
            <Card loading={loading} className="dashboard-section-card motion-card">
              <ThemedHighcharts options={participantOptions} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card loading={loading} className="dashboard-section-card motion-card">
              <ThemedHighcharts options={ownershipOptions} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card loading={loading} className="dashboard-section-card motion-card">
              <ThemedHighcharts options={genderOptions} />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card loading={loading} className="dashboard-section-card motion-card">
              <ThemedHighcharts options={beeOptions} />
            </Card>
          </Col>
          <Col xs={24}>
            <Card className="dashboard-section-card motion-card operations-insight-card">
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Title level={4}>{t('Compliance Status')}</Title>
                {complianceCounts.length ? complianceCounts.map(([status, count]) => (
                  <div className="operations-status-row" key={status}>
                    <Space>
                      <FileProtectOutlined />
                      <Text>{status}</Text>
                    </Space>
                    <Tag color={complianceStatusColor(status)}>{count}</Tag>
                  </div>
                )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No compliance documents found')} />}
                <Alert
                  type={summary.complianceRisk > 0 ? 'warning' : 'success'}
                  showIcon
                  message={summary.complianceRisk > 0 ? t('Compliance follow-up required') : t('No compliance exceptions')}
                  description={`${summary.complianceRisk} document${summary.complianceRisk === 1 ? '' : 's'} need attention in this report scope.`}
                />
              </Space>
            </Card>
          </Col>
        </Row>
      )}

      {view === 'workload' && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} xl={15}>
            <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><BarChartOutlined /> {t('Delivery workload')}</Space>} extra={<Text type="secondary">{t('Click a facilitator or agent to open assigned interventions')}</Text>}>
              {reportData.facilitatorRows.length ? <div className="operations-workload-grid">{reportData.facilitatorRows.map((row) => <DeliveryOwnerWorkloadCard key={row.key} row={row} onClick={() => { setSelectedWorkloadIntervention(undefined); setSelectedDeliveryOwner(row.name) }} />)}</div> : <Empty description={t('No facilitator or agent workload in this period')} />}
            </Card>
          </Col>
          <Col xs={24} xl={9}>
            <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><TeamOutlined /> {t('Facilitator & agent health')}</Space>} extra={<Text type="secondary">{t('Only owner-held delays add risk')}</Text>}>
              {reportData.facilitatorRows.length ? <div className="operations-facilitator-list">{reportData.facilitatorRows.map((row) => <FacilitatorHealthCard key={row.key} row={row} onClick={() => { setSelectedWorkloadIntervention(undefined); setSelectedDeliveryOwner(row.name) }} />)}</div> : <Empty description={t('No facilitator or agent workload in this period')} />}
              <Text type="secondary" style={{ display: 'block', marginTop: 12 }}>{t('Awaiting SME acceptance or completion confirmation remains visible, but does not lower the facilitator or agent health score.')}</Text>
            </Card>
          </Col>
        </Row>
      )}
      {view === 'performance' && (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={12}>
            <PerformanceStatCard
              loading={loading}
              title={t('Revenue')}
              icon={<DollarCircleOutlined />}
              formattedValue={formatCurrencyZAR(performanceData.revenue.current)}
              deltaLabel={performanceData.revenue.delta.label}
              deltaPositive={performanceData.revenue.delta.positive}
              headline={performanceData.revenue.headline}
              caption={`${performanceData.revenue.growing} of ${performanceData.smeCount} SMEs growing`}
            />
          </Col>
          <Col xs={24} lg={12}>
            <PerformanceStatCard
              loading={loading}
              title={t('Employees')}
              icon={<TeamOutlined />}
              formattedValue={formatMetricNumber(performanceData.employees.current)}
              deltaLabel={performanceData.employees.delta.label}
              deltaPositive={performanceData.employees.delta.positive}
              headline={performanceData.employees.headline}
              caption={`${performanceData.employees.growing} of ${performanceData.smeCount} SMEs growing`}
            />
          </Col>
          <Col span={24}>
            <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><FundOutlined /> {t('Revenue & Employees Trend')}</Space>}>
              {performanceData.smeCount ? <ThemedHighcharts options={performanceTrendOptions} /> : <Empty description={t('No SME revenue or employee data in this report period.')} />}
            </Card>
          </Col>
        </Row>
      )}

      <Modal open={!!selectedWorkloadIntervention || !!selectedDeliveryOwner} title={selectedWorkloadIntervention ? `${selectedWorkloadIntervention} — delivery status` : `${selectedDeliveryOwner} — assigned interventions`} onCancel={() => { setSelectedWorkloadIntervention(undefined); setSelectedDeliveryOwner(undefined) }} footer={null} width={1100} destroyOnClose>
        <Table rowKey="id" dataSource={workloadDrilldownRows} columns={workloadDrilldownColumns} pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }} locale={{ emptyText: t('No assignments match this workload selection.') }} scroll={{ x: 880 }} />
      </Modal>
    </DashboardPage>
  )
}

export default OperationsReportsPage
