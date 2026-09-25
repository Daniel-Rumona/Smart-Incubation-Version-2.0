import { useEffect, useMemo, useState } from 'react'
import { App, Button, Checkbox, DatePicker, Empty, Input, Radio, Rate, Result, Select, Tag, Upload } from 'antd'
import type { UploadFile } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, InboxOutlined, LockOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import SurveyQuestionFrame from '@/components/surveys/SurveyQuestionFrame'
import { useFullscreenMobilePage } from '@/contexts/SystemLayoutTopbarContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { PREFILL_LABELS, readPrefillValue } from '@/lib/surveyPrefill'
import {
    loadSurveyForResponse,
    saveSurveyResponse,
    uploadResponseFiles,
    type SurveyAnswers,
    type SurveyResponseContext,
} from '@/services/surveyResponsesService'
import type { SurveyField } from '@/services/surveyTemplatesService'
import '@/styles/survey-response.css'
import { useLanguage } from '@/providers/LanguageProvider'

const SURVEYS_PATH = '/incubatee/surveys'

const hasAnswer = (field: SurveyField, value: unknown) => {
    if (value === undefined || value === null) return false
    if (Array.isArray(value)) return value.length > 0
    if (typeof value === 'string') return value.trim().length > 0
    if (field.type === 'rating') return typeof value === 'number' && value > 0
    return true
}

