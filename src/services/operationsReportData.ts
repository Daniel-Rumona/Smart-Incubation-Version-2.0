import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { countsForDiscontinued } from '@/services/discontinuedSmes'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'

dayjs.extend(isoWeek)
dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

/**
 * The Reports page's figures for one period (OperationsReportsPage.tsx): applications, participants, assignments
 * and appointments scoped to the active programme and the date range. Run once for the selected period and once for
 * the previous one so the page can compare them.
 */

export type BucketGranularity = 'day' | 'week' | 'month'

export type FirestoreDate =
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

export type ApplicationDoc = {
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

export type ParticipantDoc = {
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

export type AssignmentDoc = {
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

export type AppointmentDoc = {
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

export type SupportDemandRow = {
  key: string
  title: string
  area: string
  requested: number
  assigned: number
  completed: number
  gap: number
  completionRate: number
}

export type AreaDemandRow = {
  key: string
  area: string
  requested: number
  assigned: number
  completed: number
  gap: number
  completionRate: number
}

export type AttentionRow = {
  key: string
  intervention: string
  participant: string
  owner: string
  issue: string
  dueDate: string
  severity: 'high' | 'medium'
}

export type AttendanceRow = {
  key: string
  appointment: string
  participant: string
  program: string
  date: string
  meetingType: string
  status: string
  attendance: 'Present' | 'Absent' | 'Not captured'
}

export type WorkloadInterventionRow = {
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

export type FacilitatorHealthRow = {
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

export const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

export const toDate = (value: FirestoreDate): Date | null => {
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

export const primaryApplicationDate = (application: ApplicationDoc) =>
  toDate(application.submittedAt) || toDate(application.createdAt) || toDate(application.updatedAt)

export const assignmentDate = (assignment: AssignmentDoc) =>
  toDate(assignment.assignedAt) || toDate(assignment.createdAt) || toDate(assignment.updatedAt) || toDate(assignment.dueDate)

export const bucketGranularityForRange = (rangeStart: Dayjs, rangeEnd: Dayjs): BucketGranularity => {
  const days = rangeEnd.diff(rangeStart, 'day')
  if (days <= 45) return 'day'
  if (days <= 200) return 'week'
  return 'month'
}

export const inRange = (date: Date | null, start: Dayjs, end: Dayjs) => {
  if (!date) return false
  const value = dayjs(date)
  return value.isSameOrAfter(start, 'day') && value.isSameOrBefore(end, 'day')
}

export const percent = (numerator: number, denominator: number) =>
  denominator > 0 ? Math.round((numerator / denominator) * 100) : 0

export const numberValue = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export const isAccepted = (application: ApplicationDoc) => {
  const status = normalize(application.applicationStatus || application.status)
  return ['accepted', 'approved', 'onboarded', 'enrolled'].includes(status)
}

export const isCompletedAssignment = (assignment: AssignmentDoc) => {
  const status = normalize(assignment.status)
  const completion = normalize(assignment.completionStatus)
  const participantCompletion = normalize(assignment.participantCompletionStatus)
  return status === 'completed' || status === 'done' || completion === 'confirmed' || participantCompletion === 'confirmed'
}

export const isInProgressAssignment = (assignment: AssignmentDoc) => {
  const status = normalize(assignment.status)
  return ['in-progress', 'in progress', 'active', 'started'].includes(status) || numberValue(assignment.progress) > 0
}

export type AssignmentHoldUp = 'facilitator' | 'sme' | 'delivery' | 'complete'

export const assignmentHoldUp = (assignment: AssignmentDoc): AssignmentHoldUp => {
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

export const isDeliveryOwnerRisk = (assignment: AssignmentDoc) => {
  if (assignmentHoldUp(assignment) === 'sme' || isCompletedAssignment(assignment)) return false
  if (isAgentAssignment(assignment)) {
    return ['failed', 'error', 'blocked'].includes(normalize(assignment.agentWorkStatus))
  }
  const dueDate = toDate(assignment.dueDate)
  return !!dueDate && dayjs(dueDate).isBefore(dayjs(), 'day')
}

// Older agent assignments were not all backfilled with deliveryActorType. Treat the
// assignment's configured strategy and agent identity as authoritative fallbacks.
export const isAgentAssignment = (assignment: AssignmentDoc) => {
  const strategy = normalize(assignment.deliveryStrategy)
  return normalize(assignment.deliveryActorType) === 'agent'
    || strategy.includes('agent')
    || Boolean(String(assignment.agentId || assignment.assignedAgentId || assignment.agentName || assignment.agentWorkStatus || '').trim())
}

export const deliveryOwnerFor = (assignment: AssignmentDoc) => {
  if (isAgentAssignment(assignment)) {
    return {
      name: String(assignment.agentName || assignment.agentId || assignment.assignedAgentId || 'Unassigned agent'),
      actorType: 'Agent' as const,
    }
  }
  return { name: String(assignment.assigneeName || 'Unassigned facilitator'), actorType: 'Facilitator' as const }
}

export const bucketLabel = (date: Date, granularity: BucketGranularity) => {
  const value = dayjs(date)
  if (granularity === 'week') return `W${value.isoWeek()} ${value.year()}`
  if (granularity === 'month') return value.format('MMM YYYY')
  return value.format('DD MMM')
}

export const topEntries = (map: Map<string, number>, limit = 8) =>
  Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)


export const complianceStatusLabel = (status: string) => {
  const value = normalize(status)
  if (['valid', 'verified', 'completed', 'accepted', 'approved'].includes(value)) return 'Valid'
  if (['invalid', 'expired', 'rejected', 'cancelled', 'declined', 'not-valid', 'not valid', 'missing'].includes(value)) return 'Not Valid'
  if (['missing', 'pending', 'queried', 'expiring', 'uploaded'].includes(value)) return 'Pending Review'
  return status
    ? String(status).replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
    : 'Pending Review'
}

export const complianceStatusColor = (status: string) => {
  const label = complianceStatusLabel(status)
  if (label === 'Valid') return 'success'
  if (label === 'Not Valid') return 'error'
  if (label === 'Pending Review') return 'warning'
  return 'default'
}

export const appointmentStatusLabel = (status: string) => {
  const value = normalize(status)
  if (value === 'pending') return 'Scheduled'
  if (value === 'accepted') return 'Accepted'
  if (value === 'completed') return 'Completed'
  if (value === 'declined') return 'Declined'
  if (value === 'cancelled') return 'Cancelled'
  return String(status || 'Scheduled').replace(/[_-]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export type ReportRecords = {
  applications: ApplicationDoc[]
  participants: ParticipantDoc[]
  assignments: AssignmentDoc[]
  appointments: AppointmentDoc[]
}

export type ReportScope = { user: FullIdentity | null | undefined, activeProgramId: string, isAllPrograms: boolean }

export const computeReportData = ({ applications, participants, assignments, appointments }: ReportRecords, { user, activeProgramId, isAllPrograms }: ReportScope, start: Dayjs, end: Dayjs) => {
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
    .filter((assignment) => countsForDiscontinued(assignment as { participantDiscontinuedAt?: unknown }, assignmentDate(assignment)))

  const assignmentById = new Map(scopedAssignments.map((assignment) => [assignment.id, assignment]))
  const scopedAppointments = appointments
    .filter((appointment) => {
      const assignment = appointment.assignedInterventionId ? assignmentById.get(appointment.assignedInterventionId) : undefined
      const programId = String(appointment.programId || assignment?.programId || '')
      return matchesActiveProgram(user, activeProgramId, programId)
    })
    .filter((appointment) => inRange(toDate(appointment.startTime), start, end))
    .filter((appointment) => countsForDiscontinued(appointment as { participantDiscontinuedAt?: unknown }, toDate(appointment.startTime)))

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
}

export type ReportData = ReturnType<typeof computeReportData>
