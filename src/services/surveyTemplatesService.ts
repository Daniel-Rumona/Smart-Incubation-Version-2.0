import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import type { PrefillKey } from '@/lib/surveyPrefill'

export type SurveyFieldType =
    | 'text'
    | 'textarea'
    | 'number'
    | 'email'
    | 'select'
    | 'checkbox'
    | 'radio'
    | 'date'
    | 'file'
    | 'rating'
    | 'heading'

export type SurveyField = {
    id: string
    type: SurveyFieldType
    label: string
    name?: string
    placeholder?: string
    required: boolean
    options?: string[]
    description?: string
    /**
     * Set when the answer comes from the SME's own record. The builder shows the
     * question but does not let it be reworded; see src/lib/surveyPrefill.ts.
     */
    prefill?: PrefillKey
}

export type SurveyTemplate = {
    id?: string
    title: string
    description: string
    fields: SurveyField[]
    status: 'draft' | 'published'
    category: string
    programId?: string
    department?: string
    /** Set on gap analyses, which are listed per company; older surveys have none. */
    companyCode?: string
    createdAt: string
    updatedAt: string
    createdBy?: string
}

export const SURVEY_CATEGORIES = ['Evaluation Form', 'Feedback Form', 'Assessment'] as const

/**
 * Gap analyses are surveys too (same builder, assignments and SME response page), but they are
 * set up and reviewed on their own page, so the surveys list leaves this category out.
 */
export const GAP_ANALYSIS_CATEGORY = 'Gap Analysis'
export const isGapAnalysis = (template: Pick<SurveyTemplate, 'category'>) => template.category === GAP_ANALYSIS_CATEGORY

export const SURVEY_FIELD_TYPES: Array<{ value: SurveyFieldType, label: string }> = [
    { value: 'text', label: 'Text field' },
    { value: 'textarea', label: 'Text area' },
    { value: 'number', label: 'Number' },
    { value: 'email', label: 'Email' },
    { value: 'select', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox group' },
    { value: 'radio', label: 'Radio group' },
    { value: 'date', label: 'Date picker' },
    { value: 'file', label: 'File upload' },
    { value: 'rating', label: 'Rating' },
    { value: 'heading', label: 'Section heading' },
]

const COLLECTION = 'formTemplates'
const ASSIGNMENTS = 'formAssignments'

export const generateFieldId = () => Math.random().toString(36).slice(2, 9)

export const sanitizeFieldName = (value: string) => (value || 'field')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

/** Firestore rejects undefined, and a builder legitimately leaves optional settings empty. */
const pruneUndefined = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map(pruneUndefined) as unknown as T
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .map(([key, item]) => [key, pruneUndefined(item)]),
        ) as T
    }
    return value
}

/** Older documents may have stored fields as a map; the builder always works with an array. */
export const toFieldsArray = (value: unknown): SurveyField[] => {
    if (!value) return []
    if (Array.isArray(value)) return value as SurveyField[]
    if (typeof value === 'object') return Object.values(value as Record<string, SurveyField>)
    return []
}

const withGeneratedNames = (template: SurveyTemplate): SurveyTemplate => ({
    ...template,
    fields: template.fields.map((field, index) => ({
        ...field,
        name: field.name?.length ? field.name : sanitizeFieldName(field.label || `field_${index + 1}`),
    })),
})

export const listSurveyTemplates = async (programId?: string): Promise<SurveyTemplate[]> => {
    const db = getFirebaseDb()
    const snapshot = programId
        ? await getDocs(query(collection(db, COLLECTION), where('programId', '==', programId)))
        : await getDocs(collection(db, COLLECTION))

    return snapshot.docs
        .map((row) => {
            const data = row.data() as SurveyTemplate
            return { ...data, id: row.id, fields: toFieldsArray(data.fields) }
        })
        .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
}

export const loadSurveyTemplate = async (templateId: string): Promise<SurveyTemplate | null> => {
    const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTION, templateId))
    if (!snapshot.exists()) return null
    const data = snapshot.data() as SurveyTemplate
    return { ...data, id: templateId, fields: toFieldsArray(data.fields) }
}

