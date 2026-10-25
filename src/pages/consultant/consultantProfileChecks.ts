import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'

// Phone numbers for the two supported countries: a dialling code plus 9 local digits.
export const diallingCodeForCountry = (country: string) => country === 'South Africa' ? '+27' : country === 'Zimbabwe' ? '+263' : ''
export const localPhoneNumber = (phone: string) => phone.replace(/^\+(?:27|263)/, '').replace(/\D/g, '').replace(/^0/, '')
export const expectedPhoneLengthForCountry = (country: string) => diallingCodeForCountry(country) ? 9 : 0

export type ConsultantProfileCheckKey = 'headline' | 'expertise' | 'location' | 'phone' | 'availability' | 'photo'

/**
 * What a complete, publishable marketplace profile needs. Shared by the profile page's checklist and the
 * dashboard's profile card, so both always count the same way. The photo is the only optional item.
 */
export const consultantProfileChecks = (profile: ConsultantMarketplaceProfile): Array<{ key: ConsultantProfileCheckKey; done: boolean; required: boolean }> => {
    const expectedLength = expectedPhoneLengthForCountry(profile.country)
    const phoneValid = expectedLength > 0 && localPhoneNumber(profile.phone).length === expectedLength
    return [
        { key: 'headline', done: !!profile.headline.trim() && !!profile.bio.trim(), required: true },
        { key: 'expertise', done: profile.specialties.length > 0 && profile.services.length > 0 && profile.services.every((service) => service.areaOfSupport && service.rate > 0), required: true },
        { key: 'location', done: !!profile.country && !!profile.province && !!(profile.physicalAddress || profile.operatingLocation) && !!profile.currency, required: true },
        { key: 'phone', done: phoneValid && !!profile.phoneProvider, required: true },
        { key: 'availability', done: profile.availability.length > 0, required: true },
        { key: 'photo', done: !!profile.profileImageUrl, required: false },
    ]
}
