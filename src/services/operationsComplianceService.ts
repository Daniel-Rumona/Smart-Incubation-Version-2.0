import { collection, deleteDoc, doc, getDocs, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import { programDocumentRequirements } from '@/config/complianceDocuments'
import { hasRolePermission } from '@/config/permissions'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'
import type { ComplianceDocument, ComplianceParticipant, ComplianceVerification, SaveComplianceDocument } from '@/types/compliance'

const cleanKey = (value?: string) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const assertPermission = (user: FullIdentity, permission: 'view_compliance' | 'manage_compliance') => {
  if (!hasRolePermission(user.role, permission, user.permissions)) throw new Error('forbidden')
}
export const complianceDocumentId = (participantId: string, programId: string | undefined, type: string) =>
  [cleanKey(participantId), cleanKey(programId || 'unassigned'), cleanKey(type)].join('__')

export const listComplianceParticipants = async (user: FullIdentity, activeProgramId?: string | null) => {
  assertPermission(user, 'view_compliance')
  const [applications, timeline, programs] = await Promise.all([
    getDocs(collection(getFirebaseDb(), 'participants')),
    getDocs(collection(getFirebaseDb(), 'complianceDocuments')),
    getDocs(collection(getFirebaseDb(), 'programs')),
  ])
  const requirementsByProgram = new Map(programs.docs.map((program) => [program.id, programDocumentRequirements(program.data().complianceRequirements)]))
  const documents = timeline.docs.map((row) => ({ id: row.id, ...row.data() })) as ComplianceDocument[]
  const documentsByParticipant = new Map<string, ComplianceDocument[]>()
  documents.forEach((document) => {
    if (user.companyCode && document.companyCode && document.companyCode !== user.companyCode) return
    if (!matchesActiveProgram(user, activeProgramId, document.programId)) return
    const list = documentsByParticipant.get(document.participantId) || []
    list.push(document)
    documentsByParticipant.set(document.participantId, list)
  })
  return applications.docs.flatMap((row) => {
    const data = row.data()
    const participantId = String(data.participantId || data.uid || row.id)
    if (user.companyCode && data.companyCode && data.companyCode !== user.companyCode) return []
    if (!matchesActiveProgram(user, activeProgramId, data.programId)) return []
    return [{
      id: row.id,
      participantId,
      businessName: data.businessName || data.participantName || 'Unnamed participant',
      email: data.email,
      phone: data.phone,
      programId: data.programId,
      companyCode: data.companyCode,
      documents: documentsByParticipant.get(participantId) || [],
      requirements: requirementsByProgram.get(String(data.programId || '')) || programDocumentRequirements(null),
    } satisfies ComplianceParticipant]
  })
}

export const saveComplianceDocument = async (user: FullIdentity, values: SaveComplianceDocument, previousId?: string) => {
  assertPermission(user, 'manage_compliance')
  const db = getFirebaseDb()
  const targetId = complianceDocumentId(values.participantId, values.programId, values.type)
  const target = doc(db, 'complianceDocuments', targetId)
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(target)
    if (existing.exists() && previousId !== targetId) throw new Error('duplicate-document-type')
    transaction.set(target, {
      ...values,
      key: cleanKey(values.type),
      verificationStatus: 'pending',
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      ...(existing.exists() ? {} : { createdAt: serverTimestamp(), createdBy: user.uid }),
    }, { merge: true })
    if (previousId && previousId !== targetId) transaction.delete(doc(db, 'complianceDocuments', previousId))
  })
}

export const verifyComplianceDocument = async (user: FullIdentity, id: string, verificationStatus: ComplianceVerification, comment?: string) => {
  assertPermission(user, 'manage_compliance')
  await updateDoc(doc(getFirebaseDb(), 'complianceDocuments', id), {
    verificationStatus,
    verificationComment: comment || '',
    currentStatus: verificationStatus === 'verified' ? 'valid' : 'queried',
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })
}

export const removeComplianceDocument = async (user: FullIdentity, id: string) => {
  assertPermission(user, 'manage_compliance')
  await deleteDoc(doc(getFirebaseDb(), 'complianceDocuments', id))
}

export const uploadComplianceFile = async (participantId: string, type: string, file: File) => {
  const fileRef = ref(getFirebaseStorage(), `compliance/${cleanKey(participantId)}/${cleanKey(type)}/${Date.now()}-${file.name}`)
  await uploadBytes(fileRef, file)
  return getDownloadURL(fileRef)
}

export type ComplianceScanResult = {
  updated: boolean
  totals: {
    participants: number
    documents: number
    missing: number
    pending: number
    problem: number
    averageScore: number
  }
}

export const scanComplianceDocuments = async (options: {
  participantId?: string
  programId?: string | null
  updateDatabase?: boolean
} = {}) => {
  if (!isAgentApiConfigured) {
    throw new Error('agent-api-not-configured')
  }

  const response = await fetch(`${agentApiBaseUrl}/api/compliance/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      participantId: options.participantId,
      programId: options.programId && options.programId !== 'all' ? options.programId : undefined,
      updateDatabase: options.updateDatabase ?? true,
    }),
  })

  if (!response.ok) {
    throw new Error('compliance-scan-failed')
  }

  return response.json() as Promise<ComplianceScanResult>
}
