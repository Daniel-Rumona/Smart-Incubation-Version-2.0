import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where, type DocumentData } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { isAssignmentCompleted } from '@/services/directorPortfolioService'
import { meetingHours, ownershipOf, type Ownership } from '@/services/funderImpactService'
import type { DirectorPortfolioSme } from '@/types/director'

/**
 * The longer SME detail on the funder Portfolio: its support plan, meetings and ownership, loaded when an SME is
 * chosen. Every query names the SME's company and programme, as firestore.rules requires of a funder's reads.
 * Processed facts only: no contact details, documents or meeting links.
 */

type Row = DocumentData & { id: string }

export type SmeSupportItem = {
  id: string
  title: string
  area: string
  state: 'done' | 'overdue' | 'due' | 'open'
  due: Dayjs | null
  completed: Dayjs | null
}

export type SmeMeeting = { id: string; title: string; at: Dayjs | null; status: string; hours: number }

export type SmeDetail = {
  support: SmeSupportItem[]
  meetingsHeld: number
  meetingHours: number
  nextMeeting: SmeMeeting | null
  recentMeetings: SmeMeeting[]
  ownership: Ownership | null
  beeLevel: string
  province: string
}

const text = (value: unknown) => String(value ?? '').trim()
const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string)
  return parsed.isValid() ? parsed : null
}

const scopedQuery = (name: string, sme: DirectorPortfolioSme) =>
  query(collection(getFirebaseDb(), name), where('companyCode', '==', text(sme.companyCode)), where('programId', 'in', [text(sme.programId)]))

export const loadSmeDetail = async (sme: DirectorPortfolioSme): Promise<SmeDetail> => {
  if (!text(sme.companyCode) || !text(sme.programId)) {
    return { support: [], meetingsHeld: 0, meetingHours: 0, nextMeeting: null, recentMeetings: [], ownership: null, beeLevel: '', province: '' }
  }
  const [assignments, appointments, applications] = await Promise.all([
    getDocs(query(collection(getFirebaseDb(), 'assignedInterventions'), where('companyCode', '==', text(sme.companyCode)), where('programId', 'in', [text(sme.programId)]), where('participantId', '==', sme.id)))
      .then((snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)))
      .catch(() => [] as Row[]),
    getDocs(scopedQuery('appointments', sme))
      .then((snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)).filter((row) => text(row.participantId) === sme.id))
      .catch(() => [] as Row[]),
    getDocs(query(collection(getFirebaseDb(), 'applications'), where('companyCode', '==', text(sme.companyCode)), where('programId', 'in', [text(sme.programId)]), where('applicationStatus', '==', 'accepted')))
      .then((snapshot) => snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)).filter((row) => (text(row.participantId) || row.id) === sme.id))
      .catch(() => [] as Row[]),
  ])

  const today = dayjs().startOf('day')
  const support: SmeSupportItem[] = assignments.map((row) => {
    const done = isAssignmentCompleted(row)
    const due = toDay(row.dueDate)
    const state: SmeSupportItem['state'] = done ? 'done'
      : due && due.isBefore(today, 'day') ? 'overdue'
        : due && due.diff(today, 'day') <= 14 ? 'due' : 'open'
    return {
      id: row.id,
      title: text(row.interventionTitle || row.title) || 'Intervention',
      area: text(row.areaOfSupport || row.area),
      state,
      due,
      completed: done ? toDay(row.completedAt || row.completionConfirmedAt || row.updatedAt) : null,
    }
  }).sort((left, right) => {
    const order = { overdue: 0, due: 1, open: 2, done: 3 }
    return (order[left.state] - order[right.state]) || ((left.due?.valueOf() || 0) - (right.due?.valueOf() || 0))
  })

  const meetings: SmeMeeting[] = appointments.map((row) => ({
    id: row.id,
    title: text(row.interventionTitle || row.title) || 'Meeting',
    at: toDay(row.startTime),
    status: text(row.status).toLowerCase() || 'pending',
    hours: meetingHours(row),
  }))
  const held = meetings.filter((row) => row.status === 'completed')
  const upcoming = meetings
    .filter((row) => row.at && row.at.isAfter(dayjs()) && ['pending', 'accepted'].includes(row.status))
    .sort((left, right) => (left.at?.valueOf() || 0) - (right.at?.valueOf() || 0))

  const application = applications[0]
  const profileOf = (field: string) => text(application?.[field] || application?.businessProfile?.[field] || application?.profile?.[field] || application?.formValues?.[field])
  return {
    support,
    meetingsHeld: held.length,
    meetingHours: Math.round(held.reduce((sum, row) => sum + row.hours, 0)),
    nextMeeting: upcoming[0] || null,
    recentMeetings: held.sort((left, right) => (right.at?.valueOf() || 0) - (left.at?.valueOf() || 0)).slice(0, 3),
    ownership: application ? ownershipOf(application) : null,
    beeLevel: profileOf('beeLevel'),
    province: profileOf('province'),
  }
}
