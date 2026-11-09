import {
    addDoc,
    arrayRemove,
    arrayUnion,
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    onSnapshot,
    query,
    updateDoc,
    where,
    writeBatch,
    type DocumentData,
    type Unsubscribe,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { callStaffEndpoint, hasAccountFunctions } from '@/services/operationsStaffService'
import { deleteIdDocumentFile, uploadIdDocumentFile } from '@/services/trainingIdDocumentsService'
import { isMeetingUrl } from '@/utils/meetingLinks'
import type { FullIdentity } from '@/types/identity'
import type {
    TrainingAttendanceMark,
    TrainingAttendanceMode,
    TrainingClass,
    TrainingClassHours,
    TrainingClassValues,
    TrainingDeliveryMode,
    TrainingGroup,
    TrainingGroupValues,
    TrainingIdDocument,
    TrainingIdDocumentStatus,
    TrainingLearner,
    TrainingLearnerValues,
    TrainingRubricCriterion,
    TrainingTestKind,
} from '@/types/training'

/**
 * Awareness training classes, learners, the attendance register and group assignments.
 *
 * Every record carries the company code and every query filters on it, so firestore.rules can confirm the reader
 * runs training in that company (and that the company has the module switched on) before returning anything.
 */

const CLASSES = 'trainingClasses'
const LEARNERS = 'trainingLearners'
const GROUPS = 'trainingGroups'
const SUBMISSIONS = 'trainingSubmissions'
const CERTIFICATES = 'trainingCertificates'
const ORGANISATIONS = 'trainingOrganisations'

const TRAINING_STAFF_ROLES = new Set<string>(['projectadmin', 'operations'])

export const canManageTraining = (user?: Pick<FullIdentity, 'role' | 'companyCode'> | null) =>
    Boolean(user && TRAINING_STAFF_ROLES.has(user.role) && String(user.companyCode || '').trim())

/** The company whose training the user runs; throws for anyone else. */
export const trainingCompanyOf = (user?: FullIdentity | null) => {
    if (!user || !canManageTraining(user)) throw new Error('forbidden')
    return String(user.companyCode).trim()
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const optionalText = (value: unknown) => text(value) || undefined
const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback)
const ids = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [])
const now = () => new Date().toISOString()

const toAttendance = (value: unknown): Record<string, TrainingAttendanceMark> => {
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([day, mark]) => {
        if (!mark || typeof mark !== 'object') return []
        const row = mark as Record<string, unknown>
        if (typeof row.present !== 'boolean') return []
        return [[day, {
            present: row.present,
            recordedAt: text(row.recordedAt),
            recordedBy: row.recordedBy === 'learner' ? 'learner' : 'facilitator',
            ...(row.mode === 'in_person' || row.mode === 'online' ? { mode: row.mode } : {}),
        } satisfies TrainingAttendanceMark]]
    }))
}

/** The details asked of learners (config/trainingDetails.ts): text and numbers only. */
const toLearnerDetails = (value: unknown) => {
    if (!value || typeof value !== 'object') return undefined
    const entries = Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string | number] => (typeof entry[1] === 'string' && entry[1].trim() !== '') || (typeof entry[1] === 'number' && Number.isFinite(entry[1])))
    return entries.length ? Object.fromEntries(entries) : undefined
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DELIVERY_MODES: TrainingDeliveryMode[] = ['in_person', 'online', 'hybrid']

/** A day's hours, when both times are valid and the end is after the start. */
const toHours = (value: unknown): TrainingClassHours | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const { start, end } = value as Record<string, unknown>
    return typeof start === 'string' && typeof end === 'string' && TIME.test(start) && TIME.test(end) && end > start ? { start, end } : undefined
}

const toDayHours = (value: unknown, dayCount: number) => {
    if (!value || typeof value !== 'object') return undefined
    const days = Object.entries(value as Record<string, unknown>).flatMap(([day, hours]) => {
        const parsed = toHours(hours)
        return parsed && Number(day) >= 1 && Number(day) <= dayCount ? [[day, parsed] as const] : []
    })
    return days.length ? Object.fromEntries(days) : undefined
}

