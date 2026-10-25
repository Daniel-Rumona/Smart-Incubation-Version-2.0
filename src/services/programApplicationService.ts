import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import type {
  ProgramDocumentRequirement,
  ProgramIntervention,
  ProgramInterventionGroup,
  ProgramInterventionPolicy,
  ProgramQuestion,
} from '@/types/application'

const DEFAULT_ALLOWED_FORMATS = ['pdf', 'jpg', 'jpeg', 'png']

const EXPIRY_DOCUMENT_KEYWORDS = [
  'tax',
  'bee',
  'b-bbee',
  'bbbee',
  'certificate',
  'pin',
  'clearance',
  'statement',
  'statements',
]

export const DEFAULT_INTERVENTION_POLICY: ProgramInterventionPolicy = {
  mode: 'sme_choice',
  sourceScope: 'none',
  forcedInterventionIds: [],
  forcedInterventions: [],
  allowSmeSelection: true,
  maxSelections: null,
}

export function shouldRequireExpiry(name: string, category?: string) {
  const value = `${name || ''} ${category || ''}`.toLowerCase()
  return EXPIRY_DOCUMENT_KEYWORDS.some((keyword) => value.includes(keyword))
}

function normalizeOptions(options: unknown): string[] | undefined {
  if (Array.isArray(options)) return options.map(String).filter(Boolean)
  if (typeof options === 'string') {
    return options
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return undefined
}

export async function getProgramApplicationSetup(programId?: string | null) {
  if (!programId) {
    return {
      program: null,
      programQuestions: [] as ProgramQuestion[],
      interventionPolicy: DEFAULT_INTERVENTION_POLICY,
    }
  }

  const snap = await getDoc(doc(db, 'programs', programId))
  if (!snap.exists()) {
    return {
      program: null,
      programQuestions: [] as ProgramQuestion[],
      interventionPolicy: DEFAULT_INTERVENTION_POLICY,
    }
  }

  const data = snap.data() as Record<string, unknown>
  const rawQuestions = Array.isArray(data.onboardingQuestions) ? data.onboardingQuestions : []

  const programQuestions: ProgramQuestion[] = rawQuestions
    .map((value: unknown, index: number) => {
      const item = value && typeof value === 'object' ? value as Record<string, unknown> : {}
      return {
        id: String(item.id || `question-${index}`),
        label: String(item.question || `Question ${index + 1}`),
        type: String(item.type || 'text') as ProgramQuestion['type'],
        options: normalizeOptions(item.options),
        required: item.required !== false,
        placeholder: typeof item.placeholder === 'string' ? item.placeholder : undefined,
        maxSelections: Number(item.maxSelections || 0) || undefined,
      }
    })
    .filter((item) => item.id && item.label)

  return {
    program: { id: snap.id, ...data },
    programQuestions,
    interventionPolicy: (data.interventionPolicy as ProgramInterventionPolicy) || DEFAULT_INTERVENTION_POLICY,
  }
}

export async function listProgramDocumentRequirements(programId?: string | null): Promise<ProgramDocumentRequirement[]> {
  if (!programId) return []
  const programSnap = await getDoc(doc(db, 'programs', programId))
  if (!programSnap.exists()) return []
  const data = programSnap.data()
  const requirements = Array.isArray(data.complianceRequirements)
    ? data.complianceRequirements.flatMap((item: Record<string, unknown>) => {
        const name = String(item.name || '').trim()
        if (!name) return []
        return [{
          id: String(item.id || name),
          name,
          description: '',
          category: String(item.category || 'other'),
          requirementType: 'program' as const,
          isRequired: item.required !== false,
          allowedFormats: DEFAULT_ALLOWED_FORMATS,
          maxSizeMB: 10,
          isActive: true,
        }]
      })
    : []

  return requirements.map((item) => ({
    requirementId: item.id,
    type: item.name,
    description: item.description,
    category: item.category,
    requirementType: item.requirementType,
    isRequired: item.isRequired,
    allowedFormats: item.allowedFormats,
    maxSizeMB: item.maxSizeMB,
    requiresExpiry: shouldRequireExpiry(item.name, item.category),
    file: null,
    expiryDate: null,
    status: 'missing',
  }))
}

export async function listSelectableInterventionGroups(args: {
  programId?: string | null
  companyCode?: string | null
  interventionPolicy?: ProgramInterventionPolicy
}): Promise<ProgramInterventionGroup[]> {
  const { programId, companyCode, interventionPolicy } = args
  const forced = interventionPolicy?.mode === 'force_all' || interventionPolicy?.allowSmeSelection === false
  if (forced || !companyCode) return []

  const interventionsSnap = await getDocs(query(collection(db, 'interventions'), where('companyCode', '==', companyCode)))

  const rawInterventions: ProgramIntervention[] = interventionsSnap.docs
    .map((item) => {
      const data = item.data() as Record<string, unknown>
      const scopeType = String(data.scopeType || 'company').toLowerCase() as 'company' | 'program'
      return {
        id: item.id,
        title: String(data.interventionTitle || 'Untitled intervention'),
        area: String(data.areaOfSupport || 'General'),
        scopeType,
        programId: data.programId ? String(data.programId) : null,
      }
    })
    .filter((item) => {
      if (item.scopeType === 'company') return true
      if (item.scopeType === 'program') return item.programId === programId
      return false
    })

  const areaMap: Record<string, ProgramIntervention[]> = {}
  rawInterventions.forEach((intervention) => {
    const area = intervention.area || 'General'
    if (!areaMap[area]) areaMap[area] = []
    areaMap[area].push(intervention)
  })

  return Object.entries(areaMap).map(([area, interventions]) => ({ area, interventions }))
}
