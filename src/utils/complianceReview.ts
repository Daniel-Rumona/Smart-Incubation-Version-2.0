import type { ComplianceDocument, ComplianceScanFinding } from '../types/compliance'

export const hasComplianceFile = (document: ComplianceDocument) => Boolean(document.url?.trim())
export const complianceReviewStatus = (document: ComplianceDocument, today = new Date().toLocaleDateString('en-CA')) => {
    if (!hasComplianceFile(document)) return 'missing'
    if (document.currentStatus === 'expired' || (document.expiryDate && document.expiryDate < today)) return 'expired'
    if (document.currentStatus === 'queried' || document.currentStatus === 'invalid' || document.verificationStatus === 'queried') return 'queried'
    if (document.currentStatus === 'valid' && document.verificationStatus === 'verified') return 'verified'
    return 'pending'
}

/** Metadata-only fallback for servers that still return totals without document findings. */
export const localComplianceFinding = (document: ComplianceDocument): ComplianceScanFinding => {
    const messages = {
        missing: 'No file attached. Upload a document before review.',
        expired: 'The recorded expiry date has passed or this document is marked expired. Upload a current copy.',
        queried: 'This document needs changes. Resolve the review query and upload a corrected copy.',
        verified: 'A file is attached and the document is already verified. No recorded expiry issue found.',
        pending: 'A file is attached. Open the document and verify it or raise a query.',
    }
    return {
        documentId: document.id,
        url: document.url,
        expiryDate: document.expiryDate,
        currentStatus: document.currentStatus,
        verificationStatus: document.verificationStatus,
        message: messages[complianceReviewStatus(document)] + (!document.expiryDate ? ' No expiry date is recorded.' : ''),
    }
}
