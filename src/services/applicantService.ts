import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { listTeamRegisteredCompanyCodes, resolveSmeCompanyCode } from '@/services/companiesService'
import type { FullIdentity } from '@/types/identity'
import { ownershipFromDirectors } from '@/utils/businessDirectors'
import type {
  ApplicantApplication,
  ApplicantProfile,
  ApplicantProfileBundle,
  ApplicantProfileInput,
  ApplicantProgram,
  BusinessDirector,
  BusinessProfile,
} from '@/types/applicant'

const toRows = <T extends object>(snapshot: Awaited<ReturnType<typeof getDocs>>) =>
  snapshot.docs.map((row) => ({ id: row.id, ...(row.data() as Record<string, unknown>) })) as T[]

export const isApplicantProfileComplete = (bundle: ApplicantProfileBundle | null | undefined) => Boolean(
  bundle?.applicantProfile.participantName?.trim()
  && bundle.applicantProfile.email?.trim()
  && bundle.businessProfile.businessName?.trim(),
)

export const getApplicantProfile = async (uid: string, email: string): Promise<ApplicantProfile | null> => {
  const db = getFirebaseDb()
  const direct = await getDoc(doc(db, 'applicantProfiles', uid))
  if (direct.exists()) return { id: direct.id, ...direct.data() } as ApplicantProfile

  const byUid = await getDocs(query(collection(db, 'applicantProfiles'), where('uid', '==', uid), limit(1)))
  if (!byUid.empty) return { id: byUid.docs[0].id, ...byUid.docs[0].data() } as ApplicantProfile

  const byEmail = await getDocs(query(collection(db, 'applicantProfiles'), where('email', '==', email.toLowerCase()), limit(1)))
  return byEmail.empty ? null : { id: byEmail.docs[0].id, ...byEmail.docs[0].data() } as ApplicantProfile
}

export const getBusinessProfile = async (uid: string): Promise<BusinessProfile | null> => {
  const db = getFirebaseDb()
  const direct = await getDoc(doc(db, 'businessProfiles', uid))
  if (direct.exists()) return { id: direct.id, ...direct.data() } as BusinessProfile

  const byOwner = await getDocs(query(collection(db, 'businessProfiles'), where('ownerUid', '==', uid), limit(1)))
  return byOwner.empty ? null : { id: byOwner.docs[0].id, ...byOwner.docs[0].data() } as BusinessProfile
}

export const getApplicantProfileBundle = async (uid: string, email: string): Promise<ApplicantProfileBundle | null> => {
  const [applicantProfile, businessProfile] = await Promise.all([
    getApplicantProfile(uid, email),
    getBusinessProfile(uid),
  ])
  return applicantProfile && businessProfile ? { applicantProfile, businessProfile } : null
}

