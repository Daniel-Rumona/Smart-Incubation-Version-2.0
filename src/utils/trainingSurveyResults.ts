import type { TrainingSurvey, TrainingSurveyAnswer, TrainingSurveyQuestion, TrainingSurveyResponse, TrainingSurveyValues } from '@/types/trainingSurveys'

/**
 * Survey questions, ready-made surveys and results, without runtime imports (also run under Node in tests).
 */

let counter = 0
export const newQuestionId = () => `q${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

const question = (type: TrainingSurveyQuestion['type'], text: string, options: string[] = [], required = true): TrainingSurveyQuestion =>
    ({ id: newQuestionId(), type, text, options, required })

export const blankQuestion = (type: TrainingSurveyQuestion['type'] = 'rating'): TrainingSurveyQuestion =>
    question(type, '', type === 'choice' ? ['', ''] : [])

/** Ready-made surveys: her training pack's participant feedback form first. */
export const SURVEY_TEMPLATES: Array<{ key: string, label: string, values: () => TrainingSurveyValues }> = [
    {
        key: 'feedback',
        label: 'Participant feedback form (from your training pack)',
        values: () => ({
            title: 'Participant feedback form',
            description: 'Tell us how the training went. It takes two minutes.',
            audience: 'learners',
            classIds: [],
            hideNames: false,
            questions: [
                question('rating', 'The training objectives were clear.'),
                question('rating', 'Examples were relevant to my workplace.'),
                question('rating', 'I can identify at least three ESG actions.'),
                question('text', 'Most useful activity'),
                question('text', 'Suggested improvement', [], false),
            ],
        }),
    },
    {
        key: 'client',
        label: 'Client company satisfaction',
        values: () => ({
            title: 'How did the training work for your company?',
            description: 'Your answers help us plan the next trainings and ESG work with you.',
            audience: 'companies',
            classIds: [],
            hideNames: false,
            questions: [
                question('rating', 'Overall, how satisfied are you with the training your people attended?'),
                question('rating', 'How useful is it to your company\'s ESG work?'),
                question('yesno', 'Would you send more staff to this training?'),
                question('choice', 'What would help your company most next?', ['More staff trained', 'An ESG report', 'A carbon footprint', 'Help with an ESG policy']),
                question('text', 'Anything else we should know?', [], false),
            ],
        }),
    },
    {
        key: 'blank',
        label: 'Start from a blank survey',
        values: () => ({ title: '', description: '', audience: 'learners', classIds: [], hideNames: false, questions: [blankQuestion('rating')] }),
    },
]

/** Problems that stop a survey being opened. */
export const surveyProblems = (survey: Pick<TrainingSurvey, 'title' | 'questions'>) => {
    const problems: string[] = []
    if (!survey.title.trim()) problems.push('Give the survey a title.')
    if (!survey.questions.length) problems.push('Add at least one question.')
    survey.questions.forEach((item, index) => {
        if (!item.text.trim()) problems.push(`Question ${index + 1} has no text.`)
        if (item.type === 'choice' && item.options.filter((option) => option.trim()).length < 2) problems.push(`Question ${index + 1} needs at least two choices.`)
    })
    return problems
}

/** Whether an answer counts as given. */
export const answered = (value: TrainingSurveyAnswer | undefined) => (typeof value === 'number' ? true : typeof value === 'string' && value.trim() !== '')

/** The required questions still unanswered. */
export const missingAnswers = (survey: Pick<TrainingSurvey, 'questions'>, answers: Record<string, TrainingSurveyAnswer>) =>
    survey.questions.filter((item) => item.required && !answered(answers[item.id]))

export type QuestionResult =
    | { question: TrainingSurveyQuestion, kind: 'rating', answers: number, average: number | null, counts: number[] }
    | { question: TrainingSurveyQuestion, kind: 'counts', answers: number, counts: Array<{ label: string, count: number }> }
    | { question: TrainingSurveyQuestion, kind: 'text', answers: number, texts: Array<{ text: string, by?: string }> }

/** Per question: ratings (average and 1-5 counts), choices and yes/no (counts), written answers (each, with who wrote it unless names are hidden). */
export const surveyResults = (survey: Pick<TrainingSurvey, 'questions' | 'hideNames'>, responses: TrainingSurveyResponse[]): QuestionResult[] =>
    survey.questions.map((item): QuestionResult => {
        const given = responses.filter((response) => answered(response.answers[item.id]))
        if (item.type === 'rating') {
            const values = given.map((response) => Number(response.answers[item.id])).filter((value) => value >= 1 && value <= 5)
            const counts = [1, 2, 3, 4, 5].map((score) => values.filter((value) => value === score).length)
            return { question: item, kind: 'rating', answers: values.length, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, counts }
        }
        if (item.type === 'choice' || item.type === 'yesno') {
            const labels = item.type === 'yesno' ? ['yes', 'no'] : item.options.filter((option) => option.trim())
            const counts = labels.map((label) => ({ label, count: given.filter((response) => response.answers[item.id] === label).length }))
            return { question: item, kind: 'counts', answers: given.length, counts }
        }
        return {
            question: item,
            kind: 'text',
            answers: given.length,
            texts: given.map((response) => ({ text: String(response.answers[item.id]).trim(), by: survey.hideNames ? undefined : [response.name, response.organisation].filter(Boolean).join(', ') || undefined })),
        }
    })

/** The average of all rating questions together; null without ratings. */
export const overallRating = (results: QuestionResult[]) => {
    const ratings = results.filter((item): item is Extract<QuestionResult, { kind: 'rating' }> => item.kind === 'rating' && item.average !== null)
    const total = ratings.reduce((sum, item) => sum + (item.average as number) * item.answers, 0)
    const count = ratings.reduce((sum, item) => sum + item.answers, 0)
    return count ? total / count : null
}

/** The answers as CSV rows (Excel opens it): one row per person, one column per question. */
export const surveyCsv = (survey: Pick<TrainingSurvey, 'questions' | 'hideNames'>, responses: TrainingSurveyResponse[]) => {
    const cell = (value: unknown) => {
        const text = String(value ?? '')
        return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const header = [...(survey.hideNames ? [] : ['Name', 'Organisation']), 'Submitted', ...survey.questions.map((item) => item.text)]
    const rows = responses.map((response) => [
        ...(survey.hideNames ? [] : [response.name || '', response.organisation || '']),
        response.submittedAt.slice(0, 10),
        ...survey.questions.map((item) => response.answers[item.id] ?? ''),
    ])
    return [header, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
}
