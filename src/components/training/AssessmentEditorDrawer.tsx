import { useEffect, useState } from 'react'
import { Alert, App, Button, Col, Drawer, Form, Grid, Input, InputNumber, Radio, Row, Segmented, Space, Tooltip, Typography, Upload } from 'antd'
import { CloseOutlined, DeleteOutlined, FileWordOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getTrainingAssessmentMemo, saveTrainingAssessment } from '@/services/trainingAssessmentService'
import { useLanguage } from '@/providers/LanguageProvider'
import { importAssessmentFromDocx } from '@/utils/trainingAssessmentImport'
import type { TrainingAssessment, TrainingAssessmentUse, TrainingQuestionType } from '@/types/training'

/**
 * One question in the editor. A written question has a memo answer; a multiple-choice question has options and the
 * index of the correct one (saved as that option's text in the memo, so learners never receive it).
 */
type QuestionRow = { id: string, type: TrainingQuestionType, text: string, marks: number, memo: string, options: string[], correct?: number }
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
const LETTERS = 'abcdefghij'
/** A new multiple-choice question starts with four empty options (a to d); empty ones are dropped on saving. */
const EMPTY_OPTIONS = ['', '', '', '']
const sameText = (left?: string, right?: string) => (left || '').trim().toLowerCase() === (right || '').trim().toLowerCase()

