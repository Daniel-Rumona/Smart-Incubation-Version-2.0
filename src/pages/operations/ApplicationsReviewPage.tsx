import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Empty, Grid, Input, Modal, Progress, Row, Segmented, Select, Space, Tag, Typography, type TableProps } from 'antd'
import { AppstoreOutlined, BarChartOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, DownloadOutlined, FileOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { useEffect, useMemo, useState } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { listOperationsApplications, updateOperationsApplicationStatus } from '@/services/operationsApplicationsService'
import { CHART_COLORS, CHART_PALETTE } from '@/config/chartPalette'
import type { OperationsApplication } from '@/types/operations'
import '@/styles/applications-review.css'

const { RangePicker } = DatePicker
dayjs.extend(isBetween)
type DetailSection = 'overview' | 'ai' | 'documents'
const STATUSES = ['Pending', 'Accepted', 'Rejected']
const normalizeStatus = (value?: string) => STATUSES.find((status) => status.toLowerCase() === value?.toLowerCase()) || 'Pending'
const statusColor = (status: string) => status === 'Accepted' ? 'green' : status === 'Rejected' ? 'red' : 'gold'
const toDate = (value: unknown) => {
    if (!value) return null
    if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return dayjs(value.toDate())
    if (typeof value === 'object' && value && 'seconds' in value && typeof value.seconds === 'number') return dayjs(value.seconds * 1000)
    const date = dayjs(value as string | number | Date)
    return date.isValid() ? date : null
}

const uniqueOptions = (rows: OperationsApplication[], key: 'province' | 'beeLevel' | 'gender') =>
    [...new Set(rows.map((row) => row[key]).filter((value): value is string => !!value))].sort().map((value) => ({ value, label: value }))

const breakdown = (rows: OperationsApplication[], key: 'gender' | 'beeLevel') => {
    const counts = new Map<string, number>()
    rows.forEach((row) => { const value = row[key]; if (value) counts.set(value, (counts.get(value) || 0) + 1) })
    const total = rows.length
    return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count], index) => ({ label, count, percent: total ? Math.round((count / total) * 100) : 0, color: CHART_PALETTE[index % CHART_PALETTE.length] }))
}

const complianceColor = (score: number) => score >= 80 ? CHART_COLORS.success : score >= 50 ? CHART_COLORS.amber : CHART_COLORS.danger

const CHALLENGE_STOPWORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will', 'are', 'was', 'were', 'our', 'their', 'they', 'you', 'your', 'not', 'but', 'can', 'all', 'has', 'had', 'who', 'what', 'when', 'where', 'how', 'its', 'about', 'into', 'more', 'most', 'some', 'also', 'been', 'being'])

const challengeWordCloud = (rows: OperationsApplication[]) => {
    const counts = new Map<string, number>()
    rows.forEach((row) => {
        (row.challenges || '').toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).forEach((raw) => {
            const word = raw.trim()
            if (word.length < 3 || CHALLENGE_STOPWORDS.has(word)) return
            counts.set(word, (counts.get(word) || 0) + 1)
        })
    })
    const max = Math.max(1, ...counts.values())
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([word, count]) => ({ word, count, weight: count / max }))
}

