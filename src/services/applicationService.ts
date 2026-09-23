import { addDoc, collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import dayjs from 'dayjs'
import { auth, db, storage } from '@/firebase'
import type {
  ApplicationFormValues,
  ApplicationSubmissionPayload,
  ProgramDocumentRequirement,
  ProgramIntervention,
} from '@/types/application'

export function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(removeUndefinedDeep) as T
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefinedDeep(item)]),
    ) as T
  }
  return value
}

export function getAgeFromIdNumber(idNumber?: string): number | null {
  if (!idNumber || idNumber.length < 6) return null

  const birthYear = Number(idNumber.substring(0, 2))
  const birthMonth = Number(idNumber.substring(2, 4)) - 1
  const birthDay = Number(idNumber.substring(4, 6))
  const currentYear = new Date().getFullYear()
  const century = birthYear <= currentYear % 100 ? 2000 : 1900
  const birthDate = new Date(century + birthYear, birthMonth, birthDay)

  if (Number.isNaN(birthDate.getTime())) return null

  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  const monthDiff = today.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1
  return age
}

export function getAgeGroup(age?: number | null): 'Youth' | 'Adult' | 'Senior' | 'Unknown' {
  if (typeof age !== 'number') return 'Unknown'
  if (age <= 35) return 'Youth'
  if (age <= 59) return 'Adult'
  return 'Senior'
}

export function deriveStageFromRevenue(values: ApplicationFormValues): string {
  const currentYear = dayjs().year()
  const years = [currentYear - 1, currentYear - 2]
  const revenues = years.map((year) => Number((values as Record<string, unknown>)[`revenue${year}`] || 0))
  const avgRevenue = revenues.reduce((sum, value) => sum + value, 0) / Math.max(revenues.length, 1)

  if (avgRevenue < 100000) return 'Ideation'
  if (avgRevenue < 500000) return 'Startup'
  if (avgRevenue < 1000000) return 'Early Stage'
  if (avgRevenue < 5000000) return 'Growth'
  return 'Maturity'
}

export function calculateComplianceScore(documents: ProgramDocumentRequirement[] = []) {
  const requiredDocs = documents.filter((item) => item.isRequired !== false)
  const docsToScore = requiredDocs.length ? requiredDocs : documents
  if (!docsToScore.length) return 100

  const oneWeekFromNow = dayjs().add(7, 'day')
  const validDocs = docsToScore.filter((item) => {
    if (!(item.file || item.uploadedUrl)) return false
    if (item.requiresExpiry && !item.expiryDate) return false
    if (item.expiryDate && dayjs(item.expiryDate).isBefore(oneWeekFromNow)) return false
    return true
  })

  return Math.round((validDocs.length / docsToScore.length) * 100)
}

export function getMissingDocuments(documents: ProgramDocumentRequirement[] = []) {
  return documents.filter((item) => item.isRequired !== false && !(item.file || item.uploadedUrl))
}

export function getExpiredOrExpiringDocuments(documents: ProgramDocumentRequirement[] = []) {
  const oneWeekFromNow = dayjs().add(7, 'day')
  return documents.filter((item) => item.requiresExpiry && (item.file || item.uploadedUrl) && (!item.expiryDate || dayjs(item.expiryDate).isBefore(oneWeekFromNow)))
}

export async function uploadApplicationDocument(args: {
  file: File
  companyCode?: string | null
  programId?: string | null
  participantId?: string | null
  folder?: string
}) {
  const { file, companyCode, programId, participantId, folder = 'participant_documents' } = args
  const safeFileName = file.name.replace(/[^\w.-]/g, '_')
  const fileName = `${Date.now()}_${safeFileName}`
  const ownerId = auth.currentUser?.uid || participantId || 'unknown'
  const fileRef = ref(storage, `${folder}/${companyCode || 'unknown'}/${programId || 'unknown'}/${ownerId}/${fileName}`)

  await uploadBytes(fileRef, file)
  const url = await getDownloadURL(fileRef)

  return {
    url,
    fileName,
    storagePath: fileRef.fullPath,
  }
}

