import { arrayUnion, collection, doc, getDocs, query, serverTimestamp, Timestamp, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import { buildFollowUpFields } from '@/services/interventionOutcomeConfig'
import { assignmentStartsAccepted, getCompanyWorkSettings } from '@/services/companyWorkSettingsService'
import type { FullIdentity } from '@/types/identity'

/*
 * Operations' overrides on an assigned intervention: take it over, hand it to another consultant (keeping
 * or restarting the work), or close it out with a reason and proof of evidence (POE). Every change is
 * appended to `overrideHistory` on the assignment so there is an audit trail.
 */

export type ReassignMode = 'continue' | 'restart'

export type ReassignCandidate = { id: string, name: string, email: string, role: string }

export type EvidenceFile = { name: string, url: string, storagePath: string, contentType: string, size: number }

type AssignmentLike = { id: string, companyCode?: string | null, assigneeId?: string, assigneeName?: string, outcomeDefinition?: unknown }

const OPEN_APPOINTMENT_STATUSES = ['pending', 'accepted']

const actorOf = (user: FullIdentity) => ({ uid: user.uid, name: user.displayName || user.name || user.email, email: user.email, role: user.role })

const assigneeTypeFor = (role: string) => (role === 'projectadmin' ? 'projectadmin' : role === 'consultant' ? 'consultant' : 'operations')

/** Appointments still ahead for this assignment (pending or accepted, not yet held or cancelled). */
const openAppointmentsFor = async (assignmentId: string) => {
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'appointments'), where('assignedInterventionId', '==', assignmentId)))
  return snapshot.docs.filter((row) => OPEN_APPOINTMENT_STATUSES.includes(String(row.data().status || '').toLowerCase()))
}

