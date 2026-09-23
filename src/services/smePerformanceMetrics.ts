import dayjs, { type Dayjs } from 'dayjs'

/*
 * Shared revenue/employee analytics helpers, factored out of SmeMetricsPage so the Reports
 * pages (Operations, ProjectAdmin) can build a "Performance" section on the same data model
 * without re-deriving it: participants carry a flat `revenue`/`employeeCount` (current value)
 * plus `revenueHistory.monthly` / `headcountHistory.monthly` ({"YYYY-MM": number}) trend data.
 */

export type FirestoreDateLike =
  | Date
  | string
  | number
  | {
      toDate?: () => Date
      seconds?: number
      nanoseconds?: number
    }
  | null
  | undefined

type AnyDoc = Record<string, unknown>

export type PerformanceSourceRow = {
  createdAt?: FirestoreDateLike
  acceptedAt?: FirestoreDateLike
  approvedAt?: FirestoreDateLike
  onboardedAt?: FirestoreDateLike
  revenue?: unknown
  annualRevenue?: unknown
  monthlyRevenue?: unknown
  turnover?: unknown
  annualTurnover?: unknown
  employeeCount?: unknown
  employees?: unknown
  numberOfEmployees?: unknown
  staffCount?: unknown
  jobsCreated?: unknown
  revenueHistory?: {
    monthly?: Record<string, unknown>
    annual?: Record<string, unknown>
  }
  headcountHistory?: {
    monthly?: Record<string, unknown>
    annual?: Record<string, unknown>
  }
}

type HistoryCadence = 'monthly' | 'annual'

type MetricEntry = {
  period: string
  date: Dayjs
  value: number
}

export const toDayjsValue = (value: FirestoreDateLike): Dayjs | null => {
  if (!value) return null
  if (dayjs.isDayjs(value)) return value.isValid() ? value : null
  if (value instanceof Date) {
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed : null
  }
  if (typeof value === 'number') {
    const parsed = dayjs(value > 1e12 ? value : value * 1000)
    return parsed.isValid() ? parsed : null
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const parsed = dayjs(value.toDate())
    return parsed.isValid() ? parsed : null
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const parsed = dayjs(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6))
    return parsed.isValid() ? parsed : null
  }
  const parsed = dayjs(String(value))
  return parsed.isValid() ? parsed : null
}

const inRange = (date: Dayjs, [start, end]: [Dayjs, Dayjs]) =>
  date.isValid() && !date.isBefore(start, 'day') && !date.isAfter(end, 'day')

const periodToDate = (period: string, cadence: HistoryCadence) => {
  const clean = period.trim()
  const parsed = cadence === 'annual' ? dayjs(`${clean}-12-31`) : dayjs(`${clean}-01`)
  return parsed.isValid() ? parsed : null
}

export const toMetricNumber = (...values: unknown[]): number => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object') {
      const nested: number = toMetricNumber(
        (value as AnyDoc).value,
        (value as AnyDoc).total,
        (value as AnyDoc).count,
        (value as AnyDoc).headcount,
        (value as AnyDoc).staffCount,
        (value as AnyDoc).numberOfEmployees,
      )
      if (nested > 0) return nested
    }
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export const getAnchorDate = (row: PerformanceSourceRow) => {
  const candidates = [row.onboardedAt, row.acceptedAt, row.approvedAt, row.createdAt]
  for (const candidate of candidates) {
    const parsed = toDayjsValue(candidate)
    if (parsed) return parsed
  }
  return null
}

export const getRevenueFallback = (row: PerformanceSourceRow) =>
  toMetricNumber(row.revenue, row.annualRevenue, row.turnover, row.annualTurnover, row.monthlyRevenue)

export const getEmployeeFallback = (row: PerformanceSourceRow) =>
  toMetricNumber(row.employeeCount, row.employees, row.numberOfEmployees, row.staffCount, row.jobsCreated)

const historyEntries = (history: PerformanceSourceRow['revenueHistory'] | PerformanceSourceRow['headcountHistory']) => {
  const entries: MetricEntry[] = []
  Object.entries(history?.monthly || {}).forEach(([period, raw]) => {
    const date = periodToDate(period, 'monthly')
    const value = toMetricNumber(raw)
    if (date && value > 0) entries.push({ period, date, value })
  })
  Object.entries(history?.annual || {}).forEach(([period, raw]) => {
    const date = periodToDate(period, 'annual')
    const value = toMetricNumber(raw)
    if (date && value > 0) entries.push({ period, date, value })
  })
  return entries.sort((a, b) => a.date.valueOf() - b.date.valueOf() || a.period.localeCompare(b.period))
}

