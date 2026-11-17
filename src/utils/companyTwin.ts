import type { TwinActivity } from '@/services/digitalTwinService'
import { WEEKS_AHEAD, WEEKS_BACK, type TwinEvent } from '@/utils/digitalTwin'
import { requirementKeyFor } from '@/config/complianceDocuments'
import { DEFAULT_DETAILS_SETTINGS } from '@/config/trainingDetails'
import { READY_SCORE, scoreTrack, type Gate } from '@/utils/readiness'
import { longDate, money, share, shortDate, signed, weekDate, type LayerView, type TwinBuild, type TwinKind, type TwinSubject, type ViewReason, type ViewWeek } from '@/utils/twinView'

/**
 * The training side's digital twin: one client company, how it stands with its training provider ("training standing"),
 * worked out from its own records by gates scored the same way as funding readiness (met 1, partial 0.5, missing 0,
 * unknown left out; standing at 75 or more with every critical gate met):
 *
 * - Company details sent (critical) and the documents the provider asks for on file (critical: CIPC registration,
 *   B-BBEE certificate and tax compliance by default).
 * - Staff trained: of its people whose class has ended, the share certified (does not apply until a class ends).
 * - Pass rate: of its marked final assessments, the share passed (does not apply until one is marked).
 * - Business figures: months of revenue and employees recorded (3 or more).
 * - ESG report: final, or in progress (does not apply when it has none).
 *
 * History is rebuilt week by week from the dates on those records. Ahead, "on plan" means the people booked on a
 * class pass when it ends at a cautious rate: the lower of the company's own pass rate and the provider's average
 * across all its clients, so one good class does not make a company look better than it is. The screen says so.
 * Pure: no Firestore.
 */

const DAY_MS = 86_400_000
const WEEK_MS = 7 * DAY_MS
// The documents the provider asks a client company for (the facilitator's default list).
const REQUIRED_DOCUMENTS = DEFAULT_DETAILS_SETTINGS.companyDocuments
const DOCUMENTS_NEEDED = REQUIRED_DOCUMENTS.length

export type CompanyLearner = { id: string; name: string; classEnd: Date | null; certifiedAt: Date | null }
export type CompanyInput = {
  now: Date
  detailsAt: Date | null
  documents: Array<{ key: string; uploadedAt: Date | null }>
  learners: CompanyLearner[]
  /** Marked final assessments. */
  results: Array<{ markedAt: Date; passed: boolean }>
  metrics: Array<{ period: string; revenue: number; employees: number | null }>
  esg: { status: 'draft' | 'in_review' | 'final'; createdAt: Date | null; finalAt: Date | null } | null
  /** The provider's next class that has not started, for the "book them" move. */
  nextClass: { title: string; start: Date; end: Date } | null
  /** The provider's pass rate across all its clients' marked final assessments (0-1), or null. */
  providerRate: number | null
}

export type CompanyTwinSource = { subject: TwinSubject; input: CompanyInput }

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const atWeek = (now: Date, offset: number) => new Date(now.getTime() + offset * WEEK_MS)
const by = (date: Date | null, when: Date) => !date || date.getTime() <= when.getTime()

const passRate = (input: CompanyInput, when: Date) => {
  const marked = input.results.filter((row) => row.markedAt.getTime() <= when.getTime())
  return marked.length ? marked.filter((row) => row.passed).length / marked.length : null
}

/** Everything the gates and layers need on one date. Ahead of today, booked people pass at the current pass rate. */
const stateOn = (input: CompanyInput, when: Date) => {
  const now = input.now.getTime()
  // The cautious rate for the weeks ahead: the lower of the company's own and the provider's average.
  const own = passRate(input, input.now)
  const rateNow = own === null ? input.providerRate ?? 0 : input.providerRate === null ? own : Math.min(own, input.providerRate)
  const ended = input.learners.filter((learner) => learner.classEnd && learner.classEnd.getTime() <= when.getTime())
  const certified = input.learners.reduce((sum, learner) => {
    if (learner.certifiedAt) return sum + (learner.certifiedAt.getTime() <= when.getTime() ? 1 : 0)
    // Not certified yet: on plan, those whose class ends after today pass at the current rate.
    if (learner.classEnd && learner.classEnd.getTime() > now && learner.classEnd.getTime() <= when.getTime()) return sum + rateNow
    return sum
  }, 0)
  const documents = new Set(input.documents.filter((doc) => by(doc.uploadedAt, when)).map((doc) => requirementKeyFor(doc.key)).filter((key) => REQUIRED_DOCUMENTS.includes(key))).size
  const months = input.metrics.filter((row) => row.period <= monthKey(when))
  const esg = input.esg && by(input.esg.createdAt, when) ? (input.esg.finalAt && input.esg.finalAt.getTime() <= when.getTime() ? 'final' : input.esg.status === 'final' ? 'in_review' : input.esg.status) : null
  return { ended: ended.length, total: input.learners.length, certified, rate: passRate(input, when), documents, months, esg, details: by(input.detailsAt, when) && !!input.detailsAt }
}

