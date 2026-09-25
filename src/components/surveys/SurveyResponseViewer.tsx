import { Rate, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import type { SurveyAnswers } from '@/services/surveyResponsesService'
import type { SurveyField } from '@/services/surveyTemplatesService'
import '@/styles/survey-response.css'
import { useLanguage } from '@/providers/LanguageProvider'

type AnswerValueProps = { field: SurveyField; value: unknown }

const AnswerValue = ({ field, value }: AnswerValueProps) => {
    const { t } = useLanguage()
    if (value === undefined || value === null || value === '') {
        return <Typography.Text type="secondary">{t('Not answered')}</Typography.Text>
    }

    if (field.type === 'checkbox') {
        const items = Array.isArray(value) ? value : [value]
        return (
            <Space wrap size={6}>
                {items.map((item, index) => <Tag key={`${item}-${index}`}>{String(item)}</Tag>)}
            </Space>
        )
    }

    if (field.type === 'radio' || field.type === 'select') {
        return <Tag>{String(value)}</Tag>
    }

    if (field.type === 'rating') {
        const count = Number(value)
        return Number.isFinite(count) ? <Rate disabled value={count} /> : <Typography.Text>{String(value)}</Typography.Text>
    }

    if (field.type === 'date') {
        const parsed = dayjs(value as string)
        return <Typography.Text>{parsed.isValid() ? parsed.format('DD MMM YYYY') : String(value)}</Typography.Text>
    }

    if (field.type === 'file') {
        const urls = Array.isArray(value) ? value : [value]
        return (
            <Space direction="vertical" size={2}>
                {urls.map((url, index) => (
                    <a key={index} href={String(url)} target="_blank" rel="noreferrer">{t('Attachment')} {index + 1}</a>
                ))}
            </Space>
        )
    }

    return <Typography.Text>{String(value)}</Typography.Text>
}

type SurveyResponseViewerProps = {
    fields: SurveyField[]
    answers: SurveyAnswers
}

/** Read-only playback of a submitted response, in the same question order as the builder. */
export const SurveyResponseViewer = ({ fields, answers }: SurveyResponseViewerProps) => {
    const { t } = useLanguage()
    if (!fields.length) {
        return <Typography.Text type="secondary">{t('This survey has no questions.')}</Typography.Text>
    }

    return (
        <div className="survey-review">
            {fields.map((field) => {
                if (field.type === 'heading') {
                    return (
                        <Typography.Title key={field.id} level={5} className="survey-review-heading">
                            {field.label || t('Section')}
                        </Typography.Title>
                    )
                }

                return (
                    <div key={field.id} className="survey-review-row">
                        <Typography.Text strong className="survey-review-question">
                            {field.label || t('Untitled question')}
                            {field.required && <span className="survey-frame-required"> *</span>}
                        </Typography.Text>
                        <div className="survey-review-answer"><AnswerValue field={field} value={answers[field.id]} /></div>
                    </div>
                )
            })}
        </div>
    )
}

export default SurveyResponseViewer
