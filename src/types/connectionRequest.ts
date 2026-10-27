export type ConnectionRequestTargetType = 'consultant' | 'agent'
/** pending: new · contacted: in conversation · proposed: plan sent, waiting for the SME · matched: plan accepted, work created · declined */
export type ConnectionRequestStatus = 'pending' | 'contacted' | 'proposed' | 'matched' | 'declined'
export type ConnectionRequestDeliveryMode = 'online' | 'in_person' | 'hybrid' | 'no_preference'
export type ConnectionRequestUrgency = 'low' | 'normal' | 'high'

export type ConnectionRequest = {
  id: string
  smeUid: string
  smeName: string
  smeEmail: string
  targetType: ConnectionRequestTargetType
  targetId: string
  targetName: string
  /** The SME's workspace - the platform owner (QTX) for independently registered SMEs. */
  companyCode: string
  areaOfSupport?: string
  deliveryMode?: ConnectionRequestDeliveryMode
  preferredStartDate?: string
  engagementDays?: number
  urgency?: ConnectionRequestUrgency
  budget?: number
  currency?: string
  note?: string
  /** Steps from the SME's plan this request covers; the consultant's plan builder starts from them. */
  planSteps?: string[]
  status: ConnectionRequestStatus
  reviewerNote?: string
  /** Reception passed the request to this staff member. */
  forwardedToUid?: string
  forwardedToName?: string
  forwardedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  /** The short conversation between the SME and the consultant (operations can add to it too). */
  messages?: ConnectionMessage[]
  /** The consultant's latest proposed plan; replaced when they send a revised one. */
  plan?: ConnectionPlan
  declinedBy?: 'sme' | 'consultant' | 'operations'
  declineReason?: string
  /** The assigned interventions created when the SME accepted the plan. */
  assignmentIds?: string[]
  consultantRespondedAt?: unknown
  acceptedAt?: unknown
  /** Set once operations were alerted that the consultant hadn't answered. */
  nudgedAt?: unknown
}

export type ConnectionParty = 'sme' | 'consultant' | 'operations'

export type ConnectionMessage = {
  id: string
  from: ConnectionParty
  uid: string
  name: string
  text: string
  /** ISO time it was sent. */
  at: string
}

export type ConnectionPlanItem = {
  title: string
  areaOfSupport?: string
  sessions: number
  deliveryMode?: 'online' | 'in_person' | 'hybrid'
  /** YYYY-MM-DD */
  dueDate: string
  /** Agreed price; payment happens outside the system. */
  price: number
}

export type ConnectionPlan = {
  items: ConnectionPlanItem[]
  total: number
  currency: string
  message?: string
  /** ISO time the plan was sent. */
  sentAt: string
  /** 1 for the first plan, then +1 for each revision. */
  version: number
}
