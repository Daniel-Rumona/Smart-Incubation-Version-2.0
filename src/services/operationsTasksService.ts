import { collection, doc, onSnapshot, query, serverTimestamp, updateDoc, where, writeBatch, type Unsubscribe } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type OperationsTaskStatus = 'todo' | 'in_progress' | 'done' | 'cancelled'
export type OperationsTaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type OperationsTaskRecurrenceFrequency = 'daily' | 'weekly' | 'monthly'

export type OperationsTaskRecurrence = {
  frequency: OperationsTaskRecurrenceFrequency
  endsAt: Date
  occurrence: number
}

export type OperationsTask = {
  id: string
  companyCode: string
  programId?: string | null
  title: string
  description?: string
  status: OperationsTaskStatus
  priority: OperationsTaskPriority
  startAt?: unknown
  dueAt?: unknown
  interventionId?: string | null
  assigneeIds: string[]
  archived?: boolean
  createdAt?: unknown
  updatedAt?: unknown
  completedAt?: unknown
  recurrence?: OperationsTaskRecurrence
  recurrenceId?: string
  createdBy: string
}

export type OperationsTaskInput = Omit<OperationsTask, 'id' | 'companyCode' | 'createdBy' | 'createdAt' | 'updatedAt' | 'completedAt' | 'archived' | 'recurrenceId' | 'recurrence'> & {
  recurrence?: Omit<OperationsTaskRecurrence, 'occurrence'>
}

const assertTaskAccess = (user: FullIdentity) => {
  if (!user.companyCode) throw new Error('missing-company')
  if (!['systemadmin', 'projectadmin', 'projectmanager', 'operations'].includes(user.role)) throw new Error('forbidden')
}

export const subscribeOperationsTasks = (user: FullIdentity, onChange: (tasks: OperationsTask[]) => void, onError: (error: Error) => void): Unsubscribe => {
  assertTaskAccess(user)
  return onSnapshot(query(collection(getFirebaseDb(), 'operationsTasks'), where('companyCode', '==', user.companyCode)), (snapshot) => {
    onChange(snapshot.docs.map((row) => ({ id: row.id, ...(row.data() as Omit<OperationsTask, 'id'>) })))
  }, (error) => onError(error))
}

const advanceDate = (date: Date, frequency: OperationsTaskRecurrenceFrequency) => {
  const next = new Date(date)
  if (frequency === 'daily') next.setDate(next.getDate() + 1)
  if (frequency === 'weekly') next.setDate(next.getDate() + 7)
  if (frequency === 'monthly') next.setMonth(next.getMonth() + 1)
  return next
}

export const createOperationsTask = async (user: FullIdentity, input: OperationsTaskInput) => {
  assertTaskAccess(user)
  const title = String(input.title || '').trim()
  if (!title) throw new Error('A task title is required.')
  const db = getFirebaseDb()
  const tasks = collection(db, 'operationsTasks')
  const recurrence = input.recurrence
  const dueAt = input.dueAt instanceof Date ? input.dueAt : undefined
  const startAt = input.startAt instanceof Date ? input.startAt : undefined
  const occurrences: Array<{ startAt?: Date, dueAt?: Date }> = [{ startAt, dueAt }]

  if (recurrence) {
    if (!dueAt) throw new Error('A due date is required for a recurring task.')
    let nextDueAt = dueAt
    let nextStartAt = startAt
    while (true) {
      nextDueAt = advanceDate(nextDueAt, recurrence.frequency)
      nextStartAt = nextStartAt ? advanceDate(nextStartAt, recurrence.frequency) : undefined
      if (nextDueAt.getTime() > recurrence.endsAt.getTime()) break
      occurrences.push({ startAt: nextStartAt, dueAt: nextDueAt })
      if (occurrences.length > 120) throw new Error('A recurring series is limited to 120 occurrences. Choose an earlier end date.')
    }
  }

  const recurrenceId = recurrence ? doc(tasks).id : undefined
  const batch = writeBatch(db)
  occurrences.forEach((dates, index) => {
    const taskRef = doc(tasks)
    batch.set(taskRef, {
      companyCode: user.companyCode,
      programId: input.programId || null,
      title,
      description: input.description || '',
      status: input.status,
      priority: input.priority,
      interventionId: input.interventionId || null,
      assigneeIds: input.assigneeIds || [],
      archived: false,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...(dates.startAt ? { startAt: dates.startAt } : {}),
      ...(dates.dueAt ? { dueAt: dates.dueAt } : {}),
      ...(input.status === 'done' ? { completedAt: serverTimestamp() } : {}),
      ...(recurrence ? { recurrenceId, recurrence: { frequency: recurrence.frequency, endsAt: recurrence.endsAt, occurrence: index + 1 } } : {}),
    })
  })
  await batch.commit()
  return occurrences.length
}

export const updateOperationsTask = async (user: FullIdentity, taskId: string, input: Partial<OperationsTaskInput> & { archived?: boolean }) => {
  assertTaskAccess(user)
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() }
  ;(['title', 'description', 'status', 'priority', 'startAt', 'dueAt', 'programId', 'interventionId', 'assigneeIds', 'recurrence', 'archived'] as const).forEach((key) => {
    if (input[key] !== undefined) payload[key] = input[key]
  })
  if (input.status === 'done') payload.completedAt = serverTimestamp()
  if (input.status && input.status !== 'done') payload.completedAt = null
  await updateDoc(doc(getFirebaseDb(), 'operationsTasks', taskId), payload)
}
