/** Resolve older assignments that predate the explicit delivery actor field. */
export const assignmentDeliveryActor = (assignment: Record<string, unknown>): 'human' | 'agent' | null => {
    const text = (value: unknown) => String(value ?? '').trim()
    const actor = text(assignment.deliveryActorType).toLowerCase()
    if (actor === 'human' || actor === 'agent') return actor
    const strategy = text(assignment.deliveryStrategy).toLowerCase()
    if (strategy === 'human_only') return 'human'
    if (text(assignment.agentId) || strategy === 'agent_only') return 'agent'
    if (text(assignment.assigneeId) || text(assignment.assigneeEmail)) return 'human'
    return null
}
