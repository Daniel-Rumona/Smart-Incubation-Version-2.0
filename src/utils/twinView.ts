import type { TwinActivity, TwinBusiness } from '@/services/digitalTwinService'
import {
  WEEKS_AHEAD, WEEKS_BACK, applyMoves, availableMoves, rankMoves, readinessOn, readyWeek, timeline, upcomingEvents, type TwinEvent, type TwinWeek,
} from '@/utils/digitalTwin'
import { READY_SCORE } from '@/utils/readiness'

/**
 * What the twin screen (src/components/twin/TwinScreen.tsx) shows, whatever the business: an SME on the incubation
 * side or a client company on the training side. Each side has its own rules and builds this same shape, so both get
 * the same screen. This file also holds the SME side's builder; the client company's is in src/utils/companyTwin.ts.
 */

export type LayerKey = 'growth' | 'support' | 'skills' | 'compliance' | 'sustainability' | 'readiness'

export type LayerView = {
  key: LayerKey
  name: string
  short: string
  value: string
  /** 0-100, for the bar. */
  pct: number
  /** The number a move can change, compared week against week to show "+1"; null when moves never change it. */
  n: number | null
  source: string
}

export type ViewWeek = {
  offset: number
  date: Date
  score: number
  ready: boolean
  /** Critical gates not met that week: 2+ at risk, 1 to watch, 0 in order. */
  criticalOpen: number
  layers: LayerView[]
}

export type ViewMove = { key: string; title: string; kind: string; detail: string; weeksSooner: number | null; scoreGain: number }
export type ViewReason = { text: string; good: boolean; fixed: boolean }

export type TwinBuild = {
  base: ViewWeek[]
  moved: ViewWeek[] | null
  baseReady: number | null
  movedReady: number | null
  todayScore: number
  reasons: ViewReason[]
  moves: ViewMove[]
  /** The moves that bring the date forward or lift the score: what "fastest way" switches on. */
  helpful: string[]
  events: TwinEvent[]
  answers: { fast: string; why: string; nothing: string }
}

export type TwinSubject = {
  id: string
  name: string
  sub: string
  /** Peers are compared within the same group (programme and sector), only when it has 3 or more. */
  peerGroup: string
  activity: TwinActivity[]
  now: Date
  /** The same business on the platform's other side (an SME that is also a training client), when linked. */
  linked: { label: string; name: string; href: string } | null
}

/** The words that change between the two sides. */
export type TwinKind = {
  eyebrow: string
  scoreLabel: string
  readyPhrase: string
  assumption: string
  path: string
}

