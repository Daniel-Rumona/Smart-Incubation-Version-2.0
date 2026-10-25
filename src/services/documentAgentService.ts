import { arrayUnion, collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import { getAgentDefinition } from '@/services/agentOrchestrationService'
import type { AgentId } from '@/types/agentOrchestration'
import type { FullIdentity } from '@/types/identity'

export type DocumentAgentAssignment = {
  id: string
  agentId: AgentId
  agentName: string
  companyCode: string
  participantId: string
  interventionId: string
  interventionTitle: string
  businessName: string
  programId?: string
  programName?: string
  deliveryStrategy?: string
  reviewRequired: boolean
  /** Current progress, recorded as the starting point of the evidence step the deliverable adds. */
  progress?: number
  reviewerType?: string
  executionMode: 'single_session' | 'multi_step'
  steps: AgentInterventionStep[]
  targetMetric?: string
  targetValue?: number
  businessContext: {
    sector?: string
    natureOfBusiness?: string
    location?: string
    stage?: string
    challenges?: string
    yearsOfTrading?: number
    vision?: string
    mission?: string
    productsServices?: string
    targetCustomers?: string
    revenueModel?: string
    team?: string
    goals?: string
  }
}

export type AgentInterventionStep = {
  id: string
  title: string
  description?: string
  weight: number
  status: 'not_started' | 'in_progress' | 'completed'
  evidence?: string
}

export type DocumentAgentChatMessage = { role: 'user' | 'agent'; content: string }
export type DocumentAgentAttachment = { name: string; mimeType: string; contentBase64: string }
export type DocumentAgentChatResult = {
  reply: string
  answers: Record<string, string>
  missingFields: string[]
  ready: boolean
  requestedDocuments: string[]
  documentsRead: string[]
  stepUpdates?: Array<Pick<AgentInterventionStep, 'id' | 'status' | 'evidence'>>
}

const headers = async () => ({
  'Content-Type': 'application/json',
  ...(await getAgentAuthHeaders()),
})

const responseError = async (response: Response, fallback: string) => {
  try {
    const body = await response.json() as { detail?: string }
    return body.detail || fallback
  } catch {
    return fallback
  }
}

const sha256Hex = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

const firestoreSafe = <T>(value: T): T => {
  if (value === undefined) return null as T
  if (Array.isArray(value)) return value.map(item => firestoreSafe(item)) as T
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, firestoreSafe(item)])) as T
  }
  return value
}

const firstText = (...values: unknown[]) => {
  const value = values.find(item => typeof item === 'string' && item.trim())
  return value ? String(value).trim() : undefined
}

const BUSINESS_PLAN_FIELDS: Array<[string, string]> = [
  ['description', 'In your own words, what does the business do on a normal day?'],
  ['goals', 'What would you most like the business to achieve in the next one to three years?'],
  ['challenges', 'What is the biggest thing making business difficult right now?'],
  ['fundingNeed', 'Would money, equipment, people, or training help most—and what would you use it for?'],
]

const STRATEGIC_PLAN_FIELDS: Array<[string, string]> = [
  ['vision', 'If the business is doing well three years from now, what will be different?'],
  ['strategicPriorities', 'What are the two or three most important improvements to work on first?'],
  ['risks', 'What is most likely to get in the way of that progress?'],
  ['timeHorizon', 'Should this plan cover one year, three years, or five years?'],
]

export type DocumentAgentPreview = { agentId: AgentId; source?: string; preview: Record<string, unknown> }

export const previewDocumentAgentOutput = async (agentId: AgentId, answers: Record<string, string>): Promise<DocumentAgentPreview> => {
  if (!isAgentApiConfigured) throw new Error('The document agent endpoint is not configured.')
  const response = await fetch(`${agentApiBaseUrl}/api/document-agents/preview`, {
    method: 'POST', headers: await headers(), body: JSON.stringify({ agentId, answers }),
  })
  if (!response.ok) throw new Error(await responseError(response, 'The document preview could not be created.'))
  return response.json() as Promise<DocumentAgentPreview>
}

