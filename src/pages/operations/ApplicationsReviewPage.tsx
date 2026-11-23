import { Alert, App, Avatar, Button, Card, DatePicker, Empty, Pagination, Spin, Input, Progress, Segmented, Select, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, SortAscendingOutlined, TrophyOutlined, BarChartOutlined, CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, WarningOutlined, DownloadOutlined, FileOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isBetween from 'dayjs/plugin/isBetween'
import { motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { hasRolePermission } from '@/config/permissions'
import { useLanguage } from '@/providers/LanguageProvider'
import { listOperationsApplications, loadApplicantComplianceDocuments, updateOperationsApplicationStatus } from '@/services/operationsApplicationsService'
import { CHART_COLORS, CHART_PALETTE } from '@/config/chartPalette'
import { COMPLIANCE_DOCUMENT_CATALOGUE, requirementKeyFor } from '@/config/complianceDocuments'
import { initialsOf } from '@/utils/initials'
import type { OperationsApplication } from '@/types/operations'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import '@/styles/operations-compliance.css'
import '@/styles/applications-review.css'

const { RangePicker } = DatePicker
dayjs.extend(isBetween)
const STATUSES = ['Pending', 'Accepted', 'Rejected']
// Every application shows the same four required documents; anything else uploaded follows them.
const REQUIRED_DOCUMENT_KEYS = ['id-document', 'proof-of-address', 'tax-compliance', 'b-bbee-certificate']
const requiredDocumentChecklist = (row: OperationsApplication) => {
    const uploaded = [...row.documents.map((document) => ({ name: document.type || '', url: document.url })), ...(row.growthPlanDocUrl ? [{ name: 'Growth plan', url: row.growthPlanDocUrl }] : [])]
    const required = REQUIRED_DOCUMENT_KEYS.map((key) => {
        const entry = COMPLIANCE_DOCUMENT_CATALOGUE.find((item) => item.key === key)
        return { key, name: entry?.name || key, url: uploaded.find((document) => document.url && requirementKeyFor(document.name) === key)?.url }
    })
    const extras = uploaded.filter((document) => document.url && !REQUIRED_DOCUMENT_KEYS.includes(requirementKeyFor(document.name))).map((document, index) => ({ key: `extra-${index}`, name: document.name || 'Document', url: document.url }))
    return [...required, ...extras]
}
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

const breakdown = (rows: OperationsApplication[], key: 'gender' | 'beeLevel' | 'province') => {
    const counts = new Map<string, number>()
    rows.forEach((row) => { const value = row[key]; if (value) counts.set(value, (counts.get(value) || 0) + 1) })
    const total = rows.length
    return [...counts.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([label, count], index) => ({ label, count, percent: total ? Math.round((count / total) * 100) : 0, color: CHART_PALETTE[index % CHART_PALETTE.length] }))
}

type MonthBucket = { key: string, month: Dayjs, total: number } & Record<'Pending' | 'Accepted' | 'Rejected', number>
const DATE_PRESETS = () => [
    { label: 'This month', value: [dayjs().startOf('month'), dayjs().endOf('month')] as [Dayjs, Dayjs] },
    { label: 'Last month', value: [dayjs().subtract(1, 'month').startOf('month'), dayjs().subtract(1, 'month').endOf('month')] as [Dayjs, Dayjs] },
    { label: 'Last 3 months', value: [dayjs().subtract(2, 'month').startOf('month'), dayjs().endOf('month')] as [Dayjs, Dayjs] },
    { label: 'This year', value: [dayjs().startOf('year'), dayjs().endOf('year')] as [Dayjs, Dayjs] },
]

/** Hours as "5 h" or "3 days"; null when there is nothing to measure. */
const formatDuration = (hours: number | null, t: (key: string, fallback?: string, params?: Record<string, string | number>) => string) => {
    if (hours === null) return '—'
    if (hours < 1) return t('Under 1 h')
    if (hours < 48) return `${Math.round(hours)} h`
    return `${Math.round(hours / 24)} ${t('days')}`
}

const complianceColor = (score: number) => score >= 80 ? CHART_COLORS.success : score >= 50 ? CHART_COLORS.amber : CHART_COLORS.danger

export const ApplicationsReviewPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const reduceMotion = useReducedMotion()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    // Reception (and anyone without manage_applications) sees the decision but can't change it.
    const canDecide = Boolean(user && hasRolePermission(user.role, 'manage_applications', user.permissions))
    const detailScrollRef = useRef<HTMLDivElement>(null)
    const [applications, setApplications] = useState<OperationsApplication[]>([])
    const [loading, setLoading] = useState(false)
    const [activeSelection, setSelected] = useState<OperationsApplication>()
    const [detailOpen, setDetailOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState('')
    const [sort, setSort] = useState('newest')
    const [listPage, setListPage] = useState({ key: '', page: 1 })
    const [statusChoice, setStatus] = useState<string | null>(null)
    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null)
    const [province, setProvince] = useState('All')
    const [beeLevel, setBeeLevel] = useState('All')
    const [gender, setGender] = useState('All')
    const [pendingUpdate, setPendingUpdate] = useState<{ row: OperationsApplication, status: string }>()
    const [rejectionReason, setRejectionReason] = useState('')
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    // Documents an applicant uploaded after applying, loaded only for the application being read.
    const [laterDocuments, setLaterDocuments] = useState<Record<string, Array<{ type?: string, url?: string }>>>({})

    const load = async () => {
        if (!user) return
        try {
            setLoading(true)
            const rows = await listOperationsApplications(user)
            setApplications(rows)
            // Keep the open application if it is still there; otherwise the page falls back to the top of the visible list.
            setSelected((current) => rows.find((row) => row.id === current?.id))
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

    // Search and the profile filters narrow everything; dates narrow the counts and analytics; status only narrows the list.
    const baseRows = useMemo(() => applications.filter((row) => {
        const needle = search.trim().toLowerCase()
        return matchesActiveProgram(user, activeProgramId, row.programId)
            && (!needle || `${row.businessName} ${row.email} ${row.programName || ''}`.toLowerCase().includes(needle))
            && (province === 'All' || row.province === province)
            && (beeLevel === 'All' || row.beeLevel === beeLevel)
            && (gender === 'All' || row.gender === gender)
    }), [activeProgramId, applications, beeLevel, gender, province, search, user])
    const analyticsRows = useMemo(() => dateRange ? baseRows.filter((row) => {
        const submittedAt = toDate(row.submittedAt)
        return !!submittedAt && submittedAt.isBetween(dateRange[0], dateRange[1], 'day', '[]')
    }) : baseRows, [baseRows, dateRange])
    const counts = useMemo(() => ({
        pending: analyticsRows.filter((row) => normalizeStatus(row.applicationStatus) === 'Pending').length,
        accepted: analyticsRows.filter((row) => normalizeStatus(row.applicationStatus) === 'Accepted').length,
        rejected: analyticsRows.filter((row) => normalizeStatus(row.applicationStatus) === 'Rejected').length,
    }), [analyticsRows])
    // Until someone picks a segment, open on Pending, or on All when nothing is waiting.
    const status = statusChoice ?? (counts.pending > 0 ? 'Pending' : 'All')
    const rows = useMemo(() => analyticsRows.filter((row) => status === 'All' || normalizeStatus(row.applicationStatus) === status).sort((a, b) => {
        if (sort === 'name') return a.businessName.localeCompare(b.businessName)
        if (sort === 'score') return (Number(b.aiScore) || 0) - (Number(a.aiScore) || 0)
        return (toDate(b.submittedAt)?.valueOf() || 0) - (toDate(a.submittedAt)?.valueOf() || 0)
    }), [analyticsRows, status, sort])
    const selected = rows.find((row) => row.id === activeSelection?.id) || rows[0]
    const pageKey = JSON.stringify([search, status, dateRange, province, beeLevel, gender, sort, selected?.id])
    const selectedPage = Math.floor(Math.max(0, rows.findIndex((row) => row.id === selected?.id)) / 12) + 1
    const currentPage = Math.min(listPage.key === pageKey ? listPage.page : selectedPage, Math.max(1, Math.ceil(rows.length / 12)))
    const pageRows = rows.slice((currentPage - 1) * 12, currentPage * 12)

    const genderBreakdown = useMemo(() => breakdown(analyticsRows, 'gender'), [analyticsRows])
    const beeBreakdown = useMemo(() => breakdown(analyticsRows, 'beeLevel'), [analyticsRows])
    const provinceBreakdown = useMemo(() => breakdown(analyticsRows, 'province'), [analyticsRows])
    const medianDecisionHours = useMemo(() => {
        const hours = analyticsRows.flatMap((row) => {
            const submitted = toDate(row.submittedAt)
            const decided = normalizeStatus(row.applicationStatus) === 'Pending' ? null : toDate(row.decidedAt)
            return submitted && decided && decided.isAfter(submitted) ? [decided.diff(submitted, 'hour', true)] : []
        }).sort((a, b) => a - b)
        if (!hours.length) return null
        const mid = Math.floor(hours.length / 2)
        return hours.length % 2 ? hours[mid] : (hours[mid - 1] + hours[mid]) / 2
    }, [analyticsRows])
    const oldestPendingHours = useMemo(() => {
        const waiting = analyticsRows.filter((row) => normalizeStatus(row.applicationStatus) === 'Pending').flatMap((row) => { const submitted = toDate(row.submittedAt); return submitted ? [dayjs().diff(submitted, 'hour', true)] : [] })
        return waiting.length ? Math.max(...waiting) : null
    }, [analyticsRows])
    const acceptanceRate = counts.accepted + counts.rejected ? Math.round((counts.accepted / (counts.accepted + counts.rejected)) * 100) : null
    const monthlySeries = useMemo(() => {
        const start = dayjs().startOf('month').subtract(11, 'month')
        const buckets: MonthBucket[] = Array.from({ length: 12 }, (_, index) => { const month = start.add(index, 'month'); return { key: month.format('YYYY-MM'), month, total: 0, Pending: 0, Accepted: 0, Rejected: 0 } })
        const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
        baseRows.forEach((row) => {
            const bucket = byKey.get(toDate(row.submittedAt)?.format('YYYY-MM') || '')
            if (bucket) { bucket[normalizeStatus(row.applicationStatus) as 'Pending' | 'Accepted' | 'Rejected'] += 1; bucket.total += 1 }
        })
        return buckets
    }, [baseRows])
    const monthMax = Math.max(1, ...monthlySeries.map((bucket) => bucket.total))
    const complianceAverage = useMemo(() => {
        const scored = analyticsRows.filter((row) => typeof row.complianceScore === 'number')
        return scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.complianceScore || 0), 0) / scored.length) : null
    }, [analyticsRows])

    useRegisterAgentPageContext({ pageKey: 'operations-applications', pageName: 'Applications', purpose: 'Review project applications and update decisions.', filters: { programme: activeProgramId, search, status, dateRange, province, beeLevel, gender }, metrics: { total: analyticsRows.length, ...counts }, tables: { visibleApplications: rows.length }, selectedRecord: selected?.businessName })

    const participantKey = selected?.participantId || ''
    useEffect(() => {
        if (!participantKey || !selected || selected.documents.length || participantKey in laterDocuments) return
        let cancelled = false
        loadApplicantComplianceDocuments(participantKey, user?.companyCode || undefined)
            .catch(() => [])
            .then((documents) => { if (!cancelled) setLaterDocuments((current) => ({ ...current, [participantKey]: documents })) })
        return () => { cancelled = true }
    }, [laterDocuments, participantKey, selected])

    const chooseApplication = (row: OperationsApplication) => {
        detailScrollRef.current?.scrollTo({ top: 0 })
        setSelected(row)
        setDetailOpen(true)
    }
    const applyDecision = async (row: OperationsApplication, next: string, reason = '') => {
        if (!user) return false
        try {
            setSaving(true)
            await updateOperationsApplicationStatus(user, row.id, next, reason)
            setApplications((current) => current.map((item) => item.id === row.id ? { ...item, applicationStatus: next, rejectionReason: next === 'Rejected' ? reason || undefined : undefined } : item))
            return true
        } catch {
            message.error(t('operations.applications.updateError'))
            return false
        } finally {
            setSaving(false)
        }
    }
    const leaveIfGone = (next: string) => { if (status !== 'All' && next !== status) setDetailOpen(false) }
    const acceptApplication = async (row: OperationsApplication) => {
        const previous = normalizeStatus(row.applicationStatus)
        if (!(await applyDecision(row, 'Accepted'))) return
        leaveIfGone('Accepted')
        message.success({
            duration: 6,
            content: <span>{t('operations.applications.accepted')}: {row.businessName} <Button type="link" size="small" onClick={() => void applyDecision(row, previous, row.rejectionReason || '')}>{t('Undo')}</Button></span>,
        })
    }
    const confirmDecline = async () => {
        if (!pendingUpdate) return
        const reason = rejectionReason.trim()
        if (!reason) { message.warning(t('Please provide a reason for rejection')); return }
        if (await applyDecision(pendingUpdate.row, 'Rejected', reason)) {
            message.success(t('operations.applications.updated'))
            leaveIfGone('Rejected')
            setPendingUpdate(undefined)
            setRejectionReason('')
        }
    }


    const hasAiReview = !!selected && (selected.aiScore !== undefined && selected.aiScore !== null || !!selected.aiRecommendation || !!selected.aiJustification)
    const documentsPending = !!selected && !selected.documents.length && !!participantKey && !(participantKey in laterDocuments)
    const documentChecklist = selected ? requiredDocumentChecklist({ ...selected, documents: selected.documents.length ? selected.documents : laterDocuments[participantKey] || [] }) : []
    const selectedStatus = selected ? normalizeStatus(selected.applicationStatus) : 'Pending'

    const details = selected ? (
        <motion.div
            key={selected.id}
            className="applications-detail-body"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
        >
            <div className="applications-detail-heading">
                <Space size={12} align="start"><Avatar src={selected.imageUrl} size={48}>{initialsOf(selected.businessName)}</Avatar><div><Typography.Title level={4}>{selected.businessName} <Tag className="applications-status-tag" color={statusColor(selectedStatus)}>{t(`operations.applications.${selectedStatus.toLowerCase()}`)}</Tag></Typography.Title><Typography.Text type="secondary">{selected.email}</Typography.Text></div></Space>
                                {canDecide && <div className="applications-decision-actions">
                {selectedStatus !== 'Accepted' && <Button type="primary" icon={<CheckCircleOutlined />} loading={saving} onClick={() => void acceptApplication(selected)}>{t('Accept')}</Button>}
                {selectedStatus !== 'Rejected' && <Button danger icon={<CloseCircleOutlined />} disabled={saving} onClick={() => { setRejectionReason(''); setPendingUpdate({ row: selected, status: 'Rejected' }) }}>{t('Decline')}</Button>}
                {selectedStatus !== 'Pending' && <Button type="link" disabled={saving} onClick={() => void applyDecision(selected, 'Pending')}>{t('Move to pending')}</Button>}
                </div>}
            </div>
            {selectedStatus === 'Rejected' && <Alert type="error" showIcon message={t('Reason for rejection')} description={selected.rejectionReason || t('No reason recorded')} />}
            {hasAiReview ? <div className="applications-ai-summary">
                <div className="applications-ai-head">
                    <div><Typography.Text type="secondary">{t('operations.applications.aiScore')}</Typography.Text><div className="applications-ai-score">{selected.aiScore ?? t('N/A')}</div></div>
                    <div><Typography.Text type="secondary">{t('operations.applications.aiRecommendation')}</Typography.Text><div><Tag color={statusColor(normalizeStatus(selected.aiRecommendation))}>{t(`operations.applications.${normalizeStatus(selected.aiRecommendation).toLowerCase()}`)}</Tag></div></div>
                    {selected.supportFitStatus ? <div><Typography.Text type="secondary">{t('Support fit')}</Typography.Text><div><Tag color={selected.supportFitStatus === 'await_review' ? 'orange' : 'green'}>{selected.supportFitStatus === 'await_review' ? t('External review') : t('Supported')}</Tag></div></div> : null}
                </div>
                <Typography.Paragraph type="secondary" className="applications-ai-justification">{selected.aiJustification || t('operations.applications.noJustification')}</Typography.Paragraph>
                {selected.externalInterventionSuggestions?.length ? <Alert type="warning" showIcon message={t('External intervention suggested')} description={selected.externalInterventionSuggestions.map((item) => item.title || item.reason || 'External support need').join(', ')} /> : null}
            </div> : <Typography.Text type="secondary">{t('operations.applications.noAiReview')}</Typography.Text>}
            <dl className="applications-facts">
                {[
                    [t('operations.applications.program'), selected.programName || t('common.unassigned')],
                    [t('operations.applications.applied'), toDate(selected.submittedAt)?.format('D MMM YYYY')],
                    [t('common.province'), selected.province],
                    [t('common.beeLevel'), selected.beeLevel],
                    [t('common.gender'), selected.gender],
                ].map(([label, value]) => <div key={label as string}><dt>{label}</dt><dd>{value || <span className="applications-fact-missing">{t('Not provided')}</span>}</dd></div>)}
            </dl>
            {[[t('operations.applications.motivation'), selected.motivation], [t('operations.applications.challenges'), selected.challenges]].map(([label, value]) => <div className="applications-answer" key={label as string}><Typography.Text strong>{label}</Typography.Text>{value ? <Typography.Paragraph>{value}</Typography.Paragraph> : <Typography.Text type="secondary" className="applications-fact-missing">{t('Not provided')}</Typography.Text>}</div>)}
            <div className="applications-documents">
                <Typography.Text strong>{t('operations.compliance.documents')}</Typography.Text>
                {documentsPending ? <Spin size="small" /> : documentChecklist.map((document) => <div className={`applications-document-row${document.url ? '' : ' is-missing'}`} key={document.key}><FileOutlined /><Typography.Text className="applications-document-name">{t(document.name)}</Typography.Text>{document.url ? <Button icon={<DownloadOutlined />} href={document.url} target="_blank">{t('common.download')}</Button> : <Tag color="error" icon={<WarningOutlined />}>{t('Missing')}</Tag>}</div>)}
            </div>
            {!canDecide && <Typography.Text type="secondary">{t('Operations or a project admin accepts or declines applications.')}</Typography.Text>}
        </motion.div>
    ) : <Empty description={t('operations.applications.select')} />

    return <DashboardPage className="applications-review-page">
        <div className='applications-status-strip'><Segmented block value={status} onChange={(value) => setStatus(String(value))} options={[{ value: 'Pending', label: <>{t('operations.applications.pending')} <span className='applications-status-count'>{counts.pending}</span></> }, { value: 'Accepted', label: <>{t('operations.applications.accepted')} <span className='applications-status-count'>{counts.accepted}</span></> }, { value: 'Rejected', label: <>{t('operations.applications.rejected')} <span className='applications-status-count'>{counts.rejected}</span></> }, { value: 'All', label: <>{t('operations.applications.all')} <span className='applications-status-count'>{analyticsRows.length}</span></> }]} /></div>
        <FilterBar advancedDisplay="dropdown" onReset={() => { setProvince('All'); setBeeLevel('All'); setGender('All') }} primary={<><Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('operations.applications.search')} allowClear /><RangePicker presets={DATE_PRESETS().map((preset) => ({ ...preset, label: t(preset.label) }))} value={dateRange} onChange={(value) => setDateRange(value as [Dayjs, Dayjs] | null)} /></>} advanced={<><Select value={province} onChange={setProvince} options={[{ value: 'All', label: t('operations.applications.allProvinces') }, ...uniqueOptions(applications, 'province')]} /><Select value={beeLevel} onChange={setBeeLevel} options={[{ value: 'All', label: t('operations.applications.allBeeLevels') }, ...uniqueOptions(applications, 'beeLevel')]} /><Select value={gender} onChange={setGender} options={[{ value: 'All', label: t('operations.applications.allGenders') }, ...uniqueOptions(applications, 'gender')]} /></>} actions={<Button icon={<BarChartOutlined />} onClick={() => setAnalyticsOpen(true)}>{t('operations.applications.analytics')}</Button>} />
        <div className={`compliance-workspace${detailOpen && selected ? ' compliance-workspace--detail' : ''}`}>
            <Card className="applications-panel compliance-participants">
                <Select className="compliance-list-sort" aria-label={t('Sort applications')} prefix={<span className="compliance-sort-prefix">{t('Sort by')}</span>} variant="borderless" value={sort} onChange={setSort} options={[
                    { value: 'newest', label: <Space size={8}><ClockCircleOutlined />{t('Newest first')}</Space> },
                    { value: 'score', label: <Space size={8}><TrophyOutlined />{t('Highest AI score')}</Space> },
                    { value: 'name', label: <Space size={8}><SortAscendingOutlined />{t('Name A–Z')}</Space> },
                ]} />
                <Spin spinning={loading}>
                    <nav className="compliance-participant-list" aria-label={t('Applications')}>
                        {pageRows.map((row) => <button type="button" key={row.id} className={`compliance-participant${row.id === selected?.id ? ' compliance-participant--selected' : ''}`} aria-current={row.id === selected?.id ? 'true' : undefined} onClick={() => chooseApplication(row)}>
                            <Avatar className="compliance-participant-avatar" src={row.imageUrl} size={36}>{initialsOf(row.businessName)}</Avatar>
                            <div className="compliance-participant-main">
                                <div className="compliance-participant-name" title={row.businessName}>{row.businessName}</div>
                                <div className="compliance-participant-meta" title={row.email}>{row.email || t('common.noEmail')}</div>
                                <div className="compliance-participant-meta">{toDate(row.submittedAt)?.format('D MMM YYYY') || t('N/A')}</div>
                            </div>
                            <div className="compliance-participant-side">
                                <span className={`compliance-score compliance-score--${Number(row.aiScore) >= 80 ? 'good' : Number(row.aiScore) >= 50 ? 'warning' : 'low'}`} title={t('operations.applications.aiScore')}>{row.aiScore ?? '—'}</span>
                                <Tag color={statusColor(normalizeStatus(row.applicationStatus))}>{t(`operations.applications.${normalizeStatus(row.applicationStatus).toLowerCase()}`)}</Tag>
                                {row.supportFitStatus === 'await_review' && <Tag color="orange">{t('External review')}</Tag>}
                            </div>
                        </button>)}
                        {!loading && !rows.length && <Empty description={t('operations.applications.empty')} />}
                    </nav>
                    {rows.length > 12 && <div className="compliance-list-pagination"><Pagination size="small" current={currentPage} total={rows.length} pageSize={12} showSizeChanger={false} showLessItems onChange={(page) => setListPage({ key: pageKey, page })} /></div>}
                </Spin>
            </Card>
            <Card className="applications-panel compliance-detail">
                <Button className="compliance-back" icon={<ArrowLeftOutlined />} onClick={() => setDetailOpen(false)}>{t('Back to applications')}</Button>
                <div className="applications-detail-scroll" ref={detailScrollRef}>{details}</div>
            </Card>
        </div>
        <ResponsiveModal open={canDecide && !!pendingUpdate} title={t('Decline application')} centered onClose={() => { setPendingUpdate(undefined); setRejectionReason('') }} footer={<Space style={{ display: 'flex', justifyContent: 'flex-end' }}><Button onClick={() => { setPendingUpdate(undefined); setRejectionReason('') }}>{t('Cancel')}</Button><Button type="primary" danger loading={saving} onClick={() => void confirmDecline()}>{t('Decline')}</Button></Space>}><strong>{pendingUpdate?.row.businessName}</strong><Input.TextArea style={{ marginTop: 12 }} rows={3} value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder={t('Reason for rejection')} maxLength={500} showCount /></ResponsiveModal>
        <ResponsiveModal open={analyticsOpen} title={t('operations.applications.analytics')} centered width={760} onClose={() => setAnalyticsOpen(false)} className="applications-analytics-modal">
            <div className="applications-analytics-scope">
                <Typography.Text type="secondary">{dateRange ? `${dateRange[0].format('D MMM YYYY')} – ${dateRange[1].format('D MMM YYYY')}` : t('All dates')}</Typography.Text>
                {dateRange && <Button type="link" size="small" onClick={() => setDateRange(null)}>{t('Clear dates')}</Button>}
            </div>
            <div className="applications-analytics-tiles">
                <div className="applications-analytics-tile"><span>{t('Received')}</span><strong>{analyticsRows.length}</strong></div>
                <div className="applications-analytics-tile"><span>{t('Acceptance rate')}</span><strong>{acceptanceRate === null ? '—' : `${acceptanceRate}%`}</strong></div>
                <div className="applications-analytics-tile"><span>{t('Median time to decision')}</span><strong>{formatDuration(medianDecisionHours, t)}</strong></div>
                <div className="applications-analytics-tile"><span>{t('Longest waiting')}</span><strong>{formatDuration(oldestPendingHours, t)}</strong></div>
                <div className="applications-analytics-tile"><span>{t('operations.applications.complianceScore')}</span><strong style={complianceAverage === null ? undefined : { color: complianceColor(complianceAverage) }}>{complianceAverage === null ? '—' : `${complianceAverage}%`}</strong></div>
            </div>
            <div className="applications-analytics-card">
                <Typography.Text strong>{t('Applications per month')}</Typography.Text>
                <Typography.Text type="secondary" className="applications-analytics-hint">{t('Last 12 months. Select a month to filter the list.')}</Typography.Text>
                <div className="applications-months">
                    {monthlySeries.map((bucket) => {
                        const active = !!dateRange && dateRange[0].isSame(bucket.month, 'month') && dateRange[1].isSame(bucket.month.endOf('month'), 'day')
                        return <button type="button" key={bucket.key} className={`applications-month${active ? ' is-active' : ''}${dateRange && (bucket.month.endOf('month').isBefore(dateRange[0]) || bucket.month.startOf('month').isAfter(dateRange[1])) ? ' is-outside' : ''}`} aria-pressed={active} title={`${bucket.month.format('MMMM YYYY')}: ${bucket.total}`} onClick={() => { setDateRange([bucket.month.startOf('month'), bucket.month.endOf('month')]); setStatus('All'); setAnalyticsOpen(false) }}>
                            <span className="applications-month-total">{bucket.total || ''}</span>
                            <span className="applications-month-track"><span className="applications-month-bar" style={{ height: `${(bucket.total / monthMax) * 100}%` }}>
                                {(['Accepted', 'Pending', 'Rejected'] as const).map((key) => bucket[key] ? <span key={key} className={`applications-month-segment is-${key.toLowerCase()}`} style={{ flexGrow: bucket[key] }} /> : null)}
                            </span></span>
                            <span className="applications-month-label">{bucket.month.format('MMM')}{bucket.month.month() === 0 || bucket.key === monthlySeries[0].key ? <small>{bucket.month.format('YY')}</small> : null}</span>
                        </button>
                    })}
                </div>
                <div className="applications-month-legend"><span className="is-accepted">{t('operations.applications.accepted')}</span><span className="is-pending">{t('operations.applications.pending')}</span><span className="is-rejected">{t('operations.applications.rejected')}</span></div>
            </div>
            <div className="applications-analytics-grid">
                {([['operations.applications.genderBreakdown', genderBreakdown], ['common.beeLevel', beeBreakdown], ['common.province', provinceBreakdown]] as const).map(([titleKey, items]) => (
                    <div className="applications-analytics-card" key={titleKey}>
                        <Typography.Text strong>{t(titleKey)}</Typography.Text>
                        {items.length
                            ? items.map((item) => (
                                <div className="applications-analytics-bar-row" key={item.label}>
                                    <span className="applications-analytics-bar-label" title={item.label}>{item.label}</span>
                                    <Progress percent={item.percent} strokeColor={item.color} showInfo={false} size="small" />
                                    <span className="applications-analytics-bar-value">{item.percent}% ({item.count})</span>
                                </div>
                            ))
                            : <Empty description={t('operations.applications.noData')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                    </div>
                ))}
            </div>
        </ResponsiveModal>
    </DashboardPage>
}
