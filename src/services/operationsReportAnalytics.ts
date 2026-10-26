import dayjs, { type Dayjs } from 'dayjs'
import { countsForDiscontinued } from '@/services/discontinuedSmes'
import { isAssignmentCompleted, requiredCount } from '@/services/directorPortfolioService'
import type { SmeImpact } from '@/services/impactAnalyticsService'
import {
  appointmentStatusLabel,
  assignmentDate,
  complianceStatusLabel,
  deliveryOwnerFor,
  isAccepted,
  isCompletedAssignment,
  isInProgressAssignment,
  normalize,
  percent,
  primaryApplicationDate,
  toDate,
  type ApplicationDoc,
  type AssignmentDoc,
  type ParticipantDoc,
  type ReportData,
  type ReportRecords,
  type ReportScope,
} from '@/services/operationsReportData'
import { bucketRange } from '@/services/smePerformanceMetrics'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'

/**
 * The Reports page's analytics: for each tab, the breakdowns ("Break down by"), the trend over the period with the
 * previous period alongside, and the rows behind them. Built from computeReportData for the selected and the previous
 * period. Delivery uses the director dashboard's rule (completed against required, as at the end of the period) and
 * Growth uses Impact analysis's figures, so the numbers match those pages. Labels stay English; the page translates.
 */

export type TabKey = 'intake' | 'delivery' | 'appointments' | 'smes' | 'growth'

export type BreakdownUnit = 'percent' | 'count' | 'growth'

export type BreakdownRow = {
  key: string
  label: string
  value: number
  previous: number | null
  /** e.g. "14 of 22" behind a percentage. */
  detail?: string
}

export type Dimension = { key: string, label: string, unit: BreakdownUnit, rows: BreakdownRow[] }

export type Trend = { labels: string[], current: number[], previous: number[], series: string, unit: 'count' | 'percent' | 'currency' }

export type TableColumn = { key: string, label: string, status?: boolean }

export type TableRow = { key: string, cells: Record<string, string>, /** Breakdown labels this row belongs to, for click-to-filter. */ matches: string[] }

export type FollowUp = { kind: 'decisions' | 'overdue' | 'attendance' | 'compliance' | 'impact', count: number, path: string }

export type AnalyticsTab = {
  key: TabKey
  dimensions: Dimension[]
  trend: Trend
  table: { title: string, columns: TableColumn[], rows: TableRow[] }
  followUp: FollowUp
}

const text = (value: unknown, fallback = '') => String(value ?? '').trim() || fallback
const smeName = (row: { beneficiaryName?: string | null, businessName?: string | null, participantName?: string | null, companyName?: string | null }) =>
  text(row.beneficiaryName || row.businessName || row.participantName || row.companyName, 'SME')
const areaOf = (value: unknown) => text(value, 'Unspecified')

const tally = <T,>(items: T[], keyOf: (item: T) => string | string[]) => {
  const counts = new Map<string, number>()
  items.forEach((item) => {
    const keys = keyOf(item)
    ;(Array.isArray(keys) ? keys : [keys]).forEach((key) => counts.set(key, (counts.get(key) || 0) + 1))
  })
  return counts
}

const rowsFrom = (current: Map<string, number>, previous: Map<string, number> | null, limit = 8): BreakdownRow[] =>
  Array.from(current.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([label, value]) => ({ key: label, label, value, previous: previous ? previous.get(label) || 0 : null }))

/** Counts per bucket of the range, in time order; the previous period is bucketed the same way and lined up by position. */
const series = (range: [Dayjs, Dayjs], dates: Array<Date | null>) => {
  const buckets = bucketRange(range)
  const counts = buckets.map(() => 0)
  dates.forEach((date) => {
    if (!date) return
    const value = dayjs(date)
    const index = buckets.findIndex((bucket) => !value.isBefore(bucket.range[0]) && !value.isAfter(bucket.range[1]))
    if (index >= 0) counts[index] += 1
  })
  return { labels: buckets.map((bucket) => bucket.label), counts }
}

const lineUp = (current: number[], previous: number[]) => current.map((_, index) => previous[index] ?? 0)

// ---------------------------------------------------------------------------
// Delivery: completed against required, as at a date (the dashboard's rule)
// ---------------------------------------------------------------------------

