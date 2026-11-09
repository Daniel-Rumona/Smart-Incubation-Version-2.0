/**
 * The report a client-module company's funder sees (src/pages/training/FunderReportPage.tsx in the web app): its
 * revenue, the training it delivered and the ESG reports it produced. Totals only: no learner names, ID numbers or
 * contact details leave the company. Client organisations are listed by name with their counts, as invoiced.
 *
 * A company can have several funders (trainingFunders). Each funder sees only what it funded: classes marked as
 * funded by it (and their learners, unless a learner is marked as funded by someone else), learners marked as funded
 * by it in other classes, ESG reports and revenue entries marked as funded by it, and revenue linked to those classes
 * and reports. A funder account without a funder record sees nothing. Staff see everything, or one funder's view.
 *
 * Open to the company's funder and its training staff (who check what is shared), and only while a client module
 * (awareness training or ESG reporting) is switched on for the company.
 */
import type { Firestore } from 'firebase-admin/firestore'

export class ClientFunderError extends Error {
  constructor(public code: 'permission-denied' | 'failed-precondition', message: string) {
    super(message)
  }
}

type Row = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const amount = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0)
const READER_ROLES = ['funder', 'projectadmin', 'operations']
const STAFF_ROLES = ['projectadmin', 'operations']

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
const lastMonths = (today: Date) => Array.from({ length: 12 }, (_, index) => monthKey(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (11 - index), 1))))
const dayAfter = (start: string, days: number) => {
  const date = new Date(`${start}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * Gender and date of birth from a South African ID number (YYMMDD SSSS C A Z, with a Luhn check digit), for people
 * whose gender or date of birth was not asked. Anything else (a passport number, a test number) gives nothing.
 */
export const saIdDetails = (value: unknown, today = new Date()) => {
  const digits = text(value).replace(/\s+/g, '')
  if (!/^\d{13}$/.test(digits)) return null
  let sum = 0
  for (let index = 0; index < 13; index += 1) {
    let digit = Number(digits[12 - index])
    if (index % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  if (sum % 10 !== 0) return null
  const yy = Number(digits.slice(0, 2))
  const century = yy > today.getUTCFullYear() % 100 ? 1900 : 2000
  const month = Number(digits.slice(2, 4))
  const day = Number(digits.slice(4, 6))
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return {
    gender: Number(digits.slice(6, 10)) >= 5000 ? 'male' : 'female',
    dateOfBirth: `${century + yy}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`,
  }
}

const ageOn = (dateOfBirth: string, on: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) || !/^\d{4}-\d{2}-\d{2}/.test(on)) return null
  const years = Number(on.slice(0, 4)) - Number(dateOfBirth.slice(0, 4))
  return on.slice(5, 10) < dateOfBirth.slice(5, 10) ? years - 1 : years
}

export type FunderSummaryInput = {
  companyName: string
  /** The funder whose view this is (its name), or undefined for the whole company. */
  funderName?: string
  classes: Row[]
  learners: Row[]
  certificates: Row[]
  reports: Row[]
  revenue: Row[]
  /** The client companies' records, for their business details (baseline revenue, employees, B-BBEE level). */
  organisations?: Row[]
  /** The figures client companies record over time (trainingOrgMetrics: period, revenue, employees). */
  metrics?: Row[]
  today: Date
}

/** Only what one funder funded (see the top of this file). */
export const fundedBy = (input: FunderSummaryInput, funderId: string): FunderSummaryInput => {
  const fundedClassIds = new Set(input.classes.filter((row) => text(row.funderId) === funderId).map((row) => text(row.id)))
  const learners = input.learners.filter((row) => (text(row.funderId) ? text(row.funderId) === funderId : fundedClassIds.has(text(row.classId))))
  const classIds = new Set([...fundedClassIds, ...learners.map((row) => text(row.classId))])
  const reports = input.reports.filter((row) => text(row.funderId) === funderId)
  const reportIds = new Set(reports.map((row) => text(row.id)))
  const revenue = input.revenue.filter((row) => (text(row.funderId)
    ? text(row.funderId) === funderId
    : fundedClassIds.has(text(row.classId)) || reportIds.has(text(row.reportId))))
  const learnerIds = new Set(learners.map((row) => text(row.id)))
  return {
    ...input,
    classes: input.classes.filter((row) => classIds.has(text(row.id))),
    learners,
    certificates: input.certificates.filter((row) => learnerIds.has(text(row.learnerId))),
    reports,
    revenue,
  }
}

export const summariseForFunder = (input: FunderSummaryInput) => {
  const todayKey = input.today.toISOString().slice(0, 10)
  const months = lastMonths(input.today)
  const year = String(input.today.getUTCFullYear())

  // Revenue
  const byMonth = months.map((month) => ({ month, training: 0, esgReporting: 0, other: 0 }))
  const byService = { training: 0, esg_reporting: 0, other: 0 }
  let last12Months = 0
  let thisYear = 0
  let paid = 0
  let outstanding = 0
  const revenueByOrganisation = new Map<string, number>()
  for (const entry of input.revenue) {
    const date = text(entry.date)
    const value = amount(entry.amount)
    const service = entry.service === 'training' || entry.service === 'esg_reporting' ? entry.service : 'other'
    if (entry.status !== 'paid') outstanding += value
    if (date.startsWith(year)) thisYear += value
    const slot = byMonth.find((item) => item.month === date.slice(0, 7))
    if (!slot) continue
    last12Months += value
    byService[service] += value
    if (entry.status === 'paid') paid += value
    if (service === 'training') slot.training += value
    else if (service === 'esg_reporting') slot.esgReporting += value
    else slot.other += value
    const organisation = text(entry.organisation)
    if (organisation) revenueByOrganisation.set(organisation.toLowerCase(), (revenueByOrganisation.get(organisation.toLowerCase()) || 0) + value)
  }

  // Training: classes that have started, their learners, and certificates still valid.
  const classes = new Map(input.classes.map((row) => [text(row.id), row]))
  const started = (row?: Row) => Boolean(row) && text(row?.startDate) !== '' && text(row?.startDate) <= todayKey
  const finished = (row?: Row) => started(row) && dayAfter(text(row?.startDate), Math.max(1, Number(row?.dayCount) || 1) - 1) < todayKey
  const certified = new Set(input.certificates.filter((row) => row.status === 'valid').map((row) => text(row.learnerId)))
  const trained = input.learners.filter((row) => started(classes.get(text(row.classId))))
  const ofFinished = trained.filter((row) => finished(classes.get(text(row.classId))))
  const trainingByMonth = months.map((month) => ({ month, learners: 0, classes: 0 }))
  for (const row of input.classes) {
    const slot = trainingByMonth.find((item) => item.month === text(row.startDate).slice(0, 7))
    if (!slot || !started(row)) continue
    slot.classes += 1
    slot.learners += trained.filter((learner) => text(learner.classId) === text(row.id)).length
  }

  // The people trained: gender, youth (under 35 on the first training day) and disability, from what was asked and,
  // where gender or date of birth was not asked, a South African ID number.
  const people = { female: 0, male: 0, genderUnknown: 0, youth: 0, ageUnknown: 0, withDisability: 0 }
  for (const row of trained) {
    const details = (row.details && typeof row.details === 'object' ? row.details : {}) as Row
    const fromId = saIdDetails(row.idNumber, input.today)
    const gender = text(details.gender).toLowerCase() || fromId?.gender || ''
    if (gender === 'female') people.female += 1
    else if (gender === 'male') people.male += 1
    else people.genderUnknown += 1
    const age = ageOn(text(details.dateOfBirth) || fromId?.dateOfBirth || '', text(classes.get(text(row.classId))?.startDate))
    if (age === null) people.ageUnknown += 1
    else if (age < 35) people.youth += 1
    if (text(details.disabilityStatus) === 'yes') people.withDisability += 1
  }

  // Organisations served, by name.
  const organisations = new Map<string, { name: string, learners: number, certified: number, esgReports: number, revenue: number }>()
  const organisation = (name: string) => {
    const key = name.toLowerCase()
    if (!organisations.has(key)) organisations.set(key, { name, learners: 0, certified: 0, esgReports: 0, revenue: revenueByOrganisation.get(key) || 0 })
    return organisations.get(key) as { name: string, learners: number, certified: number, esgReports: number, revenue: number }
  }
  for (const row of trained) {
    const name = text(row.organisation)
    if (!name) continue
    const item = organisation(name)
    item.learners += 1
    if (certified.has(text(row.id))) item.certified += 1
  }
  for (const row of input.reports) {
    const name = text(row.clientName)
    if (name) organisation(name).esgReports += 1
  }
  for (const [key, value] of revenueByOrganisation) {
    if (!organisations.has(key)) {
      const name = input.revenue.find((row) => text(row.organisation).toLowerCase() === key)
      organisations.set(key, { name: text(name?.organisation), learners: 0, certified: 0, esgReports: 0, revenue: value })
    }
  }

  // The businesses served that have given their details: their baseline revenue, employees and B-BBEE level.
  const served = new Set(organisations.keys())
  const profiles = (input.organisations || []).filter((row) => served.has(text(row.name).toLowerCase()))
  const businessDetails = profiles.map((row) => (row.details && typeof row.details === 'object' ? row.details : {}) as Row)
  const numberOf = (value: unknown) => {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.]/g, ''))
    return Number.isFinite(parsed) && String(value ?? '').trim() !== '' ? parsed : null
  }
  const levels = new Map<string, number>()
  for (const details of businessDetails) {
    const level = text(details.beeLevel)
    if (level) levels.set(level, (levels.get(level) || 0) + 1)
  }
  const baselineRevenues = businessDetails.map((details) => numberOf(details.baselineRevenue)).filter((value): value is number => value !== null)
  const employees = businessDetails.map((details) => numberOf(details.employees)).filter((value): value is number => value !== null)

  // Progress since the training: each business's monthly figures of the last 12 months, as a yearly rate, against
  // its own yearly baseline.
  let latestRevenue = 0
  let baselineOfThose = 0
  let latestEmployees = 0
  let withLatestFigures = 0
  for (const row of profiles) {
    const own = (input.metrics || [])
      .filter((entry) => text(entry.organisationId) === text(row.id) && numberOf(entry.revenue) !== null && text(entry.period) >= months[0])
      .sort((a, b) => text(b.period).localeCompare(text(a.period)))
    const details = (row.details && typeof row.details === 'object' ? row.details : {}) as Row
    const baseline = numberOf(details.baselineRevenue)
    if (!own.length || baseline === null) continue
    withLatestFigures += 1
    latestRevenue += Math.round((own.reduce((total, entry) => total + (numberOf(entry.revenue) || 0), 0) / own.length) * 12)
    baselineOfThose += baseline
    latestEmployees += numberOf(own[0].employees) ?? (numberOf(details.employees) || 0)
  }

  const finals = input.reports.filter((row) => row.status === 'final').length
  return {
    companyName: input.companyName,
    funderName: input.funderName || null,
    generatedAt: input.today.toISOString(),
    revenue: { last12Months, thisYear, paid, outstanding, byService, byMonth },
    training: {
      classes: input.classes.filter((row) => started(row)).length,
      classesFinished: input.classes.filter((row) => finished(row)).length,
      learners: trained.length,
      learnersCertified: trained.filter((row) => certified.has(text(row.id))).length,
      passRatePct: ofFinished.length ? Math.round((ofFinished.filter((row) => certified.has(text(row.id))).length / ofFinished.length) * 100) : null,
      byMonth: trainingByMonth,
      people,
    },
    businesses: {
      withDetails: profiles.length,
      baselineRevenue: baselineRevenues.reduce((total, value) => total + value, 0),
      withBaselineRevenue: baselineRevenues.length,
      employees: employees.reduce((total, value) => total + value, 0),
      withLatestFigures,
      latestRevenue,
      revenueGrowthPct: baselineOfThose ? Math.round(((latestRevenue - baselineOfThose) / baselineOfThose) * 1000) / 10 : null,
      latestEmployees,
      beeLevels: [...levels.entries()].map(([level, count]) => ({ level, count })).sort((a, b) => a.level.localeCompare(b.level)),
    },
    esg: {
      reports: input.reports.length,
      final: finals,
      inProgress: input.reports.length - finals,
      countries: [...new Set(input.reports.map((row) => text(row.country)).filter(Boolean))].sort(),
      sectors: [...new Set(input.reports.map((row) => text(row.sector)).filter(Boolean))].sort(),
    },
    organisations: [...organisations.values()].sort((a, b) => b.revenue - a.revenue || b.learners - a.learners || a.name.localeCompare(b.name)),
  }
}

/**
 * The report for whoever is asking, or an error when they may not see one. A funder always gets its own view;
 * staff get the whole company's, or `requestedFunderId`'s view to check what that funder sees.
 */
export const clientFunderSummary = async (db: Firestore, uid: string, today = new Date(), requestedFunderId?: string) => {
  const profile = (await db.collection('users').doc(uid).get()).data() || {}
  const role = text(profile.role).toLowerCase()
  const companyCode = text(profile.companyCode)
  if (!READER_ROLES.includes(role) || !companyCode) throw new ClientFunderError('permission-denied', 'Only the company\'s funder and its staff see this report.')
  const company = (await db.collection('companies').doc(companyCode).get()).data() || {}
  if (company.awarenessTrainingEnabled !== true && company.esgReportingEnabled !== true) {
    throw new ClientFunderError('failed-precondition', 'This report is only for companies running training or ESG reporting.')
  }
  // A funder's view is its own funder record's; a funder account without one is shown nothing.
  const funderId = role === 'funder' ? text(profile.funderId) || '__none__' : STAFF_ROLES.includes(role) ? text(requestedFunderId) : ''
  const rows = async (collection: string) => (await db.collection(collection).where('companyCode', '==', companyCode).get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const [classes, learners, certificates, reports, revenue, organisations, funders, metrics] = await Promise.all([
    rows('trainingClasses'), rows('trainingLearners'), rows('trainingCertificates'), rows('esgReports'), rows('clientRevenue'), rows('trainingOrganisations'), rows('trainingFunders'), rows('trainingOrgMetrics'),
  ])
  const funder = funderId ? funders.find((row) => row.id === funderId) : undefined
  const input: FunderSummaryInput = {
    companyName: text(company.companyName) || text(company.name) || companyCode,
    funderName: funder ? text((funder as Row).name) : undefined,
    classes, learners, certificates, reports, revenue, organisations, metrics, today,
  }
  return summariseForFunder(funderId ? fundedBy(input, funderId) : input)
}