/** The editor row for a saved or imported question, with the correct option found from the memo. */
const toRow = (question: { id: string, text: string, marks: number, type?: TrainingQuestionType, options?: string[] }, memo: string): QuestionRow => {
    if (question.type !== 'choice') return { id: question.id, type: 'written', text: question.text, marks: question.marks, memo, options: [] }
    const options = question.options || []
    const correct = options.findIndex((option) => memo.trim() && sameText(option, memo))
    return { id: question.id, type: 'choice', text: question.text, marks: question.marks, memo: '', options, correct: correct >= 0 ? correct : undefined }
}

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
            questions: (assessment?.questions || []).map((question) => toRow(question, memo[question.id] || '')),
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
                questions: imported.questions.map((question) => toRow({ id: newId(), ...question }, question.memo)),
                caseBrief: imported.caseBrief || current.caseBrief || '',
                rubric: imported.rubric.length ? imported.rubric.map((criterion) => ({ id: newId(), ...criterion })) : current.rubric || [],
            })
            const memoCount = imported.questions.filter((question) => question.memo).length
            const choiceCount = imported.questions.filter((question) => question.type === 'choice').length
            message.success(t('Imported {questions} questions ({choice} multiple choice), {memo} memo answers and {rubric} rubric criteria. Check them before saving.', undefined, {
                questions: imported.questions.length,
                choice: choiceCount,
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
        // The form shows what is missing (e.g. no option ticked as correct); nothing more to do until it is fixed.
        const values = await form.validateFields().catch(() => null)
        if (!values) return
        setSaving(true)
        try {
            await saveTrainingAssessment(user, {
                title: values.title,
                use: values.use,
                instructions: values.instructions,
                durationMinutes: values.durationMinutes,
                questions: values.questions.map(({ id, type, text, marks, options }) => (type === 'choice' ? { id, type, text, marks, options } : { id, text, marks })),
                caseBrief: values.caseBrief,
                rubric: values.rubric,
                // A multiple-choice question's memo is its correct option's text.
                memo: Object.fromEntries(values.questions.map((question) => [
                    question.id,
                    question.type === 'choice' ? (question.options[question.correct ?? -1] || '').trim() : question.memo || '',
                ])),
            }, assessment?.id)
            message.success(t('Assessment saved.'))
            onSaved()
        } catch {
            message.error(t('The assessment could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const watchedQuestions: Array<QuestionRow | undefined> = Form.useWatch('questions', form) || []
    const questionCount = watchedQuestions.length
    const choiceCount = watchedQuestions.filter((question) => question?.type === 'choice').length
    const totalMarks = watchedQuestions.reduce((sum: number, question?: QuestionRow) => sum + (Number(question?.marks) || 0), 0)

    /** Switching a question to multiple choice gives it empty options; switching back keeps them in case of a mistake. */
    const changeType = (index: number, type: TrainingQuestionType) => {
        const row = form.getFieldValue(['questions', index]) as QuestionRow
        form.setFieldValue(['questions', index], { ...row, type, options: type === 'choice' && !row.options?.filter((option) => option.trim()).length ? [...EMPTY_OPTIONS] : row.options || [] })
    }
    const setCorrect = (index: number, option: number) => form.setFieldValue(['questions', index, 'correct'], option)
    const removeOption = (index: number, option: number) => {
        const row = form.getFieldValue(['questions', index]) as QuestionRow
        const correct = row.correct === option ? undefined : row.correct !== undefined && row.correct > option ? row.correct - 1 : row.correct
        form.setFieldValue(['questions', index], { ...row, options: row.options.filter((_, position) => position !== option), correct })
    }
    const addOption = (index: number) => {
        const row = form.getFieldValue(['questions', index]) as QuestionRow
        form.setFieldValue(['questions', index, 'options'], [...(row.options || []), ''])
    }
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
                        {choiceCount
                            ? t('{count} questions ({choice} multiple choice) · {marks} marks · group rubric out of {rubric}', undefined, { count: questionCount, choice: choiceCount, marks: totalMarks, rubric: rubricTotal })
                            : t('{count} questions · {marks} marks · group rubric out of {rubric}', undefined, { count: questionCount, marks: totalMarks, rubric: rubricTotal })}
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
                <Typography.Paragraph type="secondary">
                    {t('Each question is written (marked by you against the memo) or multiple choice (learners pick one option and it is marked automatically). Learners never see the memo or which option is correct. Type the questions here or import a Word document: options written a), b), c) under a question make it multiple choice.')}
                </Typography.Paragraph>
                <Form.List name="questions" rules={[{ validator: async (_, rows?: QuestionRow[]) => { if (!rows?.length) throw new Error(t('Add at least one question.')) } }]}>
                    {(fields, { add, remove }, { errors }) => (
                        <Space orientation="vertical" style={{ width: '100%' }} size={10}>
                            {fields.map((field, index) => {
                                const row = watchedQuestions[field.name]
                                const isChoice = row?.type === 'choice'
                                return (
                                <MotionCard key={field.key} size="small">
                                    <Row gutter={12} align="top">
                                        <Col flex="none"><Typography.Text strong>{index + 1}.</Typography.Text></Col>
                                        <Col flex="auto">
                                            <Form.Item name={[field.name, 'id']} hidden><Input /></Form.Item>
                                            <Form.Item name={[field.name, 'type']} hidden><Input /></Form.Item>
                                            <Form.Item name={[field.name, 'correct']} hidden><InputNumber /></Form.Item>
                                            <Segmented
                                                size="small"
                                                style={{ marginBottom: 8 }}
                                                value={isChoice ? 'choice' : 'written'}
                                                onChange={(value) => changeType(field.name, value as TrainingQuestionType)}
                                                options={[{ value: 'written', label: t('Written') }, { value: 'choice', label: t('Multiple choice') }]}
                                                aria-label={t('Question type')}
                                            />
                                            <Form.Item name={[field.name, 'text']} rules={[{ required: true, whitespace: true, message: t('Enter the question.') }]} style={{ marginBottom: 8 }}>
                                                <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder={t('Question')} maxLength={600} />
                                            </Form.Item>
                                            {isChoice ? (
                                                <Form.Item
                                                    name={[field.name, 'options']}
                                                    style={{ marginBottom: 0 }}
                                                    rules={[{
                                                        validator: async (_, options?: string[]) => {
                                                            const filled = (options || []).filter((option) => option?.trim())
                                                            if (filled.length < 2) throw new Error(t('Give at least two options.'))
                                                            const correct = form.getFieldValue(['questions', field.name, 'correct'])
                                                            if (correct === undefined || correct === null || !(options || [])[correct]?.trim()) throw new Error(t('Tick the correct option.'))
                                                        },
                                                    }]}
                                                >
                                                    <ChoiceOptions
                                                        correct={row?.correct}
                                                        onCorrect={(option) => setCorrect(field.name, option)}
                                                        onRemove={(option) => removeOption(field.name, option)}
                                                        onAdd={() => addOption(field.name)}
                                                    />
                                                </Form.Item>
                                            ) : (
                                                <Form.Item name={[field.name, 'memo']} style={{ marginBottom: 0 }}>
                                                    <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} placeholder={t('Memo answer')} maxLength={1000} />
                                                </Form.Item>
                                            )}
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
                                )
                            })}
                            <Form.ErrorList errors={errors} />
                            <Space.Compact block>
                                <Button icon={<PlusOutlined />} onClick={() => add({ id: newId(), type: 'written', text: '', marks: 1, memo: '', options: [] })} block>{t('Add written question')}</Button>
                                <Button icon={<PlusOutlined />} onClick={() => add({ id: newId(), type: 'choice', text: '', marks: 1, memo: '', options: [...EMPTY_OPTIONS] })} block>{t('Add multiple-choice question')}</Button>
                            </Space.Compact>
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

/**
 * The options of a multiple-choice question (a form control: `value` is the list of option texts). The radio marks
 * the correct one; it is kept in the question's `correct` field.
 */
const ChoiceOptions = ({ value = [], onChange, correct, onCorrect, onRemove, onAdd }: {
    value?: string[]
    onChange?: (value: string[]) => void
    correct?: number
    onCorrect: (option: number) => void
    onRemove: (option: number) => void
    onAdd: () => void
}) => {
    const { t } = useLanguage()
    return (
        <Space orientation="vertical" style={{ width: '100%' }} size={6}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('Tick the correct option. Learners see the options in this order.')}</Typography.Text>
            {value.map((option, position) => (
                <Space.Compact key={position} block>
                    <Tooltip title={t('Correct answer')}>
                        <Button onClick={() => onCorrect(position)} aria-label={t('Option {letter} is correct', undefined, { letter: LETTERS[position] || String(position + 1) })} aria-pressed={correct === position}>
                            <Radio checked={correct === position} style={{ marginInlineEnd: 0, pointerEvents: 'none' }} />
                        </Button>
                    </Tooltip>
                    <Input
                        addonBefore={`${LETTERS[position] || position + 1})`}
                        value={option}
                        maxLength={300}
                        placeholder={t('Option {letter}', undefined, { letter: LETTERS[position] || String(position + 1) })}
                        onChange={(event) => onChange?.(value.map((item, index) => (index === position ? event.target.value : item)))}
                    />
                    <Tooltip title={t('Remove option')}>
                        <Button icon={<CloseOutlined />} disabled={value.length <= 2} onClick={() => onRemove(position)} aria-label={t('Remove option')} />
                    </Tooltip>
                </Space.Compact>
            ))}
            {value.length < LETTERS.length && <Button size="small" type="dashed" icon={<PlusOutlined />} onClick={onAdd}>{t('Add option')}</Button>}
        </Space>
    )
}