export const saveApplicantProfile = async (uid: string, email: string, values: ApplicantProfileInput) => {
  const db = getFirebaseDb()
  const batch = writeBatch(db)
  const normalizedEmail = email.trim().toLowerCase()
  // Firestore rejects `undefined`, so optional director fields are dropped rather than sent empty.
  const directors = (values.directors || []).map((director) =>
    Object.fromEntries(Object.entries(director).filter(([, value]) => value !== undefined && value !== '')) as unknown as BusinessDirector)
  const [applicantSnapshot, businessSnapshot] = await Promise.all([
    getDoc(doc(db, 'applicantProfiles', uid)),
    getDoc(doc(db, 'businessProfiles', uid)),
  ])

  batch.set(doc(db, 'applicantProfiles', uid), {
    uid,
    participantName: values.participantName || null,
    email: normalizedEmail,
    phone: values.phone || null,
    gender: values.gender || null,
    idNumber: values.idNumber || null,
    alternativePhone: values.alternativePhone || null,
    maritalStatus: values.maritalStatus || null,
    employmentStatus: values.employmentStatus || null,
    educationLevel: values.educationLevel || null,
    disabilityStatus: values.disabilityStatus || null,
    province: values.province || null,
    city: values.city || null,
    updatedAt: serverTimestamp(),
    ...(!applicantSnapshot.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })

  batch.set(doc(db, 'businessProfiles', uid), {
    ownerUid: uid,
    applicantProfileId: uid,
    businessName: values.businessName || null,
    participantName: values.participantName || null,
    email: normalizedEmail,
    phone: values.phone || null,
    sector: values.sector || null,
    natureOfBusiness: values.natureOfBusiness || null,
    beeLevel: values.beeLevel || null,
    registrationStatus: values.registrationStatus || null,
    registrationNumber: values.registrationNumber || null,
    dateOfRegistration: values.dateOfRegistration || null,
    yearsOfTrading: values.yearsOfTrading ?? null,
    // With directors captured, ownership is always their sum, so the two can never disagree.
    ownership: directors.length ? ownershipFromDirectors(directors) : {
      youthOwnedPercent: values.youthOwnedPercent ?? null,
      femaleOwnedPercent: values.femaleOwnedPercent ?? null,
      blackOwnedPercent: values.blackOwnedPercent ?? null,
    },
    directors,
    province: values.province || null,
    city: values.city || null,
    businessAddress: values.businessAddress || null,
    postalCode: values.postalCode || null,
    hostCommunity: values.hostCommunity || null,
    locationType: values.locationType || null,
    updatedAt: serverTimestamp(),
    ...(!businessSnapshot.exists() ? { createdAt: serverTimestamp() } : {}),
  }, { merge: true })

  await batch.commit()
}

/**
 * Programs an SME may discover: their own workspace's programs, plus any program a company has
 * opened to external SMEs. Independently registered SMEs resolve to the platform owner (QTX),
 * so they see QTX's programs rather than every company's intake.
 */
export const listApplicantPrograms = async (user?: Pick<FullIdentity, 'companyCode'> & Partial<Pick<FullIdentity, 'smeJourney' | 'assignedProgramIds'>> | null) => {
  const [snapshot, teamRegistered] = await Promise.all([
    getDocs(collection(getFirebaseDb(), 'programs')),
    listTeamRegisteredCompanyCodes().catch(() => new Set<string>()),
  ])
  const activeStatuses = new Set(['active', 'planned', 'upcoming'])
  const companyCode = resolveSmeCompanyCode(user)

  const rows = toRows<ApplicantProgram>(snapshot)

  // A programme SME (link or chosen programme) sees only their own programme(s), even if it has since
  // closed, so they can still follow their application.
  const own = new Set(user?.assignedProgramIds || [])
  if (user?.smeJourney === 'programme' && own.size) {
    return rows.filter((program) => own.has(program.id))
  }

  return rows
    .filter((program) => !program.status || activeStatuses.has(program.status.toLowerCase()))
    .filter((program) => !teamRegistered.has(String(program.companyCode || '').trim()))
    .filter((program) => program.openToExternalSmes === true || String(program.companyCode || '').trim() === companyCode)
}

/**
 * The SME's own applications, using only the lookups the security rules allow for an SME
 * (applications they submitted carry their uid as participantId / uid).
 */
export const listMyApplications = async (uid: string) => {
  const db = getFirebaseDb()
  const snapshots = await Promise.all(['participantId', 'uid', 'userId'].map((field) =>
    getDocs(query(collection(db, 'applications'), where(field, '==', uid)))))
  const applications = new Map<string, ApplicantApplication>()
  snapshots.forEach((snapshot) => toRows<ApplicantApplication>(snapshot).forEach((row) => applications.set(row.id, row)))
  return [...applications.values()]
}

export const listApplicantApplications = async (uid: string, email: string) => {
  const bundle = await getApplicantProfileBundle(uid, email)
  const lookups = [
    ['uid', uid],
    ['userId', uid],
    ['email', email],
    ...(bundle ? [
      ['applicantProfileId', bundle.applicantProfile.id],
      ['businessProfileId', bundle.businessProfile.id],
      ['participantId', bundle.businessProfile.id],
    ] : []),
  ].filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1]))
  const applications = new Map<string, ApplicantApplication>()

  for (const [field, value] of lookups) {
    const snapshot = await getDocs(query(collection(getFirebaseDb(), 'applications'), where(field, '==', value)))
    for (const application of toRows<ApplicantApplication>(snapshot)) applications.set(application.id, application)
  }
  return [...applications.values()]
}

export const submitApplicantApplication = async (uid: string, email: string, values: Record<string, unknown>) => {
  await addDoc(collection(getFirebaseDb(), 'applications'), {
    ...values,
    uid,
    userId: uid,
    applicantProfileId: uid,
    businessProfileId: uid,
    participantId: uid,
    email,
    businessName: String(values.businessName || '').trim(),
    applicationStatus: 'Pending',
    submittedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  })
}
