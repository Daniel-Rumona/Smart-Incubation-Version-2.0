import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { isAssignmentCompleted, listDirectorPortfolio } from '@/services/directorPortfolioService'
import { ALL_IMPLEMENTORS, getDocsInScope, isOrgFunder, loadDataScope } from '@/services/funderScopeService'
import { listWorkspacePrograms, matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { DirectorPortfolioSme } from '@/types/director'
import type { FullIdentity } from '@/types/identity'

/**
 * The funder Impact page: what the programmes achieved and for whom, for funders' own reports. Processed totals only,
 * never SME contact details. Scope follows the implementor and programme selectors (see funderScopeService).
 *
 *  - Funding committed: the amounts on the funder's active programme links (funderLinks.fundingAmount).
 *  - Beneficiary profile: from accepted applications' ownership (51% or more counts as owned), as the ESG scorecard
 *    reads it; black women-owned only where directors are listed with race, gender and share.
 *  - Jobs and revenue: since joining, first and latest monthly report, as Impact analysis and the dashboard count them.
 *  - Support delivered: completed interventions by area of support, and hours of appointments held.
 */

type Row = DocumentData & { id: string }

export const MAJORITY_OWNED = 51
const BLACK_GROUPS = new Set(['african', 'coloured', 'indian', 'black'])
/** An appointment longer than this is a data slip, not a meeting; it counts as this long. */
const MAX_MEETING_HOURS = 8
/** A held appointment with no end time counts as an hour. */
const DEFAULT_MEETING_HOURS = 1

const text = (value: unknown) => String(value ?? '').trim()
const lower = (value: unknown) => text(value).toLowerCase()
const numberOrNull = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}
const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string)
  return parsed.isValid() ? parsed : null
}

/** Who owns the SME: each group's share (%), null when not recorded, and whether it reaches MAJORITY_OWNED. */
export type OwnershipShares = { black: number | null; blackWomen: number | null; female: number | null; youth: number | null }
export type Ownership = { known: boolean; black: boolean; female: boolean; youth: boolean; blackWomen: boolean; percents: OwnershipShares }

/** Ownership from an application: top-level fields, nested ownership/profile/formValues maps, or its directors. */
export const ownershipOf = (application: Row | undefined): Ownership => {
  if (!application) return { known: false, black: false, female: false, youth: false, blackWomen: false, percents: { black: null, blackWomen: null, female: null, youth: null } }
  const sources = [application, application.ownership, application.profile, application.formValues, application.businessProfile]
    .filter((part): part is Row => Boolean(part) && typeof part === 'object')
  const pick = (...fields: string[]) => numberOrNull(...sources.flatMap((source) => fields.map((field) => source[field])))
  const directors = sources.map((source) => source.directors).find((value): value is Row[] => Array.isArray(value) && value.length > 0) || []
  const share = (test: (director: Row) => boolean) => directors.filter(test).reduce((sum, director) => sum + (numberOrNull(director.sharePercent) || 0), 0)
  const isBlack = (director: Row) => BLACK_GROUPS.has(lower(director.race))
  const isFemale = (director: Row) => lower(director.gender) === 'female'
  const black = pick('blackOwnedPercent') ?? (directors.length ? share(isBlack) : null)
  const female = pick('femaleOwnedPercent', 'womenOwnedPercent') ?? (directors.length ? share(isFemale) : null)
  const youth = pick('youthOwnedPercent')
  const blackWomen = directors.length ? share((director) => isBlack(director) && isFemale(director)) : null
  return {
    known: black !== null || female !== null || youth !== null,
    black: black !== null && black >= MAJORITY_OWNED,
    female: female !== null && female >= MAJORITY_OWNED,
    youth: youth !== null && youth >= MAJORITY_OWNED,
    blackWomen: blackWomen !== null && blackWomen >= MAJORITY_OWNED,
    percents: { black, blackWomen, female, youth },
  }
}

