import { readSwotItems } from '@/utils/swotOutcomes'
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import { listOperationsParticipants } from '@/services/operationsParticipantsService'
import { loadDefinitions } from '@/services/interventionDefinitionLookup'
import type {
  DiagnosticApplicationSummary,
  DiagnosticInterventionOption,
  DiagnosticPlanIntervention,
  DiagnosticPlanParticipant,
  DiagnosticSwot,
} from '@/types/diagnosticPlan'
import type { FullIdentity } from '@/types/identity'

type LooseRecord = Record<string, unknown>

export type DiagnosticInterventionRequest = {
  id: string
  participantId: string
  programId?: string
  interventionTitle: string
  areaOfSupport: string
  reason?: string
  status: string
}

const asRecord = (value: unknown): LooseRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as LooseRecord
    : {}

const planIdFor = (applicationId: string) => applicationId

const normalizeText = (value: unknown) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const getByAliases = (source: LooseRecord, aliases: string[]) => {
  for (const alias of aliases) {
    const value = source[alias]
    if (value !== undefined && value !== null && value !== '') return value
  }

  const normalized = new Map(
    Object.entries(source).map(([key, value]) => [normalizeText(key), value]),
  )

  for (const alias of aliases) {
    const value = normalized.get(normalizeText(alias))
    if (value !== undefined && value !== null && value !== '') return value
  }

  return undefined
}

const asList = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter(Boolean)
      .filter((item) => normalizeText(item) !== 'error')
  }

  return String(value || '')
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => normalizeText(item) !== 'error')
}

const cleanInterventions = (items: DiagnosticPlanIntervention[]) => {
  const seen = new Set<string>()

  return items.flatMap((item) => {
    const title = String(item.title || '').trim()
    const key = normalizeText(title)

    if (!title || key === 'error' || seen.has(key)) return []

    seen.add(key)

    return [{
      interventionId:
        item.interventionId ||
        key.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      title,
      ...(item.areaOfSupport ? { areaOfSupport: item.areaOfSupport } : {}),
      ...(item.executionMode ? { executionMode: item.executionMode } : {}),
      ...(Array.isArray(item.steps) ? { steps: item.steps } : {}),
    }]
  })
}

const getSwot = (application: LooseRecord): DiagnosticSwot => {
  const source = asRecord(
    application.swot ||
    application.SWOT ||
    application.swotAnalysis,
  )

  return {
    strengths: asList(source.strengths || source.Strengths || source.S),
    weaknesses: asList(source.weaknesses || source.Weaknesses || source.W),
    opportunities: asList(source.opportunities || source.Opportunities || source.O),
    threats: asList(source.threats || source.Threats || source.T),
  }
}

const getAiRecommendation = (application: LooseRecord): LooseRecord => {
  const directAiRecommendation = asRecord(application.aiRecommendation)
  if (Object.keys(directAiRecommendation).length) return directAiRecommendation

  const aiRecommendations = asRecord(application.aiRecommendations)
  if (Object.keys(aiRecommendations).length) return aiRecommendations

  const aiEvaluation = asRecord(application.aiEvaluation)
  if (Object.keys(aiEvaluation).length) return aiEvaluation

  const aiEvaluations = asRecord(application.aiEvaluations)
  const recommendations = asRecord(
    aiEvaluations.Recommendations ||
    aiEvaluations.recommendations,
  )

  return recommendations
}

const getRecommendedInterventionMap = (application: LooseRecord): LooseRecord => {
  const aiRecommendation = getAiRecommendation(application)

  return asRecord(
    getByAliases(aiRecommendation, [
      'Recommended Interventions',
      'RecommendedInterventions',
      'recommendedInterventions',
    ]),
  )
}

