import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { getFirebaseDb, getFirebaseStorage } from '@/config/firebase'
import type {
  ConsultantAvailabilitySlot,
  ConsultantMarketplaceProfile,
  ConsultantSpecialAvailability,
  ConsultantServiceOffer,
  ConsultantVerificationStatus,
} from '@/types/consultantMarketplace'

const cleanStringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []

const cleanServices = (value: unknown): ConsultantServiceOffer[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        return [{
          id: String(row.id || crypto.randomUUID()),
          areaOfSupport: String(row.areaOfSupport || row.name || ''),
          interventionExamples: Array.isArray(row.interventionExamples)
            ? row.interventionExamples.map((example) => String(example).trim()).filter(Boolean)
            : String(row.description || '').split(/[\n,]/).map((example) => example.trim()).filter(Boolean),
          deliveryMode: row.deliveryMode === 'in_person' || row.deliveryMode === 'hybrid' ? row.deliveryMode : 'online',
          rate: Math.max(0, Number(row.rate) || 0),
          rateUnit: 'day',
        }]
      })
    : []

const cleanAvailability = (value: unknown): ConsultantAvailabilitySlot[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        const dayOfWeek = Number(row.dayOfWeek)
        if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return []
        return [{
          id: String(row.id || crypto.randomUUID()),
          dayOfWeek,
          startTime: String(row.startTime || '09:00'),
          endTime: String(row.endTime || '17:00'),
        }]
      })
    : []

const cleanSpecialAvailability = (value: unknown): ConsultantSpecialAvailability =>
  value === 'available' || value === 'unavailable' || value === 'on_request' ? value : 'on_request'

export const createEmptyConsultantProfile = (
  uid: string,
  name: string,
  email: string,
): ConsultantMarketplaceProfile => ({
  uid,
  name,
  email,
  alternativeEmail: '',
  website: '',
  linkedinUrl: '',
  facebookUrl: '',
  phone: '',
  alternativePhone: '',
  phoneIsWhatsApp: false,
  alternativePhoneIsWhatsApp: false,
  profileImageUrl: '',
  verificationStatus: 'unverified',
  headline: '',
  bio: '',
  experienceYears: 0,
  specialties: [],
  country: '',
  province: '',
  physicalAddress: '',
  operatingLocation: '',
  serviceRadiusKm: 25,
  currency: 'USD',
  services: [],
  availability: [],
  weekendAvailability: 'on_request',
  holidayAvailability: 'on_request',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Harare',
  acceptingClients: true,
  status: 'draft',
})

