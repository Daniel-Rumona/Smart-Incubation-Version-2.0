import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Progress, Tag, Typography } from 'antd'
import {
    ArrowRightOutlined,
    CheckCircleFilled,
    CheckCircleOutlined,
    DownOutlined,
    EditOutlined,
    ReadOutlined,
    RightOutlined,
    UnorderedListOutlined,
    UpOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listCoursesForParticipant, type CourseToTake } from '@/services/courseProgressService'
// Courses share the surveys page's layout (score row, next step, To do / Completed groups).
import '@/styles/incubatee-surveys.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text } = Typography

/** Started courses come before untouched ones; each keeps the order the service returned. */
const STATUS_ORDER: Record<CourseToTake['status'], number> = { 'in progress': 0, 'not started': 1, completed: 2 }

const toneOf = (status: CourseToTake['status']) => (status === 'completed' ? 'submitted' : status.replace(' ', '-'))

export default function IncubateeCoursesPage() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    // `undefined` is still loading; `null` means the load failed.
    const [courses, setCourses] = useState<CourseToTake[] | null>()
    const [showCompleted, setShowCompleted] = useState(false)

    const load = () => {
        if (!user) return
        void listCoursesForParticipant(user)
            .then(setCourses)
            .catch((error) => {
                console.error('Could not load courses.', error)
                setCourses(null)
            })
    }

    useEffect(() => {
        if (!user) return
        const timeout = window.setTimeout(load, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const todo = useMemo(() => (courses || [])
        .map((course, index) => ({ course, index }))
        .filter(({ course }) => course.status !== 'completed')
        .sort((left, right) => STATUS_ORDER[left.course.status] - STATUS_ORDER[right.course.status] || left.index - right.index)
        .map(({ course }) => course), [courses])
    const done = useMemo(() => (courses || []).filter((course) => course.status === 'completed'), [courses])

    if (courses === undefined) return <PageSkeleton variant="dashboard" label={t('Loading your courses')} />

    if (courses === null) {
        return (
            <DashboardPage className="incubatee-page incubatee-surveys-page incubatee-courses-page">
                <Alert type="error" showIcon message={t('Your courses could not be loaded.')} action={<Button onClick={() => { setCourses(undefined); load() }}>{t('Try again')}</Button>} />
            </DashboardPage>
        )
    }

    const total = courses.length
    const notStarted = todo.filter((course) => course.status === 'not started').length
    const inProgress = todo.length - notStarted
    const score = total ? Math.round((done.length / total) * 100) : 0
    const next = todo[0]

    const open = (course: CourseToTake) => navigate(`/incubatee/lms/${course.courseId}`)
    const actionLabel = (course: CourseToTake) => course.status === 'not started' ? t('Start') : course.status === 'in progress' ? t('Continue') : t('Review')

    const meta = (course: CourseToTake) => [
        course.category,
        course.lessonCount === 1 ? t('1 lesson') : t('{count} lessons', undefined, { count: course.lessonCount }),
        course.completedAt
            ? t('completed {date}', undefined, { date: dayjs(course.completedAt).format('D MMM') })
            : course.updatedAt ? t('saved {date}', undefined, { date: dayjs(course.updatedAt).format('D MMM') }) : '',
    ].filter(Boolean).join(' · ')

    const renderRow = (course: CourseToTake) => (
        <li key={course.courseId}>
            {/* The whole row opens the course; a separate small button is hard to hit on a phone. */}
            <button type="button" className={`surveys-row courses-row is-${toneOf(course.status)}`} onClick={() => open(course)} aria-label={`${actionLabel(course)}: ${course.title}`}>
                <span className="surveys-row-icon" aria-hidden="true">
                    {course.status === 'completed' ? <CheckCircleOutlined /> : course.status === 'in progress' ? <EditOutlined /> : <ReadOutlined />}
                </span>
                <span className="surveys-row-main">
                    <span className="surveys-row-title">
                        <Text strong>{course.title}</Text>
                        {course.status === 'in progress' && <Tag color="blue">{t('In progress')}</Tag>}
                    </span>
                    <Text type="secondary" className="surveys-row-meta">{meta(course)}</Text>
                </span>
                <span className="courses-row-action">
                    <span className="courses-row-label">{actionLabel(course)}</span>
                    <RightOutlined aria-hidden="true" />
                </span>
            </button>
        </li>
    )

    return (
        <DashboardPage className="incubatee-page incubatee-surveys-page incubatee-courses-page">
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
                            <Text strong>{t('Courses')}</Text>
                            <Text type="secondary" className="dashboard-metric-label">
                                {t('{done} of {total} completed', undefined, { done: done.length, total })}
                            </Text>
                        </div>
                    </div>
                </Card>
                <DashboardMetricCard icon={<ReadOutlined />} label={t('Not started')} value={notStarted} />
                <DashboardMetricCard icon={<EditOutlined />} label={t('In progress')} value={inProgress} />
                <DashboardMetricCard icon={<CheckCircleOutlined />} label={t('Completed')} value={done.length} />
            </section>

            {next ? (
                <section className={`surveys-next is-${toneOf(next.status)}`}>
                    <span className="surveys-next-eyebrow"><ArrowRightOutlined /> {t('Next step')}</span>
                    <div className="surveys-next-body">
                        <span className="surveys-next-icon" aria-hidden="true">{next.status === 'in progress' ? <EditOutlined /> : <ReadOutlined />}</span>
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
                            <Text strong className="surveys-next-title">{total ? t("You've finished all your courses") : t('No courses right now')}</Text>
                            <Text type="secondary">{t('New courses from your programme will appear here.')}</Text>
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

            {done.length > 0 && (
                <section className="surveys-group is-submitted">
                    <h3 className="surveys-group-head">
                        <CheckCircleOutlined aria-hidden="true" /> {t('Completed')}
                        <Button type="link" size="small" className="surveys-group-toggle" onClick={() => setShowCompleted((value) => !value)} icon={showCompleted ? <UpOutlined /> : <DownOutlined />} iconPlacement="end">
                            {showCompleted ? t('Hide') : t('Show {count}', undefined, { count: done.length })}
                        </Button>
                    </h3>
                    {showCompleted && <ul className="surveys-list">{done.map(renderRow)}</ul>}
                </section>
            )}
        </DashboardPage>
    )
}
