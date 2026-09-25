import type { ReactNode } from 'react'
import { Progress, Space, Tag, Tooltip, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import '@/styles/survey-question-frame.css'
import { useLanguage } from '@/providers/LanguageProvider'

/**
 * The one-question-at-a-time shell shared by the builder's preview and the SME
 * response page, so the two cannot drift apart visually.
 *
 * Purely presentational: it owns no answer state and no navigation. The caller
 * supplies the control (`children`) and the buttons (`footer`), because a
 * preview throws answers away while a response page validates and saves them.
 */

export type SurveyFrameField = {
    id: string
    type: string
    label: string
    required?: boolean
    description?: string
}

type SurveyQuestionFrameProps = {
    /** Zero-based position among questions, headings excluded. */
    index: number
    total: number
    field: SurveyFrameField
    /** Nearest preceding heading, shown as the section eyebrow. */
    sectionLabel?: string
    children: ReactNode
    footer?: ReactNode
    /** Note under the control, such as a prefill explanation. */
    extra?: ReactNode
    /** Supply to show the answered-count progress bar. */
    answeredCount?: number
    /** Survey name and blurb, centred above the question with the counts inline. */
    surveyTitle?: string
    surveySubtitle?: string
}

export const SurveyQuestionFrame = ({
    index,
    total,
    field,
    sectionLabel,
    children,
    footer,
    extra,
    answeredCount,
    surveyTitle,
    surveySubtitle,
}: SurveyQuestionFrameProps) => {
    const { t } = useLanguage()
    const progress = total > 0 && answeredCount !== undefined ? Math.round((answeredCount / total) * 100) : undefined

    return (
        <div className="survey-frame">
            {(surveyTitle || progress !== undefined) && (
                <div className="survey-frame-header">
                    {surveyTitle && <Typography.Title level={4} className="survey-frame-survey-title">{surveyTitle}</Typography.Title>}

                    {/* Subtitle and counts share one centred line rather than stacking. */}
                    <div className="survey-frame-meta">
                        {surveySubtitle && <Typography.Text type="secondary">{surveySubtitle}</Typography.Text>}

                        {progress !== undefined && (
                            <Space size={6} wrap className="survey-frame-tags">
                                <Tag className="survey-frame-tag">{total} {total === 1 ? 'question' : 'questions'}</Tag>
                                <Tag color="blue" className="survey-frame-tag">{answeredCount} {t('answered')}</Tag>
                            </Space>
                        )}
                    </div>

                    {progress !== undefined && <Progress percent={progress} showInfo={false} size="small" className="survey-frame-progress" />}
                </div>
            )}

            {/* Keyed on the question so each one fades in as the previous leaves. */}
            <div className="survey-frame-body" key={field.id}>
                <div className="survey-frame-position">
                    <span className="survey-frame-number">{String(index + 1).padStart(2, '0')}</span>
                    <Typography.Text type="secondary">{t('Question')} {index + 1} {t('of')} {total}</Typography.Text>
                </div>

                {sectionLabel && <span className="survey-frame-section">{sectionLabel}</span>}

                <div className="survey-frame-question">
                    <Typography.Title level={3} className="survey-frame-title">{field.label || t('Untitled question')}</Typography.Title>

                    {field.required && <span className="survey-frame-required">*</span>}

                    {field.description && (
                        <Tooltip title={field.description}>
                            <InfoCircleOutlined className="survey-frame-info" />
                        </Tooltip>
                    )}
                </div>

                <div className="survey-frame-control">{children}</div>

                {extra && <div className="survey-frame-extra">{extra}</div>}

                {field.description && <p className="survey-frame-help">{field.description}</p>}
            </div>

            {footer && <div className="survey-frame-footer">{footer}</div>}
        </div>
    )
}

export default SurveyQuestionFrame
