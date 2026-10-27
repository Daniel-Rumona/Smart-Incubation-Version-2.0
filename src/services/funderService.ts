import dayjs, { type Dayjs } from 'dayjs'
import { where } from 'firebase/firestore'
import { getScopedDocs, isAssignmentCompleted, listDirectorPortfolio } from '@/services/directorPortfolioService'
import { computeActual, listKpis, periodFor, statusFor, targetFor, type KpiStatus } from '@/services/kpiService'
import { listWorkspacePrograms, matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { DirectorPortfolioSme } from '@/types/director'
import type { FullIdentity } from '@/types/identity'
import type { Kpi } from '@/types/kpi'

/**
 * Everything the funder pages show, limited to the funder's linked programmes (users.assignedProgramIds; none = all
 * the company's) and the programme chosen in the selector. Figures are processed here: the pages get totals, rates,
 * trends and milestones, not raw records or SME contact details.
 */

type Row = Record<string, unknown> & { id: string }

const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string)
  return parsed.isValid() ? parsed : null
}
const text = (value: unknown) => String(value ?? '').trim()

export type FunderActivity = {
  id: string
  at: Dayjs
  smeName: string
  programName: string
  kind: 'completed' | 'joined' | 'meeting' | 'at_risk'
  detail: string
}

export type FunderAppointment = {
  id: string
  interventionTitle: string
  participantName: string
  meetingType: 'telephonic' | 'online' | 'in_person'
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed'
  startTime?: unknown
  endTime?: unknown
  programName: string
}

export type FunderMonth = { key: string; label: string; revenue: number; employees: number; completed: number; planned: number }

export type FunderProgramme = {
  id: string
  name: string
  smes: number
  avgProgress: number
  revenue: number
  employees: number
  completionRate: number | null
  onTimeRate: number | null
  overdue: number
  highRisk: number
}

export type FunderKpi = { kpi: Kpi; actual: number | null; detail?: string; target: number | null; status: KpiStatus; periodLabel: string }

export type FunderData = {
  portfolio: DirectorPortfolioSme[]
  programmes: FunderProgramme[]
  months: FunderMonth[]
  activity: FunderActivity[]
  appointments: FunderAppointment[]
  kpis: FunderKpi[]
  totals: { smes: number; avgProgress: number; revenue: number; employees: number; completed: number; overdue: number }
}

const MEETING_TYPES = ['telephonic', 'online', 'in_person'] as const
const STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'completed'] as const

