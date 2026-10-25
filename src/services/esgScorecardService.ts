import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where, type QueryConstraint } from 'firebase/firestore'
import { db } from '@/firebase/config'
import { metricHistory, toDayjsValue, type FirestoreDateLike, type PerformanceSourceRow } from '@/services/smePerformanceMetrics'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'

/**
 * Social and Governance scores for the ESG scorecard, measured from records the platform already keeps.
 * Environmental data is not captured yet, so it is not measured here.
 *
 * Each theme is a percentage worked out at the end of each of the last eight calendar quarters (the current
 * quarter is measured as at today), so the page can draw a trend and project it forward.
 *
 * Social
 *  - Jobs growing: of SMEs with two or more headcount figures, the share whose latest is above their first
 *    (headcountHistory on the participant, from the metrics pages).
 *  - Inclusive ownership: of SMEs whose ownership is known, the share majority women-, youth- or black-owned
 *    (ownership fields on the participant or its application).
 *  - Outcomes achieved: of completed interventions with a facilitator check-back result, the share achieved
 *    (outcomeHistory / outcomeResult on assignedInterventions).
 * Governance (complianceDocuments)
 *  - Documents valid: of documents on record, the share verified and not expired.
 *  - Tax compliant / B-BBEE certified: the share of SMEs holding a valid document of that kind (B-BBEE also
 *    counts a B-BBEE level on the application).
 *
 * Earlier quarters are rebuilt from dates on the records (joined, uploaded, verified, expiry, check-back
 * recorded). A document's verification is its current one, so a document queried today is not counted as
 * valid in earlier quarters either. Figures stay English; the page translates labels when it shows them.
 */

export type EsgPillarKey = 'S' | 'G'

export type EsgTheme = {
  key: string
  pillar: EsgPillarKey
  name: string
  /** Percentage at each quarter end, oldest first; null where nothing could be measured yet. */
  history: Array<number | null>
  /** What the latest figure is out of, e.g. "12 of 20 SMEs". */
  basis: string
  action: string
}

export type EsgScorecard = {
  /** e.g. "Q4 2025", oldest first; the last is the current quarter. */
  quarters: string[]
  /** The calendar quarter after the last one, for labelling projections. */
  nextQuarter: { quarter: number; year: number }
  themes: EsgTheme[]
  smes: number
  documents: number
}

type AnyDoc = Record<string, unknown>
type Row = AnyDoc & { id: string }

/** Two years back; quarters before the first record come out null and the page trims them. */
const QUARTER_COUNT = 8
const MAJORITY = 51

const text = (value: unknown) => String(value ?? '').trim()
const lower = (value: unknown) => text(value).toLowerCase()
const date = (value: unknown) => toDayjsValue(value as FirestoreDateLike)
const percent = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : null)
const numberOrNull = (...values: unknown[]) => {
  for (const value of values) {
    const parsed = Number(value)
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(parsed)) return parsed
  }
  return null
}

/** The last QUARTER_COUNT calendar quarters, each with the date it is measured at. */
const quarterWindows = (now: Dayjs) => {
  const currentStart = now.startOf('month').month(Math.floor(now.month() / 3) * 3)
  const windows = Array.from({ length: QUARTER_COUNT }, (_, index) => {
    const start = currentStart.subtract((QUARTER_COUNT - 1 - index) * 3, 'month')
    const end = start.add(3, 'month').subtract(1, 'day').endOf('day')
    return { label: `Q${Math.floor(start.month() / 3) + 1} ${start.year()}`, at: end.isAfter(now) ? now : end }
  })
  const next = currentStart.add(3, 'month')
  return { windows, nextQuarter: { quarter: Math.floor(next.month() / 3) + 1, year: next.year() } }
}

const joinedAt = (row: AnyDoc) => date(row.onboardedAt || row.acceptedAt || row.approvedAt || row.createdAt)
const isDiscontinued = (row: AnyDoc) =>
  Boolean(row.discontinuedAt) || ['discontinued', 'inactive', 'exited', 'removed'].includes(lower(row.status))