const toNumberMap = (value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
}

const toIdDocument = (value: unknown): TrainingIdDocument | undefined => {
    if (!value || typeof value !== 'object') return undefined
    const data = value as Record<string, unknown>
    const storagePath = text(data.storagePath)
    if (!storagePath) return undefined
    const status: TrainingIdDocumentStatus = data.status === 'verified' || data.status === 'queried' ? data.status : 'pending'
    return {
        fileName: text(data.fileName) || 'ID document',
        storagePath,
        contentType: text(data.contentType),
        uploadedAt: text(data.uploadedAt),
        uploadedBy: data.uploadedBy === 'learner' ? 'learner' : 'facilitator',
        consentAt: optionalText(data.consentAt),
        status,
        note: optionalText(data.note),
        reviewedAt: optionalText(data.reviewedAt),
    }
}

export const toTrainingClass = (id: string, data: DocumentData): TrainingClass => ({
    id,
    companyCode: text(data.companyCode),
    courseTitle: text(data.courseTitle),
    // Classes created before online delivery existed were all in person.
    deliveryMode: DELIVERY_MODES.includes(data.deliveryMode) ? data.deliveryMode : 'in_person',
    venue: text(data.venue),
    meetingUrl: optionalText(data.meetingUrl),
    startDate: text(data.startDate),
    dayCount: Math.max(1, whole(data.dayCount, 1)),
    hours: toHours(data.hours),
    dayHours: toDayHours(data.dayHours, Math.max(1, whole(data.dayCount, 1))),
    assessmentId: optionalText(data.assessmentId),
    preAssessmentId: optionalText(data.preAssessmentId),
    funderId: optionalText(data.funderId),
    passMarkPct: Math.min(100, Math.max(0, whole(data.passMarkPct, 0))),
    reassessmentsAllowed: Math.max(0, whole(data.reassessmentsAllowed, 0)),
    groupAssignmentRequired: data.groupAssignmentRequired === true,
    testsOpen: {
        pre: data.testsOpen?.pre === true,
        post: data.testsOpen?.post === true,
    },
    learnerUids: ids(data.learnerUids),
    createdAt: optionalText(data.createdAt),
    createdBy: optionalText(data.createdBy),
    updatedAt: optionalText(data.updatedAt),
    updatedBy: optionalText(data.updatedBy),
})

export const toTrainingLearner = (id: string, data: DocumentData): TrainingLearner => ({
    id,
    companyCode: text(data.companyCode),
    classId: text(data.classId),
    name: text(data.name),
    email: text(data.email).toLowerCase(),
    idNumber: text(data.idNumber),
    organisation: text(data.organisation),
    organisationId: optionalText(data.organisationId),
    bookedBy: optionalText(data.bookedBy),
    funderId: optionalText(data.funderId),
    details: toLearnerDetails(data.details),
    phone: optionalText(data.phone),
    uid: optionalText(data.uid),
    invitedAt: optionalText(data.invitedAt),
    attendance: toAttendance(data.attendance),
    attendanceRemark: optionalText(data.attendanceRemark),
    idDocument: toIdDocument(data.idDocument),
    certificateId: optionalText(data.certificateId),
    createdAt: optionalText(data.createdAt),
    updatedAt: optionalText(data.updatedAt),
})

export const toTrainingGroup = (id: string, data: DocumentData): TrainingGroup => ({
    id,
    companyCode: text(data.companyCode),
    classId: text(data.classId),
    name: text(data.name),
    learnerIds: ids(data.learnerIds),
    absentLearnerIds: ids(data.absentLearnerIds),
    rubricMarks: toNumberMap(data.rubricMarks),
    total: typeof data.total === 'number' ? data.total : undefined,
    maxTotal: Math.max(0, whole(data.maxTotal, 0)),
    markedAt: optionalText(data.markedAt),
    markedBy: optionalText(data.markedBy),
    createdAt: optionalText(data.createdAt),
    updatedAt: optionalText(data.updatedAt),
})

