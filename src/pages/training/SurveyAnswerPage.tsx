import { useEffect, useState } from 'react'
import { Alert, App, Button, Input, Radio, Result, Space, Typography } from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listMyEnrolments } from '@/services/learnerTrainingService'
import { getMyOrganisation } from '@/services/trainingOrganisationsService'
import { getMySurvey, submitMySurvey, type MySurvey } from '@/services/trainingSurveysService'
import { useLanguage } from '@/providers/LanguageProvider'
import { missingAnswers } from '@/utils/trainingSurveyResults'
import type { TrainingSurveyAnswer } from '@/types/trainingSurveys'
import '@/styles/training.css'

const RATING_HINTS: Record<number, string> = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very good', 5: 'Excellent' }

/**
 * One survey, answered by a learner (/learner/surveys/:surveyId) or a client company (/company/surveys/:surveyId).
 * Answers can be changed while the survey is open.
 */
export default function SurveyAnswerPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { surveyId = '' } = useParams()
    const [found, setFound] = useState<MySurvey | null>()
    const [answers, setAnswers] = useState<Record<string, TrainingSurveyAnswer>>({})
    const [about, setAbout] = useState<{ classId?: string, name: string, organisation: string }>({ name: '', organisation: '' })
    const [saving, setSaving] = useState(false)
    const [done, setDone] = useState(false)
    const [showMissing, setShowMissing] = useState(false)
    const backPath = user?.role === 'clientorg' ? '/company/surveys' : '/learner'

    useEffect(() => {
        if (!user) return undefined
        let cancelled = false
        const load = async () => {
            try {
                const mine = await getMySurvey(user, surveyId)
                if (cancelled) return
                setFound(mine)
                setAnswers(mine?.response?.answers || {})
                if (!mine) return
                if (user.role === 'learner') {
                    const enrolments = await listMyEnrolments(user)
                    const asked = mine.survey.classIds
                    const enrolment = enrolments.find((row) => !asked.length || asked.includes(row.trainingClass.id)) || enrolments[0]
                    if (!cancelled && enrolment) setAbout({ classId: enrolment.trainingClass.id, name: enrolment.learner.name, organisation: enrolment.learner.organisation })
                } else {
                    const organisation = await getMyOrganisation(user).catch(() => null)
                    if (!cancelled) setAbout({ name: String(user.name || user.email || ''), organisation: organisation?.name || '' })
                }
            } catch {
                if (!cancelled) setFound(null)
            }
        }
        void load()
        return () => { cancelled = true }
    }, [surveyId, user])

    if (found === undefined) return <PageSkeleton variant="detail" label={t('Loading survey')} />
    if (found === null || !user) return <Result status="404" title={t('Survey not found')} extra={<Button onClick={() => navigate(backPath)}>{t('Back')}</Button>} />

    const { survey, response } = found
    const open = survey.status === 'open'
    const missing = missingAnswers(survey, answers)
    const set = (id: string, value: TrainingSurveyAnswer) => setAnswers((current) => ({ ...current, [id]: value }))

    const submit = async () => {
        if (missing.length) {
            setShowMissing(true)
            message.warning(t('Answer the questions marked as required.'))
            return
        }
        setSaving(true)
        try {
            await submitMySurvey(user, survey, answers, about, response)
            setDone(true)
        } catch {
            message.error(t('Your answers could not be saved. The survey may have closed.'))
        } finally {
            setSaving(false)
        }
    }

    if (done) {
        return (
            <DashboardPage className="training-page">
                <MotionCard>
                    <Result status="success" icon={<CheckCircleOutlined />} title={t('Thank you')} subTitle={t('Your answers to "{title}" are saved. You can change them while the survey is open.', undefined, { title: survey.title })} extra={<Button type="primary" onClick={() => navigate(backPath)}>{t('Back')}</Button>} />
                </MotionCard>
            </DashboardPage>
        )
    }

    return (
        <DashboardPage className="training-page">
            <MotionCard>
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                    <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(backPath)} className="training-back-link">{t('Back')}</Button>
                    <Typography.Title level={4} style={{ margin: 0 }}>{survey.title}</Typography.Title>
                    {survey.description && <Typography.Text type="secondary">{survey.description}</Typography.Text>}
                    {survey.hideNames && <Typography.Text type="secondary">{t('Your name is not shown with your answers.')}</Typography.Text>}
                </Space>
            </MotionCard>
            {!open && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={t('This survey is closed. Thank you if you answered it.')} />}
            {response && open && <Alert type="success" showIcon style={{ marginBottom: 12 }} message={t('You have answered this survey. Change any answer and save again.')} />}
            <MotionCard>
                <Space orientation="vertical" size={22} style={{ width: '100%' }}>
                    {survey.questions.map((item, index) => {
                        const value = answers[item.id]
                        const flagged = showMissing && missing.some((row) => row.id === item.id)
                        return (
                            <Space key={item.id} orientation="vertical" size={8} style={{ width: '100%' }}>
                                <Typography.Text strong>
                                    {index + 1}. {item.text}{item.required ? ' *' : ` (${t('optional')})`}
                                </Typography.Text>
                                {item.type === 'rating' && (
                                    <>
                                        <Radio.Group disabled={!open} value={value} onChange={(event) => set(item.id, Number(event.target.value))} optionType="button" buttonStyle="solid">
                                            {[1, 2, 3, 4, 5].map((score) => <Radio.Button key={score} value={score} aria-label={`${score} ${t(RATING_HINTS[score])}`}>{score}</Radio.Button>)}
                                        </Radio.Group>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('1 = poor, 5 = excellent')}{typeof value === 'number' ? ` · ${t(RATING_HINTS[value])}` : ''}</Typography.Text>
                                    </>
                                )}
                                {item.type === 'yesno' && (
                                    <Radio.Group disabled={!open} value={value} onChange={(event) => set(item.id, event.target.value)}>
                                        <Radio value="yes">{t('Yes')}</Radio>
                                        <Radio value="no">{t('No')}</Radio>
                                    </Radio.Group>
                                )}
                                {item.type === 'choice' && (
                                    <Radio.Group disabled={!open} value={value} onChange={(event) => set(item.id, event.target.value)}>
                                        <Space orientation="vertical">{item.options.map((option) => <Radio key={option} value={option}>{option}</Radio>)}</Space>
                                    </Radio.Group>
                                )}
                                {item.type === 'text' && (
                                    <Input.TextArea disabled={!open} value={typeof value === 'string' ? value : ''} onChange={(event) => set(item.id, event.target.value)} autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} />
                                )}
                                {flagged && <Typography.Text type="danger">{t('Please answer this question.')}</Typography.Text>}
                            </Space>
                        )
                    })}
                    {open && <Button type="primary" size="large" loading={saving} onClick={() => void submit()}>{response ? t('Save my answers') : t('Send my answers')}</Button>}
                </Space>
            </MotionCard>
        </DashboardPage>
    )
}
