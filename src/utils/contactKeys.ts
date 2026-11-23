/**
 * Comparable forms of a business's contact details, stored next to the details themselves so duplicate checks and
 * sign-up matching are plain equality lookups: the phone in international form (South African numbers by default),
 * the email in lower case, the company registration number in capitals without spaces or slashes.
 * An empty string means "nothing usable to compare".
 */

export const emailKey = (value: unknown): string => {
    const email = String(value ?? '').trim().toLowerCase()
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

export const phoneKey = (value: unknown, defaultCountryCode = '27'): string => {
    const raw = String(value ?? '').trim()
    let digits = raw.replace(/\D/g, '')
    if (!digits) return ''
    if (raw.startsWith('+')) return digits.length >= 9 ? `+${digits}` : ''
    if (digits.startsWith('00')) digits = digits.slice(2)
    else if (digits.startsWith('0')) digits = `${defaultCountryCode}${digits.slice(1)}`
    else if (digits.length <= 9) digits = `${defaultCountryCode}${digits}`
    return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : ''
}

export const registrationKey = (value: unknown): string => {
    const key = String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    return key.length >= 4 ? key : ''
}

export type ContactKeys = { phone: string, email: string, registration: string }

export const contactKeys = (details: { phone?: unknown, email?: unknown, registrationNumber?: unknown }): ContactKeys => ({
    phone: phoneKey(details.phone),
    email: emailKey(details.email),
    registration: registrationKey(details.registrationNumber),
})

/** Which of the keys two records share ('phone', 'email', 'registration'). */
export const sharedKeys = (a: ContactKeys, b: ContactKeys): Array<keyof ContactKeys> =>
    (['phone', 'email', 'registration'] as const).filter((key) => a[key] !== '' && a[key] === b[key])
