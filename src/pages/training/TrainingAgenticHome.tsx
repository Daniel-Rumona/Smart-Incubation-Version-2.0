import { useEffect, useMemo, useRef, useState } from 'react'
import dayjs from 'dayjs'
import { Button, Input, Skeleton, Typography } from 'antd'
import { ClockCircleOutlined, FileDoneOutlined, LoadingOutlined, RightOutlined, RobotOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { AgentMessageContent } from '@/components/agent/AgentMessageContent'
import { TypingGreeting } from '@/components/agent/TypingGreeting'
import { useOpenWorkspace } from '@/contexts/WorkspaceShellContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useBackgroundTasks } from '@/providers/BackgroundTasksProvider'
import { useLanguage } from '@/providers/LanguageProvider'
import { listMyEnrolments, subscribeMySubmissions, type LearnerEnrolment } from '@/services/learnerTrainingService'
import { listClassSubmissions, listSubmissionsAwaitingMarking } from '@/services/trainingAssessmentService'
import { listClassGroups, listCompanyTrainingLearners, listTrainingClasses } from '@/services/trainingService'
import { classDatesLabel, classHoursLabel, classLocationLabel, classScheduleLines, classStatusLabel, hasMeetingLink } from '@/utils/trainingFormat'
import { classPhase, learnerMayStart, learnerResult, trainingDayOn } from '@/utils/trainingResults'
import type { AgentChatMessage, AgentPageContext } from '@/types/agent'
import type { FullIdentity } from '@/types/identity'
import { listMyCertificates } from '@/services/trainingCertificatesService'
import type { TrainingCertificate, TrainingClass, TrainingSubmission } from '@/types/training'
import '@/styles/agentic-home.css'

/**
 * The Agentic home for an awareness training company (its staff, when training is the company's home module) and
 * for its learners. Same look as the standard Agentic home, but the cards, suggestions and what the assistant is
 * told about are the training workspace: classes, marking and ID copies for staff; today's class, open assessments and
 * the ID copy for a learner.
 */

type Translate = ReturnType<typeof useLanguage>['t']

type HomeMetric = { key: string, label: string, value: string | number, detail: string, tone: 'amber' | 'blue' | 'violet', path: string }

type HomeData = {
    focus: string[]
    metrics: HomeMetric[]
    prompts: string[]
    page: Omit<AgentPageContext, 'updatedAt'>
}

const deliveryLabel = classLocationLabel

const classSummary = (trainingClass: TrainingClass, t: Translate) => ({
    course: trainingClass.courseTitle,
    dates: classDatesLabel(trainingClass),
    schedule: classScheduleLines(trainingClass, t),
    where: deliveryLabel(trainingClass, t),
    status: classStatusLabel(trainingClass, t),
})

const loadStaffHome = async (user: FullIdentity, t: Translate): Promise<HomeData> => {
    const [classes, learners, toMark] = await Promise.all([
        listTrainingClasses(user),
        listCompanyTrainingLearners(user),
        listSubmissionsAwaitingMarking(user),
    ])
    const current = classes
        .filter((trainingClass) => classPhase(trainingClass) !== 'finished')
        .sort((left, right) => left.startDate.localeCompare(right.startDate))[0]
    const latest = classes.find((trainingClass) => classPhase(trainingClass) !== 'upcoming') || classes[0]
    const idsToCheck = learners.filter((learner) => learner.idDocument?.status === 'pending')
    const firstToMark = toMark[0] && classes.find((trainingClass) => trainingClass.id === toMark[0].classId)

    // Results for the most recent class that has started, so "how did my last class do" has real answers.
    let latestResults: Record<string, unknown> | null = null
    if (latest) {
        const [submissions, groups] = await Promise.all([listClassSubmissions(user, latest.id), listClassGroups(user, latest.id)])
        const results = learners.filter((learner) => learner.classId === latest.id).map((learner) => learnerResult(latest, learner, submissions, groups))
        const organisations = [...new Set(results.map((result) => result.learner.organisation))]
        latestResults = {
            ...classSummary(latest, t),
            learners: results.length,
            passed: results.filter((result) => result.status === 'passed').length,
            byOrganisation: organisations.map((organisation) => {
                const own = results.filter((result) => result.learner.organisation === organisation)
                return {
                    organisation,
                    learners: own.length,
                    passed: own.filter((result) => result.status === 'passed').length,
                    awaitingMarking: own.filter((result) => result.status === 'awaiting_marking').length,
                    reassessmentAvailable: own.filter((result) => result.status === 'reassessment_available').length,
                }
            }),
        }
    }

    return {
        focus: [t('your classes'), t('marking'), t('results')],
        metrics: [
            {
                key: 'mark',
                label: t('Assessments to mark'),
                value: toMark.length,
                detail: toMark.length ? t('Handed in and waiting for you') : t('Nothing waiting'),
                tone: 'amber',
                path: firstToMark ? `/training/classes/${firstToMark.id}` : '/training/classes',
            },
            {
                key: 'next',
                // Short values fit the tile ("Day 1 of 3", "18 Nov"); the full dates go in the line under it.
                label: current && classPhase(current) === 'running' ? t('Ongoing class') : t('Next class'),
                value: current ? (classPhase(current) === 'running' ? classStatusLabel(current, t) : dayjs(current.startDate).format('D MMM')) : t('None planned'),
                detail: current ? [current.courseTitle, classDatesLabel(current), classHoursLabel(current, t), deliveryLabel(current, t)].filter(Boolean).join(' · ') : t('Create a class to get started'),
                tone: 'blue',
                path: current ? `/training/classes/${current.id}` : '/training/classes',
            },
            {
                key: 'ids',
                label: t('ID copies to check'),
                value: idsToCheck.length,
                detail: t('Uploaded and not yet verified'),
                tone: 'violet',
                path: '/training/classes',
            },
        ],
        prompts: [
            'Which assessments still need marking?',
            'Summarise the results of my latest class by organisation',
            'Which learners have not uploaded their ID copy?',
        ],
        page: {
            pageKey: 'training-agentic-home',
            pageName: 'Training overview',
            purpose: 'Command centre for an awareness training company: classes (in person or online), learners from client organisations, assessments to mark, ID copies and results.',
            metrics: { testsToMark: toMark.length, idCopiesToCheck: idsToCheck.length, classes: classes.length, learners: learners.length },
            dataSummary: {
                classes: classes.slice(0, 12).map((trainingClass) => ({
                    ...classSummary(trainingClass, t),
                    learners: learners.filter((learner) => learner.classId === trainingClass.id).length,
                    testsToMark: toMark.filter((submission) => submission.classId === trainingClass.id).length,
                })),
                learnersWithoutIdCopy: learners.filter((learner) => !learner.idDocument).map((learner) => ({ name: learner.name, organisation: learner.organisation })).slice(0, 40),
                latestClassResults: latestResults,
            },
        },
    }
}

const learnerHomeData = (enrolments: LearnerEnrolment[], submissions: TrainingSubmission[], certificates: TrainingCertificate[], t: Translate): HomeData => {
    const current = enrolments.find((enrolment) => classPhase(enrolment.trainingClass) !== 'finished') || enrolments[0]
    const certificate = current ? certificates.find((row) => row.learnerId === current.learner.id && row.status === 'valid') : undefined
    const today = current ? trainingDayOn(current.trainingClass) : null
    const signedIn = Boolean(current && today && current.learner.attendance[today]?.present)
    const own = current ? submissions.filter((submission) => submission.learnerId === current.learner.id) : []
    const openTests = current
        ? (['pre', 'post'] as const).filter((kind) => learnerMayStart(current.trainingClass, kind, own))
        : []
    const inProgress = own.find((submission) => submission.status === 'in_progress')
    const idStatus = current?.learner.idDocument?.status

    return {
        focus: [t('your training'), t('your assessments'), t('your certificate')],
        metrics: current ? [
            {
                key: 'today',
                label: today ? t('Today: day {day} of {days}', undefined, { day: today, days: current.trainingClass.dayCount }) : t('Your class'),
                value: today ? (signedIn ? t('Signed in') : t('Sign in')) : classDatesLabel(current.trainingClass),
                detail: `${current.trainingClass.courseTitle} · ${deliveryLabel(current.trainingClass, t)}`,
                tone: 'blue',
                path: '/learner',
            },
            {
                key: 'tests',
                label: t('Assessments'),
                value: inProgress ? t('Continue') : openTests.length ? t('Open') : t('None open'),
                detail: inProgress
                    ? t('You have an assessment in progress')
                    : openTests.includes('post') ? t('The post-assessment is open') : openTests.includes('pre') ? t('The pre-assessment is open') : t('Your facilitator opens each assessment in class'),
                tone: 'amber',
                path: inProgress ? `/learner/tests/${inProgress.id}` : '/learner',
            },
            certificate ? {
                key: 'certificate',
                label: t('Certificate'),
                value: certificate.certificateNumber,
                detail: t('Ready to download'),
                tone: 'violet',
                path: '/learner',
            } : {
                key: 'id',
                label: t('ID copy'),
                value: !idStatus ? t('Not uploaded') : idStatus === 'verified' ? t('Verified') : idStatus === 'queried' ? t('Needs attention') : t('Uploaded'),
                detail: idStatus === 'queried' ? current.learner.idDocument?.note || t('Please upload it again') : t('Needed for your training record'),
                tone: 'violet',
                path: '/learner',
            },
        ] : [],
        prompts: [
            'What do I need to do next?',
            'How do I join my class?',
            'How do I pass this course?',
        ],
        page: {
            pageKey: 'learner-agentic-home',
            pageName: 'My training overview',
            purpose: 'A learner\'s overview of their awareness training: their class, joining it, attendance sign-in, the assessments they write, their ID copy and their result.',
            dataSummary: {
                classes: enrolments.map((enrolment) => ({
                    ...classSummary(enrolment.trainingClass, t),
                    onlineMeetingAvailable: hasMeetingLink(enrolment.trainingClass),
                    passRule: {
                        postTestPassMarkPct: enrolment.trainingClass.passMarkPct,
                        reassessmentsAllowed: enrolment.trainingClass.reassessmentsAllowed,
                        groupAssignmentRequired: enrolment.trainingClass.groupAssignmentRequired,
                    },
                    daysSignedIn: Object.entries(enrolment.learner.attendance).filter(([, mark]) => mark.present).map(([day]) => day),
                    idCopy: enrolment.learner.idDocument?.status || 'not uploaded',
                })),
                today: today ? { day: today, signedIn } : null,
                tests: own.map((submission) => ({ kind: submission.kind, attempt: submission.attempt, status: submission.status, scorePct: submission.scorePct ?? null })),
                testsOpenNow: openTests,
                certificate: certificate ? { number: certificate.certificateNumber, issuedOn: certificate.issuedOn } : 'not issued yet (it is issued automatically on passing)',
                rule: 'Never give or hint at answers to assessment questions.',
            },
        },
    }
}

const makeMessage = (role: AgentChatMessage['role'], content: string): AgentChatMessage => ({
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
})

export const TrainingAgenticHome = () => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { queueTask } = useBackgroundTasks()
    const openWorkspace = useOpenWorkspace()
    const [data, setData] = useState<HomeData | null>(null)
    const [enrolments, setEnrolments] = useState<LearnerEnrolment[] | null>(null)
    const [submissions, setSubmissions] = useState<TrainingSubmission[]>([])
    const [certificates, setCertificates] = useState<TrainingCertificate[]>([])
    const [failed, setFailed] = useState(false)
    const [draft, setDraft] = useState('')
    const [messages, setMessages] = useState<AgentChatMessage[]>([])
    const composerRef = useRef<HTMLDivElement>(null)
    const isLearner = user?.role === 'learner'

    useEffect(() => {
        if (!user) return
        let cancelled = false
        const timeout = window.setTimeout(() => {
            const loading = isLearner
                ? Promise.all([listMyEnrolments(user), listMyCertificates(user).catch(() => [])]).then(([rows, mine]) => {
                    if (cancelled) return
                    setCertificates(mine)
                    setEnrolments(rows)
                })
                : loadStaffHome(user, t).then((home) => { if (!cancelled) setData(home) })
            void loading.catch(() => { if (!cancelled) setFailed(true) })
        }, 0)
        return () => {
            cancelled = true
            window.clearTimeout(timeout)
        }
    }, [isLearner, t, user])

    useEffect(() => {
        if (!user || !isLearner) return
        return subscribeMySubmissions(user, setSubmissions, () => setFailed(true))
    }, [isLearner, user])

    const home = useMemo(() => (isLearner ? (enrolments ? learnerHomeData(enrolments, submissions, certificates, t) : null) : data), [certificates, data, enrolments, isLearner, submissions, t])

    useEffect(() => {
        composerRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    }, [messages])

    const loading = !home && !failed
    const firstName = (user?.displayName || '').split(' ')[0]
    const conversing = messages.length > 0

    const send = (content = draft) => {
        const prompt = content.trim()
        if (!prompt || !home) return
        const pending = { ...makeMessage('agent', t('Working on this in the background…')), pending: true }
        const history = messages.filter((item) => !item.pending)
        setMessages((current) => [...current, makeMessage('user', prompt), pending])
        setDraft('')
        queueTask({
            prompt,
            page: { ...home.page, updatedAt: new Date().toISOString() },
            history,
            onCompleted: (result) => setMessages((current) => current.map((item) => item.id === pending.id ? { ...item, content: result, pending: false } : item)),
            onFailed: (error) => setMessages((current) => current.map((item) => item.id === pending.id ? { ...item, content: error, pending: false } : item)),
        })
    }

    const metrics = home?.metrics || []

    return (
        <main className={`agentic-home ${conversing ? 'is-conversing' : ''} ${!loading && metrics.length === 0 ? 'has-no-metrics' : ''}`}>
            {(loading || metrics.length > 0) && (
                <section className="agentic-summary" aria-label={t('Priority metrics')}>
                    <div className="agentic-metric-grid">
                        {loading
                            ? Array.from({ length: 3 }).map((_, index) => (
                                <div className="agentic-metric-card agentic-metric-card-skeleton" key={index}>
                                    <Skeleton.Avatar active shape="circle" size={38} />
                                    <div className="agentic-metric-skeleton-copy">
                                        <Skeleton.Input active size="small" className="agentic-metric-skeleton-label" />
                                        <Skeleton.Input active size="small" className="agentic-metric-skeleton-value" />
                                    </div>
                                </div>
                            ))
                            : metrics.map((metric) => (
                                <button type="button" className={`agentic-metric-card is-${metric.tone}`} key={metric.key} onClick={() => openWorkspace(metric.path)}>
                                    <div className="agentic-metric-icon">{metric.tone === 'amber' ? <ClockCircleOutlined /> : metric.tone === 'blue' ? <FileDoneOutlined /> : <ThunderboltOutlined />}</div>
                                    <div><span>{metric.label}</span><strong>{metric.value}</strong><small>{metric.detail}</small></div>
                                </button>
                            ))}
                    </div>
                </section>
            )}

            <section className={`agentic-command ${conversing ? 'has-conversation' : ''}`}>
                {!conversing && (
                    <>
                        <Typography.Title level={1}>
                            <TypingGreeting
                                lead={firstName ? t('{name}, ready to work on', undefined, { name: firstName }) : t('Ready to work on')}
                                words={home?.focus || [t('your training')]}
                            />
                        </Typography.Title>
                        <Typography.Paragraph>
                            {failed
                                ? t('Your training overview could not be loaded. You can still ask a question or open the workspace.')
                                : isLearner && enrolments?.length === 0
                                    ? t('You are not in a class yet. Your facilitator adds you to a class.')
                                    : t('Ask about your training, or start with a suggestion.')}
                        </Typography.Paragraph>
                    </>
                )}

                {conversing && (
                    <div className="agentic-conversation" aria-live="polite">
                        {messages.map((item) => (
                            <div className={`agentic-chat-message is-${item.role} ${item.pending ? 'is-pending' : ''}`} key={item.id}>
                                {item.role === 'agent' && <span><RobotOutlined /></span>}
                                {item.role === 'agent'
                                    ? <div className="agentic-message-content">
                                        {item.pending ? <span className="agentic-pending-copy"><LoadingOutlined spin />{item.content}</span> : <AgentMessageContent content={item.content} />}
                                    </div>
                                    : <p>{item.content}</p>}
                            </div>
                        ))}
                    </div>
                )}

                <div className="agentic-composer-dock">
                    {!conversing && home && (
                        <div className="agentic-suggestions">
                            {home.prompts.map((prompt) => (
                                <Button key={prompt} onClick={() => send(prompt)}>
                                    <span>{t(prompt)}</span>
                                    <RightOutlined className="agentic-suggestion-arrow" aria-hidden="true" />
                                </Button>
                            ))}
                        </div>
                    )}
                    <div className="agentic-composer" ref={composerRef}>
                        <Input
                            value={draft}
                            onChange={(event) => setDraft(event.target.value)}
                            onPressEnter={() => send()}
                            disabled={!home}
                            placeholder={isLearner ? t('Ask about your class, assessments or certificate…') : t('Ask about classes, marking, learners or results…')}
                        />
                        <Button type="primary" shape="circle" icon={<SendOutlined />} onClick={() => send()} disabled={!draft.trim() || !home} aria-label={t('Send message')} />
                    </div>
                </div>
            </section>
        </main>
    )
}