const LEGACY_DOCUMENT_REQUESTS: Record<AgentId, string[]> = {
  'business-plan': ['Company profile or registration document', 'Recent financial statements or estimates', 'Product/service information', 'Existing market research or customer evidence'],
  'strategic-plan': ['Current business or company profile', 'Previous strategy or business plan', 'Recent performance or financial reports', 'Organisation structure', 'Market, programme, or stakeholder research'],
}

const legacyDocumentAgentChat = (input: {
  agentId: AgentId
  message: string
  answers: Record<string, string>
  attachments?: DocumentAgentAttachment[]
}): DocumentAgentChatResult => {
  const fields = input.agentId === 'strategic-plan' ? STRATEGIC_PLAN_FIELDS : BUSINESS_PLAN_FIELDS
  const answers = { ...input.answers }
  const missingBefore = fields.filter(([key]) => !answers[key]?.trim())
  const responseText = input.message.trim()
  const normalizedMessage = responseText.toLowerCase()
  if (input.agentId === 'strategic-plan' && responseText) {
    const currentKey = missingBefore[0]?.[0]
    const baseResult = (reply: string): DocumentAgentChatResult => ({
      reply,
      answers,
      missingFields: missingBefore.map(([key]) => key),
      ready: missingBefore.length === 0,
      requestedDocuments: LEGACY_DOCUMENT_REQUESTS[input.agentId],
      documentsRead: (input.attachments || []).map(item => item.name),
    })
    if ((normalizedMessage.includes('help') || normalizedMessage.includes('sharpen')) && (normalizedMessage.includes('priorit') || normalizedMessage.includes('strategy'))) {
      return baseResult('Absolutely. Let’s turn broad ideas into outcome-based priorities. A useful starting set is: strengthen customer value, build predictable revenue, improve delivery systems, and develop the team or partnerships needed for growth. Which two would make the biggest difference in the next 12 months?')
    }
    if (/\b(not sure|don'?t know|do not know|still trying|trying to figure|no idea|unsure|not yet)\b/.test(normalizedMessage)) {
      const coaching: Record<string, string> = {
        vision: 'That is completely fine—the vision is something we can discover together. Three years from now, what would make you proudest: serving more customers, expanding to new locations, creating jobs, becoming consistently profitable, or being known for a particular impact? Choose one or two and I’ll shape the wording.',
        mission: 'Let’s build it together. Who do you help, what problem do you solve, and how do you solve it? Rough fragments are enough.',
        strategicPriorities: 'Which pressure is most urgent right now: customers, cash flow, operations, team capability, or entering a new market?',
      }
      return baseResult(coaching[currentKey || ''] || 'That is fine. Give me the roughest version of your thinking—even fragments—and I’ll help shape it.')
    }
    if (currentKey === 'vision' && ['money', 'moneu', 'profit', 'profits'].includes(normalizedMessage)) {
      return baseResult('Financial success can be part of the vision. Which outcome matters most: stable profitability, a specific revenue level, attracting investment, or stronger financial security?')
    }
  }
  if (responseText && missingBefore[0]) answers[missingBefore[0][0]] = responseText
  const missing = fields.filter(([key]) => !answers[key]?.trim())
  const documentsRead = (input.attachments || []).map((item) => item.name)
  const planName = input.agentId === 'strategic-plan' ? 'strategic plan' : 'business plan'
  const acknowledgement = responseText ? 'Thank you — I have added that to your plan.' : `Let’s build your ${planName} together.`
  return {
    reply: missing[0] ? `${acknowledgement}\n\n${missing[0][1]}` : `${acknowledgement}\n\nI have enough information to create your first draft. You can refine any answer or create the Word document now.`,
    answers,
    missingFields: missing.map(([key]) => key),
    ready: missing.length === 0,
    requestedDocuments: LEGACY_DOCUMENT_REQUESTS[input.agentId],
    documentsRead,
  }
}

const participantIdsForUser = async (user: FullIdentity) => {
  const db = getFirebaseDb()
  const ids = new Set([user.uid])
  const direct = await getDoc(doc(db, 'participants', user.uid))
  if (direct.exists()) ids.add(direct.id)
  if (!direct.exists() && user.email) {
    const snapshot = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email)))
    snapshot.docs.forEach((row) => ids.add(row.id))
  }
  return ids
}