const getApplicationSummary = (application: LooseRecord): DiagnosticApplicationSummary => {
  const aiRecommendation = getAiRecommendation(application)

  const aiScore =
    getByAliases(aiRecommendation, ['AI Score', 'aiScore'])
    ?? application.aiScore

  const recommendationText =
    getByAliases(aiRecommendation, [
      'AI Recommendation',
      'aiRecommendation',
      'recommendation',
      'decision',
    ])

  const justification =
    getByAliases(aiRecommendation, [
      'Justification',
      'justification',
    ])

  return {
    motivation: application.motivation ? String(application.motivation) : undefined,
    challenges: application.challenges ? String(application.challenges) : undefined,
    complianceScore:
      typeof application.complianceScore === 'number' ||
      typeof application.complianceScore === 'string'
        ? application.complianceScore
        : undefined,
    aiScore:
      typeof aiScore === 'number' ||
      typeof aiScore === 'string'
        ? aiScore
        : undefined,
    aiRecommendation: recommendationText ? String(recommendationText) : undefined,
    aiJustification: justification ? String(justification) : undefined,
    recommendedInterventions: getRecommendedInterventionMap(application),
    submittedAt: application.submittedAt,
  }
}

const getApplicationInterventions = (application: LooseRecord): DiagnosticPlanIntervention[] => {
  const interventions = asRecord(application.interventions)
  const required = interventions.required

  if (!Array.isArray(required)) return []

  return required.map((item) => {
    const row = asRecord(item)

    return {
      interventionId: String(row.interventionId || ''),
      title: String(row.title || ''),
      areaOfSupport: row.areaOfSupport ? String(row.areaOfSupport) : undefined,
    }
  })
}

export const listDiagnosticPlanParticipants = async (
  user: FullIdentity,
  activeProgramId?: string | null,
): Promise<DiagnosticPlanParticipant[]> => {
  if (!hasRolePermission(user.role, 'view_diagnostic_plans', user.permissions)) {
    throw new Error('forbidden')
  }

  const db = getFirebaseDb()

  const [participants, plansSnapshot, applicationsSnapshot] = await Promise.all([
    listOperationsParticipants(user, activeProgramId),
    getDocs(collection(db, 'diagnosticPlans')),
    getDocs(user.companyCode ? query(collection(db, 'applications'), where('companyCode', '==', user.companyCode)) : collection(db, 'applications')),
  ])

  const plans = new Map(plansSnapshot.docs.map((row) => [row.id, row.data()]))
  const applicationsById = new Map(
    applicationsSnapshot.docs.map((row) => [row.id, row.data()]),
  )
  const definitions = await loadDefinitions(db, plansSnapshot.docs.flatMap(row => {
    const data = row.data()
    const interventions = data.interventions
    return Array.isArray(interventions)
      ? interventions.map(item => ({ interventionId: String(asRecord(item).interventionId || ''), companyCode: String(data.companyCode || '') })).filter(ref => ref.interventionId)
      : []
  }))

  return participants.map((participant) => {
    const application = asRecord(applicationsById.get(participant.applicationId))
    const stored = asRecord(plans.get(planIdFor(participant.applicationId)))
    const confirmedMeta = asRecord(stored.confirmedMeta)

    const interventionSource = Array.isArray(stored.interventions)
      ? stored.interventions
      : getApplicationInterventions(application)

    const interventions: DiagnosticPlanIntervention[] = Array.isArray(interventionSource)
      ? interventionSource.map((item) => {
          const row = asRecord(item)
          const definition = asRecord(definitions.get(String(row.interventionId || ''), String(stored.companyCode || application.companyCode || user.companyCode || '')))

          return {
            interventionId: String(row.interventionId || ''),
            title: String(definition.interventionTitle || definition.title || row.title || ''),
            areaOfSupport: definition.areaOfSupport ? String(definition.areaOfSupport) : row.areaOfSupport ? String(row.areaOfSupport) : undefined,
            executionMode: definition.executionMode === 'multi_step' ? 'multi_step' as const : 'single_session' as const,
            steps: Array.isArray(definition.steps) ? definition.steps : [],
          }
        })
      : []

    return {
      ...participant,
      aiRecommendation: getAiRecommendation(application),
      plan: {
        id: planIdFor(participant.applicationId),
        participantId: participant.id,
        applicationId: participant.applicationId,
        programId: participant.programId,
        status: stored.status === 'Confirmed' || stored.confirmed === true
          ? 'Confirmed'
          : 'Draft',
        interventions: cleanInterventions(interventions),
        confirmedBy: asRecord(stored.confirmedBy),
        confirmedMeta: {
          operations: asRecord(confirmedMeta.operations),
          participant: asRecord(confirmedMeta.participant),
          incubatee: asRecord(confirmedMeta.incubatee),
          sme: asRecord(confirmedMeta.sme),
        },
        confirmedAt: stored.confirmedAt ? String(stored.confirmedAt) : undefined,
      },
      swot: getSwot(application),
      swotItems: readSwotItems(application),
      applicationSummary: getApplicationSummary(application),
    } satisfies DiagnosticPlanParticipant
  })
}

