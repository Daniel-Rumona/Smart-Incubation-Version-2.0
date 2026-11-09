import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Alert, App, Button, Checkbox, Empty, Space, Steps, Tag, Typography, Upload } from 'antd'
import { CheckCircleOutlined, EnvironmentOutlined, EyeOutlined, LoginOutlined, SafetyCertificateOutlined, UploadOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { PhaseTag } from '@/components/training/TrainingTags'
import { CertificateDownloadButton } from '@/components/training/CertificateDownloadButton'
import { LearnerDetailsCard } from '@/components/training/LearnerDetailsCard'
import { LibraryList } from '@/components/training/LibraryList'
import { MySurveysCard } from '@/components/training/MySurveysCard'
import { LEARNER_DETAIL_FIELDS, fieldsFor } from '@/config/trainingDetails'
import { getTrainingDetailsSettings } from '@/services/trainingDetailsService'
import { certificateVerifyUrl, listMyCertificates } from '@/services/trainingCertificatesService'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    getMyTrainingProviderName,
    listMyEnrolments,
    signInForDay,
    startMyTest,
    subscribeMySubmissions,
    uploadMyIdDocument,
    type LearnerEnrolment,
} from '@/services/learnerTrainingService'
import { ID_DOCUMENT_ACCEPT, idDocumentProblem, openIdDocument } from '@/services/trainingIdDocumentsService'
import { itemsForCourse, listTrainingLibrary } from '@/services/trainingLibraryService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { MEETING_PLATFORM_LABELS, detectMeetingPlatform } from '@/utils/meetingLinks'
import { classDatesLabel, classLocationLabel, classScheduleLines, hasMeetingLink, hoursLabel } from '@/utils/trainingFormat'
import { classPhase, hoursOfDay, learnerMayStart, trainingDayOn, trainingDays } from '@/utils/trainingResults'
import type { TrainingAttendanceMode, TrainingCertificate, TrainingLibraryItem, TrainingSubmission, TrainingTestKind } from '@/types/training'
import '@/styles/training.css'

