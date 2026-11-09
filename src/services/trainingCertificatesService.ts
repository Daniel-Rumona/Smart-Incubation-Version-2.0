import {
    collection,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    runTransaction,
    updateDoc,
    where,
    writeBatch,
    type DocumentData,
    type Unsubscribe,
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { getFirebaseDb } from '@/config/firebase'
import { trainingCompanyOf } from '@/services/trainingService'
import type { FullIdentity } from '@/types/identity'
import type { CertificateVerification, TrainingCertificate, TrainingCertificateStatus, TrainingClass, TrainingLearner } from '@/types/training'

/**
 * Certificates of completion.
 *
 * `trainingCertificates/{id}` holds the full certificate for the company's staff and the learner; the matching
 * `certificateVerifications/{id}` holds only what a stranger checking the certificate may see (name, course, dates,
 * provider, status) and is readable by anyone who has the id - the link and QR code printed on the certificate.
 * Numbers run per company per year (TNS-2026-0001) from `trainingCertificateCounters/{company}_{year}`.
 */

const CERTIFICATES = 'trainingCertificates'
const VERIFICATIONS = 'certificateVerifications'
const COUNTERS = 'trainingCertificateCounters'
const LEARNERS = 'trainingLearners'

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const optionalText = (value: unknown) => text(value) || undefined
const now = () => new Date().toISOString()

const toStatus = (value: unknown): TrainingCertificateStatus => (value === 'cancelled' ? 'cancelled' : 'valid')

export const toTrainingCertificate = (id: string, data: DocumentData): TrainingCertificate => ({
    id,
    companyCode: text(data.companyCode),
    classId: text(data.classId),
    learnerId: text(data.learnerId),
    learnerUid: optionalText(data.learnerUid),
    certificateNumber: text(data.certificateNumber),
    learnerName: text(data.learnerName),
    organisation: text(data.organisation),
    courseTitle: text(data.courseTitle),
    trainingDates: text(data.trainingDates),
    deliveryLabel: text(data.deliveryLabel),
    providerName: text(data.providerName),
    logoUrl: optionalText(data.logoUrl),
    partnerLogoUrl: optionalText(data.partnerLogoUrl),
    signatoryName: text(data.signatoryName),
    signatureUrl: optionalText(data.signatureUrl),
    issuedOn: text(data.issuedOn),
    issuedAt: text(data.issuedAt),
    issuedBy: text(data.issuedBy),
    status: toStatus(data.status),
    cancelledAt: optionalText(data.cancelledAt),
    cancelReason: optionalText(data.cancelReason),
    replacedBy: optionalText(data.replacedBy),
})

const toVerification = (data: DocumentData): CertificateVerification => ({
    certificateNumber: text(data.certificateNumber),
    learnerName: text(data.learnerName),
    courseTitle: text(data.courseTitle),
    trainingDates: text(data.trainingDates),
    providerName: text(data.providerName),
    issuedOn: text(data.issuedOn),
    status: toStatus(data.status),
    cancelledAt: optionalText(data.cancelledAt),
})

/** The public link printed on the certificate and in its QR code. */
export const certificateVerifyUrl = (certificateId: string, origin = window.location.origin) => `${origin}/verify/${certificateId}`

export const subscribeClassCertificates = (
    user: FullIdentity,
    classId: string,
    onRows: (rows: TrainingCertificate[]) => void,
    onError: (error: Error) => void,
): Unsubscribe => {
    const companyCode = trainingCompanyOf(user)
    return onSnapshot(
        query(collection(getFirebaseDb(), CERTIFICATES), where('companyCode', '==', companyCode), where('classId', '==', classId)),
        (snapshot) => onRows(snapshot.docs.map((row) => toTrainingCertificate(row.id, row.data()))),
        onError,
    )
}

/** What is printed on a certificate: the class, the company and the issuing facilitator, as they are now. */
export type CertificateIssueDetails = {
    trainingClass: TrainingClass
    trainingDates: string
    deliveryLabel: string
    providerName: string
    logoUrl?: string
    partnerLogoUrl?: string
}

/**
 * Issues the learner's certificate for the class, unless they already have a valid one (several facilitators may
 * have the class open; the transaction makes sure only one certificate is issued). Returns the certificate id, or
 * null when one already existed.
 */
export const issueTrainingCertificate = async (user: FullIdentity, learner: TrainingLearner, details: CertificateIssueDetails) => {
    const companyCode = trainingCompanyOf(user)
    const db = getFirebaseDb()
    const learnerRef = doc(db, LEARNERS, learner.id)
    const certificateRef = doc(collection(db, CERTIFICATES))
    const year = dayjs().year()
    const counterRef = doc(db, COUNTERS, `${companyCode}_${year}`)

    return runTransaction(db, async (transaction) => {
        const learnerSnapshot = await transaction.get(learnerRef)
        if (!learnerSnapshot.exists()) throw new Error('learner_missing')
        const currentId = text(learnerSnapshot.data().certificateId)
        if (currentId) {
            const current = await transaction.get(doc(db, CERTIFICATES, currentId))
            if (current.exists() && toStatus(current.data().status) === 'valid') return null
        }
        const counter = await transaction.get(counterRef)
        const sequence = counter.exists() && typeof counter.data().next === 'number' ? counter.data().next as number : 1
        const certificateNumber = `${companyCode}-${year}-${String(sequence).padStart(4, '0')}`
        const issuedOn = dayjs().format('YYYY-MM-DD')
        const learnerData = learnerSnapshot.data()
        const learnerName = text(learnerData.name) || learner.name
        const shared = {
            companyCode,
            certificateNumber,
            learnerName,
            courseTitle: details.trainingClass.courseTitle,
            trainingDates: details.trainingDates,
            providerName: details.providerName,
            issuedOn,
            status: 'valid',
        }
        transaction.set(counterRef, { companyCode, year, next: sequence + 1, updatedAt: now() })
        transaction.set(certificateRef, {
            ...shared,
            classId: details.trainingClass.id,
            learnerId: learner.id,
            ...(text(learnerData.uid) ? { learnerUid: text(learnerData.uid) } : {}),
            organisation: text(learnerData.organisation) || learner.organisation,
            // The client company's people see the certificates of their own people.
            ...(text(learnerData.organisationId) ? { organisationId: text(learnerData.organisationId) } : {}),
            deliveryLabel: details.deliveryLabel,
            ...(details.logoUrl ? { logoUrl: details.logoUrl } : {}),
            ...(details.partnerLogoUrl ? { partnerLogoUrl: details.partnerLogoUrl } : {}),
            signatoryName: user.displayName || user.name || '',
            ...(user.signatureURL ? { signatureUrl: user.signatureURL } : {}),
            issuedAt: now(),
            issuedBy: user.uid,
        })
        transaction.set(doc(db, VERIFICATIONS, certificateRef.id), shared)
        transaction.update(learnerRef, { certificateId: certificateRef.id, updatedAt: now() })
        return certificateRef.id
    })
}

/** Cancels a certificate; its verification page then says it is no longer valid. Certificates are never deleted. */
export const cancelTrainingCertificate = async (user: FullIdentity, certificate: TrainingCertificate, reason: string, replacedBy?: string) => {
    trainingCompanyOf(user)
    const db = getFirebaseDb()
    const cancelledAt = now()
    const batch = writeBatch(db)
    batch.update(doc(db, CERTIFICATES, certificate.id), {
        status: 'cancelled',
        cancelledAt,
        cancelReason: reason.trim(),
        ...(replacedBy ? { replacedBy } : {}),
        cancelledBy: user.uid,
    })
    batch.update(doc(db, VERIFICATIONS, certificate.id), { status: 'cancelled', cancelledAt })
    await batch.commit()
}

/** Replaces a certificate (for example after correcting the learner's name): the old one is cancelled, a new number issued. */
export const reissueTrainingCertificate = async (
    user: FullIdentity,
    certificate: TrainingCertificate,
    learner: TrainingLearner,
    details: CertificateIssueDetails,
) => {
    await cancelTrainingCertificate(user, certificate, 'Reissued')
    const id = await issueTrainingCertificate(user, learner, details)
    if (id) await updateDoc(doc(getFirebaseDb(), CERTIFICATES, certificate.id), { replacedBy: id })
    return id
}

/** The learner's own certificates. */
export const listMyCertificates = async (user: FullIdentity) => {
    if (user.role !== 'learner') throw new Error('forbidden')
    const companyCode = String(user.companyCode || '').trim()
    if (!companyCode) return []
    const snapshot = await getDocs(query(collection(getFirebaseDb(), CERTIFICATES), where('companyCode', '==', companyCode), where('learnerUid', '==', user.uid)))
    return snapshot.docs.map((row) => toTrainingCertificate(row.id, row.data()))
}

/** Public: the verification record behind a certificate's link (no sign-in needed). */
export const getCertificateVerification = async (certificateId: string) => {
    const snapshot = await getDoc(doc(getFirebaseDb(), VERIFICATIONS, certificateId))
    return snapshot.exists() ? toVerification(snapshot.data()) : null
}
