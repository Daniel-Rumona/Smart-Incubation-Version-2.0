import type { BusinessDirector } from '@/types/applicant'

/** National Youth Development Agency definition: 35 and under. */
export const YOUTH_MAX_AGE = 35

const BLACK_GROUPS: BusinessDirector['race'][] = ['African', 'Coloured', 'Indian']

/**
 * Age from a South African ID number (YYMMDD…). The century is the one that puts the birthday
 * in the past; `null` when the number does not start with a real date.
 */
export const ageFromSaIdNumber = (idNumber: string | undefined, today = new Date()) => {
    const digits = String(idNumber || '').replace(/\D/g, '')
    if (digits.length < 6) return null
    const yy = Number(digits.slice(0, 2))
    const month = Number(digits.slice(2, 4))
    const day = Number(digits.slice(4, 6))
    const currentYy = today.getFullYear() % 100
    const year = (yy > currentYy ? 1900 : 2000) + yy
    const birthday = new Date(year, month - 1, day)
    if (birthday.getMonth() !== month - 1 || birthday.getDate() !== day) return null
    let age = today.getFullYear() - year
    if (today < new Date(today.getFullYear(), month - 1, day)) age -= 1
    return age
}

/** Gender from a South African ID number: digits 7–10 are 0000–4999 for female, 5000–9999 for male. */
export const genderFromSaIdNumber = (idNumber: string | undefined): BusinessDirector['gender'] | null => {
    const digits = String(idNumber || '').replace(/\D/g, '')
    if (digits.length < 10) return null
    return Number(digits.slice(6, 10)) < 5000 ? 'Female' : 'Male'
}

const shareOf =(directors: BusinessDirector[], include: (director: BusinessDirector) => boolean) =>
    Math.round(directors.filter(include).reduce((sum, director) => sum + (Number(director.sharePercent) || 0), 0) * 100) / 100

/** Black-, female- and youth-owned percentages, summed from each director's share. */
export const ownershipFromDirectors = (directors: BusinessDirector[]) => ({
    blackOwnedPercent: shareOf(directors, (director) => BLACK_GROUPS.includes(director.race)),
    femaleOwnedPercent: shareOf(directors, (director) => director.gender === 'Female'),
    youthOwnedPercent: shareOf(directors, (director) => {
        const age = ageFromSaIdNumber(director.idNumber)
        return age !== null && age <= YOUTH_MAX_AGE
    }),
})

export const totalShare = (directors: BusinessDirector[]) => shareOf(directors, () => true)

type ProfileLike = {
    participantName?: string
    fullName?: string
    idNumber?: string
    gender?: string
    phone?: string
    email?: string
    disabilityStatus?: string
}

/** The SME's own profile details as a director, ready to complete with race and share. */
export const selfAsDirector = (profile?: ProfileLike): Partial<BusinessDirector> | undefined => {
    const fullName = profile?.participantName || profile?.fullName
    if (!fullName) return undefined
    return {
        fullName,
        idNumber: profile?.idNumber,
        gender: profile?.gender === 'Male' || profile?.gender === 'Female' ? profile.gender : undefined,
        phone: profile?.phone,
        email: profile?.email,
        disabilityStatus: profile?.disabilityStatus,
    }
}
