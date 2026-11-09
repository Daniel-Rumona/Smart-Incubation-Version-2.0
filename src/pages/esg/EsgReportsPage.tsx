import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Input, Popconfirm, Progress, Row, Select, Space, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { BankOutlined, CheckCircleOutlined, DeleteOutlined, FileTextOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { EsgReportFormModal } from '@/components/esg/EsgReportFormModal'
import { ESG_SECTORS, countryName, esgFramework, sectorStandardFor } from '@/config/esgStandards'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { deleteEsgReport, listEsgReports } from '@/services/esgReportsService'
import { canManageTraining, listCompanyTrainingLearners } from '@/services/trainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { ESG_SECTIONS, esgCompleteness, esgSectionsWritten } from '@/utils/esgReportChecks'
import { periodLabel } from '@/utils/esgReportDocx'
import type { EsgReport, EsgReportStatus } from '@/types/esg'

const STATUS_COLOURS: Record<EsgReportStatus, string> = { draft: 'default', in_review: 'gold', final: 'green' }

export const EsgStatusTag = ({ status }: { status: EsgReportStatus }) => {
    const { t } = useLanguage()
    return <Tag color={STATUS_COLOURS[status]}>{{ draft: t('Draft'), in_review: t('In review'), final: t('Final') }[status]}</Tag>
}

/** The same measure as the report page: how many of its sections are written ("3/8"). */
const WrittenProgress = ({ report }: { report: EsgReport }) => {
    const written = esgSectionsWritten(report)
    return <Progress percent={Math.round((written / ESG_SECTIONS.length) * 100)} size="small" format={() => `${written}/${ESG_SECTIONS.length}`} />
}

export default function EsgReportsPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [reports, setReports] = useState<EsgReport[]>()
    const [clients, setClients] = useState<string[]>([])
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<'all' | EsgReportStatus>('all')
    const [creating, setCreating] = useState(false)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [rows, learners] = await Promise.all([
                listEsgReports(user),
                // The training module's client organisations are offered as report clients.
                canManageTraining(user) ? listCompanyTrainingLearners(user).catch(() => []) : Promise.resolve([]),
            ])
            setReports(rows)
            setClients([...new Set([...rows.map((row) => row.clientName), ...learners.map((learner) => learner.organisation)].filter(Boolean))].sort())
        } catch {
            setReports([])
            message.error(t('ESG reports could not be loaded.'))
        }
    }, [message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return (reports || []).filter((report) => (statusFilter === 'all' || report.status === statusFilter)
            && (!needle || `${report.clientName} ${countryName(report.country)} ${report.sector}`.toLowerCase().includes(needle)))
    }, [reports, search, statusFilter])

    const all = reports || []
    const finals = all.filter((report) => report.status === 'final').length

    useRegisterAgentPageContext({
        pageKey: 'esg-reports',
        pageName: 'ESG reports',
        purpose: 'List the ESG reports prepared for client organisations: sector, country, reporting period, the standards each is aligned to (GRI with its sector standard and national frameworks), status and completeness.',
        currentFilters: { search, status: statusFilter },
        metrics: { reports: all.length, final: finals, inProgress: all.length - finals, clients: new Set(all.map((report) => report.clientName)).size },
        dataSummary: { reports: visible.map((report) => ({ client: report.clientName, sector: report.sector, country: report.country, period: periodLabel(report), status: report.status, completenessPct: esgCompleteness(report) })) },
    })

    const remove = async (report: EsgReport) => {
        if (!user) return
        try {
            await deleteEsgReport(user, report.id)
            message.success(t('Report deleted.'))
            await load()
        } catch {
            message.error(t('The report could not be deleted.'))
        }
    }

    const standards = (report: EsgReport) => (
        <Space size={[4, 4]} wrap>
            <Tag color="green">GRI</Tag>
            {sectorStandardFor(report.sector) && <Tag>{sectorStandardFor(report.sector)?.id}</Tag>}
            {report.frameworks.map((id) => <Tag key={id}>{esgFramework(id)?.label(report.periodStart).split(' (')[0] || id}</Tag>)}
        </Space>
    )

    const columns: TableProps<EsgReport>['columns'] = [
        {
            title: t('Client'),
            dataIndex: 'clientName',
            render: (value: string, report) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">{t(ESG_SECTORS.find((item) => item.key === report.sector)?.label || report.sector)} · {countryName(report.country)}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Reporting period'), key: 'period', render: (_, report) => periodLabel(report) },
        { title: t('Standards'), key: 'standards', render: (_, report) => standards(report) },
        { title: t('Status'), dataIndex: 'status', render: (status: EsgReportStatus) => <EsgStatusTag status={status} /> },
        { title: t('Sections written'), key: 'complete', width: 160, render: (_, report) => <WrittenProgress report={report} /> },
        {
            title: '',
            key: 'actions',
            align: 'right',
            render: (_, report) => (
                <span onClick={(event) => event.stopPropagation()}>
                    <Popconfirm title={t('Delete this report?')} description={t('Its data and written sections are deleted. This cannot be undone.')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => remove(report)}>
                        <Tooltip title={t('Delete report')}><Button danger icon={<DeleteOutlined />} aria-label={t('Delete report')} /></Tooltip>
                    </Popconfirm>
                </span>
            ),
        },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!reports} icon={<FileTextOutlined />} label={t('ESG reports')} value={all.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!reports} icon={<FileTextOutlined />} label={t('In progress')} value={all.length - finals} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!reports} icon={<CheckCircleOutlined />} label={t('Final')} value={finals} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!reports} icon={<BankOutlined />} label={t('Clients')} value={new Set(all.map((report) => report.clientName)).size} /></Col>
            </Row>
            <FilterBar
                compact
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search client, country or sector')} allowClear />
                        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: t('All reports') }, { value: 'draft', label: t('Draft') }, { value: 'in_review', label: t('In review') }, { value: 'final', label: t('Final') }]} />
                    </>
                )}
                actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>{t('New ESG report')}</Button>}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={!reports}
                onRowClick={(report) => navigate(`/esg/reports/${report.id}`)}
                emptyText={all.length ? t('No reports match these filters.') : t('No ESG reports yet. Create one for a client, then import their ESG toolkit workbook.')}
                renderCard={(report) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{report.clientName}</Typography.Text>
                            <EsgStatusTag status={report.status} />
                        </Space>
                        <Typography.Text type="secondary">{periodLabel(report)} · {countryName(report.country)}</Typography.Text>
                        {standards(report)}
                        <WrittenProgress report={report} />
                    </Space>
                )}
            />
            {creating && (
                <EsgReportFormModal
                    knownClients={clients}
                    onClose={() => setCreating(false)}
                    onSaved={(id) => { setCreating(false); navigate(`/esg/reports/${id}`) }}
                />
            )}
        </DashboardPage>
    )
}
