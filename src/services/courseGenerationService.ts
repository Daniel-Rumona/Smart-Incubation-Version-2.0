import { agentApiBaseUrl, isAgentApiConfigured } from '@/config/agent'
import { getAgentAuthHeaders } from '@/services/agentAuth'
import { generateLessonId, generateQuizQuestionId, type CourseLesson, type QuizQuestion, type QuizQuestionType } from '@/services/courseTemplatesService'

type ApiError = { detail?: string | { message?: string }, error?: string }

const post = async <T>(path: string, body: unknown): Promise<T> => {
    if (!isAgentApiConfigured) throw new Error('The AI assistant is not configured, so lessons cannot be generated.')

    const response = await fetch(`${agentApiBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getAgentAuthHeaders()) },
        body: JSON.stringify(body),
    })

    if (!response.ok) {
        const data = await response.json().catch(() => null) as ApiError | null
        const detail = typeof data?.detail === 'string' ? data.detail : data?.detail?.message || data?.error
        throw new Error(detail || 'The AI could not complete that. Please try again.')
    }

    return response.json() as Promise<T>
}

export type GeneratedCourse = {
    title: string
    description: string
    lessons: CourseLesson[]
}

/** Turns text extracted from a document into lessons (ids minted here so they never collide with existing ones). */
export const generateCourseFromText = async (text: string, fileName?: string): Promise<GeneratedCourse> => {
    const data = await post<{ title: string, description: string, lessons: Array<{ title: string, body: string }> }>(
        '/api/courses/generate-lessons',
        { text, fileName },
    )

    return {
        title: data.title,
        description: data.description,
        lessons: data.lessons.map((lesson) => ({ id: generateLessonId(), title: lesson.title, body: lesson.body })),
    }
}

/** Questions written from a lesson's own text. */
export const generateQuizForLesson = async (lesson: Pick<CourseLesson, 'title' | 'body'>, count = 3): Promise<QuizQuestion[]> => {
    const data = await post<{ questions: Array<{ type: string, question: string, options: string[], correctOptions: string[] }> }>(
        '/api/courses/generate-quiz',
        { lessonTitle: lesson.title, lessonBody: lesson.body, count },
    )

    return data.questions.map((question) => ({
        id: generateQuizQuestionId(),
        type: question.type as QuizQuestionType,
        question: question.question,
        required: false,
        options: question.type === 'text' ? undefined : question.options,
        correctOptions: question.type === 'text' ? undefined : question.correctOptions,
    }))
}