/** A learner's own training: their class, joining it, signing in, their tests and their ID copy. */
export default function LearnerHomePage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [enrolments, setEnrolments] = useState<LearnerEnrolment[]>()
    const [submissions, setSubmissions] = useState<TrainingSubmission[]>([])
    const [providerName, setProviderName] = useState('')
    const [certificates, setCertificates] = useState<TrainingCertificate[]>([])
    const [library, setLibrary] = useState<TrainingLibraryItem[]>([])
    const [learnerFields, setLearnerFields] = useState<string[]>([])
    const [failed, setFailed] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [consented, setConsented] = useState<Record<string, boolean>>({})

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [rows, provider, mine, shared] = await Promise.all([
                listMyEnrolments(user),
                getMyTrainingProviderName(user).catch(() => ''),
                listMyCertificates(user).catch(() => []),
                listTrainingLibrary(user).catch(() => []),
            ])
            setLearnerFields((await getTrainingDetailsSettings(user).catch(() => null))?.learnerFields || [])
            setEnrolments(rows)
            setProviderName(provider)
            setCertificates(mine)
            setLibrary(shared)
            setFailed(false)
        } catch {
            setFailed(true)
            setEnrolments([])
        }
    }, [user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    useEffect(() => {
        if (!user) return
        return subscribeMySubmissions(user, setSubmissions, () => setFailed(true))
    }, [user])

    const provider = providerName || t('your training provider')

    useRegisterAgentPageContext({
        pageKey: 'learner-training',
        pageName: 'My training',
        purpose: 'A learner\'s own awareness training: joining the class, signing in for each day, writing the pre-assessment and post-assessment, uploading their ID copy, and their results.',
        dataSummary: {
            classes: (enrolments || []).map(({ learner, trainingClass }) => ({
                course: trainingClass.courseTitle,
                dates: classDatesLabel(trainingClass),
                delivery: trainingClass.deliveryMode === 'online'
                    ? `Online (${MEETING_PLATFORM_LABELS[detectMeetingPlatform(trainingClass.meetingUrl)]})`
                    : trainingClass.deliveryMode === 'hybrid'
                        ? `In person at ${trainingClass.venue}, or online (${MEETING_PLATFORM_LABELS[detectMeetingPlatform(trainingClass.meetingUrl)]})`
                        : `In person at ${trainingClass.venue}`,
                schedule: classScheduleLines(trainingClass, t),
                passMarkPct: trainingClass.passMarkPct,
                groupAssignmentRequired: trainingClass.groupAssignmentRequired,
                testsOpen: trainingClass.testsOpen,
                idCopy: learner.idDocument?.status || 'not uploaded',
                courseMaterials: itemsForCourse(library, trainingClass.courseTitle).map((item) => ({ title: item.title, description: item.description })),
                certificate: certificates.find((row) => row.learnerId === learner.id && row.status === 'valid')?.certificateNumber || null,
                tests: submissions.filter((submission) => submission.learnerId === learner.id).map((submission) => ({ kind: submission.kind, attempt: submission.attempt, status: submission.status, scorePct: submission.scorePct ?? null })),
            })),
            rule: 'Never give or hint at answers to assessment questions.',
        },
    })

    const signIn = async (enrolment: LearnerEnrolment, day: string, mode?: TrainingAttendanceMode) => {
        if (!user) return
        setBusy(`signin:${enrolment.learner.id}:${mode || ''}`)
        try {
            await signInForDay(user, enrolment.learner, day, mode)
            message.success(t('You are signed in for day {day}.', undefined, { day }))
            await load()
        } catch {
            message.error(t('You could not be signed in. Please tell your facilitator.'))
        } finally {
            setBusy(null)
        }
    }

    const start = async (enrolment: LearnerEnrolment, kind: TrainingTestKind) => {
        if (!user) return
        setBusy(`test:${enrolment.learner.id}:${kind}`)
        try {
            const id = await startMyTest(user, enrolment, kind, submissions)
            navigate(`/learner/tests/${id}`)
        } catch {
            message.error(t('The assessment could not be started. Please tell your facilitator.'))
            setBusy(null)
        }
    }

    const upload = async (enrolment: LearnerEnrolment, file: File) => {
        if (!user) return
        const problem = idDocumentProblem(file)
        if (problem) {
            message.error(problem === 'size' ? t('The file is larger than 10 MB.') : t('Upload a PDF or a photo (JPG, PNG or WEBP).'))
            return
        }
        setBusy(`id:${enrolment.learner.id}`)
        try {
            await uploadMyIdDocument(user, enrolment.learner, file)
            message.success(t('Your ID copy was uploaded.'))
            await load()
        } catch {
            message.error(t('Your ID copy could not be uploaded.'))
        } finally {
            setBusy(null)
        }
    }

    const view = async (enrolment: LearnerEnrolment) => {
        if (!enrolment.learner.idDocument) return
        try {
            await openIdDocument(enrolment.learner.idDocument)
        } catch {
            message.error(t('The file could not be opened.'))
        }
    }

    const ordered = useMemo(() => [...(enrolments || [])].sort((left, right) => {
        const rank = (enrolment: LearnerEnrolment) => ({ running: 0, upcoming: 1, finished: 2 }[classPhase(enrolment.trainingClass)])
        return rank(left) - rank(right)
    }), [enrolments])

    if (!enrolments) return <PageSkeleton variant="detail" label={t('Loading your training')} />

    if (!ordered.length) {
        return (
            <DashboardPage className="training-page">
                <MotionCard>
                    {failed
                        ? <Alert type="error" showIcon message={t('Your training could not be loaded. Refresh the page to try again.')} />
                        : <Empty description={t('You are not in a class yet. Your facilitator adds you to a class.')} />}
                </MotionCard>
            </DashboardPage>
        )
    }

    const testRow = (enrolment: LearnerEnrolment, kind: TrainingTestKind) => {
        const own = submissions.filter((submission) => submission.learnerId === enrolment.learner.id && submission.kind === kind)
        const open = own.find((submission) => submission.status === 'in_progress')
        const canStart = learnerMayStart(enrolment.trainingClass, kind, own)
        const label = kind === 'pre' ? t('Pre-assessment') : t('Post-assessment')
        return (
            <div className="learner-test-row" key={kind}>
                <Space orientation="vertical" size={2}>
                    <Typography.Text strong>{label}</Typography.Text>
                    {kind === 'pre' && <Typography.Text type="secondary">{t('Shows what you already know. It does not count.')}</Typography.Text>}
                    <Space wrap size={[6, 6]}>
                        {own.map((submission) => (
                            <Tag key={submission.id} color={submission.status === 'marked' ? 'green' : submission.status === 'submitted' ? 'gold' : 'blue'}>
                                {kind === 'post' && submission.attempt > 1 ? `${t('Reassessment {n}', undefined, { n: submission.attempt - 1 })}: ` : ''}
                                {submission.status === 'marked'
                                    ? `${submission.score}/${submission.totalMarks} (${submission.scorePct}%)`
                                    : submission.status === 'submitted' ? t('Handed in, awaiting marking') : t('In progress')}
                            </Tag>
                        ))}
                        {!own.length && !canStart && <Typography.Text type="secondary">{t('Opens when your facilitator starts it in class.')}</Typography.Text>}
                    </Space>
                </Space>
                {open ? (
                    <Button type="primary" onClick={() => navigate(`/learner/tests/${open.id}`)}>{t('Continue')}</Button>
                ) : canStart && (
                    <Button type="primary" loading={busy === `test:${enrolment.learner.id}:${kind}`} disabled={!(kind === 'pre' ? enrolment.preAssessment : enrolment.assessment)} onClick={() => void start(enrolment, kind)}>
                        {own.length ? t('Start reassessment') : t('Start {test}', undefined, { test: label.toLowerCase() })}
                    </Button>
                )}
            </div>
        )
    }

    return (
        <DashboardPage className="training-page">
            {failed && <Alert type="warning" showIcon closable style={{ marginBottom: 12 }} message={t('Some of your training details could not be loaded. Refresh the page to try again.')} />}
            {(() => {
                const asked = fieldsFor(LEARNER_DETAIL_FIELDS, learnerFields)
                const records = ordered.map((enrolment) => enrolment.learner)
                const missing = asked.filter((field) => !records.some((learner) => learner.details?.[field.key] !== undefined && learner.details?.[field.key] !== ''))
                return missing.length > 0 && <LearnerDetailsCard learners={records} fields={asked} provider={provider} onSaved={() => void load()} />
            })()}
            <div style={{ marginBottom: 14 }}><MySurveysCard basePath="/learner/surveys" classIds={ordered.map((enrolment) => enrolment.trainingClass.id)} /></div>
            {ordered.map((enrolment) => {
                const { learner, trainingClass } = enrolment
                const today = trainingDayOn(trainingClass)
                const signedInToday = Boolean(today && learner.attendance[today]?.present)
                const hybrid = trainingClass.deliveryMode === 'hybrid'
                const platform = MEETING_PLATFORM_LABELS[detectMeetingPlatform(trainingClass.meetingUrl)]
                const todayHours = today ? hoursLabel(hoursOfDay(trainingClass, today)) : ''
                const signInButton = (label: string, icon: ReactNode, mode?: TrainingAttendanceMode) => (
                    <Button icon={icon} loading={busy === `signin:${learner.id}:${mode || ''}`} disabled={Boolean(busy?.startsWith(`signin:${learner.id}`))} onClick={() => today && void signIn(enrolment, today, mode)}>
                        {label}
                    </Button>
                )
                const idDocument = learner.idDocument
                return (
                    <Space key={learner.id} orientation="vertical" size={14} style={{ width: '100%', marginBottom: 20 }}>
                        <MotionCard>
                            <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                                <Space wrap>
                                    <Typography.Title level={4} style={{ margin: 0 }}>{trainingClass.courseTitle}</Typography.Title>
                                    <PhaseTag phase={classPhase(trainingClass)} trainingClass={trainingClass} />
                                </Space>
                                <Typography.Text type="secondary">
                                    {[classDatesLabel(trainingClass), today ? todayHours && t('Today {hours}', undefined, { hours: todayHours }) : hoursLabel(trainingClass.hours), trainingClass.deliveryMode === 'online' ? t('Online on {platform}', undefined, { platform: t(platform) }) : classLocationLabel(trainingClass, t)].filter(Boolean).join(' · ')}
                                </Typography.Text>
                                {hybrid && <Typography.Text type="secondary">{t('Come to the venue, or join online if you cannot be there.')}</Typography.Text>}
                                <Space wrap>
                                    {hasMeetingLink(trainingClass) && (
                                        <Button type="primary" icon={<VideoCameraOutlined />} href={trainingClass.meetingUrl} target="_blank" rel="noopener noreferrer">
                                            {t('Join on {platform}', undefined, { platform: t(platform) })}
                                        </Button>
                                    )}
                                    {today && (signedInToday
                                        ? <Tag icon={<CheckCircleOutlined />} color="green">
                                            {hybrid
                                                ? t('Signed in for day {day} ({how})', undefined, { day: today, how: learner.attendance[today]?.mode === 'online' ? t('online') : t('in person') })
                                                : t('Signed in for day {day}', undefined, { day: today })}
                                        </Tag>
                                        : hybrid
                                            ? <>
                                                {signInButton(t('Sign in: I am at the venue'), <EnvironmentOutlined />, 'in_person')}
                                                {signInButton(t('Sign in: I joined online'), <VideoCameraOutlined />, 'online')}
                                            </>
                                            : signInButton(t('Sign in for day {day}', undefined, { day: today }), <LoginOutlined />))}
                                </Space>
                            </Space>
                        </MotionCard>

                        <MotionCard title={t('Attendance')}>
                            <Steps
                                size="small"
                                responsive
                                items={trainingDays(trainingClass.dayCount).map((day) => ({
                                    title: t('Day {day}', undefined, { day }),
                                    description: [dayjs(trainingClass.startDate).add(Number(day) - 1, 'day').format('ddd D MMM'), hoursLabel(hoursOfDay(trainingClass, day))].filter(Boolean).join(' · '),
                                    status: learner.attendance[day]?.present ? 'finish' : today === day ? 'process' : 'wait',
                                }))}
                            />
                        </MotionCard>

                        <MotionCard title={t('Assessments')}>
                            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                                {!enrolment.assessment && <Alert type="info" showIcon message={t('Your facilitator has not set up the assessment for this class yet.')} />}
                                {testRow(enrolment, 'pre')}
                                {testRow(enrolment, 'post')}
                                <Typography.Text type="secondary">
                                    {trainingClass.groupAssignmentRequired
                                        ? t('To pass: at least {pct}% in the post-assessment, and take part in the group assignment.', undefined, { pct: trainingClass.passMarkPct })
                                        : t('To pass: at least {pct}% in the post-assessment.', undefined, { pct: trainingClass.passMarkPct })}
                                </Typography.Text>
                            </Space>
                        </MotionCard>

                        {itemsForCourse(library, trainingClass.courseTitle).length > 0 && (
                            <MotionCard title={t('Course materials')}>
                                <LibraryList items={itemsForCourse(library, trainingClass.courseTitle)} emptyText={t('No course materials yet.')} />
                            </MotionCard>
                        )}

                        <MotionCard title={t('Certificate')}>
                            {(() => {
                                const certificate = certificates.find((row) => row.learnerId === learner.id && row.status === 'valid')
                                if (!certificate) return <Typography.Text type="secondary">{t('Your certificate of completion appears here as soon as you pass.')}</Typography.Text>
                                return (
                                    <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                                        <Space wrap>
                                            <Tag icon={<SafetyCertificateOutlined />} color="green">{certificate.certificateNumber}</Tag>
                                            <Typography.Text type="secondary">{t('Issued {date}', undefined, { date: dayjs(certificate.issuedOn).format('D MMMM YYYY') })}</Typography.Text>
                                        </Space>
                                        <Space wrap>
                                            <CertificateDownloadButton certificate={certificate} type="primary" />
                                            <Button href={certificateVerifyUrl(certificate.id)} target="_blank" rel="noopener noreferrer">{t('Verification page')}</Button>
                                        </Space>
                                    </Space>
                                )
                            })()}
                        </MotionCard>

                        <MotionCard title={t('ID copy')}>
                            <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                                {idDocument ? (
                                    <Space wrap>
                                        <Tag color={idDocument.status === 'verified' ? 'green' : idDocument.status === 'queried' ? 'red' : 'gold'}>
                                            {idDocument.status === 'verified' ? t('Verified') : idDocument.status === 'queried' ? t('Needs attention') : t('Uploaded, waiting for your facilitator to check it')}
                                        </Tag>
                                        <Button size="small" icon={<EyeOutlined />} onClick={() => void view(enrolment)}>{t('View')}</Button>
                                    </Space>
                                ) : (
                                    <Typography.Text>{t('Upload a copy of your ID document or passport for your training record.')}</Typography.Text>
                                )}
                                {idDocument?.status === 'queried' && idDocument.note && <Alert type="warning" showIcon message={idDocument.note} />}
                                {idDocument?.status !== 'verified' && (
                                    <>
                                        <Checkbox
                                            checked={consented[learner.id] === true}
                                            onChange={(event) => setConsented((current) => ({ ...current, [learner.id]: event.target.checked }))}
                                        >
                                            {t('I agree that {provider} may keep a copy of my ID document for my training record.', undefined, { provider })}
                                        </Checkbox>
                                        <Upload
                                            accept={ID_DOCUMENT_ACCEPT}
                                            showUploadList={false}
                                            disabled={consented[learner.id] !== true}
                                            beforeUpload={(file) => { void upload(enrolment, file); return false }}
                                        >
                                            <Button icon={<UploadOutlined />} disabled={consented[learner.id] !== true} loading={busy === `id:${learner.id}`}>
                                                {idDocument ? t('Upload again') : t('Upload ID copy')}
                                            </Button>
                                        </Upload>
                                    </>
                                )}
                            </Space>
                        </MotionCard>
                    </Space>
                )
            })}
        </DashboardPage>
    )
}
