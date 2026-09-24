import dayjs from 'dayjs'
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import type { DirectorPortfolioSme, DirectorRisk, DirectorStage, SectorRollup } from '@/types/director'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'

type AnyDoc = Record<string, unknown>

const pick = <T,>(...values: T[]) => values.find(value => value !== undefined && value !== null && value !== '') as T | undefined

const toNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const toIsoDate = (value: unknown) => {
  if (!value) return null
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return dayjs(value.toDate()).format('YYYY-MM-DD')
  }
  if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
    return dayjs(value.seconds * 1000).format('YYYY-MM-DD')
  }
  const parsed = dayjs(value as string | number | Date)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
}

const normalizeStage = (value: unknown): DirectorStage | null => {
  const stage = String(value || '').toLowerCase()
  if (stage.includes('seed')) return 'Seed'
  if (stage.includes('startup')) return 'Startup'
  if (stage.includes('early')) return 'Early Growth'
  if (stage.includes('growth')) return 'Growth'
  if (stage.includes('mature')) return 'Mature'
  return null
}

const deriveStage = (acceptedAt?: string | null): DirectorStage => {
  if (!acceptedAt) return 'Startup'
  const months = dayjs().diff(dayjs(acceptedAt), 'month')
  if (months <= 3) return 'Seed'
  if (months <= 9) return 'Startup'
  if (months <= 18) return 'Early Growth'
  if (months <= 36) return 'Growth'
  return 'Mature'
}

const deriveGrowthRate = (current: number, previous: number) => {
  if (previous <= 0) return current > 0 ? 100 : 0
  return Math.round(((current - previous) / previous) * 100)
}

const deriveRisk = (progress: number, growthRate: number): DirectorRisk => {
  if (progress < 45 || growthRate < 20) return 'High'
  if (progress < 65 || growthRate < 40) return 'Medium'
  return 'Low'
}

const deriveStatus = (value: unknown, risk: DirectorRisk): DirectorPortfolioSme['status'] => {
  const status = String(value || '').toLowerCase()
  if (status.includes('pause')) return 'Paused'
  if (status.includes('warning') || risk === 'High') return 'Warning'
  return 'Active'
}

const toDayjsValue = (value: unknown) => {
  const iso = toIsoDate(value)
  return iso ? dayjs(iso) : null
}

/** Reads a { "YYYY-MM": number } map (or the legacy array shape) into a month-sorted series. */
const monthlySeries = (history: unknown): Array<{ key: string; value: number }> => {
  const source = history && typeof history === 'object' && !Array.isArray(history) && 'monthly' in history
    ? (history as { monthly?: Record<string, unknown> }).monthly || {}
    : null
  if (source) {
    return Object.entries(source)
      .map(([key, value]) => ({ key, value: toNumber(value) }))
      .filter(entry => /^\d{4}-\d{2}$/.test(entry.key) && entry.value > 0)
      .sort((a, b) => a.key.localeCompare(b.key))
  }
  if (Array.isArray(history)) {
    return (history as AnyDoc[])
      .map(item => ({ key: String(item.month || item.period || ''), value: toNumber(item.revenue, item.amount, item.value) }))
      .filter(entry => entry.value > 0)
  }
  return []
}

const isAssignmentCompleted = (row: AnyDoc) =>
  String(row.status || '').toLowerCase() === 'completed'
  || String(row.completionStatus || '').toLowerCase() === 'completed'
  || (String(row.assigneeCompletionStatus || '').toLowerCase() === 'done' && String(row.participantCompletionStatus || '').toLowerCase() === 'confirmed')
  || toNumber(row.progress) >= 100

const requiredCount = (application: AnyDoc) => {
  const interventions = application.interventions as { required?: unknown } | undefined
  const required = interventions?.required || application.interventionsRequired || application.requiredInterventions
  return Array.isArray(required) ? required.length : 0
}

const getParticipantIdFromApplication = (id: string, data: AnyDoc) =>
  String(pick(data.participantId, data.participantID, data.smeId, data.smeID, id) || id)

