import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Progress, Tag, Typography } from 'antd'
import {
    ArrowRightOutlined,
    CheckCircleFilled,
    CheckCircleOutlined,
    DownOutlined,
    EditOutlined,
    FileAddOutlined,
    UnorderedListOutlined,
    UpOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listSurveysForParticipant, type SurveyToAnswer } from '@/services/surveyResponsesService'
import '@/styles/incubatee-surveys.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text } = Typography

/** Started surveys come before untouched ones; each keeps the order the service returned. */
const STATUS_ORDER: Record<SurveyToAnswer['status'], number> = { 'in progress': 0, 'not started': 1, submitted: 2 }

const toneOf = (status: SurveyToAnswer['status']) => status.replace(' ', '-')

export default function IncubateeSurveysPage() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    // `undefined` is still loading; `null` means the load failed.
    const [surveys, setSurveys] = useState<SurveyToAnswer[] | null>()
    const [showSubmitted, setShowSubmitted] = useState(false)

    const load = () => {
        if (!user) return
        void listSurveysForParticipant(user)
            .then(setSurveys)
            .catch((error) => {
                console.error('Could not load surveys.', error)
                setSurveys(null)
            })
    }

    useEffect(() => {
        if (!user) return
        const timeout = window.setTimeout(load, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const todo = useMemo(() => (surveys || [])
        .map((survey, index) => ({ survey, index }))
        .filter(({ survey }) => survey.status !== 'submitted')
        .sort((left, right) => STATUS_ORDER[left.survey.status] - STATUS_ORDER[right.survey.status] || left.index - right.index)
        .map(({ survey }) => survey), [surveys])
    const submitted = useMemo(() => (surveys || []).filter((survey) => survey.status === 'submitted'), [surveys])

    if (surveys === undefined) return <PageSkeleton variant="dashboard" label={t('Loading your surveys')} />

    if (surveys === null) {
        return (
            <DashboardPage className="incubatee-page incubatee-surveys-page">
                <Alert type="error" showIcon message={t('Your surveys could not be loaded.')} action={<Button onClick={() => { setSurveys(undefined); load() }}>{t('Try again')}</Button>} />
            </DashboardPage>
        )
    }

    const total = surveys.length
    const notStarted = todo.filter((survey) => survey.status === 'not started').length
    const inProgress = todo.length - notStarted
    const score = total ? Math.round((submitted.length / total) * 100) : 0
    const next = todo[0]

    const open = (survey: SurveyToAnswer) => navigate(`/incubatee/surveys/${survey.templateId}`)
    const actionLabel = (survey: SurveyToAnswer) => survey.status === 'not started' ? t('Start') : survey.status === 'in progress' ? t('Continue') : t('View')
    const statusLabel = (survey: SurveyToAnswer) => survey.status === 'not started' ? t('Not started') : survey.status === 'in progress' ? t('In progress') : t('Submitted')

    const meta = (survey: SurveyToAnswer) => [
        survey.category,
        t('{count} questions', undefined, { count: survey.questionCount }),
        survey.submittedAt
            ? t('submitted {date}', undefined, { date: dayjs(survey.submittedAt).format('D MMM') })
            : survey.updatedAt ? t('saved {date}', undefined, { date: dayjs(survey.updatedAt).format('D MMM') }) : '',
    ].filter(Boolean).join(' · ')

    const renderRow = (survey: SurveyToAnswer) => (
        <li key={survey.templateId} className={`surveys-row is-${toneOf(survey.status)}`}>
            <span className="surveys-row-icon" aria-hidden="true">
                {survey.status === 'submitted' ? <CheckCircleOutlined /> : survey.status === 'in progress' ? <EditOutlined /> : <FileAddOutlined />}
            </span>
            <div className="surveys-row-main">
                <span className="surveys-row-title">
                    <Text strong>{survey.title}</Text>
                    {survey.status === 'in progress' && <Tag color="blue">{statusLabel(survey)}</Tag>}
                </span>
                <Text type="secondary" className="surveys-row-meta">{meta(survey)}</Text>
            </div>
            <Button onClick={() => open(survey)}>{actionLabel(survey)}</Button>
        </li>
    )

    return (
        <DashboardPage className="incubatee-page incubatee-surveys-page">
            <section className="surveys-summary">
                {/* The shared metric card has no ring, so the completion score borrows its card styles. */}
                <Card className="dashboard-metric-card surveys-score-card" bordered>
                    <div className="dashboard-metric-row">
                        <Progress
                            type="circle"
                            percent={score}
                            size={44}
                            strokeWidth={10}
                            strokeColor="#6d5dfb"
                            format={(percent) => <span className="surveys-score-value">{percent}%</span>}
                        />
                        <div className="dashboard-metric-copy">
                            <Text strong>{t('Surveys')}</Text>
                            <Text type="secondary" className="dashboard-metric-label">
                                {t('{done} of {total} submitted', undefined, { done: submitted.length, total })}
                            </Text>
                        </div>
                    </div>
                </Card>
                <DashboardMetricCard icon={<FileAddOutlined />} label={t('Not started')} value={notStarted} />
                <DashboardMetricCard icon={<EditOutlined />} label={t('In progress')} value={inProgress} />
                <DashboardMetricCard icon={<CheckCircleOutlined />} label={t('Submitted')} value={submitted.length} />
            </section>

            {next ? (
                <section className={`surveys-next is-${toneOf(next.status)}`}>
                    <span className="surveys-next-eyebrow"><ArrowRightOutlined /> {t('Next step')}</span>
                    <div className="surveys-next-body">
                        <span className="surveys-next-icon" aria-hidden="true">{next.status === 'in progress' ? <EditOutlined /> : <FileAddOutlined />}</span>
                        <div className="surveys-next-text">
                            <Text strong className="surveys-next-title">
                                {next.status === 'in progress'
                                    ? t('Continue "{title}"', undefined, { title: next.title })
                                    : t('Start "{title}"', undefined, { title: next.title })}
                            </Text>
                            <Text type="secondary">{next.description || meta(next)}</Text>
                        </div>
                        <div className="surveys-next-actions">
                            <Button type="primary" size="large" onClick={() => open(next)}>{actionLabel(next)}</Button>
                        </div>
                    </div>
                </section>
            ) : (
                <section className="surveys-next is-done">
                    <div className="surveys-next-body">
                        <span className="surveys-next-icon" aria-hidden="true"><CheckCircleFilled /></span>
                        <div className="surveys-next-text">
                            <Text strong className="surveys-next-title">{total ? t("You're all caught up") : t('No surveys right now')}</Text>
                            <Text type="secondary">{t('New surveys from your programme will appear here.')}</Text>
                        </div>
                    </div>
                </section>
            )}

            {todo.length > 0 && (
                <section className="surveys-group is-todo">
                    <h3 className="surveys-group-head"><UnorderedListOutlined aria-hidden="true" /> {t('To do')}</h3>
                    <ul className="surveys-list">{todo.map(renderRow)}</ul>
                </section>
            )}

            {submitted.length > 0 && (
                <section className="surveys-group is-submitted">
                    <h3 className="surveys-group-head">
                        <CheckCircleOutlined aria-hidden="true" /> {t('Submitted')}
                        <Button type="link" size="small" className="surveys-group-toggle" onClick={() => setShowSubmitted((value) => !value)} icon={showSubmitted ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                            {showSubmitted ? t('Hide') : t('Show {count}', undefined, { count: submitted.length })}
                        </Button>
                    </h3>
                    {showSubmitted && <ul className="surveys-list">{submitted.map(renderRow)}</ul>}
                </section>
            )}
        </DashboardPage>
    )
}
