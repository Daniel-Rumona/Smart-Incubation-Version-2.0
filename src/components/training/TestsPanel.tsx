import { useMemo, useState } from 'react'
import { Alert, App, Button, Select, Space, Switch, Tag, Typography, type TableProps } from 'antd'
import { EditOutlined, FileTextOutlined } from '@ant-design/icons'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { MarkingDrawer } from '@/components/training/MarkingDrawer'
import { ResultTag } from '@/components/training/TrainingTags'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { createPaperSubmission } from '@/services/trainingAssessmentService'
import { setTrainingTestOpen } from '@/services/trainingService'
import { useLanguage } from '@/providers/LanguageProvider'
import { organisationsOf } from '@/utils/trainingFormat'
import { canStartPostTest } from '@/utils/trainingResults'
import type { TrainingAssessment, TrainingClass, TrainingLearnerResult, TrainingSubmission, TrainingTestKind } from '@/types/training'

type Props = {
    trainingClass: TrainingClass
    /** The pre-assessment and post-assessment (often the same one). */
    assessments: { pre: TrainingAssessment | null, post: TrainingAssessment | null }
    /** Each assessment's memo, by assessment id. */
    memos: Record<string, Record<string, string>>
    results: TrainingLearnerResult[]
    submissions: TrainingSubmission[]
    loading: boolean
    onEditClass: () => void
    /** Reloads the class after a change made here (opening or closing a test). */
    onClassChanged: () => void
}

type Filter = 'all' | 'to_mark' | 'not_written'

/**
 * The pre-assessment and post-assessment for every learner. Online attempts arrive here as learners submit them; a test written
 * on paper is recorded here so its marks can be captured. Marking compares each answer with the memo.
 */