/** Hours of one held appointment: end minus start, an hour when there's no end, never more than a working day. */
export const meetingHours = (row: Row) => {
  const start = toDay(row.startTime)
  const end = toDay(row.endTime)
  if (!start || !end || !end.isAfter(start)) return DEFAULT_MEETING_HOURS
  return Math.min(MAX_MEETING_HOURS, end.diff(start, 'minute') / 60)
}

/** One set of impact figures: for everything in view, or for one implementor or programme. */
export type ImpactBlock = {
  smes: number
  /** Net change in headcount since joining, across SMEs with two reports. */
  jobsCreated: number
  /** Headcount now. */
  jobsSustained: number
  /** Average of each SME's revenue change since joining (%), over SMEs with two reports. */
  revenueGrowth: number | null
  smesWithRevenue: number
  funding: number | null
  costPerJob: number | null
  costPerSme: number | null
  programmes: number
  fundedProgrammes: number
  ownershipKnown: number
  blackOwned: number
  blackWomenOwned: number
  womenOwned: number
  youthOwned: number
  interventionsCompleted: number
  meetingsHeld: number
  meetingHours: number
  /** Completed interventions by area of support, most first. */
  areas: Array<{ area: string; completed: number }>
}

/** An implementor or a programme, side by side with the others. */
export type ImpactPanel = ImpactBlock & { key: string; name: string; implementor?: string }

export type FunderImpact = {
  totals: ImpactBlock
  implementors: ImpactPanel[]
  programmes: ImpactPanel[]
  /** Funder organisations record funding on their links; company-scoped funders have none to show. */
  fundingTracked: boolean
}

/** Funding on the organisation's active links, by programme (funder organisations only). */
const loadFundingByProgramme = async (user: FullIdentity) => {
  const funding = new Map<string, number>()
  if (!isOrgFunder(user)) return funding
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'funderLinks'), where('funderOrgId', '==', String(user.funderOrgId))))
  snapshot.docs.forEach((row) => {
    const data = row.data()
    if (data.status === 'active' && typeof data.fundingAmount === 'number') funding.set(text(data.programId), data.fundingAmount)
  })
  return funding
}

