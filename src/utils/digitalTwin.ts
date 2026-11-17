import { catalogueEntryFor, requirementKeyFor } from '@/config/complianceDocuments'
import { assessReadiness, type ReadinessBand, type ReadinessDocument } from '@/utils/readiness'
import type { LivePlanItem } from '@/utils/liveDiagnosticPlan'

/**
 * The digital twin's rules: one business's readiness through time, worked out from its own records by the same
 * readiness rules the control tower uses (src/utils/readiness.ts), so the twin and the control tower never disagree.
 *
 * - History: the rules are re-run at each past week with only what existed then (documents issued by that date,
 *   interventions completed by then, revenue reported up to that month).
 * - The days ahead ("on plan"): documents expire on their dates and each open intervention is delivered on its due
 *   date (overdue ones within OVERDUE_GRACE_DAYS). That is an assumption, and the screen says so.
 * - Moves: one change at a time (renew a document now, deliver an intervention sooner), replayed through the same
 *   rules and ranked by how much sooner the business becomes funding-ready.
 *
 * Pure: plain values in, plain values out, no Firestore, so it can also run in a nightly job later.
 */

export const WEEKS_BACK = 26
export const WEEKS_AHEAD = 26
export const OVERDUE_GRACE_DAYS = 14
const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS

export type TwinDocument = ReadinessDocument & { id: string; label: string; issuedAt: Date | null; expiresAt: Date | null }

export type TwinPlanItem = LivePlanItem & {
  /** When its open work is due (the latest due date of its live assignments). */
  dueAt: Date | null
  /** When it was completed, for completed items. */
  doneAt: Date | null
  /** When work on it first started (its first assignment). */
  startedAt: Date | null
}

export type TwinInput = {
  now: Date
  documents: TwinDocument[]
  plan: TwinPlanItem[]
  revenueMonthly: Array<{ period: string; value: number }>
  yearsOfTrading?: number | null
  digitalPresence?: Record<string, boolean | null | undefined>
}

export type TwinWeek = {
  offset: number
  date: Date
  funding: number
  market: number
  band: ReadinessBand
  /** The layers as they stood (or will stand) that week. */
  documentsValid: number
  documentsTotal: number
  delivered: number
  planTotal: number
  /** Latest monthly revenue reported by then, and its change since the first month recorded (percent). */
  revenue: number | null
  revenueChange: number | null
  /** Critical funding gates not met that week (missing or expiring documents). */
  criticalOpen: number
  /** Interventions past their due date and not delivered that week. */
  overdue: number
}

/** A change the twin can try. It edits the inputs as if it had happened, then the rules are re-run. */
export type TwinMove = {
  key: string
  title: string
  kind: 'Compliance' | 'Intervention'
  detail: string
  apply: (input: TwinInput) => TwinInput
}

export type RankedMove = {
  key: string
  title: string
  kind: TwinMove['kind']
  detail: string
  /** Weeks sooner it makes the business funding-ready, when it changes the date. */
  weeksSooner: number | null
  /** Funding readiness 12 weeks from now with this move, minus without it. */
  scoreGain: number
  /** The week (from now) this move alone makes it funding-ready, or null within the horizon. */
  readyOffset: number | null
}

export type TwinEvent = { date: Date; text: string; tone: 'due' | 'expiry' | 'renewed' }

const atWeek = (now: Date, offset: number) => new Date(now.getTime() + offset * WEEK_MS)
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

/** The plan as it stood (or will stand, on plan) on `date`. */
const planOn = (input: TwinInput, date: Date): LivePlanItem[] => input.plan.map((item) => {
  if (item.status === 'Declined' || item.status === 'Not assigned') return item
  const now = input.now.getTime()
  const when = date.getTime()
  if (item.status === 'Completed') {
    if (!item.doneAt || item.doneAt.getTime() <= when) return item
    return { ...item, status: item.startedAt && item.startedAt.getTime() <= when ? 'In progress' : 'Not started' }
  }
  if (when <= now) {
    if (when < now && item.startedAt && item.startedAt.getTime() > when) return { ...item, status: 'Not started' }
    return item
  }
  // The days ahead: delivered on its due date, overdue work within the grace period.
  const due = item.dueAt ? Math.max(item.dueAt.getTime(), item.dueAt.getTime() < now ? now + OVERDUE_GRACE_DAYS * DAY_MS : 0) : null
  if (due !== null && due <= when) return { ...item, status: 'Completed', progress: 100, outcome: undefined }
  return item
})

const documentsOn = (input: TwinInput, date: Date) => input.documents.filter((doc) => !doc.issuedAt || doc.issuedAt.getTime() <= date.getTime())

