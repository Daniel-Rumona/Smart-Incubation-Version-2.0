import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import { toEsgReport } from '@/services/esgReportsService'
import { canManageTraining } from '@/services/trainingService'
import { toTrainingCertificate } from '@/services/trainingCertificatesService'
import type { FullIdentity } from '@/types/identity'
import type { TrainingOrgMetric, TrainingOrganisation, OrganisationLearnerResult } from '@/types/training'

/**
 * What a client company (role clientorg) reads of its own training beyond its people: their certificates, their
 * assessment results (scores only, from getOrganisationTrainingResults), its ESG reports once they are in review or
 * final, and the business figures it records over time. firestore.rules checks each against users.organisationId.
 */

const METRICS = 'trainingOrgMetrics'
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const now = () => new Date().toISOString()

const ownOrganisationOf = (user?: FullIdentity | null) => {
    const companyCode = text(user?.companyCode)
    const organisationId = text(user?.organisationId)
    if (!user || user.role !== 'clientorg' || !companyCode || !organisationId) throw new Error('forbidden')
    return { companyCode, organisationId }
}

export const listMyOrganisationCertificates = async (user: FullIdentity) => {
    const own = ownOrganisationOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), 'trainingCertificates'), where('companyCode', '==', own.companyCode), where('organisationId', '==', own.organisationId)))
    return snapshot.docs.map((row) => toTrainingCertificate(row.id, row.data())).sort((a, b) => b.issuedOn.localeCompare(a.issuedOn))
}

export const getMyOrganisationResults = async () => {
    if (!firebaseApp) throw new Error('unavailable')
    const callable = httpsCallable<void, OrganisationLearnerResult[]>(getFunctions(firebaseApp, 'us-central1'), 'getOrganisationTrainingResults')
    return (await callable()).data
}

/** The company's ESG reports that its training provider has shared: in review or final. */
export const listMyOrganisationEsgReports = async (user: FullIdentity) => {
    const own = ownOrganisationOf(user)
    const snapshot = await getDocs(query(
        collection(getFirebaseDb(), 'esgReports'),
        where('companyCode', '==', own.companyCode),
        where('organisationId', '==', own.organisationId),
        where('status', 'in', ['in_review', 'final']),
    ))
    return snapshot.docs.map((row) => toEsgReport(row.id, row.data())).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))
}

// ---------------------------------------------------------------------------------------------------------------
// Business figures over time
// ---------------------------------------------------------------------------------------------------------------

const toMetric = (id: string, data: Record<string, unknown>): TrainingOrgMetric => ({
    id,
    companyCode: text(data.companyCode),
    organisationId: text(data.organisationId),
    period: text(data.period),
    revenue: typeof data.revenue === 'number' ? data.revenue : 0,
    employees: typeof data.employees === 'number' ? data.employees : undefined,
    recordedAt: text(data.recordedAt) || undefined,
})

const mayEdit = (user: FullIdentity, organisation: Pick<TrainingOrganisation, 'id'>) =>
    canManageTraining(user) || (user.role === 'clientorg' && user.organisationId === organisation.id)

/** One company's figures, oldest first. */
export const listOrganisationMetrics = async (user: FullIdentity, organisation: Pick<TrainingOrganisation, 'id' | 'companyCode'>) => {
    if (!mayEdit(user, organisation)) throw new Error('forbidden')
    const snapshot = await getDocs(query(collection(getFirebaseDb(), METRICS), where('companyCode', '==', organisation.companyCode), where('organisationId', '==', organisation.id)))
    return snapshot.docs.map((row) => toMetric(row.id, row.data())).sort((a, b) => a.period.localeCompare(b.period))
}

/** One month's figures (`period` YYYY-MM); recording a month again replaces it. */
export const saveOrganisationMetric = async (user: FullIdentity, organisation: Pick<TrainingOrganisation, 'id' | 'companyCode'>, values: { period: string, revenue: number, employees?: number | null }) => {
    if (!mayEdit(user, organisation)) throw new Error('forbidden')
    if (!/^\d{4}-\d{2}$/.test(values.period)) throw new Error('invalid_period')
    await setDoc(doc(getFirebaseDb(), METRICS, `${organisation.id}_${values.period}`), {
        companyCode: organisation.companyCode,
        organisationId: organisation.id,
        period: values.period,
        revenue: Math.max(0, Math.round(Number(values.revenue) || 0)),
        employees: typeof values.employees === 'number' && Number.isFinite(values.employees) ? Math.max(0, Math.round(values.employees)) : null,
        recordedAt: now(),
        recordedBy: user.uid,
    })
}

export const deleteOrganisationMetric = async (user: FullIdentity, organisation: Pick<TrainingOrganisation, 'id'>, metric: TrainingOrgMetric) => {
    if (!mayEdit(user, organisation)) throw new Error('forbidden')
    await deleteDoc(doc(getFirebaseDb(), METRICS, metric.id))
}
