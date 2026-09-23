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

  const [applicationsSnap, participantsSnap, programsSnap] = await Promise.all([
    getDocs(query(collection(db, 'applications'), ...applicationConstraints)),
    getDocs(user.companyCode ? query(collection(db, 'participants'), where('companyCode', '==', user.companyCode)) : collection(db, 'participants')),
    getDocs(collection(db, 'programs')),
  ])

  const accepted = new Map<string, { acceptedAt?: string | null; programId?: string; programName?: string }>()
  applicationsSnap.docs.forEach(record => {
    const data = record.data() as AnyDoc
    const participantId = getParticipantIdFromApplication(record.id, data)
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId || 'all', programId)) return
    accepted.set(participantId, {
      acceptedAt: toIsoDate(pick(data.acceptedAt, data.approvedAt, data.updatedAt, data.createdAt)),
      programId,
      programName: String(data.programName || ''),
    })
  })

  const programNames = new Map(programsSnap.docs.map(record => {
    const data = record.data() as AnyDoc
    return [record.id, String(data.name || data.programName || data.title || record.id)]
  }))

  const participants: Array<{ id: string } & AnyDoc> = participantsSnap.docs
    .filter(record => accepted.has(record.id))
    .map(record => ({ id: record.id, ...(record.data() as AnyDoc) }))

  const performance = await Promise.all(participants.map(row => getLatestPerformance(String(row.id))))

  return participants.map((participant, index) => {
    const acceptedInfo = accepted.get(String(participant.id))
    const perf = performance[index] || {}
    const revenueHistory = Array.isArray(participant.revenueHistory) ? participant.revenueHistory as AnyDoc[] : []
    const revenueValues = revenueHistory.map(item => toNumber(item.revenue, item.amount, item.value)).filter(value => value > 0)
    const revenueNow = toNumber(perf.revenueNow, participant.totalRevenue, participant.revenue, revenueValues.at(-1))
    const revenuePrev = toNumber(perf.revenuePrev, revenueValues.at(-2))
    const growthRate = toNumber(perf.growthRate, participant.growthRate, participant.revenueGrowthRate) || deriveGrowthRate(revenueNow, revenuePrev)
    const progress = Math.max(0, Math.min(100, toNumber(perf.progress, participant.progress, participant.overallProgress, participant.kpiProgress, participant.score, participant.overallScore)))
    const risk = deriveRisk(progress, growthRate)
    const programId = String(participant.programId || acceptedInfo?.programId || '').trim()

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
