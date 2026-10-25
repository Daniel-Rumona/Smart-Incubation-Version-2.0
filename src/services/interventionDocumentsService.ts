import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import type { FullIdentity } from '@/types/identity'

export type InterventionDocument = {
  id: string
  assignmentId: string
  participantId: string
  participantName: string
  interventionId: string
  interventionTitle: string
  programId?: string
  programName?: string
  fileName: string
  fileUrl: string
  contentType?: string
  agentName?: string
  sha256?: string
  signature?: string
  signatureAlgorithm?: string
  provenanceStatus?: 'signed' | 'legacy_unsigned'
  createdAt?: unknown
}

export type DocumentVerificationResult = {
  status: 'verified' | 'altered' | 'unsigned' | 'unavailable'
  sha256?: string
  message: string
}

const sha256Hex = async (blob: Blob) => {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
}

const participantIdsFor = async (user: FullIdentity) => {
  const ids = new Set([user.uid])
  const db = getFirebaseDb()
  const direct = await getDoc(doc(db, 'participants', user.uid))
  if (direct.exists()) ids.add(direct.id)
  if (user.email) {
    const byEmail = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email)))
    byEmail.docs.forEach(record => ids.add(record.id))
  }
  return [...ids]
}

/** Whether an SME has any intervention documents yet (used to show the library only once there is something in it). */
export const hasOwnInterventionDocuments = async (user: FullIdentity) => {
  const db = getFirebaseDb()
  for (const participantId of await participantIdsFor(user)) {
    const snapshot = await getDocs(query(collection(db, 'interventionDocuments'), where('participantId', '==', participantId), limit(1)))
    if (!snapshot.empty) return true
  }
  return false
}

export const listInterventionDocuments = async (user: FullIdentity): Promise<InterventionDocument[]> => {
  const db = getFirebaseDb()
  const operational = ['operations', 'projectadmin'].includes(user.role)
  const snapshots = operational
    ? [await getDocs(query(collection(db, 'interventionDocuments'), where('companyCode', '==', user.companyCode || '')))]
    : await Promise.all((await participantIdsFor(user)).map(participantId =>
        getDocs(query(collection(db, 'interventionDocuments'), where('participantId', '==', participantId))),
      ))

  const records = new Map<string, InterventionDocument>()
  snapshots.forEach(snapshot => snapshot.docs.forEach(record => {
    const data = record.data()
    if (!data.fileUrl || data.isFinal === false || data.status === 'preview' || data.status === 'draft') return
    records.set(record.id, {
      id: record.id,
      assignmentId: String(data.assignmentId || ''),
      participantId: String(data.participantId || ''),
      participantName: String(data.participantName || data.businessName || 'SME'),
      interventionId: String(data.interventionId || ''),
      interventionTitle: String(data.interventionTitle || 'Intervention document'),
      programId: data.programId ? String(data.programId) : undefined,
      programName: data.programName ? String(data.programName) : undefined,
      fileName: String(data.fileName || 'Document'),
      fileUrl: String(data.fileUrl),
      contentType: data.contentType ? String(data.contentType) : undefined,
      agentName: data.agentName ? String(data.agentName) : undefined,
      sha256: data.sha256 ? String(data.sha256).toLowerCase() : undefined,
      signature: data.signature ? String(data.signature).toLowerCase() : undefined,
      signatureAlgorithm: data.signatureAlgorithm ? String(data.signatureAlgorithm) : undefined,
      provenanceStatus: data.provenanceStatus === 'signed' ? 'signed' : 'legacy_unsigned',
      createdAt: data.createdAt,
    })
  }))
  return [...records.values()]
}

export const verifyInterventionDocument = async (document: InterventionDocument): Promise<DocumentVerificationResult> => {
  if (!document.sha256) return { status: 'unsigned', message: 'This legacy document has no registered fingerprint.' }
  const response = await fetch(document.fileUrl)
  if (!response.ok) return { status: 'unavailable', message: 'The stored document could not be read for verification.' }
  const actualHash = await sha256Hex(await response.blob())
  if (actualHash !== document.sha256) return { status: 'altered', sha256: actualHash, message: 'The stored file does not match its registered fingerprint.' }
  if (!document.signature) return { status: 'unsigned', sha256: actualHash, message: 'The file is unchanged, but it predates signed system provenance.' }
  if (!isAgentApiConfigured) return { status: 'unavailable', sha256: actualHash, message: 'The signature-verification service is not configured.' }
  let verification: Response
  try {
    verification = await fetch(`${agentApiBaseUrl}/api/document-verification/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
      body: JSON.stringify({ sha256: actualHash, signature: document.signature }),
    })
  } catch {
    return { status: 'unavailable', sha256: actualHash, message: 'You must be signed in to verify this document.' }
  }
  if (!verification.ok) return { status: 'unavailable', sha256: actualHash, message: 'The signature service could not verify this document.' }
  const result = await verification.json() as { authentic?: boolean }
  return result.authentic
    ? { status: 'verified', sha256: actualHash, message: 'Authentic system-generated document. The stored file is unchanged.' }
    : { status: 'altered', sha256: actualHash, message: 'The fingerprint matches, but the system signature is invalid.' }
}
