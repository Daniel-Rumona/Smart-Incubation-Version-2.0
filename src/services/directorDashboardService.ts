import type { FullIdentity } from '@/types/identity'
import { listDirectorPortfolio } from '@/services/directorPortfolioService'
import { listDirectorProgramPerformance } from '@/services/directorProgramsService'
import { loadImpactAnalytics, type SmeImpact } from '@/services/impactAnalyticsService'
import { computeActual, listKpis, loadKpiData, periodFor, statusFor, targetFor, type KpiData } from '@/services/kpiService'
import type { Kpi } from '@/types/kpi'

/**
 * The director's one-screen briefing: growth, KPIs and delivery for the active programme (or all of them), one row
 * per programme, and a short list of what needs attention. Built from the loaders the other director pages use, so
 * the figures match Portfolio, Programme performance, Impact analysis and KPIs.
 * Figures and names stay English; the page translates labels when it shows them.
 */

export type KpiTally = { onTrack: number, behind: number, withTarget: number, behindNames: string[] }

/** One KPI with a target, for the single-programme view: behind first, then on track and met, then no data yet. */
export type KpiStatusItem = { id: string, name: string, status: 'behind' | 'on_track' | 'met' | 'no_data', periodLabel: string }

export type DirectorProgrammeRow = {
  id: string
  name: string
  status: string
  startDate?: string
  endDate?: string
  submitted: number
  accepted: number
  smes: number
  required: number
  completed: number
  /** Completed against required, 0–100; null when nothing is required yet. */
  completion: number | null
  overdue: number
  highRisk: number
  mediumRisk: number
  lowRisk: number
  totalEmployees: number
  totalRevenue: number
  avgProgress: number
  revenueGrowth: number | null
  revenueStart: number
  revenueLatest: number
  growingSmes: number
  smesWithRevenue: number
  kpis: KpiTally
}

export type AttentionKey = 'overdue' | 'kpis_behind' | 'low_completion' | 'unresponsive' | 'high_risk'

export type AttentionItem = {
  key: AttentionKey
  count: number
  /** The programme it concerns, when it is about one programme. */
  programme?: string
  /** A few names to make the sentence concrete (KPI names). */
  names?: string[]
  path: string
}

export type DirectorBriefing = {
  revenueGrowth: number | null
  growingSmes: number
  smesWithRevenue: number
  netJobs: number
  smesWithJobs: number
  kpis: KpiTally
  kpiItems: KpiStatusItem[]
  required: number
  completed: number
  completion: number | null
  programmes: DirectorProgrammeRow[]
  attention: AttentionItem[]
}

// A programme below this share of its required support is called out.
const LOW_COMPLETION = 40
const MAX_ATTENTION = 5

const percent = (num: number, den: number) => (den > 0 ? Math.min(100, Math.round((num / den) * 100)) : null)

const growthOf = (smes: SmeImpact[]) => {
  const withRevenue = smes.filter((sme) => sme.revenueStart !== null && sme.revenueLatest !== null)
  const start = withRevenue.reduce((sum, sme) => sum + (sme.revenueStart || 0), 0)
  const latest = withRevenue.reduce((sum, sme) => sum + (sme.revenueLatest || 0), 0)
  return {
    growth: start > 0 ? Math.round(((latest - start) / start) * 100) : null,
    start,
    latest,
    withRevenue: withRevenue.length,
    growing: withRevenue.filter((sme) => (sme.revenueLatest || 0) > (sme.revenueStart || 0)).length,
  }
}

const tallyKpis = (kpis: Kpi[], data: KpiData, user: FullIdentity, programId: string | null): KpiTally => {
  const tally: KpiTally = { onTrack: 0, behind: 0, withTarget: 0, behindNames: [] }
  kpis.forEach((kpi) => {
    const target = targetFor(kpi, programId)
    if (!target) return
    const period = periodFor(kpi.cadence)
    const { status } = statusFor(kpi, computeActual(kpi, data, period, user, programId), target.value, period)
    if (status === 'no_data') return
    tally.withTarget += 1
    if (status === 'behind') {
      tally.behind += 1
      tally.behindNames.push(kpi.name)
    } else {
      tally.onTrack += 1
    }
  })
  return tally
}

const STATUS_ORDER: Record<KpiStatusItem['status'], number> = { behind: 0, on_track: 1, met: 2, no_data: 3 }

const listKpiStatuses = (kpis: Kpi[], data: KpiData, user: FullIdentity, programId: string | null): KpiStatusItem[] =>
  kpis.flatMap((kpi) => {
    const target = targetFor(kpi, programId)
    if (!target) return []
    const period = periodFor(kpi.cadence)
    const { status } = statusFor(kpi, computeActual(kpi, data, period, user, programId), target.value, period)
    if (status === 'no_target') return []
    return [{ id: kpi.id, name: kpi.name, status, periodLabel: period.label }]
  }).sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.name.localeCompare(b.name))

