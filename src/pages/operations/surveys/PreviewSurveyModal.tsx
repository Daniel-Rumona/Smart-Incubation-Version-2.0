import { useMemo, useState } from 'react'
import { Button, Checkbox, DatePicker, Empty, Input, Modal, Radio, Rate, Select, Tag, Upload } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined, InboxOutlined, LockOutlined } from '@ant-design/icons'
import SurveyQuestionFrame from '@/components/surveys/SurveyQuestionFrame'
import { PREFILL_LABELS } from '@/lib/surveyPrefill'
import type { SurveyField } from '@/services/surveyTemplatesService'
import { useLanguage } from '@/providers/LanguageProvider'

type PreviewSurveyModalProps = {
    open: boolean
    title: string
    description?: string
    fields: SurveyField[]
    onClose: () => void
}

const hasAnswer = (field: SurveyField, value: unknown) => {
    if (value === undefined || value === null) return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim().length > 0
    if (field.type === 'rating') return typeof value === 'number' && value > 0
    return true
}

const PreviewSurveyBody = ({ open, title, description, fields, onClose }: PreviewSurveyModalProps) => {
    const { t } = useLanguage()
    const [index, setIndex] = useState(0)
    const [answers, setAnswers] = useState<Record<string, unknown>>({})
    // Remounting on open is simpler than resetting in an effect, and it also
    // discards any half-typed answer from a previous look at the survey.

    // Headings are context above the next question, not questions in their own right.
    const questions = useMemo(() => fields.filter((field) => field.type !== 'heading'), [fields])
    const current = questions[index]

    const sectionLabel = useMemo(() => {
        if (!current) return undefined
        const position = fields.findIndex((field) => field.id === current.id)
        if (position <= 0) return undefined
        return [...fields].slice(0, position).reverse().find((field) => field.type === 'heading')?.label
    }, [fields, current])

    const answered = useMemo(() => questions.filter((field) => hasAnswer(field, answers[field.id])).length, [questions, answers])

    const setAnswer = (value: unknown) => {
        if (!current) return
        setAnswers((previous) => ({ ...previous, [current.id]: value }))
    }

    const control = (field: SurveyField) => {
        const value = answers[field.id]

        if (field.prefill) {
            return <Input size="large" disabled placeholder={`${PREFILL_LABELS[field.prefill]} from the SME's record`} />
        }

        switch (field.type) {
            case 'textarea':
                return <Input.TextArea rows={5} value={(value as string) || ''} placeholder={field.placeholder} onChange={(event) => setAnswer(event.target.value)} />
            case 'number':
                return <Input size="large" type="number" value={(value as string) || ''} placeholder={field.placeholder} onChange={(event) => setAnswer(event.target.value)} />
            case 'email':
                return <Input size="large" type="email" value={(value as string) || ''} placeholder={field.placeholder} onChange={(event) => setAnswer(event.target.value)} />
            case 'select':
                return (
                    <Select
                        size="large"
                        className="survey-preview-control"
                        value={value as string}
                        placeholder={field.placeholder}
                        onChange={setAnswer}
                        options={(field.options || []).map((option) => ({ value: option, label: option }))}
                    />
                )
            case 'checkbox':
                return <Checkbox.Group value={(value as string[]) || []} onChange={setAnswer} options={(field.options || []).map((option) => ({ label: option, value: option }))} />
            case 'radio':
                return <Radio.Group value={value as string} onChange={(event) => setAnswer(event.target.value)} options={(field.options || []).map((option) => ({ label: option, value: option }))} />
            case 'date':
                return <DatePicker size="large" className="survey-preview-control" onChange={(date) => setAnswer(date ? date.toISOString() : null)} />
            case 'rating':
                return <Rate value={(value as number) || 0} onChange={setAnswer} />
            case 'file':
                return (
                    <Upload.Dragger multiple={false} maxCount={1} beforeUpload={() => false} onChange={({ fileList }) => setAnswer(fileList)}>
                        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
                        <p className="ant-upload-text">{t('Drag and drop a file here')}</p>
                        <p className="ant-upload-hint">{t('or click to browse')}</p>
                    </Upload.Dragger>
                )
            default:
                return <Input size="large" value={(value as string) || ''} placeholder={field.placeholder} onChange={(event) => setAnswer(event.target.value)} />
        }
    }

    const isFirst = index === 0
    const isLast = index === questions.length - 1

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={720}
            title={null}
            className="survey-preview-modal"
        >
            {questions.length === 0 ? (
                <div className="survey-preview-empty">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('This survey has no questions yet')} />
                    <Button onClick={onClose}>{t('Close')}</Button>
                </div>
            ) : (
                <SurveyQuestionFrame
                    index={index}
                    total={questions.length}
                    field={current}
                    sectionLabel={sectionLabel}
                    answeredCount={answered}
                    surveyTitle={title || 'Untitled survey'}
                    surveySubtitle={description}
                    extra={current.prefill ? <Tag icon={<LockOutlined />} color="blue">{t('Prefilled ·')} {PREFILL_LABELS[current.prefill]}</Tag> : undefined}
                    footer={
                        <div className={`survey-preview-nav${isFirst || questions.length === 1 ? ' is-single' : ''}`}>
                            {!isFirst && (
                                <Button block size="large" icon={<ArrowLeftOutlined />} onClick={() => setIndex((value) => Math.max(0, value - 1))}>
                                    {t('Previous')}
                                </Button>
                            )}

                            {isLast ? (
                                <Button block size="large" type="primary" icon={<CheckOutlined />} onClick={onClose}>{t('Submit')}</Button>
                            ) : (
                                <Button block size="large" type="primary" onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}>
                                    {t('Next')} <ArrowRightOutlined />
                                </Button>
                            )}
                        </div>
                    }
                >
                    {control(current)}
                </SurveyQuestionFrame>
            )}
        </Modal>
    )
}

export const PreviewSurveyModal = (props: PreviewSurveyModalProps) => (
    <PreviewSurveyBody {...props} key={props.open ? 'open' : 'closed'} />
)

export default PreviewSurveyModal