export async function listDiagnosticInterventionOptions(
  companyCode?: string,
): Promise<DiagnosticInterventionOption[]> {
  console.log('[diagnosticPlansService] FUNCTION HIT', { companyCode })

  const db = getFirebaseDb()
  const cleanCompanyCode = String(companyCode || '').trim().toUpperCase()

  const snapshot = await getDocs(collection(db, 'interventions'))

  const allRows = snapshot.docs
    .map((docSnap) => {
      const data = docSnap.data()

      const title = String(data.interventionTitle || '').trim()

      const areaOfSupport = String(
        data.areaOfSupport || '',
      ).trim()

      return {
        id: docSnap.id,
        interventionId: docSnap.id,
        title,
        areaOfSupport,
        executionMode: data.executionMode === 'multi_step' ? 'multi_step' : 'single_session',
        steps: Array.isArray(data.steps) ? data.steps : [],
        companyCode: String(data.companyCode || '').trim(),
        rawCompanyCode: data.companyCode,
        rawScopeType: data.scopeType,
        rawProgramId: data.programId,
      } as DiagnosticInterventionOption & {
        companyCode?: string
        rawCompanyCode?: unknown
        rawScopeType?: unknown
        rawProgramId?: unknown
      }
    })
    .filter((item) => item.title && item.title.toLowerCase() !== 'error')

  const rows = cleanCompanyCode
    ? allRows.filter((item) => String(item.companyCode || '').trim().toUpperCase() === cleanCompanyCode)
    : allRows

  console.log('[diagnosticPlansService] intervention catalogue debug', {
    requestedCompanyCode: cleanCompanyCode,
    totalInterventions: allRows.length,
    matchedInterventions: rows.length,
    availableCompanyCodes: [...new Set(allRows.map((item) => String(item.companyCode || '(missing)').trim() || '(missing)'))].sort(),
    sample: allRows.slice(0, 10),
  })

  return rows.sort((a, b) => a.title.localeCompare(b.title))
}

export const saveDiagnosticPlan = async (
  user: FullIdentity,
  participant: DiagnosticPlanParticipant,
  interventions: DiagnosticPlanIntervention[],
) => {
  if (!hasRolePermission(user.role, 'manage_diagnostic_plans', user.permissions)) {
    throw new Error('forbidden')
  }

  const cleaned = cleanInterventions(interventions)
  const db = getFirebaseDb()
  const changed = JSON.stringify(cleaned) !== JSON.stringify(cleanInterventions(participant.plan.interventions))

  await setDoc(doc(db, 'diagnosticPlans', planIdFor(participant.applicationId)), {
    participantId: participant.id,
    applicationId: participant.applicationId,
    programId: participant.programId || null,
    companyCode: user.companyCode || null,
    status: participant.plan.status,
    interventions: cleaned,
    updatedAt: serverTimestamp(),
    updatedBy: {
      uid: user.uid,
      email: user.email,
    },
    ...(changed && participant.plan.status === 'Confirmed' ? {
      confirmedBy: { participant: deleteField(), incubatee: deleteField(), sme: deleteField() },
      confirmedMeta: { participant: deleteField(), incubatee: deleteField(), sme: deleteField() },
      amendedAt: serverTimestamp(),
    } : {}),
  }, { merge: true })
}

