import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseStorage } from '@/config/firebase'
import type { TrainingIdDocument, TrainingLearner } from '@/types/training'

/**
 * Copies of learners' ID documents. The file sits under `training-id-documents/{company}/{learner}/` and only its
 * path is recorded; it is always fetched through the storage rules (getBlob), never through a shareable download
 * link, so a copy cannot leak by forwarding a URL. See smartv2-agent-docs/13-awareness-training-module.md for the
 * storage rule and the bucket CORS setting this needs.
 */

export const ID_DOCUMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp'
export const MAX_ID_DOCUMENT_BYTES = 10 * 1024 * 1024
const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

export const idDocumentProblem = (file: File): 'type' | 'size' | null => {
    if (!ALLOWED_TYPES.has(file.type)) return 'type'
    if (file.size > MAX_ID_DOCUMENT_BYTES) return 'size'
    return null
}

/** Uploads the file and returns the record to store on the learner. */
export const uploadIdDocumentFile = async (
    learner: Pick<TrainingLearner, 'id' | 'companyCode'>,
    file: File,
    uploadedBy: TrainingIdDocument['uploadedBy'],
): Promise<TrainingIdDocument> => {
    const problem = idDocumentProblem(file)
    if (problem) throw new Error(`id_document_${problem}`)
    const safeName = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'id-document'
    const storagePath = `training-id-documents/${learner.companyCode}/${learner.id}/${Date.now()}_${safeName}`
    await uploadBytes(ref(getFirebaseStorage(), storagePath), file, { contentType: file.type })
    return {
        fileName: file.name,
        storagePath,
        contentType: file.type,
        uploadedAt: new Date().toISOString(),
        uploadedBy,
        status: 'pending',
    }
}

/** A replaced or removed copy is deleted rather than left behind (POPIA: keep personal information only as long as needed). */
export const deleteIdDocumentFile = (storagePath: string) => deleteObject(ref(getFirebaseStorage(), storagePath))

/** Opens the copy in a new tab from a short-lived local link. */
export const openIdDocument = async (document: Pick<TrainingIdDocument, 'storagePath'>) => {
    const blob = await getBlob(ref(getFirebaseStorage(), document.storagePath))
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
