import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { listCollection } from '@/services/firestoreList'
import type { AssignedIntervention } from '@/types/interventions'
import type { FullIdentity } from '@/types/identity'

export const listAssignedInterventions = () =>
  listCollection<AssignedIntervention>('assignedInterventions')

export type InterventionAssignmentApplicationLookup = {
  id: string
  participantId?: string
  businessName?: string
  beneficiaryName?: string
  participantName?: string
  email?: string
  programId?: string
  programName?: string
  companyCode?: string
}

export const listInterventionAssignmentApplications = async (companyCode?: string) => {
  const source = collection(getFirebaseDb(), 'applications')
  const snapshot = companyCode
    ? await getDocs(query(source, where('companyCode', '==', companyCode)))
    : await getDocs(source)

  return snapshot.docs.map((document) => {
    const data = document.data()
    return {
      id: document.id,
      participantId: typeof data.participantId === 'string' ? data.participantId : undefined,
      businessName: data.businessName,
      beneficiaryName: data.beneficiaryName,
      participantName: data.participantName,
      email: data.email,
      programId: data.programId,
      programName: data.programName,
      companyCode: data.companyCode,
    } satisfies InterventionAssignmentApplicationLookup
  })
}

export type InterventionReminderTarget = {
  assignment: AssignedIntervention
  recipientRole: 'consultant' | 'operations' | 'projectadmin' | 'incubatee'
  reason: string
}

export const createInterventionReminder = async (
  user: FullIdentity | null | undefined,
  target: InterventionReminderTarget,
) => {
  const assignment = target.assignment as AssignedIntervention & Record<string, unknown>
  const title = String(assignment.interventionTitle || 'Intervention')
  const participantName = String(assignment.businessName || 'SME')
  const assigneeName = String(assignment.assigneeName || 'assignee')
  const message = `${title} needs attention: ${target.reason}`

  await addDoc(collection(getFirebaseDb(), 'notifications'), {
    companyCode: assignment.companyCode || user?.companyCode || null,
    participantId: assignment.participantId || null,
    interventionId: assignment.interventionId || assignment.id || null,
    interventionTitle: title,
    assignedInterventionId: assignment.id || null,
    type: 'intervention_reminder',
    recipientRoles: [target.recipientRole],
    message: {
      incubatee: message,
      consultant: `${title} for ${participantName} needs attention: ${target.reason}`,
      operations: `${title} assigned to ${assigneeName} needs attention: ${target.reason}`,
      projectadmin: `${title} assigned to ${assigneeName} needs attention: ${target.reason}`,
    },
    reminderReason: target.reason,
    createdAt: serverTimestamp(),
    createdByUid: user?.uid || null,
    createdByEmail: user?.email || null,
    readBy: {},
  })
}
