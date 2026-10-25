export const PHONE_PROVIDERS_BY_COUNTRY: Record<string, string[]> = {
  'South Africa': ['Vodacom', 'MTN', 'Cell C', 'Telkom', 'Rain', 'Other'],
  Zimbabwe: ['Econet', 'NetOne', 'Telecel', 'Other'],
}

export const PHONE_PROVIDERS = Array.from(new Set(Object.values(PHONE_PROVIDERS_BY_COUNTRY).flat()))

const DIALLING_CODES: Array<[string, string]> = [['+263', 'Zimbabwe'], ['+27', 'South Africa']]

/** Country implied by the leading dialling code of a phone number, or '' when it isn't one we support. */
export const countryFromPhone = (phone?: string) => {
  const compact = String(phone || '').replace(/[\s-]/g, '').replace(/^00/, '+')
  return DIALLING_CODES.find(([code]) => compact.startsWith(code))?.[1] || ''
}

export const providersForCountry = (country?: string) => (country && PHONE_PROVIDERS_BY_COUNTRY[country]) || PHONE_PROVIDERS