/** Readiness on one date, by the control tower's own rules. */
export const readinessOn = (input: TwinInput, date: Date) => {
  const result = assessReadiness({
    documents: documentsOn(input, date),
    planItems: planOn(input, date),
    revenueMonthly: input.revenueMonthly.filter((row) => row.period <= monthKey(date)),
    yearsOfTrading: input.yearsOfTrading,
    digitalPresence: input.digitalPresence,
    now: date,
  })
  return result
}

export const timeline = (input: TwinInput, from = -WEEKS_BACK, to = WEEKS_AHEAD): TwinWeek[] => {
  const weeks: TwinWeek[] = []
  for (let offset = from; offset <= to; offset++) {
    const date = atWeek(input.now, offset)
    const result = readinessOn(input, date)
    const documents = documentsOn(input, date)
    const plan = planOn(input, date).filter((item) => item.status !== 'Declined')
    const revenue = input.revenueMonthly.filter((row) => row.period <= monthKey(date))
    const last = revenue[revenue.length - 1]
    weeks.push({
      offset, date, funding: result.funding.score ?? 0, market: result.market.score ?? 0, band: result.funding.band,
      documentsValid: documents.filter((doc) => String(doc.currentStatus || '').toLowerCase() === 'valid' && (!doc.expiresAt || doc.expiresAt.getTime() > date.getTime())).length,
      documentsTotal: documents.length,
      delivered: plan.filter((item) => item.status === 'Completed').length,
      planTotal: plan.length,
      revenue: last ? last.value : null,
      revenueChange: revenue.length > 1 && revenue[0].value ? Math.round(((last.value - revenue[0].value) / Math.abs(revenue[0].value)) * 100) : null,
      criticalOpen: result.funding.gates.filter((gate) => gate.critical && gate.state !== 'met').length,
      overdue: planOn(input, date).filter((item, index) => !['Completed', 'Declined', 'Not assigned'].includes(item.status) && !!input.plan[index].dueAt && (input.plan[index].dueAt as Date).getTime() < date.getTime()).length,
    })
  }
  return weeks
}

/** The first week from now (0 = today) in which the business is funding-ready, or null within the horizon. */
export const readyWeek = (weeks: TwinWeek[]) => weeks.find((week) => week.offset >= 0 && week.band === 'ready')?.offset ?? null

/** A document's name as the platform's catalogue calls it (with its aliases), in lower case for a sentence. */
export const documentLabel = (doc: { key?: unknown; type?: unknown; documentName?: unknown }) => {
  const entry = catalogueEntryFor(doc.key) || catalogueEntryFor(doc.type)
  const name = entry?.name || String(doc.documentName || doc.type || doc.key || 'document').trim()
  return /^(B-BBEE|CIPC|ID)/.test(name) ? name : name[0].toLowerCase() + name.slice(1)
}
const documentKind = (doc: { key?: unknown; type?: unknown }) => requirementKeyFor(doc.key) || requirementKeyFor(doc.type)
const STATUS_RANK: Record<string, number> = { valid: 3, approved: 3, pending: 2, uploaded: 2, queried: 1 }
const rankOf = (doc: TwinDocument) => STATUS_RANK[String(doc.currentStatus || '').toLowerCase()] || 0

const short = (date: Date) => date.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' })

// The documents the readiness rules ask for (catalogue keys), so a missing one can be offered as a move.
const REQUIRED_DOCUMENTS = [
  { key: 'tax-compliance', label: 'tax compliance (PIN or clearance)' },
  { key: 'cipc-registration', label: 'CIPC registration' },
  { key: 'bank-confirmation', label: 'bank confirmation letter' },
  { key: 'b-bbee-certificate', label: 'B-BBEE certificate' },
]
const VERIFYING = ['pending', 'uploaded', 'queried']

