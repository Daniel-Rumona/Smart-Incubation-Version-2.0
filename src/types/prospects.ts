import type { ConsentSource, OwnershipKey, ProspectModule, ProspectSource, ProspectStatus } from '@/config/prospects'
import type { ContactKeys } from '@/utils/contactKeys'

export type ProspectConsent = {
    /** They agreed to be kept on record. Required to add a prospect. */
    given: boolean
    source: ConsentSource
    /** They also agreed to be contacted by the system (WhatsApp or email). Automatic messages skip anyone without it. */
    contactAllowed: boolean
    at: string
    recordedBy: string
    note?: string
}

/** A detail the team chose to record about a prospect, beyond the fixed fields (e.g. "Employees": "12"). */
export type ProspectDetail = { label: string, value: string }

export type Prospect = {
    id: string
    companyCode: string
    module: ProspectModule
    /** A business (an SME, or a company that might send staff) or one person (who might join a class or a programme). */
    kind: ProspectKind
    /** The business's name; empty for a person. */
    businessName: string
    contactName: string
    phone: string
    email: string
    registrationNumber: string
    sector: string
    province: string
    ownership: OwnershipKey[]
    /** Anything else the team recorded; wiped when the prospect is anonymised. */
    extraDetails: ProspectDetail[]
    source: ProspectSource
    sourceDetail: string
    /** Incubation: the programme they might fit. */
    programId?: string
    programName?: string
    /** Training: the course, class or service (e.g. an ESG report) they are interested in. */
    interest?: string
    ownerUid?: string
    ownerName?: string
    notes: string
    /** When someone should next follow up (YYYY-MM-DD); overdue ones are flagged. */
    nextFollowUpAt?: string
    status: ProspectStatus
    statusChangedAt: string
    /** Why it closed (not interested or lost), for the reasons report. */
    closedReason?: string
    invitedAt?: string
    /** Training: the class they were booked into from here. */
    bookedClassId?: string
    bookedClassLabel?: string
    /** The sign-up code they used (an event's or a campaign's), when they signed up themselves. */
    signupLinkId?: string
    /** The account they signed up with (set by the server when they join through a link). */
    userUid?: string
    consent: ProspectConsent
    keys: ContactKeys
    participantId?: string
    organisationId?: string
    convertedAt?: string
    archivedAt?: string
    createdAt: string
    createdBy: string
    updatedAt: string
}

export type ProspectKind = 'business' | 'person'

/** What a prospect is called in lists: the business, or the person. */
export const prospectName = (prospect: Pick<Prospect, 'businessName' | 'contactName'>) => prospect.businessName || prospect.contactName

export type ProspectValues = Pick<Prospect,
    'kind' | 'businessName' | 'contactName' | 'phone' | 'email' | 'registrationNumber' | 'sector' | 'province' | 'ownership'
    | 'source' | 'sourceDetail' | 'programId' | 'interest' | 'ownerUid' | 'notes' | 'nextFollowUpAt'> & {
    /** Optional extra details (label and value pairs). */
    extraDetails?: ProspectDetail[]
    consentGiven: boolean
    consentSource: ConsentSource
    contactAllowed: boolean
    consentNote?: string
}

export type ProspectEvent = {
    id: string
    prospectId: string
    from: ProspectStatus | null
    to: ProspectStatus
    at: string
    by: string
    byName: string
    note?: string
}

export type ProspectDuplicate = {
    kind: 'prospect' | 'participant' | 'client'
    id: string
    name: string
    matchedOn: Array<keyof ContactKeys | 'name'>
    status?: ProspectStatus
    archived?: boolean
}

export type ProspectSignupLink = {
    id: string
    module: 'incubation' | 'training'
    label: string
    active: boolean
    programId?: string
    programName?: string
    ownerUid?: string
    ownerName?: string
    signups: number
    createdAt: string
}

export type ProspectFunnelRow = { source: string, reached: number, engaged: number, invited: number, converted: number, conversionPct: number }

export type ProspectEventRow = { source: string, event: string, reached: number, engaged: number, converted: number, conversionPct: number, revenue: number | null }

export type ProspectFunnel = { rows: ProspectFunnelRow[], byEvent: ProspectEventRow[], scope: 'company' | 'funded' }