const LOCALE = 'en-ZA'
const TZ = 'Africa/Johannesburg'
export const longDate = (date: Date) => date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
export const shortDate = (date: Date) => date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: TZ })
export const money = (value: number) => `R ${Math.round(value).toLocaleString(LOCALE)}`
export const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`
export const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)
export const weekDate = (now: Date, offset: number) => new Date(now.getTime() + offset * 7 * 86_400_000)

/* ---------- the SME side ---------- */

export const SME_KIND: TwinKind = {
  eyebrow: 'Digital twin · Incubation SME',
  scoreLabel: 'Funding readiness',
  readyPhrase: 'funding-ready',
  assumption: 'Assumes open interventions are delivered on their due dates.',
  path: '/operations/participants/digital-twin',
}

export const smeSubject = (business: TwinBusiness): TwinSubject => ({
  id: business.id,
  name: business.businessName,
  sub: [business.ownerName, business.sector, business.programName].filter(Boolean).join(' · '),
  peerGroup: `${business.programId || ''}|${business.sector || ''}`,
  activity: business.activity,
  now: business.input.now,
  linked: business.linkedOrganisation ? { label: 'Also a training client', name: business.linkedOrganisation.name, href: `/training/twin/${business.linkedOrganisation.id}` } : null,
})

const smeLayers = (business: TwinBusiness, week: TwinWeek): LayerView[] => {
  const courses = business.courses
  return [
    {
      key: 'growth', name: 'Growth', short: week.revenueChange === null ? '—' : `${signed(week.revenueChange)}%`,
      value: week.revenue === null ? 'No revenue yet' : `${money(week.revenue)} a month`,
      pct: week.revenueChange === null ? 0 : Math.max(4, Math.min(100, 50 + week.revenueChange)), n: null, source: 'Monthly revenue (books integration next)',
    },
    {
      key: 'support', name: 'Support', short: `${week.delivered}/${week.planTotal}`, value: week.planTotal ? `${week.delivered} of ${week.planTotal} delivered` : 'No growth plan yet',
      pct: share(week.delivered, week.planTotal), n: week.delivered, source: 'Growth plan and interventions',
    },
    {
      key: 'skills', name: 'Skills', short: courses && courses.total ? `${courses.completed}/${courses.total}` : '—',
      value: courses && courses.total ? `${courses.completed} of ${courses.total} courses done` : 'No LMS courses yet',
      pct: courses && courses.total ? share(courses.completed, courses.total) : 0, n: null, source: 'LMS courses',
    },
    {
      key: 'compliance', name: 'Compliance', short: `${week.documentsValid}/${week.documentsTotal}`,
      value: week.documentsTotal ? `${week.documentsValid} of ${week.documentsTotal} documents valid` : 'No documents',
      pct: share(week.documentsValid, week.documentsTotal), n: week.documentsValid, source: 'Compliance documents',
    },
    { key: 'sustainability', name: 'Sustainability', short: '—', value: 'Not measured yet', pct: 0, n: null, source: 'ESG reporting add-on' },
    {
      key: 'readiness', name: 'Readiness', short: `${week.funding}·${week.market}`, value: `Funding ${week.funding}, market ${week.market}`,
      pct: week.funding, n: week.funding, source: 'Readiness rules (as the Control Tower)',
    },
  ]
}

const smeWeeks = (business: TwinBusiness, weeks: TwinWeek[]): ViewWeek[] => weeks.map((week) => ({
  offset: week.offset, date: week.date, score: week.funding, ready: week.band === 'ready', criticalOpen: week.criticalOpen, layers: smeLayers(business, week),
}))

export const smeScore = (business: TwinBusiness) => readinessOn(business.input, business.input.now).funding.score ?? 0

export const buildSmeTwin = (business: TwinBusiness, picked: Record<string, boolean>): TwinBuild => {
  const input = business.input
  const now = input.now
  const moves = availableMoves(input)
  const chosen = moves.filter((move) => picked[move.key])
  const movedInput = chosen.length ? applyMoves(input, chosen) : null
  const baseWeeks = timeline(input)
  const movedWeeks = movedInput ? timeline(movedInput) : null
  const today = readinessOn(input, now)
  const todayMoved = movedInput ? readinessOn(movedInput, now) : null
  const ranked = rankMoves(input, moves)
  const helpful = ranked.filter((move) => (move.weeksSooner ?? 0) > 0 || move.scoreGain > 0)
  const funding = today.funding.score ?? 0
  const baseReady = readyWeek(baseWeeks)

  const gateFixed = (key: string) => !!todayMoved?.funding.gates.find((gate) => gate.key === key && gate.state === 'met')
  const change = baseWeeks[WEEKS_BACK].revenueChange
  const reasons: ViewReason[] = [
    ...(business.overdue ? [{ good: false, fixed: chosen.some((move) => move.kind === 'Intervention'), text: `${business.overdue} intervention${business.overdue === 1 ? '' : 's'} overdue` }] : []),
    ...today.funding.gates.filter((gate) => gate.critical && gate.state !== 'met').map((gate) => ({ good: false, fixed: gateFixed(gate.key), text: `${gate.label}: ${gate.detail.toLowerCase()}` })),
    ...(change !== null && change < -5 ? [{ good: false, fixed: false, text: `Revenue ${change}% over the months recorded` }] : []),
    ...(change !== null && change > 0 ? [{ good: true, fixed: false, text: `Revenue ${signed(change)}% over the months recorded` }] : []),
  ].slice(0, 4)

  const fastWeeks = helpful.length ? timeline(applyMoves(input, moves.filter((move) => helpful.some((row) => row.key === move.key))), 0, WEEKS_AHEAD) : null
  const fastReady = fastWeeks ? readyWeek(fastWeeks) : null
  const expiring = upcomingEvents(input, 12).filter((event) => event.tone === 'expiry')
  const steps = today.nextSteps.slice(0, 4).map((step) => step.gate.action || step.gate.label)

  return {
    base: smeWeeks(business, baseWeeks),
    moved: movedWeeks ? smeWeeks(business, movedWeeks) : null,
    baseReady,
    movedReady: movedWeeks ? readyWeek(movedWeeks) : null,
    todayScore: funding,
    reasons,
    moves: ranked.map((move) => ({ key: move.key, title: move.title, kind: move.kind, detail: move.detail, weeksSooner: move.weeksSooner, scoreGain: move.scoreGain })),
    helpful: helpful.map((move) => move.key),
    events: upcomingEvents(movedInput || input, 12).slice(0, 4),
    answers: {
      fast: !helpful.length || !fastWeeks
        ? 'No single move open today changes the funding-ready date. Ask "Why is it not ready yet?" to see what stands in the way.'
        : `These ${helpful.length} move${helpful.length === 1 ? '' : 's'} together ${fastReady === null ? `lift funding readiness to ${fastWeeks[12]?.funding ?? 0} in 12 weeks` : `make ${business.businessName} funding-ready by ${longDate(weekDate(now, fastReady))}`}: ${helpful.map((move) => move.title.toLowerCase()).join('; ')}. I have switched them on, so the whole twin now shows that future.`,
      why: steps.length ? `Funding readiness is ${funding}; ready means ${READY_SCORE} or more with every critical gate met. What stands in the way: ${steps.join('; ')}.` : 'Every gate the readiness rules check is met.',
      nothing: `On plan, funding readiness goes from ${funding} today to ${baseWeeks.find((week) => week.offset === 12)?.funding ?? funding} in 12 weeks${baseReady === null ? ', and it is not funding-ready within 26 weeks' : `, funding-ready by ${longDate(weekDate(now, baseReady))}`}. ${expiring.length ? `Watch: ${expiring.map((event) => `${event.text.toLowerCase()} on ${shortDate(event.date)}`).join(', ')}.` : 'No documents expire in that time.'} This assumes each open intervention is delivered on its due date.`,
    },
  }
}
