import { collection, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import {
    listDiagnosticInterventionOptions,
    listDiagnosticPlanParticipants,
    saveDiagnosticPlan,
} from '@/services/diagnosticPlansService'
import { listSurveyTemplates, isGapAnalysis, type SurveyField, type SurveyTemplate } from '@/services/surveyTemplatesService'
import type { SurveyAnswers, SurveyResponseRow } from '@/services/surveyResponsesService'
import type { DiagnosticInterventionOption, DiagnosticPlanParticipant } from '@/types/diagnosticPlan'
import type { FullIdentity } from '@/types/identity'

/*
 * Gap analysis = a survey in the "Gap Analysis" category (built and sent like any survey) plus an AI
 * read of each SME's answers. The read is kept in gapAnalyses/{templateId}_{participantId}, so it is
 * generated once and shared by everyone reviewing that SME. Interventions chosen from it go onto the
 * SME's diagnostic plan through saveDiagnosticPlan, which handles re-confirmation of signed plans.
 */

export type GapPriority = 'High' | 'Medium' | 'Low'

export type GapScore = { area: string, score: number, finding: string }

export type GapSuggestedIntervention = { interventionId: string, title: string, areaOfSupport?: string }

export type GapFinding = {
    area: string
    finding: string
    rootCause: string
    impact: string
    priority: GapPriority
    reason: string
    interventions: GapSuggestedIntervention[]
}

export type GapAnalysisResult = {
    summary: string
    scorecard: GapScore[]
    strengths: string[]
    gaps: GapFinding[]
    warnings: string[]
}

export type StoredGapAnalysis = {
    id: string
    templateId: string
    participantId: string
    programId?: string
    companyCode: string
    responseId?: string
    /** The response's submittedAt when this was generated, so a resubmission shows as out of date. */
    responseSubmittedAt?: string
    result: GapAnalysisResult
    generatedAt: string
    generatedByUid: string
    /** Interventions already moved onto the diagnostic plan from this analysis. */
    addedInterventionIds: string[]
}

export const gapAnalysisAvailable = isAgentApiConfigured

const COLLECTION = 'gapAnalyses'

const analysisIdFor = (templateId: string, participantId: string) => `${templateId}_${participantId}`

export const listGapAnalysisTemplates = async (user: FullIdentity): Promise<SurveyTemplate[]> => {
    const templates = await listSurveyTemplates()
    return templates.filter((template) => isGapAnalysis(template)
        && (!user.companyCode || !template.companyCode || template.companyCode === user.companyCode))
}

/** Stored analyses for one gap analysis, keyed by participant id. */
export const listStoredGapAnalyses = async (user: FullIdentity, templateId: string): Promise<Record<string, StoredGapAnalysis>> => {
    if (!user.companyCode) return {}
    const snapshot = await getDocs(query(
        collection(getFirebaseDb(), COLLECTION),
        where('companyCode', '==', user.companyCode),
        where('templateId', '==', templateId),
    ))
    return Object.fromEntries(snapshot.docs.map((row) => {
        const data = row.data() as Omit<StoredGapAnalysis, 'id'>
        return [data.participantId, { ...data, id: row.id, addedInterventionIds: data.addedInterventionIds || [] }]
    }))
}

/** Questions grouped under the section heading that precedes them; questions before any heading go to "General". */
export const groupBySection = (fields: SurveyField[]) => {
    const sections: Array<{ title: string, fields: SurveyField[] }> = []
    fields.forEach((field) => {
        if (field.type === 'heading') {
            sections.push({ title: field.label || 'Section', fields: [] })
            return
        }
        if (!sections.length) sections.push({ title: 'General', fields: [] })
        sections[sections.length - 1].fields.push(field)
    })
    return sections.filter((section) => section.fields.length)
}

const answerValue = (field: SurveyField, answers: SurveyAnswers) => {
    const value = answers[field.id]
    // Uploaded files are URLs; the model only needs to know something was provided.
    if (field.type === 'file') return Array.isArray(value) && value.length ? `${value.length} file(s) uploaded` : ''
    return value ?? ''
}

type ApiResponse = Partial<GapAnalysisResult> & { detail?: string, error?: string }

const asPriority = (value: unknown): GapPriority => (value === 'High' || value === 'Low' ? value : 'Medium')

export const analyseGapResponse = async (params: {
    user: FullIdentity
    template: SurveyTemplate
    row: SurveyResponseRow
    participant?: DiagnosticPlanParticipant
    catalogue: DiagnosticInterventionOption[]
}): Promise<StoredGapAnalysis> => {
    const { user, template, row, participant, catalogue } = params
    if (!isAgentApiConfigured) throw new Error('The AI service is not configured for this environment.')
    if (!template.id || !user.companyCode) throw new Error('This gap analysis cannot be analysed yet.')

    const answers = row.answers || {}
    const sections = groupBySection(template.fields).map((section) => ({
        title: section.title,
        questions: section.fields.map((field) => ({ question: field.label, type: field.type, answer: answerValue(field, answers) })),
    }))

    const response = await fetch(`${agentApiBaseUrl}/api/gap-analysis/analyse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
        body: JSON.stringify({
            title: template.title,
            business: {
                businessName: participant?.businessName || row.participantName,
                sector: participant?.sector || null,
                stage: participant?.stage || null,
                province: participant?.province || null,
            },
            sections,
            catalogue: catalogue.map((item) => ({ id: item.interventionId, title: item.title, areaOfSupport: item.areaOfSupport || null })),
            alreadyPlanned: (participant?.plan.interventions || []).map((item) => item.interventionId).filter(Boolean),
        }),
    })

    const data = await response.json().catch(() => ({})) as ApiResponse
    if (!response.ok) throw new Error(data.detail || data.error || 'The gap analysis could not be generated.')

    const result: GapAnalysisResult = {
        summary: String(data.summary || ''),
        scorecard: (data.scorecard || []).map((entry) => ({ area: String(entry.area), score: Number(entry.score) || 0, finding: String(entry.finding || '') })),
        strengths: (data.strengths || []).map(String),
        gaps: (data.gaps || []).map((gap) => ({
            area: String(gap.area || ''),
            finding: String(gap.finding || ''),
            rootCause: String(gap.rootCause || ''),
            impact: String(gap.impact || ''),
            priority: asPriority(gap.priority),
            reason: String(gap.reason || ''),
            interventions: (gap.interventions || []).map((item) => ({
                interventionId: String(item.interventionId),
                title: String(item.title),
                ...(item.areaOfSupport ? { areaOfSupport: String(item.areaOfSupport) } : {}),
            })),
        })),
        warnings: (data.warnings || []).map(String),
    }

    const stored: StoredGapAnalysis = {
        id: analysisIdFor(template.id, row.participantId),
        templateId: template.id,
        participantId: row.participantId,
        ...(template.programId ? { programId: template.programId } : {}),
        companyCode: user.companyCode,
        ...(row.responseId ? { responseId: row.responseId } : {}),
        ...(row.submittedAt ? { responseSubmittedAt: row.submittedAt } : {}),
        result,
        generatedAt: new Date().toISOString(),
        generatedByUid: user.uid,
        addedInterventionIds: [],
    }

    const { id, ...payload } = stored
    await setDoc(doc(getFirebaseDb(), COLLECTION, id), payload)
    return stored
}

/** The SMEs operations can plan for, by participant id, plus the company's intervention catalogue. */
export const loadPlanningContext = async (user: FullIdentity, programId?: string) => {
    const [participants, catalogue] = await Promise.all([
        listDiagnosticPlanParticipants(user, programId || null),
        listDiagnosticInterventionOptions(user.companyCode || undefined),
    ])
    return {
        participants: Object.fromEntries(participants.map((participant) => [participant.id, participant])) as Record<string, DiagnosticPlanParticipant>,
        catalogue,
    }
}

/**
 * Appends the chosen interventions to the SME's diagnostic plan (skipping any already on it) and records
 * them on the analysis. Returns how many were new to the plan.
 */
export const addGapInterventionsToPlan = async (params: {
    user: FullIdentity
    participant: DiagnosticPlanParticipant
    analysis: StoredGapAnalysis
    interventions: GapSuggestedIntervention[]
}): Promise<number> => {
    const { user, participant, analysis, interventions } = params
    if (!participant.applicationId) throw new Error('no-application')

    const existing = participant.plan.interventions
    const existingIds = new Set(existing.map((item) => item.interventionId))
    const fresh = interventions.filter((item) => !existingIds.has(item.interventionId))

    if (fresh.length) {
        await saveDiagnosticPlan(user, participant, [
            ...existing,
            ...fresh.map((item) => ({ interventionId: item.interventionId, title: item.title, areaOfSupport: item.areaOfSupport })),
        ])
    }

    const added = [...new Set([...analysis.addedInterventionIds, ...interventions.map((item) => item.interventionId)])]
    await setDoc(doc(getFirebaseDb(), COLLECTION, analysis.id), { addedInterventionIds: added, companyCode: analysis.companyCode }, { merge: true })
    return fresh.length
}