export const getDocumentAgentAssignment = async (
  assignmentId: string,
  agentId: AgentId,
  user: FullIdentity,
): Promise<DocumentAgentAssignment> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'assignedInterventions', assignmentId))
  if (!snapshot.exists()) throw new Error('This assigned intervention could not be found.')
  const data = snapshot.data()
  if (data.agentId !== agentId || data.deliveryActorType !== 'agent') throw new Error('This intervention is assigned to a different delivery workspace.')
  if (user.companyCode && data.companyCode && user.companyCode !== data.companyCode) throw new Error('You do not have access to this intervention.')
  const participantIds = await participantIdsForUser(user)
  if (data.participantId && !participantIds.has(String(data.participantId))) throw new Error('You do not have access to this assigned intervention.')
  const agent = await getAgentDefinition(agentId)
  if (!agent) throw new Error('The assigned agent is unavailable.')
  const [businessProfileSnapshot, participantSnapshot, applicationSnapshot] = await Promise.all([
    getDoc(doc(getFirebaseDb(), 'businessProfiles', user.uid)),
    data.participantId ? getDoc(doc(getFirebaseDb(), 'participants', String(data.participantId))) : Promise.resolve(null),
    data.applicationId ? getDoc(doc(getFirebaseDb(), 'applications', String(data.applicationId))) : Promise.resolve(null),
  ])
  const businessProfile = businessProfileSnapshot.data() || {}
  const participant = participantSnapshot?.data() || {}
  const application = applicationSnapshot?.data() || {}
  const formValues = application.formValues && typeof application.formValues === 'object' ? application.formValues as Record<string, unknown> : application
  const province = firstText(businessProfile.province, participant.province, formValues.province)
  const city = firstText(businessProfile.city, participant.city, formValues.city)
  return {
    id: snapshot.id,
    agentId,
    agentName: agent.name,
    companyCode: String(data.companyCode || user.companyCode || ''),
    participantId: String(data.participantId || user.uid),
    interventionId: String(data.interventionId || ''),
    interventionTitle: String(data.interventionTitle || agent.name),
    businessName: String(data.beneficiaryName || data.businessName || user.displayName || ''),
    programId: data.programId ? String(data.programId) : undefined,
    programName: data.programName ? String(data.programName) : undefined,
    deliveryStrategy: data.deliveryStrategy ? String(data.deliveryStrategy) : undefined,
    reviewRequired: data.reviewRequired === true,
    progress: typeof data.progress === 'number' ? data.progress : Number((data.progress as { percentage?: unknown } | undefined)?.percentage || 0),
    reviewerType: data.reviewerType ? String(data.reviewerType) : undefined,
    executionMode: data.executionMode === 'multi_step' ? 'multi_step' : 'single_session',
    steps: (Array.isArray(data.steps) ? data.steps : []).map((step: Record<string, unknown>, index: number) => ({
      id: String(step.id || `step-${index + 1}`),
      title: String(step.title || `Step ${index + 1}`),
      description: step.description ? String(step.description) : undefined,
      weight: Math.max(1, Number(step.weight || 1)),
      status: step.status === 'completed' ? 'completed' : step.status === 'in_progress' ? 'in_progress' : 'not_started',
      evidence: step.evidence ? String(step.evidence) : undefined,
    })),
    targetMetric: data.targetMetric ? String(data.targetMetric) : undefined,
    targetValue: typeof data.targetValue === 'number' ? data.targetValue : undefined,
    businessContext: {
      sector: firstText(businessProfile.sector, participant.sector, formValues.sector),
      natureOfBusiness: firstText(businessProfile.natureOfBusiness, participant.natureOfBusiness, formValues.natureOfBusiness, formValues.businessDescription),
      location: firstText([city, province].filter(Boolean).join(', '), businessProfile.businessAddress, participant.businessAddress, formValues.location),
      stage: firstText(businessProfile.stage, participant.stage, formValues.stage),
      challenges: firstText(businessProfile.challenges, participant.challenges, formValues.challenges, formValues.motivation),
      yearsOfTrading: Number(businessProfile.yearsOfTrading ?? participant.yearsOfTrading ?? formValues.yearsOfTrading) || undefined,
      vision: firstText(businessProfile.vision, participant.vision, formValues.vision),
      mission: firstText(businessProfile.mission, participant.mission, formValues.mission),
      productsServices: firstText(businessProfile.productsServices, participant.productsServices, formValues.productsServices),
      targetCustomers: firstText(businessProfile.targetCustomers, participant.targetCustomers, formValues.targetCustomers, formValues.targetMarket),
      revenueModel: firstText(businessProfile.revenueModel, participant.revenueModel, formValues.revenueModel),
      team: firstText(businessProfile.team, participant.team, formValues.team),
      goals: firstText(businessProfile.goals, participant.goals, formValues.goals),
    },
  }
}

