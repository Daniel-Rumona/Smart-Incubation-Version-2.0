import { useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Form, Grid, Input, Modal, Select, Skeleton, Space, Switch, Tag, Tooltip, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    CopyOutlined,
    DeleteOutlined,
    EyeOutlined,
    FileSearchOutlined,
    LockOutlined,
    PlusOutlined,
    SaveOutlined,
    SendOutlined,
    UnorderedListOutlined,
} from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { ALL_PROGRAMS, useActiveProgramId } from '@/hooks/useActiveProgramId'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import {
    SURVEY_CATEGORIES,
    SURVEY_FIELD_TYPES,
    assignSurveyToProgramme,
    generateFieldId,
    loadSurveyTemplate,
    saveSurveyTemplate,
    type SurveyField,
    type SurveyFieldType,
    type SurveyTemplate,
} from '@/services/surveyTemplatesService'
import { PREFILL_LABELS, type PrefillSection } from '@/lib/surveyPrefill'
import type { ExtractedSurveyMeta } from '@/services/surveyQuestionExtractionService'
import AddFieldModal from './AddFieldModal'
import ImportQuestionsModal, { type ImportOptions } from './ImportQuestionsModal'
import PreviewSurveyModal from './PreviewSurveyModal'
import SurveyFieldPreview from './SurveyFieldPreview'
import SurveyOutline from './SurveyOutline'
import '@/styles/survey-builder.css'
import { useLanguage } from '@/providers/LanguageProvider'

const SURVEYS_PATH = '/operations/surveys'

const OPTION_TYPES: SurveyFieldType[] = ['select', 'checkbox', 'radio']
const PLACEHOLDER_TYPES: SurveyFieldType[] = ['text', 'textarea', 'number', 'email', 'select']

const emptyTemplate = (): SurveyTemplate => ({
    title: '',
    description: '',
    fields: [],
    status: 'draft',
    category: 'Evaluation Form',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
})

/** Compared against the saved copy to know whether leaving would lose work. */
const fingerprint = (template: SurveyTemplate | null) => template
    ? JSON.stringify({
        title: template.title.trim(),
        description: template.description.trim(),
        status: template.status,
        category: template.category,
        programId: template.programId,
        fields: template.fields,
    })
    : null

