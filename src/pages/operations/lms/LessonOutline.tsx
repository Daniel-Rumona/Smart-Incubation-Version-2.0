import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Empty, Tag, Typography } from 'antd'
import { HolderOutlined, QuestionCircleOutlined, RobotOutlined } from '@ant-design/icons'
import type { CourseLesson } from '@/services/courseTemplatesService'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type OutlineProps = {
    lessons: CourseLesson[]
    /** A step id: `${lessonId}:content` or `${lessonId}:quiz` — quiz is its own selectable row, not folded into the lesson. */
    selectedId: string | null
    onSelect: (stepId: string) => void
    onReorder: (from: number, to: number) => void
}

const OutlineRow = ({ lesson, index, selected, onSelect }: { lesson: CourseLesson, index: number, selected: boolean, onSelect: () => void }) => {
    const { t } = useLanguage()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: lesson.id })

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={`survey-outline-row${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
            onClick={onSelect}
        >
            {/* Only the handle drags, so a tap anywhere else still selects the lesson. */}
            <span className="survey-outline-handle" {...attributes} {...listeners}><HolderOutlined /></span>

            <Tag className="survey-outline-index">{index + 1}</Tag>

            <span className="survey-outline-copy">
                <Typography.Paragraph ellipsis={{ rows: 2, tooltip: lesson.title || t('Untitled lesson') }} className="survey-outline-label">
                    {lesson.title || t('Untitled lesson')}
                </Typography.Paragraph>
                <span className="survey-outline-type">
                    {t('Lesson')}
                    {lesson.aiReviewEnabled && <RobotOutlined title={t('AI review follows this lesson')} style={{ marginLeft: 6 }} />}
                </span>
            </span>
        </div>
    )
}

/** A quiz is its own outline entry, indented under its lesson — not draggable, since it always follows that lesson's content. */
const QuizRow = ({ lesson, selected, onSelect }: { lesson: CourseLesson, selected: boolean, onSelect: () => void }) => (
    <div
        className={`survey-outline-row survey-outline-subrow${selected ? ' is-selected' : ''}`}
        onClick={onSelect}
    >
        <span className="survey-outline-handle survey-outline-subrow-icon"><QuestionCircleOutlined /></span>
        <span className="survey-outline-copy">
            <span className="survey-outline-label">{tr('Quiz')}</span>
            <span className="survey-outline-type">{lesson.quiz?.length} {tr('question')}{lesson.quiz?.length === 1 ? '' : 's'}</span>
        </span>
    </div>
)

export const LessonOutline = ({ lessons, selectedId, onSelect, onReorder }: OutlineProps) => {
    const { t } = useLanguage()
    // A small activation distance keeps a plain click selecting rather than starting a drag.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const from = lessons.findIndex((lesson) => lesson.id === active.id)
        const to = lessons.findIndex((lesson) => lesson.id === over.id)
        if (from < 0 || to < 0) return
        onReorder(from, to)
    }

    if (!lessons.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No lessons yet')} />

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={lessons.map((lesson) => lesson.id)} strategy={verticalListSortingStrategy}>
                <div className="survey-outline">
                    {lessons.map((lesson, index) => (
                        <div key={lesson.id}>
                            <OutlineRow
                                lesson={lesson}
                                index={index}
                                selected={selectedId === `${lesson.id}:content`}
                                onSelect={() => onSelect(`${lesson.id}:content`)}
                            />
                            {!!lesson.quiz?.length && (
                                <QuizRow
                                    lesson={lesson}
                                    selected={selectedId === `${lesson.id}:quiz`}
                                    onSelect={() => onSelect(`${lesson.id}:quiz`)}
                                />
                            )}
                        </div>
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    )
}

export default LessonOutline
