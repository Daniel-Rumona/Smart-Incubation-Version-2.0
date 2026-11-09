import {
    collection,
    deleteDoc,
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
import { getFirebaseDb } from '@/config/firebase'
import { trainingCompanyOf } from '@/services/trainingService'
import { nextAttemptNumber, scoreMarks, submissionIdFor, totalMarksOf } from '@/utils/trainingResults'
import type { FullIdentity } from '@/types/identity'
import type {
    TrainingAssessment,
    TrainingAssessmentValues,
    TrainingQuestion,
    TrainingRubricCriterion,
    TrainingSubmission,
    TrainingTestKind,
} from '@/types/training'

/**
 * The course assessment (knowledge test + group case rubric), its memo, and the test attempts learners write.
 *
 * The memo is stored apart (`trainingAssessmentMemos/{assessmentId}`) because learners read the assessment to
 * write the test; only training staff can read the memo.
 */

const ASSESSMENTS = 'trainingAssessments'
const MEMOS = 'trainingAssessmentMemos'
const SUBMISSIONS = 'trainingSubmissions'
const CLASSES = 'trainingClasses'

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const optionalText = (value: unknown) => text(value) || undefined
const now = () => new Date().toISOString()

const toQuestions = (value: unknown): TrainingQuestion[] => (Array.isArray(value) ? value : []).flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const data = row as Record<string, unknown>
    const id = text(data.id)
    const questionText = text(data.text)
    if (!id || !questionText) return []
    const marks = typeof data.marks === 'number' && data.marks > 0 ? Math.round(data.marks) : 1
    return [{ id, text: questionText, marks }]
})

const toRubric = (value: unknown): TrainingRubricCriterion[] => (Array.isArray(value) ? value : []).flatMap((row) => {
    if (!row || typeof row !== 'object') return []
    const data = row as Record<string, unknown>
    const id = text(data.id)
    const label = text(data.label)
    if (!id || !label) return []
    const maxMarks = typeof data.maxMarks === 'number' && data.maxMarks > 0 ? Math.round(data.maxMarks) : 1
    return [{ id, label, maxMarks, guidance: optionalText(data.guidance) }]
})

const toTextMap = (value: unknown): Record<string, string> => {
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

const toNumberMap = (value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object') return {}
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
}

export const toTrainingAssessment = (id: string, data: DocumentData): TrainingAssessment => ({
    id,
    companyCode: text(data.companyCode),
    title: text(data.title),
    // Assessments from before pre and post could differ were written as both.
    use: data.use === 'pre' || data.use === 'post' ? data.use : 'both',
    instructions: optionalText(data.instructions),
    durationMinutes: typeof data.durationMinutes === 'number' && data.durationMinutes > 0 ? Math.round(data.durationMinutes) : undefined,
    questions: toQuestions(data.questions),
    caseBrief: optionalText(data.caseBrief),
    rubric: toRubric(data.rubric),
    createdAt: optionalText(data.createdAt),
    updatedAt: optionalText(data.updatedAt),
    updatedBy: optionalText(data.updatedBy),
})

export const toTrainingSubmission = (id: string, data: DocumentData): TrainingSubmission => {
    const questions = toQuestions(data.questions)
    return {
        id,
        companyCode: text(data.companyCode),
        classId: text(data.classId),
        learnerId: text(data.learnerId),
        learnerUid: optionalText(data.learnerUid),
        assessmentId: text(data.assessmentId),
        kind: data.kind === 'pre' ? 'pre' : 'post',
        attempt: typeof data.attempt === 'number' && data.attempt > 0 ? Math.round(data.attempt) : 1,
        source: data.source === 'paper' ? 'paper' : 'online',
        questions,
        answers: toTextMap(data.answers),
        status: data.status === 'marked' || data.status === 'submitted' ? data.status : 'in_progress',
        marks: toNumberMap(data.marks),
        score: typeof data.score === 'number' ? data.score : undefined,
        totalMarks: typeof data.totalMarks === 'number' ? data.totalMarks : totalMarksOf(questions),
        scorePct: typeof data.scorePct === 'number' ? data.scorePct : undefined,
        startedAt: optionalText(data.startedAt),
        submittedAt: optionalText(data.submittedAt),
        markedAt: optionalText(data.markedAt),
        markedBy: optionalText(data.markedBy),
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Assessments and memos
// ---------------------------------------------------------------------------------------------------------------

export const listTrainingAssessments = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), ASSESSMENTS), where('companyCode', '==', companyCode)))
    return snapshot.docs
        .map((row) => toTrainingAssessment(row.id, row.data()))
        .sort((left, right) => left.title.localeCompare(right.title))
}

export const getTrainingAssessment = async (user: FullIdentity, assessmentId: string) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), ASSESSMENTS, assessmentId))
    if (!snapshot.exists()) return null
    const assessment = toTrainingAssessment(snapshot.id, snapshot.data())
    return assessment.companyCode === companyCode ? assessment : null
}

export const getTrainingAssessmentMemo = async (user: FullIdentity, assessmentId: string) => {
    trainingCompanyOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), MEMOS, assessmentId))
    return snapshot.exists() ? toTextMap(snapshot.data().answers) : {}
}

