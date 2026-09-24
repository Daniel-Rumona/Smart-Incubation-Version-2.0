import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

export type AppointmentStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'completed'
export type MeetingType = 'telephonic' | 'online' | 'in_person'
export type CalendarView = 'day' | 'week' | 'month' | 'agenda'

/** The minimum shape the calendar needs. Callers pass their own richer row type. */
export type CalendarAppointment = {
    id: string
    interventionTitle: string
    participantName?: string | null
    participantEmail?: string | null
    meetingType: MeetingType
    meetingLink?: string | null
    location?: string | null
    status: AppointmentStatus
    startTime?: unknown
    endTime?: unknown
    /** Reason the SME gave when declining (web or WhatsApp). */
    declineReason?: string | null
    /** not_available | other_engagement | no_longer_needed | other */
    declineReasonCode?: string | null
    /** True while the SME's "no longer need this intervention" is waiting for operations to confirm. */
    declineNeedsReview?: boolean | null
    /** An SME's ask to move the meeting; `status: 'requested'` means it still needs an answer. */
    rescheduleRequest?: RescheduleRequest | null
}

export type RescheduleRequest = {
    status?: string
    reasonText?: string | null
    requestedDate?: string | null
    requestedTime?: string | null
    /** Structured suggestion (Firestore Timestamp) when the SME picked a time on the web. */
    requestedStart?: unknown
    requestedEnd?: unknown
    requestedDateText?: string | null
    requestedTimeText?: string | null
    requestedVia?: string | null
}

/** The SME dropped the intervention (before its first session) and operations has not yet confirmed it. */
export const isInterventionDropRequest = (appointment?: Pick<CalendarAppointment, 'status' | 'declineReasonCode' | 'declineNeedsReview'> | null) =>
    Boolean(appointment && appointment.status === 'declined' && (appointment.declineNeedsReview || appointment.declineReasonCode === 'no_longer_needed'))

/** Plain-language summary of an open reschedule request, or null when there isn't one. */
export const openRescheduleRequestSummary = (request?: RescheduleRequest | null): string | null => {
    if (!request || String(request.status || '').toLowerCase() !== 'requested') return null
    const when = [request.requestedDateText || request.requestedDate, request.requestedTimeText || request.requestedTime].filter(Boolean).join(' ')
    return [when && `Preferred time: ${when}`, request.reasonText && `Reason: ${request.reasonText}`].filter(Boolean).join(' · ') || 'The SME asked to reschedule.'
}

export const CALENDAR_VIEWS: Array<{ value: CalendarView; label: string }> = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
    { value: 'agenda', label: 'Agenda' },
]

export const STATUS_META: Record<AppointmentStatus, { label: string; tag: string }> = {
    pending: { label: 'Awaiting acceptance', tag: 'gold' },
    accepted: { label: 'Confirmed', tag: 'blue' },
    completed: { label: 'Completed', tag: 'green' },
    declined: { label: 'Declined', tag: 'red' },
    cancelled: { label: 'Cancelled', tag: 'red' },
}

/** Compact labels for the day panel's filter pills, which have very little width to spend. */
export const STATUS_SHORT_LABEL: Record<AppointmentStatus, string> = {
    pending: 'Pending',
    accepted: 'Confirmed',
    completed: 'Done',
    declined: 'Declined',
    cancelled: 'Cancelled',
}

export const statusLabel = (status?: AppointmentStatus) => STATUS_META[status as AppointmentStatus]?.label ?? 'Unknown'
export const statusColor = (status?: AppointmentStatus) => STATUS_META[status as AppointmentStatus]?.tag ?? 'default'

export const MEETING_TYPE_OPTIONS: Array<{ value: MeetingType; label: string }> = [
    { value: 'in_person', label: 'In-Person' },
    { value: 'online', label: 'Online' },
    { value: 'telephonic', label: 'Telephonic' },
]