const gatesOn = (input: CompanyInput, when: Date): Gate[] => {
  const state = stateOn(input, when)
  const trained = state.ended ? state.certified / state.ended : null
  return [
    { key: 'details', label: 'Company details', critical: true, state: state.details ? 'met' : 'missing', detail: state.details ? 'Sent' : 'Not sent yet', action: 'Ask the company to send its details' },
    { key: 'documents', label: 'Company documents', critical: true, state: state.documents >= DOCUMENTS_NEEDED ? 'met' : state.documents ? 'partial' : 'missing', detail: `${state.documents} of ${DOCUMENTS_NEEDED} on file`, action: 'Upload the company documents' },
    { key: 'trained', label: 'Staff trained', notApplicable: trained === null, state: trained === null ? 'unknown' : trained >= 0.8 ? 'met' : trained >= 0.4 ? 'partial' : 'missing', detail: trained === null ? 'No class finished yet' : `${Math.round(state.certified)} of ${state.ended} certified`, action: 'Book the staff not yet certified on a class' },
    { key: 'pass', label: 'Pass rate', notApplicable: state.rate === null, state: state.rate === null ? 'unknown' : state.rate >= 0.8 ? 'met' : state.rate >= 0.5 ? 'partial' : 'missing', detail: state.rate === null ? 'No assessments marked yet' : `${Math.round(state.rate * 100)}% passed`, action: 'Offer a refresher before the reassessment' },
    { key: 'figures', label: 'Business figures', state: state.months.length >= 3 ? 'met' : state.months.length ? 'partial' : 'missing', detail: `${state.months.length} month${state.months.length === 1 ? '' : 's'} recorded`, action: 'Record the latest business figures' },
    { key: 'esg', label: 'ESG report', notApplicable: state.esg === null, state: state.esg === null ? 'unknown' : state.esg === 'final' ? 'met' : 'partial', detail: state.esg === null ? 'No report' : state.esg === 'final' ? 'Final' : state.esg === 'in_review' ? 'In review' : 'Draft', action: 'Finalise the ESG report' },
  ]
}

const layersOn = (input: CompanyInput, when: Date, score: number): LayerView[] => {
  const state = stateOn(input, when)
  const first = state.months[0]
  const last = state.months[state.months.length - 1]
  const change = state.months.length > 1 && first.revenue ? Math.round(((last.revenue - first.revenue) / Math.abs(first.revenue)) * 100) : null
  const certified = Math.round(state.certified)
  const esgLevel = state.esg === 'final' ? 3 : state.esg === 'in_review' ? 2 : state.esg === 'draft' ? 1 : 0
  return [
    {
      key: 'growth', name: 'Growth', short: change === null ? '—' : `${signed(change)}%`, value: last ? `${money(last.revenue)} in ${last.period}` : 'No figures yet',
      pct: change === null ? (last ? 50 : 0) : Math.max(4, Math.min(100, 50 + change)), n: state.months.length, source: 'Business figures the company records',
    },
    { key: 'support', name: 'Classes', short: `${state.ended}/${state.total}`, value: state.total ? `${state.ended} of ${state.total} staff through a class` : 'Nobody booked yet', pct: share(state.ended, state.total), n: state.ended, source: 'Classes and attendance' },
    {
      key: 'skills', name: 'Skills', short: `${certified}/${state.total}`,
      value: state.total ? `${certified} of ${state.total} certified${state.rate === null ? '' : `, ${Math.round(state.rate * 100)}% pass`}` : 'No staff trained yet',
      pct: share(certified, state.total), n: certified, source: 'Assessments and certificates',
    },
    { key: 'compliance', name: 'Compliance', short: `${state.documents}/${DOCUMENTS_NEEDED}`, value: `${state.details ? 'Details sent' : 'Details missing'}, ${state.documents} document${state.documents === 1 ? '' : 's'}`, pct: Math.min(100, share(state.documents, DOCUMENTS_NEEDED) * (state.details ? 1 : 0.5)), n: state.documents + (state.details ? 1 : 0), source: 'Company details and documents' },
    { key: 'sustainability', name: 'ESG', short: ['—', 'Draft', 'Review', 'Final'][esgLevel], value: ['No ESG report', 'ESG report in draft', 'ESG report in review', 'ESG report final'][esgLevel], pct: [0, 33, 66, 100][esgLevel], n: esgLevel, source: 'ESG reporting add-on' },
    { key: 'readiness', name: 'Standing', short: String(score), value: `Training standing ${score}`, pct: score, n: score, source: 'Training standing rules' },
  ]
}

