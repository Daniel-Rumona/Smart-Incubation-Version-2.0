export type ComplianceStatus = 'pending' | 'valid' | 'queried' | 'invalid' | 'expired'
export type ComplianceVerification = 'pending' | 'verified' | 'queried'

export type ComplianceDocument = {
  id: string
  participantId: string
  programId?: string
  companyCode?: string
  key: string
  type: string
  documentName: string
  currentStatus: ComplianceStatus
  verificationStatus: ComplianceVerification
  verificationComment?: string
  issueDate?: string
  expiryDate?: string
  notes?: string
  fileName?: string
  url?: string
  updatedAt?: unknown
}

export type ComplianceParticipant = {
  id: string
  participantId: string
  businessName: string
  email?: string
  phone?: string
  programId?: string
  companyCode?: string
  documents: ComplianceDocument[]
  /** The documents this participant's programme asks for (all of the catalogue when none are configured). */
  requirements: { key: string, name: string, required: boolean }[]
}

export type SaveComplianceDocument = {
  participantId: string
  programId?: string
  companyCode?: string
  type: string
  documentName: string
  currentStatus: ComplianceStatus
  issueDate?: string
  expiryDate?: string
  notes?: string
  fileName?: string
  url?: string
}
