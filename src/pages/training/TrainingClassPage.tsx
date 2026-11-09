import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Col, Result, Row, Segmented, Space, Typography } from 'antd'
import { ArrowLeftOutlined, BankOutlined, CheckCircleOutlined, EditOutlined, FormOutlined, TeamOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { MotionCard } from '@/components/shared/MotionCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { AttendancePanel } from '@/components/training/AttendancePanel'
import { GroupsPanel } from '@/components/training/GroupsPanel'
import { LearnersPanel } from '@/components/training/LearnersPanel'
import { ResultsPanel } from '@/components/training/ResultsPanel'
import { TestsPanel } from '@/components/training/TestsPanel'
import { TrainingClassFormModal } from '@/components/training/TrainingClassFormModal'
import { PhaseTag } from '@/components/training/TrainingTags'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    getTrainingAssessment,
    getTrainingAssessmentMemo,
    listTrainingAssessments,
    subscribeClassSubmissions,
} from '@/services/trainingAssessmentService'
import { getTrainingClass, subscribeClassGroups, subscribeClassLearners } from '@/services/trainingService'
import { issueTrainingCertificate, subscribeClassCertificates, type CertificateIssueDetails } from '@/services/trainingCertificatesService'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel, classHoursLabel, classLocationLabel, classScheduleLines, hasMeetingLink, organisationsOf } from '@/utils/trainingFormat'
import { assessmentIdFor, classPhase, learnerResult } from '@/utils/trainingResults'
import { MEETING_PLATFORM_LABELS, detectMeetingPlatform } from '@/utils/meetingLinks'
import type {
    TrainingAssessment,
    TrainingCertificate,
    TrainingClass,
    TrainingGroup,
    TrainingLearner,
    TrainingSubmission,
} from '@/types/training'
import '@/styles/training.css'

type ViewKey = 'learners' | 'attendance' | 'tests' | 'groups' | 'results'

const VIEW_STORAGE_KEY = 'smartv2.training.classView'

const readStoredView = (): ViewKey => {
    try {
        const stored = sessionStorage.getItem(VIEW_STORAGE_KEY)
        return stored === 'attendance' || stored === 'tests' || stored === 'groups' || stored === 'results' ? stored : 'learners'
    } catch {
        return 'learners'
    }
}

