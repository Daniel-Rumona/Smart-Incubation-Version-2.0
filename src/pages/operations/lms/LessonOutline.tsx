import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Empty, Tag, Typography } from 'antd'
import { HolderOutlined } from '@ant-design/icons'
import type { CourseLesson } from '@/services/courseTemplatesService'

type OutlineProps = {
    lessons: CourseLesson[]
    selectedId: string | null
    onSelect: (id: string) => void
    onReorder: (from: number, to: number) => void
}

const OutlineRow = ({ lesson, index, selected, onSelect }: { lesson: CourseLesson, index: number, selected: boolean, onSelect: () => void }) => {
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
                <Typography.Paragraph ellipsis={{ rows: 2, tooltip: lesson.title || 'Untitled lesson' }} className="survey-outline-label">
                    {lesson.title || 'Untitled lesson'}
                </Typography.Paragraph>
                <span className="survey-outline-type">{lesson.quiz?.length ? `${lesson.quiz.length} quiz question${lesson.quiz.length === 1 ? '' : 's'}` : 'Lesson'}</span>
            </span>
        </div>
    )
}

export const LessonOutline = ({ lessons, selectedId, onSelect, onReorder }: OutlineProps) => {
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

    if (!lessons.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No lessons yet" />

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={lessons.map((lesson) => lesson.id)} strategy={verticalListSortingStrategy}>
                <div className="survey-outline">
                    {lessons.map((lesson, index) => (
                        <OutlineRow
                            key={lesson.id}
                            lesson={lesson}
                            index={index}
                            selected={lesson.id === selectedId}
                            onSelect={() => onSelect(lesson.id)}
                        />
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    )
}

export default LessonOutline