const timelineOf = (input: CompanyInput, from = -WEEKS_BACK, to = WEEKS_AHEAD): ViewWeek[] => {
  const weeks: ViewWeek[] = []
  for (let offset = from; offset <= to; offset++) {
    const date = atWeek(input.now, offset)
    const gates = gatesOn(input, date)
    const track = scoreTrack(gates)
    const score = track.score ?? 0
    weeks.push({ offset, date, score, ready: track.band === 'ready', criticalOpen: gates.filter((gate) => gate.critical && gate.state !== 'met').length, layers: layersOn(input, date, score) })
  }
  return weeks
}
const readyOf = (weeks: ViewWeek[]) => weeks.find((week) => week.offset >= 0 && week.ready)?.offset ?? null

type CompanyMove = { key: string; title: string; kind: string; detail: string; apply: (input: CompanyInput) => CompanyInput }

const movesOf = (input: CompanyInput): CompanyMove[] => {
  const now = input.now
  const moves: CompanyMove[] = []
  if (!input.detailsAt) moves.push({ key: 'details', title: 'Get the company’s details sent', kind: 'Company', detail: 'not sent yet', apply: (current) => ({ ...current, detailsAt: now }) })
  const missingDocuments = REQUIRED_DOCUMENTS.filter((key) => !input.documents.some((doc) => requirementKeyFor(doc.key) === key))
  if (missingDocuments.length) {
    moves.push({
      key: 'documents', title: `Upload the ${missingDocuments.length} missing company document${missingDocuments.length === 1 ? '' : 's'}`, kind: 'Company',
      detail: `${DOCUMENTS_NEEDED - missingDocuments.length} of ${DOCUMENTS_NEEDED} on file`,
      apply: (current) => ({ ...current, documents: [...current.documents, ...missingDocuments.map((key) => ({ key, uploadedAt: now }))] }),
    })
  }
  const untrained = input.learners.filter((learner) => !learner.certifiedAt && (!learner.classEnd || learner.classEnd.getTime() <= now.getTime()))
  if (untrained.length && input.nextClass) {
    const next = input.nextClass
    moves.push({
      key: 'book', title: `Book ${untrained.length} uncertified staff on ${next.title}`, kind: 'Training class', detail: `starts ${shortDate(next.start)}`,
      apply: (current) => ({ ...current, learners: current.learners.map((learner) => (untrained.some((row) => row.id === learner.id) ? { ...learner, classEnd: next.end } : learner)) }),
    })
  }
  if (input.metrics.length < 3) {
    moves.push({
      key: 'figures', title: 'Record the last 3 months’ business figures', kind: 'Company', detail: `${input.metrics.length} recorded`,
      apply: (current) => {
        const periods = [0, 1, 2].map((back) => monthKey(new Date(now.getFullYear(), now.getMonth() - back, 1)))
        const last = current.metrics[current.metrics.length - 1]
        const added = periods.filter((period) => !current.metrics.some((row) => row.period === period)).map((period) => ({ period, revenue: last?.revenue ?? 0, employees: last?.employees ?? null }))
        return { ...current, metrics: [...current.metrics, ...added].sort((a, b) => a.period.localeCompare(b.period)) }
      },
    })
  }
  if (input.esg && input.esg.status !== 'final') {
    moves.push({ key: 'esg', title: 'Finalise the ESG report', kind: 'ESG report', detail: input.esg.status === 'in_review' ? 'in review' : 'in draft', apply: (current) => ({ ...current, esg: current.esg ? { ...current.esg, status: 'final', finalAt: new Date(now.getTime() + 14 * DAY_MS) } : current.esg }) })
  }
  return moves
}

export const COMPANY_KIND: TwinKind = {
  eyebrow: 'Digital twin · Training client company',
  scoreLabel: 'Training standing',
  readyPhrase: 'in good standing',
  assumption: 'Assumes people booked on a class pass at the lower of the company’s and the provider’s pass rate.',
  path: '/training/twin',
}

export const companyScore = (input: CompanyInput) => scoreTrack(gatesOn(input, input.now)).score ?? 0

