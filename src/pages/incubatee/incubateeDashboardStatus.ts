import dayjs from 'dayjs'
import type { FirestoreDate } from '@/types/interventions'

export const toDate = (value: FirestoreDate) => {
    if (!value) return null
    if (typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') return dayjs(value.toDate())
    const parsed = dayjs(value as string | number | Date)
    return parsed.isValid() ? parsed : null
}

/** Due dates only earn their space when they say something: overdue, today, or the date itself. */
export const describeDue = (value: FirestoreDate) => {
    const date = toDate(value)
    if (!date) return ''
    const days = date.startOf('day').diff(dayjs().startOf('day'), 'day')
    if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
    if (days === 0) return 'Due today'
    if (days === 1) return 'Due tomorrow'
    return `Due ${date.format('DD MMM')}`
}