export const meetingTypeLabel = (value?: string | null) => {
    const match = MEETING_TYPE_OPTIONS.find((option) => option.value === value)
    if (match) return match.label
    return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export const toDate = (value: unknown): Date | null => {
    if (!value) return null
    if (value instanceof Date) return Number.isNaN(+value) ? null : value
    if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return (value as { toDate: () => Date }).toDate()
    if (typeof value === 'object' && value && 'seconds' in value && typeof (value as { seconds: unknown }).seconds === 'number') return new Date((value as { seconds: number }).seconds * 1000)
    const parsed = new Date(String(value))
    return Number.isNaN(+parsed) ? null : parsed
}

export const toDayjs = (value: unknown) => {
    const date = toDate(value)
    return date ? dayjs(date) : null
}

export const DAY_KEY_FORMAT = 'YYYY-MM-DD'
export const dayKey = (value: Dayjs) => value.format(DAY_KEY_FORMAT)

/** Minutes past midnight, used as the coordinate system for the time grids. */
export const minutesOf = (value: Dayjs) => value.hour() * 60 + value.minute()

/** A booking's span in minutes-past-midnight, clamped so zero-length meetings stay clickable. */
export const spanOf = (appointment: CalendarAppointment) => {
    const start = toDayjs(appointment.startTime)
    if (!start) return null
    const end = toDayjs(appointment.endTime)
    const startMinutes = minutesOf(start)
    const endMinutes = end && end.isAfter(start) && end.isSame(start, 'day') ? minutesOf(end) : startMinutes + 30
    return { start: startMinutes, end: Math.min(24 * 60, Math.max(endMinutes, startMinutes + 15)) }
}

/**
 * Buckets appointments by calendar day so the grids never rescan the whole list per cell.
 * Each bucket is sorted chronologically.
 */
export const groupByDay = <T extends CalendarAppointment>(appointments: T[]) => {
    const buckets = new Map<string, T[]>()
    appointments.forEach((appointment) => {
        const start = toDayjs(appointment.startTime)
        if (!start) return
        const key = dayKey(start)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(appointment)
        else buckets.set(key, [appointment])
    })
    buckets.forEach((bucket) => bucket.sort((left, right) => (toDayjs(left.startTime)?.valueOf() ?? 0) - (toDayjs(right.startTime)?.valueOf() ?? 0)))
    return buckets
}

export type LaidOutAppointment<T> = { appointment: T; start: number; end: number; lane: number }
export type AppointmentCluster<T> = { start: number; end: number; lanes: number; items: Array<LaidOutAppointment<T>> }

/**
 * Splits a day's appointments into clusters of mutually overlapping meetings and gives each one a
 * lane. Clusters are the unit the time grid draws: everything inside one shares the column width,
 * so a day with six overlapping meetings stays readable instead of stacking on top of itself.
 */
export const buildClusters = <T extends CalendarAppointment>(appointments: T[]): Array<AppointmentCluster<T>> => {
    const spans = appointments
        .map((appointment) => {
            const span = spanOf(appointment)
            return span ? { appointment, start: span.start, end: span.end, lane: 0 } : null
        })
        .filter((entry): entry is LaidOutAppointment<T> => entry !== null)
        .sort((left, right) => left.start - right.start || left.end - right.end)

    const clusters: Array<AppointmentCluster<T>> = []
    let current: AppointmentCluster<T> | null = null

    spans.forEach((entry) => {
        if (!current || entry.start >= current.end) {
            current = { start: entry.start, end: entry.end, lanes: 1, items: [] }
            clusters.push(current)
        }
        const occupied = new Set(current.items.filter((item) => item.end > entry.start).map((item) => item.lane))
        let lane = 0
        while (occupied.has(lane)) lane += 1
        entry.lane = lane
        current.items.push(entry)
        current.end = Math.max(current.end, entry.end)
        current.lanes = Math.max(current.lanes, lane + 1)
    })

    return clusters
}

const DEFAULT_START_HOUR = 7
const DEFAULT_END_HOUR = 19

/**
 * Time grids only render hours that can hold something. The window always covers working hours but
 * stretches to include early or late bookings so nothing is silently hidden off-grid.
 */
export const hourWindow = (appointments: CalendarAppointment[]) => {
    let earliest = DEFAULT_START_HOUR
    let latest = DEFAULT_END_HOUR
    appointments.forEach((appointment) => {
        const span = spanOf(appointment)
        if (!span) return
        earliest = Math.min(earliest, Math.floor(span.start / 60))
        latest = Math.max(latest, Math.ceil(span.end / 60))
    })
    return { startHour: Math.max(0, earliest), endHour: Math.min(24, Math.max(latest, earliest + 4)) }
}

export const rangeLabel = (view: CalendarView, anchor: Dayjs) => {
    if (view === 'day') return anchor.format('dddd, DD MMMM YYYY')
    if (view === 'week') {
        const start = anchor.startOf('week')
        const end = anchor.endOf('week')
        return start.isSame(end, 'month')
            ? `${start.format('DD')} – ${end.format('DD MMMM YYYY')}`
            : `${start.format('DD MMM')} – ${end.format('DD MMM YYYY')}`
    }
    if (view === 'agenda') return 'Upcoming schedule'
    return anchor.format('MMMM YYYY')
}

export const navigationUnit = (view: CalendarView) => (view === 'day' ? 'day' : view === 'week' ? 'week' : 'month')

export const visibleDays = (view: CalendarView, anchor: Dayjs) => {
    if (view === 'day') return [anchor]
    if (view === 'week') return Array.from({ length: 7 }, (_, index) => anchor.startOf('week').add(index, 'day'))
    const gridStart = anchor.startOf('month').startOf('week')
    const weeks = Math.ceil((anchor.startOf('month').day() + anchor.daysInMonth()) / 7)
    return Array.from({ length: weeks * 7 }, (_, index) => gridStart.add(index, 'day'))
}

export const periodOf = (value: Dayjs) => {
    const hour = value.hour()
    if (hour < 12) return 'Morning'
    if (hour < 17) return 'Afternoon'
    return 'Evening'
}

export const formatSpan = (appointment: CalendarAppointment) => {
    const start = toDayjs(appointment.startTime)
    if (!start) return 'Time to be confirmed'
    const end = toDayjs(appointment.endTime)
    return end && end.isAfter(start) ? `${start.format('HH:mm')} – ${end.format('HH:mm')}` : start.format('HH:mm')
}
