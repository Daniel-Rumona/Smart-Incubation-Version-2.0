import { COMPLIANCE_DOCUMENT_CATALOGUE } from '@/config/complianceDocuments'

/**
 * The details a training company may ask of its client companies and their learners, taken from what the rest of
 * Smartinc already asks of SMEs (the business profile, components/applicant/businessProfileSectionsConfig.tsx, and the
 * compliance documents, config/complianceDocuments.ts). The facilitator chooses which of them to ask for
 * (trainingSettings/{company}); the company's director fills them in after their invite, and learners theirs.
 * The funder report counts them: women and men trained, youth, disability, baseline revenue, employees, B-BBEE level.
 */

export type DetailFieldKind = 'text' | 'paragraph' | 'select' | 'date' | 'number' | 'percent' | 'money'

export type DetailField = {
    key: string
    label: string
    kind: DetailFieldKind
    options?: Array<{ value: string, label: string }>
    /** Shown under the field. */
    help?: string
}

const PROVINCES = ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Western Cape', 'Outside South Africa']
const option = (value: string, label = value) => ({ value, label })

export const COMPANY_DETAIL_FIELDS: DetailField[] = [
    { key: 'registrationNumber', label: 'Registration number (CIPC)', kind: 'text' },
    { key: 'dateOfRegistration', label: 'Date registered', kind: 'date' },
    { key: 'sector', label: 'Sector', kind: 'text' },
    { key: 'natureOfBusiness', label: 'What the business does', kind: 'paragraph' },
    { key: 'yearsOfTrading', label: 'Years of trading', kind: 'number' },
    { key: 'beeLevel', label: 'B-BBEE level', kind: 'select', options: [...['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8'].map((level) => option(level)), option('Non-compliant'), option('Not sure')] },
    { key: 'blackOwnedPercent', label: 'Black-owned %', kind: 'percent' },
    { key: 'femaleOwnedPercent', label: 'Female-owned %', kind: 'percent' },
    { key: 'youthOwnedPercent', label: 'Youth-owned %', kind: 'percent' },
    { key: 'businessAddress', label: 'Business address', kind: 'text' },
    { key: 'city', label: 'City / town', kind: 'text' },
    { key: 'province', label: 'Province', kind: 'select', options: PROVINCES.map((province) => option(province)) },
    { key: 'employees', label: 'Number of employees', kind: 'number' },
    { key: 'baselineRevenue', label: 'Annual revenue (baseline)', kind: 'money', help: 'The latest full year\'s revenue, before the training.' },
]

export const COMPANY_DOCUMENTS = COMPLIANCE_DOCUMENT_CATALOGUE.map((entry) => ({ key: entry.key, label: entry.name }))

export const LEARNER_DETAIL_FIELDS: DetailField[] = [
    { key: 'gender', label: 'Gender', kind: 'select', options: [option('female', 'Female'), option('male', 'Male'), option('prefer_not_to_say', 'Prefer not to say')] },
    { key: 'dateOfBirth', label: 'Date of birth', kind: 'date' },
    { key: 'populationGroup', label: 'Population group (for B-BBEE reporting)', kind: 'select', options: [option('african', 'African'), option('coloured', 'Coloured'), option('indian', 'Indian'), option('white', 'White'), option('other', 'Other'), option('prefer_not_to_say', 'Prefer not to say')] },
    { key: 'disabilityStatus', label: 'Disability', kind: 'select', options: [option('yes', 'Yes'), option('no', 'No'), option('prefer_not_to_say', 'Prefer not to say')] },
    { key: 'educationLevel', label: 'Highest education', kind: 'select', options: ['primary', 'secondary', 'certificate', 'diploma', 'degree', 'postgraduate', 'other'].map((value) => option(value, value === 'postgraduate' ? 'Postgraduate' : value[0].toUpperCase() + value.slice(1))) },
    { key: 'jobTitle', label: 'Job title', kind: 'text' },
]

export type TrainingDetailsSettings = {
    companyFields: string[]
    companyDocuments: string[]
    learnerFields: string[]
}

/** What is asked until the facilitator chooses (a short list, as she asked). */
export const DEFAULT_DETAILS_SETTINGS: TrainingDetailsSettings = {
    companyFields: ['registrationNumber', 'sector', 'beeLevel', 'businessAddress', 'province', 'employees', 'baselineRevenue'],
    companyDocuments: ['cipc-registration', 'b-bbee-certificate', 'tax-compliance'],
    learnerFields: ['gender', 'disabilityStatus', 'jobTitle'],
}

const known = (keys: unknown, catalogue: Array<{ key: string }>, fallback: string[]) =>
    Array.isArray(keys) ? catalogue.map((item) => item.key).filter((key) => keys.includes(key)) : fallback

/** The settings as stored, limited to fields the catalogue knows, in catalogue order. */
export const toDetailsSettings = (data?: Record<string, unknown> | null): TrainingDetailsSettings => ({
    companyFields: known(data?.companyFields, COMPANY_DETAIL_FIELDS, DEFAULT_DETAILS_SETTINGS.companyFields),
    companyDocuments: known(data?.companyDocuments, COMPANY_DOCUMENTS, DEFAULT_DETAILS_SETTINGS.companyDocuments),
    learnerFields: known(data?.learnerFields, LEARNER_DETAIL_FIELDS, DEFAULT_DETAILS_SETTINGS.learnerFields),
})

export const fieldsFor = (catalogue: DetailField[], keys: string[]) => catalogue.filter((field) => keys.includes(field.key))

/** How a stored detail reads: the option's label, a formatted amount, or the text itself. */
export const detailLabel = (field: DetailField, value: unknown) => {
    if (value === undefined || value === null || value === '') return ''
    if (field.kind === 'select') return field.options?.find((item) => item.value === value)?.label || String(value)
    if (field.kind === 'money') return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(Number(value))
    if (field.kind === 'percent') return `${value}%`
    return String(value)
}
