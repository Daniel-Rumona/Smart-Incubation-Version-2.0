import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { getFirebaseDb } from '@/config/firebase'
import { catalogueEntryFor, loadProgramDocumentRequirements, requirementKeyFor } from '@/config/complianceDocuments'
import { complianceDocumentId, uploadComplianceFile } from '@/services/operationsComplianceService'
import { findParticipant } from '@/services/incubateeWorkspaceService'
import type { FullIdentity } from '@/types/identity'

/**
 * The SME's own compliance documents, read from and written to the same `complianceDocuments`
 * collection operations reviews. Older uploads kept in the application's `complianceDocuments`
 * array are still shown (read-only) until the SME replaces them, which moves them across.
 */

export type ComplianceDisplayStatus = 'missing' | 'pending' | 'valid' | 'queried' | 'expired'

export type MyComplianceDocument = {
    key: string
    name: string
    required: boolean
    status: ComplianceDisplayStatus
    expiringSoon: boolean
    comment: string
    url: string | null
    fileName: string | null
    issueDate: string | null
    expiryDate: string | null
    /** The `complianceDocuments` doc, when there is one (legacy array entries have none). */
    documentId: string | null
}

export type MyCompliance = {
    participantId: string | null
    programId: string | null
    companyCode: string | null
    documents: MyComplianceDocument[]
}

type Raw = Record<string, unknown>

const EXPIRING_SOON_DAYS = 30

const toDateString = (value: unknown): string | null => {
    if (!value) return null
    const candidate = typeof value === 'object' && value !== null && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : typeof value === 'object' && value !== null && typeof (value as { seconds?: unknown }).seconds === 'number'
            ? new Date((value as { seconds: number }).seconds * 1000)
            : value
    const parsed = dayjs(candidate as string | Date)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null
}

const millis = (value: unknown) => {
    if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis: unknown }).toMillis === 'function') {
        return (value as { toMillis: () => number }).toMillis()
    }
    const parsed = dayjs(value as string)
    return parsed.isValid() ? parsed.valueOf() : 0
}

/**
 * One status per document, in priority order, so every count and chart agrees: nothing on file is
 * missing; a past expiry date is expired; a fresh upload waits for review; then whatever operations decided.
 */
const displayStatus = (raw: Raw | undefined, expiryDate: string | null): ComplianceDisplayStatus => {
    const url = raw?.url || raw?.link || raw?.fileUrl
    const current = String(raw?.currentStatus || raw?.status || '').toLowerCase()
    const verification = String(raw?.verificationStatus || '').toLowerCase()
    if (!raw || !url || current === 'missing') return 'missing'
    if (current === 'expired' || (expiryDate && dayjs(expiryDate).isBefore(dayjs(), 'day'))) return 'expired'
    if (current === 'pending') return 'pending'
    if (current === 'valid' || current === 'approved' || verification === 'verified') return 'valid'
    if (['queried', 'invalid', 'rejected'].includes(current) || verification === 'queried') return 'queried'
    return 'pending'
}

const toDocument = (key: string, name: string, required: boolean, raw: Raw | undefined, documentId: string | null): MyComplianceDocument => {
    const expiryDate = toDateString(raw?.expiryDate)
    const status = displayStatus(raw, expiryDate)
    const daysLeft = expiryDate ? dayjs(expiryDate).diff(dayjs(), 'day') : null
    return {
        key,
        name,
        required,
        status,
        expiringSoon: status !== 'expired' && daysLeft !== null && daysLeft >= 0 && daysLeft <= EXPIRING_SOON_DAYS,
        comment: String(raw?.verificationComment || ''),
        url: String(raw?.url || raw?.link || raw?.fileUrl || '') || null,
        fileName: String(raw?.fileName || '') || null,
        issueDate: toDateString(raw?.issueDate),
        expiryDate,
        documentId,
    }
}

