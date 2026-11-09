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
    type Unsubscribe,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { toTrainingAssessment, toTrainingSubmission } from '@/services/trainingAssessmentService'
import { deleteIdDocumentFile, uploadIdDocumentFile } from '@/services/trainingIdDocumentsService'
import { toTrainingClass, toTrainingLearner } from '@/services/trainingService'
import { assessmentIdFor, learnerMayStart, nextAttemptNumber, submissionIdFor, totalMarksOf } from '@/utils/trainingResults'
import type { FullIdentity } from '@/types/identity'
import type { TrainingAssessment, TrainingAttendanceMark, TrainingAttendanceMode, TrainingClass, TrainingLearner, TrainingSubmission, TrainingTestKind } from '@/types/training'

/**
 * The learner's side of awareness training: their classes, the tests they write online, attendance sign-in and
 * their ID copy. Every read is limited to the learner's own records (by account id), which firestore.rules enforce.
 */

const LEARNERS = 'trainingLearners'
const CLASSES = 'trainingClasses'
const ASSESSMENTS = 'trainingAssessments'
const SUBMISSIONS = 'trainingSubmissions'

export type LearnerEnrolment = {
    learner: TrainingLearner
    trainingClass: TrainingClass
    /** The post-assessment. */
    assessment: TrainingAssessment | null
    /** The pre-assessment: the same as the post-assessment unless the class has its own. */
    preAssessment: TrainingAssessment | null
}

const now = () => new Date().toISOString()

const learnerUidOf = (user?: FullIdentity | null) => {
    if (!user || user.role !== 'learner') throw new Error('forbidden')
    return user.uid
}

/** Learners belong to their training provider's company; queries filter on it so the rules can confirm access. */
const learnerCompanyOf = (user: FullIdentity) => {
    const code = String(user.companyCode || '').trim()
    if (!code) throw new Error('forbidden')
    return code
}

/** The training provider's name (the learner's company), for the consent wording. */
export const getMyTrainingProviderName = async (user: FullIdentity) => {
    learnerUidOf(user)
    const code = String(user.companyCode || '').trim()
    if (!code) return ''
    const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', code))
    const data = snapshot.exists() ? snapshot.data() : {}
    return String(data.companyName || data.name || '').trim()
}

/** The learner's classes, newest first. */
export const listMyEnrolments = async (user: FullIdentity): Promise<LearnerEnrolment[]> => {
    const uid = learnerUidOf(user)
    const db = getFirebaseDb()
    const snapshot = await getDocs(query(collection(db, LEARNERS), where('companyCode', '==', learnerCompanyOf(user)), where('uid', '==', uid)))
    const enrolments = await Promise.all(snapshot.docs.map(async (row) => {
        const learner = toTrainingLearner(row.id, row.data())
        const classSnapshot = await getDoc(doc(db, CLASSES, learner.classId)).catch(() => null)
        if (!classSnapshot?.exists()) return null
        const trainingClass = toTrainingClass(classSnapshot.id, classSnapshot.data())
        const load = async (id?: string) => {
            if (!id) return null
            const found = await getDoc(doc(db, ASSESSMENTS, id)).catch(() => null)
            return found?.exists() ? toTrainingAssessment(found.id, found.data()) : null
        }
        const assessment = await load(trainingClass.assessmentId)
        const preId = assessmentIdFor(trainingClass, 'pre')
        const preAssessment = preId === trainingClass.assessmentId ? assessment : await load(preId)
        return { learner, trainingClass, assessment, preAssessment }
    }))
    return enrolments
        .filter((enrolment): enrolment is LearnerEnrolment => enrolment !== null)
        .sort((left, right) => right.trainingClass.startDate.localeCompare(left.trainingClass.startDate))
}

export const subscribeMySubmissions = (
    user: FullIdentity,
    onRows: (rows: TrainingSubmission[]) => void,
    onError: (error: Error) => void,
): Unsubscribe => {
    const uid = learnerUidOf(user)
    return onSnapshot(
        query(collection(getFirebaseDb(), SUBMISSIONS), where('companyCode', '==', learnerCompanyOf(user)), where('learnerUid', '==', uid)),
        (snapshot) => onRows(snapshot.docs.map((row) => toTrainingSubmission(row.id, row.data()))),
        onError,
    )
}

