export type LessonAnswers = Record<string, unknown>

/** Whether a quiz question has something worth saving — blank strings and empty arrays don't count. */
export const hasQuizAnswer = (value: unknown) => {
    if (value === undefined || value === null) return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim().length > 0
    return true
}
