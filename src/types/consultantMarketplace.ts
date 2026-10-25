export type ConsultantRateUnit = 'day'
export type ConsultantDeliveryMode = 'online' | 'in_person' | 'hybrid'
export type ConsultantProfileStatus = 'draft' | 'published'
export type ConsultantVerificationStatus = 'unverified' | 'pending' | 'verified'
export type ConsultantSpecialAvailability = 'available' | 'unavailable' | 'on_request'

export type ConsultantServiceOffer = {
  id: string
  areaOfSupport: string
  interventionExamples: string[]
  deliveryMode: ConsultantDeliveryMode
  rate: number
  rateUnit: ConsultantRateUnit
}

export type ConsultantAvailabilitySlot = {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
}

export type ConsultantMarketplaceProfile = {
  uid: string
  name: string
  email: string
  alternativeEmail: string
  website: string
  linkedinUrl: string
  facebookUrl: string
  phone: string
  alternativePhone: string
  phoneIsWhatsApp: boolean
  alternativePhoneIsWhatsApp: boolean
  phoneProvider: string
  alternativePhoneProvider: string
  profileImageUrl: string
  verificationStatus: ConsultantVerificationStatus
  verifiedAt?: unknown
  verifiedBy?: string
  headline: string
  bio: string
  experienceYears: number
  specialties: string[]
  country: string
  province: string
  physicalAddress: string
  operatingLocation: string
  serviceRadiusKm: number
  currency: string
  services: ConsultantServiceOffer[]
  availability: ConsultantAvailabilitySlot[]
  weekendAvailability: ConsultantSpecialAvailability
  holidayAvailability: ConsultantSpecialAvailability
  timezone: string
  acceptingClients: boolean
  status: ConsultantProfileStatus
  createdAt?: unknown
  updatedAt?: unknown
}
