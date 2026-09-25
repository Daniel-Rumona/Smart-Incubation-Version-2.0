import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Empty, Tag, Typography } from 'antd'
import { HolderOutlined } from '@ant-design/icons'
import { SURVEY_FIELD_TYPES, type SurveyField } from '@/services/surveyTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

type OutlineProps = {
    fields: SurveyField[]
    selectedId: string | null
    onSelect: (id: string) => void
    onReorder: (from: number, to: number) => void
}

const typeLabel = (type: string) => SURVEY_FIELD_TYPES.find((item) => item.value === type)?.label || type

const OutlineRow = ({ field, index, selected, onSelect }: { field: SurveyField, index: number, selected: boolean, onSelect: () => void }) => {
    const { t } = useLanguage()
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id })

    return (
        <div
            ref={setNodeRef}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={`survey-outline-row${selected ? ' is-selected' : ''}${isDragging ? ' is-dragging' : ''}`}
            onClick={onSelect}
        >
            {/* Only the handle drags, so a tap anywhere else still selects the question. */}
            <span className="survey-outline-handle" {...attributes} {...listeners}><HolderOutlined /></span>

            <Tag className="survey-outline-index">{index + 1}</Tag>

            <span className="survey-outline-copy">
                <Typography.Paragraph ellipsis={{ rows: 2, tooltip: field.label || t('Untitled question') }} className="survey-outline-label">
                    {field.label || t('Untitled question')}
                </Typography.Paragraph>
                <span className="survey-outline-type">{typeLabel(field.type)}</span>
            </span>
        </div>
    )
}

export const SurveyOutline = ({ fields, selectedId, onSelect, onReorder }: OutlineProps) => {
    const { t } = useLanguage()
    // A small activation distance keeps a plain click selecting rather than starting a drag.
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        const from = fields.findIndex((field) => field.id === active.id)
        const to = fields.findIndex((field) => field.id === over.id)
        if (from < 0 || to < 0) return
        onReorder(from, to)
    }

    if (!fields.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No questions yet')} />

    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
                <div className="survey-outline">
                    {fields.map((field, index) => (
                        <OutlineRow
                            key={field.id}
                            field={field}
                            index={index}
                            selected={field.id === selectedId}
                            onSelect={() => onSelect(field.id)}
                        />
                    ))}
                </div>
            </SortableContext>
        </DndContext>
    )
}

export default SurveyOutline
