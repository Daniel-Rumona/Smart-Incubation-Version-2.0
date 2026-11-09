import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, App, Button, Input, Popconfirm, Result, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, ClockCircleOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getMyAssessment, getMySubmission, saveMyAnswers, submitMyTest } from '@/services/learnerTrainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import type { TrainingAssessment, TrainingSubmission } from '@/types/training'
import '@/styles/training.css'

const AUTOSAVE_MS = 1500

/** Where a learner writes the pre-assessment or post-assessment. Answers save as they type; handing in locks them for marking. */
export default function LearnerTestPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { submissionId = '' } = useParams()
    const [submission, setSubmission] = useState<TrainingSubmission | null>()
    const [assessment, setAssessment] = useState<TrainingAssessment | null>(null)
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'failed'>('saved')
    const [submitting, setSubmitting] = useState(false)
    const [now, setNow] = useState(() => Date.now())
    const saveTimer = useRef<number | undefined>(undefined)
    const answersRef = useRef(answers)
    const autoSubmitted = useRef(false)

    useEffect(() => {
        if (!user || !submissionId) return
        let cancelled = false
        const timeout = window.setTimeout(() => {
            void getMySubmission(user, submissionId)
                .then(async (found) => {
                    if (cancelled) return
                    setSubmission(found)
                    if (!found) return
                    answersRef.current = found.answers
                    setAnswers(found.answers)
                    const linked = await getMyAssessment(user, found.assessmentId).catch(() => null)
                    if (!cancelled) setAssessment(linked)
                })
                .catch(() => { if (!cancelled) setSubmission(null) })
        }, 0)
        return () => {
            cancelled = true
            window.clearTimeout(timeout)
        }
    }, [submissionId, user])

    const writing = submission?.status === 'in_progress'
    const deadline = writing && assessment?.durationMinutes && submission?.startedAt
        ? dayjs(submission.startedAt).add(assessment.durationMinutes, 'minute').valueOf()
        : null

    useEffect(() => {
        if (!deadline) return
        const interval = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(interval)
    }, [deadline])

    const flush = useCallback(async () => {
        if (!user || !submission) return
        window.clearTimeout(saveTimer.current)
        setSaveState('saving')
        try {
            await saveMyAnswers(user, submission.id, answersRef.current)
            setSaveState('saved')
        } catch {
            setSaveState('failed')
        }
    }, [submission, user])

    const change = (questionId: string, value: string) => {
        const next = { ...answersRef.current, [questionId]: value }
        answersRef.current = next
        setAnswers(next)
        setSaveState('unsaved')
        window.clearTimeout(saveTimer.current)
        saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS)
    }

    const handIn = useCallback(async (automatic = false) => {
        if (!user || !submission) return
        window.clearTimeout(saveTimer.current)
        setSubmitting(true)
        try {
            await submitMyTest(user, submission.id, answersRef.current)
            message.success(automatic ? t('Time is up. Your assessment was handed in.') : t('Your assessment was handed in for marking.'))
            navigate('/learner')
        } catch {
            message.error(t('Your assessment could not be handed in. Your answers are saved; please try again.'))
            setSubmitting(false)
        }
    }, [message, navigate, submission, t, user])

    const secondsLeft = deadline ? Math.max(0, Math.round((deadline - now) / 1000)) : null

    useEffect(() => {
        if (secondsLeft !== 0 || autoSubmitted.current || !writing) return
        autoSubmitted.current = true
        const timeout = window.setTimeout(() => void handIn(true), 0)
        return () => window.clearTimeout(timeout)
    }, [handIn, secondsLeft, writing])

    useEffect(() => () => window.clearTimeout(saveTimer.current), [])

    const answered = submission ? submission.questions.filter((question) => (answers[question.id] || '').trim()).length : 0

    useRegisterAgentPageContext({
        pageKey: 'learner-test',
        pageName: submission?.kind === 'pre' ? 'Pre-assessment' : 'Post-assessment',
        purpose: 'A learner writing their awareness training test. Help only with how the test works (saving, time, handing in). Never give, hint at or check answers to the questions.',
        metrics: { questions: submission?.questions.length ?? 0, answered, minutesLeft: secondsLeft === null ? null : Math.ceil(secondsLeft / 60) },
        dataSummary: { status: submission?.status ?? null, rule: 'Never give or hint at answers to assessment questions.' },
    })

    if (submission === undefined) return <PageSkeleton variant="detail" label={t('Loading your assessment')} />

    if (submission === null) {
        return (
            <Result
                status="404"
                title={t('Assessment not found')}
                extra={<Button type="primary" onClick={() => navigate('/learner')}>{t('Back to my training')}</Button>}
            />
        )
    }

    if (!writing) {
        return (
            <Result
                status="success"
                title={submission.status === 'marked'
                    ? t('Your mark: {score} of {total} ({pct}%)', undefined, { score: submission.score ?? 0, total: submission.totalMarks, pct: submission.scorePct ?? 0 })
                    : t('Handed in')}
                subTitle={submission.status === 'marked' ? undefined : t('Your facilitator will mark it.')}
                extra={<Button type="primary" onClick={() => navigate('/learner')}>{t('Back to my training')}</Button>}
            />
        )
    }

    const minutes = secondsLeft === null ? 0 : Math.floor(secondsLeft / 60)
    const seconds = secondsLeft === null ? 0 : secondsLeft % 60

    return (
        <DashboardPage className="training-page">
            <MotionCard className="learner-test-header">
                <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                    <Button type="link" icon={<ArrowLeftOutlined />} className="training-back-link" onClick={() => { void flush(); navigate('/learner') }}>
                        {t('My training')}
                    </Button>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                        <Typography.Title level={4} style={{ margin: 0 }}>
                            {submission.kind === 'pre'
                                ? t('Pre-assessment')
                                : submission.attempt > 1 ? t('Post-assessment: reassessment {n}', undefined, { n: submission.attempt - 1 }) : t('Post-assessment')}
                        </Typography.Title>
                        <Space wrap>
                            {secondsLeft !== null && (
                                <Tag icon={<ClockCircleOutlined />} color={secondsLeft < 300 ? 'red' : 'blue'}>
                                    {t('{minutes}:{seconds} left', undefined, { minutes, seconds: String(seconds).padStart(2, '0') })}
                                </Tag>
                            )}
                            <Tag>{t('{answered} of {count} answered', undefined, { answered, count: submission.questions.length })}</Tag>
                            <Typography.Text type={saveState === 'failed' ? 'danger' : 'secondary'}>
                                {saveState === 'saving' ? t('Saving…') : saveState === 'unsaved' ? t('Unsaved changes') : saveState === 'failed' ? t('Not saved, check your connection') : t('All answers saved')}
                            </Typography.Text>
                        </Space>
                    </Space>
                    {assessment?.instructions && <Typography.Paragraph type="secondary" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>{assessment.instructions}</Typography.Paragraph>}
                </Space>
            </MotionCard>

            {saveState === 'failed' && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('Your latest answers have not been saved. Check your connection; they save again as you type.')} />}

            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                {submission.questions.map((question, index) => (
                    <MotionCard key={question.id} size="small">
                        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                            <Space style={{ justifyContent: 'space-between', width: '100%' }} align="start">
                                <Typography.Text strong>{index + 1}. {question.text}</Typography.Text>
                                <Tag>{question.marks === 1 ? t('1 mark') : t('{count} marks', undefined, { count: question.marks })}</Tag>
                            </Space>
                            <Input.TextArea
                                value={answers[question.id] || ''}
                                onChange={(event) => change(question.id, event.target.value)}
                                onBlur={() => { if (saveState === 'unsaved') void flush() }}
                                autoSize={{ minRows: 2, maxRows: 8 }}
                                maxLength={2000}
                                placeholder={t('Your answer')}
                                aria-label={t('Answer to question {n}', undefined, { n: index + 1 })}
                            />
                        </Space>
                    </MotionCard>
                ))}
            </Space>

            <MotionCard style={{ marginTop: 16 }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                    <Typography.Text type="secondary">{t('Once you hand in, you cannot change your answers.')}</Typography.Text>
                    <Popconfirm
                        title={t('Hand in your assessment?')}
                        description={answered < submission.questions.length
                            ? t('{count} question(s) have no answer yet.', undefined, { count: submission.questions.length - answered })
                            : t('All questions are answered.')}
                        okText={t('Hand in')}
                        onConfirm={() => handIn()}
                    >
                        <Button type="primary" icon={<SendOutlined />} loading={submitting}>{t('Hand in assessment')}</Button>
                    </Popconfirm>
                </Space>
            </MotionCard>
        </DashboardPage>
    )
}
