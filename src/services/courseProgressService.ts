import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { findParticipant } from '@/services/incubateeWorkspaceService'
import { getBusinessProfile } from '@/services/applicantService'
import { toLessonsArray, type CourseLesson, type CourseTemplate } from '@/services/courseTemplatesService'
import type { FullIdentity } from '@/types/identity'

export type LessonAnswers = Record<string, unknown>

/** Time spent on one step, and whether the learner did more than read it (answered, chatted with the AI). */
export type StepStat = { seconds: number; interactive: boolean }

export type CourseProgressStatus = 'not started' | 'in progress' | 'completed'

export type CourseToTake = {
    /** Set once progress exists, so the resume link can be built directly. */
    progressId?: string
    /** Set when this came from an operations assignment rather than an open programme course. */
    assignmentId?: string
    courseId: string
    title: string
    description: string
    category: string
    lessonCount: number
    status: CourseProgressStatus
    updatedAt?: string
    completedAt?: string
}

export type CourseProgress = {
    id?: string
    courseId: string
    assignmentId?: string
    participantId: string
    programId?: string
    currentLessonIndex: number
    completedLessonIds: string[]
    /** Quiz answers, keyed by lesson id then question id. */
    answers: Record<string, LessonAnswers>
    /** Quiz correctness, kept for operations visibility — not shown to the SME as a pass/fail gate. */
    score?: { correct: number; total: number }
    /** Keyed by step id (`${lessonId}:content|quiz|review`). */
    stepStats?: Record<string, StepStat>
    status: 'in progress' | 'completed'
    updatedAt: string
    completedAt?: string
    respondentUid?: string
}

const TEMPLATES = 'courseTemplates'
const ASSIGNMENTS = 'courseAssignments'
const PROGRESS = 'courseProgress'

const asString = (value: unknown) => String(value ?? '').trim()

const courseIdOf = (row: Record<string, unknown>) => asString(row.courseId)

/**
 * What this SME can take: the courses operations assigned to them, plus any
 * published course for their programme that has not been assigned directly.
 * Assignments win where both exist, so nothing is listed twice.
 */
export const listCoursesForParticipant = async (user: FullIdentity, programId?: string): Promise<CourseToTake[]> => {
    const db = getFirebaseDb()
    const participant = await findParticipant(user)
    const participantId = asString(participant?.id) || user.uid

    const [assignments, progressRows, templates] = await Promise.all([
        getDocs(query(collection(db, ASSIGNMENTS), where('participantId', '==', participantId))),
        getDocs(query(collection(db, PROGRESS), where('participantId', '==', participantId))),
        programId
            ? getDocs(query(collection(db, TEMPLATES), where('programId', '==', programId)))
            : getDocs(collection(db, TEMPLATES)),
    ])

    const templateById = new Map(templates.docs.map((row) => {
        const data = row.data() as CourseTemplate
        return [row.id, { ...data, id: row.id, lessons: toLessonsArray(data.lessons) }]
    }))

    const progressByCourse = new Map(progressRows.docs.map((row) => {
        const data = row.data() as CourseProgress
        return [data.courseId, { ...data, id: row.id }]
    }))

    const statusOf = (courseId: string): CourseProgressStatus => {
        const progress = progressByCourse.get(courseId)
        if (!progress) return 'not started'
        return progress.status === 'completed' ? 'completed' : 'in progress'
    }

    const rows: CourseToTake[] = []
    const seen = new Set<string>()

    assignments.docs.forEach((row) => {
        const data = row.data() as Record<string, unknown>
        const courseId = courseIdOf(data)
        if (!courseId) return

        const template = templateById.get(courseId)
        const progress = progressByCourse.get(courseId)
        seen.add(courseId)

        rows.push({
            progressId: progress?.id,
            assignmentId: row.id,
            courseId,
            title: template?.title || asString(data.courseTitle) || 'Course',
            description: template?.description || '',
            category: template?.category || 'Course',
            lessonCount: template?.lessons.length || 0,
            status: statusOf(courseId),
            updatedAt: progress?.updatedAt,
            completedAt: progress?.completedAt,
        })
    })

    templateById.forEach((template, courseId) => {
        if (seen.has(courseId) || template.status !== 'published') return
        const progress = progressByCourse.get(courseId)

        rows.push({
            progressId: progress?.id,
            courseId,
            title: template.title || 'Course',
            description: template.description || '',
            category: template.category || 'Course',
            lessonCount: template.lessons.length,
            status: statusOf(courseId),
            updatedAt: progress?.updatedAt,
            completedAt: progress?.completedAt,
        })
    })

    return rows.sort((left, right) => {
        const order = { 'not started': 0, 'in progress': 1, completed: 2 } as const
        if (order[left.status] !== order[right.status]) return order[left.status] - order[right.status]
        return left.title.localeCompare(right.title)
    })
}

/** What the learner's own business is, so examples and explanations can be about it rather than generic. */
export type SmeBusiness = {
    name?: string
    sector?: string
    nature?: string
    yearsTrading?: number
    location?: string
}

