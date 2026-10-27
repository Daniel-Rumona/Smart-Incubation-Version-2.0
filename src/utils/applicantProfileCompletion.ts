import type { ApplicantProfileBundle } from '@/types/applicant'

/** The details an SME's profile needs before it counts as complete. Shared by the profile page and the SME dashboard. */
export const REQUIRED_PROFILE_FIELDS = [
    'participantName',
    'email',
    'phone',
    'gender',
    'businessName',
    'sector',
    'natureOfBusiness',
    'yearsOfTrading',
    'province',
    'city',
    'businessAddress',
] as const

export const hasProfileFieldValue = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== ''

/** The profile's fields in one flat record, as the profile page reads them. */
export const profileValuesFromBundle = (bundle: ApplicantProfileBundle | null | undefined, user: { displayName?: string | null; email?: string | null }) => {
    const ownership = (bundle?.businessProfile.ownership || {}) as Record<string, unknown>
    const values = { ...(bundle?.applicantProfile || {}), ...(bundle?.businessProfile || {}), ...ownership } as Record<string, unknown>
    return {
        ...values,
        participantName: values.participantName || values.fullName || user.displayName || '',
        email: user.email || values.email || '',
    } as Record<string, unknown>
}

/** How complete the profile is (0–100), and which required details are still missing. */
export const profileCompletion = (values: Record<string, unknown>) => {
    const missing = REQUIRED_PROFILE_FIELDS.filter((field) => !hasProfileFieldValue(values[field]))
    return { percent: Math.round(((REQUIRED_PROFILE_FIELDS.length - missing.length) / REQUIRED_PROFILE_FIELDS.length) * 100), missing }
}