export const listDiagnosticInterventionRequests = async (participants: DiagnosticPlanParticipant[]) => {
  const participantIds = new Set(participants.map(item => item.id))
  const snapshot = await getDocs(collection(getFirebaseDb(), 'interventionRequests'))
  return snapshot.docs.flatMap(record => {
    const data = record.data()
    if (!participantIds.has(String(data.participantId || ''))) return []
    return [{ id: record.id, participantId: String(data.participantId), programId: data.programId ? String(data.programId) : undefined, interventionTitle: String(data.interventionTitle || 'Requested intervention'), areaOfSupport: String(data.areaOfSupport || 'General support'), reason: data.reason ? String(data.reason) : undefined, status: String(data.status || 'Pending') } satisfies DiagnosticInterventionRequest]
  })
}

export const acceptDiagnosticInterventionRequest = async (user: FullIdentity, participant: DiagnosticPlanParticipant, request: DiagnosticInterventionRequest) => {
  if (!hasRolePermission(user.role, 'manage_diagnostic_plans', user.permissions)) throw new Error('forbidden')
  const db = getFirebaseDb()
  const planRef = doc(db, 'diagnosticPlans', participant.applicationId)
  const planSnapshot = await getDoc(planRef)
  const existing = Array.isArray(planSnapshot.data()?.interventions) ? planSnapshot.data()!.interventions : participant.plan.interventions
  const definitions = await getDocs(collection(db, 'interventions'))
  const definition = definitions.docs.find(record => normalizeText(record.data().interventionTitle || record.data().title) === normalizeText(request.interventionTitle))
  if (!definition) throw new Error('requested-intervention-not-in-catalogue')
  const definitionData = definition.data()
  const requested = cleanInterventions([{ interventionId: definition.id, title: String(definitionData.interventionTitle || definitionData.title), areaOfSupport: definitionData.areaOfSupport ? String(definitionData.areaOfSupport) : undefined }])
  const merged = cleanInterventions([...existing, ...requested])
  await Promise.all([
    setDoc(planRef, {
      participantId: participant.id,
      applicationId: participant.applicationId,
      programId: participant.programId || null,
      companyCode: user.companyCode || null,
      interventions: merged,
      status: 'Confirmed',
      confirmedBy: { participant: deleteField(), incubatee: deleteField(), sme: deleteField() },
      confirmedMeta: { participant: deleteField(), incubatee: deleteField(), sme: deleteField() },
      updatedAt: serverTimestamp(),
      amendedAt: serverTimestamp(),
      amendedByUid: user.uid,
    }, { merge: true }),
    updateDoc(doc(db, 'interventionRequests', request.id), { status: 'Accepted', acceptedAt: serverTimestamp(), acceptedByUid: user.uid, diagnosticPlanId: participant.applicationId }),
  ])
}

export const confirmDiagnosticPlan = async (
  user: FullIdentity,
  participant: DiagnosticPlanParticipant,
  signatureURL?: string | null,
) => {
  if (!hasRolePermission(user.role, 'manage_diagnostic_plans', user.permissions)) {
    throw new Error('forbidden')
  }

  if (!signatureURL) throw new Error('missing-signature')

  const db = getFirebaseDb()

  const confirmation = {
    uid: user.uid,
    name: user.displayName || user.name || user.email,
    email: user.email,
    signatureURL,
    confirmedAt: new Date().toISOString(),
  }

  await setDoc(doc(db, 'diagnosticPlans', planIdFor(participant.applicationId)), {
    participantId: participant.id,
    applicationId: participant.applicationId,
    programId: participant.programId || null,
    companyCode: user.companyCode || null,
    status: 'Confirmed',
    confirmed: true,
    confirmedBy: {
      operations: confirmation,
    },
    confirmedMeta: {
      operations: confirmation,
    },
    confirmedAt: confirmation.confirmedAt,
    updatedAt: serverTimestamp(),
  }, { merge: true })
}