const acceptedOn = (application: ApplicationDoc) => toDate(application.acceptedAt) || toDate(application.approvedAt) || primaryApplicationDate(application)
const completedOn = (assignment: AssignmentDoc) => toDate(assignment.completionConfirmedAt) || toDate(assignment.completedAt) || toDate(assignment.updatedAt) || assignmentDate(assignment)

export type DeliveryAsAt = {
  required: number
  completed: number
  rate: number | null
  byArea: Map<string, { required: number, completed: number }>
  byProgramme: Map<string, { required: number, completed: number }>
  byOwner: Map<string, { assigned: number, completed: number }>
}

export const deliveryAsAt = (records: ReportRecords, scope: ReportScope, asAt: Dayjs): DeliveryAsAt => {
  const accepted = records.applications.filter((application) => isAccepted(application)
    && matchesActiveProgram(scope.user, scope.activeProgramId, text(application.programId))
    && !dayjs(acceptedOn(application) || 0).isAfter(asAt))
  const smeIds = new Set(accepted.map((application) => text(application.participantId)).filter(Boolean))
  const byArea = new Map<string, { required: number, completed: number }>()
  const byProgramme = new Map<string, { required: number, completed: number }>()
  const byOwner = new Map<string, { assigned: number, completed: number }>()
  const bump = <T extends Record<string, number>>(map: Map<string, T>, key: string, field: keyof T, empty: T) => {
    const entry = map.get(key) || { ...empty }
    entry[field] = (entry[field] + 1) as T[keyof T]
    map.set(key, entry)
  }

  let required = 0
  accepted.forEach((application) => {
    required += requiredCount(application as Record<string, unknown>)
    ;(application.interventions?.required || []).forEach((item) => {
      bump(byArea, areaOf(item.areaOfSupport || item.area), 'required', { required: 0, completed: 0 })
      bump(byProgramme, text(application.programName, 'No programme'), 'required', { required: 0, completed: 0 })
    })
  })

  let completed = 0
  records.assignments.forEach((assignment) => {
    const participantId = text(assignment.participantId || assignment.smmeId || assignment.smeId)
    if (!smeIds.has(participantId)) return
    if (!countsForDiscontinued(assignment as { participantDiscontinuedAt?: unknown }, assignmentDate(assignment))) return
    const assignedOn = assignmentDate(assignment)
    if (assignedOn && dayjs(assignedOn).isAfter(asAt)) return
    const owner = deliveryOwnerFor(assignment).name
    bump(byOwner, owner, 'assigned', { assigned: 0, completed: 0 })
    const done = isAssignmentCompleted(assignment as Record<string, unknown>) && !dayjs(completedOn(assignment) || 0).isAfter(asAt)
    if (!done) return
    completed += 1
    bump(byArea, areaOf(assignment.areaOfSupport || assignment.area), 'completed', { required: 0, completed: 0 })
    bump(byProgramme, text(assignment.programName, 'No programme'), 'completed', { required: 0, completed: 0 })
    bump(byOwner, owner, 'completed', { assigned: 0, completed: 0 })
  })

  return { required, completed, rate: required ? Math.min(100, percent(completed, required)) : null, byArea, byProgramme, byOwner }
}

