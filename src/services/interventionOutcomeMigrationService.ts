import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import type { InterventionOutcomeDefinition, InterventionOutcomeType } from '@/types/interventions'

/** Mirrors MAX_INTERVENTIONS in ai-backend/intervention_outcome_agent.py. */
const BATCH_SIZE = 15

export type OutcomeMigrationSource = {
    id: string
    interventionTitle?: string
    areaOfSupport?: string
    description?: unknown
    executionMode?: string
    durationTerm?: string
    isRecurring?: string
    deliveryStrategy?: string
    steps?: Array<{ title?: string; description?: string }>
    outcomeDefinition?: InterventionOutcomeDefinition
}

export type OutcomeMigrationSuggestion = {
    id: string
    definition: InterventionOutcomeDefinition
    rationale: string
}

type ApiSuggestion = {
    id: string
    intendedOutcome?: string
    outcomeType?: InterventionOutcomeType | null
    deliverableName?: string
    deliverableDescription?: string
    deliverableRequired?: boolean
    followUpDays?: number
    rationale?: string
}

type ApiResponse = { suggestions?: ApiSuggestion[]; warnings?: string[]; detail?: string; error?: string }

/** An intervention has a check-back once it says when the facilitator should follow up. */
export const hasOutcomeCheckBack = (definition?: InterventionOutcomeDefinition | null) =>
    Number(definition?.followUpDays) > 0

const toRequestItem = (item: OutcomeMigrationSource) => ({
    id: item.id,
    title: item.interventionTitle || '',
    areaOfSupport: item.areaOfSupport || '',
    description: typeof item.description === 'string' ? item.description.slice(0, 2000) : undefined,
    executionMode: item.executionMode,
    durationTerm: item.durationTerm,
    isRecurring: item.isRecurring,
    deliveryStrategy: item.deliveryStrategy,
    steps: (item.steps || []).map((step) => ({ title: step.title || '', description: step.description || '' })),
    outcomeDefinition: item.outcomeDefinition || null,
})

/**
 * Asks the AI backend to draft the outcome check-back for each intervention. Fields the
 * intervention already has are kept; the draft only fills the gaps. Nothing is saved here.
 */
export const suggestOutcomeCheckBacks = async (
    interventions: OutcomeMigrationSource[],
    onProgress?: (done: number) => void,
): Promise<{ suggestions: OutcomeMigrationSuggestion[]; warnings: string[] }> => {
    if (!isAgentApiConfigured) throw new Error('The AI service is not configured for this environment.')

    const suggestions: OutcomeMigrationSuggestion[] = []
    const warnings: string[] = []
    const byId = new Map(interventions.map((item) => [item.id, item]))

    for (let start = 0; start < interventions.length; start += BATCH_SIZE) {
        const batch = interventions.slice(start, start + BATCH_SIZE)
        const response = await fetch(`${agentApiBaseUrl}/api/interventions/outcome-migration`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
            body: JSON.stringify({ interventions: batch.map(toRequestItem) }),
        })
        const data = await response.json().catch(() => ({})) as ApiResponse
        if (!response.ok) throw new Error(data.detail || data.error || 'Outcome suggestions could not be generated.')

        for (const item of data.suggestions || []) {
            const existing = byId.get(item.id)?.outcomeDefinition || {}
            suggestions.push({
                id: item.id,
                rationale: item.rationale || '',
                definition: {
                    intendedOutcome: existing.intendedOutcome || item.intendedOutcome || undefined,
                    outcomeType: existing.outcomeType || item.outcomeType || undefined,
                    deliverableName: existing.deliverableName || item.deliverableName || undefined,
                    deliverableDescription: existing.deliverableDescription || item.deliverableDescription || undefined,
                    deliverableRequired: existing.deliverableRequired ?? Boolean(item.deliverableRequired),
                    followUpDays: existing.followUpDays || item.followUpDays || undefined,
                },
            })
        }
        warnings.push(...(data.warnings || []))
        onProgress?.(Math.min(interventions.length, start + batch.length))
    }

    return { suggestions, warnings }
}