/** Ownership fields can sit on the participant, its application, or nested ownership/profile/formValues maps. */
const ownershipOf = (participant: AnyDoc, application: AnyDoc | undefined) => {
  const sources = [participant, application || {}].flatMap((row) => [row, row.ownership, row.profile, row.formValues].filter((part): part is AnyDoc => Boolean(part) && typeof part === 'object'))
  const pick = (field: string) => numberOrNull(...sources.map((source) => source[field]))
  const gender = sources.map((source) => lower(source.gender)).find(Boolean) || ''
  const female = pick('femaleOwnedPercent') ?? pick('womenOwnedPercent')
  const youth = pick('youthOwnedPercent')
  const black = pick('blackOwnedPercent')
  const known = female !== null || youth !== null || black !== null || Boolean(gender)
  const inclusive = [female, youth, black].some((value) => value !== null && value >= MAJORITY) || gender === 'female'
  const beeLevel = sources.map((source) => text(source.beeLevel || source.bbeeLevel)).find(Boolean) || ''
  return { known, inclusive, beeLevel }
}

type DocumentKind = 'tax' | 'bee' | 'other'
const documentKind = (row: AnyDoc): DocumentKind => {
  const name = lower(row.type || row.documentName || row.key || row.name)
  if (name.includes('tax') || name.includes('sars')) return 'tax'
  if (name.includes('bee') || name.includes('bbbee')) return 'bee'
  return 'other'
}

/** Verified at some point: still valid now, or expired since but verified before it lapsed. */
const isVerified = (row: AnyDoc) => {
  const current = lower(row.currentStatus || row.status)
  const verification = lower(row.verificationStatus)
  if (['queried', 'invalid', 'rejected', 'missing', 'pending'].includes(current) && verification !== 'verified') return false
  return verification === 'verified' || current === 'valid' || current === 'approved'
}

const documentValidAt = (row: AnyDoc, at: Dayjs) => {
  if (!isVerified(row)) return false
  const on = date(row.verifiedAt || row.uploadedAt || row.createdAt || row.updatedAt)
  if (on && on.isAfter(at)) return false
  const expiry = date(row.expiryDate)
  return !expiry || !expiry.isBefore(at, 'day')
}

/** Every facilitator check-back result with when it was recorded, oldest first. */
const outcomeResults = (row: AnyDoc) => {
  const history = Array.isArray(row.outcomeHistory) ? row.outcomeHistory as AnyDoc[] : []
  const entries = history.length ? history : row.outcomeResult ? [row.outcomeResult as AnyDoc] : []
  return entries
    .map((entry) => ({ result: lower(entry?.result), at: date(entry?.recordedAt) }))
    .filter((entry) => ['achieved', 'partially', 'not_yet'].includes(entry.result))
}

export type EsgSourceRecords = { participants: Row[]; applications: Row[]; assignments: Row[]; documents: Row[] }

export const loadEsgScorecard = async (
  user: FullIdentity,
  options: { activeProgramId?: string | null; isAllPrograms?: boolean } = {},
): Promise<EsgScorecard> => {
  const companyCode = text(user.companyCode)
  // These collections only allow reading one's own company, so every query says so.
  const scope: QueryConstraint[] = [where('companyCode', '==', companyCode)]
  if (!options.isAllPrograms && options.activeProgramId) scope.push(where('programId', '==', options.activeProgramId))
  const inProgram = (row: AnyDoc) => matchesActiveProgram(user, options.activeProgramId ?? null, text(row.programId))
  const rows = (snapshot: Awaited<ReturnType<typeof getDocs>> | null) =>
    (snapshot?.docs || []).map((record) => ({ ...(record.data() as AnyDoc), id: record.id }) as Row).filter(inProgram)

  const [participantSnap, applicationSnap, assignmentSnap, documentSnap] = companyCode
    ? await Promise.all([
      getDocs(query(collection(db, 'participants'), ...scope)),
      getDocs(query(collection(db, 'applications'), ...scope)),
      getDocs(query(collection(db, 'assignedInterventions'), ...scope)),
      getDocs(query(collection(db, 'complianceDocuments'), ...scope)),
    ])
    : [null, null, null, null]

  return buildEsgScorecard({
    participants: rows(participantSnap),
    applications: rows(applicationSnap),
    assignments: rows(assignmentSnap),
    documents: rows(documentSnap),
  })
}

