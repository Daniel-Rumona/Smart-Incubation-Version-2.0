import dayjs, { type Dayjs } from 'dayjs'
import { isAssignmentCompleted, listDirectorPortfolio } from '@/services/directorPortfolioService'
import { ALL_IMPLEMENTORS, getDocsInScope, isOrgFunder, loadDataScope, type ScopeEntry } from '@/services/funderScopeService'
import { computeActual, listKpis, periodFor, statusFor, targetFor, type KpiStatus } from '@/services/kpiService'
import { listWorkspacePrograms, matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { DirectorPortfolioSme } from '@/types/director'
import type { FullIdentity } from '@/types/identity'
import type { Kpi } from '@/types/kpi'

/**
 * Everything the funder pages show, limited to the funder's linked programmes (users.assignedProgramIds; none = all
 * the company's; for a funder organisation, every implementor's programmes its active links cover, see
 * funderScopeService), the implementor chosen (organisation funders) and the programme chosen in the selector. Figures are processed here: the pages get totals, rates,
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

/** The funder pages' one rule for "behind": an SME with this many interventions past their due date, or more. */
export const BEHIND_OVERDUE = 2
export const isBehind = (sme: DirectorPortfolioSme) => sme.execution.overdue >= BEHIND_OVERDUE

/** Revenue growth and net jobs since joining, as Impact analysis counts them: each SME's first figure against its latest. */
const growthSinceJoining = (smes: DirectorPortfolioSme[]) => {
  const withRevenue = smes.filter((row) => row.growth?.revenue)
  const start = withRevenue.reduce((sum, row) => sum + (row.growth?.revenue?.start || 0), 0)
  const latest = withRevenue.reduce((sum, row) => sum + (row.growth?.revenue?.latest || 0), 0)
  const withJobs = smes.filter((row) => row.growth?.jobs)
  return {
    revenueGrowth: start > 0 ? Math.round(((latest - start) / start) * 100) : null,
    growingSmes: withRevenue.filter((row) => (row.growth?.revenue?.latest || 0) > (row.growth?.revenue?.start || 0)).length,
    smesWithRevenue: withRevenue.length,
    netJobs: withJobs.reduce((sum, row) => sum + ((row.growth?.jobs?.latest || 0) - (row.growth?.jobs?.start || 0)), 0),
    smesWithJobs: withJobs.length,
  }
}

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
  /** The implementor running it (always set for funder organisations). */
  companyCode?: string
  companyName?: string
  smes: number
  /** Delivery, on the dashboard's rule: required interventions completed. */
  required: number
  completed: number
  delivery: number | null
  revenueGrowth: number | null
  growingSmes: number
  smesWithRevenue: number
  netJobs: number
  smesWithJobs: number
  /** Jobs now, across the programme's SMEs. */
  employees: number
  /** Of completed interventions with a due date, the share finished by it. */
  onTimeRate: number | null
  /** Completed interventions with a due date, behind onTimeRate, for weighting across programmes. */
  timed: number
  overdue: number
  behind: number
}

/** The dashboard's four answers. Delivery is completed against required (the director dashboard's rule); growth and
 * jobs are since joining, as Impact analysis counts them. */
export type FunderSummary = {
  delivery: { required: number; completed: number; rate: number | null; previousRate: number | null }
  joinedRecently: number
  revenueGrowth: number | null
  growingSmes: number
  smesWithRevenue: number
  netJobs: number
  smesWithJobs: number
  /** The current month, while SMEs are still reporting it. */
  reporting: { key: string; label: string; reported: number; total: number }
}

/** A KPI belongs to one implementor (its company), so a funder organisation sees each implementor's separately, never added together. */
export type FunderKpi = { kpi: Kpi; actual: number | null; detail?: string; target: number | null; status: KpiStatus; periodLabel: string; companyCode: string; companyName: string }

const ADDITIVE_UNITS = new Set<Kpi['unit']>(['count', 'currency', 'number'])

/**
 * The target a funder sees for one implementor's KPI. A chosen programme uses its own target (or the company's). For a
 * funder organisation looking at all its programmes at that implementor: one programme, that programme's target; several,
 * their targets added up for counts and amounts when every one has a target, or the company's target for rates, days and
 * ratings (a rate target holds across programmes); otherwise none, rather than the company's whole-company count.
 */
