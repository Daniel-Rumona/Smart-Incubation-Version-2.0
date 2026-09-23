import dayjs from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import type { DirectorPortfolioSme, DirectorProgramPerformance } from '@/types/director'
import { listDirectorPortfolio } from '@/services/directorPortfolioService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'

type AnyDoc = Record<string, unknown>
type ProgramDoc = AnyDoc & { id: string }

const toNumber = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

const toIsoDate = (value: unknown) => {
  if (!value) return undefined
  if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    return dayjs(value.toDate()).format('YYYY-MM-DD')
  }
  if (typeof value === 'object' && 'seconds' in value && typeof value.seconds === 'number') {
    return dayjs(value.seconds * 1000).format('YYYY-MM-DD')
  }
  const parsed = dayjs(value as string | number | Date)
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : undefined
}

const normalizeStatus = (value: unknown) => String(value || '').trim().toLowerCase()
const isAccepted = (row: AnyDoc) => ['accepted', 'approved', 'onboarded', 'enrolled'].includes(normalizeStatus(row.applicationStatus || row.status))
const isCompleted = (row: AnyDoc) => normalizeStatus(row.status) === 'completed' || normalizeStatus(row.completionStatus) === 'completed' || toNumber(row.progress) >= 100
const isOverdue = (row: AnyDoc) => {
  const due = toIsoDate(row.dueDate)
  return !!due && dayjs(due).isBefore(dayjs(), 'day') && !isCompleted(row)
}

const programName = (row: AnyDoc, fallback: string) => String(row.name || row.programName || row.title || fallback)
const programStatus = (row: AnyDoc) => String(row.status || (row.isActive ? 'active' : 'active'))

export const listDirectorProgramPerformance = async (
  user: FullIdentity,
  activeProgramId?: string,
): Promise<DirectorProgramPerformance[]> => {
  const db = getFirebaseDb()
  const companyConstraint = user.companyCode ? [where('companyCode', '==', user.companyCode)] : []

  const [programsSnap, applicationsSnap, assignmentsSnap, portfolio] = await Promise.all([
    getDocs(query(collection(db, 'programs'), ...companyConstraint)),
    getDocs(query(collection(db, 'applications'), ...companyConstraint)),
    getDocs(query(collection(db, 'assignedInterventions'), ...companyConstraint)),
    listDirectorPortfolio(user, activeProgramId),
  ])

  const scopedPrograms: ProgramDoc[] = programsSnap.docs
    .filter(record => matchesActiveProgram(user, activeProgramId || 'all', record.id))
    .map(record => ({ ...(record.data() as AnyDoc), id: record.id }))

  const programMap = new Map<string, DirectorProgramPerformance>()
  const ensureProgram = (id: string, name?: string) => {
    const key = id || 'unassigned'
    const existing = programMap.get(key)
    if (existing) return existing
    const source = scopedPrograms.find(program => program.id === key)
    const created: DirectorProgramPerformance = {
      id: key,
      name: name || (source ? programName(source, key) : 'Unassigned Program'),
      status: source ? programStatus(source) : 'active',
      startDate: source ? toIsoDate(source.startDate || source.createdAt) : undefined,
      endDate: source ? toIsoDate(source.endDate) : undefined,
      submitted: 0,
      accepted: 0,
      smes: 0,
      assignments: 0,
      completedAssignments: 0,
      overdueAssignments: 0,
      avgProgress: 0,
      totalRevenue: 0,
      totalEmployees: 0,
      highRisk: 0,
      mediumRisk: 0,
      lowRisk: 0,
    }
    programMap.set(key, created)
    return created
  }

  scopedPrograms.forEach(program => ensureProgram(program.id, programName(program, program.id)))

  applicationsSnap.docs.forEach(record => {
    const data = record.data() as AnyDoc
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId || 'all', programId)) return
    const row = ensureProgram(programId, String(data.programName || ''))
    row.submitted += 1
    if (isAccepted(data)) row.accepted += 1
  })

  assignmentsSnap.docs.forEach(record => {
    const data = record.data() as AnyDoc
    const programId = String(data.programId || '').trim()
    if (!matchesActiveProgram(user, activeProgramId || 'all', programId)) return
    const row = ensureProgram(programId, String(data.programName || ''))
    row.assignments += 1
    if (isCompleted(data)) row.completedAssignments += 1
    if (isOverdue(data)) row.overdueAssignments += 1
  })

  const portfolioByProgram = new Map<string, DirectorPortfolioSme[]>()
  portfolio.forEach(sme => {
    const key = String(sme.programId || 'unassigned')
    portfolioByProgram.set(key, [...(portfolioByProgram.get(key) || []), sme])
  })

  portfolioByProgram.forEach((smes, programId) => {
    const row = ensureProgram(programId, smes[0]?.programName)
    row.smes = smes.length
    row.avgProgress = smes.length ? Math.round(smes.reduce((sum, sme) => sum + sme.progress, 0) / smes.length) : 0
    row.totalRevenue = smes.reduce((sum, sme) => sum + sme.metrics.revenue, 0)
    row.totalEmployees = smes.reduce((sum, sme) => sum + sme.metrics.employees, 0)
    row.highRisk = smes.filter(sme => sme.risk === 'High').length
    row.mediumRisk = smes.filter(sme => sme.risk === 'Medium').length
    row.lowRisk = smes.filter(sme => sme.risk === 'Low').length
  })

  return Array.from(programMap.values()).sort((a, b) => b.smes - a.smes || a.name.localeCompare(b.name))
}
