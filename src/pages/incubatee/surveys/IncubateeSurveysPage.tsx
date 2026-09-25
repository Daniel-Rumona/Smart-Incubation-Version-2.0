import { useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Empty, Row, Select, Tag } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, FormOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listSurveysForParticipant, type SurveyToAnswer } from '@/services/surveyResponsesService'
import '@/styles/survey-response.css'
import { useLanguage } from '@/providers/LanguageProvider'

const STATUS_TONE: Record<SurveyToAnswer['status'], string> = {
    'not started': 'gold',
    'in progress': 'blue',
    submitted: 'green',
}

export default function IncubateeSurveysPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    const [surveys, setSurveys] = useState<SurveyToAnswer[]>()
    const [statusFilter, setStatusFilter] = useState('open')

    useEffect(() => {
        if (!user) return
        const timeout = window.setTimeout(() => {
            void listSurveysForParticipant(user)
                .then(setSurveys)
                .catch(() => {
                    message.error(t('Your surveys could not be loaded.'))
                    setSurveys([])
                })
        }, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => surveys || [], [surveys])
    // One count per status, so the three add up to the list rather than overlapping.
    const notStarted = rows.filter((row) => row.status === 'not started').length
    const inProgress = rows.filter((row) => row.status === 'in progress').length
    const submitted = rows.filter((row) => row.status === 'submitted').length

    const visible = useMemo(() => rows.filter((row) => {
        if (statusFilter === 'all') return true
        if (statusFilter === 'open') return row.status !== 'submitted'
        return row.status === statusFilter
    }), [rows, statusFilter])

    return (
        <DashboardPage className="incubatee-page incubatee-surveys-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={8}>
                    <DashboardMetricCard loading={!surveys} icon={<FormOutlined />} label={t('Not started')} value={notStarted} />
                </Col>
                <Col xs={12} lg={8}>
                    <DashboardMetricCard loading={!surveys} icon={<ClockCircleOutlined />} label={t('In progress')} value={inProgress} />
                </Col>
                <Col xs={12} lg={8}>
                    <DashboardMetricCard loading={!surveys} icon={<CheckCircleOutlined />} label={t('Submitted')} value={submitted} />
                </Col>
            </Row>

            <FilterBar
                compact
                primary={
                    <Select
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={[
                            { value: 'open', label: t('Still to do') },
                            { value: 'in progress', label: t('Started') },
                            { value: 'submitted', label: t('Submitted') },
                            { value: 'all', label: t('All surveys') },
                        ]}
                    />
                }
            />

            <MotionCard loading={!surveys} className="survey-answer-panel" title={t('Your surveys')}>
                {visible.length ? (
                    <ul className="survey-answer-list">
                        {visible.map((row) => (
                            <li className="survey-answer-row" key={row.templateId}>
                                <span className={`survey-answer-icon is-${row.status.replace(' ', '-')}`}>
                                    {row.status === 'submitted' ? <CheckCircleOutlined /> : <FormOutlined />}
                                </span>

                                <span className="survey-answer-copy">
                                    <strong>{row.title}</strong>
                                    <span>
                                        {[
                                            row.category,
                                            `${row.questionCount} question${row.questionCount === 1 ? '' : 's'}`,
                                            row.submittedAt ? `Submitted ${dayjs(row.submittedAt).format('DD MMM')}` : row.updatedAt ? `Saved ${dayjs(row.updatedAt).format('DD MMM')}` : '',
                                        ].filter(Boolean).join(' · ')}
                                    </span>
                                </span>

                                <Tag color={STATUS_TONE[row.status]} className="survey-answer-status">
                                    {row.status === 'not started' ? t('Not started') : row.status === 'in progress' ? t('In progress') : t('Submitted')}
                                </Tag>

                                <Button
                                    type={row.status === 'submitted' ? 'default' : 'primary'}
                                    size="small"
                                    icon={<RightOutlined />}
                                    iconPosition="end"
                                    onClick={() => navigate(`/incubatee/surveys/${row.templateId}`)}
                                >
                                    {row.status === 'not started' ? t('Start') : row.status === 'in progress' ? t('Continue') : t('View')}
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nothing to complete right now.')} />
                )}
            </MotionCard>
        </DashboardPage>
    )
}
