import { useMemo, useState } from 'react'
import { Button, Empty, Modal, Tag } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined } from '@ant-design/icons'
import SurveyQuestionFrame from '@/components/surveys/SurveyQuestionFrame'
import LessonBody from '@/components/lms/LessonBody'
import LessonQuiz from '@/components/lms/LessonQuiz'
import { buildLessonSteps } from '@/lib/lessonSteps'
import type { CourseLesson } from '@/services/courseTemplatesService'

type PreviewCourseModalProps = {
    open: boolean
    title: string
    description?: string
    lessons: CourseLesson[]
    onClose: () => void
}

const PreviewCourseBody = ({ open, title, description, lessons, onClose }: PreviewCourseModalProps) => {
    const [index, setIndex] = useState(0)
    // Remounting on open (see the key below) resets this rather than an effect.

    // The AI review step needs a live conversation, so preview walks through
    // content and quiz only — exactly what the operations builder controls.
    const steps = useMemo(() => buildLessonSteps(lessons, { includeReview: false }), [lessons])
    const current = steps[index]
    const isFirst = index === 0
    const isLast = index === steps.length - 1

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={720}
            title={null}
            className="survey-preview-modal"
        >
            {steps.length === 0 || !current ? (
                <div className="survey-preview-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This course has no lessons yet" />
                    <Button onClick={onClose}>Close</Button>
                </div>
            ) : (
                <SurveyQuestionFrame
                    index={index}
                    total={steps.length}
                    field={{ id: current.id, type: current.kind, label: current.kind === 'quiz' ? `${current.lesson.title || 'Lesson'} — Quiz` : current.lesson.title || 'Untitled lesson' }}
                    surveyTitle={title || 'Untitled course'}
                    surveySubtitle={description}
                    extra={current.kind === 'content' && current.lesson.aiReviewEnabled ? <Tag color="purple">AI review follows this lesson</Tag> : undefined}
                    footer={
                        <div className={`survey-preview-nav${isFirst || steps.length === 1 ? ' is-single' : ''}`}>
                            {!isFirst && (
                                <Button block size="large" icon={<ArrowLeftOutlined />} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
                                    Previous
                                </Button>
                            )}

                            {isLast ? (
                                <Button block size="large" type="primary" icon={<CheckOutlined />} onClick={onClose}>Finish</Button>
                            ) : (
                                <Button block size="large" type="primary" onClick={() => setIndex((value) => Math.min(steps.length - 1, value + 1))}>
                                    Next <ArrowRightOutlined />
                                </Button>
                            )}
                        </div>
                    }
                >
                    {current.kind === 'quiz' ? <LessonQuiz lesson={current.lesson} /> : <LessonBody lesson={current.lesson} />}
                </SurveyQuestionFrame>
            )}
        </Modal>
    )
}

export const PreviewCourseModal = (props: PreviewCourseModalProps) => (
    <PreviewCourseBody {...props} key={props.open ? 'open' : 'closed'} />
)

export default PreviewCourseModal
