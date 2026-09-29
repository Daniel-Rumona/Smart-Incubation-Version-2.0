import dayjs from 'dayjs'

type Stamped = { participantDiscontinuedAt?: unknown }

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(+value) ? null : value
  if (typeof value === 'object' && 'toDate' in (value as object) && typeof (value as { toDate: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate()
  }
  if (typeof value === 'object' && 'seconds' in (value as object)) return new Date(Number((value as { seconds: number }).seconds) * 1000)
  const parsed = new Date(value as string)
  return Number.isNaN(+parsed) ? null : parsed
}

/** True once the SME behind this assignment/appointment has been discontinued. */
export const isDiscontinuedRecord = (record: Stamped) => Boolean(toDate(record.participantDiscontinuedAt))

/**
 * Whether a record counts on `date`. Current views (no date) drop discontinued SMEs entirely;
 * historical views keep them up to and including the day they were discontinued.
 */
export const countsForDiscontinued = (record: Stamped, date?: Date | null) => {
  const cutoff = toDate(record.participantDiscontinuedAt)
  if (!cutoff) return true
  return !!date && !dayjs(date).isAfter(cutoff, 'day')
}
