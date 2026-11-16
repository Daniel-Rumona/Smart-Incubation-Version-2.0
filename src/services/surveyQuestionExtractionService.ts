import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import { generateFieldId, sanitizeFieldName, type SurveyField, type SurveyFieldType } from '@/services/surveyTemplatesService'

export type ExtractedSurveyMeta = {
    title: string
    description: string
    category: string
}

export type SurveyExtractionResult = {
    meta: ExtractedSurveyMeta
    fields: SurveyField[]
    warnings: string[]
}

type ApiField = {
    type?: string
    label?: string
    placeholder?: string | null
    description?: string | null
    required?: boolean
    options?: string[] | null
}

type ApiResponse = {
    ok?: boolean
    title?: string
    description?: string
    category?: string
    fields?: ApiField[]
    warnings?: string[]
    detail?: string
    error?: string
}

const ACCEPTED_EXTENSIONS = ['.docx', '.pdf', '.html', '.htm', '.txt', '.md', '.csv']

/** Mirrors MAX_DOCUMENT_BYTES in ai-backend/survey_import_agent.py. */
export const MAX_SURVEY_DOCUMENT_BYTES = 8 * 1024 * 1024
export const SURVEY_DOCUMENT_ACCEPT = ACCEPTED_EXTENSIONS.join(',')

export const isSupportedQuestionnaireFile = (file: File) =>
    ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))

/** FileReader gives back a data URL; the API wants only the base64 payload. */
const toBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(new Error('The file could not be read.'))
    reader.readAsDataURL(file)
})

/** Ids are minted here so an imported question can never collide with one already on the canvas. */
const toSurveyField = (field: ApiField): SurveyField => ({
    id: generateFieldId(),
    type: (field.type || 'text') as SurveyFieldType,
    label: field.label || 'Untitled question',
    name: sanitizeFieldName(field.label || ''),
    placeholder: field.placeholder || undefined,
    description: field.description || undefined,
    required: Boolean(field.required),
    options: field.options?.length ? field.options : undefined,
})

export const extractSurveyQuestions = async (input: { file?: File, text?: string, category?: string }): Promise<SurveyExtractionResult> => {
    if (!isAgentApiConfigured) {
        throw new Error('The AI service is not configured for this environment.')
    }

    if (input.file && !isSupportedQuestionnaireFile(input.file)) {
        throw new Error('Upload a Word, PDF, HTML, text, Markdown or CSV file.')
    }

    const body = input.file
        ? { fileName: input.file.name, fileBase64: await toBase64(input.file), category: input.category }
        : { text: (input.text || '').trim(), category: input.category }

    if (!input.file && !body.text) {
        throw new Error('Paste the questionnaire text or choose a file.')
    }

    const response = await fetch(`${agentApiBaseUrl}/api/surveys/import-questions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
        body: JSON.stringify(body),
    })

    const data = await response.json().catch(() => ({})) as ApiResponse

    if (!response.ok) {
        throw new Error(data.detail || data.error || 'The questionnaire could not be read.')
    }

    return {
        meta: {
            title: data.title || '',
            description: data.description || '',
            category: data.category || '',
        },
        fields: (data.fields || []).map(toSurveyField),
        warnings: data.warnings || [],
    }
}