const byName = <T extends { name: string }>(rows: T[]) => [...rows].sort((left, right) => left.name.localeCompare(right.name))

const companyQuery = (name: string, companyCode: string, classId?: string) => {
    const source = collection(getFirebaseDb(), name)
    return classId
        ? query(source, where('companyCode', '==', companyCode), where('classId', '==', classId))
        : query(source, where('companyCode', '==', companyCode))
}

const cleanClassValues = (values: TrainingClassValues) => {
    const deliveryMode = DELIVERY_MODES.includes(values.deliveryMode) ? values.deliveryMode : 'in_person'
    const usesLink = deliveryMode !== 'in_person'
    const usesVenue = deliveryMode !== 'online'
    const meetingUrl = (values.meetingUrl || '').trim()
    if (usesLink && !isMeetingUrl(meetingUrl)) throw new Error('invalid_meeting_url')
    const dayCount = Math.min(10, Math.max(1, Math.round(values.dayCount)))
    if (values.hours && !toHours(values.hours)) throw new Error('invalid_hours')
    const hours = toHours(values.hours)
    // Only the days that really differ from the usual hours are kept.
    const dayHours = Object.fromEntries(Object.entries(toDayHours(values.dayHours, dayCount) || {})
        .filter(([, day]) => !hours || day.start !== hours.start || day.end !== hours.end))
    return {
        courseTitle: values.courseTitle.trim(),
        deliveryMode,
        venue: usesVenue ? values.venue.trim() : '',
        meetingUrl: usesLink ? meetingUrl : null,
        startDate: values.startDate,
        dayCount,
        hours: hours || null,
        dayHours: Object.keys(dayHours).length ? dayHours : null,
        assessmentId: values.assessmentId || null,
        // Only kept when it differs from the post-assessment.
        preAssessmentId: values.preAssessmentId && values.preAssessmentId !== values.assessmentId ? values.preAssessmentId : null,
        funderId: values.funderId || null,
        passMarkPct: Math.min(100, Math.max(0, Math.round(values.passMarkPct))),
        reassessmentsAllowed: Math.min(5, Math.max(0, Math.round(values.reassessmentsAllowed))),
        groupAssignmentRequired: values.groupAssignmentRequired === true,
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------------------------

export const listTrainingClasses = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(companyQuery(CLASSES, companyCode))
    return snapshot.docs
        .map((row) => toTrainingClass(row.id, row.data()))
        .sort((left, right) => right.startDate.localeCompare(left.startDate))
}

export const getTrainingClass = async (user: FullIdentity, classId: string) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), CLASSES, classId))
    if (!snapshot.exists()) return null
    const trainingClass = toTrainingClass(snapshot.id, snapshot.data())
    return trainingClass.companyCode === companyCode ? trainingClass : null
}

