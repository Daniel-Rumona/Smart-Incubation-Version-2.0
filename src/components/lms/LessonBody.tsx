import { Typography } from 'antd'
import { toEmbedVideoUrl } from '@/lib/courseVideo'
import type { CourseLesson } from '@/services/courseTemplatesService'
import MaterialIcon from '@/components/lms/MaterialIcon'
import { formatFileSize } from '@/lib/fileSize'
import { useLanguage } from '@/providers/LanguageProvider'

type LessonBodyProps = {
    lesson: CourseLesson
}

/** The lesson's video and written content — the quiz is its own step, see LessonQuiz. */
export const LessonBody = ({ lesson }: LessonBodyProps) => {
    const { t } = useLanguage()
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
                            title={lesson.title || t('Lesson video')}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                        />
                    )}
                </div>
            )}

            {lesson.body?.trim() && <p className="lesson-body">{lesson.body}</p>}

            {!!lesson.materials?.length && (
                <div className="lesson-materials">
                    <strong>{t('Materials')}</strong>
                    <ul>
                        {lesson.materials.map((material) => (
                            <li key={material.id}>
                                <MaterialIcon kind={material.kind} />
                                <a href={material.url} target="_blank" rel="noreferrer">{material.name}</a>
                                <small>{formatFileSize(material.size)}</small>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {!video && !lesson.body?.trim() && !lesson.materials?.length && (
                <Typography.Text type="secondary">{t('This lesson has no content yet.')}</Typography.Text>
            )}
        </div>
    )
}

export default LessonBody