export const ApplicationsReviewPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const screens = Grid.useBreakpoint()
    const isCompact = !screens.xl
    const { user } = useFullIdentity()
    const [applications, setApplications] = useState<OperationsApplication[]>([])
    const [loading, setLoading] = useState(false)
    const [selected, setSelected] = useState<OperationsApplication>()
    const [detailOpen, setDetailOpen] = useState(false)
    const [section, setSection] = useState<DetailSection>('overview')
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('All')
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [province, setProvince] = useState('All')
    const [beeLevel, setBeeLevel] = useState('All')
    const [gender, setGender] = useState('All')
    const [pendingUpdate, setPendingUpdate] = useState<{ row: OperationsApplication, status: string }>()
    const [analyticsOpen, setAnalyticsOpen] = useState(false)

    const load = async () => {
        if (!user) return
        try {
            setLoading(true)
            const rows = await listOperationsApplications(user)
            setApplications(rows)
            setSelected((current) => rows.find((row) => row.id === current?.id) || rows[0])
        } catch {
            message.error(t('operations.applications.loadError'))
        } finally {
            setLoading(false)
        }
    }
    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const counts = useMemo(() => ({
        pending: applications.filter((row) => normalizeStatus(row.applicationStatus) === 'Pending').length,
        accepted: applications.filter((row) => normalizeStatus(row.applicationStatus) === 'Accepted').length,
        rejected: applications.filter((row) => normalizeStatus(row.applicationStatus) === 'Rejected').length,
    }), [applications])
    const rows = useMemo(() => applications.filter((row) => {
        const needle = search.trim().toLowerCase()
        const submittedAt = toDate(row.submittedAt)
        return (status === 'All' || normalizeStatus(row.applicationStatus) === status)
            && (!needle || `${row.businessName} ${row.email} ${row.programName || ''}`.toLowerCase().includes(needle))
            && (!dateRange || (!!submittedAt && submittedAt.isBetween(dateRange[0], dateRange[1], 'day', '[]')))
            && (province === 'All' || row.province === province)
            && (beeLevel === 'All' || row.beeLevel === beeLevel)
            && (gender === 'All' || row.gender === gender)
    }), [applications, beeLevel, dateRange, gender, province, search, status])

    const genderBreakdown = useMemo(() => breakdown(rows, 'gender'), [rows])
    const beeBreakdown = useMemo(() => breakdown(rows, 'beeLevel'), [rows])
    const complianceAverage = useMemo(() => {
        const scored = rows.filter((row) => typeof row.complianceScore === 'number')
        return scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.complianceScore || 0), 0) / scored.length) : null
    }, [rows])
    const challengeWords = useMemo(() => challengeWordCloud(rows), [rows])

    useRegisterAgentPageContext({ pageKey: 'operations-applications', pageName: 'Applications', purpose: 'Review project applications and update decisions.', filters: { search, status, dateRange, province, beeLevel, gender }, metrics: { total: applications.length, ...counts }, tables: { visibleApplications: rows.length }, selectedRecord: selected?.businessName })

    const chooseApplication = (row: OperationsApplication) => {
        setSelected(row)
        setSection('overview')
        if (isCompact) setDetailOpen(true)
    }
    const confirmStatusChange = async () => {
        if (!user || !pendingUpdate) return
        try {
            setLoading(true)
            await updateOperationsApplicationStatus(user, pendingUpdate.row.id, pendingUpdate.status)
            message.success(t('operations.applications.updated'))
            setPendingUpdate(undefined)
            await load()
        } catch {
            message.error(t('operations.applications.updateError'))
            setLoading(false)
        }
    }

    const columns: TableProps<OperationsApplication>['columns'] = [
        { title: t('operations.participants.enterprise'), dataIndex: 'businessName', render: (value: string, row) => <Space orientation="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text></Space> },
        { title: t('operations.applications.applied'), dataIndex: 'submittedAt', render: (value: unknown) => toDate(value)?.format('DD MMM YYYY') || t('N/A') },
        { title: t('operations.applications.aiScore'), dataIndex: 'aiScore', render: (value?: string | number) => value ?? t('N/A') },
        { title: t('common.status'), dataIndex: 'applicationStatus', render: (value: string, row) => <Space wrap><Tag color={statusColor(normalizeStatus(value))}>{normalizeStatus(value)}</Tag>{row.supportFitStatus === 'await_review' ? <Tag color="orange">{t('External review')}</Tag> : null}</Space> },
    ]

    const hasAiReview = !!selected && (selected.aiScore !== undefined && selected.aiScore !== null || !!selected.aiRecommendation || !!selected.aiJustification)

    const details = selected ? (
        <div className="applications-detail-body">
            <div className="applications-detail-heading">
                <div><Typography.Title level={4}>{selected.businessName}</Typography.Title><Typography.Text type="secondary">{selected.email}</Typography.Text></div>
                <Tag color={statusColor(normalizeStatus(selected.applicationStatus))}>{normalizeStatus(selected.applicationStatus)}</Tag>
            </div>
            <Segmented block value={section} onChange={(value) => setSection(value as DetailSection)} options={[{ label: t('common.overview'), value: 'overview' }, { label: t('operations.applications.decision'), value: 'ai' }, { label: t('operations.compliance.documents'), value: 'documents' }]} />
            {section === 'overview' && <Descriptions bordered size="small" column={1} items={[
                { key: 'program', label: t('operations.applications.program'), children: selected.programName || t('common.unassigned') },
                { key: 'date', label: t('operations.applications.applied'), children: toDate(selected.submittedAt)?.format('DD MMM YYYY') || 'N/A' },
                { key: 'province', label: t('common.province'), children: selected.province || 'N/A' },
                { key: 'bee', label: t('common.beeLevel'), children: selected.beeLevel || 'N/A' },
                { key: 'gender', label: t('common.gender'), children: selected.gender || 'N/A' },
                { key: 'motivation', label: t('operations.applications.motivation'), children: selected.motivation || 'N/A' },
                { key: 'challenges', label: t('operations.applications.challenges'), children: selected.challenges || 'N/A' },
            ]} />}
            {section === 'ai' && <Space orientation="vertical" size={16} className="applications-detail-stack">
                <div>
                    <Typography.Text strong>{t('operations.applications.decision')}</Typography.Text>
                    <div className="applications-decision-cards">
                        {STATUSES.map((value) => {
                            const isActive = normalizeStatus(selected.applicationStatus) === value
                            const icon = value === 'Accepted' ? <CheckCircleOutlined /> : value === 'Rejected' ? <CloseCircleOutlined /> : <ClockCircleOutlined />
                            return (
                                <button
                                    key={value}
                                    type="button"
                                    className={`applications-decision-card is-${value.toLowerCase()}${isActive ? ' is-active' : ''}`}
                                    onClick={() => { if (!isActive) setPendingUpdate({ row: selected, status: value }) }}
                                >
                                    <span className="applications-decision-icon">{icon}</span>
                                    <span className="applications-decision-label">{t(`operations.applications.${value.toLowerCase()}`)}</span>
                                </button>
                            )
                        })}
                    </div>
                </div>
                {hasAiReview ? <>
                    <div><Typography.Text strong>{t('operations.applications.aiRecommendation')}</Typography.Text><Tag color={statusColor(normalizeStatus(selected.aiRecommendation))}>{selected.aiRecommendation || t('operations.applications.pending')}</Tag></div>
                    {selected.supportFitStatus ? <div><Typography.Text strong>{t('Support fit')}</Typography.Text><div><Tag color={selected.supportFitStatus === 'await_review' ? 'orange' : 'green'}>{selected.supportFitStatus.replace(/_/g, ' ')}</Tag></div></div> : null}
                    {selected.externalInterventionSuggestions?.length ? <Alert type="warning" showIcon message={t('External intervention suggested')} description={selected.externalInterventionSuggestions.map((item) => item.title || item.reason || 'External support need').join(', ')} /> : null}
                    <div><Typography.Text strong>{t('operations.applications.aiScore')}</Typography.Text><Typography.Title level={3}>{selected.aiScore ?? t('N/A')}</Typography.Title></div>
                    <div><Typography.Text strong>{t('operations.applications.justification')}</Typography.Text><Typography.Paragraph type="secondary">{selected.aiJustification || t('operations.applications.noJustification')}</Typography.Paragraph></div>
                </> : <div className="applications-decision-result">
                    <Typography.Text strong>{t('operations.applications.result')}</Typography.Text>
                    <Tag color={statusColor(normalizeStatus(selected.applicationStatus))}>{normalizeStatus(selected.applicationStatus)}</Tag>
                    <Typography.Text type="secondary">{t('operations.applications.noAiReview')}</Typography.Text>
                </div>}
            </Space>}
            {section === 'documents' && <Space orientation="vertical" className="applications-detail-stack">
                {selected.documents.length || selected.growthPlanDocUrl ? <>
                    {selected.documents.map((document, index) => <Card size="small" key={`${document.type}-${index}`}><Space><FileOutlined /><Typography.Text>{document.type || `${t('common.document')} ${index + 1}`}</Typography.Text><Button icon={<DownloadOutlined />} href={document.url} target="_blank" disabled={!document.url}>{t('common.download')}</Button></Space></Card>)}
                    {selected.growthPlanDocUrl && <Card size="small"><Space><FileOutlined /><Typography.Text>{t('operations.applications.growthPlan')}</Typography.Text><Button icon={<DownloadOutlined />} href={selected.growthPlanDocUrl} target="_blank">{t('common.download')}</Button></Space></Card>}
                </> : <Empty description={t('operations.compliance.noDocuments')} />}
            </Space>}
        </div>
    ) : <Empty description={t('operations.applications.select')} />

    return <DashboardPage className="applications-review-page">
        <Row gutter={[12, 12]} className="applications-metrics">
            <Col xs={12} md={6}><DashboardMetricCard icon={<AppstoreOutlined />} label={t('nav.applications')} value={applications.length} clickable active={status === 'All'} onClick={() => setStatus('All')} /></Col>
            <Col xs={12} md={6}><DashboardMetricCard icon={<ClockCircleOutlined />} label={t('operations.applications.pending')} value={counts.pending} clickable active={status === 'Pending'} onClick={() => setStatus('Pending')} /></Col>
            <Col xs={12} md={6}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('operations.applications.accepted')} value={counts.accepted} clickable active={status === 'Accepted'} onClick={() => setStatus('Accepted')} /></Col>
            <Col xs={12} md={6}><DashboardMetricCard icon={<CloseCircleOutlined />} label={t('operations.applications.rejected')} value={counts.rejected} clickable active={status === 'Rejected'} onClick={() => setStatus('Rejected')} /></Col>
        </Row>
        <FilterBar primary={<><Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('operations.applications.search')} allowClear /><Select value={status} onChange={setStatus} options={['All', ...STATUSES].map((value) => ({ value, label: t(`operations.applications.${value.toLowerCase()}`) }))} /><RangePicker value={dateRange} onChange={(value) => setDateRange(value as [Dayjs, Dayjs] | null)} /></>} advanced={<><Select value={province} onChange={setProvince} options={[{ value: 'All', label: t('operations.applications.allProvinces') }, ...uniqueOptions(applications, 'province')]} /><Select value={beeLevel} onChange={setBeeLevel} options={[{ value: 'All', label: t('operations.applications.allBeeLevels') }, ...uniqueOptions(applications, 'beeLevel')]} /><Select value={gender} onChange={setGender} options={[{ value: 'All', label: t('operations.applications.allGenders') }, ...uniqueOptions(applications, 'gender')]} /></>} actions={<Button icon={<BarChartOutlined />} onClick={() => setAnalyticsOpen(true)}>{t('operations.applications.analytics')}</Button>} />
        <Row gutter={[16, 16]} align="top">
            <Col xs={24} xl={14}><Card className="applications-panel"><ResponsiveDataView rowKey="id" loading={loading} columns={columns} rows={rows} emptyText={t('operations.applications.empty')} onRowClick={chooseApplication} rowClassName={(row) => `applications-row${row.id === selected?.id ? ' applications-selected-row' : ''}`} renderCard={(row) => <Space orientation="vertical" size={8} onClick={() => chooseApplication(row)}><Typography.Text strong>{row.businessName}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text><Space wrap><Tag color={statusColor(normalizeStatus(row.applicationStatus))}>{normalizeStatus(row.applicationStatus)}</Tag><Typography.Text type="secondary">{toDate(row.submittedAt)?.format('DD MMM YYYY') || t('N/A')}</Typography.Text></Space></Space>} /></Card></Col>
            {!isCompact && <Col xl={10}><Card className="applications-panel">{details}</Card></Col>}
        </Row>
        <Modal open={detailOpen} title={t('operations.applications.details')} footer={null} onCancel={() => setDetailOpen(false)} width={760}>{details}</Modal>
        <Modal open={!!pendingUpdate} title={t('operations.applications.confirmDecision')} onCancel={() => setPendingUpdate(undefined)} onOk={() => void confirmStatusChange()} okText={t('operations.applications.updateStatus')}>{t('operations.applications.change')} {pendingUpdate?.row.businessName} {t('operations.applications.to')} <strong>{pendingUpdate?.status}</strong>?</Modal>
        <Modal open={analyticsOpen} title={t('operations.applications.analytics')} footer={null} centered width={640} onCancel={() => setAnalyticsOpen(false)} className="applications-analytics-modal">
            <div className="applications-analytics-grid">
                <div className="applications-analytics-card applications-analytics-gauge">
                    <Typography.Text strong>{t('operations.applications.complianceScore')}</Typography.Text>
                    {complianceAverage === null
                        ? <Empty description={t('operations.applications.noComplianceScore')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        : <Progress type="circle" percent={complianceAverage} gapDegree={180} gapPosition="bottom" strokeColor={complianceColor(complianceAverage)} />}
                </div>

                <div className="applications-analytics-card">
                    <Typography.Text strong>{t('operations.applications.genderBreakdown')}</Typography.Text>
                    {genderBreakdown.length
                        ? genderBreakdown.map((item) => (
                            <div className="applications-analytics-bar-row" key={item.label}>
                                <span className="applications-analytics-bar-label">{item.label}</span>
                                <Progress percent={item.percent} strokeColor={item.color} showInfo={false} size="small" />
                                <span className="applications-analytics-bar-value">{item.percent}% ({item.count})</span>
                            </div>
                        ))
                        : <Empty description={t('operations.applications.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </div>

                <div className="applications-analytics-card">
                    <Typography.Text strong>{t('common.beeLevel')}</Typography.Text>
                    {beeBreakdown.length
                        ? beeBreakdown.map((item) => (
                            <div className="applications-analytics-bar-row" key={item.label}>
                                <span className="applications-analytics-bar-label">{item.label}</span>
                                <Progress percent={item.percent} strokeColor={item.color} showInfo={false} size="small" />
                                <span className="applications-analytics-bar-value">{item.percent}% ({item.count})</span>
                            </div>
                        ))
                        : <Empty description={t('operations.applications.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </div>

                <div className="applications-analytics-card applications-analytics-wordmap-card">
                    <Typography.Text strong>{t('operations.applications.challengesWordMap')}</Typography.Text>
                    {challengeWords.length
                        ? <div className="applications-analytics-wordmap">
                            {challengeWords.map((item) => (
                                <span
                                    key={item.word}
                                    className="applications-wordmap-word"
                                    style={{ fontSize: `${12 + item.weight * 16}px`, color: `rgba(37, 99, 235, ${0.35 + item.weight * 0.65})` }}
                                >
                                    {item.word}
                                </span>
                            ))}
                        </div>
                        : <Empty description={t('operations.applications.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                </div>
            </div>
        </Modal>
    </DashboardPage>
}
