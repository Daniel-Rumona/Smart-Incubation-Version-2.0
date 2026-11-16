import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore'
import { DEFAULT_IMPACT_SETTINGS, measureAll, type ImpactSme, type ImpactTreatment } from './matchedImpactLogic.js'

/*
 * Agent watches and chasers, checked nightly (notifyAgentWatches in index.ts).
 *
 * The AI page's agent stores them in `agentWatches` (ai-backend/agent_watches.py) after the user
 * confirms. This run reads data the app already holds and, when something happens, posts a card into
 * the owner's AI chat (`agentChatMessages`) plus a bell notification (`staffNotifications`).
 *
 * Watches (kind 'watch'):
 *   - subject 'sme': SMEs matching the filters (city, province, programme) and ALL conditions
 *     (risk level, no session booked within N days, overdue interventions, compliance attention).
 *     Fires for SMEs that newly match; an SME that stops matching can fire again later. Runs until endsAt.
 *   - subject 'intervention_reportable': fires once when the intervention's matched impact (revenue or
 *     jobs) becomes reportable, then the watch is done.
 *   - subject 'assignments_completed': fires once when every listed assignment is complete, then done.
 * Chasers (kind 'chaser'): a list of assignments to get accepted (facilitator and SME) or completed
 * (SME-confirmed) by a date. Each night, whoever is holding an item up gets an in-app reminder (the
 * same `intervention_reminder` notification the Remind button writes), up to `nudgesEach` per party,
 * spaced out. Progress is reported when it changes. When a party is out of nudges, or the date passes
 * with items outstanding, the agent asks once whether to escalate (the answer goes through ai-backend).
 * When everything is done the chaser stops.
 *
 * Firestore access is injected (deps.db) so this file has no dependency on index.ts.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDoc = Record<string, any>

export type WatchRunDeps = {
  db: Firestore
  now?: Date
  /** Evaluate and report counts without writing anything. */
  dryRun?: boolean
  /** Only this company (manual trigger by a non-platform admin). */
  companyCode?: string
}

export type WatchRunResult = { checked: number, cards: number, nudges: number, finished: number, errors: number }

const DAY_MS = 24 * 60 * 60 * 1000
const SA_OFFSET_MS = 2 * 60 * 60 * 1000 // Africa/Johannesburg, no daylight saving
const MAX_CARD_ITEMS = 12
const INACTIVE_APPOINTMENT = new Set(['cancelled', 'canceled', 'declined'])
const CLOSED_ASSIGNMENT = new Set(['cancelled', 'canceled', 'declined', 'superseded'])
const COMPLIANCE_ATTENTION = new Set(['missing', 'pending', 'rejected', 'invalid', 'expired', 'queried'])

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()
const text = (value: unknown) => String(value ?? '').trim()

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (value instanceof Timestamp) return value.toDate()
  if (typeof value === 'object' && value !== null) {
    const stamp = value as { toDate?: () => Date, seconds?: number, _seconds?: number }
    if (typeof stamp.toDate === 'function') return stamp.toDate()
    const seconds = stamp.seconds ?? stamp._seconds
    if (typeof seconds === 'number') return new Date(seconds * 1000)
    return null
  }
  const parsed = new Date(value as string | number)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** Same reading as the app's toMetricNumber: plain numbers, "R 12 000", or { permanent, temporary }. */
const toMetricNumber = (...values: unknown[]): number => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object') {
      const split = value as AnyDoc
      if (split.permanent !== undefined || split.temporary !== undefined) {
        const sum = (Number(split.permanent) || 0) + (Number(split.temporary) || 0)
        if (sum > 0) return sum
      }
      const nested = toMetricNumber(split.value, split.total, split.count, split.headcount, split.staffCount, split.numberOfEmployees)
      if (nested > 0) return nested
    }
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** South African calendar day / month of an instant. */
const saDay = (date: Date) => new Date(date.getTime() + SA_OFFSET_MS).toISOString().slice(0, 10)
const saMonth = (date: Date) => saDay(date).slice(0, 7)
const shortDate = (date: Date) => new Date(date.getTime() + SA_OFFSET_MS)
  .toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })

const participantIdOf = (row: AnyDoc) => text(row.participantId || row.smmeId || row.smeId)
const smeName = (row: AnyDoc) => text(row.businessName || row.participantName || row.beneficiaryName) || 'SME'

