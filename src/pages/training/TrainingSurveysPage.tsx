import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Modal, Radio, Row, Space, Typography, type TableProps } from 'antd'
import { CheckCircleOutlined, FormOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listTrainingClasses } from '@/services/trainingService'
import { countSurveyResponses, createTrainingSurvey, listTrainingSurveys } from '@/services/trainingSurveysService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { surveyTemplates } from '@/utils/trainingSurveyResults'
import { esgReportingOn } from '@/config/clientModules'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { surveyAudienceLabel, surveyStatusTag } from '@/components/training/surveyLabels'
import type { TrainingClass } from '@/types/training'
import type { TrainingSurvey } from '@/types/trainingSurveys'
import '@/styles/training.css'

/** Keletso's surveys: feedback forms for learners and questionnaires for client companies. */
export default function TrainingSurveysPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [surveys, setSurveys] = useState<TrainingSurvey[]>()
    const [counts, setCounts] = useState<Map<string, number>>(new Map())
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [creating, setCreating] = useState(false)
    const { settings } = useSystemSettings()
    const templates = surveyTemplates(esgReportingOn(settings))
    const [template, setTemplate] = useState(templates[0].key)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [rows, answered, classRows] = await Promise.all([listTrainingSurveys(user), countSurveyResponses(user), listTrainingClasses(user).catch(() => [])])
            setSurveys(rows)
            setCounts(answered)
            setClasses(classRows)
        } catch {
            setSurveys([])
            message.error(t('The surveys could not be loaded.'))
        }
    }, [message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const all = useMemo(() => surveys || [], [surveys])
    const answersTotal = [...counts.values()].reduce((sum, value) => sum + value, 0)

    useRegisterAgentPageContext({
        pageKey: 'training-surveys',
        pageName: 'Surveys',
        purpose: 'The training company\'s surveys: feedback forms its learners answer after a class and questionnaires for its client companies, with how many have answered.',
        metrics: { surveys: all.length, open: all.filter((row) => row.status === 'open').length, answers: answersTotal },
        dataSummary: { surveys: all.map((row) => ({ title: row.title, status: row.status, audience: surveyAudienceLabel(row, classes, t), questions: row.questions.length, answers: counts.get(row.id) || 0 })) },
    })

    const create = async () => {
        if (!user) return
        const chosen = templates.find((row) => row.key === template) || templates[0]
        setSaving(true)
        try {
            const values = chosen.values()
            // A feedback form goes to the class that is running or has just finished, when there is one.
            const latest = classes.find((row) => row.startDate <= dayjs().format('YYYY-MM-DD'))
            const id = await createTrainingSurvey(user, { ...values, title: values.title || t('New survey'), classIds: values.audience === 'learners' && latest && chosen.key === 'feedback' ? [latest.id] : values.classIds })
            navigate(`/training/surveys/${id}`)
        } catch {
            message.error(t('The survey could not be created.'))
        } finally {
            setSaving(false)
        }
    }

    const columns: TableProps<TrainingSurvey>['columns'] = [
        {
            title: t('Survey'),
            key: 'title',
            render: (_, row) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{row.title || t('Untitled survey')}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('{count} question(s)', undefined, { count: row.questions.length })}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Who answers'), key: 'audience', render: (_, row) => surveyAudienceLabel(row, classes, t) },
        { title: t('Status'), key: 'status', render: (_, row) => surveyStatusTag(row, t) },
        { title: t('Answers'), key: 'answers', align: 'center', render: (_, row) => counts.get(row.id) || 0 },
        { title: t('Opened'), key: 'opened', render: (_, row) => (row.openedAt ? dayjs(row.openedAt).format('D MMM YYYY') : '—') },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={8}><DashboardMetricCard loading={!surveys} icon={<FormOutlined />} label={t('Surveys')} value={all.length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={!surveys} icon={<CheckCircleOutlined />} label={t('Open now')} value={all.filter((row) => row.status === 'open').length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={!surveys} icon={<MessageOutlined />} label={t('Answers received')} mobileTitle={t('Answers')} value={answersTotal} /></Col>
            </Row>
            <FilterBar
                compact
                primary={<Typography.Text type="secondary">{t('Ask learners how a class went, or ask client companies what they need next.')}</Typography.Text>}
                actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t('New survey')}</Button>}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={all}
                columns={columns}
                loading={!surveys}
                onRowClick={(row) => navigate(`/training/surveys/${row.id}`)}
                emptyText={t('No surveys yet. Start with the participant feedback form from your training pack.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space wrap><Typography.Text strong>{row.title}</Typography.Text>{surveyStatusTag(row, t)}</Space>
                        <Typography.Text type="secondary">{surveyAudienceLabel(row, classes, t)}</Typography.Text>
                        <Typography.Text>{t('{count} answer(s)', undefined, { count: counts.get(row.id) || 0 })}</Typography.Text>
                    </Space>
                )}
            />
            <Modal open={creating} title={t('New survey')} okText={t('Create')} confirmLoading={saving} onOk={() => void create()} onCancel={() => setCreating(false)}>
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                    <Typography.Text type="secondary">{t('Start from a ready-made survey and change anything before you open it.')}</Typography.Text>
                    <Radio.Group value={template} onChange={(event) => setTemplate(event.target.value)}>
                        <Space orientation="vertical">
                            {templates.map((row) => (
                                <Radio key={row.key} value={row.key}>
                                    {t(row.label)}
                                    {row.key !== 'blank' && <Typography.Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{row.values().questions.map((item) => item.text).join(' · ')}</Typography.Text>}
                                </Radio>
                            ))}
                        </Space>
                    </Radio.Group>
                </Space>
            </Modal>
        </DashboardPage>
    )
}
