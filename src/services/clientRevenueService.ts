import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'
import type { ClientFunderSummary, ClientRevenueEntry, ClientRevenueValues, RevenueService, RevenueStatus, TrainingFunder, TrainingFunderAccount } from '@/types/clientRevenue'

/**
 * The client-module company's own income (training and ESG reporting) and its funder's read-only report. Revenue
 * entries carry the company code like every client-module record; the funder never reads them directly, only the
 * totals that getClientFunderSummary (functions/src/clientFunderSummary.ts) works out.
 */

const REVENUE = 'clientRevenue'
const STAFF_ROLES = new Set<string>(['projectadmin', 'operations'])

const companyOf = (user?: FullIdentity | null) => {
    if (!user || !STAFF_ROLES.has(user.role) || !String(user.companyCode || '').trim()) throw new Error('forbidden')
    return String(user.companyCode).trim()
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const now = () => new Date().toISOString()
const SERVICES: RevenueService[] = ['training', 'esg_reporting', 'other']

export const toRevenueEntry = (id: string, data: Record<string, unknown>): ClientRevenueEntry => ({
    id,
    companyCode: text(data.companyCode),
    date: text(data.date),
    organisation: text(data.organisation),
    service: SERVICES.includes(data.service as RevenueService) ? data.service as RevenueService : 'other',
    ...(text(data.classId) ? { classId: text(data.classId) } : {}),
    ...(text(data.reportId) ? { reportId: text(data.reportId) } : {}),
    ...(text(data.funderId) ? { funderId: text(data.funderId) } : {}),
    description: text(data.description),
    amount: typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : 0,
    status: data.status === 'paid' ? 'paid' : 'invoiced' as RevenueStatus,
    ...(text(data.paidOn) ? { paidOn: text(data.paidOn) } : {}),
    createdAt: text(data.createdAt) || undefined,
    createdBy: text(data.createdBy) || undefined,
    updatedAt: text(data.updatedAt) || undefined,
    updatedBy: text(data.updatedBy) || undefined,
})

export const listRevenue = async (user: FullIdentity) => {
    const companyCode = companyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), REVENUE), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => toRevenueEntry(row.id, row.data())).sort((a, b) => b.date.localeCompare(a.date))
}

const clean = (values: ClientRevenueValues) => ({
    date: values.date,
    organisation: values.organisation.trim(),
    service: values.service,
    classId: values.service === 'training' ? values.classId || null : null,
    reportId: values.service === 'esg_reporting' ? values.reportId || null : null,
    funderId: values.funderId || null,
    description: values.description.trim(),
    amount: Math.round(Number(values.amount) * 100) / 100,
    status: values.status,
    paidOn: values.status === 'paid' ? values.paidOn || values.date : null,
})

export const addRevenue = async (user: FullIdentity, values: ClientRevenueValues) => {
    const companyCode = companyOf(user)
    const created = await addDoc(collection(getFirebaseDb(), REVENUE), { ...clean(values), companyCode, createdAt: now(), createdBy: user.uid, updatedAt: now(), updatedBy: user.uid })
    return created.id
}

export const updateRevenue = async (user: FullIdentity, entryId: string, values: ClientRevenueValues) => {
    companyOf(user)
    await updateDoc(doc(getFirebaseDb(), REVENUE, entryId), { ...clean(values), updatedAt: now(), updatedBy: user.uid })
}

export const deleteRevenue = async (user: FullIdentity, entryId: string) => {
    companyOf(user)
    await deleteDoc(doc(getFirebaseDb(), REVENUE, entryId))
}

/**
 * The funder report: totals only, worked out on the server. A funder always gets what it funded; staff get the whole
 * company, or one funder's view (`funderId`) to check what that funder sees.
 */
export const getFunderSummary = async (funderId?: string) => {
    if (!firebaseApp) throw new Error('unavailable')
    const callable = httpsCallable<{ funderId?: string }, ClientFunderSummary>(getFunctions(firebaseApp, 'us-central1'), 'getClientFunderSummary')
    return (await callable(funderId ? { funderId } : {})).data
}

const FUNDERS = 'trainingFunders'

const toFunder = (id: string, data: Record<string, unknown>): TrainingFunder => ({
    id,
    companyCode: text(data.companyCode),
    name: text(data.name),
    contactName: text(data.contactName),
    contactEmail: text(data.contactEmail).toLowerCase(),
})

/** The company's funders, for "Funded by" and the funder report. */
export const listTrainingFunders = async (user: FullIdentity) => {
    const companyCode = companyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), FUNDERS), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => toFunder(row.id, row.data())).sort((left, right) => left.name.localeCompare(right.name))
}

export const saveTrainingFunder = async (user: FullIdentity, values: Pick<TrainingFunder, 'name' | 'contactName' | 'contactEmail'>, existing?: TrainingFunder) => {
    const companyCode = companyOf(user)
    const clean = { name: values.name.trim(), contactName: values.contactName.trim(), contactEmail: values.contactEmail.trim().toLowerCase() }
    if (!clean.name) throw new Error('name_required')
    if (existing) {
        await updateDoc(doc(getFirebaseDb(), FUNDERS, existing.id), { ...clean, updatedAt: now(), updatedBy: user.uid })
        return existing.id
    }
    return (await addDoc(collection(getFirebaseDb(), FUNDERS), { ...clean, companyCode, createdAt: now(), createdBy: user.uid, updatedAt: now(), updatedBy: user.uid })).id
}

/**
 * Gives one of the company's funders a sign-in (role `funder`, users.funderId), with an email to set a password
 * (inviteTrainingFunder). Returns the set-password link the email carries.
 */
export const inviteFunder = async (values: { funderId: string, name: string, email: string }) => {
    if (!firebaseApp) throw new Error('functions_unavailable')
    const callable = httpsCallable<typeof values, { uid: string, setPasswordLink: string | null }>(getFunctions(firebaseApp, 'us-central1'), 'inviteTrainingFunder')
    try {
        return (await callable({ ...values, name: values.name.trim(), email: values.email.trim().toLowerCase() })).data
    } catch (error) {
        const code = String((error as { code?: string })?.code || '')
        if (code.endsWith('already-exists')) throw new Error('email_already_exists', { cause: error })
        throw error
    }
}

/** The company's funder accounts, to show who has access to which funder's report. */
export const listFunders = async (user: FullIdentity): Promise<TrainingFunderAccount[]> => {
    const companyCode = companyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), 'users'), where('companyCode', '==', companyCode), where('role', '==', 'funder')))
    return snapshot.docs
        .filter((row) => row.data().status !== 'deleted')
        .map((row) => ({ uid: row.id, name: text(row.data().name) || text(row.data().displayName), email: text(row.data().email), funderId: text(row.data().funderId) }))
}
