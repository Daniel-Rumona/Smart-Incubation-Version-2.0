import { Checkbox, Input, Radio } from 'antd'
import { hasQuizAnswer, type LessonAnswers } from '@/lib/quizAnswers'
import type { CourseLesson } from '@/services/courseTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

type LessonQuizProps = {
    lesson: CourseLesson
    /** Omit for a read-only preview — the quiz still renders, just disabled. */
    answers?: LessonAnswers
    onAnswer?: (questionId: string, value: unknown) => void
    /** Shows the required-question error under any unanswered required question. */
    touched?: boolean
}

/** A lesson's end-of-lesson quiz, shown as its own step — see LessonBody for the lesson content itself. */
export const LessonQuiz = ({ lesson, answers, onAnswer, touched }: LessonQuizProps) => {
    const { t } = useLanguage()
    const readOnly = !onAnswer
    const quiz = lesson.quiz || []

    return (
        <div className="lesson-quiz is-standalone">
            {quiz.map((question) => {
                const value = answers?.[question.id]
                const blocked = touched && question.required && !hasQuizAnswer(value)

                return (
                    <div key={question.id} className="lesson-quiz-question">
                        <span className="lesson-quiz-question-text">
                            {question.question || t('Untitled question')}
                            {question.required && <span className="survey-frame-required">*</span>}
                        </span>

                        {question.type === 'single' && (
                            <Radio.Group
                                disabled={readOnly}
                                value={value as string}
                                onChange={(event) => onAnswer?.(question.id, event.target.value)}
                                options={(question.options || []).map((option) => ({ label: option, value: option }))}
                            />
                        )}

                        {question.type === 'multiple' && (
                            <Checkbox.Group
                                disabled={readOnly}
                                value={(value as string[]) || []}
                                onChange={(next) => onAnswer?.(question.id, next)}
                                options={(question.options || []).map((option) => ({ label: option, value: option }))}
                            />
                        )}

                        {question.type === 'text' && (
                            <Input.TextArea
                                disabled={readOnly}
                                rows={2}
                                value={(value as string) || ''}
                                onChange={(event) => onAnswer?.(question.id, event.target.value)}
                            />
                        )}

                        {blocked && <span className="survey-response-error">{t('This question needs an answer before you continue.')}</span>}
                    </div>
                )
            })}
        </div>
    )
}

export default LessonQuiz