export type CourseProgressContext = {
    template: CourseTemplate
    lessons: CourseLesson[]
    participantId: string
    progress: CourseProgress | null
    assignmentId?: string
    business?: SmeBusiness
}

const pickText = (...values: unknown[]) => values.map((value) => asString(value)).find(Boolean) || undefined

const loadSmeBusiness = async (user: FullIdentity, participant: Record<string, unknown> | null): Promise<SmeBusiness | undefined> => {
    // A missing or unreadable profile just means generic examples, never a failed course load.
    const profile = await getBusinessProfile(user.uid).catch(() => null)

    const business: SmeBusiness = {
        name: pickText(profile?.businessName, participant?.businessName, participant?.companyName),
        sector: pickText(profile?.sector, participant?.sector, participant?.industry),
        nature: pickText(profile?.natureOfBusiness, participant?.natureOfBusiness),
        yearsTrading: typeof profile?.yearsOfTrading === 'number' ? profile.yearsOfTrading : undefined,
        location: pickText([profile?.city, profile?.province].filter(Boolean).join(', ')),
    }

    return Object.values(business).some((value) => value !== undefined) ? business : undefined
}

/** Everything the lesson viewer needs: the course, and any saved progress to resume from. */
export const loadCourseForLesson = async (user: FullIdentity, courseId: string): Promise<CourseProgressContext | null> => {
    const db = getFirebaseDb()
    const snapshot = await getDoc(doc(db, TEMPLATES, courseId))
    if (!snapshot.exists()) return null

    const template = { ...(snapshot.data() as CourseTemplate), id: courseId }
    const lessons = toLessonsArray(template.lessons)

    const participant = await findParticipant(user)
    const participantId = asString(participant?.id) || user.uid

    const [progressRows, assignments] = await Promise.all([
        getDocs(query(collection(db, PROGRESS), where('participantId', '==', participantId), where('courseId', '==', courseId))),
        getDocs(query(collection(db, ASSIGNMENTS), where('participantId', '==', participantId))),
    ])

    const existing = progressRows.docs[0]
    const assignment = assignments.docs.find((row) => courseIdOf(row.data() as Record<string, unknown>) === courseId)

    return {
        template: { ...template, lessons },
        lessons,
        participantId,
        progress: existing ? { ...(existing.data() as CourseProgress), id: existing.id } : null,
        assignmentId: assignment?.id,
        business: await loadSmeBusiness(user, (participant as Record<string, unknown> | null) ?? null),
    }
}

export const saveCourseProgress = async (params: {
    context: CourseProgressContext
    currentLessonIndex: number
    completedLessonIds: string[]
    answers: Record<string, LessonAnswers>
    score?: { correct: number; total: number }
    stepStats?: Record<string, StepStat>
    status: 'in progress' | 'completed'
    user: FullIdentity
}): Promise<string> => {
    const db = getFirebaseDb()
    const { context, currentLessonIndex, completedLessonIds, answers, score, stepStats, status, user } = params
    const now = new Date().toISOString()

    const payload: CourseProgress = {
        courseId: context.template.id as string,
        assignmentId: context.assignmentId,
        participantId: context.participantId,
        programId: context.template.programId,
        currentLessonIndex,
        completedLessonIds,
        answers,
        score,
        stepStats,
        status,
        updatedAt: now,
        ...(status === 'completed' ? { completedAt: now } : {}),
        respondentUid: user.uid,
    }

    const clean = Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))

    let progressId = context.progress?.id
    if (progressId) {
        await setDoc(doc(db, PROGRESS, progressId), clean, { merge: true })
    } else {
        progressId = (await addDoc(collection(db, PROGRESS), clean)).id
    }

    // The incubatee dashboard counts open courses from the assignment's status,
    // so completion has to be reflected there too.
    if (context.assignmentId) {
        await updateDoc(doc(db, ASSIGNMENTS, context.assignmentId), {
            status: status === 'completed' ? 'completed' : 'in progress',
            updatedAt: now,
        }).catch(() => undefined)
    }

    return progressId
}

// ─────────────────────────────────────────────────────────────
// Operations-side progress tracking
// ─────────────────────────────────────────────────────────────

export type CourseProgressSummary = { assigned: number; completed: number }

/** One pass over every assignment, so the courses table can show completion without a query per row. */
export const listCourseProgressSummaries = async (): Promise<Record<string, CourseProgressSummary>> => {
    const snapshot = await getDocs(collection(getFirebaseDb(), ASSIGNMENTS))
    const summaries: Record<string, CourseProgressSummary> = {}

    snapshot.docs.forEach((row) => {
        const data = row.data() as Record<string, unknown>
        const courseId = courseIdOf(data)
        if (!courseId) return

        const summary = summaries[courseId] || { assigned: 0, completed: 0 }
        summary.assigned += 1
        if (asString(data.status).toLowerCase() === 'completed') summary.completed += 1
        summaries[courseId] = summary
    })

    return summaries
}