/** Every move open to this business today. */
export const availableMoves = (input: TwinInput): TwinMove[] => {
  const now = input.now.getTime()
  const moves: TwinMove[] = []
  REQUIRED_DOCUMENTS.forEach((required) => {
    // Only when no document of that kind is on file at all; one awaiting verification gets its own move below.
    const onFile = input.documents.some((doc) => documentKind(doc) === required.key)
    if (onFile) return
    const expires = new Date(now + 365 * DAY_MS)
    moves.push({
      key: `upload:${required.key}`,
      title: `Upload a valid ${required.label}`,
      kind: 'Compliance',
      detail: 'not on file yet',
      apply: (current) => ({
        ...current,
        documents: [...current.documents, { id: `twin-${required.key}`, key: required.key, type: required.key, currentStatus: 'valid', expiryDate: expires, expiresAt: expires, issuedAt: current.now, label: required.label }],
      }),
    })
  })
  // One move per kind of document on file that is not in order, acting on the best copy of that kind.
  const best = new Map<string, TwinDocument>()
  input.documents.forEach((doc) => {
    const kind = documentKind(doc) || doc.id
    const held = best.get(kind)
    if (!held || rankOf(doc) > rankOf(held)) best.set(kind, doc)
  })
  best.forEach((doc) => {
    const status = String(doc.currentStatus || '').toLowerCase()
    const valid = status === 'valid' || status === 'approved'
    const expiring = valid && !!doc.expiresAt && doc.expiresAt.getTime() - now <= 120 * DAY_MS
    if (valid && !expiring) return
    const verifying = VERIFYING.includes(status)
    const renewed = new Date(now + 365 * DAY_MS)
    moves.push({
      key: `doc:${doc.id}`,
      title: verifying ? `Get the ${doc.label} verified` : valid ? `Renew the ${doc.label} before it expires` : `Replace the ${doc.label}`,
      kind: 'Compliance',
      detail: verifying ? (status === 'queried' ? 'uploaded, queried' : 'uploaded, awaiting verification') : valid && doc.expiresAt ? `expires ${short(doc.expiresAt)}` : status || 'not valid',
      // Verifying keeps the document's own expiry date; renewing or replacing gives a new one a year out.
      apply: (current) => ({
        ...current,
        documents: current.documents.map((row) => (row.id === doc.id
          ? (verifying ? { ...row, currentStatus: 'valid' } : { ...row, currentStatus: 'valid', expiryDate: renewed, expiresAt: renewed, issuedAt: current.now })
          : row)),
      }),
    })
  })
  const seen = new Set<string>()
  input.plan.forEach((item, index) => {
    if (['Completed', 'Declined', 'Not assigned'].includes(item.status)) return
    const name = item.title.trim().toLowerCase()
    if (seen.has(name)) return
    seen.add(name)
    const target = now + 14 * DAY_MS
    const due = item.dueAt?.getTime() ?? null
    if (due !== null && due <= target) return
    moves.push({
      key: `plan:${item.interventionId || item.id || index}`,
      title: `Deliver ${item.title} within 2 weeks`,
      kind: 'Intervention',
      detail: due ? `due ${short(new Date(due))}` : 'no due date yet',
      // Every open item of that name is brought forward together.
      apply: (current) => ({
        ...current,
        plan: current.plan.map((row, rowIndex) => (rowIndex === index || (row.title.trim().toLowerCase() === name && !['Completed', 'Declined', 'Not assigned'].includes(row.status)) ? { ...row, dueAt: new Date(target) } : row)),
      }),
    })
  })
  return moves
}

export const applyMoves = (input: TwinInput, moves: TwinMove[]) => moves.reduce((current, move) => move.apply(current), input)

/** Each move on its own, ranked by how much sooner it makes the business funding-ready, then by score gain. */
export const rankMoves = (input: TwinInput, moves = availableMoves(input)): RankedMove[] => {
  const base = timeline(input, 0, WEEKS_AHEAD)
  const baseReady = readyWeek(base)
  const at12 = (weeks: TwinWeek[]) => weeks.find((week) => week.offset === 12)?.funding ?? 0
  return moves.map((move) => {
    const weeks = timeline(move.apply(input), 0, WEEKS_AHEAD)
    const ready = readyWeek(weeks)
    const weeksSooner = ready !== null && (baseReady === null || ready < baseReady) ? (baseReady === null ? null : baseReady - ready) : null
    return {
      key: move.key, title: move.title, kind: move.kind, detail: move.detail,
      weeksSooner: ready !== null && baseReady === null ? WEEKS_AHEAD - ready : weeksSooner,
      scoreGain: at12(weeks) - at12(base),
      readyOffset: ready,
    }
  }).sort((a, b) => (b.weeksSooner ?? 0) - (a.weeksSooner ?? 0) || b.scoreGain - a.scoreGain)
}

/** What happens in the weeks ahead: interventions falling due and documents expiring (or renewed by a move). */
export const upcomingEvents = (input: TwinInput, horizonWeeks = WEEKS_AHEAD): TwinEvent[] => {
  const now = input.now.getTime()
  const end = now + horizonWeeks * WEEK_MS
  const events: TwinEvent[] = []
  input.plan.forEach((item) => {
    if (['Completed', 'Declined', 'Not assigned'].includes(item.status) || !item.dueAt) return
    const due = item.dueAt.getTime() < now ? new Date(now + OVERDUE_GRACE_DAYS * DAY_MS) : item.dueAt
    if (due.getTime() <= end) events.push({ date: due, text: `${item.title} due`, tone: 'due' })
  })
  input.documents.forEach((doc) => {
    if (!doc.expiresAt) return
    const at = doc.expiresAt.getTime()
    if (at > now && at <= end) events.push({ date: doc.expiresAt, text: `${doc.label[0].toUpperCase()}${doc.label.slice(1)} expires`, tone: doc.issuedAt && doc.issuedAt.getTime() >= now ? 'renewed' : 'expiry' })
  })
  return events
    .filter((event, index, all) => all.findIndex((other) => other.text === event.text && other.date.getTime() === event.date.getTime()) === index)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
}
