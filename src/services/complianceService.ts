import { collection, getDocs } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { COMPLIANCE_DOCUMENT_CATALOGUE, programDocumentRequirements, requirementKeyFor } from '@/config/complianceDocuments'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'

type ListComplianceRowsOptions = {
  activeProgramId?: string | null
  departmentId?: string | null
  user?: FullIdentity | null
}

type TimelineRow = {
  id: string
  participantId?: string
  programId?: string | null
  departmentId?: string | null
  key?: string
  type?: string
  currentStatus?: string
  issueDate?: string
  expiryDate?: string
  fileName?: string
  url?: string
  updatedAt?: unknown
  createdAt?: unknown
}

// Every document type the platform knows about (src/config/complianceDocuments.ts). What a given SME
// must provide depends on their programme: see programDocumentRequirements.
export const COMPLIANCE_DOCUMENT_TYPES = COMPLIANCE_DOCUMENT_CATALOGUE.map((entry) => entry.name)

export const listComplianceRows = async ({
  activeProgramId,
  departmentId,
  user,
}: ListComplianceRowsOptions = {}) => {
  const [applications, timeline, programs] = await Promise.all([
    getDocs(collection(getFirebaseDb(), 'participants')),
    getDocs(collection(getFirebaseDb(), 'complianceDocuments')),
    getDocs(collection(getFirebaseDb(), 'programs')),
  ])
  // Each programme chooses its own required documents; without a programme, the whole catalogue applies.
  const requirementsByProgram = new Map(programs.docs.map((program) => [program.id, programDocumentRequirements(program.data().complianceRequirements)]))
  const timelineRows = timeline.docs.map((row) => ({ id: row.id, ...row.data() })) as TimelineRow[]

  return {
    rows: applications.docs.flatMap((row) => {
      const participant = row.data()
      const participantId = row.id
      if (user?.companyCode && participant.companyCode && participant.companyCode !== user.companyCode) return []
      if (!matchesActiveProgram(user, activeProgramId, participant.programId)) return []
      if (departmentId && participant.departmentId !== departmentId) return []
      const documents = timelineRows
        .filter((document) => document.participantId === participantId && (!participant.programId || document.programId === participant.programId))
        .map((document) => ({
          ...document,
          key: requirementKeyFor(document.type || document.key),
          type: document.type || document.key || 'Document',
          currentStatus: document.currentStatus || 'pending',
          currentFile: {
            fileName: document.fileName || null,
            url: document.url || null,
            issueDate: document.issueDate || null,
            expiryDate: document.expiryDate || null,
          },
        }))
      return [{
        id: row.id,
        ...participant,
        participantId,
        documents,
        required: (requirementsByProgram.get(String(participant.programId || '')) || programDocumentRequirements(null)).filter((requirement) => requirement.required).map((requirement) => ({
          id: requirement.key,
          key: requirement.key,
          title: requirement.name,
          type: 'upload',
          requiredAt: 'program',
          hasExpiry: false,
        })),
      }]
    }),
  }
}
