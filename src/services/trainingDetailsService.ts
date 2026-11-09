import { doc, getDoc, setDoc, updateDoc, deleteField } from 'firebase/firestore'
import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import { COMPANY_DETAIL_FIELDS, LEARNER_DETAIL_FIELDS, toDetailsSettings, type TrainingDetailsSettings } from '@/config/trainingDetails'
import { canManageTraining, trainingCompanyOf } from '@/services/trainingService'
import type { FullIdentity } from '@/types/identity'
import type { TrainingDetails, TrainingOrgDocument, TrainingOrganisation } from '@/types/training'

/**
 * The details a training company asks of its client companies and learners (config/trainingDetails.ts), the
 * answers and the company documents.
 *
 * - What to ask: `trainingSettings/{company}`, chosen by the facilitator.
 * - A company's answers and documents: on its `trainingOrganisations` record, written by the company's own people
 *   (details and documents only) or the facilitator. Files sit under `training-org-documents/{company}/{organisation}/`
 *   and are read through the storage rules, never by a shareable link.
 * - A learner's answers: `details` on their learner record, written by the facilitator, the company that booked them
 *   or the learner themselves.
 */

const SETTINGS = 'trainingSettings'
const ORGANISATIONS = 'trainingOrganisations'
const LEARNERS = 'trainingLearners'

export const ORG_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png'
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const DOCUMENT_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png'])
const now = () => new Date().toISOString()

export const orgDocumentProblem = (file: File): 'type' | 'size' | null => {
    if (!DOCUMENT_TYPES.has(file.type)) return 'type'
    if (file.size > MAX_DOCUMENT_BYTES) return 'size'
    return null
}

const companyOf = (user: FullIdentity) => {
    const code = String(user.companyCode || '').trim()
    if (!code) throw new Error('forbidden')
    return code
}

export const getTrainingDetailsSettings = async (user: FullIdentity): Promise<TrainingDetailsSettings> => {
    const snapshot = await getDoc(doc(getFirebaseDb(), SETTINGS, companyOf(user))).catch(() => null)
    return toDetailsSettings(snapshot?.exists() ? snapshot.data() : null)
}

export const saveTrainingDetailsSettings = async (user: FullIdentity, settings: TrainingDetailsSettings) => {
    const companyCode = trainingCompanyOf(user)
    await setDoc(doc(getFirebaseDb(), SETTINGS, companyCode), { ...toDetailsSettings(settings as unknown as Record<string, unknown>), companyCode, updatedAt: now(), updatedBy: user.uid })
}

/** Only answers to known fields, as text or numbers. */
const cleanDetails = (details: TrainingDetails, catalogue: Array<{ key: string, kind: string }>): TrainingDetails => Object.fromEntries(catalogue.flatMap((field): Array<[string, string | number]> => {
    const value = details[field.key]
    if (value === undefined || value === null || String(value).trim() === '') return []
    if (['number', 'percent', 'money'].includes(field.kind)) {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? [[field.key, parsed]] : []
    }
    return [[field.key, String(value).trim().slice(0, 1000)]]
}))

/** The company's (or the facilitator's) answers. `submit` marks the company's details as sent the first time. */
export const saveOrganisationDetails = async (user: FullIdentity, organisation: TrainingOrganisation, details: TrainingDetails, submit: boolean) => {
    if (!canManageTraining(user) && !(user.role === 'clientorg' && user.organisationId === organisation.id)) throw new Error('forbidden')
    await updateDoc(doc(getFirebaseDb(), ORGANISATIONS, organisation.id), {
        details: cleanDetails(details, COMPANY_DETAIL_FIELDS),
        ...(submit && !organisation.detailsSubmittedAt ? { detailsSubmittedAt: now() } : {}),
        updatedAt: now(),
        updatedBy: user.uid,
    })
}

/** Uploads (or replaces) one of the company's documents. */
export const uploadOrganisationDocument = async (user: FullIdentity, organisation: TrainingOrganisation, key: string, file: File) => {
    if (!canManageTraining(user) && !(user.role === 'clientorg' && user.organisationId === organisation.id)) throw new Error('forbidden')
    const problem = orgDocumentProblem(file)
    if (problem) throw new Error(`document_${problem}`)
    const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'document'
    const storagePath = `training-org-documents/${organisation.companyCode}/${organisation.id}/${key}_${Date.now()}_${safeName}`
    await uploadBytes(ref(getFirebaseStorage(), storagePath), file, { contentType: file.type })
    const record: TrainingOrgDocument = { fileName: file.name, storagePath, contentType: file.type, uploadedAt: now(), uploadedBy: user.uid }
    await updateDoc(doc(getFirebaseDb(), ORGANISATIONS, organisation.id), { [`documents.${key}`]: record, updatedAt: now(), updatedBy: user.uid })
    const previous = organisation.documents[key]?.storagePath
    if (previous) await deleteObject(ref(getFirebaseStorage(), previous)).catch(() => undefined)
}

export const removeOrganisationDocument = async (user: FullIdentity, organisation: TrainingOrganisation, key: string) => {
    if (!canManageTraining(user) && !(user.role === 'clientorg' && user.organisationId === organisation.id)) throw new Error('forbidden')
    const previous = organisation.documents[key]?.storagePath
    await updateDoc(doc(getFirebaseDb(), ORGANISATIONS, organisation.id), { [`documents.${key}`]: deleteField(), updatedAt: now(), updatedBy: user.uid })
    if (previous) await deleteObject(ref(getFirebaseStorage(), previous)).catch(() => undefined)
}

/** Opens a document in a new tab from a short-lived local link. */
export const openOrganisationDocument = async (document: TrainingOrgDocument) => {
    const blob = await getBlob(ref(getFirebaseStorage(), document.storagePath))
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** A learner fills in the details asked of them on their training page. */
export const saveMyLearnerDetails = async (user: FullIdentity, learnerId: string, details: TrainingDetails) => {
    if (user.role !== 'learner') throw new Error('forbidden')
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learnerId), { details: cleanDetails(details, LEARNER_DETAIL_FIELDS), updatedAt: now() })
}

export const cleanLearnerDetails = (details: TrainingDetails) => cleanDetails(details, LEARNER_DETAIL_FIELDS)

/** How many of the asked details and documents a company has given. */
export const organisationCompleteness = (organisation: Pick<TrainingOrganisation, 'details' | 'documents'>, settings: TrainingDetailsSettings) => {
    const fields = settings.companyFields.filter((key) => organisation.details[key] !== undefined && organisation.details[key] !== '').length
    const documents = settings.companyDocuments.filter((key) => organisation.documents[key]).length
    return { fields, fieldsAsked: settings.companyFields.length, documents, documentsAsked: settings.companyDocuments.length, complete: fields === settings.companyFields.length && documents === settings.companyDocuments.length }
}