export const loadFunderData = async (user: FullIdentity, activeProgramId?: string): Promise<FunderData> => {
  const companyCode = text(user.companyCode)
  if (!companyCode) throw new Error('No company on this account.')
  const company = where('companyCode', '==', companyCode)
  const inScope = (programId: unknown) => matchesActiveProgram(user, activeProgramId || 'all', text(programId))

  const [portfolio, assignmentDocs, appointmentDocs, programmes, kpiList] = await Promise.all([
    listDirectorPortfolio(user, activeProgramId),
    getScopedDocs(user, 'assignedInterventions', [company]),
    getScopedDocs(user, 'appointments', [company]).catch(() => []),
    listWorkspacePrograms(user),
    listKpis(companyCode).catch(() => [] as Kpi[]),
  ])
  const programmeName = new Map(programmes.map((row) => [row.id, String(row.name)]))
  const smeIds = new Set(portfolio.map((row) => row.id))
  const smeName = new Map(portfolio.map((row) => [row.id, row.name]))

  const assignments: Row[] = assignmentDocs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Row))
    .filter((row) => inScope(row.programId) && smeIds.has(text(row.participantId)))
  const appointmentRows: Row[] = appointmentDocs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Row))
    .filter((row) => inScope(row.programId))

  // Monthly series: portfolio revenue and jobs from SME reporting, support completed against what was due.
  const monthKeys = Array.from({ length: 12 }, (_, index) => dayjs().startOf('month').subtract(11 - index, 'month'))
  const months: FunderMonth[] = monthKeys.map((month) => {
    const key = month.format('YYYY-MM')
    const revenue = portfolio.reduce((sum, row) => sum + (row.trend.find((point) => point.key === key)?.revenue || 0), 0)
    const employees = portfolio.reduce((sum, row) => sum + (row.trend.find((point) => point.key === key)?.employees || 0), 0)
    const completed = assignments.filter((row) => isAssignmentCompleted(row) && toDay(row.completedAt || row.updatedAt)?.isSame(month, 'month')).length
    const planned = assignments.filter((row) => toDay(row.dueDate)?.isSame(month, 'month')).length
    return { key, label: month.format('MMM'), revenue, employees, completed, planned }
  })

  // Recent milestones, newest first: completions, people joining, meetings held, SMEs flagged at risk.
  const activity: FunderActivity[] = [
    ...assignments.flatMap((row) => {
      const at = isAssignmentCompleted(row) ? toDay(row.completedAt || row.updatedAt) : null
      return at ? [{ id: `c-${row.id}`, at, smeName: smeName.get(text(row.participantId)) || 'SME', programName: programmeName.get(text(row.programId)) || '', kind: 'completed' as const, detail: text(row.interventionTitle || row.title) || 'Intervention' }] : []
    }),
    ...portfolio.flatMap((row) => {
      const joined = toDay(row.lastUpdate)
      return row.risk === 'High' && joined ? [{ id: `r-${row.id}`, at: joined, smeName: row.name, programName: row.programName || '', kind: 'at_risk' as const, detail: row.execution.overdue ? `${row.execution.overdue} interventions overdue` : 'Low progress or growth' }] : []
    }),
    ...appointmentRows.flatMap((row) => {
      const at = text(row.status).toLowerCase() === 'completed' ? toDay(row.startTime) : null
      return at ? [{ id: `m-${row.id}`, at, smeName: text(row.participantName || row.businessName) || 'SME', programName: programmeName.get(text(row.programId)) || '', kind: 'meeting' as const, detail: text(row.interventionTitle || row.title) || 'Meeting' }] : []
    }),
  ].filter((row) => !row.at.isAfter(dayjs())).sort((left, right) => right.at.valueOf() - left.at.valueOf()).slice(0, 25)

  // The calendar never carries meeting links or contact details.
  const appointments: FunderAppointment[] = appointmentRows.map((row) => {
    const meetingType = text(row.meetingType).toLowerCase()
    const status = text(row.status || 'pending').toLowerCase()
    return {
      id: row.id,
      interventionTitle: text(row.interventionTitle || row.title) || 'Meeting',
      participantName: text(row.participantName || row.businessName) || 'SME',
      meetingType: (MEETING_TYPES as readonly string[]).includes(meetingType) ? meetingType as FunderAppointment['meetingType'] : 'in_person',
      status: (STATUSES as readonly string[]).includes(status) ? status as FunderAppointment['status'] : 'pending',
      startTime: row.startTime,
      endTime: row.endTime,
      programName: programmeName.get(text(row.programId)) || '',
    }
  })

  const programmeRows: FunderProgramme[] = programmes
    .filter((programme) => inScope(programme.id))
    .map((programme) => {
      const smes = portfolio.filter((row) => row.programId === programme.id)
      const rows = assignments.filter((row) => text(row.programId) === programme.id)
      const done = rows.filter(isAssignmentCompleted)
      const timed = done.filter((row) => toDay(row.dueDate) && toDay(row.completedAt))
      const onTime = timed.filter((row) => !toDay(row.completedAt)!.isAfter(toDay(row.dueDate)!, 'day')).length
      const overdue = rows.filter((row) => !isAssignmentCompleted(row) && toDay(row.dueDate)?.isBefore(dayjs(), 'day')).length
      return {
        id: programme.id,
        name: String(programme.name),
        smes: smes.length,
        avgProgress: smes.length ? Math.round(smes.reduce((sum, row) => sum + row.progress, 0) / smes.length) : 0,
        revenue: smes.reduce((sum, row) => sum + row.metrics.revenue, 0),
        employees: smes.reduce((sum, row) => sum + row.metrics.employees, 0),
        completionRate: rows.length ? Math.round((done.length / rows.length) * 100) : null,
        onTimeRate: timed.length ? Math.round((onTime / timed.length) * 100) : null,
        overdue,
        highRisk: smes.filter((row) => row.risk === 'High').length,
      }
    })

  // Company KPIs, worked out on the funder's programmes only.
  const kpiData = { assignments, appointments: appointmentRows }
  const programmeForTargets = activeProgramId && activeProgramId !== 'all' ? activeProgramId : null
  const kpis: FunderKpi[] = kpiList.map((kpi) => {
    const period = periodFor(kpi.cadence)
    const actual = computeActual(kpi, kpiData, period, user, programmeForTargets)
    const target = targetFor(kpi, programmeForTargets)
    return { kpi, actual: actual.value, detail: actual.detail, target: target?.value ?? null, status: statusFor(kpi, actual, target?.value ?? null, period).status, periodLabel: period.label }
  })

  return {
    portfolio,
    programmes: programmeRows,
    months,
    activity,
    appointments,
    kpis,
    totals: {
      smes: portfolio.length,
      avgProgress: portfolio.length ? Math.round(portfolio.reduce((sum, row) => sum + row.progress, 0) / portfolio.length) : 0,
      revenue: portfolio.reduce((sum, row) => sum + row.metrics.revenue, 0),
      employees: portfolio.reduce((sum, row) => sum + row.metrics.employees, 0),
      completed: assignments.filter(isAssignmentCompleted).length,
      overdue: assignments.filter((row) => !isAssignmentCompleted(row) && toDay(row.dueDate)?.isBefore(dayjs(), 'day')).length,
    },
  }
}