export const loadDirectorBriefing = async (
  user: FullIdentity,
  { activeProgramId, isAllPrograms }: { activeProgramId: string, isAllPrograms: boolean },
): Promise<DirectorBriefing> => {
  const companyCode = String(user.companyCode || '').trim()
  const portfolio = await listDirectorPortfolio(user, activeProgramId)
  const [programmeRows, impact, kpis, kpiData] = await Promise.all([
    listDirectorProgramPerformance(user, activeProgramId, portfolio),
    loadImpactAnalytics(user, { activeProgramId, isAllPrograms }),
    listKpis(companyCode),
    loadKpiData(companyCode),
  ])

  const scopeProgramId = isAllPrograms ? null : activeProgramId
  const kpiTally = tallyKpis(kpis, kpiData, user, scopeProgramId)

  // Every programme in scope, including new ones without SMEs yet (the dashboard leaves those out).
  const programmes: DirectorProgrammeRow[] = programmeRows.map((row) => {
    const smes = portfolio.filter((sme) => String(sme.programId || 'unassigned') === row.id)
    const required = smes.reduce((sum, sme) => sum + sme.execution.required, 0)
    const completed = smes.reduce((sum, sme) => sum + sme.execution.completed, 0)
    const growth = growthOf(impact.smes.filter((sme) => (sme.programId || 'unassigned') === row.id))
    const hasProgramme = row.id !== 'unassigned'
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      submitted: row.submitted,
      accepted: row.accepted,
      smes: row.smes,
      required,
      completed,
      completion: percent(completed, required),
      // All overdue work, whenever it was assigned.
      overdue: row.overdueAssignments,
      highRisk: row.highRisk,
      mediumRisk: row.mediumRisk,
      lowRisk: row.lowRisk,
      totalEmployees: row.totalEmployees,
      totalRevenue: row.totalRevenue,
      avgProgress: row.avgProgress,
      revenueGrowth: growth.growth,
      revenueStart: growth.start,
      revenueLatest: growth.latest,
      growingSmes: growth.growing,
      smesWithRevenue: growth.withRevenue,
      kpis: hasProgramme ? tallyKpis(kpis, kpiData, user, row.id) : { onTrack: 0, behind: 0, withTarget: 0, behindNames: [] },
    }
  })

  const required = portfolio.reduce((sum, sme) => sum + sme.execution.required, 0)
  const completed = portfolio.reduce((sum, sme) => sum + sme.execution.completed, 0)
  const overdue = programmes.reduce((sum, row) => sum + row.overdue, 0)
  const unresponsive = portfolio.reduce((sum, sme) => sum + sme.execution.unresponsive, 0)
  const highRisk = portfolio.filter((sme) => sme.risk === 'High').length

  // Most serious first; each points at the page that explains it.
  const attention: AttentionItem[] = []
  if (overdue) {
    const worst = [...programmes].sort((a, b) => b.overdue - a.overdue)[0]
    // The dashboard opens the overdue list (with "Ask for an update") instead of following this path.
    attention.push({ key: 'overdue', count: overdue, programme: programmes.length > 1 ? worst?.name : undefined, path: '/director' })
  }
  if (kpiTally.behind) attention.push({ key: 'kpis_behind', count: kpiTally.behind, names: kpiTally.behindNames.slice(0, 2), path: '/kpis' })
  programmes
    .filter((row) => row.completion !== null && row.completion < LOW_COMPLETION)
    .sort((a, b) => (a.completion || 0) - (b.completion || 0))
    .forEach((row) => attention.push({ key: 'low_completion', count: row.completion || 0, programme: row.name, path: '/director/programs' }))
  if (unresponsive) attention.push({ key: 'unresponsive', count: unresponsive, path: '/director/portfolio' })
  if (highRisk) attention.push({ key: 'high_risk', count: highRisk, path: '/director/portfolio' })

  return {
    revenueGrowth: impact.revenueGrowth,
    growingSmes: impact.growingSmes,
    smesWithRevenue: impact.smesWithRevenue,
    netJobs: impact.netJobs,
    smesWithJobs: impact.smesWithJobs,
    kpis: kpiTally,
    kpiItems: listKpiStatuses(kpis, kpiData, user, scopeProgramId),
    required,
    completed,
    completion: percent(completed, required),
    programmes,
    attention: attention.slice(0, MAX_ATTENTION),
  }
}
