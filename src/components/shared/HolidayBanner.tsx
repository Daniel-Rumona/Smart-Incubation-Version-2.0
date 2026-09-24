import { useState } from 'react'
import { CloseOutlined } from '@ant-design/icons'
import { getUpcomingSouthAfricanHoliday } from '@/utils/holidays'
import { useThemeMode } from '@/providers/ThemeProvider'
import '@/styles/holiday-banner.css'

const GREETINGS: Record<string, string> = {
  "New Year's Day": 'Wishing you a bright and successful year ahead!',
  'Human Rights Day': 'Celebrating the rights and dignity of every South African.',
  'Good Friday': 'Wishing you a peaceful and restful long weekend.',
  'Family Day': 'Spend it with the people who matter most.',
  'Freedom Day': 'Celebrating our freedom and democracy!',
  "Workers' Day": 'Thank you for everything you build and contribute.',
  'Youth Day': 'Honouring the young people who shaped our future.',
  "National Women's Day": 'Celebrating the strength of South African women!',
  'Heritage Day': 'Celebrate our rich cultures, traditions and diversity. Enjoy a braai!',
  'Day of Reconciliation': 'Celebrating unity across our rainbow nation.',
  'Christmas Day': 'Wishing you joy, love and a wonderful festive season!',
  'Day of Goodwill': 'Spread kindness and enjoy the festive spirit.',
}

const DISMISS_KEY = 'holidayBannerDismissed'

const readDismissed = (): string | null => {
  try {
    return sessionStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

const formatDate = (dateStr: string) => {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-ZA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

/** Celebrates South African public holidays (today, or coming up within a week). */
export const HolidayBanner = () => {
  const { mode } = useThemeMode()
  const status = getUpcomingSouthAfricanHoliday(new Date(), 7)
  const [dismissed, setDismissed] = useState(() => readDismissed())

  if (!status) return null
  const { holiday, daysAway, isObservedDay } = status
  const key = `${holiday.date}:${daysAway === 0 ? 'today' : 'soon'}`
  if (dismissed === key) return null

  const name = isObservedDay ? `${holiday.name} (observed)` : holiday.name
  const targetDate = isObservedDay && holiday.observedDate ? holiday.observedDate : holiday.date
  const isToday = daysAway === 0
  const greeting = GREETINGS[holiday.name] ?? 'Enjoy the day off!'

  let title: string
  let message: string
  if (isToday) {
    title = `Happy ${name}, South Africa!`
    message = `${greeting} Some services and support may be limited today.`
  } else if (daysAway === 1) {
    title = `${name} is tomorrow!`
    message = `${greeting} Get ready to celebrate.`
  } else {
    title = `${name} is coming up on ${formatDate(targetDate)}`
    message = greeting
  }

  const dismiss = () => {
    setDismissed(key)
    try {
      sessionStorage.setItem(DISMISS_KEY, key)
    } catch {
      // Dismissal simply won't persist for this session.
    }
  }

  const classes = [
    'holiday-banner',
    isToday ? 'holiday-banner--today' : '',
    mode === 'dark' ? 'holiday-banner--dark' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} role="status">
      <span className="holiday-banner__icon" aria-hidden="true">
        {isToday ? '\u{1F389}' : '\u{1F1FF}\u{1F1E6}'}
      </span>
      <span className="holiday-banner__text">
        <strong className="holiday-banner__title">{title}</strong>
        <span className="holiday-banner__message">{message}</span>
      </span>
      <button type="button" className="holiday-banner__close" onClick={dismiss} aria-label="Dismiss holiday notice">
        <CloseOutlined />
      </button>
    </div>
  )
}

export default HolidayBanner