export default function SurveyResponsePage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()

    // Answering a survey is a phone-first, one-question-at-a-time flow: it owns
    // its own header and a bottom-docked action bar instead of the system chrome.
    useFullscreenMobilePage()

    const [context, setContext] = useState<SurveyResponseContext | null>()
    const [answers, setAnswers] = useState<SurveyAnswers>({})
    const [index, setIndex] = useState(0)
    const [saving, setSaving] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [touched, setTouched] = useState(false)

    useEffect(() => {
        if (!user || !id) return
        void loadSurveyForResponse(user, id)
            .then((loaded) => {
                if (!loaded) {
                    message.error(t('That survey could not be found.'))
                    navigate(SURVEYS_PATH)
                    return
                }

                // A saved draft wins; anything still empty is seeded from the SME's record.
                const seeded: SurveyAnswers = { ...(loaded.response?.answers || {}) }
                loaded.fields.forEach((field) => {
                    if (!field.prefill || seeded[field.id] !== undefined) return
                    const value = readPrefillValue(loaded.participant, field.prefill)
                    if (value) seeded[field.id] = value
                })

                setContext(loaded)
                setAnswers(seeded)
                setSubmitted(loaded.response?.status === 'submitted')
            })
            .catch(() => {
                message.error(t('The survey could not be loaded.'))
                setContext(null)
            })
    }, [user, id]) // eslint-disable-line react-hooks/exhaustive-deps

    const fields = useMemo(() => context?.fields || [], [context])
    const questions = useMemo(() => fields.filter((field) => field.type !== 'heading'), [fields])
    const current = questions[index]

    const sectionLabel = useMemo(() => {
        if (!current) return undefined
        const position = fields.findIndex((field) => field.id === current.id)
        if (position <= 0) return undefined
        return [...fields].slice(0, position).reverse().find((field) => field.type === 'heading')?.label
    }, [fields, current])

    const answered = useMemo(() => questions.filter((field) => hasAnswer(field, answers[field.id])).length, [questions, answers])
    const missing = useMemo(() => questions.filter((field) => field.required && !hasAnswer(field, answers[field.id])), [questions, answers])

    const setAnswer = (value: unknown) => {
        if (!current) return
        setTouched(false)
        setAnswers((previous) => ({ ...previous, [current.id]: value }))
    }

    const blocked = Boolean(current?.required && !hasAnswer(current, answers[current.id]))

    const goNext = () => {
        if (blocked) {
            setTouched(true)
            return
        }
        setTouched(false)
        setIndex((value) => Math.min(questions.length - 1, value + 1))
    }

    const save = async (status: 'draft' | 'submitted') => {
        if (!context || !user) return

        if (status === 'submitted' && missing.length) {
            setTouched(true)
            const first = questions.findIndex((field) => field.id === missing[0].id)
            setIndex(first < 0 ? 0 : first)
            message.error(`${missing.length} required question${missing.length === 1 ? ' still needs' : 's still need'} an answer.`)
            return
        }

        setSaving(true)
        try {
            // Files live in state as antd upload entries; they become URLs on save.
            const prepared: SurveyAnswers = { ...answers }
            for (const field of fields) {
                const value = prepared[field.id]
                if (field.type !== 'file' || !Array.isArray(value)) continue
                const pending = (value as UploadFile[]).filter((item) => item.originFileObj).map((item) => item.originFileObj as File)
                if (!pending.length) continue
                prepared[field.id] = await uploadResponseFiles(context.participantId, context.template.id as string, field.id, pending)
            }

            const responseId = await saveSurveyResponse({ context, answers: prepared, status, user })
            setAnswers(prepared)
            setContext({ ...context, response: { ...(context.response ?? {} as never), id: responseId, status, answers: prepared } as never })

            if (status === 'submitted') {
                setSubmitted(true)
                message.success(t('Thank you, your answers have been submitted.'))
            } else {
                message.success(t('Draft saved. You can finish this later.'))
            }
        } catch {
            message.error(t('Your answers could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const mobileHeader = (
        <div className="survey-response-mobile-header">
            <Button
                shape="circle"
                icon={<ArrowLeftOutlined />}
                className="survey-response-back-btn"
                onClick={() => navigate(SURVEYS_PATH)}
                aria-label={t('Back to surveys')}
            />
            <span className="survey-response-mobile-title">{context?.template.title || t('Survey')}</span>
            <span aria-hidden="true" />
        </div>
    )

    if (context === undefined) {
        return <DashboardPage className="incubatee-page survey-response-page">{mobileHeader}<MotionCard loading skeletonRows={6} /></DashboardPage>
    }

    if (!context) {
        return <DashboardPage className="incubatee-page survey-response-page">{mobileHeader}<Empty description={t('This survey is not available.')} /></DashboardPage>
    }

    if (submitted) {
        return (
            <DashboardPage className="incubatee-page survey-response-page">
                {mobileHeader}
                <MotionCard className="survey-response-card">
                    <Result
                        status="success"
                        title={t('Your answers are in')}
                        subTitle={`${context.template.title} was submitted${context.response?.submittedAt ? ` on ${dayjs(context.response.submittedAt).format('DD MMM YYYY')}` : ''}.`}
                        extra={<Button type="primary" onClick={() => navigate(SURVEYS_PATH)}>{t('Back to surveys')}</Button>}
                    />
                </MotionCard>
            </DashboardPage>
        )
    }

    if (!questions.length) {
        return (
            <DashboardPage className="incubatee-page survey-response-page">
                {mobileHeader}
                <MotionCard className="survey-response-card">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('This survey has no questions yet.')} />
                </MotionCard>
            </DashboardPage>
        )
    }

    const control = (field: SurveyField) => {
        const value = answers[field.id]

        if (field.prefill) {
            return (
                <Input
                    size="large"
                    value={(value as string) || ''}
                    onChange={(event) => setAnswer(event.target.value)}
                    placeholder={PREFILL_LABELS[field.prefill]}
                />
            )
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
                        className="survey-response-control"
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
                return (
                    <DatePicker
                        size="large"
                        className="survey-response-control"
                        value={value ? dayjs(value as string) : null}
                        onChange={(date) => setAnswer(date ? date.toISOString() : null)}
                    />
                )
            case 'rating':
                return <Rate value={(value as number) || 0} onChange={setAnswer} />
            case 'file':
                return (
                    <Upload.Dragger
                        multiple={false}
                        maxCount={1}
                        beforeUpload={() => false}
                        fileList={Array.isArray(value) && typeof value[0] !== 'string' ? (value as UploadFile[]) : []}
                        onChange={({ fileList }) => setAnswer(fileList)}
                    >
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
        <DashboardPage className="incubatee-page survey-response-page">
            {mobileHeader}
            <MotionCard className="survey-response-card">
                <SurveyQuestionFrame
                    index={index}
                    total={questions.length}
                    field={current}
                    sectionLabel={sectionLabel}
                    answeredCount={answered}
                    surveyTitle={context.template.title || 'Survey'}
                    surveySubtitle={context.template.description}
                    extra={
                        <>
                            {current.prefill && (
                                <Tag icon={<LockOutlined />} color="blue">
                                    {t('Filled in from your profile · correct it here if it has changed')}
                                </Tag>
                            )}
                            {touched && blocked && <span className="survey-response-error">{t('This question needs an answer before you continue.')}</span>}
                        </>
                    }
                    footer={
                        <div className="survey-response-nav">
                            <Button
                                size="large"
                                icon={<ArrowLeftOutlined />}
                                disabled={isFirst}
                                onClick={() => { setTouched(false); setIndex((value) => Math.max(0, value - 1)) }}
                            >
                                {t('Previous')}
                            </Button>

                            <Button size="large" icon={<SaveOutlined />} loading={saving} onClick={() => void save('draft')}>
                                {t('Save for later')}
                            </Button>

                            {isLast ? (
                                <Button size="large" type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void save('submitted')}>
                                    {t('Submit answers')}
                                </Button>
                            ) : (
                                <Button size="large" type="primary" onClick={goNext}>{t('Next')}</Button>
                            )}
                        </div>
                    }
                >
                    {control(current)}
                </SurveyQuestionFrame>
            </MotionCard>
        </DashboardPage>
    )
}
