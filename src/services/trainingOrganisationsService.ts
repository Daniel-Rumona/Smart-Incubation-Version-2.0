import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp, getFirebaseDb } from '@/config/firebase'
import { cleanLearnerDetails } from '@/services/trainingDetailsService'
import { canManageTraining, toTrainingClass, toTrainingLearner, trainingCompanyOf } from '@/services/trainingService'
import type { FullIdentity } from '@/types/identity'
import type { TrainingDetails, TrainingLearnerValues, TrainingOrgDocument, TrainingOrgMember, TrainingOrgRole, TrainingOrganisation, TrainingOrganisationValues } from '@/types/training'

/**
 * Client companies of an awareness training company.
 *
 * The training company's staff register each company (trainingOrganisations) and give it a director; the director
 * adds coordinators. Those accounts (role `clientorg`, users.organisationId) see only their own company's people:
 * the classes they are booked into, their attendance and their certificates. They can book their people into the
 * company's classes; the facilitator then invites them as learners as before. firestore.rules checks every read and
 * write against the account's own company and organisation.
 */

const ORGANISATIONS = 'trainingOrganisations'
const LEARNERS = 'trainingLearners'
const CLASSES = 'trainingClasses'

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const now = () => new Date().toISOString()

export const isClientOrg = (user?: Pick<FullIdentity, 'role'> | null) => user?.role === 'clientorg'

/** The client company account's own company and organisation; throws for anyone else. */
const ownOrganisationOf = (user?: FullIdentity | null) => {
    const companyCode = text(user?.companyCode)
    const organisationId = text(user?.organisationId)
    if (!user || !isClientOrg(user) || !companyCode || !organisationId) throw new Error('forbidden')
    return { companyCode, organisationId }
}

/** Stored answers: text and numbers only. */
export const toDetails = (value: unknown): TrainingDetails => {
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string | number] => (typeof entry[1] === 'string' && entry[1].trim() !== '') || (typeof entry[1] === 'number' && Number.isFinite(entry[1]))))
}

const toDocuments = (value: unknown): Record<string, TrainingOrgDocument> => {
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => {
        const row = (item || {}) as Record<string, unknown>
        const storagePath = text(row.storagePath)
        return storagePath ? [[key, { fileName: text(row.fileName), storagePath, contentType: text(row.contentType), uploadedAt: text(row.uploadedAt), uploadedBy: text(row.uploadedBy) }]] : []
    }))
}

export const toTrainingOrganisation = (id: string, data: Record<string, unknown>): TrainingOrganisation => ({
    id,
    companyCode: text(data.companyCode),
    name: text(data.name),
    contactName: text(data.contactName),
    contactEmail: text(data.contactEmail).toLowerCase(),
    phone: text(data.phone) || undefined,
    details: toDetails(data.details),
    documents: toDocuments(data.documents),
    detailsSubmittedAt: text(data.detailsSubmittedAt) || undefined,
    createdAt: text(data.createdAt) || undefined,
    updatedAt: text(data.updatedAt) || undefined,
})

const toMember = (uid: string, data: Record<string, unknown>): TrainingOrgMember => ({
    uid,
    name: text(data.name) || text(data.displayName),
    email: text(data.email),
    organisationId: text(data.organisationId),
    orgRole: data.orgRole === 'director' ? 'director' : 'coordinator',
    jobTitle: text(data.jobTitle),
})

// ---------------------------------------------------------------------------------------------------------------
// The training company's staff
// ---------------------------------------------------------------------------------------------------------------

export const listTrainingOrganisations = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), ORGANISATIONS), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => toTrainingOrganisation(row.id, row.data())).sort((left, right) => left.name.localeCompare(right.name))
}

const cleanOrganisation = (values: TrainingOrganisationValues) => ({
    name: values.name.trim(),
    contactName: values.contactName.trim(),
    contactEmail: values.contactEmail.trim().toLowerCase(),
    phone: values.phone?.trim() || null,
})

/**
 * Learners already typed with the company's name (any capitalisation) are linked to it, so its people see them;
 * after a rename the linked learners take the new name.
 */