export const loadMyCompliance = async (user: FullIdentity): Promise<MyCompliance> => {
    const db = getFirebaseDb()
    const found = await findParticipant(user)
    // Some accepted SMEs have no participant record, only an accepted application keyed to their uid
    // (older or hand-made data). Treat the uid as their participant id, as the dashboard does.
    const ownAccepted = found ? null : (await getDocs(query(collection(db, 'applications'), where('participantId', '==', user.uid))))
        .docs.find((row) => String(row.data().applicationStatus || '').toLowerCase() === 'accepted')
    const participant = found || (ownAccepted ? { id: user.uid, programId: ownAccepted.data().programId, companyCode: ownAccepted.data().companyCode } : null)
    if (!participant) return { participantId: null, programId: null, companyCode: null, documents: [] }

    const participantId = participant.id
    const programId = String(participant.programId || '') || null
    const companyCode = String(user.companyCode || participant.companyCode || '') || null

    const [requirements, stored, applications] = await Promise.all([
        loadProgramDocumentRequirements(programId),
        getDocs(query(collection(db, 'complianceDocuments'), where('participantId', '==', participantId))),
        getDocs(query(collection(db, 'applications'), where('participantId', '==', participantId))),
    ])

    // Latest document per requirement for this programme (documents saved before programmes existed count too).
    const current = new Map<string, { id: string, data: Raw }>()
    stored.docs.forEach((row) => {
        const data = row.data() as Raw
        if (programId && data.programId && data.programId !== programId) return
        const key = requirementKeyFor(data.type || data.key || data.documentName)
        const existing = current.get(key)
        if (!existing || millis(data.updatedAt) >= millis(existing.data.updatedAt)) current.set(key, { id: row.id, data })
    })

    // Older uploads stored on the application itself; only used where the collection has nothing.
    const application = applications.docs.find((row) => String(row.data().applicationStatus || '').toLowerCase() === 'accepted') || applications.docs[0]
    const legacyRaw = application?.data().complianceDocuments
    const legacy = new Map<string, Raw>()
    ;(Array.isArray(legacyRaw) ? legacyRaw : Object.values(legacyRaw || {})).forEach((item) => {
        const data = item as Raw
        if (data?.type) legacy.set(requirementKeyFor(data.type), data)
    })

    const documents = requirements.map((requirement) => {
        const fromCollection = current.get(requirement.key)
        return fromCollection
            ? toDocument(requirement.key, requirement.name, requirement.required, fromCollection.data, fromCollection.id)
            : toDocument(requirement.key, requirement.name, requirement.required, legacy.get(requirement.key), null)
    })

    // Anything on file the programme does not ask for is still shown, as optional.
    const listed = new Set(requirements.map((requirement) => requirement.key))
    current.forEach((value, key) => {
        if (listed.has(key)) return
        const name = catalogueEntryFor(value.data.type)?.name || String(value.data.type || value.data.documentName || 'Document')
        documents.push(toDocument(key, name, false, value.data, value.id))
    })

    return { participantId, programId, companyCode, documents }
}

export type SaveMyComplianceDocument = {
    document: MyComplianceDocument
    file?: File | null
    issueDate?: string | null
    expiryDate?: string | null
}

/**
 * Uploads (or re-dates) one document. A new file goes back to "pending" for operations to review;
 * the verification fields themselves are left alone, as the security rules require.
 */
export const saveMyComplianceDocument = async (user: FullIdentity, context: MyCompliance, values: SaveMyComplianceDocument) => {
    if (!context.participantId) throw new Error('no-participant')
    const { document } = values
    const isNew = !document.documentId
    const documentId = document.documentId || complianceDocumentId(context.participantId, context.programId || undefined, document.name)
    const url = values.file ? await uploadComplianceFile(context.participantId, document.name, values.file) : null

    await setDoc(doc(getFirebaseDb(), 'complianceDocuments', documentId), {
        participantId: context.participantId,
        programId: context.programId,
        companyCode: context.companyCode,
        key: document.key,
        type: document.name,
        documentName: document.name,
        issueDate: values.issueDate ?? document.issueDate ?? null,
        expiryDate: values.expiryDate ?? document.expiryDate ?? null,
        updatedAt: serverTimestamp(),
        updatedBy: user.uid,
        ...(url && values.file ? { url, fileName: values.file.name, currentStatus: 'pending', uploadedBy: user.uid, uploadedAt: serverTimestamp() } : {}),
        // A legacy entry being moved across keeps its existing file until a new one is uploaded.
        ...(!url && isNew && document.url ? { url: document.url, fileName: document.fileName, currentStatus: 'pending' } : {}),
        ...(isNew ? { verificationStatus: 'pending', createdAt: serverTimestamp(), createdBy: user.uid } : {}),
    }, { merge: true })
}
