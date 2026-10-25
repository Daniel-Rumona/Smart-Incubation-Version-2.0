import { useState, type ReactNode } from 'react'
import { Button, Form, Typography, type FormInstance } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import ApplicantProfileManualForm from '@/components/applicant/ApplicantProfileManualForm'
import DirectorsEditor from '@/components/applicant/DirectorsEditor'
import type { ApplicantProfileFormValues } from '@/pages/applicant/ApplicantProfilePage'
import { useLanguage } from '@/providers/LanguageProvider'
import type { BusinessDirector } from '@/types/applicant'
import { ownershipFromDirectors, selfAsDirector } from '@/utils/businessDirectors'
import { hasProfileValue, BUSINESS_PROFILE_SECTIONS, type BusinessProfileSectionKey, type FieldName, type SectionField } from '@/components/applicant/businessProfileSectionsConfig'

const { Text } = Typography

const formatValue = (value: unknown, kind?: SectionField['kind']) => {
    if (kind === 'date' && value && typeof value === 'object' && 'format' in value) {
        return (value as { format: (pattern: string) => string }).format('D MMM YYYY')
    }
    const text = String(value)
    // Enough of an ID number to recognise it, without putting the whole number on screen.
    if (kind === 'masked') return text.length > 7 ? `${text.slice(0, 4)}${'•'.repeat(text.length - 7)}${text.slice(-3)}` : text
    // Stored option values such as `not_registered` read as plain words.
    return kind === 'label' || kind === 'tag' ? text.replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase()) : text
}

/** The location type options' own labels, so tags read "Peri-urban" rather than "Peri urban". */
const LOCATION_TYPE_LABELS: Record<string, string> = {
    urban: 'Urban',
    peri_urban: 'Peri-urban',
    rural: 'Rural',
    industrial: 'Industrial',
    home_based: 'Home-based',
}

const COLUMNS:{ key: 'main' | 'side', label: string }[] = [
    { key: 'main', label: 'The business' },
    { key: 'side', label: 'The people' },
]

type BusinessProfileSectionsProps = {
    form: FormInstance<ApplicantProfileFormValues>
    values: ApplicantProfileFormValues
    email: string
    requiredFields: FieldName[]
    editing: BusinessProfileSectionKey | null
    onEdit: (section: BusinessProfileSectionKey | null) => void
    onValuesChange: () => void
    /** Saves the whole profile; resolves true when it saved. */
    onSave: () => Promise<boolean>
    saving: boolean
}

