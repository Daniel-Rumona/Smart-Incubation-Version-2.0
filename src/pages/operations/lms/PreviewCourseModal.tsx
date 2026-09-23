import { useState } from 'react'
import { Button, Empty, Modal } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined } from '@ant-design/icons'
import SurveyQuestionFrame from '@/components/surveys/SurveyQuestionFrame'
import LessonContent from '@/components/lms/LessonContent'
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

    const current = lessons[index]
    const isFirst = index === 0
    const isLast = index === lessons.length - 1

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={720}
            title={null}
            className="survey-preview-modal"
        >
            {lessons.length === 0 || !current ? (
                <div className="survey-preview-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This course has no lessons yet" />
                    <Button onClick={onClose}>Close</Button>
                </div>
            ) : (
                <SurveyQuestionFrame
                    index={index}
                    total={lessons.length}
                    field={{ id: current.id, type: 'lesson', label: current.title || 'Untitled lesson' }}
                    surveyTitle={title || 'Untitled course'}
                    surveySubtitle={description}
                    footer={
                        <div className={`survey-preview-nav${isFirst || lessons.length === 1 ? ' is-single' : ''}`}>
                            {!isFirst && (
                                <Button block size="large" icon={<ArrowLeftOutlined />} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
                                    Previous
                                </Button>
                            )}

                            {isLast ? (
                                <Button block size="large" type="primary" icon={<CheckOutlined />} onClick={onClose}>Finish</Button>
                            ) : (
                                <Button block size="large" type="primary" onClick={() => setIndex((value) => Math.min(lessons.length - 1, value + 1))}>
                                    Next <ArrowRightOutlined />
                                </Button>
                            )}
                        </div>
                    }
                >
                    <LessonContent lesson={current} />
                </SurveyQuestionFrame>
            )}
        </Modal>
    )
}

export const PreviewCourseModal = (props: PreviewCourseModalProps) => (
    <PreviewCourseBody {...props} key={props.open ? 'open' : 'closed'} />
)

export default PreviewCourseModal