export const funderKpiTarget = (kpi: Kpi, programmeId: string | null, entry: ScopeEntry, orgFunder: boolean) => {
  if (programmeId || !orgFunder || entry.programIds === null) return targetFor(kpi, programmeId)?.value ?? null
  if (entry.programIds.length === 1) return targetFor(kpi, entry.programIds[0])?.value ?? null
  if (!ADDITIVE_UNITS.has(kpi.unit)) return kpi.target
  const targets = entry.programIds.map((id) => kpi.programTargets[id])
  return targets.every((value) => typeof value === 'number') ? targets.reduce((sum, value) => sum + value, 0) : null
}

/** The Analytics page's charts. Delivery is completed against required throughout, as on the dashboard. */
export type FunderAnalytics = {
  /** Last 12 months: the interventions due in each month, by what happened to them. */
  dueMonths: Array<{ key: string; label: string; onTime: number; late: number; open: number }>
  /** Of completed interventions with a due date, the share finished by it. */
  onTimeRate: number | null
  /** SMEs by their own required support done. */
  progressBands: Array<{ label: string; from: number; to: number; smes: number }>
  /** One point per SME with required support: support done against revenue change since joining (null without two figures). */
  supportGrowth: Array<{ id: string; name: string; delivery: number; revenueChange: number | null }>
  /** Required interventions per area of support, and how many are done. */
  areas: Array<{ area: string; required: number; completed: number; rate: number }>
}

export type FunderData = {
  analytics: FunderAnalytics
  portfolio: DirectorPortfolioSme[]
  programmes: FunderProgramme[]
  months: FunderMonth[]
  activity: FunderActivity[]
  appointments: FunderAppointment[]
  kpis: FunderKpi[]
  summary: FunderSummary
  totals: { smes: number; avgProgress: number; revenue: number; employees: number; completed: number; overdue: number }
}

const MEETING_TYPES = ['telephonic', 'online', 'in_person'] as const
const STATUSES = ['pending', 'accepted', 'declined', 'cancelled', 'completed'] as const

