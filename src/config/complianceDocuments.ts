import { doc, getDoc } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'

export type ComplianceDocumentCategory = 'identity' | 'legal' | 'financial'

export type ComplianceCatalogueEntry = {
    key: string
    name: string
    category: ComplianceDocumentCategory
    /** Older names the same document was stored under, so earlier uploads still match. */
    aliases: string[]
}

/**
 * The one list of compliance documents the platform knows about. Each programme picks which of
 * these it requires (programs/{id}.complianceRequirements); SMEs, operations and the dashboards all
 * score against that programme's selection.
 */
export const COMPLIANCE_DOCUMENT_CATALOGUE: ComplianceCatalogueEntry[] = [
    { key: 'id-document', name: 'ID document', category: 'identity', aliases: ['Certified ID Copy', 'ID copy'] },
    { key: 'proof-of-address', name: 'Proof of address', category: 'identity', aliases: [] },
    { key: 'cipc-registration', name: 'CIPC registration', category: 'legal', aliases: ['CIPC', 'CIPC documents'] },
    { key: 'tax-compliance', name: 'Tax compliance (PIN or clearance)', category: 'legal', aliases: ['Tax PIN', 'Tax clearance', 'Tax compliance'] },
    { key: 'b-bbee-certificate', name: 'B-BBEE certificate', category: 'legal', aliases: ['BBBEE certificate', 'B-BBEE affidavit'] },
    { key: 'bank-confirmation', name: 'Bank confirmation letter', category: 'financial', aliases: ['Bank confirmation'] },
    { key: 'bank-statements', name: "Three months' bank statements", category: 'financial', aliases: ['Three Months Bank Statements', 'Bank statements'] },
    { key: 'management-accounts', name: 'Management accounts', category: 'financial', aliases: [] },
]

export const complianceKey = (value?: unknown) =>
    String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const lookup = new Map<string, ComplianceCatalogueEntry>()
COMPLIANCE_DOCUMENT_CATALOGUE.forEach((entry) => {
    [entry.key, entry.name, ...entry.aliases].forEach((name) => lookup.set(complianceKey(name), entry))
})

/** The catalogue entry a stored document type or requirement name refers to, if any. */
export const catalogueEntryFor = (name?: unknown) => lookup.get(complianceKey(name))

/** A stable key for matching documents to requirements: the catalogue key, or the cleaned name for anything custom. */
export const requirementKeyFor = (name?: unknown) => catalogueEntryFor(name)?.key || complianceKey(name)

export type ProgramDocumentRequirement = {
    key: string
    name: string
    required: boolean
}

/**
 * The documents a programme asks for. Entries that match the catalogue use its name; anything else a
 * programme added before the catalogue existed is kept as-is. With nothing configured, all of the
 * catalogue applies.
 */
export const programDocumentRequirements = (complianceRequirements: unknown): ProgramDocumentRequirement[] => {
    const configured = Array.isArray(complianceRequirements) ? complianceRequirements as Record<string, unknown>[] : []
    const seen = new Set<string>()
    const requirements = configured.flatMap((item) => {
        const rawName = String(item?.name || '').trim()
        if (!rawName) return []
        const entry = catalogueEntryFor(rawName)
        const key = entry?.key || complianceKey(rawName)
        if (seen.has(key)) return []
        seen.add(key)
        return [{ key, name: entry?.name || rawName, required: item.required !== false }]
    })

    return requirements.length
        ? requirements
        : COMPLIANCE_DOCUMENT_CATALOGUE.map((entry) => ({ key: entry.key, name: entry.name, required: true }))
}

/** Loads a programme's document requirements (all of the catalogue when there is no programme). */
export const loadProgramDocumentRequirements = async (programId?: string | null) => {
    if (!programId) return programDocumentRequirements(null)
    const snapshot = await getDoc(doc(getFirebaseDb(), 'programs', programId))
    return programDocumentRequirements(snapshot.data()?.complianceRequirements)
}
