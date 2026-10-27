export type ApplicantProfile = {
  id?: string
  uid: string
  participantName: string
  email: string
  phone?: string
  gender?: string
  idNumber?: string
  alternativePhone?: string
  maritalStatus?: string
  employmentStatus?: string
  educationLevel?: string
  disabilityStatus?: string
  province?: string
  city?: string
}

export type DirectorRole = 'director' | 'shareholder' | 'both'

/** One director or shareholder of the SME. Ownership percentages are worked out from these when present. */
export type BusinessDirector = {
  id: string
  fullName: string
  idNumber: string
  gender: 'Male' | 'Female'
  /** B-BBEE population group; African, Coloured and Indian count as Black. */
  race: 'African' | 'Coloured' | 'Indian' | 'White' | 'Other'
  sharePercent: number
  role?: DirectorRole
  phone?: string
  email?: string
  disabilityStatus?: string
}

export type BusinessProfile = {
  id?: string
  ownerUid: string
  applicantProfileId: string
  businessName: string
  participantName?: string
  email?: string
  phone?: string
  sector?: string
  natureOfBusiness?: string
  beeLevel?: string
  registrationStatus?: string
  registrationNumber?: string
  dateOfRegistration?: unknown
  yearsOfTrading?: number
  youthOwnedPercent?: number
  femaleOwnedPercent?: number
  blackOwnedPercent?: number
  ownership?: {
    youthOwnedPercent?: number
    femaleOwnedPercent?: number
    blackOwnedPercent?: number
  }
  directors?: BusinessDirector[]
  businessAddress?: string
  province?: string
  city?: string
  postalCode?: string
  hostCommunity?: string
  locationType?: string
}

export type ApplicantProfileBundle = {
  applicantProfile: ApplicantProfile
  businessProfile: BusinessProfile
}

export type ApplicantProfileInput = Partial<Omit<ApplicantProfile & BusinessProfile, 'id' | 'uid' | 'ownerUid' | 'applicantProfileId'>> & {
  participantName: string
  email: string
  businessName: string
}

export type ApplicantProgram = {
  id: string
  name?: string
  description?: string
  type?: string
  cohortYear?: string
  status?: string
  startDate?: unknown
  eligibilityCriteria?: Record<string, unknown>
  companyCode?: string
  openToExternalSmes?: boolean
  /** 'direct' = no application: SMEs join as soon as their profile is complete. */
  intakeMode?: string
}

export type ApplicantApplication = {
  id: string
  programId?: string
  programName?: string
  applicationStatus?: string
  complianceScore?: number
  submittedAt?: unknown
}
