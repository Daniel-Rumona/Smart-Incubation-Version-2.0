import type { CourseLesson } from '@/services/courseTemplatesService'

export type LessonStepKind = 'content' | 'quiz' | 'review'

export type LessonStep = {
    /** `${lesson.id}:${kind}` — stable across reorders as long as the lesson id doesn't change. */
    id: string
    kind: LessonStepKind
    lesson: CourseLesson
}

/**
 * Flattens the lesson list into the one-thing-at-a-time step sequence: each
 * lesson's own content, then (if present) its quiz as an independent step,
 * then (if enabled) an AI review step — never bundled into one screen.
 */
export const buildLessonSteps = (lessons: CourseLesson[], options?: { includeReview?: boolean }): LessonStep[] => {
    const includeReview = options?.includeReview ?? true
    const steps: LessonStep[] = []

    lessons.forEach((lesson) => {
        steps.push({ id: `${lesson.id}:content`, kind: 'content', lesson })
        if (lesson.quiz?.length) steps.push({ id: `${lesson.id}:quiz`, kind: 'quiz', lesson })
        if (includeReview && lesson.aiReviewEnabled) steps.push({ id: `${lesson.id}:review`, kind: 'review', lesson })
    })

    return steps
}