export const revenueInRange = (row: PerformanceSourceRow, range: [Dayjs, Dayjs]) => {
  const entries = historyEntries(row.revenueHistory)
  const ranged = entries.filter(entry => inRange(entry.date, range))
  if (ranged.length) return ranged.reduce((sum, entry) => sum + entry.value, 0)
  const anchor = getAnchorDate(row)
  return !anchor || !anchor.isAfter(range[1], 'day') ? getRevenueFallback(row) : 0
}

export const employeesInRange = (row: PerformanceSourceRow, range: [Dayjs, Dayjs]) => {
  const entries = historyEntries(row.headcountHistory).filter(entry => inRange(entry.date, range))
  if (entries.length) return entries[entries.length - 1].value
  const anchor = getAnchorDate(row)
  return !anchor || !anchor.isAfter(range[1], 'day') ? getEmployeeFallback(row) : 0
}

export const formatCurrencyZAR = (value: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard',
  }).format(value)

export const formatMetricNumber = (value: number) => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(value)

export const periodDelta = (current: number, previous: number) => {
  const difference = current - previous
  if (previous === 0) return { label: current > 0 ? '+100%' : '0%', positive: difference >= 0, difference }
  const percentage = Number(((difference / previous) * 100).toFixed(1))
  return { label: `${percentage > 0 ? '+' : ''}${percentage}%`, positive: difference >= 0, difference }
}

export const getPreviousRange = ([start, end]: [Dayjs, Dayjs]): [Dayjs, Dayjs] => {
  const days = end.startOf('day').diff(start.startOf('day'), 'day') + 1
  const previousEnd = start.subtract(1, 'day').endOf('day')
  return [previousEnd.subtract(days - 1, 'day').startOf('day'), previousEnd]
}

export const bucketRange = (range: [Dayjs, Dayjs]) => {
  const [start, end] = range
  const days = end.diff(start, 'day') + 1
  const buckets: Array<{ key: string; label: string; range: [Dayjs, Dayjs] }> = []

  if (days <= 45) {
    let cursor = start.startOf('day')
    while (!cursor.isAfter(end, 'day')) {
      buckets.push({ key: cursor.format('YYYY-MM-DD'), label: cursor.format('DD MMM'), range: [cursor.startOf('day'), cursor.endOf('day')] })
      cursor = cursor.add(1, 'day')
    }
    return buckets
  }

  let cursor = start.startOf('month')
  while (!cursor.isAfter(end, 'month')) {
    buckets.push({
      key: cursor.format('YYYY-MM'),
      label: cursor.format('MMM YYYY'),
      range: [cursor.startOf('month'), cursor.endOf('month')],
    })
    cursor = cursor.add(1, 'month')
  }
  return buckets
}

export type MetricPerformance = {
  current: number
  previous: number
  delta: ReturnType<typeof periodDelta>
  growing: number
  declining: number
  flat: number
  total: number
  growthScore: number
  declineScore: number
  headline: { label: 'Growth Score' | 'Decline Score'; value: number; positive: boolean }
}

/**
 * Aggregates a metric (revenue or employees) across a set of SMEs for the current vs previous
 * period: the total delta, and a growth/decline score (the share of SMEs that individually moved
 * up vs down). `headline` picks whichever score dominates so a single card can show "Growth
 * Score" when most SMEs are trending up, or "Decline Score" when most are trending down.
 */
export const computeMetricPerformance = (
  rows: PerformanceSourceRow[],
  metricFn: (row: PerformanceSourceRow, range: [Dayjs, Dayjs]) => number,
  range: [Dayjs, Dayjs],
  previousRange: [Dayjs, Dayjs],
): MetricPerformance => {
  let currentTotal = 0
  let previousTotal = 0
  let growing = 0
  let declining = 0
  let flat = 0

  rows.forEach(row => {
    const current = metricFn(row, range)
    const previous = metricFn(row, previousRange)
    currentTotal += current
    previousTotal += previous
    if (current > previous) growing += 1
    else if (current < previous) declining += 1
    else flat += 1
  })

  const total = rows.length
  const growthScore = total ? Math.round((growing / total) * 100) : 0
  const declineScore = total ? Math.round((declining / total) * 100) : 0
  const headline: MetricPerformance['headline'] =
    growthScore >= declineScore
      ? { label: 'Growth Score', value: growthScore, positive: true }
      : { label: 'Decline Score', value: declineScore, positive: false }

  return {
    current: currentTotal,
    previous: previousTotal,
    delta: periodDelta(currentTotal, previousTotal),
    growing,
    declining,
    flat,
    total,
    growthScore,
    declineScore,
    headline,
  }
}