export const listReassignCandidates = async (user: FullIdentity, excludeAssigneeId?: string): Promise<ReassignCandidate[]> => {
  if (!user.companyCode) return []
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', user.companyCode)))
  return snapshot.docs
    .map((row) => ({ id: row.id, ...row.data() } as Record<string, unknown> & { id: string }))
    .filter((row) => String(row.role || '').toLowerCase() === 'consultant' && row.active !== false && String(row.status || 'active').toLowerCase() !== 'inactive')
    .filter((row) => row.id !== excludeAssigneeId)
    .map((row) => ({ id: row.id, name: String(row.displayName || row.name || row.email || ''), email: String(row.email || ''), role: 'consultant' }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

const historyEntry = (user: FullIdentity, entry: Record<string, unknown>) => ({ at: new Date().toISOString(), by: actorOf(user), ...entry })

/** Operations assigns the work to themselves, taking it (and its upcoming appointments) over as-is. */
export const takeOverIntervention = async (user: FullIdentity, assignment: AssignmentLike, note = '') => {
  const db = getFirebaseDb()
  const batch = writeBatch(db)
  const actor = actorOf(user)

  batch.update(doc(db, 'assignedInterventions', assignment.id), {
    assigneeId: user.uid,
    assigneeUid: user.uid,
    assigneeName: actor.name,
    assigneeEmail: user.email,
    assigneeType: assigneeTypeFor(user.role),
    assigneeStatus: 'accepted',
    deliveryActorType: 'human',
    overrideHistory: arrayUnion(historyEntry(user, {
      action: 'takeover',
      from: { id: assignment.assigneeId || null, name: assignment.assigneeName || null },
      to: { id: user.uid, name: actor.name },
      note: note.trim(),
    })),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  for (const appointment of await openAppointmentsFor(assignment.id)) {
    batch.update(appointment.ref, { assigneeId: user.uid, assigneeEmail: user.email, updatedAt: serverTimestamp() })
  }
  await batch.commit()
}

/**
 * Hands the intervention to another consultant.
 *  - continue: progress, history and upcoming appointments stay; the appointments move to the new consultant.
 *  - restart: progress and completion reset to zero and the upcoming appointments are cancelled so the new
 *    consultant schedules afresh (appointments already held stay as history).
 * Either way the new consultant accepts it first if the company requires acceptance.
 */
export const reassignIntervention = async (user: FullIdentity, assignment: AssignmentLike, candidate: ReassignCandidate, mode: ReassignMode, note = '') => {
  const db = getFirebaseDb()
  const batch = writeBatch(db)
  const open = await openAppointmentsFor(assignment.id)
  // Candidates are this company's consultants, so the company's acceptance setting decides whether they accept first.
  const startsAccepted = assignmentStartsAccepted({ assignee: { id: candidate.id, role: candidate.role, companyCode: user.companyCode }, assignerUid: user.uid, settings: await getCompanyWorkSettings(String(user.companyCode || '')).catch(() => null) })

  batch.update(doc(db, 'assignedInterventions', assignment.id), {
    assigneeId: candidate.id,
    assigneeUid: candidate.id,
    assigneeName: candidate.name,
    assigneeEmail: candidate.email,
    assigneeType: 'consultant',
    assigneeStatus: startsAccepted ? 'accepted' : 'pending',
    deliveryActorType: 'human',
    ...(mode === 'restart'
      ? {
        status: 'pending',
        progress: 0,
        progressSteps: [],
        timeSpent: 0,
        targetActual: 0,
        assigneeCompletionStatus: 'pending',
        participantCompletionStatus: 'pending',
        restartedAt: serverTimestamp(),
      }
      : {}),
    overrideHistory: arrayUnion(historyEntry(user, {
      action: mode === 'restart' ? 'reassign_restart' : 'reassign_continue',
      from: { id: assignment.assigneeId || null, name: assignment.assigneeName || null },
      to: { id: candidate.id, name: candidate.name },
      note: note.trim(),
    })),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  for (const appointment of open) {
    if (mode === 'restart') {
      batch.update(appointment.ref, {
        status: 'cancelled',
        cancelledReason: 'Intervention restarted under a new consultant',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    } else {
      batch.update(appointment.ref, { assigneeId: candidate.id, assigneeEmail: candidate.email, updatedAt: serverTimestamp() })
    }
  }
  await batch.commit()
}

/** POE accepted on interventions: PDF, images or Office documents, up to 10 MB each. */
export const EVIDENCE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xls,.xlsx'
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024

/** Why a file cannot be used as POE, or undefined when it is fine. */
export const evidenceFileProblem = (file: { name: string, size?: number }) => {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
  if (!EVIDENCE_ACCEPT.split(',').includes(extension)) return `${file.name} is not a PDF, image or Office document.`
  if ((file.size || 0) > MAX_EVIDENCE_BYTES) return `${file.name} is larger than 10 MB.`
  return undefined
}

export const uploadEvidenceFiles = async (companyCode: string, assignmentId: string, files: File[]): Promise<EvidenceFile[]> =>
  Promise.all(files.map(async (file) => {
    const safeName = file.name.replace(/[^\w.-]/g, '_')
    const storagePath = `intervention-evidence/${companyCode || 'unknown'}/${assignmentId}/${Date.now()}_${safeName}`
    const storageRef = ref(getFirebaseStorage(), storagePath)
    await uploadBytes(storageRef, file, { contentType: file.type || 'application/octet-stream' })
    return { name: file.name, url: await getDownloadURL(storageRef), storagePath, contentType: file.type || 'application/octet-stream', size: file.size }
  }))

/** Operations closes the intervention out. A reason and at least one proof-of-evidence file are mandatory. */
export const completeInterventionWithEvidence = async (user: FullIdentity, assignment: AssignmentLike, input: { reason: string, files: File[] }) => {
  const reason = input.reason.trim()
  if (!reason) throw new Error('A reason is required to complete this intervention.')
  if (!input.files.length) throw new Error('Upload at least one file as proof of evidence.')

  const evidence = await uploadEvidenceFiles(String(assignment.companyCode || user.companyCode || ''), assignment.id, input.files)
  const db = getFirebaseDb()
  const batch = writeBatch(db)

  batch.update(doc(db, 'assignedInterventions', assignment.id), {
    status: 'completed',
    completionStatus: 'completed',
    assigneeCompletionStatus: 'done',
    participantCompletionStatus: 'confirmed',
    progress: 100,
    ...buildFollowUpFields(assignment as Record<string, unknown>),
    completedAt: serverTimestamp(),
    completedBy: user.uid,
    completedByOperations: true,
    completionOverride: { reason, evidence, by: actorOf(user), at: new Date().toISOString() },
    overrideHistory: arrayUnion(historyEntry(user, { action: 'complete', reason, evidenceCount: evidence.length })),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  for (const appointment of await openAppointmentsFor(assignment.id)) {
    batch.update(appointment.ref, {
      status: 'cancelled',
      cancelledReason: 'Intervention completed by operations',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }
  await batch.commit()
}

/*
 * Long-overdue work: the assigned consultant asks operations to extend the due date or close the intervention
 * (it's no longer needed). The request sits on the assignment until operations approve or decline it; nothing
 * changes until then. Both steps are kept in `overrideHistory`.
 */

export type ChangeRequestType = 'extend' | 'close'

export type ChangeRequest = {
  type: ChangeRequestType
  requestedDueDate?: string | null
  reason: string
  status: 'pending' | 'approved' | 'declined'
  requestedBy: { uid: string, name: string }
  requestedAt: string
  reviewedBy?: { uid: string, name: string }
  reviewedAt?: string
  reviewNote?: string
}

/** The open request on an assignment, if there is one. */
export const pendingChangeRequest = (assignment: { changeRequest?: unknown }) => {
  const request = assignment.changeRequest as ChangeRequest | undefined
  return request?.status === 'pending' ? request : null
}

export const requestInterventionChange = async (user: FullIdentity, assignment: AssignmentLike, input: { type: ChangeRequestType, dueDate?: Date | null, reason: string }) => {
  const actor = actorOf(user)
  const request: ChangeRequest = {
    type: input.type,
    requestedDueDate: input.type === 'extend' && input.dueDate ? input.dueDate.toISOString() : null,
    reason: input.reason.trim(),
    status: 'pending',
    requestedBy: { uid: user.uid, name: String(actor.name || '') },
    requestedAt: new Date().toISOString(),
  }
  await updateDoc(doc(getFirebaseDb(), 'assignedInterventions', assignment.id), {
    changeRequest: request,
    overrideHistory: arrayUnion(historyEntry(user, { action: input.type === 'extend' ? 'extension_requested' : 'closure_requested', requestedDueDate: request.requestedDueDate, note: request.reason })),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

/** Operations' answer. Approving an extension moves the due date; approving a closure cancels the intervention. */
export const resolveInterventionChange = async (user: FullIdentity, assignment: AssignmentLike & { changeRequest?: unknown }, approve: boolean, note = '') => {
  const request = pendingChangeRequest(assignment)
  if (!request) throw new Error('There is no open request on this intervention.')
  const actor = actorOf(user)
  const reviewed: ChangeRequest = { ...request, status: approve ? 'approved' : 'declined', reviewedBy: { uid: user.uid, name: String(actor.name || '') }, reviewedAt: new Date().toISOString(), reviewNote: note.trim() }
  const changes: Record<string, unknown> = {}
  if (approve && request.type === 'extend' && request.requestedDueDate) changes.dueDate = Timestamp.fromDate(new Date(request.requestedDueDate))
  if (approve && request.type === 'close') Object.assign(changes, { status: 'Cancelled', closedReason: request.reason, closedAt: serverTimestamp() })
  await updateDoc(doc(getFirebaseDb(), 'assignedInterventions', assignment.id), {
    ...changes,
    changeRequest: reviewed,
    overrideHistory: arrayUnion(historyEntry(user, {
      action: `${request.type === 'extend' ? 'extension' : 'closure'}_${approve ? 'approved' : 'declined'}`,
      requestedDueDate: request.requestedDueDate || null,
      note: note.trim(),
    })),
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}