export async function uploadApplicationDocuments(args: {
  documents: ProgramDocumentRequirement[]
  companyCode?: string | null
  programId?: string | null
  participantId?: string | null
}) {
  const uploaded: ProgramDocumentRequirement[] = []

  for (const item of args.documents) {
    const allowedFormats = (item.allowedFormats?.length ? item.allowedFormats : ['pdf', 'jpg', 'jpeg', 'png']).map((format) => format.toLowerCase())
    const maxSizeMB = item.maxSizeMB || 10

    if (!item.file) {
      uploaded.push({ ...item, status: 'missing' })
      continue
    }

    const extension = item.file.name.split('.').pop()?.toLowerCase() || ''
    if (!allowedFormats.includes(extension)) {
      uploaded.push({ ...item, status: 'invalid_format' })
      continue
    }

    if (item.file.size / 1024 / 1024 > maxSizeMB) {
      uploaded.push({ ...item, status: 'too_large' })
      continue
    }

    try {
      const result = await uploadApplicationDocument({
        file: item.file,
        companyCode: args.companyCode,
        programId: args.programId,
        participantId: args.participantId,
      })

      uploaded.push({
        ...item,
        uploadedUrl: result.url,
        fileName: result.fileName,
        storagePath: result.storagePath,
        status: 'valid',
      })
    } catch {
      uploaded.push({ ...item, status: 'upload_failed' })
    }
  }

  return uploaded
}

export function buildSelectedInterventions(args: {
  forcedInterventions?: ProgramIntervention[]
  isForcedInterventionProgram: boolean
  interventionGroups: { area: string; interventions: ProgramIntervention[] }[]
  interventionSelections: Record<string, string[]>
}) {
  if (args.isForcedInterventionProgram) {
    return (args.forcedInterventions || []).map((item) => ({
      id: item.id,
      title: item.title || 'Program intervention',
      area: item.area || 'Program',
    }))
  }

  return Object.values(args.interventionSelections)
    .flat()
    .map((id) => {
      const group = args.interventionGroups.find((item) => item.interventions.some((intervention) => intervention.id === id))
      const match = group?.interventions.find((item) => item.id === id)
      return match ? { id: match.id, title: match.title, area: group?.area || match.area || 'General' } : null
    })
    .filter(Boolean) as ProgramIntervention[]
}

export async function createProgramApplication(payload: ApplicationSubmissionPayload) {
  const values = payload.formValues
  const age = getAgeFromIdNumber(values.idNumber)
  const stage = values.stage || deriveStageFromRevenue(values)

  const cleanDocuments = payload.complianceDocuments.map((item) => ({
    requirementId: item.requirementId,
    type: item.type,
    requirementName: item.type,
    category: item.category || null,
    requirementType: item.requirementType || 'program',
    isRequired: item.isRequired !== false,
    allowedFormats: item.allowedFormats || ['pdf', 'jpg', 'jpeg', 'png'],
    maxSizeMB: item.maxSizeMB || 10,
    url: item.uploadedUrl || null,
    fileName: item.fileName || null,
    storagePath: item.storagePath || null,
    expiryDate: item.requiresExpiry ? item.expiryDate || null : null,
    status: item.status || (item.uploadedUrl ? 'valid' : 'missing'),
  }))

  const applicationDoc = removeUndefinedDeep({
    participantId: payload.participantId,
    companyCode: payload.companyCode,
    programId: payload.programId,
    programName: payload.programName,
    applicationStatus: payload.applicationStatus,
    submittedAt: payload.submittedAt,
    beneficiaryName: values.beneficiaryName,
    participantName: values.participantName,
    gender: values.gender,
    age,
    ageGroup: getAgeGroup(age),
    stage,
    province: values.province,
    city: values.city,
    businessAddress: values.businessAddress,
    sector: values.sector,
    natureOfBusiness: values.natureOfBusiness,
    registrationNumber: values.registrationNumber,
    yearsOfTrading: values.yearsOfTrading,
    hub: values.hub,
    email: values.email,
    motivation: values.motivation,
    challenges: values.challenges,
    facebook: values.facebook,
    instagram: values.instagram,
    linkedIn: values.linkedIn,
    swotStrengths: values.swotStrengths,
    swotWeaknesses: values.swotWeaknesses,
    swotOpportunities: values.swotOpportunities,
    swotThreats: values.swotThreats,
    complianceScore: payload.complianceScore,
    complianceDocuments: cleanDocuments,
    interventions: payload.interventions,
    aiEvaluation: payload.aiEvaluation || null,
    profile: values.profile || {},
    formValues: values,
  })

  const applicationRef = await addDoc(collection(db, 'applications'), applicationDoc)
  return applicationRef.id
}

export async function updateCurrentUserRoleToIncubatee() {
  const userEmail = auth.currentUser?.email
  if (!userEmail) return

  const usersRef = collection(db, 'users')
  const snapshot = await getDocs(query(usersRef, where('email', '==', userEmail)))
  if (snapshot.empty) return

  await updateDoc(doc(db, 'users', snapshot.docs[0].id), { role: 'incubatee' })
}