export const saveSurveyTemplate = async (
    template: SurveyTemplate,
    user?: FullIdentity | null,
): Promise<string> => {
    const db = getFirebaseDb()
    const payload = pruneUndefined(withGeneratedNames({
        ...template,
        department: template.department ?? user?.departmentId ?? undefined,
        createdBy: template.createdBy ?? user?.uid,
        updatedAt: new Date().toISOString(),
    }))

    if (template.id) {
        await updateDoc(doc(db, COLLECTION, template.id), payload as Record<string, unknown>)
        return template.id
    }

    const created = await addDoc(collection(db, COLLECTION), payload as Record<string, unknown>)
    return created.id
}

export const deleteSurveyTemplate = async (templateId: string) => {
    await deleteDoc(doc(getFirebaseDb(), COLLECTION, templateId))
}

/**
 * Publishing hands the survey to the programme's SMEs. Everything downstream —
 * the incubatee dashboard's form count, the SME survey list, operations
 * tracking — reads `formAssignments`, so a published template has to fan out
 * into one assignment per accepted participant. Re-publishing is safe: anyone
 * who already has this survey is skipped.
 */
export const assignSurveyToProgramme = async (template: SurveyTemplate): Promise<number> => {
    if (!template.id || !template.programId) return 0

    const db = getFirebaseDb()
    const [applications, existing] = await Promise.all([
        getDocs(query(collection(db, 'applications'), where('programId', '==', template.programId))),
        getDocs(query(collection(db, ASSIGNMENTS), where('templateId', '==', template.id))),
    ])

    const alreadyAssigned = new Set(existing.docs.map((row) => String((row.data() as Record<string, unknown>).participantId || '')))

    const participantIds = [...new Set(applications.docs
        .map((row) => row.data() as Record<string, unknown>)
        .filter((row) => String(row.applicationStatus || '').trim().toLowerCase() === 'accepted')
        .map((row) => String(row.participantId || row.uid || row.userId || '').trim())
        .filter(Boolean))]
        .filter((participantId) => !alreadyAssigned.has(participantId))

    if (!participantIds.length) return 0

    const now = new Date().toISOString()
    const batch = writeBatch(db)

    participantIds.forEach((participantId) => {
        batch.set(doc(collection(db, ASSIGNMENTS)), {
            templateId: template.id,
            templateTitle: template.title,
            category: template.category,
            participantId,
            programId: template.programId,
            status: 'assigned',
            createdAt: now,
            updatedAt: now,
        })
    })

    await batch.commit()
    return participantIds.length
}

/**
 * Hand-picked distribution, alongside `assignSurveyToProgramme`'s automatic
 * fan-out on publish. Lets operations reach someone outside the normal
 * programme audience (or re-send to a subset) without waiting for a new
 * publish. Skips anyone who already has this survey.
 */
export const sendSurveyToParticipants = async (
    template: SurveyTemplate,
    participantIds: string[],
): Promise<number> => {
    if (!template.id || !participantIds.length) return 0

    const db = getFirebaseDb()
    const existing = await getDocs(query(collection(db, ASSIGNMENTS), where('templateId', '==', template.id)))
    const alreadyAssigned = new Set(existing.docs.map((row) => String((row.data() as Record<string, unknown>).participantId || '')))

    const targetIds = [...new Set(participantIds)].filter((participantId) => !alreadyAssigned.has(participantId))
    if (!targetIds.length) return 0

    const now = new Date().toISOString()
    const batch = writeBatch(db)

    targetIds.forEach((participantId) => {
        batch.set(doc(collection(db, ASSIGNMENTS)), {
            templateId: template.id,
            templateTitle: template.title,
            category: template.category,
            participantId,
            programId: template.programId,
            status: 'assigned',
            createdAt: now,
            updatedAt: now,
        })
    })

    await batch.commit()
    return targetIds.length
}
