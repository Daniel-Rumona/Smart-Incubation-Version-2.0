import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import type { ClientFunderSummary } from '@/types/clientRevenue'
import type { TrainingQuestionType } from '@/types/training'

/**
 * The awareness-training AI endpoints (ai-backend/training_agent.py). Errors carry the backend's short code
 * (`no_readable_text`, `draft_empty`, ...) or `assistant_unavailable` when no assistant is configured.
 */

export const trainingAiAvailable = isAgentApiConfigured

const post = async <T>(path: string, body: unknown): Promise<T> => {
    if (!isAgentApiConfigured) throw new Error('assistant_unavailable')
    const response = await fetch(`${agentApiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
        body: JSON.stringify(body),
    })
    const data = await response.json().catch(() => ({})) as { detail?: unknown }
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'request_failed')
    return data as T
}

export type DraftQuestionStyle = 'mixed' | 'choice' | 'written'

/** A drafted question with its memo answer (for multiple choice, the correct option's text). */
export type DraftedQuestion = { type: TrainingQuestionType, text: string, marks: number, options: string[], memo: string }

/** Staff only: knowledge questions with memo answers written from library documents, never saved until the facilitator saves. */
export const draftAssessmentQuestions = (input: { libraryItemIds: string[], count: number, style: DraftQuestionStyle, focus?: string, existingQuestions?: string[] }) =>
    post<{ questions: DraftedQuestion[], sources: string[] }>('/api/training/draft-assessment', input)

/** A short narrative of the funder report's totals. `unmatchedFigures`: numbers in the text that are not in the report. */
export const writeFunderSummary = (summary: ClientFunderSummary, showEsg: boolean) =>
    post<{ text: string, unmatchedFigures: string[] }>('/api/training/funder-summary', { summary, showEsg })