/** Starts the pre-assessment or the next post-assessment attempt. Returns its id. */
export const startMyTest = async (user: FullIdentity, enrolment: LearnerEnrolment, kind: TrainingTestKind, mine: TrainingSubmission[]) => {
    const uid = learnerUidOf(user)
    const { learner, trainingClass } = enrolment
    const assessment = kind === 'pre' ? enrolment.preAssessment : enrolment.assessment
    if (!assessment || !assessment.questions.length) throw new Error('no_assessment')
    const own = mine.filter((submission) => submission.learnerId === learner.id)
    if (!learnerMayStart(trainingClass, kind, own)) throw new Error('test_not_available')

    const attempt = kind === 'pre' ? 1 : nextAttemptNumber(learner.id, 'post', own)
    const db = getFirebaseDb()
    const ref = doc(db, SUBMISSIONS, submissionIdFor(learner.id, kind, attempt))
    await runTransaction(db, async (transaction) => {
        if ((await transaction.get(ref)).exists()) throw new Error('attempt_exists')
        transaction.set(ref, {
            companyCode: trainingClass.companyCode,
            classId: trainingClass.id,
            learnerId: learner.id,
            learnerUid: uid,
            assessmentId: assessment.id,
            kind,
            attempt,
            source: 'online',
            questions: assessment.questions,
            answers: {},
            status: 'in_progress',
            marks: {},
            totalMarks: totalMarksOf(assessment.questions),
            startedAt: now(),
        })
    })
    return ref.id
}

export const getMySubmission = async (user: FullIdentity, submissionId: string) => {
    const uid = learnerUidOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), SUBMISSIONS, submissionId))
    if (!snapshot.exists()) return null
    const submission = toTrainingSubmission(snapshot.id, snapshot.data())
    return submission.learnerUid === uid ? submission : null
}

/** The assessment a test was written for (questions, instructions and time allowed; never the memo). */
export const getMyAssessment = async (user: FullIdentity, assessmentId: string) => {
    learnerUidOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), ASSESSMENTS, assessmentId))
    return snapshot.exists() ? toTrainingAssessment(snapshot.id, snapshot.data()) : null
}

/** Saves answers while the test is being written. */
export const saveMyAnswers = async (user: FullIdentity, submissionId: string, answers: Record<string, string>) => {
    learnerUidOf(user)
    await updateDoc(doc(getFirebaseDb(), SUBMISSIONS, submissionId), { answers, updatedAt: now() })
}

/** Hands the test in for marking; after this the answers can no longer change. */
export const submitMyTest = async (user: FullIdentity, submissionId: string, answers: Record<string, string>) => {
    learnerUidOf(user)
    await updateDoc(doc(getFirebaseDb(), SUBMISSIONS, submissionId), { answers, status: 'submitted', submittedAt: now(), updatedAt: now() })
}

/**
 * The learner marks themselves present for a training day; the facilitator can still correct it. In a hybrid class
 * they also say whether they are there in person or online.
 */
export const signInForDay = async (user: FullIdentity, learner: TrainingLearner, day: string, mode?: TrainingAttendanceMode) => {
    learnerUidOf(user)
    const mark: TrainingAttendanceMark = { present: true, recordedAt: now(), recordedBy: 'learner', ...(mode ? { mode } : {}) }
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learner.id), { [`attendance.${day}`]: mark, updatedAt: now() })
}

/** Uploads the learner's ID copy with their consent to it being kept for the training record. */
export const uploadMyIdDocument = async (user: FullIdentity, learner: TrainingLearner, file: File) => {
    learnerUidOf(user)
    const idDocument = { ...(await uploadIdDocumentFile(learner, file, 'learner')), consentAt: now() }
    await updateDoc(doc(getFirebaseDb(), LEARNERS, learner.id), { idDocument, updatedAt: now() })
    if (learner.idDocument?.storagePath) await deleteIdDocumentFile(learner.idDocument.storagePath).catch(() => undefined)
}