export default function SurveyBuilderPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const params = useParams<{ id?: string }>()
    const { activeProgramId } = useActiveProgramId()
    const screens = Grid.useBreakpoint()
    const isCompact = !screens.xl

    // Seeded once: a new survey starts scoped to whatever programme the workspace is filtered to.
    const [survey, setSurvey] = useState<SurveyTemplate>(() => ({
        ...emptyTemplate(),
        programId: activeProgramId && activeProgramId !== ALL_PROGRAMS ? activeProgramId : undefined,
    }))
    const [baseline, setBaseline] = useState<string | null>(() => (params.id ? null : fingerprint(emptyTemplate())))
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [loading, setLoading] = useState(Boolean(params.id))
    const [saving, setSaving] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [addOpen, setAddOpen] = useState(false)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [importOpen, setImportOpen] = useState(false)
    const [outlineOpen, setOutlineOpen] = useState(false)

    useEffect(() => {
        if (!user) return
        void listWorkspacePrograms(user).then(setPrograms).catch(() => setPrograms([]))
    }, [user])

    useEffect(() => {
        if (!params.id) return
        void loadSurveyTemplate(params.id)
            .then((template) => {
                if (!template) {
                    message.error(t('That survey template could not be found.'))
                    navigate(SURVEYS_PATH)
                    return
                }
                setSurvey(template)
                setBaseline(fingerprint(template))
                setSelectedId(template.fields[0]?.id ?? null)
            })
            .catch(() => message.error(t('The survey template could not be loaded.')))
            .finally(() => setLoading(false))
    }, [params.id]) // eslint-disable-line react-hooks/exhaustive-deps

    const isDirty = baseline !== null && fingerprint(survey) !== baseline
    const selectedField = survey.fields.find((field) => field.id === selectedId)
    const selectedIndex = survey.fields.findIndex((field) => field.id === selectedId)
    const requiredCount = useMemo(() => survey.fields.filter((field) => field.required).length, [survey.fields])

    const patchSurvey = (updates: Partial<SurveyTemplate>) => setSurvey((current) => ({ ...current, ...updates, updatedAt: new Date().toISOString() }))

    const patchField = (id: string, updates: Partial<SurveyField>) => setSurvey((current) => ({
        ...current,
        fields: current.fields.map((field) => (field.id === id ? { ...field, ...updates } : field)),
    }))

    const addField = (type: SurveyFieldType) => {
        const field: SurveyField = {
            id: generateFieldId(),
            type,
            label: type === 'heading' ? 'Section' : 'New question',
            required: false,
            placeholder: PLACEHOLDER_TYPES.includes(type) ? 'Enter value…' : undefined,
            options: OPTION_TYPES.includes(type) ? ['Option 1', 'Option 2'] : undefined,
        }
        setSurvey((current) => ({ ...current, fields: [...current.fields, field] }))
        setSelectedId(field.id)
        setAddOpen(false)
    }

    /** A heading plus its prefilled questions. The field list stays flat: a heading is what marks a section. */
    const addPrefillSection = (section: PrefillSection) => {
        const alreadyAdded = survey.fields.some((field) => section.fields.some((entry) => entry.prefill === field.prefill))
        if (alreadyAdded) {
            message.warning(`${section.title} is already on this survey.`)
            return
        }

        const heading: SurveyField = { id: generateFieldId(), type: 'heading', label: section.title, required: false }
        const fields: SurveyField[] = section.fields.map((entry) => ({
            id: generateFieldId(),
            type: entry.type,
            label: entry.label,
            required: false,
            prefill: entry.prefill,
        }))

        setSurvey((current) => ({ ...current, fields: [...current.fields, heading, ...fields] }))
        setSelectedId(heading.id)
        setAddOpen(false)
        message.success(`${section.title} added — answers come from the SME's record.`)
    }

    const applyImport = (imported: SurveyField[], meta: ExtractedSurveyMeta, options: ImportOptions) => {
        if (!imported.length) return

        setSurvey((current) => {
            const next: SurveyTemplate = {
                ...current,
                fields: options.replace ? imported : [...current.fields, ...imported],
                updatedAt: new Date().toISOString(),
            }

            // Never overwrite something already typed unless the whole form is being replaced.
            if (options.applyMeta) {
                if (meta.title && (options.replace || !current.title.trim())) next.title = meta.title
                if (meta.description && (options.replace || !current.description.trim())) next.description = meta.description
                if (meta.category && SURVEY_CATEGORIES.includes(meta.category as (typeof SURVEY_CATEGORIES)[number])) next.category = meta.category
            }

            return next
        })

        setSelectedId(imported[0].id)
    }

    const changeFieldType = (id: string, type: SurveyFieldType) => setSurvey((current) => ({
        ...current,
        fields: current.fields.map((field) => {
            if (field.id !== id) return field
            return {
                ...field,
                type,
                options: OPTION_TYPES.includes(type) ? (field.options?.length ? field.options : ['Option 1', 'Option 2']) : undefined,
                placeholder: PLACEHOLDER_TYPES.includes(type) ? field.placeholder : undefined,
            }
        }),
    }))

    const duplicateField = (id: string) => {
        const source = survey.fields.find((field) => field.id === id)
        if (!source) return
        const copy: SurveyField = { ...source, id: generateFieldId(), name: undefined, label: `${source.label} (copy)` }
        const index = survey.fields.findIndex((field) => field.id === id)
        const fields = [...survey.fields]
        fields.splice(index + 1, 0, copy)
        setSurvey((current) => ({ ...current, fields }))
        setSelectedId(copy.id)
    }

    const removeField = (id: string) => setSurvey((current) => {
        const fields = current.fields.filter((field) => field.id !== id)
        setSelectedId(fields[0]?.id ?? null)
        return { ...current, fields }
    })

    const reorderFields = (from: number, to: number) => setSurvey((current) => {
        const fields = [...current.fields]
        const [moved] = fields.splice(from, 1)
        fields.splice(to, 0, moved)
        return { ...current, fields }
    })

    const save = async (status: 'draft' | 'published') => {
        if (!survey.title.trim()) {
            setSettingsOpen(true)
            message.error(t('Give the survey a title first.'))
            return
        }
        if (!survey.fields.length) {
            message.error(t('Add at least one question.'))
            return
        }
        if (!survey.programId) {
            setSettingsOpen(true)
            message.error(t('Choose the programme this survey belongs to.'))
            return
        }

        setSaving(true)
        try {
            const next = { ...survey, status }
            const id = await saveSurveyTemplate(next, user)
            const saved = { ...next, id }
            setSurvey(saved)
            setBaseline(fingerprint(saved))

            if (status !== 'published') {
                message.success(t('Draft saved.'))
                return
            }

            // Publishing is what puts the survey in front of the programme's SMEs.
            const assigned = await assignSurveyToProgramme(saved)
            message.success(assigned
                ? `Survey published and sent to ${assigned} SME${assigned === 1 ? '' : 's'}.`
                : t('Survey published. Everyone on this programme already has it.'))
        } catch {
            message.error(t('The survey could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const goBack = () => {
        if (!isDirty || !survey.fields.length) {
            navigate(SURVEYS_PATH)
            return
        }
        Modal.confirm({
            title: t('Save as draft before leaving?'),
            content: t('This survey has unsaved changes.'),
            okText: t('Save draft'),
            cancelText: t('Discard'),
            onOk: async () => { await save('draft'); navigate(SURVEYS_PATH) },
            onCancel: () => navigate(SURVEYS_PATH),
        })
    }

    const outlinePanel = (
        <SurveyOutline
            fields={survey.fields}
            selectedId={selectedId}
            onSelect={(id) => { setSelectedId(id); setOutlineOpen(false) }}
            onReorder={reorderFields}
        />
    )

    const settingsForm = (
        <Form layout="vertical">
            <Form.Item label={t('Programme')} required tooltip={t('Only this programme\'s participants receive the survey.')}>
                <Select
                    value={survey.programId}
                    onChange={(value) => patchSurvey({ programId: value })}
                    placeholder={t('Select a programme')}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    options={programs.map((program) => ({ value: program.id, label: program.name }))}
                />
            </Form.Item>

            <Form.Item label={t('Title')} required>
                <Input value={survey.title} onChange={(event) => patchSurvey({ title: event.target.value })} placeholder={t('Survey title')} />
            </Form.Item>

            <Form.Item label={t('Description')}>
                <Input.TextArea rows={3} value={survey.description} onChange={(event) => patchSurvey({ description: event.target.value })} placeholder={t('What is this survey for?')} />
            </Form.Item>

            <Form.Item label={t('Category')}>
                <Select
                    value={survey.category}
                    onChange={(value) => patchSurvey({ category: value })}
                    options={SURVEY_CATEGORIES.map((category) => ({ value: category, label: category }))}
                />
            </Form.Item>

            <Form.Item label={t('Department')} tooltip={t('Taken from your own workspace scope.')}>
                <Tag color="purple">{survey.department || user?.departmentId || t('Not set')}</Tag>
            </Form.Item>
        </Form>
    )

    return (
        <DashboardPage className="survey-builder-page">
            <MotionCard className="survey-builder-bar">
                <div className="survey-builder-bar-inner">
                    <Space size={8} className="survey-builder-bar-side">
                        <Button icon={<ArrowLeftOutlined />} onClick={goBack}>{t('Back')}</Button>
                        {isCompact && <Button icon={<UnorderedListOutlined />} onClick={() => setOutlineOpen(true)}>{t('Outline')}</Button>}
                        <Button icon={<FileSearchOutlined />} onClick={() => setImportOpen(true)}>{t('Import')}</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>{t('Add question')}</Button>
                    </Space>

                    <button type="button" className="survey-builder-identity" onClick={() => setSettingsOpen(true)}>
                        <strong>{survey.title.trim() || t('Untitled survey')}</strong>
                        <span>{survey.description.trim() || t('Add a description')}</span>
                    </button>

                    <Space size={8} className="survey-builder-bar-side is-end">
                        <Button icon={<EyeOutlined />} disabled={!survey.fields.length} onClick={() => setPreviewOpen(true)}>{t('Preview')}</Button>
                        <Button icon={<SaveOutlined />} loading={saving} onClick={() => void save('draft')}>{t('Save draft')}</Button>
                        <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={() => void save('published')}>{t('Publish')}</Button>
                    </Space>
                </div>
            </MotionCard>

            <div className={`survey-builder-grid${isCompact ? ' is-compact' : ''}`}>
                {!isCompact && (
                    <MotionCard
                        loading={loading}
                        className="survey-builder-panel survey-builder-outline"
                        title={t('Outline')}
                        extra={<Button type="text" size="small" icon={<PlusOutlined />} onClick={() => setAddOpen(true)} />}
                    >
                        {outlinePanel}
                    </MotionCard>
                )}

                <div className="survey-builder-canvas">
                    {loading ? <MotionCard loading className="survey-builder-panel" /> : selectedField ? (
                        <MotionCard className="survey-builder-panel survey-builder-question">
                            <div className="survey-question-head">
                                <span className="survey-question-number">{String(selectedIndex + 1).padStart(2, '0')}</span>

                                <Space size={8}>
                                    <Tooltip title={t('Duplicate question')}>
                                        <Button shape="circle" icon={<CopyOutlined />} onClick={() => duplicateField(selectedField.id)} />
                                    </Tooltip>
                                    <Tooltip title={t('Delete question')}>
                                        <Button shape="circle" danger icon={<DeleteOutlined />} onClick={() => removeField(selectedField.id)} />
                                    </Tooltip>
                                </Space>
                            </div>

                            <div className="survey-question-label">
                                <Input.TextArea
                                    variant="borderless"
                                    autoSize={{ minRows: 1, maxRows: 3 }}
                                    value={selectedField.label}
                                    // The label is what pairs a prefilled question with the stored value.
                                    readOnly={Boolean(selectedField.prefill)}
                                    onChange={(event) => patchField(selectedField.id, { label: event.target.value })}
                                    placeholder={selectedField.type === 'heading' ? t('Section title') : t('Ask a question')}
                                />
                                {selectedField.type !== 'heading' && selectedField.required && <span className="survey-question-required">*</span>}
                            </div>

                            {selectedField.description && <p className="survey-question-help">{selectedField.description}</p>}

                            {selectedField.prefill ? (
                                <>
                                    <Input disabled placeholder={`${PREFILL_LABELS[selectedField.prefill]} from the SME's record`} />
                                    <p className="survey-question-prefill">
                                        <Tag icon={<LockOutlined />} color="blue">{t('Prefilled ·')} {PREFILL_LABELS[selectedField.prefill]}</Tag>
                                        {t('Filled in when the SME opens the survey. They can correct it for this response; their record is unchanged.')}
                                    </p>
                                </>
                            ) : selectedField.type !== 'heading' ? <SurveyFieldPreview field={selectedField} /> : null}
                        </MotionCard>
                    ) : (
                        <MotionCard className="survey-builder-panel survey-builder-empty">
                            {survey.fields.length ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Select a question from the outline')} />
                            ) : (
                                <>
                                    <Typography.Title level={4}>{t('Start building your survey')}</Typography.Title>
                                    <Typography.Paragraph type="secondary">{t('Add your first question, then arrange them in the outline.')}</Typography.Paragraph>
                                    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>{t('Add question')}</Button>
                                </>
                            )}
                        </MotionCard>
                    )}
                </div>

                {!isCompact && (
                    <div className="survey-builder-side">
                        <MotionCard loading={loading} className="survey-builder-panel" title={t('Question settings')}>
                            {selectedField?.prefill ? (
                                <Space direction="vertical" size={10} className="survey-settings-stack">
                                    <Tag icon={<LockOutlined />} color="blue">{t('Prefilled question')}</Tag>
                                    <div className="survey-setting">
                                        <span>{t('Answer comes from')}</span>
                                        <Typography.Text>{PREFILL_LABELS[selectedField.prefill]}</Typography.Text>
                                    </div>
                                    <Typography.Text type="secondary" className="survey-setting-note">
                                        {t('There is nothing to configure here. Delete the question to remove it from the survey.')}
                                    </Typography.Text>
                                </Space>
                            ) : selectedField ? (
                                <Space direction="vertical" size={10} className="survey-settings-stack">
                                    <label className="survey-setting">
                                        <span>{t('Question type')}</span>
                                        <Select
                                            value={selectedField.type}
                                            onChange={(type) => changeFieldType(selectedField.id, type)}
                                            options={SURVEY_FIELD_TYPES}
                                        />
                                    </label>

                                    {selectedField.type !== 'heading' && (
                                        <div className="survey-setting is-row">
                                            <span>{t('Required')}</span>
                                            <Switch size="small" checked={selectedField.required} onChange={(required) => patchField(selectedField.id, { required })} />
                                        </div>
                                    )}

                                    {PLACEHOLDER_TYPES.includes(selectedField.type) && (
                                        <label className="survey-setting">
                                            <span>{t('Placeholder')}</span>
                                            <Input size="small" value={selectedField.placeholder} onChange={(event) => patchField(selectedField.id, { placeholder: event.target.value })} placeholder={t('Hint inside the empty box')} />
                                        </label>
                                    )}

                                    <label className="survey-setting">
                                        <span>{t('Helper text')}</span>
                                        <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 3 }} value={selectedField.description} onChange={(event) => patchField(selectedField.id, { description: event.target.value })} placeholder={t('Guidance shown under the question')} />
                                    </label>

                                    {OPTION_TYPES.includes(selectedField.type) && (
                                        <div className="survey-setting">
                                            <span>{t('Options')}</span>
                                            <Space direction="vertical" size={6} className="survey-options">
                                                {(selectedField.options || []).map((option, index) => (
                                                    <Space.Compact key={index} block>
                                                        <Input
                                                            size="small"
                                                            value={option}
                                                            onChange={(event) => {
                                                                const options = [...(selectedField.options || [])]
                                                                options[index] = event.target.value
                                                                patchField(selectedField.id, { options })
                                                            }}
                                                        />
                                                        <Button
                                                            size="small"
                                                            danger
                                                            icon={<DeleteOutlined />}
                                                            onClick={() => {
                                                                const options = [...(selectedField.options || [])]
                                                                options.splice(index, 1)
                                                                patchField(selectedField.id, { options })
                                                            }}
                                                        />
                                                    </Space.Compact>
                                                ))}

                                                <Button
                                                    block
                                                    size="small"
                                                    type="dashed"
                                                    icon={<PlusOutlined />}
                                                    onClick={() => patchField(selectedField.id, { options: [...(selectedField.options || []), `Option ${(selectedField.options?.length || 0) + 1}`] })}
                                                >
                                                    {t('Add option')}
                                                </Button>
                                            </Space>
                                        </div>
                                    )}
                                </Space>
                            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No question selected')} />}
                        </MotionCard>

                        <MotionCard loading={loading} className="survey-builder-panel" title={t('Survey at a glance')}>
                            <div className="survey-snapshot-row"><span>{t('Questions')}</span><strong>{survey.fields.length}</strong></div>
                            <div className="survey-snapshot-row"><span>{t('Required')}</span><strong>{requiredCount}</strong></div>
                            <div className="survey-snapshot-row"><span>{t('Status')}</span><Tag color={survey.status === 'published' ? 'green' : 'default'}>{survey.status === 'published' ? t('Published') : t('Draft')}</Tag></div>
                            <div className="survey-snapshot-row"><span>{t('Changes')}</span><Tag color={isDirty ? 'orange' : 'green'}>{isDirty ? t('Unsaved') : t('Saved')}</Tag></div>
                        </MotionCard>
                    </div>
                )}
            </div>

            <AddFieldModal
                open={addOpen}
                onClose={() => setAddOpen(false)}
                onAdd={addField}
                onAddSection={addPrefillSection}
            />

            <ImportQuestionsModal
                open={importOpen}
                category={survey.category}
                hasExistingFields={survey.fields.length > 0}
                onClose={() => setImportOpen(false)}
                onImport={applyImport}
            />

            <Modal
                open={settingsOpen}
                title={t('Survey settings')}
                width={520}
                onCancel={() => setSettingsOpen(false)}
                footer={<Button type="primary" onClick={() => setSettingsOpen(false)}>{t('Done')}</Button>}
            >
                {settingsForm}
            </Modal>

            <PreviewSurveyModal
                open={previewOpen}
                title={survey.title}
                description={survey.description}
                fields={survey.fields}
                onClose={() => setPreviewOpen(false)}
            />

            <Modal
                open={outlineOpen}
                title={t('Outline')}
                footer={null}
                onCancel={() => setOutlineOpen(false)}
                className="survey-outline-modal"
            >
                {loading ? <Skeleton active /> : outlinePanel}
            </Modal>
        </DashboardPage>
    )
}