export const sendDocumentAgentMessage = async (input: {
  agentId: AgentId
  message: string
  answers: Record<string, string>
  history: DocumentAgentChatMessage[]
  attachments?: DocumentAgentAttachment[]
  interventionContext?: {
    title: string
    executionMode: 'single_session' | 'multi_step'
    steps: AgentInterventionStep[]
    targetMetric?: string
    targetValue?: number
  }
}): Promise<DocumentAgentChatResult> => {
  if (!isAgentApiConfigured) throw new Error('The document agent endpoint is not configured.')
  let response: Response
  if (input.agentId === 'strategic-plan') {
    const strategicInput = { message: input.message, answers: input.answers, history: input.history, attachments: input.attachments, interventionContext: input.interventionContext }
    response = await fetch(`${agentApiBaseUrl}/api/strategic-plan/chat`, {
      method: 'POST', headers: await headers(), body: JSON.stringify(strategicInput),
    })
    if (response.status === 404) {
      response = await fetch(`${agentApiBaseUrl}/api/document-agents/chat`, {
        method: 'POST', headers: await headers(), body: JSON.stringify(input),
      })
    }
  } else {
    response = await fetch(`${agentApiBaseUrl}/api/document-agents/chat`, {
      method: 'POST', headers: await headers(), body: JSON.stringify(input),
    })
  }
  if (response.status === 404) return legacyDocumentAgentChat(input)
  if (!response.ok) throw new Error(await responseError(response, 'The agent could not respond.'))
  return response.json() as Promise<DocumentAgentChatResult>
}

export const fileToAgentAttachment = async (file: File): Promise<DocumentAgentAttachment> => {
  if (file.size > 5_000_000) throw new Error('Documents must be 5 MB or smaller.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('The document could not be read.'))
    reader.readAsDataURL(file)
  })
  return { name: file.name, mimeType: file.type || 'application/octet-stream', contentBase64: dataUrl.split(',')[1] || '' }
}

