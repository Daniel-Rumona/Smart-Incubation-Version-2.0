import { useEffect, useState } from 'react'
import { Alert, App, Button, Form, Input, InputNumber, Modal, Segmented, Select, Typography } from 'antd'
import { RobotOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { draftAssessmentQuestions, type DraftedQuestion, type DraftQuestionStyle } from '@/services/trainingAiService'
import { listTrainingLibrary } from '@/services/trainingLibraryService'
import type { TrainingLibraryItem } from '@/types/training'

type Props = {
    open: boolean
    /** The questions already in the editor, so the draft does not repeat them. */
    existingQuestions: string[]
    onClose: () => void
    onDrafted: (questions: DraftedQuestion[]) => void
}

type DraftValues = { libraryItemIds: string[], count: number, style: DraftQuestionStyle, focus?: string }

/**
 * Drafts knowledge questions and their memo answers from the company's own library documents
 * (ai-backend/training_agent.py). The questions are added to the editor for the facilitator to check; nothing is saved
 * until they save the assessment.
 */
export const AssessmentDraftModal = ({ open, existingQuestions, onClose, onDrafted }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<DraftValues>()
    const [items, setItems] = useState<TrainingLibraryItem[] | null>(null)
    const [drafting, setDrafting] = useState(false)

    useEffect(() => {
        if (!open || !user) return
        let active = true
        listTrainingLibrary(user)
            .then((rows) => { if (active) setItems(rows.filter((item) => item.textChars > 0)) })
            .catch(() => { if (active) setItems([]) })
        return () => { active = false }
    }, [open, user])

    const draft = async () => {
        const values = await form.validateFields().catch(() => null)
        if (!values) return
        setDrafting(true)
        try {
            const { questions } = await draftAssessmentQuestions({ ...values, focus: values.focus?.trim() || undefined, existingQuestions })
            onDrafted(questions)
            message.success(t('Added {count} drafted questions with memo answers. Check each one before saving.', undefined, { count: questions.length }))
            onClose()
        } catch (error) {
            const code = error instanceof Error ? error.message : ''
            message.error(code === 'no_readable_text'
                ? t('There is no readable text in the chosen documents.')
                : t('The questions could not be drafted. Try again.'))
        } finally {
            setDrafting(false)
        }
    }

    return (
        <Modal
            open={open}
            centered
            destroyOnHidden
            title={t('Draft questions with AI')}
            onCancel={onClose}
            footer={[
                <Button key="cancel" onClick={onClose}>{t('Cancel')}</Button>,
                <Button key="draft" type="primary" icon={<RobotOutlined />} loading={drafting} disabled={!items?.length} onClick={() => void draft()}>{t('Draft questions')}</Button>,
            ]}
        >
            <Typography.Paragraph type="secondary">
                {t('Questions and memo answers are written only from the documents you choose. They are added to this assessment for you to check and edit; nothing is saved until you save.')}
            </Typography.Paragraph>
            {items && items.length === 0 && (
                <Alert type="info" showIcon style={{ marginBottom: 16 }} message={t('No library documents with readable text yet. Upload a PDF, Word or text file to the library first.')} />
            )}
            <Form form={form} layout="vertical" requiredMark={false} initialValues={{ count: 8, style: 'mixed', libraryItemIds: [] }}>
                <Form.Item
                    name="libraryItemIds"
                    label={t('From these library documents')}
                    rules={[{ required: true, type: 'array', min: 1, message: t('Choose at least one document.') }, { type: 'array', max: 3, message: t('Choose up to three documents.') }]}
                >
                    <Select
                        mode="multiple"
                        loading={items === null}
                        optionFilterProp="label"
                        options={(items || []).map((item) => ({ value: item.id, label: item.courseTitle ? `${item.title} · ${item.courseTitle}` : item.title }))}
                    />
                </Form.Item>
                <Form.Item name="style" label={t('Question types')}>
                    <Segmented
                        block
                        options={[
                            { value: 'mixed', label: t('Mixed') },
                            { value: 'choice', label: t('Multiple choice') },
                            { value: 'written', label: t('Written') },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="count" label={t('Number of questions')}>
                    <InputNumber min={1} max={20} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item name="focus" label={t('Focus (optional)')} extra={t('For example: one module, or the topics learners find hardest.')}>
                    <Input maxLength={300} />
                </Form.Item>
            </Form>
        </Modal>
    )
}