export default function BusinessProfileSections({ form, values, email, requiredFields, editing, onEdit, onValuesChange, onSave, saving }: BusinessProfileSectionsProps) {
    const { t } = useLanguage()
    // What the section held when editing began, so Cancel can put it back.
    const [before, setBefore] = useState<ApplicantProfileFormValues>({})
    const hasDirectors = Boolean(values.directors?.length)

    const startEdit = (section: BusinessProfileSectionKey) => {
        setBefore(form.getFieldsValue(true))
        onEdit(section)
    }

    const cancel = () => {
        form.setFieldsValue(before)
        onValuesChange()
        onEdit(null)
    }

    const save = async () => {
        if (await onSave()) onEdit(null)
    }

    const saveDirectors = async (directors: BusinessDirector[]) => {
        const previous = form.getFieldsValue(true)
        form.setFieldsValue({ directors, ...(directors.length ? ownershipFromDirectors(directors) : {}) })
        onValuesChange()
        const saved = await onSave()
        if (!saved) {
            // Keep what is stored and what is shown the same when the save fails.
            form.setFieldsValue({ directors: previous.directors, youthOwnedPercent: previous.youthOwnedPercent, femaleOwnedPercent: previous.femaleOwnedPercent, blackOwnedPercent: previous.blackOwnedPercent })
            onValuesChange()
        }
        return saved
    }

    const sectionHead = (section: (typeof BUSINESS_PROFILE_SECTIONS)[number], action?: ReactNode) => (
        <header className="business-profile-section-head">
            <span className="business-profile-section-icon" aria-hidden="true">{section.icon}</span>
            <Text strong className="business-profile-section-title">{t(section.title)}</Text>
            {action}
        </header>
    )

    // Read view: filled fields and missing required ones; empty optional fields fold into one line.
    const readView = (section: (typeof BUSINESS_PROFILE_SECTIONS)[number]) => {
        const fields = section.fields.filter((field) => !(field.fromDirectors && hasDirectors))
        const shown = fields.filter((field) => field.kind !== 'tag' && (hasProfileValue(values[field.name]) || requiredFields.includes(field.name)))
        const tags = fields.filter((field) => field.kind === 'tag' && hasProfileValue(values[field.name]))
        const emptyOptional = fields.filter((field) => !hasProfileValue(values[field.name]) && !requiredFields.includes(field.name)).length

        return (
            <>
                {shown.length > 0 && (
                    <dl className="business-profile-values">
                        {shown.map((field) => {
                            const value = values[field.name]
                            const filled = hasProfileValue(value)
                            const joined = field.joinWith && hasProfileValue(values[field.joinWith]) ? ` · ${String(values[field.joinWith])}` : ''
                            return (
                                <div key={field.name} className={`business-profile-value${field.wide ? ' is-wide' : ''}${field.kind === 'paragraph' ? ' is-paragraph' : ''}${filled ? '' : ' is-missing'}`}>
                                    <dt>{t(field.label)}</dt>
                                    <dd>{filled ? `${formatValue(value, field.kind)}${joined}` : t('Not added')}</dd>
                                </div>
                            )
                        })}
                    </dl>
                )}
                {tags.length > 0 && (
                    <div className="business-profile-tags">
                        {tags.map((field) => (
                            <span key={field.name} className="business-profile-tag">
                                {field.name === 'hostCommunity'
                                    ? t('Host community: {name}', undefined, { name: String(values[field.name]) })
                                    : t(LOCATION_TYPE_LABELS[String(values[field.name])] || formatValue(values[field.name], field.kind))}
                            </span>
                        ))}
                    </div>
                )}
                {emptyOptional > 0 && !editing && (
                    <div className="business-profile-more">
                        <Text type="secondary">
                            {emptyOptional === 1 ? t('1 optional detail not added') : t('{count} optional details not added', undefined, { count: emptyOptional })}
                        </Text>
                        <Button type="link" size="small" onClick={() => startEdit(section.key)}>{t('Add')}</Button>
                    </div>
                )}
            </>
        )
    }

    return (
        <Form form={form} layout="vertical" requiredMark preserve onValuesChange={onValuesChange} className="business-profile-columns">
            {COLUMNS.map((column) => (
                <div key={column.key} className={`business-profile-column is-${column.key}`}>
                    <Text type="secondary" className="business-profile-column-label">{t(column.label)}</Text>

                    {BUSINESS_PROFILE_SECTIONS.filter((section) => section.column === column.key).map((section) => {
                        // Directors are edited one at a time in their own sheet and saved straight away.
                        if (section.key === 'directors') {
                            return (
                                <section key={section.key} id={`business-profile-${section.key}`} className="business-profile-section">
                                    {sectionHead(section)}
                                    <DirectorsEditor directors={values.directors || []} onChange={saveDirectors} self={selfAsDirector(values)} saving={saving} />
                                </section>
                            )
                        }

                        const isEditing = editing === section.key
                        return (
                            <section key={section.key} id={`business-profile-${section.key}`} className={`business-profile-section${isEditing ? ' is-editing' : ''}`}>
                                {sectionHead(section, isEditing
                                    ? <Text type="secondary" className="business-profile-section-state">{t('Editing')}</Text>
                                    : <Button size="small" icon={<EditOutlined />} disabled={Boolean(editing)} onClick={() => startEdit(section.key)}>{t('Edit')}</Button>)}

                                {isEditing ? (
                                    <>
                                        {section.steps.map((step) => <ApplicantProfileManualForm key={step} activeStep={step} email={email} showDirectors={false} />)}
                                        <div className="business-profile-section-actions">
                                            <Button onClick={cancel} disabled={saving}>{t('Cancel')}</Button>
                                            <Button type="primary" loading={saving} onClick={() => void save()}>{t('Save')}</Button>
                                        </div>
                                    </>
                                ) : readView(section)}
                            </section>
                        )
                    })}
                </div>
            ))}
        </Form>
    )
}
