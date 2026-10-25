import { collection, getDocs, query, where } from 'firebase/firestore'
import type { DocumentData } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import type { FullIdentity } from '@/types/identity'
import type { ComplianceDocument } from '@/types/compliance'
import type { OperationsParticipant } from '@/types/operationsParticipant'

const normalizeStatus = (value?: string) => String(value || '').trim().toLowerCase()
const firstText = (...values: unknown[]) => values.find(value => typeof value === 'string' && value.trim()) as string | undefined

export const listOperationsParticipants = async (user: FullIdentity, activeProgramId?: string | null) => {
  if (!hasRolePermission(user.role, 'view_participants', user.permissions)) throw new Error('forbidden')
  const [participants, applications, timeline, programs, plans, completions] = await Promise.all([
    getDocs(collection(getFirebaseDb(), 'participants')),
    getDocs(user.companyCode ? query(collection(getFirebaseDb(), 'applications'), where('companyCode', '==', user.companyCode)) : collection(getFirebaseDb(), 'applications')),
    getDocs(collection(getFirebaseDb(), 'complianceDocuments')),
    getDocs(collection(getFirebaseDb(), 'programs')),
    getDocs(collection(getFirebaseDb(), 'diagnosticPlans')),
    getDocs(collection(getFirebaseDb(), 'interventionCompletions')),
  ])
  const applicationsById = new Map(applications.docs.map((row) => [row.id, row.data()]))
  const plansByApplicationId = new Map<string, Record<string, unknown>>()
  plans.docs.forEach((row) => {
    const data = row.data()
    plansByApplicationId.set(row.id, data)
    if (data.applicationId) plansByApplicationId.set(String(data.applicationId), data)
  })
  const programNames = new Map(programs.docs.map((row) => {
    const data = row.data()
    return [row.id, data.name || data.programName || data.title || row.id]
  }))
  const documents = timeline.docs.map((row) => ({ id: row.id, ...row.data() })) as ComplianceDocument[]
  const completedByParticipantId = new Map<string, number>()
  completions.docs.forEach((row) => {
    const participantId = String(row.data().participantId || '')
    if (!participantId) return
    completedByParticipantId.set(participantId, (completedByParticipantId.get(participantId) || 0) + 1)
  })

  const participantRows: Array<DocumentData & { id: string }> = participants.docs.map((row) => ({ id: row.id, ...row.data() }))
  const participantApplicationIds = new Set(participantRows.map((row) => String(row.applicationId || '')).filter(Boolean))

  applications.docs.forEach((applicationRow) => {
    const application = applicationRow.data()
    if (normalizeStatus(application.applicationStatus) !== 'accepted' || participantApplicationIds.has(applicationRow.id)) return
    const id = String(application.participantId || application.businessProfileId || application.uid || application.userId || application.applicantProfileId || '').trim()
    if (!id) return
    participantRows.push({ id, ...application, applicationId: applicationRow.id, status: 'active' })
    participantApplicationIds.add(applicationRow.id)
  })

  return participantRows.flatMap((participant) => {
    if (normalizeStatus(participant.status) === 'inactive') return []
    if (user.companyCode && participant.companyCode && participant.companyCode !== user.companyCode) return []
    if (!matchesActiveProgram(user, activeProgramId, participant.programId)) return []
    const application = participant.applicationId ? applicationsById.get(participant.applicationId) || {} : {}
    const participantProfile = typeof participant.profile === 'object' && participant.profile ? participant.profile : {}
    const applicationProfile = typeof application.profile === 'object' && application.profile ? application.profile : {}
    const businessProfile = typeof application.businessProfile === 'object' && application.businessProfile ? application.businessProfile : {}
    const plan = participant.applicationId ? plansByApplicationId.get(participant.applicationId) || {} : {}
    const interventions = Array.isArray(plan.interventions) ? plan.interventions : []
    return [{
      id: participant.id,
      applicationId: String(participant.applicationId || ''),
      businessName: firstText(participant.businessName, participant.beneficiaryName, participant.companyName, participant.enterpriseName, participant.legalName, participantProfile.businessName, application.businessName, application.beneficiaryName, application.companyName, application.enterpriseName, application.legalName, applicationProfile.businessName, businessProfile.businessName, businessProfile.companyName) || 'Unnamed SME',
      participantName: firstText(participant.participantName, participant.contactName, participant.ownerName, participant.name, participantProfile.participantName, participantProfile.contactName, application.participantName, application.contactName, application.ownerName, application.name, applicationProfile.participantName, applicationProfile.contactName, businessProfile.ownerName),
      email: participant.email || application.email,
      phone: participant.phone || application.phone,
      programId: participant.programId || application.programId,
      programName: programNames.get(participant.programId || application.programId) || application.programName,
      sector: participant.sector || application.sector,
      stage: participant.stage || application.stage,
      province: participant.province || application.province,
      beeLevel: participant.beeLevel || application.beeLevel,
      applicationStatus: application.applicationStatus || 'Accepted',
      documents: documents.filter((document) => document.participantId === participant.id && (!participant.programId || document.programId === participant.programId)),
      requiredInterventions: interventions.length,
      completedInterventions: completedByParticipantId.get(participant.id) || 0,
    } satisfies OperationsParticipant]
  })
}
