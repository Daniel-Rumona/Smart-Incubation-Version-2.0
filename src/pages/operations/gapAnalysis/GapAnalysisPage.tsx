import { useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Input, Popconfirm, Row, Space, Table, Tag, Typography } from 'antd'
import {
    ArrowLeftOutlined,
    DeleteOutlined,
    EditOutlined,
    EyeOutlined,
    FileSearchOutlined,
    PlusOutlined,
    RobotOutlined,
    SearchOutlined,
    SendOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { deleteSurveyTemplate, type SurveyTemplate } from '@/services/surveyTemplatesService'
import { listResponseSummaries, listResponsesForTemplate, type SurveyResponseRow, type SurveyResponseSummary } from '@/services/surveyResponsesService'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import {
    listGapAnalysisTemplates,
    listStoredGapAnalyses,
    loadPlanningContext,
    type GapPriority,
    type StoredGapAnalysis,
} from '@/services/gapAnalysisService'
import type { DiagnosticInterventionOption, DiagnosticPlanParticipant } from '@/types/diagnosticPlan'
import SendSurveyModal from '../surveys/SendSurveyModal'
import GapReviewModal from './GapReviewModal'
import '@/styles/survey-builder.css'
import '@/styles/gap-analysis.css'

const BUILDER_PATH = '/operations/gap-analysis/builder'

const STATUS_TONE: Record<SurveyResponseRow['status'], string> = { 'not started': 'default', 'in progress': 'blue', submitted: 'green' }
const STATUS_LABEL: Record<SurveyResponseRow['status'], string> = { 'not started': 'Not started', 'in progress': 'In progress', submitted: 'Submitted' }

const countByPriority = (analysis: StoredGapAnalysis | undefined, priority: GapPriority) =>
    analysis?.result.gaps.filter((gap) => gap.priority === priority).length || 0

/**
 * Gap analyses: diagnostic questionnaires (built or imported from a document) sent to SMEs, and the
 * responses with an AI read that scores each business area, lists the gaps, and proposes interventions
 * for the SME's diagnostic plan.
 */
export default function GapAnalysisPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    const [templates, setTemplates] = useState<SurveyTemplate[]>()
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    const [summaries, setSummaries] = useState<Record<string, SurveyResponseSummary>>({})
    const [search, setSearch] = useState('')
    const [sendOpen, setSendOpen] = useState(false)

    const [active, setActive] = useState<SurveyTemplate | null>(null)
    const [responses, setResponses] = useState<SurveyResponseRow[]>()
    const [analyses, setAnalyses] = useState<Record<string, StoredGapAnalysis>>({})
    const [participants, setParticipants] = useState<Record<string, DiagnosticPlanParticipant>>({})
    const [catalogue, setCatalogue] = useState<DiagnosticInterventionOption[]>([])
    const [reviewing, setReviewing] = useState<SurveyResponseRow | null>(null)

    const load = async () => {
        if (!user) return
        try {
            setTemplates(await listGapAnalysisTemplates(user))
        } catch {
            message.error(t('Gap analyses could not be loaded.'))
            setTemplates([])
        }
        void listResponseSummaries().then(setSummaries).catch(() => setSummaries({}))
    }

    useEffect(() => {
        if (!user) return
        // Deferred a tick, as on the surveys page, so loading never sets state inside the effect itself.
        const timeout = window.setTimeout(() => {
            void load()
            void listWorkspacePrograms(user).then(setPrograms).catch(() => setPrograms([]))
        }, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const loadPlanning = async (template: SurveyTemplate) => {
        if (!user) return
        try {
            const context = await loadPlanningContext(user, template.programId)
            setParticipants(context.participants)
            setCatalogue(context.catalogue)
        } catch {
            // Without plan access the answers and analysis still show; adding to the plan is disabled.
            setParticipants({})
        }
    }

    const openResponses = async (template: SurveyTemplate) => {
        if (!user || !template.id) return
        setActive(template)
        setResponses(undefined)
        setAnalyses({})
        try {
            const [rows, stored] = await Promise.all([
                listResponsesForTemplate(template.id),
                listStoredGapAnalyses(user, template.id).catch(() => ({})),
            ])
            setResponses(rows)
            setAnalyses(stored)
        } catch {
            message.error(t('Responses could not be loaded.'))
            setResponses([])
        }
        void loadPlanning(template)
    }

    const remove = async (templateId?: string) => {
        if (!templateId) return
        try {
            await deleteSurveyTemplate(templateId)
            message.success(t('Gap analysis deleted.'))
            await load()
        } catch {
            message.error(t('The gap analysis could not be deleted.'))
        }
    }

    const rows = templates || []
    const programName = (programId?: string) => programs.find((program) => program.id === programId)?.name || t('Not scoped')
    const summaryOf = (templateId?: string) => (templateId && summaries[templateId]) || { assigned: 0, completed: 0 }

    const visible = useMemo(() => rows.filter((row) => {
        const term = search.trim().toLowerCase()
        return !term || `${row.title} ${programName(row.programId)}`.toLowerCase().includes(term)
    }), [rows, search, programs]) // eslint-disable-line react-hooks/exhaustive-deps

    const visibleResponses = useMemo(() => (responses || []).filter((row) => {
        const term = search.trim().toLowerCase()
        const name = participants[row.participantId]?.businessName || row.participantName
        return !term || name.toLowerCase().includes(term)
    }), [responses, search, participants])

    const submitted = (responses || []).filter((row) => row.status === 'submitted').length
    const analysedCount = Object.keys(analyses).length
    const highGaps = Object.values(analyses).reduce((sum, analysis) => sum + countByPriority(analysis, 'High'), 0)
    const totalAssigned = rows.reduce((sum, row) => sum + summaryOf(row.id).assigned, 0)
    const totalCompleted = rows.reduce((sum, row) => sum + summaryOf(row.id).completed, 0)

    const reviewingAnalysis = reviewing ? analyses[reviewing.participantId] : undefined

    return (
        <DashboardPage className="operations-gap-analysis-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                {active ? (
                    <>
                        <Col xs={12} lg={6}><DashboardMetricCard loading={!responses} icon={<TeamOutlined />} label={t('Sent to')} value={responses?.length || 0} /></Col>
                        <Col xs={12} lg={6}><DashboardMetricCard loading={!responses} icon={<SendOutlined />} label={t('Submitted')} value={submitted} /></Col>
                        <Col xs={12} lg={6}><DashboardMetricCard loading={!responses} icon={<RobotOutlined />} label={t('Analysed')} value={analysedCount} /></Col>
                        <Col xs={12} lg={6}><DashboardMetricCard loading={!responses} icon={<FileSearchOutlined />} label={t('High-priority gaps')} value={highGaps} /></Col>
                    </>
                ) : (
                    <>
                        <Col xs={12} lg={8}><DashboardMetricCard loading={!templates} icon={<FileSearchOutlined />} label={t('Gap analyses')} value={rows.length} /></Col>
                        <Col xs={12} lg={8}><DashboardMetricCard loading={!templates} icon={<SendOutlined />} label={t('Sent to SMEs')} value={totalAssigned} /></Col>
                        <Col xs={12} lg={8}><DashboardMetricCard loading={!templates} icon={<TeamOutlined />} label={t('Responses submitted')} value={totalCompleted} /></Col>
                    </>
                )}
            </Row>

            <FilterBar
                compact
                primary={(
                    <Input
                        prefix={<SearchOutlined />}
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={active ? t('Search SMEs') : t('Search title or programme')}
                        allowClear
                    />
                )}
                actions={(
                    <Space size={8} wrap>
                        {active ? (
                            <>
                                <Button icon={<ArrowLeftOutlined />} onClick={() => { setActive(null); setSearch('') }}>{t('All gap analyses')}</Button>
                                <Button icon={<EditOutlined />} onClick={() => navigate(`${BUILDER_PATH}/${active.id}`)}>{t('Edit questions')}</Button>
                            </>
                        ) : (
                            <>
                                <Button icon={<SendOutlined />} disabled={!rows.some((row) => row.status === 'published')} onClick={() => setSendOpen(true)}>{t('Send to SMEs')}</Button>
                                <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate(BUILDER_PATH)}>{t('New gap analysis')}</Button>
                            </>
                        )}
                    </Space>
                )}
            />

            {active ? (
                <MotionCard
                    className="survey-list-panel"
                    title={`${active.title || t('Untitled gap analysis')} · ${t('Responses')}`}
                    extra={<span className="survey-list-count">{programName(active.programId)}</span>}
                >
                    <Table
                        size="small"
                        rowKey="participantId"
                        loading={!responses}
                        dataSource={visibleResponses}
                        pagination={{ pageSize: 10, size: 'small', hideOnSinglePage: true }}
                        scroll={{ x: 820 }}
                        locale={{ emptyText: t('Nobody has been sent this gap analysis yet. Publish it, or use Send to SMEs.') }}
                        onRow={(row) => ({ onDoubleClick: () => row.status === 'submitted' && setReviewing(row) })}
                        columns={[
                            {
                                title: t('SME'),
                                render: (_, row) => <strong>{participants[row.participantId]?.businessName || row.participantName}</strong>,
                            },
                            {
                                title: t('Status'),
                                dataIndex: 'status',
                                width: 120,
                                render: (status: SurveyResponseRow['status']) => <Tag color={STATUS_TONE[status]}>{t(STATUS_LABEL[status])}</Tag>,
                            },
                            {
                                title: t('Submitted'),
                                width: 120,
                                render: (_, row) => (row.submittedAt ? dayjs(row.submittedAt).format('DD MMM YYYY') : '—'),
                            },
                            {
                                title: t('Gaps'),
                                width: 190,
                                render: (_, row) => {
                                    const analysis = analyses[row.participantId]
                                    if (!analysis) return row.status === 'submitted' ? <Tag>{t('Not analysed')}</Tag> : '—'
                                    return (
                                        <Space size={4} wrap>
                                            <Tag color="red">{`${countByPriority(analysis, 'High')} ${t('high')}`}</Tag>
                                            <Tag color="orange">{`${countByPriority(analysis, 'Medium')} ${t('medium')}`}</Tag>
                                            <Tag color="green">{`${countByPriority(analysis, 'Low')} ${t('low')}`}</Tag>
                                        </Space>
                                    )
                                },
                            },
                            {
                                title: t('On plan'),
                                width: 110,
                                render: (_, row) => {
                                    const added = analyses[row.participantId]?.addedInterventionIds.length || 0
                                    return added ? <Typography.Text>{`${added} ${t('added')}`}</Typography.Text> : '—'
                                },
                            },
                            {
                                title: t('Action'),
                                width: 120,
                                render: (_, row) => (
                                    <Button
                                        size="small"
                                        type={row.status === 'submitted' && !analyses[row.participantId] ? 'primary' : 'default'}
                                        icon={analyses[row.participantId] ? <EyeOutlined /> : <RobotOutlined />}
                                        disabled={row.status !== 'submitted'}
                                        onClick={() => setReviewing(row)}
                                    >
                                        {analyses[row.participantId] ? t('Review') : t('Open')}
                                    </Button>
                                ),
                            },
                        ]}
                    />
                </MotionCard>
            ) : (
                <MotionCard
                    loading={!templates}
                    className="survey-list-panel"
                    title={t('Gap analyses')}
                    extra={<span className="survey-list-count">{`${visible.length} of ${rows.length}`}</span>}
                >
                    <Table
                        size="small"
                        rowKey={(row) => row.id || row.title}
                        dataSource={visible}
                        pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                        scroll={{ x: 820 }}
                        locale={{ emptyText: t('No gap analyses yet. Create one, or import an existing diagnostic form.') }}
                        onRow={(row) => ({ onDoubleClick: () => void openResponses(row) })}
                        columns={[
                            { title: t('Gap analysis'), dataIndex: 'title', render: (value: string) => <strong>{value || t('Untitled gap analysis')}</strong> },
                            { title: t('Programme'), dataIndex: 'programId', width: 200, render: (value?: string) => programName(value) },
                            { title: t('Questions'), dataIndex: 'fields', width: 100, render: (fields: SurveyTemplate['fields']) => fields?.filter((field) => field.type !== 'heading').length || 0 },
                            {
                                title: t('Status'),
                                dataIndex: 'status',
                                width: 110,
                                render: (value: string) => <Tag color={value === 'published' ? 'green' : 'default'}>{value === 'published' ? t('Published') : t('Draft')}</Tag>,
                            },
                            {
                                title: t('Responses'),
                                width: 120,
                                render: (_, row) => {
                                    const summary = summaryOf(row.id)
                                    return summary.assigned ? `${summary.completed} / ${summary.assigned}` : '—'
                                },
                            },
                            { title: t('Updated'), dataIndex: 'updatedAt', width: 120, render: (value?: string) => (value ? dayjs(value).format('DD MMM YYYY') : '—') },
                            {
                                title: t('Actions'),
                                width: 210,
                                render: (_, row) => (
                                    <Space size={4}>
                                        <Button size="small" type="primary" ghost icon={<EyeOutlined />} onClick={() => void openResponses(row)}>{t('Responses')}</Button>
                                        <Button size="small" icon={<EditOutlined />} onClick={() => navigate(`${BUILDER_PATH}/${row.id}`)} aria-label={t('Edit')} />
                                        <Popconfirm title={t('Delete this gap analysis?')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => void remove(row.id)}>
                                            <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('Delete')} />
                                        </Popconfirm>
                                    </Space>
                                ),
                            },
                        ]}
                    />
                </MotionCard>
            )}

            <SendSurveyModal
                open={sendOpen}
                templates={rows}
                programs={programs}
                companyCode={user?.companyCode || undefined}
                onClose={() => setSendOpen(false)}
                onSent={() => void load()}
            />

            {active && (
                <GapReviewModal
                    key={reviewing?.participantId || 'none'}
                    template={active}
                    row={reviewing}
                    analysis={reviewingAnalysis}
                    participant={reviewing ? participants[reviewing.participantId] : undefined}
                    catalogue={catalogue}
                    onClose={() => setReviewing(null)}
                    onAnalysed={(analysis) => setAnalyses((current) => ({ ...current, [analysis.participantId]: analysis }))}
                    onPlanChanged={() => void loadPlanning(active)}
                />
            )}
        </DashboardPage>
    )
}