const linkLearners = async (companyCode: string, organisationId: string, name: string, previousName?: string) => {
    const db = getFirebaseDb()
    const snapshot = await getDocs(query(collection(db, LEARNERS), where('companyCode', '==', companyCode)))
    const names = new Set([name, previousName].filter((value): value is string => Boolean(value)).map((value) => value.trim().toLowerCase()))
    const rows = snapshot.docs.filter((row) => {
        const data = row.data()
        return text(data.organisationId) === organisationId || (!text(data.organisationId) && names.has(text(data.organisation).toLowerCase()))
    })
    // Their certificates, and the company's ESG reports (by client name), follow so the company's people see them.
    const learnerIds = new Set(rows.map((row) => row.id))
    const [certificates, reports] = await Promise.all([
        getDocs(query(collection(db, 'trainingCertificates'), where('companyCode', '==', companyCode))).catch(() => null),
        getDocs(query(collection(db, 'esgReports'), where('companyCode', '==', companyCode))).catch(() => null),
    ])
    const updates = [
        ...rows.map((row) => [row.ref, { organisationId, organisation: name, updatedAt: now() }] as const),
        ...(certificates?.docs || []).filter((row) => learnerIds.has(text(row.data().learnerId)) && text(row.data().organisationId) !== organisationId)
            .map((row) => [row.ref, { organisationId }] as const),
        ...(reports?.docs || []).filter((row) => names.has(text(row.data().clientName).toLowerCase()) && text(row.data().organisationId) !== organisationId)
            .map((row) => [row.ref, { organisationId }] as const),
    ]
    for (let start = 0; start < updates.length; start += 450) {
        const batch = writeBatch(db)
        updates.slice(start, start + 450).forEach(([ref, data]) => batch.update(ref, data))
        await batch.commit()
    }
    return rows.length
}

export const saveTrainingOrganisation = async (user: FullIdentity, values: TrainingOrganisationValues, existing?: TrainingOrganisation) => {
    const companyCode = trainingCompanyOf(user)
    const clean = cleanOrganisation(values)
    if (!clean.name) throw new Error('name_required')
    const others = await listTrainingOrganisations(user)
    if (others.some((row) => row.id !== existing?.id && row.name.toLowerCase() === clean.name.toLowerCase())) throw new Error('duplicate_organisation')
    let id = existing?.id
    if (existing) {
        await updateDoc(doc(getFirebaseDb(), ORGANISATIONS, existing.id), { ...clean, updatedAt: now(), updatedBy: user.uid })
    } else {
        id = (await addDoc(collection(getFirebaseDb(), ORGANISATIONS), { ...clean, companyCode, createdAt: now(), createdBy: user.uid, updatedAt: now(), updatedBy: user.uid })).id
    }
    const linked = await linkLearners(companyCode, id as string, clean.name, existing?.name)
    return { id: id as string, linked }
}

/** Only a company with no learners linked and no accounts can be deleted, so nothing is left pointing at nothing. */
export const deleteTrainingOrganisation = async (user: FullIdentity, organisation: TrainingOrganisation) => {
    const companyCode = trainingCompanyOf(user)
    const [learners, members] = await Promise.all([
        getDocs(query(collection(getFirebaseDb(), LEARNERS), where('companyCode', '==', companyCode), where('organisationId', '==', organisation.id))),
        listOrganisationMembers(user, organisation.id),
    ])
    if (!learners.empty || members.length) throw new Error('organisation_in_use')
    await deleteDoc(doc(getFirebaseDb(), ORGANISATIONS, organisation.id))
}

// ---------------------------------------------------------------------------------------------------------------
// Accounts: staff see every company's, a company's people see their own company's
// ---------------------------------------------------------------------------------------------------------------

