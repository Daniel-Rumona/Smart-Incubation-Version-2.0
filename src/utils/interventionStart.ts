/**
 * When an intervention counts as started, and the SME's change requests on it.
 *
 * Confirming the diagnostic plan accepts every intervention on it, so there is no separate SME
 * "accept" step. An intervention moves from Not started to In progress at the first sign of work:
 * the SME accepting an appointment for it (stamped as `workStartedAt` by the ai-backend RSVP flow),
 * attendance marked present, a facilitator recording progress, or an agent starting the work.
 */

type Row = Record<string, unknown>

const progressOf = (row: Row) => typeof row.progress === 'number'
    ? row.progress
    : Number((row.progress as { percentage?: unknown } | undefined)?.percentage || 0)

export const hasWorkStarted = (row: Row) => Boolean(row.workStartedAt)
    || progressOf(row) > 0
    || Number(row.timeSpent || 0) > 0
    || (Array.isArray(row.progressSteps) && row.progressSteps.length > 0)
    // Agent assignments are created as 'ready'; any later agent status means the SME has started it.
    || Boolean(row.agentRunId)
    || !['', 'ready'].includes(String(row.agentWorkStatus || '').toLowerCase())

export type InterventionChangeKind = 'change' | 'drop'

export type InterventionChangeRequest = {
    status: 'requested' | 'confirmed' | 'dismissed'
    /** 'drop' = no longer needed; 'change' = needed, but differently. Older requests have no kind and were drops. */
    kind?: InterventionChangeKind
    reasonCode?: string
    reasonText?: string
}

/** The SME's open request to change or drop this intervention, if there is one. Stored as `declineRequest`. */
export const openChangeRequest = (row: Row): InterventionChangeRequest | null => {
    const request = row.declineRequest as InterventionChangeRequest | undefined
    return request && String(request.status || '').toLowerCase() === 'requested' ? request : null
}
