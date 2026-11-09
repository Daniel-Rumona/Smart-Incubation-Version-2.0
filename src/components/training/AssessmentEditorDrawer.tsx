import { useEffect, useState } from 'react'
import { Alert, App, Button, Col, Drawer, Form, Grid, Input, InputNumber, Row, Segmented, Space, Typography, Upload } from 'antd'
import { DeleteOutlined, FileWordOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getTrainingAssessmentMemo, saveTrainingAssessment } from '@/services/trainingAssessmentService'
import { useLanguage } from '@/providers/LanguageProvider'
import { importAssessmentFromDocx } from '@/utils/trainingAssessmentImport'
import type { TrainingAssessment, TrainingAssessmentUse } from '@/types/training'

type QuestionRow = { id: string, text: string, marks: number, memo: string }
type CriterionRow = { id: string, label: string, maxMarks: number, guidance?: string }
type EditorValues = {
    title: string
    use: TrainingAssessmentUse
    instructions?: string
    durationMinutes?: number
    questions: QuestionRow[]
    caseBrief?: string
    rubric: CriterionRow[]
}

type Props = {
    open: boolean
    assessment?: TrainingAssessment
    /** Classes already using this assessment; their earlier attempts keep the questions they were written with. */
    usedByClasses: number
    onClose: () => void
    onSaved: () => void
}

const newId = () => crypto.randomUUID()

