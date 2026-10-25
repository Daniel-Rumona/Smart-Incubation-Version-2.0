import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/firebase/config'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { metricHistory, toDayjsValue, type FirestoreDateLike, type PerformanceSourceRow } from '@/services/smePerformanceMetrics'
import { SME_ANSWER_MATCHES, smeCheckbackHistory, type SmeCheckbackEntry } from '@/services/smeCheckbackService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'

/**
 * Impact analytics: did the SMEs we supported grow, and did the interventions achieve what they set out to?
 *
 *  - Growth since joining: each SME's first and latest recorded revenue and headcount (revenueHistory /
 *    headcountHistory on the participant, as captured on the metrics pages).
 *  - Before and after support: average monthly revenue in the six months before the SME's first completed
 *    intervention against the six months after. Monthly figures only, and only where both sides exist.
 *  - Outcomes: the latest facilitator follow-up result on each completed intervention (achieved / partially /
 *    not yet), grouped by area of support. Without an answer, it waits on a check-back that is due, overdue, or was
 *    never set up. Check-backs themselves (answers, WhatsApp share, overdue, re-checks) are summarised too.
 *    Answers come from the facilitator or operations staff (web or WhatsApp, functions/src/followUps.ts); SMEs
 *    aren't asked. The LPH| check-back buttons on WhatsApp belong to the separate Lepharo platform and never reach here.
 *  - Served or not yet: growth of SMEs with at least one completed intervention against those with none.
 * Figures stay English; the page translates labels when it shows them.
 */

/**
 * Where each completed intervention's outcome stands. The first three are the facilitator's latest check-back
 * answer; without one, it's waiting on a check-back that is still due, one that is overdue, or none was set up.
 */
export type OutcomeBucket = 'achieved' | 'partially' | 'not_yet' | 'checkback_due' | 'checkback_overdue' | 'no_checkback'

export const OUTCOME_BUCKETS: OutcomeBucket[] = ['achieved', 'partially', 'not_yet', 'checkback_due', 'checkback_overdue', 'no_checkback']
const RESULT_BUCKETS: OutcomeBucket[] = ['achieved', 'partially', 'not_yet']
const emptyBuckets = (): Record<OutcomeBucket, number> => ({ achieved: 0, partially: 0, not_yet: 0, checkback_due: 0, checkback_overdue: 0, no_checkback: 0 })

/** How the check-backs themselves are going, across completed interventions. */
export type CheckbackSummary = {
  /** Check-back answers recorded, every round counted. */
  answered: number
  /** Of those, answered by tapping a button on the WhatsApp message. */
  viaWhatsapp: number
  /** Interventions whose next check-back is past due with no answer (including re-checks after "partially"). */
  overdue: number
  achievedFirstTime: number
  /** Achieved only after one or more re-checks. */
  achievedAfterRecheck: number
}

type AnyDoc = Record<string, unknown>

type Assignment = {
  id: string
  participantId: string
  programId: string
  areaOfSupport: string
  completedAt: Dayjs | null
  completed: boolean
  outcome: OutcomeBucket | null
  /** Check-back answers on record, oldest first. */
  answers: Array<{ via: string, result: string }>
  checkbackOverdue: boolean
  title: string
  /** The SME's own check-back answers (src/services/smeCheckbackService.ts), by round. */
  smeAnswers: SmeCheckbackEntry[]
}

/** The SME's side of the check-backs, compared with the facilitator's. */
export type SmeCheckbackSummary = {
  /** SME answers recorded, every round. */
  answered: number
  viaWhatsapp: number
  /** Rounds both answered, and how many of those agreed (Yes ↔ Achieved, Partly ↔ Partially, No ↔ Not yet). */
  pairs: number
  agreed: number
  agreementRate: number | null
  /** Facilitator rounds answered, for "the SME answered N of M". */
  facilitatorRounds: number
  /** Achieved, and the SME said Yes for that round. */
  confirmedAchieved: number
  /** Achieved by the facilitator, but the SME said No for that round. */
  disputes: Array<{ id: string, title: string, smeName: string, note: string | null }>
}

export type SmeImpact = {
  id: string
  name: string
  programId: string
  revenueStart: number | null
  revenueLatest: number | null
  /** Percentage change from first to latest revenue, when there are two figures to compare. */
  revenueChange: number | null
  jobsStart: number | null
  jobsLatest: number | null
  jobsChange: number | null
  completedInterventions: number
  outcomesAchieved: number
  outcomesRecorded: number
  /** Average monthly revenue before and after the first completed intervention. */
  before: number | null
  after: number | null
  beforeAfterChange: number | null
}

