import dayjs, { type Dayjs } from 'dayjs'
import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { isOverdue } from '@/services/directorProgramsService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'

/**
 * The director's overdue list and "Ask for an update" nudge.
 *
 *  - Overdue interventions use the same rule as Programme performance (past due, not completed, SME not
 *    discontinued), grouped by programme.
 *  - Asking for an update writes one `directorUpdateRequests` record (so the dashboard can show when it was last
 *    asked) and one `staffNotifications` entry per operations / project admin user who works on that programme
 *    (no assigned programmes means all of them). Those entries show in their bell, like the deadline digests.
 * Stored text stays English (notifications are read as written); the dashboard translates its own labels.
 */

type AnyDoc = Record<string, unknown>

export type OverdueItem = { id: string, title: string, sme: string, assignee: string, daysLate: number }

export type OverdueProgramme = {
  programId: string
  programName: string
  items: OverdueItem[]
  oldestDaysLate: number
  lastRequest: { at: Dayjs, byName: string } | null
}

const RECIPIENT_ROLES = ['operations', 'projectadmin']
const NOTIFICATION_TYPE = 'director_update_request'
const MONITORING_LINK = '/operations/interventions/monitoring?health=overdue'

const text = (value: unknown) => String(value ?? '').trim()

const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string | number | Date)
  return parsed.isValid() ? parsed : null
}

const programKey = (value: unknown) => text(value) || 'unassigned'

export const loadOverdueByProgramme = async (
  user: FullIdentity,
  activeProgramId: string,
  programmeNames: Map<string, string>,
): Promise<OverdueProgramme[]> => {
  const companyCode = text(user.companyCode)
  if (!companyCode) return []
  const db = getFirebaseDb()
  const [assignmentsSnap, requestDocs] = await Promise.all([
    getDocs(query(collection(db, 'assignedInterventions'), where('companyCode', '==', companyCode))),
    // "Last asked" is a nicety: if it can't be read, still show the overdue list.
    getDocs(query(collection(db, 'directorUpdateRequests'), where('companyCode', '==', companyCode)))
      .then((snapshot) => snapshot.docs)
      .catch((error) => {
        console.warn('[DIRECTOR] Could not read past update requests:', error)
        return []
      }),
  ])

  const lastByProgramme = new Map<string, { at: Dayjs, byName: string }>()
  requestDocs.forEach((record) => {
    const data = record.data() as AnyDoc
    const at = toDay(data.createdAt)
    if (!at) return
    const key = programKey(data.programId)
    const current = lastByProgramme.get(key)
    if (!current || at.isAfter(current.at)) lastByProgramme.set(key, { at, byName: text(data.requestedByName) })
  })

  const today = dayjs().startOf('day')
  const groups = new Map<string, OverdueProgramme>()
  assignmentsSnap.docs.forEach((record) => {
    const data = record.data() as AnyDoc
    if (isDiscontinuedRecord(data) || !isOverdue(data)) return
    if (!matchesActiveProgram(user, activeProgramId || 'all', text(data.programId))) return
    const key = programKey(data.programId)
    const group = groups.get(key) || {
      programId: key,
      programName: programmeNames.get(key) || text(data.programName) || key,
      items: [],
      oldestDaysLate: 0,
      lastRequest: lastByProgramme.get(key) || null,
    }
    const due = toDay(data.dueDate)
    const daysLate = due ? today.diff(due.startOf('day'), 'day') : 0
    group.items.push({
      id: record.id,
      title: text(data.interventionTitle) || 'Intervention',
      sme: text(data.businessName || data.beneficiaryName || data.participantName || data.smeName) || 'SME',
      assignee: text(data.assigneeName || data.consultantName),
      daysLate,
    })
    group.oldestDaysLate = Math.max(group.oldestDaysLate, daysLate)
    groups.set(key, group)
  })

  groups.forEach((group) => group.items.sort((a, b) => b.daysLate - a.daysLate))
  return Array.from(groups.values()).sort((a, b) => b.items.length - a.items.length)
}

/** Operations and project admin users in the company who work on this programme. */
const listProgrammeOwners = async (companyCode: string, programId: string) => {
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', companyCode)))
  return snapshot.docs.filter((record) => {
    const data = record.data() as AnyDoc
    if (!RECIPIENT_ROLES.includes(text(data.role))) return false
    const assigned = Array.isArray(data.assignedProgramIds) ? data.assignedProgramIds.map(text).filter(Boolean) : []
    return programId === 'unassigned' || !assigned.length || assigned.includes(programId)
  }).map((record) => record.id)
}

export const requestProgrammeUpdate = async (
  user: FullIdentity,
  programme: OverdueProgramme,
  note: string,
): Promise<{ recipients: number }> => {
  const companyCode = text(user.companyCode)
  const db = getFirebaseDb()
  const recipients = await listProgrammeOwners(companyCode, programme.programId)
  if (!recipients.length) return { recipients: 0 }

  const byName = text(user.displayName) || 'The director'
  const count = programme.items.length
  const trimmedNote = note.trim()

  await addDoc(collection(db, 'directorUpdateRequests'), {
    companyCode,
    programId: programme.programId,
    programName: programme.programName,
    overdueCount: count,
    note: trimmedNote || null,
    recipientUids: recipients,
    requestedByUid: user.uid,
    requestedByName: byName,
    createdAt: serverTimestamp(),
  })

  const body = [
    `${byName} asked for an update on ${count} overdue intervention${count === 1 ? '' : 's'} in ${programme.programName}.`,
    trimmedNote ? `Note: ${trimmedNote}` : '',
    ...programme.items.slice(0, 3).map((item) => `${item.title} (${item.sme}): ${item.daysLate} day${item.daysLate === 1 ? '' : 's'} late`),
  ].filter(Boolean).join('\n')

  // One write per recipient: each is checked on its own against the rules (recipient in the same company and role).
  await Promise.all(recipients.map((recipientUid) => addDoc(collection(db, 'staffNotifications'), {
    recipientUid,
    companyCode,
    type: NOTIFICATION_TYPE,
    title: `Update requested: ${count} overdue in ${programme.programName}`,
    body,
    counts: { overdue: count },
    link: MONITORING_LINK,
    requestedByUid: user.uid,
    readAt: null,
    createdAt: serverTimestamp(),
  })))

  return { recipients: recipients.length }
}
