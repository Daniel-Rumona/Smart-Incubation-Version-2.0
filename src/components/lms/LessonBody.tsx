import { Typography } from 'antd'
import { toEmbedVideoUrl } from '@/lib/courseVideo'
import type { CourseLesson } from '@/services/courseTemplatesService'

type LessonBodyProps = {
    lesson: CourseLesson
}

/** The lesson's video and written content — the quiz is its own step, see LessonQuiz. */
export const LessonBody = ({ lesson }: LessonBodyProps) => {
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

            {!video && !lesson.body?.trim() && (
                <Typography.Text type="secondary">This lesson has no content yet.</Typography.Text>
            )}
        </div>
    )
}

export default LessonBody
