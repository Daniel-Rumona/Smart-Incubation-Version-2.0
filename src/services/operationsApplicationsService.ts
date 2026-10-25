import { collection, documentId, getDoc, getDocs, query, serverTimestamp, doc, where, writeBatch } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { hasRolePermission } from '@/config/permissions'
import type { FullIdentity } from '@/types/identity'
import type { OperationsApplication } from '@/types/operations'

const canView = (user: FullIdentity) => hasRolePermission(user.role, 'view_applications', user.permissions)
const canManage = (user: FullIdentity) => hasRolePermission(user.role, 'manage_applications', user.permissions)

const chunk = <T,>(items: T[], size = 30) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size))
const text = (value: unknown) => String(value || '').trim()

const loadImages = async (collectionName: string, ids: string[], field: string) => {
  const images = new Map<string, string>()
  if (!ids.length) return images
  const db = getFirebaseDb()
  try {
    const snaps = await Promise.all(chunk(ids).map((part) => getDocs(query(collection(db, collectionName), where(documentId(), 'in', part)))))
    snaps.forEach((snap) => snap.docs.forEach((record) => { const url = text(record.data()[field]); if (url) images.set(record.id, url) }))
  } catch {
    // images are cosmetic; fall back to initials
  }
  return images
}

export const listOperationsApplications = async (user: FullIdentity) => {
  if (!canView(user)) throw new Error('forbidden')
  const source = collection(getFirebaseDb(), 'applications')
  const snapshot = user.companyCode
    ? await getDocs(query(source, where('companyCode', '==', user.companyCode)))
    : await getDocs(source)

  const participantIdOf = (data: Record<string, unknown>) => text(data.participantId || data.businessProfileId || data.uid || data.userId || data.applicantProfileId)
  const participantIds = [...new Set(snapshot.docs.map((record) => participantIdOf(record.data())).filter(Boolean))]
  const profileIds = [...new Set(snapshot.docs.map((record) => text(record.data().applicantProfileId || record.data().uid || record.data().userId)).filter(Boolean))]
  const [participantImages, businessImages, applicantImages, complianceSnap] = await Promise.all([
    loadImages('participants', participantIds, 'profileImageUrl'),
    loadImages('businessProfiles', participantIds, 'logoUrl'),
    loadImages('applicantProfiles', profileIds, 'profileImageUrl'),
    getDocs(collection(getFirebaseDb(), 'complianceDocuments')).catch(() => undefined),
  ])
  const complianceByParticipant = new Map<string, Array<{ type?: string, url?: string }>>()
  complianceSnap?.docs.forEach((record) => {
    const row = record.data()
    const key = text(row.participantId)
    if (!key) return
    const list = complianceByParticipant.get(key) || []
    list.push({ type: row.type || row.key, url: row.url || undefined })
    complianceByParticipant.set(key, list)
  })

  return snapshot.docs.map((record) => {
    const data = record.data()
    const participantId = participantIdOf(data)
    const embedded = Array.isArray(data.complianceDocuments) ? data.complianceDocuments.filter((item: { url?: string }) => item?.url) : []
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
      imageUrl: participantImages.get(participantId) || businessImages.get(participantId) || applicantImages.get(text(data.applicantProfileId || data.uid || data.userId)) || text(data.profileImageUrl || data.logoUrl) || undefined,
      documents: embedded.length ? embedded : complianceByParticipant.get(participantId) || [],
      growthPlanDocUrl: data.growthPlanDocUrl,
      rejectionReason: data.rejectionReason || undefined,
    } satisfies OperationsApplication
  })
}

export const updateOperationsApplicationStatus = async (
  user: FullIdentity,
  applicationId: string,
  applicationStatus: string,
  rejectionReason?: string,
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
    rejectionReason: normalizedStatus === 'Rejected' ? (rejectionReason?.trim() || null) : null,
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
