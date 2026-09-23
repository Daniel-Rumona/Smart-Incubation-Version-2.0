export type ProgramQuestionType = 'text' | 'textarea' | 'longText' | 'long_text' | 'dropdown' | 'select' | 'single_select' | 'multi_select' | 'yes_no' | 'number' | 'date'

export type ProgramQuestion = {
  id: string
  label: string
  question?: string
  type?: ProgramQuestionType
  options?: string[] | string
  required?: boolean
  placeholder?: string
  maxSelections?: number
}

export type ProgramDocumentRequirement = {
  requirementId: string
  type: string
  description?: string
  category?: string
  requirementType?: 'registration' | 'program'
  isRequired?: boolean
  allowedFormats?: string[]
  maxSizeMB?: number
  requiresExpiry: boolean
  file?: File | null
  expiryDate?: string | null
  uploadedUrl?: string | null
  fileName?: string | null
  storagePath?: string | null
  status?: 'missing' | 'ready' | 'valid' | 'invalid_format' | 'too_large' | 'upload_failed'
}

export type ProgramInterventionPolicy = {
  mode?: 'sme_choice' | 'force_all'
  sourceScope?: 'program' | 'company' | 'none'
  forcedInterventionIds?: string[]
  forcedInterventions?: ProgramIntervention[]
  allowSmeSelection?: boolean
}

export type ProgramIntervention = {
  id: string
  title: string
  area?: string
  scopeType?: 'company' | 'program'
  programId?: string | null
}

export type ProgramInterventionGroup = {
  area: string
  interventions: ProgramIntervention[]
}

export type ApplicationFormValues = {
  participantName?: string
  email?: string
  idNumber?: string
  gender?: string
  phone?: string
  beneficiaryName?: string
  sector?: string
  natureOfBusiness?: string
  registrationNumber?: string
  dateOfRegistration?: string
  yearsOfTrading?: number
  businessAddress?: string
  province?: string
  city?: string
  hub?: string
  postalCode?: string
  location?: string
  motivation?: string
  challenges?: string
  facebook?: string
  instagram?: string
  linkedIn?: string
  swotStrengths?: string
  swotWeaknesses?: string
  swotOpportunities?: string
  swotThreats?: string
  stage?: string
  age?: number
  profile?: Record<string, unknown>
}

export type ApplicationSubmissionPayload = {
  participantId?: string | null
  companyCode?: string | null
  programId?: string | null
  programName?: string | null
  applicationStatus: 'pending'
  submittedAt: string
  formValues: ApplicationFormValues
  complianceScore: number
  complianceDocuments: ProgramDocumentRequirement[]
  interventions: {
    required: ProgramIntervention[]
    assigned: ProgramIntervention[]
    completed: ProgramIntervention[]
    participationRate: number
  }
  aiEvaluation?: unknown
}