export const loadFunderData = async (user: FullIdentity, activeProgramId?: string, implementor: string = ALL_IMPLEMENTORS): Promise<FunderData> => {
  const orgFunder = isOrgFunder(user)
  const scope = await loadDataScope(user, implementor)
  // A funder organisation with no active links yet loads as empty (its pages show the requests waiting for it).
  if (!scope.length && !orgFunder) throw new Error('No company on this account.')
  const scopeCompanies = new Set(scope.map((entry) => entry.companyCode))
  const inScope = (programId: unknown) => matchesActiveProgram(user, activeProgramId || 'all', text(programId))

  const [portfolio, assignmentDocs, appointmentDocs, allProgrammes, kpiLists, applicationDocs] = await Promise.all([
    listDirectorPortfolio(user, activeProgramId, scope),
    getDocsInScope(scope, 'assignedInterventions'),
    getDocsInScope(scope, 'appointments').catch(() => []),
    listWorkspacePrograms(user),
    Promise.all(scope.map((entry) => listKpis(entry.companyCode).catch(() => [] as Kpi[]))),
    // Required support per area of support (Analytics); funders may read their programmes' applications.
    getDocsInScope(scope, 'applications').catch((error) => { console.error(error); return [] }),
  ])
  const companyNameOf = new Map(scope.map((entry) => [entry.companyCode, entry.companyName]))
  const programmes = orgFunder ? allProgrammes.filter((row) => !!row.companyCode && scopeCompanies.has(row.companyCode)) : allProgrammes
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

  // Recent milestones, newest first: completions and meetings held (the 25 newest), plus every SME that is behind.
  const newest = (rows: FunderActivity[]) => rows.filter((row) => !row.at.isAfter(dayjs())).sort((left, right) => right.at.valueOf() - left.at.valueOf())
  const milestones = newest([
    ...assignments.flatMap((row) => {
      const at = isAssignmentCompleted(row) ? toDay(row.completedAt || row.updatedAt) : null
      return at ? [{ id: `c-${row.id}`, at, smeName: smeName.get(text(row.participantId)) || 'SME', programName: programmeName.get(text(row.programId)) || '', kind: 'completed' as const, detail: text(row.interventionTitle || row.title) || 'Intervention' }] : []
    }),
    ...appointmentRows.flatMap((row) => {
      const at = text(row.status).toLowerCase() === 'completed' ? toDay(row.startTime) : null
      return at ? [{ id: `m-${row.id}`, at, smeName: text(row.participantName || row.businessName) || 'SME', programName: programmeName.get(text(row.programId)) || '', kind: 'meeting' as const, detail: text(row.interventionTitle || row.title) || 'Meeting' }] : []
    }),
  ]).slice(0, 25)
  // Dated the day after the intervention that made it BEHIND_OVERDUE overdue fell due.
  const behind = newest(portfolio.filter(isBehind).flatMap((row) => {
    const dues = assignments
      .filter((item) => text(item.participantId) === row.id && !isAssignmentCompleted(item))
      .map((item) => toDay(item.dueDate))
      .filter((due): due is Dayjs => !!due && due.isBefore(dayjs(), 'day'))
      .sort((left, right) => left.valueOf() - right.valueOf())
    const at = dues[BEHIND_OVERDUE - 1]?.add(1, 'day') || toDay(row.lastUpdate)
    return at ? [{ id: `r-${row.id}`, at, smeName: row.name, programName: row.programName || '', kind: 'at_risk' as const, detail: `${row.execution.overdue} interventions overdue` }] : []
  }))
  const activity: FunderActivity[] = newest([...milestones, ...behind])

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
      const required = smes.reduce((sum, row) => sum + row.execution.required, 0)
      const completed = smes.reduce((sum, row) => sum + row.execution.completed, 0)
      return {
        id: programme.id,
        name: String(programme.name),
        ...(programme.companyCode ? { companyCode: programme.companyCode, companyName: companyNameOf.get(programme.companyCode) || programme.companyCode } : {}),
        smes: smes.length,
        required,
        completed,
        delivery: required ? Math.min(100, Math.round((completed / required) * 100)) : null,
        ...growthSinceJoining(smes),
        employees: smes.reduce((sum, row) => sum + row.metrics.employees, 0),
        onTimeRate: timed.length ? Math.round((onTime / timed.length) * 100) : null,
        timed: timed.length,
        overdue,
        behind: smes.filter(isBehind).length,
      }
    })

  // Each implementor's KPIs, worked out on the funder's programmes at that implementor only.
  const programmeForTargets = activeProgramId && activeProgramId !== 'all' ? activeProgramId : null
  const kpis: FunderKpi[] = scope.flatMap((entry, index) => {
    const ofCompany = (row: Row) => text(row.companyCode) === entry.companyCode
    const kpiData = { assignments: assignments.filter(ofCompany), appointments: appointmentRows.filter(ofCompany) }
    return kpiLists[index].map((kpi) => {
      const period = periodFor(kpi.cadence)
      const actual = computeActual(kpi, kpiData, period, user, programmeForTargets)
      const target = funderKpiTarget(kpi, programmeForTargets, entry, orgFunder)
      return {
        kpi, actual: actual.value, detail: actual.detail, target, status: statusFor(kpi, actual, target, period).status, periodLabel: period.label,
        companyCode: entry.companyCode, companyName: entry.companyName || entry.companyCode,
      }
    })
  })

  // Delivery now and three months ago: required for the SMEs in the programme by then, against what was completed by then.
  const deliveryAsAt = (asAt: Dayjs) => {
    const smes = portfolio.filter((row) => !row.joinedAt || !dayjs(row.joinedAt).isAfter(asAt))
    const ids = new Set(smes.map((row) => row.id))
    const required = smes.reduce((sum, row) => sum + row.execution.required, 0)
    const completed = assignments.filter((row) => ids.has(text(row.participantId)) && isAssignmentCompleted(row)
      && !(toDay(row.completedAt || row.updatedAt) || dayjs(0)).isAfter(asAt)).length
    return { required, completed, rate: required ? Math.min(100, Math.round((completed / required) * 100)) : null }
  }
  const deliveryNow = deliveryAsAt(dayjs())
  const thisMonth = dayjs().startOf('month')
  const summary: FunderSummary = {
    delivery: { ...deliveryNow, previousRate: deliveryAsAt(dayjs().subtract(3, 'month')).rate },
    joinedRecently: portfolio.filter((row) => row.joinedAt && dayjs(row.joinedAt).isAfter(dayjs().subtract(3, 'month'))).length,
    ...growthSinceJoining(portfolio),
    reporting: {
      key: thisMonth.format('YYYY-MM'),
      label: thisMonth.format('MMMM'),
      reported: portfolio.filter((row) => row.trend.some((point) => point.key === thisMonth.format('YYYY-MM') && (point.revenue || point.employees))).length,
      total: portfolio.length,
    },
  }

  // ---- Analytics ----
  const completedOn = (row: Row) => toDay(row.completedAt || row.completionConfirmedAt || row.updatedAt)
  const dueMonths = monthKeys.map((month) => {
    const due = assignments.filter((row) => toDay(row.dueDate)?.isSame(month, 'month'))
    const done = due.filter(isAssignmentCompleted)
    const late = done.filter((row) => completedOn(row)?.isAfter(toDay(row.dueDate)!, 'day')).length
    return { key: month.format('YYYY-MM'), label: month.format('MMM'), onTime: done.length - late, late, open: due.length - done.length }
  })
  const timedDone = assignments.filter((row) => isAssignmentCompleted(row) && toDay(row.dueDate) && completedOn(row))
  const onTimeDone = timedDone.filter((row) => !completedOn(row)!.isAfter(toDay(row.dueDate)!, 'day')).length
  const withRequired = portfolio.filter((row) => row.execution.required > 0)
  const smeDelivery = (row: DirectorPortfolioSme) => Math.min(100, Math.round((row.execution.completed / row.execution.required) * 100))
  const progressBands = [[0, 25], [25, 50], [50, 75], [75, 101]].map(([from, to]) => ({
    label: `${from}–${Math.min(to, 100)}%`,
    from,
    to,
    smes: withRequired.filter((row) => smeDelivery(row) >= from && smeDelivery(row) < to).length,
  }))
  const supportGrowth = withRequired.map((row) => {
    const revenue = row.growth?.revenue
    return { id: row.id, name: row.name, delivery: smeDelivery(row), revenueChange: revenue && revenue.start > 0 ? Math.round(((revenue.latest - revenue.start) / revenue.start) * 100) : null }
  })
  // Required per area from the SMEs' applications; done = completed assignments in that area.
  const areaOf = (value: unknown) => text(value) || 'Other'
  const areaMap = new Map<string, { required: number; completed: number }>()
  const bump = (area: string, field: 'required' | 'completed') => {
    const entry = areaMap.get(area) || { required: 0, completed: 0 }
    entry[field] += 1
    areaMap.set(area, entry)
  }
  applicationDocs.forEach((doc) => {
    const data = doc.data() as Row
    if (!smeIds.has(text(data.participantId) || doc.id) || !inScope(data.programId)) return
    const required = ((data.interventions as { required?: unknown } | undefined)?.required || data.interventionsRequired || data.requiredInterventions || []) as Row[]
    if (Array.isArray(required)) required.forEach((item) => bump(areaOf(item?.areaOfSupport || item?.area), 'required'))
  })
  assignments.filter(isAssignmentCompleted).forEach((row) => bump(areaOf(row.areaOfSupport || row.area), 'completed'))
  const areas = Array.from(areaMap.entries())
    .filter(([, entry]) => entry.required > 0)
    .map(([area, entry]) => ({ area, ...entry, rate: Math.min(100, Math.round((entry.completed / entry.required) * 100)) }))
    .sort((left, right) => left.rate - right.rate)

  return {
    analytics: {
      dueMonths,
      onTimeRate: timedDone.length ? Math.round((onTimeDone / timedDone.length) * 100) : null,
      progressBands,
      supportGrowth,
      areas,
    },
    portfolio,
    programmes: programmeRows,
    summary,
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