export const persistDocumentAgentProgress = async (
  assignment: DocumentAgentAssignment,
  answers: Record<string, string>,
  messages: DocumentAgentChatMessage[],
  ready: boolean,
  user: FullIdentity,
) => {
  const db = getFirebaseDb()
  const executionMode = assignment.executionMode === 'multi_step' ? 'multi_step' : 'single_session'
  const steps = Array.isArray(assignment.steps) ? assignment.steps : []
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0)
  const completedWeight = steps.filter((step) => step.status === 'completed').reduce((sum, step) => sum + step.weight, 0)
  const stepProgress = totalWeight ? Math.round((completedWeight / totalWeight) * 100) : null
  const progress = stepProgress === null ? (ready ? 70 : Math.min(60, 10 + Object.keys(answers).length * 7)) : Math.min(90, stepProgress)
  await Promise.all([
    setDoc(doc(db, 'agentWorkRuns', assignment.id), firestoreSafe({
      assignmentId: assignment.id,
      companyCode: assignment.companyCode,
      participantId: assignment.participantId,
      interventionId: assignment.interventionId,
      interventionTitle: assignment.interventionTitle,
      programId: assignment.programId || null,
      programName: assignment.programName || null,
      agentId: assignment.agentId,
      agentName: assignment.agentName,
      deliveryStrategy: assignment.deliveryStrategy || 'agent_only',
      reviewRequired: assignment.reviewRequired,
      reviewerType: assignment.reviewerType || null,
      executionMode,
      steps,
      targetMetric: assignment.targetMetric || null,
      targetValue: assignment.targetValue ?? null,
      status: ready ? 'conversation_complete' : 'in_progress',
      answers,
      conversation: messages.slice(-30),
      stepProgress,
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    }), { merge: true }),
    updateDoc(doc(db, 'assignedInterventions', assignment.id), firestoreSafe({
      agentWorkStatus: ready ? 'conversation_complete' : 'in_progress',
      agentRunId: assignment.id,
      executionMode,
      steps,
      progress,
      status: 'in-progress',
      updatedAt: serverTimestamp(),
    })),
  ])
}

