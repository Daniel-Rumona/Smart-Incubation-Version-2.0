import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import { getApplicantProfileBundle } from '@/services/applicantService'
import type { FullIdentity } from '@/types/identity'

/*
 * "What's holding the business back?" The SME's answer and their business profile go to the AI backend
 * (/api/roadmap/generate), which suggests a few steps and the kind of agent for each. The result is kept on the
 * SME's own account (users/{uid}.roadmapSuggestions), so the roadmap, the dashboard and Find support share one answer.
 */

export type SuggestedStep = {
    title: string
    department?: string
    areaOfSupport?: string
    urgency?: string
    reason?: string
    expectedImpact?: string
}

export type SavedSuggestions = {
    challenge: string
    items: SuggestedStep[]
    /** Agents the backend matched to the steps, as it returned them. */
    agents: Array<Record<string, unknown>>
    generatedAt: string
}

export const suggestionsAvailable = isAgentApiConfigured

export const loadSavedSuggestions = async (uid: string): Promise<SavedSuggestions | null> => {
    const snapshot = await getDoc(doc(getFirebaseDb(), 'users', uid))
    const saved = (snapshot.data() || {}).roadmapSuggestions as SavedSuggestions | undefined
    return saved && Array.isArray(saved.items) ? saved : null
}

/** Asks the AI for up to 4 steps from the challenge and profile, saves them on the SME's account, and returns them. */
export const requestSuggestions = async (user: FullIdentity, challenge: string, supportUnderWay: string[] = []): Promise<SavedSuggestions> => {
    if (!isAgentApiConfigured) throw new Error('Suggestions aren’t available right now.')
    const bundle = await getApplicantProfileBundle(user.uid, user.email).catch(() => null)
    const profile = { ...(bundle?.applicantProfile || {}), ...(bundle?.businessProfile || {}) } as Record<string, unknown>
    const pick = (key: string) => (profile[key] === undefined || profile[key] === '' ? null : profile[key])
    const intake = {
        rawStory: challenge.trim(),
        contactName: user.displayName || user.name || '',
        businessName: pick('businessName'),
        sector: pick('sector'),
        natureOfBusiness: pick('natureOfBusiness'),
        yearsOfTrading: pick('yearsOfTrading'),
        province: pick('province'),
        city: pick('city'),
        registrationStatus: pick('registrationStatus'),
        beeLevel: pick('beeLevel'),
    }
    const response = await fetch(`${agentApiBaseUrl}/api/roadmap/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
        body: JSON.stringify({ intake, participant: { ...intake, supportUnderWay } }),
    })
    if (!response.ok) throw new Error(`Suggestions failed with ${response.status}`)
    const payload = await response.json() as { roadmap?: SuggestedStep[], agents?: Array<Record<string, unknown>> }
    const items = (payload.roadmap || []).slice(0, 4).map((item) => ({
        title: String(item.title || ''),
        department: item.department || item.areaOfSupport || 'General Support',
        areaOfSupport: item.areaOfSupport || item.department || 'General Support',
        urgency: item.urgency || 'medium',
        reason: item.reason || item.expectedImpact || '',
        expectedImpact: item.expectedImpact || '',
    })).filter((item) => item.title)
    if (!items.length) throw new Error('No suggestions came back.')
    const saved: SavedSuggestions = { challenge: challenge.trim(), items, agents: payload.agents || [], generatedAt: new Date().toISOString() }
    await updateDoc(doc(getFirebaseDb(), 'users', user.uid), { roadmapSuggestions: saved })
    return saved
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 3))

/**
 * How well a provider's offer matches the suggested steps: the share of a step's words found in the provider's text,
 * best step wins. Returns the score and the step it matched, so the page can say why it's suggested.
 */
export const matchToSteps = (providerText: string, steps: SuggestedStep[]) => {
    const offer = words(providerText)
    let best = { score: 0, step: undefined as SuggestedStep | undefined }
    steps.forEach((step) => {
        const wanted = words(`${step.title} ${step.areaOfSupport || ''} ${step.department || ''}`)
        if (!wanted.size) return
        const hits = [...wanted].filter((word) => offer.has(word)).length
        const score = hits / wanted.size
        if (score > best.score) best = { score, step }
    })
    return best
}