export const createTrainingClass = async (user: FullIdentity, values: TrainingClassValues) => {
    const companyCode = trainingCompanyOf(user)
    const created = await addDoc(collection(getFirebaseDb(), CLASSES), {
        ...cleanClassValues(values),
        companyCode,
        testsOpen: { pre: false, post: false },
        learnerUids: [],
        createdAt: now(),
        createdBy: user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
    return created.id
}

export const updateTrainingClass = async (user: FullIdentity, classId: string, values: TrainingClassValues) => {
    trainingCompanyOf(user)
    await updateDoc(doc(getFirebaseDb(), CLASSES, classId), {
        ...cleanClassValues(values),
        updatedAt: now(),
        updatedBy: user.uid,
    })
}

/** Only an empty class can be deleted, so no learner's attendance or test history is lost with it. */
export const deleteTrainingClass = async (user: FullIdentity, classId: string) => {
    const companyCode = trainingCompanyOf(user)
    const learners = await getDocs(companyQuery(LEARNERS, companyCode, classId))
    if (!learners.empty) throw new Error('class_has_learners')
    const groups = await getDocs(companyQuery(GROUPS, companyCode, classId))
    const batch = writeBatch(getFirebaseDb())
    groups.docs.forEach((row) => batch.delete(row.ref))
    batch.delete(doc(getFirebaseDb(), CLASSES, classId))
    await batch.commit()
}

// ---------------------------------------------------------------------------------------------------------------
// Learners and the attendance register
// ---------------------------------------------------------------------------------------------------------------

/** Every learner in the company, for the class list's counts. */
export const listCompanyTrainingLearners = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(companyQuery(LEARNERS, companyCode))
    return byName(snapshot.docs.map((row) => toTrainingLearner(row.id, row.data())))
}

export const subscribeClassLearners = (
    user: FullIdentity,
    classId: string,
    onRows: (rows: TrainingLearner[]) => void,
    onError: (error: Error) => void,
): Unsubscribe => {
    const companyCode = trainingCompanyOf(user)
    return onSnapshot(
        companyQuery(LEARNERS, companyCode, classId),
        (snapshot) => onRows(byName(snapshot.docs.map((row) => toTrainingLearner(row.id, row.data())))),
        onError,
    )
}

// Email and ID may follow later (learners imported from an attendance register); empty fields are left out of the form.
const cleanLearnerValues = (values: TrainingLearnerValues) => ({
    name: values.name.trim(),
    email: String(values.email || '').trim().toLowerCase(),
    idNumber: String(values.idNumber || '').replace(/\s+/g, ''),
    organisation: values.organisation.trim(),
    phone: values.phone?.trim() || null,
    ...(values.funderId !== undefined ? { funderId: values.funderId || null } : {}),
    ...(values.details !== undefined ? { details: toLearnerDetails(values.details) || {} } : {}),
})

/**
 * The registered client companies by name (lower case), so a learner typed or imported with a company's name is
 * linked to it and the company's own people see them.
 */
const organisationIdsByName = async (companyCode: string) => {
    const snapshot = await getDocs(query(collection(getFirebaseDb(), ORGANISATIONS), where('companyCode', '==', companyCode)))
    return new Map(snapshot.docs.map((row) => [text(row.data().name).toLowerCase(), row.id]))
}

const assertUniqueEmail = async (companyCode: string, classId: string, email: string, exceptId?: string) => {
    if (!email) return
    const snapshot = await getDocs(query(
        collection(getFirebaseDb(), LEARNERS),
        where('companyCode', '==', companyCode),
        where('classId', '==', classId),
        where('email', '==', email),
    ))
    if (snapshot.docs.some((row) => row.id !== exceptId)) throw new Error('duplicate_learner')
}

export const addTrainingLearner = async (user: FullIdentity, classId: string, values: TrainingLearnerValues) => {
    const companyCode = trainingCompanyOf(user)
    const clean = cleanLearnerValues(values)
    await assertUniqueEmail(companyCode, classId, clean.email)
    const organisationIds = await organisationIdsByName(companyCode)
    const created = await addDoc(collection(getFirebaseDb(), LEARNERS), {
        ...clean,
        organisationId: organisationIds.get(clean.organisation.toLowerCase()) || null,
        companyCode,
        classId,
        attendance: {},
        createdAt: now(),
        createdBy: user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
    return created.id
}

/** A spreadsheet row: the name and organisation, and whatever else the sheet has (email and ID can follow later). */
export type ImportedLearnerValues = Pick<TrainingLearnerValues, 'name' | 'organisation'> & Partial<Pick<TrainingLearnerValues, 'email' | 'idNumber' | 'phone'>>

/** Spreadsheet imports are written in one batch (Firestore allows 500 writes). */
export const MAX_IMPORTED_LEARNERS = 500

/** Learners match on their email, or on name and organisation (a register often has no emails). */
export const learnerNameKey = (name: string, organisation: string) => `${name.trim().toLowerCase()}|${organisation.trim().toLowerCase()}`

/**
 * Adds learners from a spreadsheet in one write. Someone already in the class (same email, or same name and
 * organisation) is skipped, so importing the same sheet twice adds nobody twice.
 */
export const addTrainingLearners = async (user: FullIdentity, classId: string, rows: ImportedLearnerValues[]) => {
    const companyCode = trainingCompanyOf(user)
    if (rows.length > MAX_IMPORTED_LEARNERS) throw new Error('too_many_learners')
    const db = getFirebaseDb()
    const existing = await getDocs(query(collection(db, LEARNERS), where('companyCode', '==', companyCode), where('classId', '==', classId)))
    const emails = new Set(existing.docs.map((row) => String(row.data().email || '').trim().toLowerCase()).filter(Boolean))
    const names = new Set(existing.docs.map((row) => learnerNameKey(String(row.data().name || ''), String(row.data().organisation || ''))))
    const organisationIds = await organisationIdsByName(companyCode)
    const batch = writeBatch(db)
    let added = 0
    for (const row of rows) {
        const clean = cleanLearnerValues({ name: row.name, organisation: row.organisation, email: row.email || '', idNumber: row.idNumber || '', phone: row.phone })
        const nameKey = learnerNameKey(clean.name, clean.organisation)
        if (!clean.name || (clean.email && emails.has(clean.email)) || names.has(nameKey)) continue
        if (clean.email) emails.add(clean.email)
        names.add(nameKey)
        batch.set(doc(collection(db, LEARNERS)), {
            ...clean,
            organisationId: organisationIds.get(clean.organisation.toLowerCase()) || null,
            companyCode,
            classId,
            attendance: {},
            createdAt: now(),
            createdBy: user.uid,
            updatedAt: now(),
            updatedBy: user.uid,
        })
        added += 1
    }
    if (added) await batch.commit()
    return { added, skipped: rows.length - added }
}

export const updateTrainingLearner = async (user: FullIdentity, learner: TrainingLearner, values: TrainingLearnerValues) => {
    const companyCode = trainingCompanyOf(user)
    const clean = cleanLearnerValues(values)
    if (clean.email !== learner.email) {
        // The learner signs in with this address once invited, so it can no longer change here.
        if (learner.uid) throw new Error('email_locked_after_invite')
        await assertUniqueEmail(companyCode, learner.classId, clean.email, learner.id)
    }
    const organisationIds = await organisationIdsByName(companyCode)
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learner.id), {
        ...clean,
        organisationId: organisationIds.get(clean.organisation.toLowerCase()) || null,
        updatedAt: now(),
        updatedBy: user.uid,
    })
}

/**
 * Creates the learner's own sign-in (role `learner`, in this company) and emails them a link to set a password.
 * The account function only allows this for companies with awareness training switched on. Someone invited to an
 * earlier class keeps the same account. Returns the account id and the set-password link the email carries.
 */
export const inviteTrainingLearner = async (user: FullIdentity, learner: TrainingLearner, courseTitle: string) => {
    const companyCode = trainingCompanyOf(user)
    if (!learner.email) throw new Error('email_missing')
    if (!hasAccountFunctions()) throw new Error('functions_unavailable')
    const result = await callStaffEndpoint<{ uid?: string, resetLink?: string | null }>('createPlatformUser', {
        name: learner.name,
        email: learner.email,
        role: 'learner',
        companyCode,
        phone: learner.phone || '',
        courseTitle,
        sendResetLink: true,
        sendEmail: true,
    })
    const uid = String(result.uid || '')
    if (!uid) throw new Error('invite_failed')

    const db = getFirebaseDb()
    // Tests already recorded (e.g. on paper) and any certificate already issued are linked too, so the learner sees them.
    const [submissions, certificates] = await Promise.all([
        getDocs(query(collection(db, SUBMISSIONS), where('companyCode', '==', companyCode), where('learnerId', '==', learner.id))),
        getDocs(query(collection(db, CERTIFICATES), where('companyCode', '==', companyCode), where('learnerId', '==', learner.id))),
    ])
    const batch = writeBatch(db)
    batch.update(doc(db, LEARNERS, learner.id), { uid, invitedAt: now(), updatedAt: now(), updatedBy: user.uid })
    batch.update(doc(db, CLASSES, learner.classId), { learnerUids: arrayUnion(uid), updatedAt: now(), updatedBy: user.uid })
    submissions.docs.forEach((row) => batch.update(row.ref, { learnerUid: uid }))
    certificates.docs.forEach((row) => batch.update(row.ref, { learnerUid: uid }))
    await batch.commit()
    return { uid, setPasswordLink: result.resetLink || null }
}

/** Lets learners start (or stops them starting) the pre-assessment or post-assessment online. */
export const setTrainingTestOpen = async (user: FullIdentity, classId: string, kind: TrainingTestKind, open: boolean) => {
    trainingCompanyOf(user)
    await updateDoc(doc(getFirebaseDb(), CLASSES, classId), { [`testsOpen.${kind}`]: open, updatedAt: now(), updatedBy: user.uid })
}

/** The facilitator uploads a learner's ID copy (for example one handed in on the day). */
export const uploadLearnerIdDocument = async (user: FullIdentity, learner: TrainingLearner, file: File) => {
    trainingCompanyOf(user)
    const idDocument = await uploadIdDocumentFile(learner, file, 'facilitator')
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learner.id), { idDocument, updatedAt: now(), updatedBy: user.uid })
    if (learner.idDocument?.storagePath) await deleteIdDocumentFile(learner.idDocument.storagePath).catch(() => undefined)
}

