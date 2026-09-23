import { useEffect, useMemo, useState } from 'react'
import { App, Button, Empty, Result, Tag } from 'antd'
import { ArrowLeftOutlined, CheckOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import SurveyQuestionFrame from '@/components/surveys/SurveyQuestionFrame'
import LessonContent from '@/components/lms/LessonContent'
import { hasQuizAnswer, type LessonAnswers } from '@/lib/quizAnswers'
import { useFullscreenMobilePage } from '@/contexts/SystemLayoutTopbarContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    loadCourseForLesson,
    saveCourseProgress,
    type CourseProgressContext,
} from '@/services/courseProgressService'
import type { CourseLesson } from '@/services/courseTemplatesService'
import '@/styles/survey-response.css'
import '@/styles/course-lesson.css'

const LMS_PATH = '/incubatee/lms'

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

export default function CourseLessonPage() {
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { id } = useParams<{ id: string }>()

    // Taking a course is a phone-first, one-lesson-at-a-time flow: it owns its
    // own header and a bottom-docked action bar instead of the system chrome.
    useFullscreenMobilePage()

    const [context, setContext] = useState<CourseProgressContext | null>()
    const [answers, setAnswers] = useState<Record<string, LessonAnswers>>({})
    const [completedLessonIds, setCompletedLessonIds] = useState<string[]>([])
    const [index, setIndex] = useState(0)
    const [saving, setSaving] = useState(false)
    const [completed, setCompleted] = useState(false)
    const [finalScore, setFinalScore] = useState<{ correct: number; total: number }>()
    const [touched, setTouched] = useState(false)

    useEffect(() => {
        if (!user || !id) return
        void loadCourseForLesson(user, id)
            .then((loaded) => {
                if (!loaded) {
                    message.error('That course could not be found.')
                    navigate(LMS_PATH)
                    return
                }

                setContext(loaded)
                setAnswers(loaded.progress?.answers || {})
                setCompletedLessonIds(loaded.progress?.completedLessonIds || [])
                setIndex(Math.min(loaded.progress?.currentLessonIndex || 0, Math.max(0, loaded.lessons.length - 1)))
                setCompleted(loaded.progress?.status === 'completed')
                setFinalScore(loaded.progress?.score)
            })
            .catch(() => {
                message.error('The course could not be loaded.')
                setContext(null)
            })
    }, [user, id]) // eslint-disable-line react-hooks/exhaustive-deps

    const lessons = useMemo(() => context?.lessons || [], [context])
    const current = lessons[index]

    const setAnswer = (questionId: string, value: unknown) => {
        if (!current) return
        setTouched(false)
        setAnswers((previous) => ({ ...previous, [current.id]: { ...(previous[current.id] || {}), [questionId]: value } }))
    }

    const blocked = Boolean(current?.quiz?.some((question) => question.required && !hasQuizAnswer(answers[current.id]?.[question.id])))
    const isFirst = index === 0
    const isLast = index === lessons.length - 1

    const persist = async (status: 'in progress' | 'completed', ids: string[], score?: { correct: number; total: number }) => {
        if (!context || !user) return
        setSaving(true)
        try {
            const progressId = await saveCourseProgress({
                context,
                currentLessonIndex: index,
                completedLessonIds: ids,
                answers,
                score,
                status,
                user,
            })
            setContext({ ...context, progress: { ...(context.progress ?? {} as never), id: progressId, status, currentLessonIndex: index, completedLessonIds: ids, answers, score } as never })
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

        const ids = completedLessonIds.includes(current.id) ? completedLessonIds : [...completedLessonIds, current.id]
        setCompletedLessonIds(ids)

        if (isLast) {
            const score = scoreCourse(lessons, answers)
            setFinalScore(score)
            setCompleted(true)
            await persist('completed', ids, score)
            message.success('Course completed — nice work!')
            return
        }

        await persist('in progress', ids)
        setIndex((value) => Math.min(lessons.length - 1, value + 1))
    }

    const saveForLater = async () => {
        await persist('in progress', completedLessonIds)
        message.success('Progress saved. Pick up where you left off any time.')
    }

    const mobileHeader = (
        <div className="survey-response-mobile-header">
            <Button
                shape="circle"
                icon={<ArrowLeftOutlined />}
                className="survey-response-back-btn"
                onClick={() => navigate(LMS_PATH)}
                aria-label="Back to courses"
            />
            <span className="survey-response-mobile-title">{context?.template.title || 'Course'}</span>
            <span aria-hidden="true" />
        </div>
    )

    if (context === undefined) {
        return <DashboardPage className="incubatee-page survey-response-page">{mobileHeader}<MotionCard loading skeletonRows={6} /></DashboardPage>
    }

    if (!context) {
        return <DashboardPage className="incubatee-page survey-response-page">{mobileHeader}<Empty description="This course is not available." /></DashboardPage>
    }

    if (completed) {
        return (
            <DashboardPage className="incubatee-page survey-response-page">
                {mobileHeader}
                <MotionCard className="survey-response-card">
                    <Result
                        status="success"
                        title="Course completed"
                        subTitle={[
                            context.template.title,
                            context.progress?.completedAt ? `completed on ${dayjs(context.progress.completedAt).format('DD MMM YYYY')}` : 'completed',
                            finalScore?.total ? `— scored ${finalScore.correct}/${finalScore.total} on the quiz questions` : '',
                        ].filter(Boolean).join(' ')}
                        extra={<Button type="primary" onClick={() => navigate(LMS_PATH)}>Back to courses</Button>}
                    />
                </MotionCard>
            </DashboardPage>
        )
    }

    if (!lessons.length) {
        return (
            <DashboardPage className="incubatee-page survey-response-page">
                {mobileHeader}
                <MotionCard className="survey-response-card">
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="This course has no lessons yet." />
                </MotionCard>
            </DashboardPage>
        )
    }

    return (
        <DashboardPage className="incubatee-page survey-response-page">
            {mobileHeader}
            <MotionCard className="survey-response-card">
                <SurveyQuestionFrame
                    index={index}
                    total={lessons.length}
                    field={{ id: current.id, type: 'lesson', label: current.title || 'Untitled lesson' }}
                    answeredCount={completedLessonIds.length}
                    surveyTitle={context.template.title || 'Course'}
                    surveySubtitle={context.template.description}
                    extra={touched && blocked ? <Tag color="red">Answer the required question{current.quiz && current.quiz.length > 1 ? 's' : ''} to continue.</Tag> : undefined}
                    footer={
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
                                {isLast ? 'Complete course' : 'Next'}
                            </Button>
                        </div>
                    }
                >
                    <LessonContent lesson={current} answers={answers[current.id]} onAnswer={setAnswer} touched={touched} />
                </SurveyQuestionFrame>
            </MotionCard>
        </DashboardPage>
    )
}
