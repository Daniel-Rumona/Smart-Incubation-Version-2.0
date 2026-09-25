import { useMemo, useState, type ReactNode } from 'react'
import { Empty, Input, Modal, Typography } from 'antd'
import {
    AlignLeftOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    CheckSquareOutlined,
    DownOutlined,
    FontSizeOutlined,
    LockOutlined,
    MailOutlined,
    NumberOutlined,
    SearchOutlined,
    StarOutlined,
    UploadOutlined,
} from '@ant-design/icons'
import { PREFILL_SECTIONS, type PrefillSection } from '@/lib/surveyPrefill'
import type { SurveyFieldType } from '@/services/surveyTemplatesService'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type FieldTypeItem = { value: SurveyFieldType, label: string, icon: ReactNode, tone: string }

/** Grouped so the list reads as a palette rather than eleven equal options. */
const FIELD_TYPE_GROUPS: Array<{ title: string, items: FieldTypeItem[] }> = [
    {
        get title() { return tr('Text') },
        items: [
            { value: 'text', get label() { return tr('Text field') }, icon: <FontSizeOutlined />, tone: 'is-blue' },
            { value: 'textarea', get label() { return tr('Text area') }, icon: <AlignLeftOutlined />, tone: 'is-blue' },
            { value: 'heading', get label() { return tr('Section heading') }, icon: <FontSizeOutlined />, tone: 'is-blue' },
        ],
    },
    {
        get title() { return tr('Choice') },
        items: [
            { value: 'select', get label() { return tr('Dropdown') }, icon: <DownOutlined />, tone: 'is-violet' },
            { value: 'checkbox', get label() { return tr('Checkbox group') }, icon: <CheckSquareOutlined />, tone: 'is-violet' },
            { value: 'radio', get label() { return tr('Radio group') }, icon: <CheckCircleOutlined />, tone: 'is-violet' },
        ],
    },
    {
        get title() { return tr('Input') },
        items: [
            { value: 'number', get label() { return tr('Number') }, icon: <NumberOutlined />, tone: 'is-amber' },
            { value: 'date', get label() { return tr('Date picker') }, icon: <CalendarOutlined />, tone: 'is-amber' },
            { value: 'file', get label() { return tr('File upload') }, icon: <UploadOutlined />, tone: 'is-amber' },
        ],
    },
    {
        get title() { return tr('Contact and rating') },
        items: [
            { value: 'email', get label() { return tr('Email') }, icon: <MailOutlined />, tone: 'is-pink' },
            { value: 'rating', get label() { return tr('Rating') }, icon: <StarOutlined />, tone: 'is-green' },
        ],
    },
]

type AddFieldModalProps = {
    open: boolean
    onClose: () => void
    onAdd: (type: SurveyFieldType) => void
    /** Adds a whole preset section: a heading plus its prefilled questions. */
    onAddSection?: (section: PrefillSection) => void
}

export const AddFieldModal = ({ open, onClose, onAdd, onAddSection }: AddFieldModalProps) => {
    const { t } = useLanguage()
    const [search, setSearch] = useState('')
    const term = search.trim().toLowerCase()

    const groups = useMemo(
        () => FIELD_TYPE_GROUPS
            .map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(term)) }))
            .filter((group) => group.items.length),
        [term],
    )

    const sections = useMemo(
        () => (onAddSection
            ? PREFILL_SECTIONS.filter((section) => section.title.toLowerCase().includes(term)
                || section.fields.some((field) => field.label.toLowerCase().includes(term)))
            : []),
        [term, onAddSection],
    )

    const close = () => { setSearch(''); onClose() }

    return (
        <Modal
            open={open}
            onCancel={close}
            footer={null}
            width={860}
            title={null}
            className="survey-add-modal"
        >
            <div className="survey-add-head">
                <Typography.Title level={4}>{t('Add field')}</Typography.Title>
                <Typography.Text type="secondary">{t('Choose the type of question or element you want to add.')}</Typography.Text>
            </div>

            <Input
                size="large"
                allowClear
                prefix={<SearchOutlined />}
                placeholder={t('Search form elements')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="survey-add-search"
            />

            {!groups.length && !sections.length ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No matching field types')} />
            ) : (
                <div className="survey-add-groups">
                    {sections.length > 0 && (
                        <div className="survey-add-group">
                            <span className="survey-add-group-title">{t('Prefilled sections')}</span>

                            {sections.map((section) => (
                                <button
                                    type="button"
                                    key={section.id}
                                    className="survey-add-option"
                                    onClick={() => { setSearch(''); onAddSection?.(section) }}
                                >
                                    <span className="survey-add-option-icon is-blue"><LockOutlined /></span>
                                    <span className="survey-add-option-copy">
                                        <strong>{section.title}</strong>
                                        <span>{section.fields.map((field) => field.label).join(', ')}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}

                    {groups.map((group) => (
                        <div className="survey-add-group" key={group.title}>
                            <span className="survey-add-group-title">{group.title}</span>

                            {group.items.map((item) => (
                                <button
                                    type="button"
                                    key={item.value}
                                    className="survey-add-option"
                                    onClick={() => { setSearch(''); onAdd(item.value) }}
                                >
                                    <span className={`survey-add-option-icon ${item.tone}`}>{item.icon}</span>
                                    <span className="survey-add-option-copy"><strong>{item.label}</strong></span>
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}
        </Modal>
    )
}

export default AddFieldModal