export const reviewLearnerIdDocument = async (
    user: FullIdentity,
    learner: TrainingLearner,
    status: Exclude<TrainingIdDocumentStatus, 'pending'>,
    note?: string,
) => {
    trainingCompanyOf(user)
    if (!learner.idDocument) throw new Error('no_id_document')
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learner.id), {
        'idDocument.status': status,
        'idDocument.note': note?.trim() || null,
        'idDocument.reviewedAt': now(),
        'idDocument.reviewedBy': user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
}

/**
 * Removes the learner with their test attempts and ID copy, takes them out of their group, and withdraws their
 * account's access to the class. The account itself stays, in case they are in another class.
 */
export const removeTrainingLearner = async (user: FullIdentity, learner: TrainingLearner) => {
    const companyCode = trainingCompanyOf(user)
    const db = getFirebaseDb()
    const [submissions, groups] = await Promise.all([
        getDocs(query(collection(db, SUBMISSIONS), where('companyCode', '==', companyCode), where('learnerId', '==', learner.id))),
        getDocs(companyQuery(GROUPS, companyCode, learner.classId)),
    ])
    const batch = writeBatch(db)
    submissions.docs.forEach((row) => batch.delete(row.ref))
    groups.docs.forEach((row) => {
        const group = toTrainingGroup(row.id, row.data())
        if (!group.learnerIds.includes(learner.id)) return
        batch.update(row.ref, {
            learnerIds: group.learnerIds.filter((id) => id !== learner.id),
            absentLearnerIds: group.absentLearnerIds.filter((id) => id !== learner.id),
            updatedAt: now(),
        })
    })
    if (learner.uid) batch.update(doc(db, CLASSES, learner.classId), { learnerUids: arrayRemove(learner.uid), updatedAt: now() })
    batch.delete(doc(db, LEARNERS, learner.id))
    await batch.commit()
    if (learner.idDocument?.storagePath) await deleteIdDocumentFile(learner.idDocument.storagePath).catch(() => undefined)
}

