import { Input } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
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

const LETTERS = 'ABCDEFGH'

/**
 * A lesson's end-of-lesson quiz, shown as its own step — see LessonBody for
 * the lesson content itself. Each question is a card with tappable options,
 * in the same visual language as the quiz inside the AI chat.
 */
export const LessonQuiz = ({ lesson, answers, onAnswer, touched }: LessonQuizProps) => {
    const { t } = useLanguage()
    const readOnly = !onAnswer
    const quiz = lesson.quiz || []
    const answered = quiz.filter((question) => hasQuizAnswer(answers?.[question.id])).length

    return (
        <div className="lesson-quiz is-standalone">
            {!readOnly && quiz.length > 1 && (
                <div className="lq-progress" aria-live="polite">
                    <span className="lq-progress-dots">
                        {quiz.map((question) => <i key={question.id} className={hasQuizAnswer(answers?.[question.id]) ? 'is-done' : ''} />)}
                    </span>
                    <span>{t('{answered} of {total} answered', undefined, { answered, total: quiz.length })}</span>
                </div>
            )}

            {quiz.map((question, questionIndex) => {
                const value = answers?.[question.id]
                const done = hasQuizAnswer(value)
                const blocked = touched && question.required && !done
                const selected = question.type === 'multiple' ? ((value as string[]) || []) : value ? [value as string] : []

                const toggle = (option: string) => {
                    if (readOnly) return
                    if (question.type === 'multiple') {
                        onAnswer?.(question.id, selected.includes(option) ? selected.filter((item) => item !== option) : [...selected, option])
                    } else {
                        onAnswer?.(question.id, option)
                    }
                }

                return (
                    <section key={question.id} className={`lq-card${done ? ' is-done' : ''}${blocked ? ' is-blocked' : ''}`}>
                        <div className="lq-card-head">
                            <span className="lq-card-number">{questionIndex + 1}</span>
                            <span className="lq-card-meta">
                                {t('Question {n} of {total}', undefined, { n: questionIndex + 1, total: quiz.length })}
                                {question.required && <em>{t('Required')}</em>}
                            </span>
                            {done && <CheckOutlined className="lq-card-check" />}
                        </div>

                        <strong className="lq-card-question">{question.question || t('Untitled question')}</strong>

                        {question.type === 'multiple' && <span className="lq-card-hint">{t('Select all that apply')}</span>}

                        {question.type !== 'text' && (
                            <div className="lq-options" role={question.type === 'multiple' ? 'group' : 'radiogroup'}>
                                {(question.options || []).map((option, optionIndex) => {
                                    const isSelected = selected.includes(option)

                                    return (
                                        <button
                                            type="button"
                                            key={optionIndex}
                                            role={question.type === 'multiple' ? 'checkbox' : 'radio'}
                                            aria-checked={isSelected}
                                            disabled={readOnly}
                                            className={`lq-option${isSelected ? ' is-selected' : ''}${question.type === 'multiple' ? ' is-multiple' : ''}`}
                                            onClick={() => toggle(option)}
                                        >
                                            <span className="lq-option-mark">
                                                {question.type === 'multiple' ? (isSelected ? <CheckOutlined /> : null) : LETTERS[optionIndex]}
                                            </span>
                                            <span className="lq-option-label">{option}</span>
                                        </button>
                                    )
                                })}
                            </div>
                        )}

                        {question.type === 'text' && (
                            <Input.TextArea
                                className="lq-textarea"
                                disabled={readOnly}
                                autoSize={{ minRows: 3, maxRows: 8 }}
                                placeholder={t('Type your answer…')}
                                value={(value as string) || ''}
                                onChange={(event) => onAnswer?.(question.id, event.target.value)}
                            />
                        )}

                        {blocked && <span className="survey-response-error">{t('This question needs an answer before you continue.')}</span>}
                    </section>
                )
            })}
        </div>
    )
}

export default LessonQuiz