/** Outcome counts for one area of support; achievedConfirmed is the part of achieved the SME also said Yes to. */
export type AreaOutcome = { area: string, achievedConfirmed: number } & Record<OutcomeBucket, number>

export type ImpactAnalytics = {
  smes: SmeImpact[]
  totalSmes: number
  smesWithRevenue: number
  revenueStart: number
  revenueLatest: number
  revenueGrowth: number | null
  netJobs: number
  smesWithJobs: number
  growingSmes: number
  completedInterventions: number
  outcomes: Record<OutcomeBucket, number>
  checkbacks: CheckbackSummary
  smeCheckbacks: SmeCheckbackSummary
  achievedRate: number | null
  areas: AreaOutcome[]
  beforeAfter: { count: number, medianChange: number | null, improved: number }
  servedGrowth: number | null
  notServedGrowth: number | null
  servedCount: number
  notServedCount: number
}

const BEFORE_AFTER_MONTHS = 6

const text = (value: unknown) => String(value ?? '').trim()
const lower = (value: unknown) => text(value).toLowerCase()

const percentChange = (from: number, to: number) => (from > 0 ? Math.round(((to - from) / from) * 100) : null)

const median = (values: number[]) => {
  if (!values.length) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2)
}

const isDiscontinuedParticipant = (row: AnyDoc) =>
  Boolean(row.discontinuedAt) || ['discontinued', 'inactive', 'exited', 'removed'].includes(lower(row.status))

const isCompleted = (row: AnyDoc) =>
  lower(row.status) === 'completed'
  || Boolean(row.completedAt)
  || Boolean(row.completionConfirmedAt)
  || (lower(row.assigneeCompletionStatus) === 'done' && lower(row.participantCompletionStatus) === 'confirmed')

/** The latest facilitator follow-up result: outcomeResult holds it, outcomeHistory is the trail. */
const latestOutcome = (row: AnyDoc): OutcomeBucket | null => {
  const history = Array.isArray(row.outcomeHistory) ? row.outcomeHistory as Array<{ result?: unknown }> : []
  const result = lower((row.outcomeResult as { result?: unknown } | undefined)?.result) || lower(history[history.length - 1]?.result)
  return result === 'achieved' || result === 'partially' || result === 'not_yet' ? result : null
}

const toAssignment = (id: string, row: AnyDoc, now: Dayjs): Assignment => {
  const completed = isCompleted(row)
  // A check-back is pending until "achieved" closes it; "partially" and "not yet" schedule another.
  const dueAt = toDayjsValue(row.followUpDueAt as FirestoreDateLike)
  const pending = lower(row.followUpStatus) === 'pending' && !!dueAt
  const checkbackOverdue = completed && pending && !!dueAt && dueAt.isBefore(now)
  const result = latestOutcome(row)
  const history = Array.isArray(row.outcomeHistory) ? row.outcomeHistory as Array<{ via?: unknown, result?: unknown }> : []
  return {
    id,
    participantId: text(row.participantId || row.smmeId || row.smeId),
    programId: text(row.programId),
    areaOfSupport: text(row.areaOfSupport || row.area) || 'Other',
    completedAt: toDayjsValue((row.completedAt || row.completionConfirmedAt) as FirestoreDateLike),
    completed,
    outcome: !completed ? null : result ?? (checkbackOverdue ? 'checkback_overdue' : pending ? 'checkback_due' : 'no_checkback'),
    answers: history.map((entry) => ({ via: lower(entry?.via), result: lower(entry?.result) })),
    checkbackOverdue,
    title: text(row.interventionTitle || row.title) || 'Intervention',
    smeAnswers: smeCheckbackHistory(row),
  }
}

/** First and latest figure of a metric, oldest first. */
const firstAndLatest = (row: PerformanceSourceRow, metric: 'revenue' | 'headcount') => {
  const entries = metricHistory(row, metric)
  if (!entries.length) return { start: null, latest: null, count: 0 }
  return { start: entries[0].value, latest: entries[entries.length - 1].value, count: entries.length }
}

/** Average monthly revenue in the months either side of a date; null where a side has no monthly figures. */
const beforeAndAfter = (row: PerformanceSourceRow, pivot: Dayjs) => {
  const monthly = (row.revenueHistory?.monthly || {}) as Record<string, unknown>
  const entries = metricHistory({ revenueHistory: { monthly } }, 'revenue')
  const start = pivot.startOf('month')
  const before = entries.filter((entry) => entry.date.isBefore(start) && !entry.date.isBefore(start.subtract(BEFORE_AFTER_MONTHS, 'month')))
  const after = entries.filter((entry) => !entry.date.isBefore(start) && entry.date.isBefore(start.add(BEFORE_AFTER_MONTHS, 'month')))
  const average = (items: typeof entries) => (items.length ? items.reduce((sum, entry) => sum + entry.value, 0) / items.length : null)
  return { before: average(before), after: average(after) }
}