/** `mode`: for a hybrid class, whether the learner was there in person or joined online. */
export const recordTrainingAttendance = async (user: FullIdentity, learnerId: string, day: string, present: boolean, mode?: TrainingAttendanceMode) => {
    trainingCompanyOf(user)
    const mark: TrainingAttendanceMark = { present, recordedAt: now(), recordedBy: 'facilitator', ...(present && mode ? { mode } : {}) }
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learnerId), {
        [`attendance.${day}`]: mark,
        updatedAt: now(),
        updatedBy: user.uid,
    })
}

export const saveTrainingAttendanceRemark = async (user: FullIdentity, learnerId: string, remark: string) => {
    trainingCompanyOf(user)
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learnerId), {
        attendanceRemark: remark.trim() || null,
        updatedAt: now(),
        updatedBy: user.uid,
    })
}

// ---------------------------------------------------------------------------------------------------------------
// Group assignment
// ---------------------------------------------------------------------------------------------------------------

export const subscribeClassGroups = (
    user: FullIdentity,
    classId: string,
    onRows: (rows: TrainingGroup[]) => void,
    onError: (error: Error) => void,
): Unsubscribe => {
    const companyCode = trainingCompanyOf(user)
    return onSnapshot(
        companyQuery(GROUPS, companyCode, classId),
        (snapshot) => onRows(byName(snapshot.docs.map((row) => toTrainingGroup(row.id, row.data())))),
        onError,
    )
}