export const buildCompanyTwin = (source: CompanyTwinSource, picked: Record<string, boolean>): TwinBuild => {
  const { input, subject } = source
  const now = input.now
  const moves = movesOf(input)
  const chosen = moves.filter((move) => picked[move.key])
  const movedInput = chosen.length ? chosen.reduce((current, move) => move.apply(current), input) : null
  const base = timelineOf(input)
  const moved = movedInput ? timelineOf(movedInput) : null
  const baseReady = readyOf(base)
  const at12 = (weeks: ViewWeek[]) => weeks.find((week) => week.offset === 12)?.score ?? 0

  const ranked = moves.map((move) => {
    const weeks = timelineOf(move.apply(input), 0, WEEKS_AHEAD)
    const ready = readyOf(weeks)
    const baseAhead = base.filter((week) => week.offset >= 0)
    return {
      key: move.key, title: move.title, kind: move.kind, detail: move.detail,
      weeksSooner: ready !== null && (baseReady === null ? true : ready < baseReady) ? (baseReady === null ? WEEKS_AHEAD - ready : baseReady - ready) : null,
      scoreGain: at12(weeks) - at12(baseAhead),
    }
  }).sort((a, b) => (b.weeksSooner ?? 0) - (a.weeksSooner ?? 0) || b.scoreGain - a.scoreGain)
  const helpful = ranked.filter((move) => (move.weeksSooner ?? 0) > 0 || move.scoreGain > 0)

  const gates = gatesOn(input, now)
  const gatesMoved = movedInput ? gatesOn(movedInput, now) : null
  const fixed = (key: string) => !!gatesMoved?.find((gate) => gate.key === key && gate.state === 'met') || (key === 'trained' && !!picked.book)
  const reasons: ViewReason[] = [
    ...gates.filter((gate) => gate.critical && gate.state !== 'met').map((gate) => ({ good: false, fixed: fixed(gate.key), text: `${gate.label}: ${gate.detail.toLowerCase()}` })),
    ...gates.filter((gate) => !gate.critical && gate.state === 'missing').map((gate) => ({ good: false, fixed: fixed(gate.key), text: `${gate.label}: ${gate.detail.toLowerCase()}` })),
    ...gates.filter((gate) => gate.key === 'pass' && gate.state === 'met').map((gate) => ({ good: true, fixed: false, text: `${gate.label}: ${gate.detail}` })),
  ].slice(0, 4)

  const fastInput = helpful.length ? moves.filter((move) => helpful.some((row) => row.key === move.key)).reduce((current, move) => move.apply(current), input) : null
  const fastWeeks = fastInput ? timelineOf(fastInput, 0, WEEKS_AHEAD) : null
  const fastReady = fastWeeks ? readyOf(fastWeeks) : null
  const score = companyScore(input)
  const steps = gates.filter((gate) => gate.state === 'missing' || gate.state === 'partial').map((gate) => gate.action || gate.label).slice(0, 4)

  const events: TwinEvent[] = []
  const classEnds = new Map<number, number>()
  ;(movedInput || input).learners.forEach((learner) => {
    if (!learner.certifiedAt && learner.classEnd && learner.classEnd.getTime() > now.getTime() && learner.classEnd.getTime() <= now.getTime() + 12 * WEEK_MS) {
      classEnds.set(learner.classEnd.getTime(), (classEnds.get(learner.classEnd.getTime()) || 0) + 1)
    }
  })
  classEnds.forEach((count, at) => events.push({ date: new Date(at), text: `Class ends: ${count} of its staff`, tone: 'due' }))
  if (input.esg && input.esg.status !== 'final' && picked.esg) events.push({ date: new Date(now.getTime() + 14 * DAY_MS), text: 'ESG report final', tone: 'renewed' })

  return {
    base, moved, baseReady, movedReady: moved ? readyOf(moved) : null, todayScore: score, reasons,
    moves: ranked, helpful: helpful.map((move) => move.key),
    events: events.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 4),
    answers: {
      fast: !helpful.length || !fastWeeks
        ? 'No move open today changes its standing. Ask why it is not in good standing yet to see what remains.'
        : `These ${helpful.length} move${helpful.length === 1 ? '' : 's'} together ${fastReady === null ? `lift its training standing to ${fastWeeks[12]?.score ?? 0} in 12 weeks` : `put ${subject.name} in good standing by ${longDate(weekDate(now, fastReady))}`}: ${helpful.map((move) => move.title.toLowerCase()).join('; ')}. I have switched them on, so the whole twin now shows that future.`,
      why: steps.length ? `Its training standing is ${score}; good standing means ${READY_SCORE} or more with the company details and documents in place. What remains: ${steps.join('; ')}.` : 'Every gate is met: it is in good standing.',
      nothing: `On plan, its training standing goes from ${score} today to ${at12(base.filter((week) => week.offset >= 0))} in 12 weeks${baseReady === null ? ', and it is not in good standing within 26 weeks' : `, in good standing by ${longDate(weekDate(now, baseReady))}`}. This assumes people booked on a class pass at the lower of its own and the provider's pass rate.`,
    },
  }
}

export type { TwinActivity }
