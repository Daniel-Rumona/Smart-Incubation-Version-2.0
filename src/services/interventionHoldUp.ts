import type { AssignedIntervention } from '@/contexts/AssignedInterventionsContext'

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

/** What a hold-up means in plain words, for people who aren't on the Monitoring page. English keys for t(). */
export const WAITING_ON: Record<string, string> = {
    'Change requested': 'Operations to decide on a change',
    'Human review': 'Awaiting review',
    'Agent work in progress': 'SME preparing the deliverable',
    'Assignee acceptance': 'Facilitator to accept',
    'Assignee declined': 'Facilitator declined',
    'SME acceptance': 'SME to sign plan',
    'SME declined': 'SME declined',
    'SME completion confirmation': 'SME to confirm completion',
    'Awaiting next action': 'Awaiting next action',
    'In delivery': 'Still in delivery',
    'Not started': 'Not started',
}

/** The same hold-ups as the assigned facilitator reads them: their own moves are addressed to them. */
export const WAITING_ON_ASSIGNEE: Record<string, string> = {
    ...WAITING_ON,
    'Assignee acceptance': 'Waiting for you to accept',
    'Change requested': 'Waiting for operations to answer your request',
    'Assignee declined': 'You declined this',
    'Awaiting next action': 'Waiting for your next step',
    'In delivery': 'Still with you',
    'Not started': 'Not started yet',
}

/** Hold-ups where the next move is the assigned facilitator's; the rest wait on the SME or a reviewer. */
const ASSIGNEE_MOVES = new Set(['Assignee acceptance', 'Awaiting next action', 'In delivery', 'Not started'])

const holdUpOf = (assignment: AssignedIntervention) => {
    const progress = Math.max(0, Math.min(100, Number((assignment as { progress?: unknown }).progress) || 0))
    return deriveHoldUp(assignment, progress, false).holdUp
}

/** The plain-words hold-up for an open intervention, from its status and progress. */
export const waitingOnFor = (assignment: AssignedIntervention) => {
    const holdUp = holdUpOf(assignment)
    return WAITING_ON[holdUp] || holdUp
}

/** The hold-up in the assigned facilitator's own words, and whether the next move is theirs. */
export const assigneeWaitingOn = (assignment: AssignedIntervention) => {
    const holdUp = holdUpOf(assignment)
    return { holdUp, label: WAITING_ON_ASSIGNEE[holdUp] || holdUp, yourMove: ASSIGNEE_MOVES.has(holdUp) }
}

/**
 * What an intervention is waiting on, worked out from its status fields: whose move it is (the
 * facilitator, the SME, a reviewer) and a one-line reason. Shared by Interventions Monitoring and the
 * consultant report, so "why is this late?" reads the same everywhere.
 */
export const deriveHoldUp = (assignment: AssignedIntervention, progress: number, isCompleted: boolean) => {
    if (isCompleted) return { holdUp: 'Completed', reason: 'Completion has been recorded.' }

    // A consultant's request to extend or close long-overdue work waits on operations before anything else.
    const request = (assignment as { changeRequest?: { status?: string, type?: string, requestedDueDate?: string | null, reason?: string } }).changeRequest
    if (request?.status === 'pending') {
        const asked = request.type === 'close'
            ? 'The facilitator asked to close it'
            : `The facilitator asked to move the due date to ${request.requestedDueDate ? new Date(request.requestedDueDate).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) : 'a later date'}`
        return { holdUp: 'Change requested', reason: request.reason ? `${asked}: ${request.reason}` : `${asked}.` }
    }

    const status = normalize(assignment.status)
    const assigneeStatus = normalize(assignment.assigneeStatus)
    const participantStatus = normalize(assignment.participantStatus)
    const assigneeCompletion = normalize(assignment.assigneeCompletionStatus)
    const participantCompletion = normalize(assignment.participantCompletionStatus)
    const declineReason = String((assignment as Record<string, unknown>).declineReason || '').trim()
    const assignmentRecord = assignment as Record<string, unknown>
    const agentWorkStatus = normalize(assignmentRecord.agentWorkStatus)
    const reviewStatus = normalize(assignmentRecord.reviewStatus)

    if (assignment.deliveryActorType === 'agent' && agentWorkStatus === 'awaiting_review' && reviewStatus !== 'approved') {
        return { holdUp: 'Human review', reason: `Agent work is ready for ${String(assignmentRecord.reviewerType || 'operations')} review.` }
    }
    if (assignment.deliveryActorType === 'agent' && agentWorkStatus === 'draft_ready') {
        return { holdUp: 'Agent work in progress', reason: 'The SME has a generated draft and is preparing the final deliverable.' }
    }

    if (assigneeStatus === 'pending' || assigneeStatus === '') {
        return { holdUp: 'Assignee acceptance', reason: 'The assigned facilitator has not accepted the intervention yet.' }
    }

    if (assigneeStatus === 'declined') {
        return { holdUp: 'Assignee declined', reason: declineReason || 'The assigned facilitator declined the intervention.' }
    }

    if (participantStatus === 'pending' || participantStatus === '') {
        return { holdUp: 'SME acceptance', reason: 'The SME has not signed their diagnostic plan yet. Signing it accepts every intervention on it.' }
    }

    if (participantStatus === 'declined') {
        return { holdUp: 'SME declined', reason: declineReason || 'The SME declined the intervention.' }
    }

    if (progress >= 100 && participantCompletion !== 'confirmed') {
        return { holdUp: 'SME completion confirmation', reason: 'Delivery is marked complete and needs SME confirmation.' }
    }

    if (assigneeCompletion === 'done' && participantCompletion !== 'confirmed') {
        return { holdUp: 'SME completion confirmation', reason: 'The assignee submitted completion and the SME has not confirmed it.' }
    }

    if (status.includes('awaiting')) {
        return { holdUp: 'Awaiting next action', reason: `Current status is ${String(assignment.status || 'awaiting action')}.` }
    }

    if (progress > 0) {
        return { holdUp: 'In delivery', reason: 'The intervention is in progress.' }
    }

    return { holdUp: 'Not started', reason: 'The intervention has been assigned but progress has not started.' }
}
