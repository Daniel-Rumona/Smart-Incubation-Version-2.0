import { useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react'
import { App, Button, Empty, Progress, Result, Skeleton, Tag, Tooltip, Typography } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, ClockCircleOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import LessonBody from '@/components/lms/LessonBody'
import LessonQuiz from '@/components/lms/LessonQuiz'
import LessonHelpChat from '@/components/lms/LessonHelpChat'
import LessonAiReview from '@/components/lms/LessonAiReview'
import { hasQuizAnswer, type LessonAnswers } from '@/lib/quizAnswers'
import { buildLessonSteps } from '@/lib/lessonSteps'
import { isAgentApiConfigured } from '@/config/agent'
import { useFullscreenMobilePage } from '@/contexts/SystemLayoutTopbarContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    loadCourseForLesson,
    saveCourseProgress,
    type CourseProgressContext,
    type StepStat,
} from '@/services/courseProgressService'
import type { CourseLesson } from '@/services/courseTemplatesService'
import '@/styles/survey-response.css'
import '@/styles/course-lesson.css'
import '@/styles/course-player.css'

const LMS_PATH = '/incubatee/lms'

const formatDuration = (seconds: number) => {
    const minutes = Math.floor(seconds / 60)
    const rest = seconds % 60
    return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/** Correct/total across every graded (non-text) quiz question in the course. */
const scoreCourse = (lessons: CourseLesson[], answers: Record<string, LessonAnswers>) => {
    let correct = 0
    let total = 0

    lessons.forEach((lesson) => {
        (lesson.quiz || []).forEach((question) => {
            if (question.type === 'text') return
            total += 1
            const given = answers[lesson.id]?.[question.id]
            const expected = new Set(question.correctOptions || [])
            const isCorrect = question.type === 'single'
                ? typeof given === 'string' && expected.has(given)
                : Array.isArray(given) && given.length === expected.size && given.every((value) => expected.has(value))
            if (isCorrect) correct += 1
        })
    })

    return { correct, total }
}

/**
 * Counts seconds on the current step, only while the tab is actually visible.
 * The running totals live in a ref owned by the page (so saving never waits on
 * a render) and this component only re-renders itself each second.
 */
const StepTimer = ({ stepId, stats }: { stepId: string, stats: MutableRefObject<Record<string, StepStat>> }) => {
    const [, setTick] = useState(0)

    useEffect(() => {
        const interval = window.setInterval(() => {
            if (document.hidden) return
            const current = stats.current[stepId] || { seconds: 0, interactive: false }
            stats.current[stepId] = { ...current, seconds: current.seconds + 1 }
            setTick((value) => value + 1)
        }, 1000)
        return () => window.clearInterval(interval)
    }, [stepId, stats])

    const stat = stats.current[stepId]

    return (
        <>
            <Tooltip title={stat?.interactive ? 'Interactive: you answered a question or talked to the AI in this section.' : 'Passive: so far you have only read or watched this section. Answering a question or asking the AI makes it interactive.'}>
                <Tag color={stat?.interactive ? 'purple' : 'default'} style={{ margin: 0 }}>{stat?.interactive ? 'Interactive' : 'Passive'}</Tag>
            </Tooltip>
            <span className="course-player-timer"><ClockCircleOutlined />{formatDuration(stat?.seconds || 0)}</span>
        </>
    )
}

export default function CourseLessonPage() {
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()

    // The player renders its own top bar and docked actions on every viewport.
    useFullscreenMobilePage()

    const [context, setContext] = useState<CourseProgressContext | null>()
    const [answers, setAnswers] = useState<Record<string, LessonAnswers>>({})
    const [completedStepIds, setCompletedStepIds] = useState<string[]>([])
    const [index, setIndex] = useState(0)
    const [saving, setSaving] = useState(false)
    const [completed, setCompleted] = useState(false)
    const [finalScore, setFinalScore] = useState<{ correct: number; total: number }>()
    const [touched, setTouched] = useState(false)
    const statsRef = useRef<Record<string, StepStat>>({})

    useEffect(() => {
        if (!user || !id) return
        void loadCourseForLesson(user, id)
            .then((loaded) => {
                if (!loaded) {
                    message.error('That course could not be found.')
                    navigate(LMS_PATH)
                    return
                }

                statsRef.current = { ...(loaded.progress?.stepStats || {}) }
                setContext(loaded)
                setAnswers(loaded.progress?.answers || {})
                setCompletedStepIds(loaded.progress?.completedLessonIds || [])
                setCompleted(loaded.progress?.status === 'completed')
                setFinalScore(loaded.progress?.score)

                // Steps recomputed here (rather than read from state) since this
                // runs before the `steps` memo below has anything to derive from.
                const loadedSteps = buildLessonSteps(loaded.lessons, { includeReview: isAgentApiConfigured })
                setIndex(Math.min(loaded.progress?.currentLessonIndex ?? 0, Math.max(0, loadedSteps.length - 1)))
            })
            .catch(() => {
                message.error('The course could not be loaded.')
                setContext(null)
            })
    }, [user, id]) // eslint-disable-line react-hooks/exhaustive-deps

    const lessons = useMemo(() => context?.lessons || [], [context])
    // Reviews only ever appear when the AI backend is actually reachable — a
    // course built with them enabled elsewhere still works fine without one.
    const steps = useMemo(() => buildLessonSteps(lessons, { includeReview: isAgentApiConfigured }), [lessons])
    const current = steps[index]

    const markInteractive = (stepId: string) => {
        const stat = statsRef.current[stepId] || { seconds: 0, interactive: false }
        if (!stat.interactive) statsRef.current[stepId] = { ...stat, interactive: true }
    }

    const setAnswer = (questionId: string, value: unknown) => {
        if (!current) return
        setTouched(false)
        if (hasQuizAnswer(value)) markInteractive(current.id)
        setAnswers((previous) => ({ ...previous, [current.lesson.id]: { ...(previous[current.lesson.id] || {}), [questionId]: value } }))
    }

    const blocked = Boolean(current?.kind === 'quiz'
        && current.lesson.quiz?.some((question) => question.required && !hasQuizAnswer(answers[current.lesson.id]?.[question.id])))
    const isFirst = index === 0
    const isLast = index === steps.length - 1

    const persist = async (status: 'in progress' | 'completed', ids: string[], score?: { correct: number; total: number }) => {
        if (!context || !user) return
        setSaving(true)
        try {
            const stepStats = { ...statsRef.current }
            const progressId = await saveCourseProgress({
                context,
                currentLessonIndex: index,
                completedLessonIds: ids,
                answers,
                score,
                stepStats,
                status,
                user,
            })
            setContext({ ...context, progress: { ...(context.progress ?? {} as never), id: progressId, status, currentLessonIndex: index, completedLessonIds: ids, answers, score, stepStats } as never })
        } catch {
            message.error('Your progress could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    const goNext = async () => {
        if (!current) return
        if (blocked) {
            setTouched(true)
            return
        }
        setTouched(false)

        const ids = completedStepIds.includes(current.id) ? completedStepIds : [...completedStepIds, current.id]
        setCompletedStepIds(ids)

        if (isLast) {
            const score = scoreCourse(lessons, answers)
            setFinalScore(score)
            setCompleted(true)
            await persist('completed', ids, score)
            message.success('Course completed — nice work!')
            return
        }

        await persist('in progress', ids)
        setIndex((value) => Math.min(steps.length - 1, value + 1))
    }

    const saveForLater = async () => {
        await persist('in progress', completedStepIds)
        message.success('Progress saved. Pick up where you left off any time.')
    }

    // Time spent is only worth keeping if it survives leaving, so save on the way out.
    const leave = async () => {
        if (context && !completed && steps.length) await persist('in progress', completedStepIds)
        navigate(LMS_PATH)
    }

    const shell = (heading: string, details: string, body: ReactNode, options?: { footer?: ReactNode, meta?: ReactNode, percent?: number }) => (
        <div className="course-player">
            <header className="course-player-top">
                <div className="course-player-top-row">
                    <Button shape="circle" icon={<ArrowLeftOutlined />} onClick={() => void leave()} aria-label="Back to courses" />
                    <div className="course-player-heading">
                        <strong>{heading}</strong>
                        <span>{details}</span>
                    </div>
                    <div className="course-player-meta">{options?.meta}</div>
                </div>
                <Progress percent={options?.percent ?? 0} showInfo={false} size="small" />
            </header>

            {body}

            {options?.footer && <footer className="course-player-dock">{options.footer}</footer>}
        </div>
    )

    if (context === undefined) {
        return shell('Loading course…', ' ', <div className="course-player-center"><Skeleton active paragraph={{ rows: 6 }} style={{ width: '100%' }} /></div>)
    }

    if (!context) {
        return shell('Course', ' ', <div className="course-player-center"><Empty description="This course is not available." /></div>)
    }

    if (completed) {
        const stats = Object.values(context.progress?.stepStats || {})
        const totalSeconds = stats.reduce((sum, stat) => sum + stat.seconds, 0)
        const interactiveCount = stats.filter((stat) => stat.interactive).length

        return shell(context.template.title || 'Course', 'Completed', (
            <div className="course-player-center">
                <Result
                    status="success"
                    title="Course completed"
                    subTitle={[
                        context.template.title,
                        context.progress?.completedAt ? `completed on ${dayjs(context.progress.completedAt).format('DD MMM YYYY')}` : 'completed',
                        finalScore?.total ? `— scored ${finalScore.correct}/${finalScore.total} on the quiz questions` : '',
                        totalSeconds ? `· ${Math.max(1, Math.round(totalSeconds / 60))} min spent, ${interactiveCount} interactive section${interactiveCount === 1 ? '' : 's'}` : '',
                    ].filter(Boolean).join(' ')}
                    extra={<Button type="primary" onClick={() => navigate(LMS_PATH)}>Back to courses</Button>}
                />
            </div>
        ), { percent: 100 })
    }

    if (!steps.length) {
        return shell(context.template.title || 'Course', ' ', <div className="course-player-center"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This course has no lessons yet." /></div>)
    }

    const lessonNumber = lessons.findIndex((lesson) => lesson.id === current.lesson.id) + 1
    const kindLabel = current.kind === 'quiz' ? 'Quiz' : current.kind === 'review' ? 'AI review' : 'Lesson'
    const stepTitle = current.kind === 'quiz'
        ? `${current.lesson.title || 'Lesson'} — Quiz`
        : current.kind === 'review'
            ? `${current.lesson.title || 'Lesson'} — Quick review`
            : current.lesson.title || 'Untitled lesson'

    return shell(
        context.template.title || 'Course',
        `Lesson ${lessonNumber} of ${lessons.length} · ${kindLabel} · Step ${index + 1} of ${steps.length}`,
        (
            <div className="course-player-scroll">
                <div className="course-player-step" key={current.id}>
                    <span className="course-player-eyebrow">{kindLabel}</span>
                    <Typography.Title level={2} className="course-player-title">{stepTitle}</Typography.Title>
                    {context.template.description && index === 0 && <Typography.Text type="secondary">{context.template.description}</Typography.Text>}

                    {current.kind === 'content' && (
                        <>
                            <LessonBody lesson={current.lesson} />
                            <div>
                                <LessonHelpChat course={context.template} lesson={current.lesson} business={context.business} onInteract={() => markInteractive(current.id)} />
                            </div>
                        </>
                    )}
                    {current.kind === 'quiz' && (
                        <>
                            {touched && blocked && <Tag color="red" style={{ width: 'fit-content' }}>Answer the required question{current.lesson.quiz && current.lesson.quiz.length > 1 ? 's' : ''} to continue.</Tag>}
                            <LessonQuiz lesson={current.lesson} answers={answers[current.lesson.id]} onAnswer={setAnswer} touched={touched} />
                        </>
                    )}
                    {current.kind === 'review' && (
                        <LessonAiReview course={context.template} lesson={current.lesson} business={context.business} onInteract={() => markInteractive(current.id)} />
                    )}
                </div>
            </div>
        ),
        {
            percent: Math.round((completedStepIds.length / steps.length) * 100),
            meta: <StepTimer key={current.id} stepId={current.id} stats={statsRef} />,
            footer: (
                <div className="survey-response-nav">
                    <Button
                        size="large"
                        icon={<ArrowLeftOutlined />}
                        disabled={isFirst}
                        onClick={() => { setTouched(false); setIndex((value) => Math.max(0, value - 1)) }}
                    >
                        Previous
                    </Button>

                    <Button size="large" icon={<SaveOutlined />} loading={saving} onClick={() => void saveForLater()}>
                        Save for later
                    </Button>

                    <Button size="large" type="primary" icon={isLast ? <CheckOutlined /> : undefined} loading={saving} onClick={() => void goNext()}>
                        {current.kind === 'review' ? 'Continue' : isLast ? 'Complete course' : 'Next'}
                    </Button>
                </div>
            ),
        },
    )
}