export const loadImpactAnalytics = async (
  user: FullIdentity,
  options: { activeProgramId?: string | null, isAllPrograms?: boolean } = {},
): Promise<ImpactAnalytics> => {
  const now = dayjs()
  const companyCode = text(user.companyCode)
  // Both collections only allow reading one's own company, so every query says so.
  const scope: QueryConstraint[] = [where('companyCode', '==', companyCode)]
  if (!options.isAllPrograms && options.activeProgramId) scope.push(where('programId', '==', options.activeProgramId))
  const [participantSnap, assignmentSnap] = companyCode
    ? await Promise.all([
      getDocs(query(collection(db, 'participants'), ...scope)),
      getDocs(query(collection(db, 'assignedInterventions'), ...scope)),
    ])
    : [null, null]

  const participants = (participantSnap?.docs || [])
    .map((record) => ({ ...(record.data() as AnyDoc), id: record.id }) as AnyDoc & { id: string })
    .filter((row) => !isDiscontinuedParticipant(row) && matchesActiveProgram(user, options.activeProgramId ?? null, text(row.programId)))
  const assignments = (assignmentSnap?.docs || [])
    .map((record) => ({ record, data: record.data() as AnyDoc }))
    .filter(({ data }) => !isDiscontinuedRecord(data as { participantDiscontinuedAt?: unknown }) && matchesActiveProgram(user, options.activeProgramId ?? null, text(data.programId)))
    .map(({ record, data }) => toAssignment(record.id, data, now))

  const byParticipant = new Map<string, Assignment[]>()
  assignments.forEach((assignment) => byParticipant.set(assignment.participantId, [...(byParticipant.get(assignment.participantId) || []), assignment]))

  const smes: SmeImpact[] = participants.map((row) => {
    const source = row as PerformanceSourceRow
    const revenue = firstAndLatest(source, 'revenue')
    const jobs = firstAndLatest(source, 'headcount')
    const completed = (byParticipant.get(row.id) || []).filter((assignment) => assignment.completed)
    const recorded = completed.filter((assignment) => assignment.outcome && RESULT_BUCKETS.includes(assignment.outcome))
    const firstCompletion = completed
      .map((assignment) => assignment.completedAt)
      .filter((date): date is Dayjs => Boolean(date))
      .sort((left, right) => left.valueOf() - right.valueOf())[0]
    const split = firstCompletion ? beforeAndAfter(source, firstCompletion) : { before: null, after: null }
    return {
      id: row.id,
      name: text(row.businessName || row.participantName) || 'Unnamed SME',
      programId: text(row.programId),
      revenueStart: revenue.count > 1 ? revenue.start : null,
      revenueLatest: revenue.latest,
      revenueChange: revenue.count > 1 && revenue.start !== null && revenue.latest !== null ? percentChange(revenue.start, revenue.latest) : null,
      jobsStart: jobs.count > 1 ? jobs.start : null,
      jobsLatest: jobs.latest,
      jobsChange: jobs.count > 1 && jobs.start !== null && jobs.latest !== null ? jobs.latest - jobs.start : null,
      completedInterventions: completed.length,
      outcomesAchieved: recorded.filter((assignment) => assignment.outcome === 'achieved').length,
      outcomesRecorded: recorded.length,
      before: split.before,
      after: split.after,
      beforeAfterChange: split.before !== null && split.after !== null ? percentChange(split.before, split.after) : null,
    }
  })

  const withRevenue = smes.filter((sme) => sme.revenueChange !== null)
  const revenueStart = withRevenue.reduce((sum, sme) => sum + (sme.revenueStart || 0), 0)
  const revenueLatest = withRevenue.reduce((sum, sme) => sum + (sme.revenueLatest || 0), 0)
  const withJobs = smes.filter((sme) => sme.jobsChange !== null)

  // Only interventions for SMEs still in scope (not discontinued, in the selected programme).
  const activeIds = new Set(participants.map((row) => row.id))
  const completedAssignments = assignments.filter((assignment) => assignment.completed && activeIds.has(assignment.participantId))
  const outcomes = emptyBuckets()
  const areaMap = new Map<string, AreaOutcome>()
  completedAssignments.forEach((assignment) => {
    const bucket = assignment.outcome || 'no_checkback'
    outcomes[bucket] += 1
    const area = areaMap.get(assignment.areaOfSupport) || { area: assignment.areaOfSupport, achievedConfirmed: 0, ...emptyBuckets() }
    area[bucket] += 1
    areaMap.set(assignment.areaOfSupport, area)
  })
  const resultsRecorded = outcomes.achieved + outcomes.partially + outcomes.not_yet
  const answers = completedAssignments.flatMap((assignment) => assignment.answers)
  const achievedAssignments = completedAssignments.filter((assignment) => assignment.outcome === 'achieved')
  const checkbacks: CheckbackSummary = {
    answered: answers.length,
    viaWhatsapp: answers.filter((answer) => answer.via === 'whatsapp').length,
    overdue: completedAssignments.filter((assignment) => assignment.checkbackOverdue).length,
    achievedFirstTime: achievedAssignments.filter((assignment) => assignment.answers.length <= 1).length,
    achievedAfterRecheck: achievedAssignments.filter((assignment) => assignment.answers.length > 1).length,
  }

  // The SME's side, compared round by round: the facilitator's Nth answer is round N.
  const smeAnswers = completedAssignments.flatMap((assignment) => assignment.smeAnswers)
  let pairs = 0
  let agreed = 0
  completedAssignments.forEach((assignment) => assignment.answers.forEach((answer, index) => {
    const sme = assignment.smeAnswers.find((entry) => entry.round === index + 1)
    if (!sme) return
    pairs += 1
    if (SME_ANSWER_MATCHES[sme.answer] === answer.result) agreed += 1
  }))
  const smeForAchievingRound = (assignment: Assignment) => assignment.smeAnswers.find((entry) => entry.round === assignment.answers.length)
  const participantNames = new Map(participants.map((row) => [row.id, text(row.businessName || row.participantName) || 'Unnamed SME']))
  const smeCheckbacks: SmeCheckbackSummary = {
    answered: smeAnswers.length,
    viaWhatsapp: smeAnswers.filter((entry) => entry.via === 'whatsapp').length,
    pairs,
    agreed,
    agreementRate: pairs ? Math.round((agreed / pairs) * 100) : null,
    facilitatorRounds: answers.length,
    confirmedAchieved: achievedAssignments.filter((assignment) => smeForAchievingRound(assignment)?.answer === 'yes').length,
    disputes: achievedAssignments
      .filter((assignment) => smeForAchievingRound(assignment)?.answer === 'no')
      .map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        smeName: participantNames.get(assignment.participantId) || 'Unnamed SME',
        note: smeForAchievingRound(assignment)?.note || null,
      })),
  }
  // Per area, how many of the achieved ones the SME confirmed (a subset of `achieved`).
  achievedAssignments.forEach((assignment) => {
    if (smeForAchievingRound(assignment)?.answer !== 'yes') return
    const area = areaMap.get(assignment.areaOfSupport)
    if (area) area.achievedConfirmed += 1
  })

  const compared = smes.filter((sme) => sme.beforeAfterChange !== null)
  const served = withRevenue.filter((sme) => sme.completedInterventions > 0)
  const notServed = withRevenue.filter((sme) => sme.completedInterventions === 0)

  return {
    smes: smes.sort((left, right) => (right.revenueChange ?? -Infinity) - (left.revenueChange ?? -Infinity) || left.name.localeCompare(right.name)),
    totalSmes: smes.length,
    smesWithRevenue: withRevenue.length,
    revenueStart,
    revenueLatest,
    revenueGrowth: percentChange(revenueStart, revenueLatest),
    netJobs: withJobs.reduce((sum, sme) => sum + (sme.jobsChange || 0), 0),
    smesWithJobs: withJobs.length,
    growingSmes: withRevenue.filter((sme) => (sme.revenueChange || 0) > 0).length,
    completedInterventions: completedAssignments.length,
    outcomes,
    checkbacks,
    smeCheckbacks,
    achievedRate: resultsRecorded ? Math.round((outcomes.achieved / resultsRecorded) * 100) : null,
    areas: [...areaMap.values()].sort((left, right) =>
      OUTCOME_BUCKETS.reduce((sum, key) => sum + right[key], 0) - OUTCOME_BUCKETS.reduce((sum, key) => sum + left[key], 0)),
    beforeAfter: {
      count: compared.length,
      medianChange: median(compared.map((sme) => sme.beforeAfterChange as number)),
      improved: compared.filter((sme) => (sme.beforeAfterChange || 0) > 0).length,
    },
    servedGrowth: median(served.map((sme) => sme.revenueChange as number)),
    notServedGrowth: median(notServed.map((sme) => sme.revenueChange as number)),
    servedCount: served.length,
    notServedCount: notServed.length,
  }
}

/** How many months either side of the first completed intervention the before-and-after comparison uses. */
export const BEFORE_AFTER_WINDOW_MONTHS = BEFORE_AFTER_MONTHS
