/**
 * Prospects: businesses a company has reached but that have not joined yet. One collection (smeProspects) serves
 * both sides of the platform, each with its own pipeline:
 *   - incubation: an SME that might join a programme (converts into a participant);
 *   - training: a company that might send staff to training or buy an ESG report (converts into a client company).
 * Every status change is also written to smeProspectEvents, which the funnel reports are built from.
 */

import { BUSINESS_SECTORS } from '@/config/businessProfileOptions'
import { SADC_PROVINCES } from '@/config/sadc'

export type ProspectModule = 'incubation' | 'training'

export type ProspectStatus =
    | 'new' | 'contacted'
    | 'invited' | 'applied' | 'joined'      // incubation
    | 'proposal' | 'booked' | 'client'      // training
    | 'not_interested' | 'lost'

type StatusOption = { key: ProspectStatus, label: string, color: string }

const CLOSED: StatusOption[] = [
    { key: 'not_interested', label: 'Not interested', color: 'default' },
    { key: 'lost', label: 'Lost', color: 'default' },
]

export const PROSPECT_STATUSES: Record<ProspectModule, StatusOption[]> = {
    incubation: [
        { key: 'new', label: 'New', color: 'blue' },
        { key: 'contacted', label: 'Contacted', color: 'cyan' },
        { key: 'invited', label: 'Invited', color: 'purple' },
        { key: 'applied', label: 'Applied', color: 'gold' },
        { key: 'joined', label: 'Joined', color: 'green' },
        ...CLOSED,
    ],
    training: [
        { key: 'new', label: 'New', color: 'blue' },
        { key: 'contacted', label: 'Contacted', color: 'cyan' },
        { key: 'proposal', label: 'Proposal sent', color: 'purple' },
        { key: 'booked', label: 'Booked', color: 'gold' },
        { key: 'client', label: 'Client', color: 'green' },
        ...CLOSED,
    ],
}

/** The status that means "converted" on each side. */
export const CONVERTED_STATUS: Record<ProspectModule, ProspectStatus> = { incubation: 'joined', training: 'client' }

export const isClosedStatus = (status: ProspectStatus) => status === 'not_interested' || status === 'lost'

export const statusOption = (module: ProspectModule, status: ProspectStatus) =>
    PROSPECT_STATUSES[module].find((option) => option.key === status) || PROSPECT_STATUSES[module][0]

export type ProspectSource = 'training_class' | 'event' | 'referral' | 'import' | 'walk_in' | 'website' | 'other'

export const PROSPECT_SOURCES: Array<{ key: ProspectSource, label: string }> = [
    { key: 'training_class', label: 'Training class' },
    { key: 'event', label: 'Event' },
    { key: 'referral', label: 'Referral' },
    { key: 'import', label: 'Imported list' },
    { key: 'walk_in', label: 'Walk-in or call' },
    { key: 'website', label: 'Website' },
    { key: 'other', label: 'Other' },
]

/** How the person agreed to be kept on record (POPIA): asked in person, on a form, on a signed register, or otherwise. */
export type ConsentSource = 'verbal' | 'form' | 'register' | 'email' | 'other'

export const CONSENT_SOURCES: Array<{ key: ConsentSource, label: string }> = [
    { key: 'verbal', label: 'Asked in person or by phone' },
    { key: 'form', label: 'Filled in a form' },
    { key: 'register', label: 'Signed an attendance register' },
    { key: 'email', label: 'Agreed by email or WhatsApp' },
    { key: 'other', label: 'Other' },
]

/** Sector and province are picked from the same lists as the business profile; a value typed or imported earlier stays selectable. */
export const PROSPECT_SECTORS: string[] = BUSINESS_SECTORS
export const PROSPECT_PROVINCES: string[] = SADC_PROVINCES['South Africa']
export const withCurrent = (list: string[], current?: string) =>
    (current && !list.includes(current) ? [...list, current] : list).map((value) => ({ value, label: value }))

export const OWNERSHIP_OPTIONS = [
    { key: 'black', label: 'Black-owned' },
    { key: 'women', label: 'Women-owned' },
    { key: 'youth', label: 'Youth-owned' },
    { key: 'disability', label: 'Owned by a person with a disability' },
] as const

export type OwnershipKey = typeof OWNERSHIP_OPTIONS[number]['key']

/** Prospects that have not converted are anonymised after this long (archive first, restorable for 30 days). */
export const PROSPECT_RETENTION_MONTHS = 12

const ORDER: Record<ProspectModule, ProspectStatus[]> = {
    incubation: ['new', 'contacted', 'invited', 'applied', 'joined'],
    training: ['new', 'contacted', 'proposal', 'booked', 'client'],
}

/** True when `to` is further along the pipeline than `from` (a closed prospect coming back counts as forward). */
export const isForwardMove = (module: ProspectModule, from: ProspectStatus, to: ProspectStatus) =>
    ORDER[module].indexOf(to) > ORDER[module].indexOf(from)

/** Incubation works with businesses only; training also takes individuals who want to join a class. */
export const allowsPeople = (module: ProspectModule) => module === 'training'