export const listOrganisationMembers = async (user: FullIdentity, organisationId?: string) => {
    const db = getFirebaseDb()
    if (isClientOrg(user)) {
        const own = ownOrganisationOf(user)
        const snapshot = await getDocs(query(collection(db, 'users'), where('companyCode', '==', own.companyCode), where('organisationId', '==', own.organisationId)))
        return snapshot.docs.filter((row) => row.data().role === 'clientorg' && row.data().status !== 'deleted').map((row) => toMember(row.id, row.data()))
    }
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(db, 'users'), where('companyCode', '==', companyCode), where('role', '==', 'clientorg')))
    return snapshot.docs
        .filter((row) => row.data().status !== 'deleted' && (!organisationId || text(row.data().organisationId) === organisationId))
        .map((row) => toMember(row.id, row.data()))
        .sort((left, right) => (left.orgRole === right.orgRole ? left.name.localeCompare(right.name) : left.orgRole === 'director' ? -1 : 1))
}

/**
 * Gives someone at a client company a sign-in: the training company's staff give a company its director, the
 * director adds coordinators (inviteTrainingOrganisationMember checks which). Returns the set-password link the
 * email carries.
 */
export const inviteOrganisationMember = async (values: { organisationId: string, name: string, email: string, orgRole: TrainingOrgRole, jobTitle?: string }) => {
    if (!firebaseApp) throw new Error('functions_unavailable')
    const callable = httpsCallable<typeof values, { uid: string, setPasswordLink: string | null }>(getFunctions(firebaseApp, 'us-central1'), 'inviteTrainingOrganisationMember')
    try {
        return (await callable({ ...values, name: values.name.trim(), email: values.email.trim().toLowerCase() })).data
    } catch (error) {
        const code = String((error as { code?: string })?.code || '')
        if (code.endsWith('already-exists')) throw new Error('email_already_exists', { cause: error })
        if (code.endsWith('permission-denied')) throw new Error('permission_denied', { cause: error })
        throw error
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The client company's own page
// ---------------------------------------------------------------------------------------------------------------

export const getMyOrganisation = async (user: FullIdentity) => {
    const own = ownOrganisationOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), ORGANISATIONS, own.organisationId))
    return snapshot.exists() ? toTrainingOrganisation(snapshot.id, snapshot.data()) : null
}

/** The company's people across every class (their own records only). */
export const listMyOrganisationLearners = async (user: FullIdentity) => {
    const own = ownOrganisationOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), LEARNERS), where('companyCode', '==', own.companyCode), where('organisationId', '==', own.organisationId)))
    return snapshot.docs.map((row) => toTrainingLearner(row.id, row.data())).sort((left, right) => left.name.localeCompare(right.name))
}

/** The training company's classes, to book people into and to show their people's dates. */
export const listTrainingClassesForOrganisation = async (user: FullIdentity) => {
    const own = ownOrganisationOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), CLASSES), where('companyCode', '==', own.companyCode)))
    return snapshot.docs.map((row) => toTrainingClass(row.id, row.data())).sort((left, right) => left.startDate.localeCompare(right.startDate))
}

/** Books one of the company's people into a class. The facilitator sees them in the class and sends the invitation. */
export const bookOrganisationLearner = async (user: FullIdentity, organisation: TrainingOrganisation, classId: string, values: Omit<TrainingLearnerValues, 'organisation'> & { details?: TrainingDetails }) => {
    const own = ownOrganisationOf(user)
    const email = String(values.email || '').trim().toLowerCase()
    const existing = await listMyOrganisationLearners(user)
    if (email && existing.some((learner) => learner.classId === classId && learner.email === email)) throw new Error('duplicate_learner')
    const created = await addDoc(collection(getFirebaseDb(), LEARNERS), {
        companyCode: own.companyCode,
        classId,
        name: values.name.trim(),
        email,
        idNumber: String(values.idNumber || '').replace(/\s+/g, ''),
        organisation: organisation.name,
        organisationId: own.organisationId,
        phone: values.phone?.trim() || null,
        details: cleanLearnerDetails(values.details || {}),
        attendance: {},
        bookedBy: user.uid,
        createdAt: now(),
        updatedAt: now(),
    })
    return created.id
}

/** A booking can be withdrawn until the facilitator has invited the learner. */
export const cancelOrganisationBooking = async (user: FullIdentity, learnerId: string) => {
    ownOrganisationOf(user)
    await deleteDoc(doc(getFirebaseDb(), LEARNERS, learnerId))
}

export const canSeeOrganisations = (user?: FullIdentity | null) => canManageTraining(user) || isClientOrg(user)