// The director dashboard's delivery rule (src/services/directorPortfolioService.ts isAssignmentCompleted).
export const isAssignmentCompleted = (row: AnyDoc) =>
  lower(row.status) === 'completed'
  || lower(row.completionStatus) === 'completed'
  || (lower(row.assigneeCompletionStatus) === 'done' && lower(row.participantCompletionStatus) === 'confirmed')
  || toMetricNumber(row.progress) >= 100

const isClosedAssignment = (row: AnyDoc) =>
  CLOSED_ASSIGNMENT.has(lower(row.status)) || lower(row.assigneeStatus) === 'declined' || lower(row.participantStatus) === 'declined'

// ---- the director dashboard's risk inputs, ported as-is from src/services/directorPortfolioService.ts ----

/** Its toNumber: the first value that is set, even if it reads as 0 ("45%" reads as 45). */
const dashboardNumber = (...values: unknown[]) => {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

/** Its monthlySeries: a { "YYYY-MM": number } map, or the legacy array shape, month-sorted. */
const dashboardSeries = (history: unknown): Array<{ key: string, value: number }> => {
  if (history && typeof history === 'object' && !Array.isArray(history) && 'monthly' in history) {
    return Object.entries(((history as AnyDoc).monthly || {}) as AnyDoc)
      .map(([key, value]) => ({ key, value: dashboardNumber(value) }))
      .filter((entry) => /^\d{4}-\d{2}$/.test(entry.key) && entry.value > 0)
      .sort((a, b) => a.key.localeCompare(b.key))
  }
  if (Array.isArray(history)) {
    return (history as AnyDoc[])
      .map((item) => ({ key: String(item.month || item.period || ''), value: dashboardNumber(item.revenue, item.amount, item.value) }))
      .filter((entry) => entry.value > 0)
  }
  return []
}

/**
 * Its getLatestPerformance: progress and growth read off the SME's newest monthly report. When there is
 * a report, these are numbers (0 when the report has no such field); with no report they are undefined.
 */
export type LatestPerformance = { progress?: number, growthRate?: number }

export const latestPerformanceFrom = (report: AnyDoc | undefined): LatestPerformance => report
  ? {
    progress: dashboardNumber(report.progress, report.overallProgress, report.score, report.overallScore),
    growthRate: dashboardNumber(report.growthRate, report.revenueGrowthRate, report.growth),
  }
  : {}

const monthlyEntries = (monthly: unknown) => Object.entries((monthly || {}) as AnyDoc)
  .map(([period, raw]) => {
    const match = period.trim().match(/^(\d{4})-(\d{1,2})$/)
    return match ? { period: `${match[1]}-${match[2].padStart(2, '0')}`, value: toMetricNumber(raw) } : null
  })
  .filter((entry): entry is { period: string, value: number } => Boolean(entry && entry.value > 0))
  .sort((a, b) => a.period.localeCompare(b.period))

/**
 * Risk exactly as the director dashboard derives it (directorPortfolioService listDirectorPortfolio and
 * deriveRisk): progress below 45% or growth below 20% is High; below 65% / 40% is Medium.
 * Progress: the newest monthly report's figure, else the SME's stored figure, else the average over ALL
 * its assignments (completed = 100). Growth: the report's, else the SME's stored rate, else latest vs
 * earliest of the last seven months of revenue. As on the dashboard, a report that exists but has no
 * progress (or growth) field counts as 0 there, which skips the stored figure and uses the derived one.
 */
export const riskLevel = (participant: AnyDoc, assignments: AnyDoc[], latest: LatestPerformance = {}): 'high' | 'medium' | 'low' => {
  const derivedProgress = assignments.length
    ? Math.round(assignments.reduce((sum, row) => sum + (isAssignmentCompleted(row) ? 100 : Math.min(dashboardNumber(row.progress), 100)), 0) / assignments.length)
    : 0
  const progress = Math.max(0, Math.min(100, dashboardNumber(latest.progress, participant.progress, participant.overallProgress, participant.kpiProgress, participant.score, participant.overallScore) || derivedProgress))
  const recent = dashboardSeries(participant.revenueHistory).slice(-7)
  let derivedGrowth = 0
  if (recent.length >= 2) {
    const first = recent[0].value
    const last = recent[recent.length - 1].value
    derivedGrowth = first <= 0 ? (last > 0 ? 100 : 0) : Math.round(((last - first) / first) * 100)
  }
  const growth = dashboardNumber(latest.growthRate, participant.growthRate, participant.revenueGrowthRate) || derivedGrowth
  if (progress < 45 || growth < 20) return 'high'
  if (progress < 65 || growth < 40) return 'medium'
  return 'low'
}

// --------------------------------------------------------------------------- company data (loaded once per run)

type CompanyData = {
  participants?: AnyDoc[]
  assignments?: AnyDoc[]
  appointments?: AnyDoc[]
  compliance?: AnyDoc[]
  reportable?: Map<string, Set<string>>
}

class CompanyCache {
  private data = new Map<string, CompanyData>()
  constructor(private db: Firestore, private now: Date) {}

  private entry(company: string) {
    const existing = this.data.get(company)
    if (existing) return existing
    const created: CompanyData = {}
    this.data.set(company, created)
    return created
  }

  private async byCompany(collection: string, company: string) {
    const snap = await this.db.collection(collection).where('companyCode', '==', company).get()
    return snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as AnyDoc)
  }

  async participants(company: string) {
    const entry = this.entry(company)
    entry.participants ??= (await this.byCompany('participants', company)).filter((row) => !toDate(row.participantDiscontinuedAt) && !toDate(row.discontinuedAt))
    return entry.participants
  }

  async assignments(company: string) {
    const entry = this.entry(company)
    entry.assignments ??= (await this.byCompany('assignedInterventions', company)).filter((row) => !toDate(row.participantDiscontinuedAt))
    return entry.assignments
  }

  async assignmentById(company: string, id: string) {
    return (await this.assignments(company)).find((row) => row.id === id) || null
  }

  /** Active appointments from today on (the longest look-ahead a watch can ask for is 90 days). */
  async upcomingAppointments(company: string) {
    const entry = this.entry(company)
    if (!entry.appointments) {
      const start = new Date(this.now.getTime() - DAY_MS)
      const end = new Date(this.now.getTime() + 91 * DAY_MS)
      const snap = await this.db.collection('appointments').where('startTime', '>=', start).where('startTime', '<', end).get()
      entry.appointments = snap.docs.map((doc) => ({ ...doc.data(), id: doc.id }) as AnyDoc)
        .filter((row) => row.companyCode === company && !INACTIVE_APPOINTMENT.has(lower(row.status)))
    }
    return entry.appointments
  }

  /** The SME's newest monthly report (by createdAt), as the director dashboard reads it for risk. */
  private latest = new Map<string, Promise<LatestPerformance>>()

  latestPerformance(participantId: string): Promise<LatestPerformance> {
    let pending = this.latest.get(participantId)
    if (!pending) {
      pending = this.readLatestPerformance(participantId)
      this.latest.set(participantId, pending)
    }
    return pending
  }

  private async readLatestPerformance(participantId: string): Promise<LatestPerformance> {
    try {
      const snap = await this.db.collection('monthlyPerformance').doc(participantId).collection('history')
        .orderBy('createdAt', 'desc').limit(1).get()
      return latestPerformanceFrom(snap.docs[0]?.data())
    } catch (error) {
      console.warn('[agentWatches] latest monthly report unreadable for', participantId, error)
      return {}
    }
  }

  async compliance(company: string) {
    const entry = this.entry(company)
    entry.compliance ??= await this.byCompany('complianceDocuments', company)
    return entry.compliance
  }

  /** interventionId -> programme ids where its revenue or jobs impact is reportable. */
  async reportable(company: string) {
    const entry = this.entry(company)
    if (entry.reportable) return entry.reportable
    const participants = await this.participants(company)
    const assignments = await this.assignments(company)
    const reports = await Promise.all(participants.map((row) => this.monthlyReports(row.id)))
    const thisMonth = saMonth(this.now)
    const programOf = new Map(participants.map((row) => [row.id as string, text(row.programId)]))
    const treatments: ImpactTreatment[] = []
    assignments.forEach((row) => {
      const participantId = participantIdOf(row)
      const completedAt = toDate(row.completedAt || row.completionConfirmedAt)
      const smeConfirmed = ['confirmed', 'completed', 'done'].includes(lower(row.participantCompletionStatus)) || Boolean(row.completionConfirmedAt)
      const eligible = !isClosedAssignment(row)
      if (!eligible || !smeConfirmed || !completedAt || completedAt > this.now || !text(row.interventionId) || !programOf.has(participantId)) return
      const programId = text(row.programId) || programOf.get(participantId)!
      if (programId !== programOf.get(participantId)) return
      treatments.push({ participantId, programId, interventionId: text(row.interventionId), interventionTitle: text(row.interventionTitle || row.title), month: saMonth(completedAt), outcome: null })
    })
    const values = (metric: 'revenue' | 'jobs', row: AnyDoc, index: number) => {
      const stored = monthlyEntries(metric === 'revenue' ? row.revenueHistory?.monthly : row.headcountHistory?.monthly)
      const merged: Record<string, number> = Object.fromEntries(stored.map((entry) => [entry.period, entry.value]))
      Object.assign(merged, metric === 'revenue' ? reports[index].revenue : reports[index].headcount)
      return Object.fromEntries(Object.entries(merged).filter(([period]) => period < thisMonth))
    }
    const result = new Map<string, Set<string>>()
    for (const metric of ['revenue', 'jobs'] as const) {
      const smes: ImpactSme[] = participants.map((row, index) => ({
        id: row.id, programId: text(row.programId), sector: lower(row.sector || row.industry),
        synthetic: row.synthetic === true || row.isSynthetic === true || row.isDemo === true || row.seeded === true || Boolean(row.seedBatch || row.seedTag),
        values: values(metric, row, index),
      }))
      measureAll(smes, treatments, DEFAULT_IMPACT_SETTINGS, metric).forEach((item) => {
        if (item.status !== 'reportable') return
        const programmes = result.get(item.interventionId) || new Set<string>()
        programmes.add(item.programId)
        result.set(item.interventionId, programmes)
      })
    }
    entry.reportable = result
    return result
  }

  /** The SME's own monthly reports (revenue, permanent + temporary jobs) by YYYY-MM. */
  private async monthlyReports(participantId: string) {
    const revenue: Record<string, number> = {}
    const headcount: Record<string, number> = {}
    try {
      const snap = await this.db.collection('monthlyPerformance').doc(participantId).collection('history').get()
      snap.docs.forEach((doc) => {
        const row = doc.data() as AnyDoc
        const period = reportPeriod(row, doc.id)
        if (!period) return
        const amount = Number(row.revenue)
        if (Number.isFinite(amount) && amount > 0) revenue[period] = amount
        const permanent = row.headPermanent === undefined || row.headPermanent === null || row.headPermanent === '' ? null : Number(row.headPermanent)
        const temporary = row.headTemporary === undefined || row.headTemporary === null || row.headTemporary === '' ? null : Number(row.headTemporary)
        if (permanent === null && temporary === null) return
        const total = (Number.isFinite(permanent) ? permanent || 0 : 0) + (Number.isFinite(temporary) ? temporary || 0 : 0)
        if (total > 0) headcount[period] = total
      })
    } catch (error) {
      console.warn('[agentWatches] monthly reports unreadable for', participantId, error)
    }
    return { revenue, headcount }
  }
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

/** "January 2026" or "2026-01" (the report's month field or document id) as YYYY-MM. */
const reportPeriod = (row: AnyDoc, id: string): string | null => {
  const raw = text(row.month || id)
  const iso = raw.match(/^(\d{4})-(\d{1,2})$/)
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}`
  const [name = '', yearText] = raw.toLowerCase().split(/\s+/)
  const index = MONTH_NAMES.findIndex((month) => month === name || (name.length >= 3 && month.startsWith(name)))
  if (index < 0) return null
  const year = Number(yearText) || toDate(row.createdAt)?.getUTCFullYear()
  return year ? `${year}-${String(index + 1).padStart(2, '0')}` : null
}

// --------------------------------------------------------------------------- watch evaluation

type Condition =
  | { type: 'risk', level: 'high' | 'medium' | 'low' }
  | { type: 'no_session_within_days', days: number }
  | { type: 'overdue_interventions' }
  | { type: 'compliance_attention' }

type Match = { id: string, name: string, reasons: string[] }

const startOfSaDay = (now: Date) => new Date(`${saDay(now)}T00:00:00+02:00`)

export const evaluateSmeWatch = async (watch: AnyDoc, cache: CompanyCache, now: Date): Promise<Match[]> => {
  const company = text(watch.companyCode)
  const filters = (watch.filters || {}) as AnyDoc
  const conditions = (Array.isArray(watch.conditions) ? watch.conditions : []) as Condition[]
  const [participants, assignments] = await Promise.all([cache.participants(company), cache.assignments(company)])
  const byParticipant = new Map<string, AnyDoc[]>()
  assignments.forEach((row) => {
    const id = participantIdOf(row)
    byParticipant.set(id, [...(byParticipant.get(id) || []), row])
  })
  const city = lower(filters.city)
  const province = lower(filters.province)
  const programme = lower(filters.programName)
  const onlyIds = Array.isArray(filters.participantIds) && filters.participantIds.length ? new Set(filters.participantIds.map(String)) : null
  // A facilitator's watch only covers SMEs they deliver to.
  const assigneeId = text(watch.assigneeId)
  const today = startOfSaDay(now)
  const needsAppointments = conditions.some((item) => item.type === 'no_session_within_days')
  const needsCompliance = conditions.some((item) => item.type === 'compliance_attention')
  const appointments = needsAppointments ? await cache.upcomingAppointments(company) : []
  const compliance = needsCompliance ? await cache.compliance(company) : []

  const matches: Match[] = []
  for (const participant of participants) {
    const id = participant.id as string
    const own = byParticipant.get(id) || []
    if (onlyIds && !onlyIds.has(id)) continue
    if (city && !lower(participant.city || participant.businessAddressCity || participant.town).includes(city)) continue
    if (province && !lower(participant.province || participant.businessAddressProvince).includes(province)) continue
    if (programme && !lower(participant.programName).includes(programme) && lower(participant.programId) !== programme) continue
    if (assigneeId && !own.some((row) => row.assigneeId === assigneeId)) continue

    const reasons: string[] = []
    let ok = true
    for (const condition of conditions) {
      if (condition.type === 'risk') {
        // All assignments, as the dashboard counts them; the report is read only for SMEs that get this far.
        const level = riskLevel(participant, own, await cache.latestPerformance(id))
        ok = level === condition.level
        if (ok) reasons.push(`${level.charAt(0).toUpperCase()}${level.slice(1)} risk`)
      } else if (condition.type === 'no_session_within_days') {
        const days = Math.max(1, Math.min(90, Math.round(Number(condition.days) || 14)))
        const until = new Date(now.getTime() + days * DAY_MS)
        ok = !appointments.some((row) => row.participantId === id && (toDate(row.startTime) || 0) >= now && (toDate(row.startTime) || 0) < until)
        if (ok) reasons.push(`no session booked in the next ${days} days`)
      } else if (condition.type === 'overdue_interventions') {
        const overdue = own.filter((row) => !isClosedAssignment(row) && !isAssignmentCompleted(row) && (toDate(row.dueDate) || today) < today).length
        ok = overdue > 0
        if (ok) reasons.push(`${overdue} overdue intervention${overdue === 1 ? '' : 's'}`)
      } else if (condition.type === 'compliance_attention') {
        const issues = compliance.filter((row) => row.participantId === id
          && (COMPLIANCE_ATTENTION.has(lower(row.status)) || ((toDate(row.expiryDate) || now) < now))).length
        ok = issues > 0
        if (ok) reasons.push(`${issues} compliance document${issues === 1 ? '' : 's'} need attention`)
      } else {
        ok = false
      }
      if (!ok) break
    }
    if (ok && conditions.length) matches.push({ id, name: smeName(participant), reasons })
  }
  return matches
}

// --------------------------------------------------------------------------- chasers

type Party = 'facilitator' | 'sme'
type ChaserItem = {
  assignmentId: string
  title: string
  participantName: string
  assigneeName: string
  done: boolean
  nudges: Record<Party, number>
  lastNudgedAt: string | null
}

/** Who is holding the item up for this goal; empty when it's done. */
export const blockingParties = (row: AnyDoc, goal: 'accepted' | 'completed'): Party[] => {
  if (goal === 'completed') {
    if (isAssignmentCompleted(row)) return []
    if (lower(row.assigneeCompletionStatus) !== 'done') return ['facilitator']
    return ['sme']
  }
  const parties: Party[] = []
  if (lower(row.assigneeStatus) !== 'accepted') parties.push('facilitator')
  if (lower(row.participantStatus) !== 'accepted') parties.push('sme')
  return parties
}

/** Space nudges out: every two days, daily in the last three days before the deadline. */
const nudgeDue = (item: ChaserItem, now: Date, dueAt: Date) => {
  if (!item.lastNudgedAt) return true
  const gap = dueAt.getTime() - now.getTime() <= 3 * DAY_MS ? DAY_MS : 2 * DAY_MS
  return now.getTime() - new Date(item.lastNudgedAt).getTime() >= gap - 60 * 60 * 1000
}

const reminderDoc = (watch: AnyDoc, row: AnyDoc, party: Party, dueAt: Date, goal: 'accepted' | 'completed') => {
  const title = text(row.interventionTitle) || 'Intervention'
  const participantName = smeName(row)
  const assigneeName = text(row.assigneeName) || 'assignee'
  const by = shortDate(dueAt)
  const reason = goal === 'accepted'
    ? party === 'facilitator' ? `please accept this assignment by ${by}` : `please review and accept this intervention by ${by}`
    : party === 'facilitator' ? `please complete and mark this done by ${by}` : `please confirm this intervention is complete by ${by}`
  const message = `${title} needs attention: ${reason}`
  // Same shape as the Remind button (src/services/assignedInterventionsService.ts createInterventionReminder).
  return {
    companyCode: watch.companyCode || null,
    participantId: participantIdOf(row) || null,
    interventionId: row.interventionId || row.id || null,
    interventionTitle: title,
    assignedInterventionId: row.id || null,
    type: 'intervention_reminder',
    recipientRoles: [party === 'facilitator' ? 'consultant' : 'incubatee'],
    message: {
      incubatee: message,
      consultant: `${title} for ${participantName} needs attention: ${reason}`,
      operations: `${title} assigned to ${assigneeName} needs attention: ${reason}`,
      projectadmin: `${title} assigned to ${assigneeName} needs attention: ${reason}`,
    },
    reminderReason: reason,
    source: 'agent_chaser',
    chaserId: watch.id,
    createdAt: FieldValue.serverTimestamp(),
    createdByUid: watch.uid || null,
    readBy: {},
  }
}

// --------------------------------------------------------------------------- run

type Card = { type: string, title: string, body?: string, items?: Array<{ label: string, detail?: string, state?: string }> }

const cardText = (card: Card) => [card.title, card.body, ...(card.items || []).map((item) => `- ${item.label}${item.detail ? `: ${item.detail}` : ''}`)]
  .filter(Boolean).join('\n')

export const runAgentWatches = async (deps: WatchRunDeps): Promise<WatchRunResult> => {
  const { db } = deps
  const now = deps.now || new Date()
  const result: WatchRunResult = { checked: 0, cards: 0, nudges: 0, finished: 0, errors: 0 }
  let watchQuery = db.collection('agentWatches').where('status', '==', 'active')
  if (deps.companyCode) watchQuery = watchQuery.where('companyCode', '==', deps.companyCode)
  const snap = await watchQuery.get()
  const cache = new CompanyCache(db, now)

  for (const doc of snap.docs) {
    const watch = { ...doc.data(), id: doc.id } as AnyDoc
    result.checked += 1
    const cards: Card[] = []
    const update: AnyDoc = { lastRunAt: FieldValue.serverTimestamp(), runCount: FieldValue.increment(1) }
    const reminders: AnyDoc[] = []
    try {
      if (!text(watch.companyCode) || !text(watch.uid)) {
        update.status = 'stopped'
      } else if (watch.kind === 'chaser') {
        await runChaser(watch, cache, now, cards, update, reminders)
      } else {
        await runWatch(watch, cache, now, cards, update)
      }
    } catch (error) {
      result.errors += 1
      console.error('[agentWatches] watch failed', doc.id, error)
      continue
    }
    if (update.status && update.status !== 'active') result.finished += 1
    result.cards += cards.length
    result.nudges += reminders.length
    if (deps.dryRun) continue

    const batch = db.batch()
    const messageRefs = cards.map((_, index) => db.collection('agentChatMessages').doc(`watch_${doc.id}_${now.getTime()}_${index}`))
    const askIndex = cards.findIndex((card) => card.type === 'chaser_escalation')
    // The escalation card's id is kept so the user's answer can be shown on it.
    if (askIndex >= 0 && update.escalation) update.escalation = { ...update.escalation, messageId: messageRefs[askIndex].id }
    batch.update(doc.ref, { ...update, updatedAt: FieldValue.serverTimestamp() })
    reminders.forEach((reminder) => batch.set(db.collection('notifications').doc(), reminder))
    cards.forEach((card, index) => {
      const messageRef = messageRefs[index]
      batch.set(messageRef, {
        uid: watch.uid, companyCode: watch.companyCode, role: 'agent', source: 'agent_watch',
        content: cardText(card).slice(0, 4000),
        card: { ...card, watchId: doc.id, items: (card.items || []).slice(0, MAX_CARD_ITEMS) },
        createdAt: FieldValue.serverTimestamp(),
      })
      batch.set(db.collection('staffNotifications').doc(), {
        recipientUid: watch.uid, companyCode: watch.companyCode, type: 'agent_watch',
        title: card.title, body: card.body || (card.items || []).slice(0, 3).map((item) => item.label).join('\n'),
        watchId: doc.id, readAt: null, createdAt: FieldValue.serverTimestamp(),
      })
    })
    await batch.commit()
  }
  return result
}

const runWatch = async (watch: AnyDoc, cache: CompanyCache, now: Date, cards: Card[], update: AnyDoc) => {
  const company = text(watch.companyCode)
  const title = text(watch.title) || 'Your watch'
  const endsAt = toDate(watch.endsAt)

  if (watch.subject === 'intervention_reportable') {
    const reportable = await cache.reportable(company)
    const programmes = reportable.get(text(watch.interventionId))
    const programId = text(watch.programId)
    if (programmes && (!programId || programmes.has(programId))) {
      cards.push({ type: 'watch_fired', title: `${text(watch.interventionTitle) || 'The intervention'} now has enough data to show its impact`,
        body: 'Enough SMEs have completed it, with enough comparable SMEs, to report the change in revenue or jobs on Impact analysis. I have stopped this watch.' })
      update.status = 'done'
      return
    }
  } else if (watch.subject === 'assignments_completed') {
    const ids = (Array.isArray(watch.assignmentIds) ? watch.assignmentIds : []).map(String)
    const rows = await Promise.all(ids.map((id) => cache.assignmentById(company, id)))
    const live = rows.filter((row): row is AnyDoc => Boolean(row) && !isClosedAssignment(row as AnyDoc))
    if (live.length && live.every(isAssignmentCompleted)) {
      cards.push({ type: 'watch_fired', title: `${title}: all complete`, body: 'Everything on this watch is now complete. I have stopped watching.',
        items: live.map((row) => ({ label: text(row.interventionTitle) || 'Intervention', detail: smeName(row), state: 'done' })) })
      update.status = 'done'
      return
    }
  } else {
    const matches = await evaluateSmeWatch(watch, cache, now)
    const matchIds = new Set(matches.map((item) => item.id))
    const notified = new Set((Array.isArray(watch.notifiedIds) ? watch.notifiedIds : []).map(String))
    const fresh = matches.filter((item) => !notified.has(item.id))
    if (fresh.length) {
      cards.push({ type: 'watch_fired', title: `${title}: ${fresh.length} SME${fresh.length === 1 ? '' : 's'} now match`,
        body: text(watch.request) ? `You asked: “${text(watch.request).slice(0, 200)}”` : undefined,
        items: fresh.map((item) => ({ label: item.name, detail: item.reasons.join(' · '), state: 'match' })) })
    }
    // Keep only SMEs that still match, so one that drops out and comes back is reported again.
    update.notifiedIds = [...notified].filter((id) => matchIds.has(id)).concat(fresh.map((item) => item.id)).slice(0, 2000)
  }

  if (endsAt && endsAt <= now) {
    cards.push({ type: 'watch_ended', title: `Stopped watching: ${title}`, body: 'This watch reached its end date. Ask me if you want to keep watching.' })
    update.status = 'expired'
  }
}

const runChaser = async (watch: AnyDoc, cache: CompanyCache, now: Date, cards: Card[], update: AnyDoc, reminders: AnyDoc[]) => {
  const company = text(watch.companyCode)
  const goal: 'accepted' | 'completed' = watch.goal === 'completed' ? 'completed' : 'accepted'
  const goalWord = goal === 'accepted' ? 'accepted' : 'completed'
  const dueAt = toDate(watch.dueAt) || new Date(now.getTime() + DAY_MS)
  const allowance = Math.max(0, Math.min(5, Math.round(Number(watch.nudgesEach ?? 2))))
  const title = text(watch.title) || 'Chaser'
  const items = (Array.isArray(watch.items) ? watch.items : []) as ChaserItem[]
  const escalation = (watch.escalation || { status: 'none' }) as AnyDoc
  const pastDue = now > dueAt

  let newlyDone = 0
  let nudgedNow = 0
  const stuck: Array<{ item: ChaserItem, parties: Party[] }> = []
  const nextItems: ChaserItem[] = []
  const rows: AnyDoc[] = []
  for (const original of items) {
    const item: ChaserItem = { ...original, nudges: { facilitator: original.nudges?.facilitator || 0, sme: original.nudges?.sme || 0 } }
    const row = await cache.assignmentById(company, item.assignmentId)
    rows.push(row || {})
    if (!row || isClosedAssignment(row)) {
      // Removed or declined: nothing left to chase on it.
      if (!item.done) newlyDone += 1
      nextItems.push({ ...item, done: true })
      continue
    }
    const parties = blockingParties(row, goal)
    if (!parties.length) {
      if (!item.done) newlyDone += 1
      nextItems.push({ ...item, done: true })
      continue
    }
    item.done = false
    if (!pastDue && nudgeDue(item, now, dueAt)) {
      let sent = false
      for (const party of parties) {
        if (item.nudges[party] >= allowance) continue
        reminders.push(reminderDoc(watch, row, party, dueAt, goal))
        item.nudges[party] += 1
        sent = true
      }
      if (sent) {
        item.lastNudgedAt = now.toISOString()
        nudgedNow += 1
      }
    }
    const exhausted = parties.filter((party) => item.nudges[party] >= allowance)
    if (exhausted.length) stuck.push({ item, parties: exhausted })
    nextItems.push(item)
  }
  update.items = nextItems

  const done = nextItems.filter((item) => item.done).length
  const total = nextItems.length
  const lines = nextItems.map((item) => {
    const nudges = item.nudges.facilitator + item.nudges.sme
    return {
      label: `${item.title} · ${item.participantName}`,
      detail: item.done ? goalWord.charAt(0).toUpperCase() + goalWord.slice(1)
        : `Waiting on ${stuck.some((entry) => entry.item.assignmentId === item.assignmentId) ? 'a reply after every reminder' : 'a reply'}${nudges ? ` (${nudges} reminder${nudges === 1 ? '' : 's'} sent)` : ''}`,
      state: item.done ? 'done' : item.lastNudgedAt === now.toISOString() ? 'nudged' : stuck.some((entry) => entry.item.assignmentId === item.assignmentId) ? 'stuck' : 'waiting',
    }
  })

  if (done === total) {
    cards.push({ type: 'chaser_done', title: `${title}: all ${total} ${goalWord}`, body: 'Everything on this list is done, so I have stopped chasing.', items: lines })
    update.status = 'done'
    return
  }

  if (newlyDone || nudgedNow) {
    cards.push({ type: 'chaser_progress', title: `${title}: ${done} of ${total} ${goalWord}`,
      body: `${nudgedNow ? `I sent reminders on ${nudgedNow} item${nudgedNow === 1 ? '' : 's'} tonight. ` : ''}Due ${shortDate(dueAt)}.`, items: lines })
  }

  const needsAsk = escalation.status !== 'asked' && escalation.status !== 'escalated' && escalation.status !== 'declined'
  if (needsAsk && (stuck.length || pastDue)) {
    const outstanding = total - done
    cards.push({ type: 'chaser_escalation', title: pastDue ? `${title}: deadline passed with ${outstanding} outstanding` : `${title}: reminders used up on ${stuck.length} item${stuck.length === 1 ? '' : 's'}`,
      body: 'Shall I escalate the outstanding items to the programme lead? I will not do anything until you choose.',
      items: lines.filter((line) => line.state !== 'done') })
    update.escalation = { status: 'asked', askedAt: now.toISOString() }
  }

  // After the deadline the chaser has done all it can: stop it (an escalation answer still works).
  if (pastDue) {
    update.status = 'expired'
    if (!needsAsk) cards.push({ type: 'watch_ended', title: `Stopped chasing: ${title}`, body: `The deadline has passed with ${total - done} item${total - done === 1 ? '' : 's'} outstanding.`, items: lines.filter((line) => line.state !== 'done') })
  }
}
