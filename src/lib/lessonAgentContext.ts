import type { AgentPageContext } from '@/types/agent'
import type { CourseLesson, CourseTemplate, QuizQuestion } from '@/services/courseTemplatesService'
import type { SmeBusiness } from '@/services/courseProgressService'

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
    business?: SmeBusiness,
): AgentPageContext => ({
    pageKey: 'lms-lesson',
    pageName: `${course.title || 'Course'} — ${lesson.title || 'Lesson'}`,
    purpose: business
        ? `${purpose} The learner runs their own small business (see learnerBusiness). Whenever you give an example, analogy or scenario, set it in that business and sector — use their kind of products, customers and costs — instead of a generic example, and refer to the business naturally.`
        : purpose,
    dataSummary: {
        learnerBusiness: business,
        courseTitle: course.title,
        courseDescription: course.description,
        lessonTitle: lesson.title,
        lessonContent: lesson.body,
        hasVideo: Boolean(lesson.videoUrl),
        quizQuestions: quizSummary(lesson.quiz),
    },
    updatedAt: new Date().toISOString(),
})
