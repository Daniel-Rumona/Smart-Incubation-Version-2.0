export type PublicHoliday = {
  /** Calendar date as YYYY-MM-DD (the actual holiday date). */
  date: string
  name: string
  /** Set when the holiday falls on a Sunday and the following Monday is also a public holiday. */
  observedDate?: string
}

export type HolidayStatus = {
  holiday: PublicHoliday
  /** 0 = today, 1 = tomorrow, ... Negative values never occur. */
  daysAway: number
  /** True when today is the observed (Monday) day of a Sunday holiday. */
  isObservedDay: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`
const toIso = (d: Date) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate())

/** Anonymous Gregorian algorithm for Easter Sunday. */
const easterSunday = (year: number): Date => {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)

/** South African public holidays for a year (Public Holidays Act 36 of 1994). Ad-hoc government-declared days are not included. */
export const getSouthAfricanHolidays = (year: number): PublicHoliday[] => {
  const easter = easterSunday(year)
  const fixed: Array<[number, number, string]> = [
    [1, 1, "New Year's Day"],
    [3, 21, 'Human Rights Day'],
    [4, 27, 'Freedom Day'],
    [5, 1, "Workers' Day"],
    [6, 16, 'Youth Day'],
    [8, 9, "National Women's Day"],
    [9, 24, 'Heritage Day'],
    [12, 16, 'Day of Reconciliation'],
    [12, 25, 'Christmas Day'],
    [12, 26, 'Day of Goodwill'],
  ]

  const holidays: PublicHoliday[] = fixed.map(([month, day, name]) => {
    const date = iso(year, month, day)
    const holiday: PublicHoliday = { date, name }
    if (new Date(year, month - 1, day).getDay() === 0) {
      holiday.observedDate = toIso(new Date(year, month - 1, day + 1))
    }
    return holiday
  })

  holidays.push({ date: toIso(addDays(easter, -2)), name: 'Good Friday' })
  holidays.push({ date: toIso(addDays(easter, 1)), name: 'Family Day' })

  return holidays.sort((x, y) => x.date.localeCompare(y.date))
}

/** True if the given date (default today) is a South African public holiday, including Sunday-holiday Mondays. */
export const isSouthAfricanHoliday = (at: Date = new Date()): boolean =>
  getUpcomingSouthAfricanHoliday(at, 0) !== null

/**
 * The holiday happening today or within `withinDays` days, whichever is nearest.
 * Returns null when none applies.
 */
export const getUpcomingSouthAfricanHoliday = (
  at: Date = new Date(),
  withinDays = 7,
): HolidayStatus | null => {
  const today = new Date(at.getFullYear(), at.getMonth(), at.getDate())
  const candidates = [
    ...getSouthAfricanHolidays(today.getFullYear() - 1),
    ...getSouthAfricanHolidays(today.getFullYear()),
    ...getSouthAfricanHolidays(today.getFullYear() + 1),
  ]

  let best: HolidayStatus | null = null
  for (const holiday of candidates) {
    const days: Array<[string, boolean]> = [[holiday.date, false]]
    if (holiday.observedDate) days.push([holiday.observedDate, true])
    for (const [dateStr, isObservedDay] of days) {
      const [y, m, d] = dateStr.split('-').map(Number)
      const daysAway = Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000)
      if (daysAway < 0 || daysAway > withinDays) continue
      if (!best || daysAway < best.daysAway) best = { holiday, daysAway, isObservedDay }
    }
  }
  return best
}
