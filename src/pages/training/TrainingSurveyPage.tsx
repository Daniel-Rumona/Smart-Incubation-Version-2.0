import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Col, Empty, Form, Input, List, Modal, Popconfirm, Progress, Result, Row, Segmented, Select, Space, Switch, Typography } from 'antd'
import { ArrowDownOutlined, ArrowLeftOutlined, ArrowUpOutlined, DeleteOutlined, DownloadOutlined, EditOutlined, MessageOutlined, PlayCircleOutlined, PlusOutlined, SaveOutlined, StarOutlined, StopOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { surveyAudienceLabel, surveyStatusTag } from '@/components/training/surveyLabels'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listCompanyTrainingLearners, listTrainingClasses } from '@/services/trainingService'
import { deleteTrainingSurvey, getTrainingSurvey, listSurveyResponses, setTrainingSurveyStatus, updateTrainingSurvey } from '@/services/trainingSurveysService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel } from '@/utils/trainingFormat'
import { blankQuestion, overallRating, surveyCsv, surveyProblems, surveyResults } from '@/utils/trainingSurveyResults'
import type { TrainingClass, TrainingLearner } from '@/types/training'
import type { TrainingSurvey, TrainingSurveyQuestion, TrainingSurveyResponse, TrainingSurveyValues } from '@/types/trainingSurveys'
import '@/styles/training.css'

type ViewKey = 'questions' | 'answers'

const TYPE_OPTIONS: Array<{ value: TrainingSurveyQuestion['type'], label: string }> = [
    { value: 'rating', label: 'Rating 1 to 5' },
    { value: 'choice', label: 'One of several choices' },
    { value: 'yesno', label: 'Yes or no' },
    { value: 'text', label: 'Written answer' },
]

const valuesOf = (survey: TrainingSurvey): TrainingSurveyValues => ({
    title: survey.title, description: survey.description, audience: survey.audience, classIds: survey.classIds, hideNames: survey.hideNames, questions: survey.questions,
})

