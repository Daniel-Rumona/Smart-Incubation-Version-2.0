import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, updateDoc, where, writeBatch } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import type { FullIdentity } from '@/types/identity'

export type QuizQuestionType = 'single' | 'multiple' | 'text'

export type QuizQuestion = {
    id: string
    type: QuizQuestionType
    question: string
    required: boolean
    options?: string[]
    /** Values from `options` that count as correct. Unused for the 'text' type, which is ungraded. */
    correctOptions?: string[]
}

export type CourseLesson = {
    id: string
    title: string
    body: string
    videoUrl?: string
    quiz?: QuizQuestion[]
}

export type CourseTemplate = {
    id?: string
    title: string
    description: string
    lessons: CourseLesson[]
    status: 'draft' | 'published'
    category: string
    programId?: string
    department?: string
    createdAt: string
    updatedAt: string
    createdBy?: string
}

export const COURSE_CATEGORIES = ['Onboarding', 'Business Skills', 'Financial Literacy', 'Compliance', 'Marketing & Sales', 'Other'] as const

export const QUIZ_QUESTION_TYPES: Array<{ value: QuizQuestionType, label: string }> = [
    { value: 'single', label: 'Single choice' },
    { value: 'multiple', label: 'Multiple choice' },
    { value: 'text', label: 'Short answer' },
]

const COLLECTION = 'courseTemplates'
const ASSIGNMENTS = 'courseAssignments'

export const generateLessonId = () => Math.random().toString(36).slice(2, 9)
export const generateQuizQuestionId = () => Math.random().toString(36).slice(2, 9)

/** Firestore rejects undefined, and a builder legitimately leaves optional settings empty. */
const pruneUndefined = <T>(value: T): T => {
    if (Array.isArray(value)) return value.map(pruneUndefined) as unknown as T
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .map(([key, item]) => [key, pruneUndefined(item)]),
        ) as T
    }
    return value
}

/** Older documents may have stored lessons as a map; the builder always works with an array. */
export const toLessonsArray = (value: unknown): CourseLesson[] => {
    if (!value) return []
    if (Array.isArray(value)) return value as CourseLesson[]
    if (typeof value === 'object') return Object.values(value as Record<string, CourseLesson>)
    return []
}

export const listCourseTemplates = async (programId?: string): Promise<CourseTemplate[]> => {
    const db = getFirebaseDb()
    const snapshot = programId
        ? await getDocs(query(collection(db, COLLECTION), where('programId', '==', programId)))
        : await getDocs(collection(db, COLLECTION))

    return snapshot.docs
        .map((row) => {
            const data = row.data() as CourseTemplate
            return { ...data, id: row.id, lessons: toLessonsArray(data.lessons) }
        })
        .sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')))
}

export const loadCourseTemplate = async (courseId: string): Promise<CourseTemplate | null> => {
    const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTION, courseId))
    if (!snapshot.exists()) return null
    const data = snapshot.data() as CourseTemplate
    return { ...data, id: courseId, lessons: toLessonsArray(data.lessons) }
}

export const saveCourseTemplate = async (
    course: CourseTemplate,
    user?: FullIdentity | null,
): Promise<string> => {
    const db = getFirebaseDb()
    const payload = pruneUndefined({
        ...course,
        department: course.department ?? user?.departmentId ?? undefined,
        createdBy: course.createdBy ?? user?.uid,
        updatedAt: new Date().toISOString(),
    })

    if (course.id) {
        await updateDoc(doc(db, COLLECTION, course.id), payload as Record<string, unknown>)
        return course.id
    }

    const created = await addDoc(collection(db, COLLECTION), payload as Record<string, unknown>)
    return created.id
}

export const deleteCourseTemplate = async (courseId: string) => {
    await deleteDoc(doc(getFirebaseDb(), COLLECTION, courseId))
}

/**
 * Publishing hands the course to the programme's SMEs. Mirrors
 * assignSurveyToProgramme: everything downstream (the incubatee course list,
 * operations progress tracking) reads `courseAssignments`, so a published
 * course has to fan out into one assignment per accepted participant.
 * Re-publishing is safe: anyone who already has it is skipped.
 */
export const assignCourseToProgramme = async (course: CourseTemplate): Promise<number> => {
    if (!course.id || !course.programId) return 0

    const db = getFirebaseDb()
    const [applications, existing] = await Promise.all([
        getDocs(query(collection(db, 'applications'), where('programId', '==', course.programId))),
        getDocs(query(collection(db, ASSIGNMENTS), where('courseId', '==', course.id))),
    ])

    const alreadyAssigned = new Set(existing.docs.map((row) => String((row.data() as Record<string, unknown>).participantId || '')))

    const participantIds = [...new Set(applications.docs
        .map((row) => row.data() as Record<string, unknown>)
        .filter((row) => String(row.applicationStatus || '').trim().toLowerCase() === 'accepted')
        .map((row) => String(row.participantId || row.uid || row.userId || '').trim())
        .filter(Boolean))]
        .filter((participantId) => !alreadyAssigned.has(participantId))

    if (!participantIds.length) return 0

    const now = new Date().toISOString()
    const batch = writeBatch(db)

    participantIds.forEach((participantId) => {
        batch.set(doc(collection(db, ASSIGNMENTS)), {
            courseId: course.id,
            courseTitle: course.title,
            category: course.category,
            participantId,
            programId: course.programId,
            status: 'assigned',
            createdAt: now,
            updatedAt: now,
        })
    })

    await batch.commit()
    return participantIds.length
}