const getLatestPerformance = async (participantId: string) => {
  try {
    const snapshot = await getDocs(query(
      collection(getFirebaseDb(), 'monthlyPerformance', participantId, 'history'),
      orderBy('createdAt', 'desc'),
      limit(1),
    ))
    const data = snapshot.docs[0]?.data() as AnyDoc | undefined
    if (!data) return {}
    return {
      progress: toNumber(data.progress, data.overallProgress, data.score, data.overallScore),
      growthRate: toNumber(data.growthRate, data.revenueGrowthRate, data.growth),
      lastUpdate: toIsoDate(pick(data.asOfDate, data.periodEnd, data.date, data.createdAt, data.updatedAt)),
      revenueNow: toNumber(data.revenue, data.totalRevenue, data.revenueNow),
      revenuePrev: toNumber(data.revenuePrev, data.previousRevenue),
    }
  } catch {
    return {}
  }
}

export const listDirectorPortfolio = async (user: FullIdentity, activeProgramId?: string): Promise<DirectorPortfolioSme[]> => {
  const db = getFirebaseDb()
  const applicationConstraints = [
    ...(user.companyCode ? [where('companyCode', '==', user.companyCode)] : []),
    where('applicationStatus', '==', 'accepted'),
  ]

  const [applicationsSnap, participantsSnap, programsSnap, assignmentsSnap] = await Promise.all([
    getDocs(query(collection(db, 'applications'), ...applicationConstraints)),
    getDocs(user.companyCode ? query(collection(db, 'participants'), where('companyCode', '==', user.companyCode)) : collection(db, 'participants')),
    getDocs(collection(db, 'programs')),
    getDocs(user.companyCode ? query(collection(db, 'assignedInterventions'), where('companyCode', '==', user.companyCode)) : collection(db, 'assignedInterventions')),
  ])

  const accepted = new Map<string, { acceptedAt?: string | null; programId?: string; programName?: string; required: number }>()
  applicationsSnap.docs.forEach(record => {
    const data = record.data() as AnyDoc
    const participantId = getParticipantIdFromApplication(record.id, data)
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId || 'all', programId)) return
    accepted.set(participantId, {
      acceptedAt: toIsoDate(pick(data.acceptedAt, data.approvedAt, data.updatedAt, data.createdAt)),
      programId,
      programName: String(data.programName || ''),
      required: requiredCount(data),
    })
  })

  const programNames = new Map(programsSnap.docs.map(record => {
    const data = record.data() as AnyDoc
    return [record.id, String(data.name || data.programName || data.title || record.id)]
  }))

  const participants: Array<{ id: string } & AnyDoc> = participantsSnap.docs
    .filter(record => accepted.has(record.id))
    .map(record => ({ id: record.id, ...(record.data() as AnyDoc) }))

  const assignmentsByParticipant = new Map<string, AnyDoc[]>()
  assignmentsSnap.docs.forEach(record => {
    const data = record.data() as AnyDoc
    const participantId = String(pick(data.participantId, data.smeId, data.smmeId) || '')
    if (!participantId) return
    assignmentsByParticipant.set(participantId, [...(assignmentsByParticipant.get(participantId) || []), data])
  })

  const performance = await Promise.all(participants.map(row => getLatestPerformance(String(row.id))))

  const today = dayjs().startOf('day')

  return participants.map((participant, index) => {
    const acceptedInfo = accepted.get(String(participant.id))
    const perf = performance[index] || {}
    const assignments = assignmentsByParticipant.get(String(participant.id)) || []

    const revenueSeries = monthlySeries(participant.revenueHistory)
    const headcountSeries = monthlySeries(participant.headcountHistory)
    const revenueNow = toNumber(perf.revenueNow, participant.totalRevenue, participant.revenue, revenueSeries.at(-1)?.value)

    // Growth: latest month vs the earliest month within the trailing six months of history.
    const recent = revenueSeries.slice(-7)
    const derivedGrowth = recent.length >= 2 ? deriveGrowthRate(recent[recent.length - 1].value, recent[0].value) : 0
    const growthRate = toNumber(perf.growthRate, participant.growthRate, participant.revenueGrowthRate) || derivedGrowth

    const completedCount = assignments.filter(isAssignmentCompleted).length
    const derivedProgress = assignments.length
      ? Math.round(assignments.reduce((sum, row) => sum + (isAssignmentCompleted(row) ? 100 : Math.min(toNumber(row.progress), 100)), 0) / assignments.length)
      : 0
    const progress = Math.max(0, Math.min(100, toNumber(perf.progress, participant.progress, participant.overallProgress, participant.kpiProgress, participant.score, participant.overallScore) || derivedProgress))

    let overdue = 0
    let upcoming = 0
    let unresponsive = 0
    assignments.forEach(row => {
      if (isAssignmentCompleted(row)) return
      const due = toDayjsValue(row.dueDate)
      if (due) {
        const days = due.startOf('day').diff(today, 'day')
        if (days < 0) overdue += 1
        else if (days <= 14) upcoming += 1
      }
      const created = toDayjsValue(row.createdAt)
      const consultantAccepted = String(row.assigneeStatus || '').toLowerCase() === 'accepted'
      const smeAccepted = String(row.participantStatus || '').toLowerCase() === 'accepted'
      if (consultantAccepted && !smeAccepted && created && today.diff(created, 'day') >= 7) unresponsive += 1
    })

    const risk = deriveRisk(progress, growthRate)
    const programId = String(participant.programId || acceptedInfo?.programId || '').trim()

    const headcountByMonth = new Map(headcountSeries.map(entry => [entry.key, entry.value]))
    const trend = revenueSeries.slice(-12).map(entry => ({
      key: entry.key,
      month: dayjs(`${entry.key}-01`).format('MMM'),
      revenue: entry.value,
      employees: headcountByMonth.get(entry.key) || 0,
    }))

    return {
      id: String(participant.id),
      name: String(participant.businessName || participant.name || participant.companyName || participant.smeName || 'Unnamed SME'),
      sector: String(participant.sector || participant.industry || participant.businessSector || 'Unspecified'),
      stage: normalizeStage(participant.stage) || deriveStage(acceptedInfo?.acceptedAt),
      status: deriveStatus(participant.status, risk),
      risk,
      valuation: toNumber(participant.valuation, participant.companyValuation),
      investment: toNumber(participant.investment, participant.totalInvestment, participant.fundingReceived),
      progress,
      lastUpdate: String(perf.lastUpdate || toIsoDate(participant.updatedAt) || toIsoDate(participant.createdAt) || acceptedInfo?.acceptedAt || dayjs().format('YYYY-MM-DD')),
      programId,
      programName: String(acceptedInfo?.programName || programNames.get(programId) || participant.programName || 'Unassigned'),
      photoUrl: String(pick(participant.profileImageUrl, participant.photoURL, participant.photoUrl, participant.logoUrl, participant.logo, participant.avatarUrl) || '') || undefined,
      execution: {
        required: Math.max(acceptedInfo?.required || 0, assignments.length),
        completed: completedCount,
        overdue,
        unresponsive,
        upcoming,
      },
      trend,
      metrics: {
        revenue: revenueNow,
        customers: toNumber(participant.customers, participant.customerCount, participant.clients, participant.clientCount),
        employees: toNumber(participant.employeeCount, participant.employees, participant.workers, participant.numberOfWorkers, participant.staffCount),
        growthRate,
      },
    }
  })
}

export const buildSectorRollups = (rows: DirectorPortfolioSme[]): SectorRollup[] => {
  const map = new Map<string, DirectorPortfolioSme[]>()
  rows.forEach(row => map.set(row.sector, [...(map.get(row.sector) || []), row]))

  return Array.from(map.entries()).map(([sector, smes]) => {
    const companies = smes.length
    return {
      sector,
      companies,
      avgProgress: companies ? Math.round(smes.reduce((sum, item) => sum + item.progress, 0) / companies) : 0,
      avgGrowth: companies ? Math.round(smes.reduce((sum, item) => sum + item.metrics.growthRate, 0) / companies) : 0,
      totalRevenue: smes.reduce((sum, item) => sum + item.metrics.revenue, 0),
      totalValuation: smes.reduce((sum, item) => sum + item.valuation, 0),
      highRisk: smes.filter(item => item.risk === 'High').length,
      mediumRisk: smes.filter(item => item.risk === 'Medium').length,
      lowRisk: smes.filter(item => item.risk === 'Low').length,
      smes,
    }
  }).sort((a, b) => b.totalRevenue - a.totalRevenue)
}
