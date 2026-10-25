import { catalogueEntryFor, requirementKeyFor } from '@/config/complianceDocuments'
import { loadMyCompliance, saveMyComplianceDocument } from '@/services/incubateeComplianceService'
import type { FullIdentity } from '@/types/identity'

/**
 * Upload entry point for the Agentic workspace. Goes through the same save as the compliance page,
 * so documents land under one id per programme and type, where operations reviews them.
 */
export const uploadIncubateeComplianceDocument = async (
    user: FullIdentity,
    values: { type: string, file: File, issueDate?: string, expiryDate?: string },
) => {
    const compliance = await loadMyCompliance(user)
    const key = requirementKeyFor(values.type)
    const document = compliance.documents.find((item) => item.key === key) || {
        key,
        name: catalogueEntryFor(values.type)?.name || values.type,
        required: false,
        status: 'missing' as const,
        expiringSoon: false,
        comment: '',
        url: null,
        fileName: null,
        issueDate: null,
        expiryDate: null,
        documentId: null,
    }

    await saveMyComplianceDocument(user, compliance, {
        document,
        file: values.file,
        issueDate: values.issueDate || null,
        expiryDate: values.expiryDate || null,
    })
}
