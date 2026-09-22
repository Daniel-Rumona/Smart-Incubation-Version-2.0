import dayjs from 'dayjs'
import type { AssignedIntervention } from '@/contexts/AssignedInterventionsContext'

export type ConsultantStatus = 'Pending' | 'In progress' | 'Completed' | 'Rejected'

export const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

export const toDate = (value: unknown): Date | null => {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(+value) ? null : value
  if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return value.toDate()
  if (typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number') return new Date(value.seconds * 1000)
  if (typeof value === 'number') return new Date(value > 1e12 ? value : value * 1000)
  const parsed = new Date(String(value))
  return Number.isNaN(+parsed) ? null : parsed
}

export const deriveConsultantStatus = (assignment: AssignedIntervention): ConsultantStatus => {
  const status = normalize(assignment.status)
  const assigneeStatus = normalize(assignment.assigneeStatus)
  const participantStatus = normalize(assignment.participantStatus)
  const assigneeCompletion = normalize(assignment.assigneeCompletionStatus)
  const participantCompletion = normalize(assignment.participantCompletionStatus)

  if (status === 'cancelled' || status === 'declined' || assigneeStatus === 'declined' || participantStatus === 'declined' || participantCompletion === 'rejected') return 'Rejected'
  if (status === 'completed' || participantCompletion === 'confirmed') return 'Completed'
  if (assigneeCompletion === 'done' || assigneeCompletion === 'completed' || status.includes('awaiting') || assigneeStatus === 'accepted') return 'In progress'
  return 'Pending'
}

export const statusColor = (status: ConsultantStatus) => {
  if (status === 'Completed') return 'green'
  if (status === 'Rejected') return 'red'
  if (status === 'In progress') return 'blue'
  return 'gold'
}

export const progressForAssignment = (assignment: AssignedIntervention, status = deriveConsultantStatus(assignment)) => {
  const explicit = Number(assignment.progress)
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(100, Math.round(explicit)))
  if (status === 'Completed') return 100
  if (status === 'In progress') return 50
  return 0
}

export const isOverdueAssignment = (assignment: AssignedIntervention) => {
  const due = toDate(assignment.dueDate)
  if (!due) return false
  return dayjs(due).isBefore(dayjs(), 'day') && deriveConsultantStatus(assignment) !== 'Completed'
}

export const assignmentTitle = (assignment: AssignedIntervention) =>
  String(assignment.interventionTitle || 'Intervention')

export const assignmentParticipant = (assignment: AssignedIntervention) =>
  String(assignment.businessName || 'Unassigned SME')

export const assignmentProgram = (assignment: AssignedIntervention) =>
  String(assignment.programName || '')

export const getFeedback = (assignment: AssignedIntervention) => {
  const feedback = (assignment as Record<string, any>).feedback
  return {
    rating: typeof feedback?.rating === 'number' ? feedback.rating : undefined,
    comments: String(feedback?.comments || feedback?.comment || '').trim(),
    createdAt: toDate(feedback?.createdAt) || toDate(assignment.completedAt) || toDate(assignment.updatedAt) || toDate(assignment.createdAt),
  }
}

export const downloadCsv = (filename: string, rows: Record<string, unknown>[]) => {
  if (!rows.length) return false
  const headers = Object.keys(rows[0])
  const escapeCell = (value: unknown) => {
    const text = String(value ?? '')
    return /[,"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const csv = [headers.join(','), ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
  return true
}
