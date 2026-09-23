import type { AgentPageContext } from '@/types/agent'
import type { CourseLesson, CourseTemplate, QuizQuestion } from '@/services/courseTemplatesService'

const quizSummary = (quiz?: QuizQuestion[]) => (quiz || []).map((question) => ({
    question: question.question,
    type: question.type,
    options: question.options,
}))

/**
 * The "sources" an AI Review or lesson-help chat looks at: the lesson's own
 * text content and quiz, handed to the workspace assistant backend as
 * `dataSummary` (see ai-backend/app.py `_public_page_context`, which forwards
 * this verbatim into the model prompt).
 */
export const lessonPageContext = (
    course: CourseTemplate,
    lesson: CourseLesson,
    purpose: string,
): AgentPageContext => ({
    pageKey: 'lms-lesson',
    pageName: `${course.title || 'Course'} — ${lesson.title || 'Lesson'}`,
    purpose,
    dataSummary: {
        courseTitle: course.title,
        courseDescription: course.description,
        lessonTitle: lesson.title,
        lessonContent: lesson.body,
        hasVideo: Boolean(lesson.videoUrl),
        quizQuestions: quizSummary(lesson.quiz),
    },
    updatedAt: new Date().toISOString(),
})