/** Saves the assessment and its memo together. Returns the assessment id. */
export const saveTrainingAssessment = async (user: FullIdentity, values: TrainingAssessmentValues, assessmentId?: string) => {
    const companyCode = trainingCompanyOf(user)
    const db = getFirebaseDb()
    const questions = values.questions
        .map((question) => ({ id: question.id, text: question.text.trim(), marks: Math.max(1, Math.round(question.marks || 1)) }))
        .filter((question) => question.text)
    const rubric = values.rubric
        .map((criterion) => ({
            id: criterion.id,
            label: criterion.label.trim(),
            maxMarks: Math.max(1, Math.round(criterion.maxMarks || 1)),
            guidance: criterion.guidance?.trim() || null,
        }))
        .filter((criterion) => criterion.label)
    const ref = assessmentId ? doc(db, ASSESSMENTS, assessmentId) : doc(collection(db, ASSESSMENTS))
    const batch = writeBatch(db)
    batch.set(ref, {
        companyCode,
        title: values.title.trim(),
        use: values.use === 'pre' || values.use === 'post' ? values.use : 'both',
        instructions: values.instructions?.trim() || null,
        durationMinutes: values.durationMinutes && values.durationMinutes > 0 ? Math.round(values.durationMinutes) : null,
        questions,
        caseBrief: values.caseBrief?.trim() || null,
        rubric,
        ...(assessmentId ? {} : { createdAt: now(), createdBy: user.uid }),
        updatedAt: now(),
        updatedBy: user.uid,
    }, { merge: true })
    batch.set(doc(db, MEMOS, ref.id), {
        companyCode,
        answers: Object.fromEntries(questions.map((question) => [question.id, (values.memo[question.id] || '').trim()])),
        updatedAt: now(),
        updatedBy: user.uid,
    })
    await batch.commit()
    return ref.id
}

/** An assessment a class uses cannot be deleted. */
export const deleteTrainingAssessment = async (user: FullIdentity, assessmentId: string) => {
    const companyCode = trainingCompanyOf(user)
    const db = getFirebaseDb()
    const [asPost, asPre] = await Promise.all([
        getDocs(query(collection(db, CLASSES), where('companyCode', '==', companyCode), where('assessmentId', '==', assessmentId))),
        getDocs(query(collection(db, CLASSES), where('companyCode', '==', companyCode), where('preAssessmentId', '==', assessmentId))),
    ])
    if (!asPost.empty || !asPre.empty) throw new Error('assessment_in_use')
    const batch = writeBatch(db)
    batch.delete(doc(db, ASSESSMENTS, assessmentId))
    batch.delete(doc(db, MEMOS, assessmentId))
    await batch.commit()
}

// ---------------------------------------------------------------------------------------------------------------
// Test attempts and marking
// ---------------------------------------------------------------------------------------------------------------

export const subscribeClassSubmissions = (
    user: FullIdentity,
    classId: string,
    onRows: (rows: TrainingSubmission[]) => void,
    onError: (error: Error) => void,
): Unsubscribe => {
    const companyCode = trainingCompanyOf(user)
    return onSnapshot(
        query(collection(getFirebaseDb(), SUBMISSIONS), where('companyCode', '==', companyCode), where('classId', '==', classId)),
        (snapshot) => onRows(snapshot.docs
            .map((row) => toTrainingSubmission(row.id, row.data()))
            .sort((left, right) => left.attempt - right.attempt)),
        onError,
    )
}

export const listClassSubmissions = async (user: FullIdentity, classId: string) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), SUBMISSIONS), where('companyCode', '==', companyCode), where('classId', '==', classId)))
    return snapshot.docs.map((row) => toTrainingSubmission(row.id, row.data()))
}

/** Every handed-in test across the company's classes that still needs marking. */
export const listSubmissionsAwaitingMarking = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), SUBMISSIONS), where('companyCode', '==', companyCode), where('status', '==', 'submitted')))
    return snapshot.docs.map((row) => toTrainingSubmission(row.id, row.data()))
}

/**
 * A test written on paper in class: no answers are captured, only the marks, so it starts as submitted and goes
 * straight to marking. Returns the new attempt's id.
 */
export const createPaperSubmission = async (
    user: FullIdentity,
    input: { classId: string, learnerId: string, learnerUid?: string, kind: TrainingTestKind, assessment: TrainingAssessment, existing: TrainingSubmission[] },
) => {
    const companyCode = trainingCompanyOf(user)
    const attempt = input.kind === 'pre' ? 1 : nextAttemptNumber(input.learnerId, 'post', input.existing)
    const db = getFirebaseDb()
    const ref = doc(db, SUBMISSIONS, submissionIdFor(input.learnerId, input.kind, attempt))
    await runTransaction(db, async (transaction) => {
        // The same attempt may have just been started online; never overwrite it.
        if ((await transaction.get(ref)).exists()) throw new Error('attempt_exists')
        transaction.set(ref, {
            companyCode,
            classId: input.classId,
            learnerId: input.learnerId,
            ...(input.learnerUid ? { learnerUid: input.learnerUid } : {}),
            assessmentId: input.assessment.id,
            kind: input.kind,
            attempt,
            source: 'paper',
            questions: input.assessment.questions,
            answers: {},
            status: 'submitted',
            marks: {},
            totalMarks: totalMarksOf(input.assessment.questions),
            startedAt: now(),
            submittedAt: now(),
            createdBy: user.uid,
        })
    })
    return ref.id
}

export const saveSubmissionMarks = async (user: FullIdentity, submission: TrainingSubmission, marks: Record<string, number>) => {
    trainingCompanyOf(user)
    const capped = Object.fromEntries(submission.questions.map((question) => [
        question.id,
        Math.min(question.marks, Math.max(0, Math.round(marks[question.id] ?? 0))),
    ]))
    const { score, totalMarks, scorePct } = scoreMarks(submission.questions, capped)
    await updateDoc(doc(getFirebaseDb(), SUBMISSIONS, submission.id), {
        marks: capped,
        score,
        totalMarks,
        scorePct,
        status: 'marked',
        markedAt: now(),
        markedBy: user.uid,
    })
}

export const deleteSubmission = async (user: FullIdentity, submissionId: string) => {
    trainingCompanyOf(user)
    await deleteDoc(doc(getFirebaseDb(), SUBMISSIONS, submissionId))
}