const rateRows = (current: Map<string, { required?: number, assigned?: number, completed: number }>, previous: Map<string, { required?: number, assigned?: number, completed: number }>, of: 'required' | 'assigned'): BreakdownRow[] =>
  Array.from(current.entries())
    .filter(([, entry]) => (entry[of] || 0) > 0)
    .map(([label, entry]) => {
      const before = previous.get(label)
      const base = entry[of] || 0
      return {
        key: label,
        label,
        value: Math.min(100, percent(entry.completed, base)),
        previous: before && before[of] ? Math.min(100, percent(before.completed, before[of] || 0)) : null,
        detail: `${entry.completed} of ${base}`,
      }
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

type Input = {
  records: ReportRecords
  scope: ReportScope
  range: [Dayjs, Dayjs]
  previousRange: [Dayjs, Dayjs]
  current: ReportData
  previous: ReportData
  delivery: DeliveryAsAt
  previousDelivery: DeliveryAsAt
  impact: { smes: SmeImpact[] } | null
  revenueTrend: { labels: string[], current: number[], previous: number[] }
}

const requestedAreas = (application: ApplicationDoc) => (application.interventions?.required || []).map((item) => areaOf(item.areaOfSupport || item.area))

const intakeTab = ({ range, previousRange, current, previous }: Input): AnalyticsTab => {
  const byProgramme = (data: ReportData) => {
    const map = new Map<string, { submitted: number, accepted: number }>()
    data.scopedApplications.forEach((application) => {
      const key = text(application.programName, 'No programme')
      const entry = map.get(key) || { submitted: 0, accepted: 0 }
      entry.submitted += 1
      if (isAccepted(application)) entry.accepted += 1
      map.set(key, entry)
    })
    return map
  }
  const programmes = byProgramme(current)
  const programmesBefore = byProgramme(previous)
  const trendNow = series(range, current.scopedApplications.map(primaryApplicationDate))
  const trendBefore = series(previousRange, previous.scopedApplications.map(primaryApplicationDate))
  const pending = current.scopedApplications.filter((application) => ['pending', 'submitted', 'in review', 'under review', 'review'].includes(normalize(application.applicationStatus || application.status))).length

  return {
    key: 'intake',
    dimensions: [
      {
        key: 'programme',
        label: 'Programme',
        unit: 'count',
        rows: Array.from(programmes.entries()).sort((a, b) => b[1].submitted - a[1].submitted).map(([label, entry]) => ({
          key: label, label, value: entry.accepted, previous: programmesBefore.get(label)?.accepted ?? 0, detail: `${entry.accepted} of ${entry.submitted}`,
        })),
      },
      { key: 'area', label: 'Requested area', unit: 'count', rows: rowsFrom(tally(current.scopedApplications, requestedAreas), tally(previous.scopedApplications, requestedAreas)) },
      {
        key: 'month',
        label: 'Period',
        unit: 'count',
        rows: trendNow.labels.map((label, index) => ({ key: label, label, value: trendNow.counts[index], previous: trendBefore.counts[index] ?? 0 })),
      },
    ],
    trend: { labels: trendNow.labels, current: trendNow.counts, previous: lineUp(trendNow.counts, trendBefore.counts), series: 'Applications submitted', unit: 'count' },
    table: {
      title: 'Applications',
      columns: [{ key: 'sme', label: 'SME' }, { key: 'programme', label: 'Programme' }, { key: 'areas', label: 'Requested areas' }, { key: 'status', label: 'Status', status: true }, { key: 'submitted', label: 'Submitted' }],
      rows: current.scopedApplications.map((application) => {
        const date = primaryApplicationDate(application)
        const areas = [...new Set(requestedAreas(application))]
        const bucket = trendNow.labels.find((_, index) => date && !dayjs(date).isBefore(bucketRange(range)[index].range[0]) && !dayjs(date).isAfter(bucketRange(range)[index].range[1]))
        return {
          key: application.id,
          cells: {
            sme: smeName(application),
            programme: text(application.programName, '—'),
            areas: areas.join(', ') || '—',
            status: isAccepted(application) ? 'Accepted' : text(application.applicationStatus || application.status, 'Pending').replace(/\b\w/g, (letter) => letter.toUpperCase()),
            submitted: date ? dayjs(date).format('D MMM YYYY') : '—',
          },
          matches: [text(application.programName, 'No programme'), ...areas, ...(bucket ? [bucket] : [])],
        }
      }),
    },
    followUp: { kind: 'decisions', count: pending, path: '/shared/applications' },
  }
}

const statusOf = (assignment: AssignmentDoc) => {
  if (isCompletedAssignment(assignment)) return 'Completed'
  const due = toDate(assignment.dueDate)
  if (due && dayjs(due).isBefore(dayjs(), 'day')) return 'Overdue'
  return isInProgressAssignment(assignment) ? 'In progress' : 'Not started'
}

const deliveryTab = ({ range, previousRange, current, delivery, previousDelivery, records, scope }: Input): AnalyticsTab => {
  const scopedIds = new Set(current.scopedAssignments.map((assignment) => assignment.id))
  // Completions dated within each period (any assignment in scope), for the trend.
  const completions = (period: [Dayjs, Dayjs]) => records.assignments
    .filter((assignment) => matchesActiveProgram(scope.user, scope.activeProgramId, text(assignment.programId)))
    .filter((assignment) => isAssignmentCompleted(assignment as Record<string, unknown>))
    .map(completedOn)
    .filter((date) => date && !dayjs(date).isBefore(period[0]) && !dayjs(date).isAfter(period[1]))
  const trendNow = series(range, completions(range))
  const trendBefore = series(previousRange, completions(previousRange))

  return {
    key: 'delivery',
    dimensions: [
      { key: 'area', label: 'Area', unit: 'percent', rows: rateRows(delivery.byArea, previousDelivery.byArea, 'required') },
      { key: 'owner', label: 'Facilitator / agent', unit: 'percent', rows: rateRows(delivery.byOwner, previousDelivery.byOwner, 'assigned') },
      { key: 'programme', label: 'Programme', unit: 'percent', rows: rateRows(delivery.byProgramme, previousDelivery.byProgramme, 'required') },
    ],
    trend: { labels: trendNow.labels, current: trendNow.counts, previous: lineUp(trendNow.counts, trendBefore.counts), series: 'Interventions completed', unit: 'count' },
    table: {
      title: 'Interventions',
      columns: [{ key: 'intervention', label: 'Intervention' }, { key: 'sme', label: 'SME' }, { key: 'owner', label: 'Owner' }, { key: 'area', label: 'Area' }, { key: 'status', label: 'Status', status: true }],
      rows: current.scopedAssignments.filter((assignment) => scopedIds.has(assignment.id)).map((assignment) => {
        const owner = deliveryOwnerFor(assignment)
        const area = areaOf(assignment.areaOfSupport || assignment.area)
        return {
          key: assignment.id,
          cells: { intervention: text(assignment.interventionTitle || assignment.title, 'Intervention'), sme: smeName(assignment), owner: owner.name, area, status: statusOf(assignment) },
          matches: [area, owner.name, text(assignment.programName, 'No programme')],
        }
      }),
    },
    followUp: { kind: 'overdue', count: current.overdueAssignments.length, path: '/operations/interventions/monitoring?health=overdue' },
  }
}

const attendanceOf = (attendance: Record<string, string> | undefined) => {
  const values = Object.values(attendance || {}).map(normalize)
  return values.includes('present') ? 'Attended' : values.includes('absent') ? 'Absent' : 'Not captured'
}

const appointmentsTab = ({ range, previousRange, current, previous }: Input): AnalyticsTab => {
  const ownerNames = new Map<string, string>()
  ;[...current.scopedAssignments, ...previous.scopedAssignments].forEach((assignment) => {
    const id = text((assignment as AssignmentDoc & { assigneeId?: string }).assigneeId)
    if (id && assignment.assigneeName) ownerNames.set(id, text(assignment.assigneeName))
  })
  const ownerOf = (appointment: ReportData['scopedAppointments'][number]) => ownerNames.get(text(appointment.assigneeId)) || text(appointment.assigneeEmail, 'Unassigned')
  const typeOf = (appointment: ReportData['scopedAppointments'][number]) => text(appointment.meetingType, 'Unspecified').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
  const rates = (data: ReportData, keyOf: (appointment: ReportData['scopedAppointments'][number]) => string) => {
    const map = new Map<string, { attended: number, held: number }>()
    data.scopedAppointments.forEach((appointment) => {
      const status = attendanceOf(appointment.attendance)
      if (status === 'Not captured') return
      const key = keyOf(appointment)
      const entry = map.get(key) || { attended: 0, held: 0 }
      entry.held += 1
      if (status === 'Attended') entry.attended += 1
      map.set(key, entry)
    })
    return map
  }
  const rateDimension = (key: string, label: string, keyOf: (appointment: ReportData['scopedAppointments'][number]) => string): Dimension => {
    const now = rates(current, keyOf)
    const before = rates(previous, keyOf)
    return {
      key,
      label,
      unit: 'percent',
      rows: Array.from(now.entries()).sort((a, b) => b[1].held - a[1].held).map(([name, entry]) => {
        const prior = before.get(name)
        return { key: name, label: name, value: percent(entry.attended, entry.held), previous: prior ? percent(prior.attended, prior.held) : null, detail: `${entry.attended} of ${entry.held}` }
      }),
    }
  }
  const held = (data: ReportData) => data.scopedAppointments.filter((appointment) => attendanceOf(appointment.attendance) !== 'Not captured').map((appointment) => toDate(appointment.startTime))
  const trendNow = series(range, held(current))
  const trendBefore = series(previousRange, held(previous))

  return {
    key: 'appointments',
    dimensions: [rateDimension('owner', 'Facilitator', ownerOf), rateDimension('type', 'Type', typeOf)],
    trend: { labels: trendNow.labels, current: trendNow.counts, previous: lineUp(trendNow.counts, trendBefore.counts), series: 'Sessions held', unit: 'count' },
    table: {
      title: 'Sessions',
      columns: [{ key: 'date', label: 'Date' }, { key: 'sme', label: 'SME' }, { key: 'intervention', label: 'Intervention' }, { key: 'facilitator', label: 'Facilitator' }, { key: 'type', label: 'Type' }, { key: 'attendance', label: 'Attendance', status: true }],
      rows: current.scopedAppointments
        .map((appointment) => ({ appointment, date: toDate(appointment.startTime) }))
        .sort((a, b) => (b.date?.valueOf() || 0) - (a.date?.valueOf() || 0))
        .map(({ appointment, date }) => ({
          key: appointment.id,
          cells: {
            date: date ? dayjs(date).format('D MMM YYYY') : '—',
            sme: text(appointment.participantName || appointment.participantEmail, 'SME'),
            intervention: text(appointment.interventionTitle, '—'),
            facilitator: ownerOf(appointment),
            type: typeOf(appointment),
            attendance: attendanceOf(appointment.attendance),
          },
          matches: [ownerOf(appointment), typeOf(appointment), appointmentStatusLabel(text(appointment.status))],
        })),
    },
    followUp: { kind: 'attendance', count: current.attendanceRows.filter((row) => row.attendance === 'Not captured').length, path: '/shared/interventions/appointments' },
  }
}

const OWNERSHIP: Array<[keyof ParticipantDoc, string]> = [['blackOwnedPercent', 'Black-owned'], ['femaleOwnedPercent', 'Female-owned'], ['youthOwnedPercent', 'Youth-owned']]

const smesTab = ({ range, current, records }: Input): AnalyticsTab => {
  const participants = current.scopedParticipants
  const count = participants.length
  const joined = participants.map((participant) => toDate(participant.acceptedAt) || toDate(participant.onboardedAt) || toDate(participant.approvedAt) || toDate(participant.createdAt))
  const trendNow = series(range, joined)
  // Compliance documents needing follow-up, per SME (documents live on the SME's application).
  const attentionBySme = new Map<string, number>()
  if (current.complianceDocuments.length) records.applications.forEach((application) => {
    const needs = (application.complianceDocuments || []).filter((document) => complianceStatusLabel(text(document.status, 'pending')) !== 'Valid').length
    if (needs) attentionBySme.set(text(application.participantId), needs)
  })
  const field = (participant: ParticipantDoc, key: 'sector' | 'gender' | 'beeLevel') => text(participant[key], 'Unspecified')

  return {
    key: 'smes',
    dimensions: [
      {
        key: 'ownership',
        label: 'Ownership',
        unit: 'percent',
        rows: count ? OWNERSHIP.map(([key, label]) => ({
          key: label, label, value: Math.round(participants.reduce((sum, participant) => sum + (Number(participant[key]) || 0), 0) / count), previous: null,
        })) : [],
      },
      { key: 'gender', label: 'Gender', unit: 'count', rows: rowsFrom(tally(participants, (participant) => field(participant, 'gender')), null) },
      { key: 'bee', label: 'B-BBEE level', unit: 'count', rows: rowsFrom(tally(participants, (participant) => field(participant, 'beeLevel')), null) },
      { key: 'sector', label: 'Sector', unit: 'count', rows: rowsFrom(tally(participants, (participant) => field(participant, 'sector')), null) },
    ],
    trend: { labels: trendNow.labels, current: trendNow.counts, previous: trendNow.counts.map(() => 0), series: 'SMEs joining', unit: 'count' },
    table: {
      title: 'SMEs',
      columns: [{ key: 'sme', label: 'SME' }, { key: 'sector', label: 'Sector' }, { key: 'gender', label: 'Gender' }, { key: 'bee', label: 'B-BBEE' }, { key: 'compliance', label: 'Compliance', status: true }],
      rows: participants.map((participant) => {
        const needs = attentionBySme.get(participant.id) || attentionBySme.get(text(participant.participantId)) || 0
        return {
          key: participant.id,
          cells: {
            sme: smeName(participant),
            sector: field(participant, 'sector'),
            gender: field(participant, 'gender'),
            bee: field(participant, 'beeLevel'),
            compliance: needs ? `${needs} to follow up` : 'Up to date',
          },
          matches: [field(participant, 'sector'), field(participant, 'gender'), field(participant, 'beeLevel')],
        }
      }),
    },
    followUp: { kind: 'compliance', count: current.complianceAttention.length, path: '/operations/participants/compliance' },
  }
}

const growthOf = (smes: SmeImpact[]) => {
  const rows = smes.filter((sme) => sme.revenueStart !== null && sme.revenueLatest !== null)
  const start = rows.reduce((sum, sme) => sum + (sme.revenueStart || 0), 0)
  const latest = rows.reduce((sum, sme) => sum + (sme.revenueLatest || 0), 0)
  return start > 0 ? Math.round(((latest - start) / start) * 100) : null
}

const growthTab = ({ impact, records, revenueTrend }: Input, programmeNames: Map<string, string>): AnalyticsTab => {
  const smes = impact?.smes || []
  const sectorOf = new Map(records.participants.map((participant) => [participant.id, text(participant.sector, 'Unspecified')]))
  const grouped = (keyOf: (sme: SmeImpact) => string) => {
    const groups = new Map<string, SmeImpact[]>()
    smes.forEach((sme) => groups.set(keyOf(sme), [...(groups.get(keyOf(sme)) || []), sme]))
    return Array.from(groups.entries())
      .map(([label, rows]) => ({ label, growth: growthOf(rows), size: rows.length }))
      .filter((row) => row.growth !== null)
      .sort((a, b) => (b.growth as number) - (a.growth as number))
      .map((row) => ({ key: row.label, label: row.label, value: row.growth as number, previous: null, detail: `${row.size} SMEs` }))
  }
  const programmeOf = (sme: SmeImpact) => programmeNames.get(sme.programId) || 'No programme'

  return {
    key: 'growth',
    dimensions: [
      { key: 'programme', label: 'Programme', unit: 'growth', rows: grouped(programmeOf) },
      { key: 'sector', label: 'Sector', unit: 'growth', rows: grouped((sme) => sectorOf.get(sme.id) || 'Unspecified') },
      { key: 'support', label: 'Support received', unit: 'growth', rows: grouped((sme) => (sme.completedInterventions > 0 ? 'With completed support' : 'None completed yet')) },
    ],
    trend: { labels: revenueTrend.labels, current: revenueTrend.current, previous: revenueTrend.previous, series: 'Revenue', unit: 'currency' },
    table: {
      title: 'SMEs by growth',
      columns: [{ key: 'sme', label: 'SME' }, { key: 'programme', label: 'Programme' }, { key: 'revenue', label: 'Revenue' }, { key: 'change', label: 'Change' }, { key: 'jobs', label: 'Jobs' }],
      rows: smes.map((sme) => ({
        key: sme.id,
        cells: {
          sme: sme.name,
          programme: programmeOf(sme),
          revenue: sme.revenueLatest === null ? 'Not recorded' : `${sme.revenueStart !== null ? `R ${Math.round(sme.revenueStart).toLocaleString('en-ZA')} → ` : ''}R ${Math.round(sme.revenueLatest).toLocaleString('en-ZA')}`,
          change: sme.revenueChange === null ? '—' : `${sme.revenueChange > 0 ? '+' : ''}${sme.revenueChange}%`,
          jobs: sme.jobsChange === null ? '—' : `${sme.jobsChange > 0 ? '+' : ''}${sme.jobsChange}`,
        },
        matches: [programmeOf(sme), sectorOf.get(sme.id) || 'Unspecified', sme.completedInterventions > 0 ? 'With completed support' : 'None completed yet'],
      })),
    },
    followUp: { kind: 'impact', count: 0, path: '/operations/impact-analysis' },
  }
}

export const buildAnalyticsTabs = (input: Input, programmeNames: Map<string, string>): Record<TabKey, AnalyticsTab> => ({
  intake: intakeTab(input),
  delivery: deliveryTab(input),
  appointments: appointmentsTab(input),
  smes: smesTab(input),
  growth: growthTab(input, programmeNames),
})

/** The rows of a table as CSV (Excel opens it). */
export const tableCsv = (columns: TableColumn[], rows: TableRow[]) => {
  const cell = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value)
  return [columns.map((column) => cell(column.label)).join(','), ...rows.map((row) => columns.map((column) => cell(row.cells[column.key] || '')).join(','))].join('\n')
}