export const getConsultantProfile = async (
  uid: string,
  fallback: Pick<ConsultantMarketplaceProfile, 'name' | 'email'>,
): Promise<ConsultantMarketplaceProfile> => {
  const snapshot = await getDoc(doc(getFirebaseDb(), 'consultantProfiles', uid))
  if (!snapshot.exists()) return createEmptyConsultantProfile(uid, fallback.name, fallback.email)

  const data = snapshot.data()
  return {
    uid,
    name: String(data.name || fallback.name),
    email: String(data.email || fallback.email),
    alternativeEmail: String(data.alternativeEmail || data.secondaryEmail || ''),
    website: String(data.website || ''),
    linkedinUrl: String(data.linkedinUrl || ''),
    facebookUrl: String(data.facebookUrl || ''),
    phone: String(data.phone || ''),
    alternativePhone: String(data.alternativePhone || ''),
    phoneIsWhatsApp: data.phoneIsWhatsApp === true,
    alternativePhoneIsWhatsApp: data.alternativePhoneIsWhatsApp === true,
    profileImageUrl: String(data.profileImageUrl || ''),
    verificationStatus: data.verificationStatus === 'verified' ? 'verified' : data.verificationStatus === 'pending' ? 'pending' : 'unverified',
    verifiedAt: data.verifiedAt,
    verifiedBy: typeof data.verifiedBy === 'string' ? data.verifiedBy : undefined,
    headline: String(data.headline || ''),
    bio: String(data.bio || ''),
    experienceYears: Math.max(0, Number(data.experienceYears) || 0),
    specialties: cleanStringArray(data.specialties),
    country: String(data.country || ''),
    province: String(data.province || ''),
    physicalAddress: String(data.physicalAddress || data.operatingLocation || ''),
    operatingLocation: String(data.operatingLocation || ''),
    serviceRadiusKm: Math.max(0, Number(data.serviceRadiusKm) || 25),
    currency: String(data.currency || 'USD').toUpperCase(),
    services: cleanServices(data.services),
    availability: cleanAvailability(data.availability),
    weekendAvailability: cleanSpecialAvailability(data.weekendAvailability),
    holidayAvailability: cleanSpecialAvailability(data.holidayAvailability),
    timezone: String(data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Harare'),
    acceptingClients: data.acceptingClients !== false,
    status: data.status === 'published' ? 'published' : 'draft',
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  }
}

/** All consultant profiles that have opted to be visible for SME matching. */
export const listPublishedConsultants = async (): Promise<ConsultantMarketplaceProfile[]> => {
  const snapshot = await getDocs(query(collection(getFirebaseDb(), 'consultantProfiles'), where('status', '==', 'published')))

  return snapshot.docs.map((row) => {
    const data = row.data()
    return {
      uid: row.id,
      name: String(data.name || ''),
      email: String(data.email || ''),
      alternativeEmail: String(data.alternativeEmail || data.secondaryEmail || ''),
      website: String(data.website || ''),
      linkedinUrl: String(data.linkedinUrl || ''),
      facebookUrl: String(data.facebookUrl || ''),
      phone: String(data.phone || ''),
      alternativePhone: String(data.alternativePhone || ''),
      phoneIsWhatsApp: data.phoneIsWhatsApp === true,
      alternativePhoneIsWhatsApp: data.alternativePhoneIsWhatsApp === true,
      profileImageUrl: String(data.profileImageUrl || ''),
      verificationStatus: (data.verificationStatus === 'verified' ? 'verified' : data.verificationStatus === 'pending' ? 'pending' : 'unverified') as ConsultantVerificationStatus,
      verifiedAt: data.verifiedAt,
      verifiedBy: typeof data.verifiedBy === 'string' ? data.verifiedBy : undefined,
      headline: String(data.headline || ''),
      bio: String(data.bio || ''),
      experienceYears: Math.max(0, Number(data.experienceYears) || 0),
      specialties: cleanStringArray(data.specialties),
      country: String(data.country || ''),
      province: String(data.province || ''),
      physicalAddress: String(data.physicalAddress || data.operatingLocation || ''),
      operatingLocation: String(data.operatingLocation || ''),
      serviceRadiusKm: Math.max(0, Number(data.serviceRadiusKm) || 25),
      currency: String(data.currency || 'USD').toUpperCase(),
      services: cleanServices(data.services),
      availability: cleanAvailability(data.availability),
      weekendAvailability: cleanSpecialAvailability(data.weekendAvailability),
      holidayAvailability: cleanSpecialAvailability(data.holidayAvailability),
      timezone: String(data.timezone || 'Africa/Harare'),
      acceptingClients: data.acceptingClients !== false,
      status: 'published' as const,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    }
  }).filter((profile) => profile.acceptingClients)
}

export const saveConsultantProfile = async (profile: ConsultantMarketplaceProfile) => {
  await setDoc(doc(getFirebaseDb(), 'consultantProfiles', profile.uid), {
    uid: profile.uid,
    name: profile.name.trim(),
    email: profile.email.trim().toLowerCase(),
    alternativeEmail: profile.alternativeEmail.trim().toLowerCase(),
    website: profile.website.trim(),
    linkedinUrl: profile.linkedinUrl.trim(),
    facebookUrl: profile.facebookUrl.trim(),
    phone: profile.phone.trim(),
    alternativePhone: profile.alternativePhone.trim(),
    phoneIsWhatsApp: profile.phoneIsWhatsApp && Boolean(profile.phone.trim()),
    alternativePhoneIsWhatsApp: profile.alternativePhoneIsWhatsApp && Boolean(profile.alternativePhone.trim()),
    profileImageUrl: profile.profileImageUrl.trim(),
    verificationStatus: profile.verificationStatus,
    verifiedAt: profile.verifiedAt || null,
    verifiedBy: profile.verifiedBy || null,
    headline: profile.headline.trim(),
    bio: profile.bio.trim(),
    experienceYears: Math.max(0, Number(profile.experienceYears) || 0),
    specialties: cleanStringArray(profile.specialties),
    country: profile.country.trim(),
    province: profile.province.trim(),
    physicalAddress: profile.physicalAddress.trim(),
    operatingLocation: profile.physicalAddress.trim() || profile.operatingLocation.trim(),
    serviceRadiusKm: Math.max(0, Number(profile.serviceRadiusKm) || 0),
    currency: profile.currency.trim().toUpperCase(),
    services: cleanServices(profile.services),
    availability: cleanAvailability(profile.availability),
    weekendAvailability: cleanSpecialAvailability(profile.weekendAvailability),
    holidayAvailability: cleanSpecialAvailability(profile.holidayAvailability),
    timezone: profile.timezone,
    acceptingClients: profile.acceptingClients,
    status: profile.status,
    updatedAt: serverTimestamp(),
    createdAt: profile.createdAt || serverTimestamp(),
  }, { merge: true })

  // The admin user directory reads the photo from users/{uid}, so mirror it there.
  if (profile.profileImageUrl.trim()) {
    try {
      await updateDoc(doc(getFirebaseDb(), 'users', profile.uid), { profileImageUrl: profile.profileImageUrl.trim() })
    } catch (error) {
      console.warn('[consultant profile] could not mirror photo to users record', error)
    }
  }
}

export const uploadConsultantProfileImage = async (uid: string, file: File) => {
  const extension = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const storagePath = `consultant-profiles/${uid}/${Date.now()}.${extension}`
  const storageRef = ref(getFirebaseStorage(), storagePath)
  await uploadBytes(storageRef, file, { contentType: file.type || 'image/jpeg' })
  return getDownloadURL(storageRef)
}

export const listConsultantProfilesForVerification = async (user: { role: string }) => {
  if (user.role !== 'systemadmin') throw new Error('forbidden')
  const snapshot = await getDocs(collection(getFirebaseDb(), 'consultantProfiles'))
  return Promise.all(snapshot.docs.map((row) => getConsultantProfile(row.id, { name: String(row.data().name || ''), email: String(row.data().email || '') })))
}

export const setConsultantVerification = async (user: { role: string, uid: string }, uid: string, status: ConsultantVerificationStatus) => {
  if (user.role !== 'systemadmin') throw new Error('forbidden')
  await updateDoc(doc(getFirebaseDb(), 'consultantProfiles', uid), {
    verificationStatus: status,
    verifiedAt: status === 'verified' ? serverTimestamp() : null,
    verifiedBy: status === 'verified' ? user.uid : null,
    updatedAt: serverTimestamp(),
  })
}