export default function TrainingClassPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { classId = '' } = useParams()

    const [trainingClass, setTrainingClass] = useState<TrainingClass | null>()
    // The post-assessment (it also holds the group rubric), the pre-assessment, and the memo of each by assessment id.
    const [assessment, setAssessment] = useState<TrainingAssessment | null>(null)
    const [preAssessment, setPreAssessment] = useState<TrainingAssessment | null>(null)
    const [assessments, setAssessments] = useState<TrainingAssessment[]>([])
    const [memos, setMemos] = useState<Record<string, Record<string, string>>>({})
    const [learners, setLearners] = useState<TrainingLearner[]>()
    const [submissions, setSubmissions] = useState<TrainingSubmission[]>([])
    const [groups, setGroups] = useState<TrainingGroup[]>([])
    const [certificates, setCertificates] = useState<TrainingCertificate[]>()
    const [liveError, setLiveError] = useState(false)
    const { settings } = useSystemSettings()
    const issuing = useRef(new Set<string>())
    const [view, setView] = useState<ViewKey>(readStoredView)
    const [editingClass, setEditingClass] = useState(false)

    const loadClass = useCallback(async () => {
        if (!user || !classId) return
        try {
            const found = await getTrainingClass(user, classId)
            setTrainingClass(found)
            if (!found) return
            const ids = [...new Set([found.assessmentId, assessmentIdFor(found, 'pre')].filter((id): id is string => Boolean(id)))]
            const [all, loaded] = await Promise.all([
                listTrainingAssessments(user),
                Promise.all(ids.map(async (id) => [id, await getTrainingAssessment(user, id), await getTrainingAssessmentMemo(user, id)] as const)),
            ])
            const byId = new Map(loaded.map(([id, found]) => [id, found]))
            const preId = assessmentIdFor(found, 'pre')
            setAssessment(found.assessmentId ? byId.get(found.assessmentId) || null : null)
            setPreAssessment(preId ? byId.get(preId) || null : null)
            setAssessments(all)
            setMemos(Object.fromEntries(loaded.map(([id, , memo]) => [id, memo])))
        } catch {
            setTrainingClass(null)
            message.error(t('The class could not be loaded.'))
        }
    }, [classId, message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void loadClass(), 0)
        return () => window.clearTimeout(timeout)
    }, [loadClass])

    // Learners, test attempts and groups stay live: several people may mark the register or tests during a class.
    useEffect(() => {
        if (!user || !trainingClass) return
        const onError = () => setLiveError(true)
        const unsubscribers = [
            subscribeClassLearners(user, trainingClass.id, setLearners, onError),
            subscribeClassSubmissions(user, trainingClass.id, setSubmissions, onError),
            subscribeClassGroups(user, trainingClass.id, setGroups, onError),
            subscribeClassCertificates(user, trainingClass.id, setCertificates, onError),
        ]
        return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
    }, [trainingClass, user])

    const changeView = (next: ViewKey) => {
        setView(next)
        try { sessionStorage.setItem(VIEW_STORAGE_KEY, next) } catch { /* the view choice is a convenience only */ }
    }

    const results = useMemo(
        () => (trainingClass && learners ? learners.map((learner) => learnerResult(trainingClass, learner, submissions, groups)) : []),
        [groups, learners, submissions, trainingClass],
    )
    const organisations = useMemo(() => organisationsOf(learners || []), [learners])
    const passed = results.filter((result) => result.status === 'passed').length

    /** What a certificate issued now prints: the class, the company's name and logo, and (via the issuer) her signature. */
    const certificateDetails = useMemo<CertificateIssueDetails | null>(() => trainingClass ? {
        trainingClass,
        trainingDates: classDatesLabel(trainingClass),
        deliveryLabel: trainingClass.deliveryMode === 'online'
            ? `Online via ${MEETING_PLATFORM_LABELS[detectMeetingPlatform(trainingClass.meetingUrl)]}`
            : trainingClass.deliveryMode === 'hybrid'
                ? `${trainingClass.venue} and online via ${MEETING_PLATFORM_LABELS[detectMeetingPlatform(trainingClass.meetingUrl)]}`
                : trainingClass.venue,
        providerName: String(settings.companyName || settings.name || '').trim(),
        logoUrl: typeof settings.logoUrl === 'string' && settings.logoUrl ? settings.logoUrl : undefined,
        // Only set once the recognising body has given written permission to use its logo.
        partnerLogoUrl: typeof settings.trainingCertificatePartnerLogoUrl === 'string' && settings.trainingCertificatePartnerLogoUrl
            ? settings.trainingCertificatePartnerLogoUrl
            : undefined,
    } : null, [settings, trainingClass])

    // A learner who meets the pass rule gets their certificate straight away, without anyone having to issue it.
    useEffect(() => {
        if (!user || !certificateDetails || !certificates) return
        const due = results.filter((result) => result.status === 'passed'
            && !certificates.some((certificate) => certificate.learnerId === result.learner.id && certificate.status === 'valid')
            && !issuing.current.has(result.learner.id))
        due.forEach((result) => {
            issuing.current.add(result.learner.id)
            void issueTrainingCertificate(user, result.learner, certificateDetails)
                .then((id) => { if (id) message.success(t('{name} passed. Their certificate has been issued.', undefined, { name: result.learner.name })) })
                .catch(() => message.error(t('The certificate for {name} could not be issued. It will be tried again.', undefined, { name: result.learner.name })))
                .finally(() => issuing.current.delete(result.learner.id))
        })
    }, [certificateDetails, certificates, message, results, t, user])
    const toMark = submissions.filter((submission) => submission.status === 'submitted').length
    // Some courses have no group assignment: not needed to pass, no rubric to mark against and no groups made.
    const hasGroupWork = Boolean(trainingClass?.groupAssignmentRequired) || (assessment?.rubric?.length || 0) > 0 || groups.length > 0
    const shownView: ViewKey = view === 'groups' && !hasGroupWork ? 'learners' : view

    useRegisterAgentPageContext({
        pageKey: 'training-class',
        pageName: 'Training class',
        purpose: 'Run one training class (in person, online or both): learners and their organisations, the daily attendance register, pre- and post-assessments marked against the memo, group assignments and results.',
        currentFilters: { view },
        metrics: { learners: learners?.length ?? 0, organisations: organisations.length, passed, testsToMark: toMark },
        dataSummary: trainingClass ? {
            course: trainingClass.courseTitle,
            dates: classDatesLabel(trainingClass),
            schedule: classScheduleLines(trainingClass, t),
            where: classLocationLabel(trainingClass, t),
            passMarkPct: trainingClass.passMarkPct,
            reassessmentsAllowed: trainingClass.reassessmentsAllowed,
            groupAssignmentRequired: trainingClass.groupAssignmentRequired,
            assessment: assessment?.title || null,
            preAssessment: preAssessment?.title || null,
            results: results.map((result) => ({ organisation: result.learner.organisation, status: result.status, postScorePct: result.postScorePct ?? null })),
            certificatesIssued: (certificates || []).filter((certificate) => certificate.status === 'valid').length,
            certificateRule: 'Issued automatically when a learner passes; the facilitator can reissue or cancel one.',
        } : {},
        allowedActions: [
            { key: 'add_learner', label: 'Add learner', description: 'Add a learner with their organisation, email and ID or passport number.' },
            { key: 'record_attendance', label: 'Record attendance', description: 'Mark a learner present or absent for a training day, with a remark.' },
            { key: 'mark_test', label: 'Mark assessment', description: 'Mark a pre-assessment or post-assessment against the memo, or record an assessment written on paper.' },
            { key: 'mark_group', label: 'Mark group', description: 'Create groups and mark their case assignment against the rubric.' },
            { key: 'remove_learner', label: 'Remove learner', description: 'Remove a learner with their attendance and assessment attempts.', requiresConfirmation: true },
        ],
    })

    if (trainingClass === undefined) return <PageSkeleton variant="detail" label={t('Loading class')} />

    if (trainingClass === null) {
        return (
            <Result
                status="404"
                title={t('Class not found')}
                subTitle={t('It may have been deleted, or it belongs to another workspace.')}
                extra={<Button type="primary" onClick={() => navigate('/training/classes')}>{t('Back to classes')}</Button>}
            />
        )
    }

    const loading = learners === undefined

    return (
        <DashboardPage className="training-page">
            <MotionCard className="training-class-header">
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                    <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/training/classes')} className="training-back-link">
                        {t('All classes')}
                    </Button>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                        <Space wrap>
                            <Typography.Title level={4} style={{ margin: 0 }}>{trainingClass.courseTitle}</Typography.Title>
                            <PhaseTag phase={classPhase(trainingClass)} trainingClass={trainingClass} />
                        </Space>
                        <Space wrap>
                            {hasMeetingLink(trainingClass) && (
                                <Button type="primary" icon={<VideoCameraOutlined />} href={trainingClass.meetingUrl} target="_blank" rel="noopener noreferrer">
                                    {t('Join meeting')}
                                </Button>
                            )}
                            <Button icon={<EditOutlined />} onClick={() => setEditingClass(true)}>{t('Edit class')}</Button>
                        </Space>
                    </Space>
                    <Typography.Text type="secondary">
                        {[classDatesLabel(trainingClass), classHoursLabel(trainingClass, t), classLocationLabel(trainingClass, t), preAssessment && assessment && preAssessment.id !== assessment.id
                            ? t('Pre: {pre} · Post: {post}', undefined, { pre: preAssessment.title, post: assessment.title })
                            : assessment ? assessment.title : t('No assessment chosen')].filter(Boolean).join(' · ')}
                    </Typography.Text>
                    {trainingClass.dayHours && (
                        <Typography.Text type="secondary">{classScheduleLines(trainingClass, t).join('   |   ')}</Typography.Text>
                    )}
                </Space>
            </MotionCard>

            {liveError && (
                <Alert type="warning" showIcon closable style={{ marginBottom: 12 }} message={t('Live updates stopped. Refresh the page to see the latest register and marks.')} />
            )}

            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Learners')} value={learners?.length ?? 0} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<BankOutlined />} label={t('Organisations')} value={organisations.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<FormOutlined />} label={t('Assessments to mark')} value={toMark} clickable onClick={() => changeView('tests')} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} label={t('Passed')} value={`${passed}/${results.length}`} clickable onClick={() => changeView('results')} /></Col>
            </Row>

            <MotionCard>
                <Segmented
                    block
                    value={shownView}
                    onChange={(value) => changeView(value as ViewKey)}
                    options={[
                        { value: 'learners', label: t('Learners') },
                        { value: 'attendance', label: t('Attendance') },
                        { value: 'tests', label: t('Assessments') },
                        ...(hasGroupWork ? [{ value: 'groups', label: t('Group assignment') }] : []),
                        { value: 'results', label: t('Results') },
                    ]}
                    style={{ marginBottom: 16 }}
                />
                {shownView === 'learners' && <LearnersPanel trainingClass={trainingClass} learners={learners || []} results={results} loading={loading} />}
                {shownView === 'attendance' && <AttendancePanel trainingClass={trainingClass} learners={learners || []} loading={loading} />}
                {shownView === 'tests' && (
                    <TestsPanel
                        trainingClass={trainingClass}
                        assessments={{ pre: preAssessment, post: assessment }}
                        memos={memos}
                        results={results}
                        submissions={submissions}
                        loading={loading}
                        onEditClass={() => setEditingClass(true)}
                        onClassChanged={() => void loadClass()}
                    />
                )}
                {shownView === 'groups' && <GroupsPanel trainingClass={trainingClass} assessment={assessment} learners={learners || []} groups={groups} loading={loading} />}
                {shownView === 'results' && certificateDetails && (
                    <ResultsPanel
                        showGroups={hasGroupWork}
                        trainingClass={trainingClass}
                        results={results}
                        loading={loading || !certificates}
                        certificates={certificates || []}
                        certificateDetails={certificateDetails}
                        signatureMissing={!user?.signatureURL}
                    />
                )}
            </MotionCard>

            <TrainingClassFormModal
                open={editingClass}
                trainingClass={trainingClass}
                assessments={assessments}
                onCancel={() => setEditingClass(false)}
                onSaved={() => {
                    setEditingClass(false)
                    void loadClass()
                }}
            />
        </DashboardPage>
    )
}