export const downloadDocumentAgentOutput = async (
  assignment: DocumentAgentAssignment,
  answers: Record<string, string>,
  user: FullIdentity,
) => {
  if (!isAgentApiConfigured) throw new Error('The document agent endpoint is not configured.')
  let response: Response
  if (assignment.agentId === 'strategic-plan') {
    response = await fetch(`${agentApiBaseUrl}/api/strategic-plan/document`, {
      method: 'POST', headers: await headers(), body: JSON.stringify({ answers }),
    })
    if (response.status === 404) {
      response = await fetch(`${agentApiBaseUrl}/api/document-agents/document`, {
        method: 'POST', headers: await headers(), body: JSON.stringify({ agentId: assignment.agentId, answers }),
      })
    }
  } else {
    response = await fetch(`${agentApiBaseUrl}/api/document-agents/document`, {
      method: 'POST', headers: await headers(), body: JSON.stringify({ agentId: assignment.agentId, answers }),
    })
  }
  if (response.status === 404 && assignment.agentId === 'business-plan') {
    const profile = {
      companyName: answers.companyName || assignment.businessName,
      industry: answers.industryLocation || '',
      description: answers.description || '',
      productsServices: answers.productsServices || '',
      targetCustomers: answers.targetCustomers || '',
      revenueModel: answers.revenueModel || '',
      team: answers.team || '',
      goals: answers.goals || '',
      fundingNeed: answers.fundingNeed || '',
    }
    const draftResponse = await fetch(`${agentApiBaseUrl}/api/business-plan/draft`, {
      method: 'POST', headers: await headers(), body: JSON.stringify({ profile }),
    })
    if (!draftResponse.ok) throw new Error(await responseError(draftResponse, 'The business plan could not be drafted.'))
    const result = await draftResponse.json() as { draft: unknown }
    response = await fetch(`${agentApiBaseUrl}/api/business-plan/document`, {
      method: 'POST', headers: await headers(), body: JSON.stringify({ profile, draft: result.draft }),
    })
  }
  if (!response.ok) throw new Error(await responseError(response, 'The document could not be created.'))
  const disposition = response.headers.get('Content-Disposition') || ''
  const issuedHash = response.headers.get('X-Document-SHA256')?.toLowerCase() || ''
  const signature = response.headers.get('X-Document-Signature')?.toLowerCase() || ''
  const signatureAlgorithm = response.headers.get('X-Document-Signature-Algorithm') || ''
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || `${assignment.agentId}.docx`
  const blob = await response.blob()
  const sha256 = await sha256Hex(blob)
  if (issuedHash && issuedHash !== sha256) throw new Error('The generated document failed its integrity check and was not saved.')
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, '-')
  const storagePath = `intervention-documents/${assignment.companyCode}/${assignment.participantId}/${assignment.id}/${Date.now()}-${safeName}`
  const storageRef = ref(getFirebaseStorage(), storagePath)
  await uploadBytes(storageRef, blob, { contentType: blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  const fileUrl = await getDownloadURL(storageRef)
  const executionMode = assignment.executionMode === 'multi_step' ? 'multi_step' : 'single_session'
  const steps = Array.isArray(assignment.steps) ? assignment.steps : []
  const stepsSatisfied = executionMode !== 'multi_step' || (steps.length > 0 && steps.every((step) => step.status === 'completed'))
  const needsReview = stepsSatisfied && assignment.reviewRequired
  const totalWeight = steps.reduce((sum, step) => sum + step.weight, 0)
  const completedWeight = steps.filter((step) => step.status === 'completed').reduce((sum, step) => sum + step.weight, 0)
  const stepProgress = totalWeight ? Math.round((completedWeight / totalWeight) * 100) : 100
  const db = getFirebaseDb()
  // The id is reserved up front so the intervention's proof of evidence can link to this document.
  const documentRef = doc(collection(db, 'interventionDocuments'))
  const progressAfter = !stepsSatisfied ? Math.min(90, stepProgress) : needsReview ? 90 : 100
  await Promise.all([
    setDoc(documentRef, firestoreSafe({
      companyCode: assignment.companyCode,
      assignmentId: assignment.id,
      participantId: assignment.participantId,
      participantName: assignment.businessName,
      interventionId: assignment.interventionId,
      interventionTitle: assignment.interventionTitle,
      programId: assignment.programId || null,
      programName: assignment.programName || null,
      agentId: assignment.agentId,
      agentName: assignment.agentName,
      fileName,
      fileUrl,
      storagePath,
      sha256,
      signature: signature || null,
      signatureAlgorithm: signature ? (signatureAlgorithm || 'HMAC-SHA256') : null,
      provenanceStatus: signature ? 'signed' : 'legacy_unsigned',
      generatedBySystem: true,
      artifactVersion: 1,
      status: 'final',
      isFinal: true,
      contentType: blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      createdAt: serverTimestamp(),
      createdByUid: user.uid,
      createdByEmail: user.email,
    })),
    setDoc(doc(db, 'agentWorkRuns', assignment.id), firestoreSafe({
      status: !stepsSatisfied ? 'in_progress' : needsReview ? 'awaiting_review' : 'completed',
      generatedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedByUid: user.uid,
      updatedByEmail: user.email,
    }), { merge: true }),
    updateDoc(doc(db, 'assignedInterventions', assignment.id), firestoreSafe({
      agentWorkStatus: !stepsSatisfied ? 'in_progress' : needsReview ? 'awaiting_review' : 'completed',
      reviewStatus: needsReview ? 'pending' : null,
      progress: progressAfter,
      assigneeCompletionStatus: !stepsSatisfied ? 'pending' : needsReview ? 'pending_review' : 'done',
      status: stepsSatisfied ? 'awaiting_confirmation' : 'in-progress',
      updatedAt: serverTimestamp(),
      // The deliverable becomes proof of evidence on the intervention itself, next to facilitator uploads,
      // so operations reviews it there rather than in a separate library.
      progressSteps: arrayUnion(firestoreSafe({
        createdAt: Timestamp.now(),
        actorUid: user.uid,
        actorRole: 'agent',
        source: 'agent',
        progressBefore: Number(assignment.progress || 0),
        progressAfter,
        notes: `${assignment.agentName || 'Agent'} generated ${fileName}`,
        evidenceFiles: [fileName],
        evidenceLinks: [{ name: fileName, url: fileUrl, documentId: documentRef.id }],
      })),
    })),
  ])

  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