export const listClassGroups = async (user: FullIdentity, classId: string) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(companyQuery(GROUPS, companyCode, classId))
    return byName(snapshot.docs.map((row) => toTrainingGroup(row.id, row.data())))
}

/** A learner belongs to one group per class. */
export const saveTrainingGroup = async (
    user: FullIdentity,
    classId: string,
    values: TrainingGroupValues,
    maxTotal: number,
    groupId?: string,
) => {
    const companyCode = trainingCompanyOf(user)
    const db = getFirebaseDb()
    const learnerIds = [...new Set(values.learnerIds)]
    const existing = await getDocs(companyQuery(GROUPS, companyCode, classId))
    const taken = existing.docs.some((row) => row.id !== groupId && ids(row.data().learnerIds).some((id) => learnerIds.includes(id)))
    if (taken) throw new Error('learner_in_other_group')

    if (groupId) {
        const current = existing.docs.find((row) => row.id === groupId)
        const absent = current ? ids(current.data().absentLearnerIds).filter((id) => learnerIds.includes(id)) : []
        await updateDoc(doc(db, GROUPS, groupId), { name: values.name.trim(), learnerIds, absentLearnerIds: absent, maxTotal, updatedAt: now(), updatedBy: user.uid })
        return groupId
    }
    const created = await addDoc(collection(db, GROUPS), {
        companyCode,
        classId,
        name: values.name.trim(),
        learnerIds,
        absentLearnerIds: [],
        rubricMarks: {},
        maxTotal,
        createdAt: now(),
        createdBy: user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
    return created.id
}

export const deleteTrainingGroup = async (user: FullIdentity, groupId: string) => {
    trainingCompanyOf(user)
    await deleteDoc(doc(getFirebaseDb(), GROUPS, groupId))
}

export const markTrainingGroup = async (
    user: FullIdentity,
    group: TrainingGroup,
    rubric: TrainingRubricCriterion[],
    rubricMarks: Record<string, number>,
    absentLearnerIds: string[],
) => {
    trainingCompanyOf(user)
    const capped = Object.fromEntries(rubric.map((criterion) => [
        criterion.id,
        Math.min(criterion.maxMarks, Math.max(0, Math.round(rubricMarks[criterion.id] ?? 0))),
    ]))
    await updateDoc(doc(getFirebaseDb(), GROUPS, group.id), {
        rubricMarks: capped,
        total: Object.values(capped).reduce((sum, mark) => sum + mark, 0),
        maxTotal: rubric.reduce((sum, criterion) => sum + criterion.maxMarks, 0),
        absentLearnerIds: absentLearnerIds.filter((id) => group.learnerIds.includes(id)),
        markedAt: now(),
        markedBy: user.uid,
        updatedAt: now(),
        updatedBy: user.uid,
    })
}