/** One survey: its questions (edited while it is a draft, or with a warning once answered) and its answers. */
export default function TrainingSurveyPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const { surveyId = '' } = useParams()
    const [form] = Form.useForm<Pick<TrainingSurveyValues, 'title' | 'description' | 'audience' | 'classIds' | 'hideNames'>>()
    const [survey, setSurvey] = useState<TrainingSurvey | null>()
    const [responses, setResponses] = useState<TrainingSurveyResponse[]>([])
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [learners, setLearners] = useState<TrainingLearner[]>([])
    const [questions, setQuestions] = useState<TrainingSurveyQuestion[]>([])
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [view, setView] = useState<ViewKey>('questions')
    const [editingDetails, setEditingDetails] = useState(false)
    const audience = Form.useWatch('audience', form)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [found, answers, classRows, learnerRows] = await Promise.all([getTrainingSurvey(user, surveyId), listSurveyResponses(user, surveyId), listTrainingClasses(user).catch(() => []), listCompanyTrainingLearners(user).catch(() => [])])
            setSurvey(found)
            setResponses(answers)
            setClasses(classRows)
            setLearners(learnerRows)
            if (found) setQuestions(found.questions)
            setDirty(false)
        } catch {
            setSurvey(null)
        }
    }, [surveyId, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const results = useMemo(() => (survey ? surveyResults(survey, responses) : []), [responses, survey])
    const average = overallRating(results)
    const asked = useMemo(() => {
        if (!survey || survey.audience !== 'learners') return null
        return learners.filter((row) => !survey.classIds.length || survey.classIds.includes(row.classId)).length
    }, [learners, survey])

    useRegisterAgentPageContext({
        pageKey: 'training-survey',
        pageName: 'Survey',
        purpose: 'One survey of the training company: its questions and what learners or client companies answered (ratings averaged, choices counted, written answers listed).',
        metrics: { answers: responses.length, averageRating: average === null ? null : Number(average.toFixed(2)) },
        dataSummary: survey ? {
            title: survey.title,
            status: survey.status,
            audience: surveyAudienceLabel(survey, classes, t),
            results: results.map((item) => item.kind === 'rating'
                ? { question: item.question.text, answers: item.answers, average: item.average === null ? null : Number(item.average.toFixed(2)), countsFrom1To5: item.counts }
                : item.kind === 'counts'
                    ? { question: item.question.text, answers: item.answers, counts: item.counts }
                    : { question: item.question.text, answers: item.answers, written: item.texts.slice(0, 30).map((row) => row.text) }),
        } : {},
    })

    if (survey === undefined) return <PageSkeleton variant="detail" label={t('Loading survey')} />
    if (survey === null || !user) return <Result status="404" title={t('Survey not found')} extra={<Button onClick={() => navigate('/training/surveys')}>{t('All surveys')}</Button>} />

    const change = (next: TrainingSurveyQuestion[]) => {
        setQuestions(next)
        setDirty(true)
    }
    const changeQuestion = (id: string, changes: Partial<TrainingSurveyQuestion>) => change(questions.map((item) => (item.id === id ? { ...item, ...changes } : item)))
    const move = (index: number, step: number) => {
        const next = [...questions]
        const [item] = next.splice(index, 1)
        next.splice(index + step, 0, item)
        change(next)
    }

    const saveQuestions = async () => {
        setSaving(true)
        try {
            await updateTrainingSurvey(user, survey.id, { ...valuesOf(survey), questions })
            message.success(t('Questions saved.'))
            await load()
        } catch {
            message.error(t('The questions could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const setStatus = async (status: TrainingSurvey['status']) => {
        if (status === 'open') {
            const problems = surveyProblems({ title: survey.title, questions })
            if (problems.length) {
                Modal.warning({ title: t('Before you open the survey'), content: <ul style={{ paddingLeft: 18, margin: 0 }}>{problems.map((problem) => <li key={problem}>{t(problem)}</li>)}</ul> })
                return
            }
        }
        try {
            if (dirty) await updateTrainingSurvey(user, survey.id, { ...valuesOf(survey), questions })
            await setTrainingSurveyStatus(user, survey, status)
            message.success(status === 'open' ? t('The survey is open: it shows on their pages now.') : t('The survey is closed.'))
            await load()
        } catch {
            message.error(t('The survey could not be changed.'))
        }
    }

    const openDetails = () => {
        form.setFieldsValue({ title: survey.title, description: survey.description, audience: survey.audience, classIds: survey.classIds, hideNames: survey.hideNames })
        setEditingDetails(true)
    }

    const saveDetails = async () => {
        const values = await form.validateFields()
        try {
            await updateTrainingSurvey(user, survey.id, { ...values, classIds: values.classIds || [], description: values.description || '', questions })
            setEditingDetails(false)
            message.success(t('Survey details saved.'))
            await load()
        } catch {
            message.error(t('The survey details could not be saved.'))
        }
    }

    const remove = async () => {
        try {
            await deleteTrainingSurvey(user, survey.id)
            navigate('/training/surveys')
        } catch {
            message.error(t('The survey could not be deleted.'))
        }
    }

    const downloadCsv = () => {
        const blob = new Blob([`\uFEFF${surveyCsv(survey, responses)}`], { type: 'text/csv;charset=utf-8' })
        const link = document.createElement('a')
        link.href = URL.createObjectURL(blob)
        link.download = `${(survey.title || 'survey').replace(/[^\w.-]+/g, '-')}-answers.csv`
        link.click()
        window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    }

    return (
        <DashboardPage className="training-page">
            <MotionCard className="training-class-header">
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                    <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/training/surveys')} className="training-back-link">{t('All surveys')}</Button>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                        <Space wrap>
                            <Typography.Title level={4} style={{ margin: 0 }}>{survey.title || t('Untitled survey')}</Typography.Title>
                            {surveyStatusTag(survey, t)}
                        </Space>
                        <Space wrap>
                            <Button icon={<EditOutlined />} onClick={openDetails}>{t('Survey details')}</Button>
                            {survey.status !== 'open'
                                ? <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => void setStatus('open')}>{survey.status === 'closed' ? t('Open again') : t('Open the survey')}</Button>
                                : <Popconfirm title={t('Close the survey? Nobody can answer or change answers after that.')} okText={t('Close it')} onConfirm={() => void setStatus('closed')}><Button icon={<StopOutlined />}>{t('Close the survey')}</Button></Popconfirm>}
                            {responses.length > 0 && <Button icon={<DownloadOutlined />} onClick={downloadCsv}>{t('Download answers (Excel)')}</Button>}
                            {!responses.length && (
                                <Popconfirm title={t('Delete this survey?')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => void remove()}>
                                    <Button danger icon={<DeleteOutlined />} aria-label={t('Delete')} />
                                </Popconfirm>
                            )}
                        </Space>
                    </Space>
                    <Typography.Text type="secondary">{surveyAudienceLabel(survey, classes, t)}{survey.hideNames ? ` · ${t('names hidden in the answers')}` : ''}</Typography.Text>
                    {survey.description && <Typography.Text>{survey.description}</Typography.Text>}
                </Space>
            </MotionCard>

            <MotionCard>
                <Segmented
                    block
                    value={view}
                    onChange={(value) => setView(value as ViewKey)}
                    style={{ marginBottom: 16 }}
                    options={[
                        { value: 'questions', label: `${t('Questions')} (${questions.length})` },
                        { value: 'answers', label: `${t('Answers')} (${responses.length})` },
                    ]}
                />

                {view === 'questions' && (
                    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                        {survey.status === 'draft' && <Alert type="info" showIcon message={t('A draft: only you see it. Open the survey when the questions are right, and it shows on their pages.')} />}
                        {responses.length > 0 && <Alert type="warning" showIcon message={t('{count} answered already: changing a question changes what their answers mean.', undefined, { count: responses.length })} />}
                        {questions.map((item, index) => (
                            <Card key={item.id} size="small" title={`${t('Question')} ${index + 1}`} extra={(
                                <Space>
                                    <Button size="small" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => move(index, -1)} aria-label={t('Move up')} />
                                    <Button size="small" icon={<ArrowDownOutlined />} disabled={index === questions.length - 1} onClick={() => move(index, 1)} aria-label={t('Move down')} />
                                    <Popconfirm title={t('Remove this question?')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => change(questions.filter((row) => row.id !== item.id))}>
                                        <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('Remove question')} />
                                    </Popconfirm>
                                </Space>
                            )}>
                                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                                    <Input.TextArea value={item.text} placeholder={t('The question')} autoSize={{ minRows: 1, maxRows: 4 }} maxLength={400} onChange={(event) => changeQuestion(item.id, { text: event.target.value })} />
                                    <Space wrap>
                                        <Select value={item.type} style={{ width: 220 }} options={TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))} onChange={(type) => changeQuestion(item.id, { type, options: type === 'choice' && item.options.length < 2 ? ['', ''] : item.options })} />
                                        <Space size={6}><Switch size="small" checked={item.required} onChange={(required) => changeQuestion(item.id, { required })} /><Typography.Text type="secondary">{t('Must be answered')}</Typography.Text></Space>
                                    </Space>
                                    {item.type === 'choice' && (
                                        <Space orientation="vertical" size={6} style={{ width: '100%' }}>
                                            {item.options.map((option, position) => (
                                                <Space.Compact key={`${item.id}-${position}`} style={{ width: '100%' }}>
                                                    <Input value={option} placeholder={`${t('Choice')} ${position + 1}`} maxLength={120} onChange={(event) => changeQuestion(item.id, { options: item.options.map((value, at) => (at === position ? event.target.value : value)) })} />
                                                    <Button icon={<DeleteOutlined />} disabled={item.options.length <= 2} onClick={() => changeQuestion(item.id, { options: item.options.filter((_, at) => at !== position) })} aria-label={t('Remove choice')} />
                                                </Space.Compact>
                                            ))}
                                            <Button size="small" icon={<PlusOutlined />} onClick={() => changeQuestion(item.id, { options: [...item.options, ''] })}>{t('Add a choice')}</Button>
                                        </Space>
                                    )}
                                </Space>
                            </Card>
                        ))}
                        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Space wrap>
                                {TYPE_OPTIONS.map((option) => (
                                    <Button key={option.value} icon={<PlusOutlined />} onClick={() => change([...questions, blankQuestion(option.value)])}>{t(option.label)}</Button>
                                ))}
                            </Space>
                            <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={() => void saveQuestions()}>{dirty ? t('Save changes') : t('Saved')}</Button>
                        </Space>
                    </Space>
                )}

                {view === 'answers' && (
                    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                        <Row gutter={[14, 14]} className="dashboard-metrics-row">
                            <Col xs={12} lg={8}><DashboardMetricCard icon={<MessageOutlined />} label={t('Answers')} value={responses.length} /></Col>
                            <Col xs={12} lg={8}><DashboardMetricCard icon={<StarOutlined />} label={t('Average rating (1 to 5)')} mobileTitle={t('Rating')} value={average === null ? '—' : average.toFixed(1)} /></Col>
                            {asked !== null && <Col xs={12} lg={8}><DashboardMetricCard icon={<TeamOutlined />} label={t('Learners who answered')} mobileTitle={t('Answered')} value={`${responses.length} / ${asked}`} /></Col>}
                        </Row>
                        {!responses.length ? <Empty description={survey.status === 'draft' ? t('Open the survey to start collecting answers.') : t('No answers yet.')} /> : results.map((item, index) => (
                            <Card key={item.question.id} size="small" title={`${index + 1}. ${item.question.text}`} extra={<Typography.Text type="secondary">{t('{count} answer(s)', undefined, { count: item.answers })}</Typography.Text>}>
                                {item.kind === 'rating' && (
                                    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                                        <Typography.Text strong style={{ fontSize: 18 }}>{item.average === null ? '—' : `${item.average.toFixed(1)} / 5`}</Typography.Text>
                                        {[5, 4, 3, 2, 1].map((score) => (
                                            <Space key={score} style={{ width: '100%' }} size={10}>
                                                <Typography.Text style={{ width: 16, display: 'inline-block' }}>{score}</Typography.Text>
                                                <Progress percent={item.answers ? Math.round((item.counts[score - 1] / item.answers) * 100) : 0} format={() => String(item.counts[score - 1])} style={{ width: 280, margin: 0 }} size="small" />
                                            </Space>
                                        ))}
                                    </Space>
                                )}
                                {item.kind === 'counts' && (
                                    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                                        {item.counts.map((row) => (
                                            <Space key={row.label} style={{ width: '100%' }} size={10} wrap>
                                                <Typography.Text style={{ minWidth: 160, display: 'inline-block' }}>{row.label === 'yes' ? t('Yes') : row.label === 'no' ? t('No') : row.label}</Typography.Text>
                                                <Progress percent={item.answers ? Math.round((row.count / item.answers) * 100) : 0} format={() => String(row.count)} style={{ width: 280, margin: 0 }} size="small" />
                                            </Space>
                                        ))}
                                    </Space>
                                )}
                                {item.kind === 'text' && (
                                    <List size="small" dataSource={item.texts} locale={{ emptyText: t('No written answers.') }} renderItem={(row) => (
                                        <List.Item><Space orientation="vertical" size={0}><Typography.Text>{row.text}</Typography.Text>{row.by && <Typography.Text type="secondary" style={{ fontSize: 12 }}>{row.by}</Typography.Text>}</Space></List.Item>
                                    )} />
                                )}
                            </Card>
                        ))}
                    </Space>
                )}
            </MotionCard>

            <Modal open={editingDetails} title={t('Survey details')} okText={t('Save')} onOk={() => void saveDetails()} onCancel={() => setEditingDetails(false)} destroyOnHidden width={620}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="title" label={t('Title')} rules={[{ required: true, whitespace: true, message: t('Enter a title.') }]}><Input maxLength={160} /></Form.Item>
                    <Form.Item name="description" label={t('A line for the people answering (optional)')}><Input maxLength={300} /></Form.Item>
                    <Form.Item name="audience" label={t('Who answers')}>
                        <Segmented block options={[{ value: 'learners', label: t('Learners') }, { value: 'companies', label: t('Client companies') }]} />
                    </Form.Item>
                    {audience !== 'companies' && (
                        <Form.Item name="classIds" label={t('Classes')} extra={t('Leave empty to ask the learners of every class.')}>
                            <Select mode="multiple" allowClear placeholder={t('Every class')} options={classes.map((row) => ({ value: row.id, label: `${row.courseTitle}, ${classDatesLabel(row)}` }))} />
                        </Form.Item>
                    )}
                    <Form.Item name="hideNames" label={t('Hide names in the answers')} valuePropName="checked" extra={t('Answers are still one per person, but you see them without names.')}>
                        <Switch />
                    </Form.Item>
                </Form>
            </Modal>
        </DashboardPage>
    )
}
