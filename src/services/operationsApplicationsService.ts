import { collection, getDoc, getDocs, query, serverTimestamp, doc, where, writeBatch } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import type { FullIdentity } from '@/types/identity'
import type { OperationsApplication } from '@/types/operations'

const canView = (user: FullIdentity) => hasRolePermission(user.role, 'view_applications', user.permissions)
const canManage = (user: FullIdentity) => hasRolePermission(user.role, 'manage_applications', user.permissions)

export const listOperationsApplications = async (user: FullIdentity) => {
  if (!canView(user)) throw new Error('forbidden')
  const source = collection(getFirebaseDb(), 'applications')
  const snapshot = user.companyCode
    ? await getDocs(query(source, where('companyCode', '==', user.companyCode)))
    : await getDocs(source)

  return snapshot.docs.map((record) => {
    const data = record.data()
    const rawScore = data.aiScore ?? data.aiEvaluation?.['AI Score']
    const evaluation = data.aiEvaluation || {}

    return {
      id: record.id,
      businessName: data.businessName || data.participantName || 'Unnamed application',
      email: data.email || '',
      gender: data.gender,
      ageGroup: data.ageGroup,
      stage: data.stage,
      hub: data.hub,
      province: data.province,
      beeLevel: data.beeLevel || data.bbeeLevel,
      complianceScore: typeof data.complianceScore === 'number' ? data.complianceScore : undefined,
      programName: data.programName,
      companyCode: data.companyCode,
      applicationStatus: data.applicationStatus || 'Pending',
      aiScore: rawScore,
      aiRecommendation: evaluation['AI Recommendation'] || data.aiRecommendation,
      aiJustification: evaluation.Justification || data.aiJustification,
      supportFitStatus: data.supportFitStatus || data.decision?.supportFitStatus || data.aiResult?.decision?.supportFitStatus,
      unmatchedNeeds: data.unmatchedNeeds || data.decision?.unmatchedNeeds || data.aiResult?.decision?.unmatchedNeeds || [],
      externalInterventionSuggestions: data.externalInterventionSuggestions || data.decision?.externalInterventionSuggestions || data.aiResult?.decision?.externalInterventionSuggestions || [],
      motivation: data.motivation,
      challenges: data.challenges,
      submittedAt: data.submittedAt || data.createdAt,
      documents: data.complianceDocuments || [],
      growthPlanDocUrl: data.growthPlanDocUrl,
    } satisfies OperationsApplication
  })
}

export const updateOperationsApplicationStatus = async (
  user: FullIdentity,
  applicationId: string,
  applicationStatus: string,
) => {
  if (!canManage(user)) throw new Error('forbidden')
  const db = getFirebaseDb()
  const applicationRef = doc(db, 'applications', applicationId)
  const applicationSnapshot = await getDoc(applicationRef)
  if (!applicationSnapshot.exists()) throw new Error('application-not-found')
  const data = applicationSnapshot.data()
  const normalizedStatus = applicationStatus.charAt(0).toUpperCase() + applicationStatus.slice(1).toLowerCase()
  const batch = writeBatch(db)

  batch.update(applicationRef, {
    applicationStatus: normalizedStatus,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid,
  })

  if (normalizedStatus === 'Accepted') {
    const participantId = String(data.participantId || data.businessProfileId || data.uid || data.userId || data.applicantProfileId || '').trim()
    if (!participantId) throw new Error('application-participant-missing')
    batch.set(doc(db, 'participants', participantId), {
      uid: String(data.uid || data.userId || participantId),
      applicationId,
      applicantProfileId: String(data.applicantProfileId || data.uid || data.userId || participantId),
      businessProfileId: String(data.businessProfileId || participantId),
      participantName: data.participantName || null,
      businessName: data.businessName || null,
      email: data.email || null,
      phone: data.phone || null,
      programId: data.programId || null,
      programName: data.programName || null,
      companyCode: data.companyCode || user.companyCode || null,
      sector: data.sector || null,
      stage: data.stage || null,
      province: data.province || null,
      beeLevel: data.beeLevel || null,
      status: 'active',
      acceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
    }, { merge: true })
  }

  await batch.commit()
}