export const TestsPanel = ({ trainingClass, assessments, memos, results, submissions, loading, onEditClass, onClassChanged }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [organisation, setOrganisation] = useState('all')
    const [filter, setFilter] = useState<Filter>('all')
    const [markingId, setMarkingId] = useState<string | null>(null)
    const [creating, setCreating] = useState<string | null>(null)

    const organisations = useMemo(() => organisationsOf(results.map((result) => result.learner)), [results])
    const attemptsOf = (learnerId: string, kind: TrainingTestKind) =>
        submissions.filter((submission) => submission.learnerId === learnerId && submission.kind === kind)

    const visible = useMemo(() => results.filter((result) => {
        if (organisation !== 'all' && result.learner.organisation !== organisation) return false
        const own = submissions.filter((submission) => submission.learnerId === result.learner.id)
        if (filter === 'to_mark') return own.some((submission) => submission.status === 'submitted')
        if (filter === 'not_written') return !own.some((submission) => submission.kind === 'post')
        return true
    }), [filter, organisation, results, submissions])

    const [toggling, setToggling] = useState<TrainingTestKind | null>(null)
    const toMark = submissions.filter((submission) => submission.status === 'submitted').length

    /** Learners can start a test online only while it is open; the class page updates when the change saves. */
    const toggleOpen = async (kind: TrainingTestKind, open: boolean) => {
        if (!user) return
        setToggling(kind)
        try {
            await setTrainingTestOpen(user, trainingClass.id, kind, open)
            onClassChanged()
            message.success(open
                ? t('Learners can now start the {test} on their training page.', undefined, { test: kind === 'pre' ? t('pre-assessment') : t('post-assessment') })
                : t('The {test} is closed for learners.', undefined, { test: kind === 'pre' ? t('pre-assessment') : t('post-assessment') }))
        } catch {
            message.error(t('The assessment could not be opened or closed.'))
        } finally {
            setToggling(null)
        }
    }
    const markingSubmission = submissions.find((submission) => submission.id === markingId)
    const markingLearner = results.find((result) => result.learner.id === markingSubmission?.learnerId)?.learner

    const assessment = assessments.post
    if (!assessment) {
        return (
            <Alert
                type="info"
                showIcon
                message={t('This class has no assessment yet.')}
                description={t('Choose the course assessment for the class to record and mark the pre-assessment and post-assessment.')}
                action={<Button onClick={onEditClass}>{t('Edit class')}</Button>}
            />
        )
    }

    const recordPaper = async (result: TrainingLearnerResult, kind: TrainingTestKind) => {
        if (!user) return
        setCreating(`${result.learner.id}:${kind}`)
        try {
            const id = await createPaperSubmission(user, { classId: trainingClass.id, learnerId: result.learner.id, learnerUid: result.learner.uid, kind, assessment: assessments[kind] || assessment, existing: submissions })
            setMarkingId(id)
        } catch (error) {
            message.error(error instanceof Error && error.message === 'attempt_exists'
                ? t('The learner has just started this assessment online. Mark it when they hand it in.')
                : t('The paper assessment could not be recorded.'))
        } finally {
            setCreating(null)
        }
    }

    const attemptTag = (submission: TrainingSubmission) => {
        const label = submission.kind === 'post' && submission.attempt > 1 ? t('Reassessment {n}', undefined, { n: submission.attempt - 1 }) : undefined
        if (submission.status === 'marked') {
            return (
                <Button size="small" icon={<EditOutlined />} onClick={() => setMarkingId(submission.id)}>
                    {label ? `${label}: ` : ''}{submission.score}/{submission.totalMarks} ({submission.scorePct}%)
                </Button>
            )
        }
        if (submission.status === 'submitted') {
            return <Button size="small" type="primary" onClick={() => setMarkingId(submission.id)}>{label ? `${label}: ` : ''}{t('Mark')}</Button>
        }
        return <Tag>{label ? `${label}: ` : ''}{t('Writing now')}</Tag>
    }

    const preCell = (result: TrainingLearnerResult) => {
        const pre = attemptsOf(result.learner.id, 'pre')
        if (pre.length) return <Space wrap>{pre.map((submission) => <span key={submission.id}>{attemptTag(submission)}</span>)}</Space>
        return (
            <Button size="small" icon={<FileTextOutlined />} loading={creating === `${result.learner.id}:pre`} onClick={() => void recordPaper(result, 'pre')}>
                {t('Record paper assessment')}
            </Button>
        )
    }

    const postCell = (result: TrainingLearnerResult) => {
        const posts = attemptsOf(result.learner.id, 'post')
        const canStart = canStartPostTest(result, submissions)
        return (
            <Space wrap>
                {posts.map((submission) => <span key={submission.id}>{attemptTag(submission)}</span>)}
                {canStart && (
                    <Button size="small" icon={<FileTextOutlined />} loading={creating === `${result.learner.id}:post`} onClick={() => void recordPaper(result, 'post')}>
                        {posts.length ? t('Record paper reassessment') : t('Record paper assessment')}
                    </Button>
                )}
            </Space>
        )
    }

    const columns: TableProps<TrainingLearnerResult>['columns'] = [
        {
            title: t('Learner'),
            key: 'learner',
            render: (_, result) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{result.learner.name}</Typography.Text>
                    <Typography.Text type="secondary">{result.learner.organisation}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Pre-assessment (not counted)'), key: 'pre', render: (_, result) => preCell(result) },
        { title: t('Post-assessment'), key: 'post', render: (_, result) => postCell(result) },
        { title: t('Result'), key: 'result', render: (_, result) => <ResultTag status={result.status} /> },
    ]

    return (
        <>
            <FilterBar
                compact
                primary={(
                    <>
                        <Select
                            value={filter}
                            onChange={setFilter}
                            options={[
                                { value: 'all', label: t('All learners') },
                                { value: 'to_mark', label: t('To mark ({count})', undefined, { count: toMark }) },
                                { value: 'not_written', label: t('Post-assessment not written') },
                            ]}
                        />
                        <Select
                            value={organisation}
                            onChange={setOrganisation}
                            options={[{ value: 'all', label: t('All organisations') }, ...organisations.map((value) => ({ value, label: value }))]}
                        />
                    </>
                )}
            />
            <Typography.Paragraph type="secondary">
                {assessments.pre && assessments.pre.id !== assessment.id && (
                    <>{t('Pre-assessment: {title}, {count} questions.', undefined, { title: assessments.pre.title, count: assessments.pre.questions.length })}<br /></>
                )}
                {t('{title}: {count} questions. Pass mark {pct}% on the post-assessment, with {n} reassessment(s) allowed.', undefined, {
                    title: assessment.title,
                    count: assessment.questions.length,
                    pct: trainingClass.passMarkPct,
                    n: trainingClass.reassessmentsAllowed,
                })}
            </Typography.Paragraph>
            <Space wrap size={[24, 8]} style={{ marginBottom: 12 }}>
                {(['pre', 'post'] as const).map((kind) => (
                    <Space key={kind}>
                        <Switch
                            checked={trainingClass.testsOpen[kind]}
                            loading={toggling === kind}
                            onChange={(open) => void toggleOpen(kind, open)}
                            aria-label={kind === 'pre' ? t('Pre-assessment open for learners') : t('Post-assessment open for learners')}
                        />
                        <Typography.Text>{kind === 'pre' ? t('Pre-assessment open for learners') : t('Post-assessment open for learners')}</Typography.Text>
                    </Space>
                ))}
            </Space>
            <ResponsiveDataView
                rowKey={(result) => result.learner.id}
                rows={visible}
                columns={columns}
                loading={loading}
                emptyText={results.length ? t('No learners match these filters.') : t('Add learners to record their assessments.')}
                renderCard={(result) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{result.learner.name}</Typography.Text>
                            <ResultTag status={result.status} />
                        </Space>
                        <Typography.Text type="secondary">{result.learner.organisation}</Typography.Text>
                        <Typography.Text>{t('Pre-assessment (not counted)')}</Typography.Text>
                        {preCell(result)}
                        <Typography.Text>{t('Post-assessment')}</Typography.Text>
                        {postCell(result)}
                    </Space>
                )}
            />
            <MarkingDrawer
                submission={markingSubmission}
                learner={markingLearner}
                memo={markingSubmission ? memos[markingSubmission.assessmentId] || {} : {}}
                passMarkPct={trainingClass.passMarkPct}
                onClose={() => setMarkingId(null)}
            />
        </>
    )
}
