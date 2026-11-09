import dayjs from 'dayjs'
import { MEETING_PLATFORM_LABELS, detectMeetingPlatform } from '@/utils/meetingLinks'
import { classEndDate, classPhase, hoursOfDay, trainingDayOn, trainingDays } from '@/utils/trainingResults'
import type { TrainingClass, TrainingClassHours, TrainingClassPhase, TrainingLearner, TrainingLibraryCategory, TrainingResultStatus } from '@/types/training'

type Translate = (key: string, fallback?: string, vars?: Record<string, string | number>) => string

export const phaseLabel = (phase: TrainingClassPhase, t: Translate) => ({
    upcoming: t('Upcoming'),
    running: t('Ongoing'),
    finished: t('Finished'),
}[phase])

/** The status of a class as people say it: "Upcoming", "Day 2 of 3" (or "Today" for a one-day class), "Finished". */
export const classStatusLabel = (trainingClass: Pick<TrainingClass, 'startDate' | 'dayCount' | 'hours' | 'dayHours'>, t: Translate) => {
    const phase = classPhase(trainingClass)
    if (phase !== 'running') return phaseLabel(phase, t)
    const day = trainingDayOn(trainingClass)
    if (!day) return phaseLabel(phase, t)
    return trainingClass.dayCount <= 1 ? t('Today') : t('Day {day} of {days}', undefined, { day, days: trainingClass.dayCount })
}

export const hoursLabel = (hours?: TrainingClassHours) => (hours ? `${hours.start} – ${hours.end}` : '')

/** "09:00 – 16:00", "Hours vary by day" when some days differ, or '' for a class without hours. */
export const classHoursLabel = (trainingClass: Pick<TrainingClass, 'dayCount' | 'hours' | 'dayHours'>, t: Translate) => {
    const byDay = trainingDays(trainingClass.dayCount).map((day) => hoursLabel(hoursOfDay(trainingClass, day)))
    if (!byDay[0]) return ''
    return byDay.every((label) => label === byDay[0]) ? byDay[0] : t('Hours vary by day')
}

/** Each day with its date and hours: "Day 1 · Mon 2 Nov · 09:00 – 16:00". */
export const classScheduleLines = (trainingClass: Pick<TrainingClass, 'startDate' | 'dayCount' | 'hours' | 'dayHours'>, t: Translate) =>
    trainingDays(trainingClass.dayCount).map((day) => [
        t('Day {day}', undefined, { day }),
        dayjs(trainingClass.startDate).add(Number(day) - 1, 'day').format('ddd D MMM'),
        hoursLabel(hoursOfDay(trainingClass, day)),
    ].filter(Boolean).join(' · '))

export const resultLabel = (status: TrainingResultStatus, t: Translate) => ({
    not_started: t('Assessment not written'),
    awaiting_marking: t('Awaiting marking'),
    reassessment_available: t('Reassessment available'),
    awaiting_group: t('Awaiting group mark'),
    passed: t('Passed'),
    not_passed: t('Not passed'),
}[status])

/** "12 – 14 Nov 2026", or a single date for a one-day class. */
export const classDatesLabel = (trainingClass: Pick<TrainingClass, 'startDate' | 'dayCount'>) => {
    const start = dayjs(trainingClass.startDate)
    if (!start.isValid()) return '—'
    const end = dayjs(classEndDate(trainingClass))
    if (trainingClass.dayCount <= 1) return start.format('D MMM YYYY')
    if (start.isSame(end, 'month')) return `${start.format('D')} – ${end.format('D MMM YYYY')}`
    return `${start.format('D MMM')} – ${end.format('D MMM YYYY')}`
}

/** Where the class happens: its venue, "Online · Zoom" (the platform recognised from the meeting link), or both. */
export const classLocationLabel = (trainingClass: Pick<TrainingClass, 'deliveryMode' | 'venue' | 'meetingUrl'>, t: Translate) => {
    const platform = t(MEETING_PLATFORM_LABELS[detectMeetingPlatform(trainingClass.meetingUrl)])
    if (trainingClass.deliveryMode === 'online') return t('Online · {platform}', undefined, { platform })
    if (trainingClass.deliveryMode === 'hybrid') return t('{venue} and online · {platform}', undefined, { venue: trainingClass.venue || t('Venue'), platform })
    return trainingClass.venue || '—'
}

/** Learners can join from a meeting link: online and hybrid classes. */
export const hasMeetingLink = (trainingClass: Pick<TrainingClass, 'deliveryMode' | 'meetingUrl'>) =>
    trainingClass.deliveryMode !== 'in_person' && Boolean(trainingClass.meetingUrl)

/** ID numbers are personal information: lists show the last four digits only. */
export const maskIdNumber = (idNumber: string) =>
    idNumber.length > 4 ? `${'•'.repeat(Math.min(9, idNumber.length - 4))}${idNumber.slice(-4)}` : idNumber || '—'

export const pctLabel = (value?: number) => (typeof value === 'number' ? `${value}%` : '—')

/** The class's client organisations, one spelling each (the first one entered), sorted. */
export const organisationsOf = (learners: Pick<TrainingLearner, 'organisation'>[]) =>
    [...new Map(learners.map((learner) => [learner.organisation.toLowerCase(), learner.organisation])).values()]
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))

/** The company filter's value for every company. */
export const ALL_ORGANISATIONS = 'all'

export const sameOrganisation = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()

export const inOrganisation = (organisation: string) => (row: Pick<TrainingLearner, 'organisation'>) =>
    organisation === ALL_ORGANISATIONS || sameOrganisation(row.organisation, organisation)

/** Rows grouped by company in name order; learners without one come last. */
export const groupByOrganisation = <T extends Pick<TrainingLearner, 'organisation'>>(rows: T[]) => {
    const groups = organisationsOf(rows).map((organisation) => ({ organisation, rows: rows.filter((row) => sameOrganisation(row.organisation, organisation)) }))
    const without = rows.filter((row) => !row.organisation.trim())
    return without.length ? [...groups, { organisation: '', rows: without }] : groups
}

export const LIBRARY_CATEGORY_LABELS: Record<TrainingLibraryCategory, string> = {
    course_material: 'Course material',
    reading: 'Reading',
    template: 'Template',
    reference: 'Reference',
}

/** Rand, without cents: R 12 500. */
export const rand = (value: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
