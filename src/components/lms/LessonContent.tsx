import { Checkbox, Input, Radio, Typography } from 'antd'
import { toEmbedVideoUrl } from '@/lib/courseVideo'
import { hasQuizAnswer, type LessonAnswers } from '@/lib/quizAnswers'
import type { CourseLesson } from '@/services/courseTemplatesService'

type LessonContentProps = {
    lesson: CourseLesson
    /** Omit for a read-only preview — the quiz still renders, just disabled. */
    answers?: LessonAnswers
    onAnswer?: (questionId: string, value: unknown) => void
    /** Shows the required-question error under any unanswered required question. */
    touched?: boolean
}

export const LessonContent = ({ lesson, answers, onAnswer, touched }: LessonContentProps) => {
    const readOnly = !onAnswer
    const video = lesson.videoUrl?.trim() ? toEmbedVideoUrl(lesson.videoUrl) : null

    return (
        <div className="lesson-content">
            {video && (
                <div className="lesson-video">
                    {video.kind === 'file' ? (
                        <video src={video.src} controls className="lesson-video-frame" />
                    ) : (
                        <iframe
                            src={video.src}
                            className="lesson-video-frame"
                            title={lesson.title || 'Lesson video'}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    )}
                </div>
            )}

            {lesson.body?.trim() && <p className="lesson-body">{lesson.body}</p>}

            {!!lesson.quiz?.length && (
                <div className="lesson-quiz">
                    <Typography.Text className="lesson-quiz-heading" strong>Check your understanding</Typography.Text>

                    {lesson.quiz.map((question) => {
                        const value = answers?.[question.id]
                        const blocked = touched && question.required && !hasQuizAnswer(value)

                        return (
                            <div key={question.id} className="lesson-quiz-question">
                                <span className="lesson-quiz-question-text">
                                    {question.question || 'Untitled question'}
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

                                {blocked && <span className="survey-response-error">This question needs an answer before you continue.</span>}
                            </div>
                        )
                    })}
                </div>
            )}

            {!video && !lesson.body?.trim() && !lesson.quiz?.length && (
                <Typography.Text type="secondary">This lesson has no content yet.</Typography.Text>
            )}
        </div>
    )
}

export default LessonContent