export const AssessmentEditorDrawer = ({ open, assessment, usedByClasses, onClose, onSaved }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const screens = Grid.useBreakpoint()
    const [form] = Form.useForm<EditorValues>()
    const [loadingMemo, setLoadingMemo] = useState(false)
    const [saving, setSaving] = useState(false)
    const [importing, setImporting] = useState(false)

    useEffect(() => {
        if (!open || !user) return
        let active = true
        const fill = (memo: Record<string, string>) => form.setFieldsValue({
            title: assessment?.title || '',
            use: assessment?.use || 'both',
            instructions: assessment?.instructions || '',
            durationMinutes: assessment?.durationMinutes,
            questions: (assessment?.questions || []).map((question) => ({ ...question, memo: memo[question.id] || '' })),
            caseBrief: assessment?.caseBrief || '',
            rubric: (assessment?.rubric || []).map((criterion) => ({ ...criterion })),
        })
        if (!assessment) {
            fill({})
            return
        }
        const timeout = window.setTimeout(() => {
            setLoadingMemo(true)
            void getTrainingAssessmentMemo(user, assessment.id)
                .then((memo) => { if (active) fill(memo) })
                .catch(() => {
                    if (!active) return
                    fill({})
                    message.error(t('The memo could not be loaded.'))
                })
                .finally(() => { if (active) setLoadingMemo(false) })
        }, 0)
        return () => {
            active = false
            window.clearTimeout(timeout)
        }
    }, [assessment, form, message, open, t, user])

    const importDocument = async (file: File) => {
        setImporting(true)
        try {
            const imported = await importAssessmentFromDocx(file)
            if (!imported.questions.length) {
                message.warning(t('No numbered questions were found in that document.'))
                return
            }
            const current = form.getFieldsValue()
            form.setFieldsValue({
                title: current.title?.trim() ? current.title : imported.title || '',
                durationMinutes: current.durationMinutes || imported.durationMinutes,
                questions: imported.questions.map((question) => ({ id: newId(), ...question })),
                caseBrief: imported.caseBrief || current.caseBrief || '',
                rubric: imported.rubric.length ? imported.rubric.map((criterion) => ({ id: newId(), ...criterion })) : current.rubric || [],
            })
            const memoCount = imported.questions.filter((question) => question.memo).length
            message.success(t('Imported {questions} questions, {memo} memo answers and {rubric} rubric criteria. Check them before saving.', undefined, {
                questions: imported.questions.length,
                memo: memoCount,
                rubric: imported.rubric.length,
            }))
        } catch {
            message.error(t('That document could not be read. Use a Word (.docx) file.'))
        } finally {
            setImporting(false)
        }
    }

    const save = async () => {
        if (!user) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            await saveTrainingAssessment(user, {
                title: values.title,
                use: values.use,
                instructions: values.instructions,
                durationMinutes: values.durationMinutes,
                questions: values.questions.map(({ id, text, marks }) => ({ id, text, marks })),
                caseBrief: values.caseBrief,
                rubric: values.rubric,
                memo: Object.fromEntries(values.questions.map((question) => [question.id, question.memo || ''])),
            }, assessment?.id)
            message.success(t('Assessment saved.'))
            onSaved()
        } catch {
            message.error(t('The assessment could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const questionCount = Form.useWatch('questions', form)?.length ?? 0
    const totalMarks = (Form.useWatch('questions', form) || []).reduce((sum: number, question?: QuestionRow) => sum + (Number(question?.marks) || 0), 0)
    const rubricTotal = (Form.useWatch('rubric', form) || []).reduce((sum: number, criterion?: CriterionRow) => sum + (Number(criterion?.maxMarks) || 0), 0)

    return (
        <Drawer
            open={open}
            title={assessment ? t('Edit assessment') : t('New assessment')}
            width={screens.lg ? 860 : '100%'}
            onClose={onClose}
            destroyOnHidden
            extra={(
                <Upload accept=".docx" showUploadList={false} beforeUpload={(file) => { void importDocument(file); return false }}>
                    <Button icon={<FileWordOutlined />} loading={importing}>{t('Import from Word')}</Button>
                </Upload>
            )}
            footer={(
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                    <Typography.Text type="secondary">
                        {t('{count} questions · {marks} marks · group rubric out of {rubric}', undefined, { count: questionCount, marks: totalMarks, rubric: rubricTotal })}
                    </Typography.Text>
                    <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={loadingMemo} onClick={() => void save()}>{t('Save assessment')}</Button>
                </Space>
            )}
        >
            {usedByClasses > 0 && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={t('Used by {count} class(es). Changes apply to assessments started after saving; assessments already written keep their questions.', undefined, { count: usedByClasses })}
                />
            )}
            <Form form={form} layout="vertical" requiredMark={false} disabled={loadingMemo}>
                <Row gutter={12}>
                    <Col xs={24} md={16}>
                        <Form.Item name="title" label={t('Title')} rules={[{ required: true, whitespace: true, message: t('Enter a title.') }]}>
                            <Input maxLength={140} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                        <Form.Item name="durationMinutes" label={t('Time allowed (minutes)')}>
                            <InputNumber min={1} max={300} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item
                    name="use"
                    label={t('Used as')}
                    extra={t('A class chooses its pre-assessment and post-assessment from these. "Both" writes the same questions before and after the class.')}
                >
                    <Segmented
                        block
                        options={[
                            { value: 'pre', label: t('Pre-assessment') },
                            { value: 'post', label: t('Post-assessment') },
                            { value: 'both', label: t('Both') },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="instructions" label={t('Instructions for learners')}>
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} />
                </Form.Item>

                <Typography.Title level={5}>{t('Knowledge questions')}</Typography.Title>
                <Typography.Paragraph type="secondary">{t('Learners see the questions. The memo answers are for marking and are never shown to learners.')}</Typography.Paragraph>
                <Form.List name="questions" rules={[{ validator: async (_, rows?: QuestionRow[]) => { if (!rows?.length) throw new Error(t('Add at least one question.')) } }]}>
                    {(fields, { add, remove }, { errors }) => (
                        <Space orientation="vertical" style={{ width: '100%' }} size={10}>
                            {fields.map((field, index) => (
                                <MotionCard key={field.key} size="small">
                                    <Row gutter={12} align="top">
                                        <Col flex="none"><Typography.Text strong>{index + 1}.</Typography.Text></Col>
                                        <Col flex="auto">
                                            <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                                            <Form.Item name={[field.name, 'text']} rules={[{ required: true, whitespace: true, message: t('Enter the question.') }]} style={{ marginBottom: 8 }}>
                                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder={t('Question')} maxLength={600} />
                                            </Form.Item>
                                            <Form.Item name={[field.name, 'memo']} style={{ marginBottom: 0 }}>
                                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder={t('Memo answer')} maxLength={1000} />
                                            </Form.Item>
                                        </Col>
                                        <Col flex="none">
                                            <Space orientation="vertical" align="end">
                                                <Form.Item name={[field.name, 'marks']} rules={[{ required: true }]} style={{ marginBottom: 8 }}>
                                                    <InputNumber min={1} max={50} style={{ width: 88 }} addonAfter={t('marks')} />
                                                </Form.Item>
                                                <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label={t('Remove question')} />
                                            </Space>
                                        </Col>
                                    </Row>
                                </MotionCard>
                            ))}
                            <Form.ErrorList errors={errors} />
                            <Button icon={<PlusOutlined />} onClick={() => add({ id: newId(), text: '', marks: 1, memo: '' })} block>{t('Add question')}</Button>
                        </Space>
                    )}
                </Form.List>

                <Typography.Title level={5} style={{ marginTop: 24 }}>{t('Group case assignment (optional)')}</Typography.Title>
                <Typography.Paragraph type="secondary">
                    {t('Leave this empty for a course without group work: its classes then pass on the post-assessment alone and have no Group assignment tab.')}
                </Typography.Paragraph>
                <Form.Item name="caseBrief" label={t('Case brief')}>
                    <Input.TextArea autoSize={{ minRows: 3, maxRows: 8 }} maxLength={3000} />
                </Form.Item>
                <Form.List name="rubric">
                    {(fields, { add, remove }) => (
                        <Space orientation="vertical" style={{ width: '100%' }} size={10}>
                            {fields.map((field) => (
                                <MotionCard key={field.key} size="small">
                                    <Row gutter={12} align="top">
                                        <Col flex="auto">
                                            <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                                            <Form.Item name={[field.name, 'label']} rules={[{ required: true, whitespace: true, message: t('Enter the criterion.') }]} style={{ marginBottom: 8 }}>
                                                <Input placeholder={t('Criterion, e.g. Risk ranking')} maxLength={120} />
                                            </Form.Item>
                                            <Form.Item name={[field.name, 'guidance']} style={{ marginBottom: 0 }}>
                                                <Input placeholder={t('Expected evidence')} maxLength={300} />
                                            </Form.Item>
                                        </Col>
                                        <Col flex="none">
                                            <Space orientation="vertical" align="end">
                                                <Form.Item name={[field.name, 'maxMarks']} rules={[{ required: true }]} style={{ marginBottom: 8 }}>
                                                    <InputNumber min={1} max={100} style={{ width: 88 }} addonAfter={t('marks')} />
                                                </Form.Item>
                                                <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label={t('Remove criterion')} />
                                            </Space>
                                        </Col>
                                    </Row>
                                </MotionCard>
                            ))}
                            <Button icon={<PlusOutlined />} onClick={() => add({ id: newId(), label: '', maxMarks: 1, guidance: '' })} block>{t('Add rubric criterion')}</Button>
                        </Space>
                    )}
                </Form.List>
            </Form>
        </Drawer>
    )
}
