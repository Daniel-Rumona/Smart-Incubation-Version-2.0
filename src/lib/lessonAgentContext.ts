import type { AgentPageContext } from '@/types/agent'
import type { CourseLesson, CourseTemplate, QuizQuestion } from '@/services/courseTemplatesService'
import type { SmeBusiness } from '@/services/courseProgressService'

export type MaterialText = { name: string, text: string }

// The whole request goes to the model, so material text is kept to what a lesson chat needs.
const MATERIAL_EXCERPT_CHARS = 4000
const MATERIAL_FOCUS_CHARS = 20000

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
    materials?: { readable: MaterialText[], focus?: MaterialText },
): AgentPageContext => ({
    pageKey: 'lms-lesson',
    pageName: `${course.title || 'Course'} — ${lesson.title || 'Lesson'}`,
    purpose: (materials?.readable.length
        ? `${purpose} The lesson has attached reading material (lessonMaterials${materials.focus ? ', and focusedMaterial is the one the learner is asking about' : ''}); ground your explanation in that material and name it when you draw on it.`
        : purpose)
        + (business
        ? ` The learner runs their own small business (see learnerBusiness). Whenever you give an example, analogy or scenario, set it in that business and sector — use their kind of products, customers and costs — instead of a generic example, and refer to the business naturally.`
        : ''),
    dataSummary: {
        learnerBusiness: business,
        lessonMaterials: materials?.readable.map((item) => ({ name: item.name, excerpt: item.text.slice(0, MATERIAL_EXCERPT_CHARS) })),
        focusedMaterial: materials?.focus ? { name: materials.focus.name, text: materials.focus.text.slice(0, MATERIAL_FOCUS_CHARS) } : undefined,
        courseTitle: course.title,
        courseDescription: course.description,
        lessonTitle: lesson.title,
        lessonContent: lesson.body,
        hasVideo: Boolean(lesson.videoUrl),
        quizQuestions: quizSummary(lesson.quiz),
    },
    updatedAt: new Date().toISOString(),
})
