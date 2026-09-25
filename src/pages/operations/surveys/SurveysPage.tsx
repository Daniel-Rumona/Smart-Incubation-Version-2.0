import { useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Input, Popconfirm, Row, Segmented, Select, Space, Table, Tag } from 'antd'
import { AppstoreOutlined, DeleteOutlined, EditOutlined, EyeOutlined, FileTextOutlined, PlusOutlined, SearchOutlined, SendOutlined, TableOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { deleteSurveyTemplate, listSurveyTemplates, type SurveyTemplate } from '@/services/surveyTemplatesService'
import { listResponseSummaries, type SurveyResponseSummary } from '@/services/surveyResponsesService'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import SendSurveyModal from './SendSurveyModal'
import SurveyResponsesModal from './SurveyResponsesModal'
import '@/styles/survey-builder.css'
import { useLanguage } from '@/providers/LanguageProvider'

type ViewKey = 'templates' | 'responses'

export default function SurveysPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    const [templates, setTemplates] = useState<SurveyTemplate[]>()
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    const [summaries, setSummaries] = useState<Record<string, SurveyResponseSummary>>()
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [mainView, setMainView] = useState<ViewKey>('templates')
    const [sendOpen, setSendOpen] = useState(false)
    const [responsesTemplate, setResponsesTemplate] = useState<SurveyTemplate | null>(null)

    const load = async () => {
        try {
            setTemplates(await listSurveyTemplates())
        } catch {
            message.error(t('Survey templates could not be loaded.'))
            setTemplates([])
        }
    }

    const loadSummaries = async () => {
        try {
            setSummaries(await listResponseSummaries())
        } catch {
            setSummaries({})
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            void load()
            void loadSummaries()
            if (user) void listWorkspacePrograms(user).then(setPrograms).catch(() => setPrograms([]))
        }, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const rows = templates || []
    const published = rows.filter((row) => row.status === 'published').length
    const drafts = rows.length - published

    const summaryOf = (templateId?: string): SurveyResponseSummary => (templateId && summaries?.[templateId]) || { assigned: 0, completed: 0 }
    const totalAssigned = useMemo(() => rows.reduce((sum, row) => sum + summaryOf(row.id).assigned, 0), [rows, summaries]) // eslint-disable-line react-hooks/exhaustive-deps
    const totalCompleted = useMemo(() => rows.reduce((sum, row) => sum + summaryOf(row.id).completed, 0), [rows, summaries]) // eslint-disable-line react-hooks/exhaustive-deps
    const completionRate = totalAssigned ? Math.round((totalCompleted / totalAssigned) * 100) : 0

    const programName = (programId?: string) => programs.find((program) => program.id === programId)?.name || 'Not scoped'

    const visible = useMemo(() => rows.filter((row) => {
        if (mainView === 'templates' && statusFilter !== 'all' && row.status !== statusFilter) return false
        if (!search.trim()) return true
        const term = search.trim().toLowerCase()
        return `${row.title} ${row.category} ${programName(row.programId)}`.toLowerCase().includes(term)
    }), [rows, statusFilter, search, programs, mainView]) // eslint-disable-line react-hooks/exhaustive-deps

    const remove = async (templateId?: string) => {
        if (!templateId) return
        try {
            await deleteSurveyTemplate(templateId)
            message.success(t('Survey template deleted.'))
            await load()
        } catch {
            message.error(t('The template could not be deleted.'))
        }
    }

    return (
        <DashboardPage className="operations-surveys-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                {mainView === 'templates' ? (
                    <>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!templates} icon={<FileTextOutlined />} label={t('Survey templates')} value={rows.length} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!templates} icon={<SendOutlined />} label={t('Published')} value={published} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!templates} icon={<EditOutlined />} label={t('Drafts')} value={drafts} />
                        </Col>
                    </>
                ) : (
                    <>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!summaries} icon={<SendOutlined />} label={t('Assigned')} value={totalAssigned} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!summaries} icon={<EyeOutlined />} label={t('Completed')} value={totalCompleted} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!summaries} icon={<TableOutlined />} label={t('Completion rate')} value={`${completionRate}%`} />
                        </Col>
                    </>
                )}
            </Row>

            <FilterBar
                compact
                primary={
                    <>
                        <Input
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('Search title, category or programme')}
                            allowClear
                        />

                        {mainView === 'templates' && (
                            <Select
                                value={statusFilter}
                                onChange={setStatusFilter}
                                options={[
                                    { value: 'all', label: t('All statuses') },
                                    { value: 'published', label: t('Published') },
                                    { value: 'draft', label: t('Draft') },
                                ]}
                            />
                        )}
                    </>
                }
                actions={
                    <Space size={8} wrap>
                        <Segmented
                            value={mainView}
                            onChange={(value) => setMainView(value as ViewKey)}
                            options={[
                                { label: t('Templates'), value: 'templates', icon: <TableOutlined /> },
                                { label: t('Responses'), value: 'responses', icon: <AppstoreOutlined /> },
                            ]}
                        />

                        {mainView === 'templates' ? (
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operations/surveys/builder')}>{t('New survey')}</Button>
                        ) : (
                            <Button type="primary" icon={<SendOutlined />} onClick={() => setSendOpen(true)}>{t('Send survey')}</Button>
                        )}
                    </Space>
                }
            />

            <MotionCard
                loading={!templates}
                className="survey-list-panel"
                title={mainView === 'templates' ? t('Survey templates') : t('Sent surveys')}
                extra={<span className="survey-list-count">{`${visible.length} of ${rows.length}`}</span>}
            >
                {mainView === 'templates' ? (
                    <Table
                        size="small"
                        rowKey={(row) => row.id || row.title}
                        dataSource={visible}
                        pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                        scroll={{ x: 760 }}
                        onRow={(row) => ({ onDoubleClick: () => navigate(`/operations/surveys/builder/${row.id}`) })}
                        columns={[
                            { title: t('Survey'), dataIndex: 'title', render: (value: string) => <strong>{value || t('Untitled survey')}</strong> },
                            { title: t('Category'), dataIndex: 'category', width: 160 },
                            { title: t('Programme'), dataIndex: 'programId', width: 200, render: (value?: string) => programName(value) },
                            { title: t('Questions'), dataIndex: 'fields', width: 110, render: (fields: SurveyTemplate['fields']) => fields?.length || 0 },
                            {
                                title: t('Status'),
                                dataIndex: 'status',
                                width: 120,
                                render: (value: string) => <Tag color={value === 'published' ? 'green' : 'default'}>{value === 'published' ? t('Published') : t('Draft')}</Tag>,
                            },
                            {
                                title: t('Updated'),
                                dataIndex: 'updatedAt',
                                width: 140,
                                render: (value?: string) => (value ? dayjs(value).format('DD MMM YYYY') : '—'),
                            },
                            {
                                title: t('Actions'),
                                width: 140,
                                render: (_, row) => (
                                    <Space size={4}>
                                        <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`/operations/surveys/builder/${row.id}`)}>{t('Edit')}</Button>
                                        <Popconfirm title={t('Delete this template?')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => void remove(row.id)}>
                                            <Button size="small" danger icon={<DeleteOutlined />} />
                                        </Popconfirm>
                                    </Space>
                                ),
                            },
                        ]}
                    />
                ) : (
                    <Table
                        size="small"
                        rowKey={(row) => row.id || row.title}
                        loading={!summaries}
                        dataSource={visible}
                        pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                        scroll={{ x: 760 }}
                        columns={[
                            { title: t('Survey'), dataIndex: 'title', render: (value: string) => <strong>{value || t('Untitled survey')}</strong> },
                            { title: t('Programme'), dataIndex: 'programId', width: 200, render: (value?: string) => programName(value) },
                            { title: t('Assigned'), width: 110, align: 'center', render: (_, row) => summaryOf(row.id).assigned },
                            { title: t('Completed'), width: 120, align: 'center', render: (_, row) => summaryOf(row.id).completed },
                            {
                                title: t('Status'),
                                width: 120,
                                render: (_, row) => {
                                    const { assigned, completed } = summaryOf(row.id)
                                    const complete = assigned > 0 && completed >= assigned
                                    return complete ? <Tag color="green">{t('Completed')}</Tag> : <Tag color="orange">{t('Pending')}</Tag>
                                },
                            },
                            {
                                title: t('Action'),
                                width: 110,
                                render: (_, row) => (
                                    <Button size="small" icon={<EyeOutlined />} disabled={!summaryOf(row.id).assigned} onClick={() => setResponsesTemplate(row)}>
                                        {t('View')}
                                    </Button>
                                ),
                            },
                        ]}
                    />
                )}
            </MotionCard>

            <SendSurveyModal
                open={sendOpen}
                templates={rows}
                programs={programs}
                companyCode={user?.companyCode || undefined}
                onClose={() => setSendOpen(false)}
                onSent={() => void loadSummaries()}
            />

            <SurveyResponsesModal template={responsesTemplate} onClose={() => setResponsesTemplate(null)} />
        </DashboardPage>
    )
}