/** The measuring itself, apart from loading, so it can be checked against hand-made records. */
export const buildEsgScorecard = (records: EsgSourceRecords, now: Dayjs = dayjs()): EsgScorecard => {
  const { windows, nextQuarter } = quarterWindows(now)
  const participants = records.participants.filter((row) => !isDiscontinued(row))
  const activeIds = new Set(participants.map((row) => row.id))
  const applications = records.applications
  const applicationsById = new Map(applications.map((row) => [row.id, row]))
  const applicationsByParticipant = new Map(applications.map((row) => [text(row.participantId), row]))
  const applicationFor = (participant: Row) =>
    applicationsById.get(text(participant.applicationId)) || applicationsByParticipant.get(participant.id)
  const assignments = records.assignments.filter((row) => activeIds.has(text(row.participantId || row.smmeId || row.smeId)) && !row.participantDiscontinuedAt)
  const documents = records.documents.filter((row) => activeIds.has(text(row.participantId)))

  const smes = participants.map((row) => ({
    row,
    joined: joinedAt(row),
    ownership: ownershipOf(row, applicationFor(row)),
    headcount: metricHistory(row as PerformanceSourceRow, 'headcount'),
    documents: documents.filter((document) => text(document.participantId) === row.id),
  }))
  const joinedBy = (at: Dayjs) => smes.filter((sme) => !sme.joined || !sme.joined.isAfter(at))

  type Measure = { part: number; whole: number }
  const series = (measure: (at: Dayjs) => Measure, unit: string) => {
    const measured = windows.map((window) => measure(window.at))
    const latest = measured[measured.length - 1]
    return {
      history: measured.map((value) => percent(value.part, value.whole)),
      basis: latest.whole ? `${latest.part} of ${latest.whole} ${unit}` : `No ${unit} measured yet`,
    }
  }

  const jobs = series((at) => {
    const tracked = joinedBy(at).map((sme) => sme.headcount.filter((entry) => !entry.date.isAfter(at))).filter((entries) => entries.length > 1)
    return { part: tracked.filter((entries) => entries[entries.length - 1].value > entries[0].value).length, whole: tracked.length }
  }, 'SMEs')

  const ownership = series((at) => {
    const known = joinedBy(at).filter((sme) => sme.ownership.known)
    return { part: known.filter((sme) => sme.ownership.inclusive).length, whole: known.length }
  }, 'SMEs')

  const outcomes = series((at) => {
    const latestResults = assignments
      .map((row) => outcomeResults(row).filter((entry) => !entry.at || !entry.at.isAfter(at)).pop())
      .filter((entry): entry is { result: string; at: Dayjs | null } => Boolean(entry))
    return { part: latestResults.filter((entry) => entry.result === 'achieved').length, whole: latestResults.length }
  }, 'check-backs')

  const validDocuments = series((at) => {
    const onRecord = documents.filter((row) => {
      const added = date(row.uploadedAt || row.createdAt || row.updatedAt)
      return !added || !added.isAfter(at)
    })
    return { part: onRecord.filter((row) => documentValidAt(row, at)).length, whole: onRecord.length }
  }, 'documents')

  const holding = (kind: DocumentKind, extra: (sme: typeof smes[number]) => boolean = () => false) => series((at) => {
    const cohort = joinedBy(at)
    return { part: cohort.filter((sme) => extra(sme) || sme.documents.some((row) => documentKind(row) === kind && documentValidAt(row, at))).length, whole: cohort.length }
  }, 'SMEs')

  const themes: EsgTheme[] = [
    { key: 'jobs', pillar: 'S', name: 'SMEs growing jobs', ...jobs, action: 'Capture headcount at every follow-up so job growth stays visible.' },
    { key: 'ownership', pillar: 'S', name: 'Inclusive ownership', ...ownership, action: 'Record ownership on every application so reach can be measured.' },
    { key: 'outcomes', pillar: 'S', name: 'Outcomes achieved', ...outcomes, action: 'Follow up on partial and not-yet check-backs before the next round.' },
    { key: 'documents', pillar: 'G', name: 'Compliance documents valid', ...validDocuments, action: 'Clear the verification queue and chase documents close to expiry.' },
    { key: 'tax', pillar: 'G', name: 'Tax compliant SMEs', ...holding('tax'), action: 'Ask SMEs without a current tax PIN or clearance to upload one.' },
    { key: 'bee', pillar: 'G', name: 'B-BBEE certified SMEs', ...holding('bee', (sme) => Boolean(sme.ownership.beeLevel)), action: 'Help SMEs without a B-BBEE affidavit or certificate to obtain one.' },
  ]

  return {
    quarters: windows.map((window) => window.label),
    nextQuarter,
    themes,
    smes: participants.length,
    documents: documents.length,
  }
}