export const loadFunderImpact = async (user: FullIdentity, activeProgramId?: string, implementor: string = ALL_IMPLEMENTORS): Promise<FunderImpact> => {
  const scope = await loadDataScope(user, implementor)
  const inScope = (programId: unknown) => matchesActiveProgram(user, activeProgramId || 'all', text(programId))
  const [portfolio, applicationDocs, assignmentDocs, appointmentDocs, programmes, fundingByProgramme] = await Promise.all([
    listDirectorPortfolio(user, activeProgramId, scope),
    getDocsInScope(scope, 'applications', [where('applicationStatus', '==', 'accepted')]).catch(() => []),
    getDocsInScope(scope, 'assignedInterventions').catch(() => []),
    getDocsInScope(scope, 'appointments').catch(() => []),
    listWorkspacePrograms(user).catch(() => []),
    loadFundingByProgramme(user).catch(() => new Map<string, number>()),
  ])
  const smeIds = new Set(portfolio.map((row) => row.id))
  const companyName = new Map(scope.map((entry) => [entry.companyCode, entry.companyName || entry.companyCode]))
  const programmeName = new Map(programmes.map((row) => [row.id, String(row.name)]))

  // Beneficiary profile, one application per SME in scope.
  const ownershipBySme = new Map<string, Ownership>()
  applicationDocs.forEach((doc) => {
    const data = { id: doc.id, ...doc.data() } as Row
    const smeId = text(data.participantId) || doc.id
    if (smeIds.has(smeId) && inScope(data.programId)) ownershipBySme.set(smeId, ownershipOf(data))
  })

  // Support delivered: completed interventions of SMEs in view, and appointments held.
  const completed = assignmentDocs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Row))
    .filter((row) => inScope(row.programId) && smeIds.has(text(row.participantId)) && isAssignmentCompleted(row))
  const held = appointmentDocs
    .map((doc) => ({ id: doc.id, ...doc.data() } as Row))
    .filter((row) => inScope(row.programId) && lower(row.status) === 'completed')
  const fundingTracked = isOrgFunder(user)

  /** The full set of figures for some SMEs (and the programmes they're in). */
  const blockFor = (smes: DirectorPortfolioSme[]): ImpactBlock => {
    const ids = new Set(smes.map((row) => row.id))
    const programmeIds = [...new Set(smes.map((row) => text(row.programId)).filter(Boolean))]
    const programmeSet = new Set(programmeIds)
    const amounts = programmeIds.map((id) => fundingByProgramme.get(id)).filter((value): value is number => typeof value === 'number')
    const funding = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null
    const jobsCreated = smes.filter((row) => row.growth?.jobs).reduce((sum, row) => sum + ((row.growth?.jobs?.latest || 0) - (row.growth?.jobs?.start || 0)), 0)
    const growths = smes
      .map((row) => row.growth?.revenue)
      .filter((revenue): revenue is { start: number; latest: number } => !!revenue && revenue.start > 0)
      .map((revenue) => ((revenue.latest - revenue.start) / revenue.start) * 100)
    const owners = [...ids].map((id) => ownershipBySme.get(id)).filter((row): row is Ownership => !!row)
    const done = completed.filter((row) => ids.has(text(row.participantId)))
    const areaCounts = new Map<string, number>()
    done.forEach((row) => {
      const area = text(row.areaOfSupport || row.area) || 'Other'
      areaCounts.set(area, (areaCounts.get(area) || 0) + 1)
    })
    const meetings = held.filter((row) => programmeSet.has(text(row.programId)))
    return {
      smes: smes.length,
      jobsCreated,
      jobsSustained: smes.reduce((sum, row) => sum + (row.metrics.employees || 0), 0),
      revenueGrowth: growths.length ? Math.round(growths.reduce((sum, value) => sum + value, 0) / growths.length) : null,
      smesWithRevenue: growths.length,
      funding,
      costPerJob: funding !== null && jobsCreated > 0 ? Math.round(funding / jobsCreated) : null,
      costPerSme: funding !== null && smes.length > 0 ? Math.round(funding / smes.length) : null,
      programmes: programmeIds.length,
      fundedProgrammes: programmeIds.filter((id) => fundingByProgramme.has(id)).length,
      ownershipKnown: owners.filter((row) => row.known).length,
      blackOwned: owners.filter((row) => row.black).length,
      blackWomenOwned: owners.filter((row) => row.blackWomen).length,
      womenOwned: owners.filter((row) => row.female).length,
      youthOwned: owners.filter((row) => row.youth).length,
      interventionsCompleted: done.length,
      meetingsHeld: meetings.length,
      meetingHours: Math.round(meetings.reduce((sum, row) => sum + meetingHours(row), 0)),
      areas: [...areaCounts.entries()].map(([area, count]) => ({ area, completed: count })).sort((left, right) => right.completed - left.completed),
    }
  }

  const groupBy = (keyOf: (row: DirectorPortfolioSme) => string) => {
    const groups = new Map<string, DirectorPortfolioSme[]>()
    portfolio.forEach((row) => {
      const key = keyOf(row)
      if (key) groups.set(key, [...(groups.get(key) || []), row])
    })
    return groups
  }
  const implementors: ImpactPanel[] = [...groupBy((row) => text(row.companyCode)).entries()].map(([code, smes]) => ({
    key: code,
    name: companyName.get(code) || code,
    ...blockFor(smes),
  })).sort((left, right) => right.smes - left.smes)
  const programmePanels: ImpactPanel[] = [...groupBy((row) => text(row.programId)).entries()].map(([id, smes]) => ({
    key: id,
    name: programmeName.get(id) || smes[0]?.programName || id,
    implementor: companyName.get(text(smes[0]?.companyCode)) || undefined,
    ...blockFor(smes),
  })).sort((left, right) => right.smes - left.smes)

  return { totals: blockFor(portfolio), implementors, programmes: programmePanels, fundingTracked }
}
