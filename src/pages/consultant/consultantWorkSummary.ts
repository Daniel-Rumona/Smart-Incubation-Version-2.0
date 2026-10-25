import dayjs from 'dayjs'
import type { AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { LONG_OVERDUE_DAYS } from '@/components/interventions/ChangeRequestModal'
import { assigneeWaitingOn } from '@/services/interventionHoldUp'
import { deriveConsultantStatus, isOverdueAssignment, toDate } from '@/pages/consultant/ConsultantWorkspaceUtils'

/**
 * A consultant's open work, sorted by whose move it is. The dashboard greeting and the Agentic overview both
 * read this, so the same work is counted the same way wherever the consultant lands.
 */
export const summariseConsultantWork = (assignments: AssignedIntervention[]) => {
    const today = dayjs().startOf('day')
    const statuses = assignments.map((assignment) => ({ assignment, status: deriveConsultantStatus(assignment) }))
    const open = statuses.filter(({ status }) => status !== 'Completed' && status !== 'Rejected').map(({ assignment }) => assignment)
    const completed = statuses.filter(({ status }) => status === 'Completed').map(({ assignment }) => assignment)
    const daysLate = (assignment: AssignedIntervention) => {
        const due = toDate(assignment.dueDate)
        return due ? Math.max(1, today.diff(dayjs(due).startOf('day'), 'day')) : 0
    }
    const late = open.filter(isOverdueAssignment)
    const dueThisWeek = open.filter((assignment) => {
        const due = toDate(assignment.dueDate)
        const days = due ? dayjs(due).startOf('day').diff(today, 'day') : -1
        return !isOverdueAssignment(assignment) && days >= 0 && days <= 7
    })
    const waiting = (assignment: AssignedIntervention) => assigneeWaitingOn(assignment)
    const accepting = (assignment: AssignedIntervention) => waiting(assignment).holdUp === 'Assignee acceptance'
    const yourMove = (assignment: AssignedIntervention) => waiting(assignment).yourMove

    return {
        open,
        completed,
        overdue: late,
        daysLate,
        toAccept: open.filter(accepting),
        yourDue: dueThisWeek.filter((assignment) => yourMove(assignment) && !accepting(assignment)),
        yourLate: late.filter((assignment) => yourMove(assignment) && !accepting(assignment)),
        /** Overdue work on the consultant's side that has been late so long it's likely stale. */
        longOverdue: late.filter((assignment) => yourMove(assignment) && daysLate(assignment) >= LONG_OVERDUE_DAYS),
        waitingOnOthers: [...late, ...dueThisWeek].filter((assignment) => !yourMove(assignment)),
        smes: new Set(open.map((assignment) => String(assignment.participantId || '')).filter(Boolean)).size,
    }
}
