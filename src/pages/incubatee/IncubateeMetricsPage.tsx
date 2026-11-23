import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert, App, Button, Card, Col, DatePicker, Empty, Form, Grid, InputNumber,
    Modal, Progress, Row, Segmented, Select, Skeleton, Space, Tag, Typography, Upload,
    theme,
} from 'antd'
import {
    ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, BarChartOutlined,
    CalendarOutlined, CheckCircleFilled, ClockCircleOutlined,
    CloseOutlined, CloudUploadOutlined, DollarCircleOutlined, FileTextOutlined, LineChartOutlined,
    PaperClipOutlined, ReloadOutlined, ShopOutlined, TeamOutlined, UsergroupAddOutlined,
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import {
    collection, doc, getDoc, getDocs, orderBy, query, setDoc,
    serverTimestamp, where,
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import dayjs, { type Dayjs } from 'dayjs'
import type { UploadFile } from 'antd/es/upload/interface'
import type Highcharts from 'highcharts'
import { auth, db, storage } from '@/firebase'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { tr, useLanguage } from '@/providers/LanguageProvider'
import '@/styles/monthly-performance.css'

const { Text } = Typography
const { useBreakpoint } = Grid

type SectionKey = 'revenue' | 'employees' | 'sales' | 'traffic' | 'networking'
type View = 'overview' | 'history' | 'analytics'
type Metrics = {
    revenue?: number
    headPermanent?: number
    headTemporary?: number
    orders?: number
    customers?: number
    traffic?: number
    networking?: number
}
type MonthlyRecord = Metrics & {
    id: string
    month: string
    reportedSections?: SectionKey[]
    revenueProofUrls?: string[]
    employeeProofUrls?: string[]
    createdAt?: unknown
    updatedAt?: unknown
}
type Participant = {
    id: string
    createdAt?: unknown
    revenueHistory?: { monthly?: Record<string, number> }
    headcountHistory?: { monthly?: Record<string, { permanent?: number; temporary?: number }> }
}
type ReportForm = Metrics & {
    monthKey: string
    revenueProof?: UploadFile[]
    employeeProof?: UploadFile[]
}
const SECTION_ITEMS: { key: SectionKey; icon: React.ReactNode; title: string; description: string; fields: (keyof Metrics)[] }[] = [
    { key: 'revenue', icon: <DollarCircleOutlined />, title: 'Revenue', description: 'Monthly turnover and financial evidence', fields: ['revenue'] },
    { key: 'employees', icon: <TeamOutlined />, title: 'Employment', description: 'Permanent and temporary jobs', fields: ['headPermanent', 'headTemporary'] },
    { key: 'sales', icon: <ShopOutlined />, title: 'Sales & customers', description: 'Orders and customers acquired', fields: ['orders', 'customers'] },
    { key: 'traffic', icon: <LineChartOutlined />, title: 'Website traffic', description: 'Visits recorded this month', fields: ['traffic'] },
    { key: 'networking', icon: <UsergroupAddOutlined />, title: 'Networking', description: 'Business events attended', fields: ['networking'] },
]
const ALL_MONTHS = Array.from({ length: 12 }, (_, i) => dayjs().month(i).format('MMMM'))
const monthId = (date: Dayjs) => date.format('MMMM YYYY')
const monthDate = (month: string) => {
    const parts = month.trim().split(/\s+/)
    const index = ALL_MONTHS.indexOf(parts[0])
    const year = Number(parts[1])
    if (index < 0 || !Number.isInteger(year) || year < 2000 || year > 2100) return null
    return dayjs(new Date(year, index, 1))
}
const dateFrom = (value: unknown): Dayjs | null => {
    if (!value) return null
    const item = value as { toDate?: () => Date; seconds?: number; _seconds?: number }
    const raw = typeof item.toDate === 'function' ? item.toDate()
        : typeof item.seconds === 'number' ? new Date(item.seconds * 1000)
            : typeof item._seconds === 'number' ? new Date(item._seconds * 1000)
                : value
    const parsed = dayjs(raw as string | number | Date)
    return parsed.isValid() ? parsed : null
}
const numberOrNull = (value: unknown): number | null =>
    value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value)
const money = (value: number | null | undefined) => value == null ? 'Not reported' : `R${value.toLocaleString('en-ZA', { maximumFractionDigits: 0 })}`
const count = (value: number | null | undefined) => value == null ? 'Not reported' : value.toLocaleString('en-ZA')
const monthWindow = (from: Dayjs, to: Dayjs) => {
    const result: string[] = []
    for (let m = from.startOf('month'); !m.isAfter(to, 'month'); m = m.add(1, 'month')) result.push(monthId(m))
    return result
}
const resolveParticipant = async (uid: string, email: string): Promise<Participant | null> => {
    const direct = await getDoc(doc(db, 'participants', uid))
    if (direct.exists()) return { id: direct.id, ...direct.data() } as Participant
    const lookups: [string, string][] = [
        ['uid', uid], ['userId', uid], ['participantId', uid], ['ownerUid', uid],
        ['email', email], ['email', email.toLowerCase()],
    ]
    // A lookup the rules can't prove (e.g. an email in different case, or unverified) is skipped, not fatal.
    const safeDocs = (field: string, coll: string, value: string) =>
        getDocs(query(collection(db, coll), where(field, '==', value))).then(s => s.docs).catch(() => [])
    for (const [key, value] of lookups) {
        const found = await safeDocs(key, 'participants', value)
        if (found.length) return { id: found[0].id, ...found[0].data() } as Participant
    }
    for (const [key, value] of [['uid', uid], ['userId', uid], ['email', email]]) {
        const found = { docs: await safeDocs(key, 'applications', value) }
        for (const app of found.docs) {
            const info = app.data()
            const pid = String(info.participantId || info.businessProfileId || info.applicantProfileId || '')
            if (!pid) continue
            const participant = await getDoc(doc(db, 'participants', pid))
            if (participant.exists()) return { id: participant.id, ...participant.data() } as Participant
        }
    }
    const business = await getDoc(doc(db, 'businessProfiles', uid))
    return business.exists() ? { id: business.id, ...business.data() } as Participant : null
}

/**
 * The files attached to an evidence field, listed full width under the amount and its upload button (which sit side
 * by side). Removing one updates the form field the Upload reads, so the two never disagree.
 */
const EvidenceFiles = ({ name }: { name: 'revenueProof' | 'employeeProof' }) => {
    const form = Form.useFormInstance<ReportForm>()
    const files = (Form.useWatch(name, form) as UploadFile[] | undefined) || []
    if (!files.length) return null
    const remove = (uid: string) => {
        form.setFieldValue(name, files.filter(file => file.uid !== uid))
        void form.validateFields([name]).catch(() => undefined)
    }
    return (
        <ul className="mp-evidence-files">
            {files.map(file => (
                <li key={file.uid}>
                    <PaperClipOutlined aria-hidden="true" />
                    <span className="mp-evidence-name">{file.name}</span>
                    {file.size ? <span className="mp-evidence-size">{Math.max(1, Math.round(file.size / 1024))} KB</span> : null}
                    <Button type="text" size="small" icon={<CloseOutlined />} aria-label={`${tr('Remove')} ${file.name}`} onClick={() => remove(file.uid)} />
                </li>
            ))}
        </ul>
    )
}

const MetricTile = ({ title, value, icon, hint, trend }: {
    title: string; value: string; icon: React.ReactNode; hint: string; trend?: number | null
}) => (
    <Card className="mp-metric" bordered>
        <div className="mp-metric-top"><Text type="secondary">{tr(title)}</Text><span className="mp-metric-icon">{icon}</span></div>
        <div className="mp-metric-value">{value}</div>
        <div className="mp-metric-foot"><Text type="secondary">{tr(hint)}</Text>
            {trend != null && <Tag color={trend > 0 ? 'success' : trend < 0 ? 'error' : 'default'} bordered={false}>
                {trend > 0 ? <ArrowUpOutlined /> : trend < 0 ? <ArrowDownOutlined /> : null} {Math.abs(trend).toFixed(1)}%
            </Tag>}
        </div>
    </Card>
)

export const MonthlyPerformanceForm: React.FC = () => {
    useLanguage()
    const { message } = App.useApp()
    const { token } = theme.useToken()
    const bp = useBreakpoint()
    const mobile = !bp.md
    const [form] = Form.useForm<ReportForm>()
    const [participant, setParticipant] = useState<Participant | null>(null)
    const [userEmail, setUserEmail] = useState('')
    const [records, setRecords] = useState<MonthlyRecord[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [failure, setFailure] = useState<string | null>(null)
    const [view, setView] = useState<View>('overview')
    const [modalOpen, setModalOpen] = useState(false)
    const [reportStep, setReportStep] = useState<'sections' | 'fields'>('sections')
    const [selectedSections, setSelectedSections] = useState<SectionKey[]>(['revenue', 'employees', 'sales'])
    const [selectedMonth, setSelectedMonth] = useState(monthId(dayjs()))
    const [detail, setDetail] = useState<MonthlyRecord | null>(null)
    const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs().endOf('year')])
    const [uploadPercent, setUploadPercent] = useState(0)

    const fetchRecords = useCallback(async (pid: string) => {
        const snapshot = await getDocs(query(collection(db, 'monthlyPerformance', pid, 'history'), orderBy('createdAt', 'desc')))
        setRecords(snapshot.docs.map(row => ({ ...row.data(), id: row.id, month: String(row.data().month || row.id) } as MonthlyRecord)))
    }, [])

    useEffect(() => {
        let active = true
        const unsub = auth.onAuthStateChanged(async user => {
            if (!user) { if (active) { setLoading(false); setFailure(tr('Please sign in to view your performance.')) }; return }
            if (!user.email) { if (active) { setLoading(false); setFailure(tr('Your account needs an email address.')) }; return }
            try {
                setLoading(true)
                const resolved = await resolveParticipant(user.uid, user.email)
                if (!active) return
                if (!resolved) { setFailure(tr('We could not find your business profile. Contact your programme coordinator.')); return }
                setParticipant(resolved)
                setUserEmail(user.email)
                await fetchRecords(resolved.id)
                if (active) setFailure(null)
            } catch (error) {
                console.error('Monthly performance load failed', error)
                if (active) setFailure(tr('Unable to load your performance right now. Please try again.'))
            } finally { if (active) setLoading(false) }
        })
        return () => { active = false; unsub() }
    }, [fetchRecords])

    const sorted = useMemo(() => [...records].sort((a, b) =>
        (monthDate(b.month)?.valueOf() ?? 0) - (monthDate(a.month)?.valueOf() ?? 0)), [records])
    const recordMap = useMemo(() => new Map(records.map(r => [r.month, r])), [records])
    const baseline = dateFrom(participant?.createdAt)
    // A date from the programme application is not necessarily the acceptance date.
    // Start from the participant's profile creation when known; don't label this as acceptance.
    const reportingStart = baseline ? baseline.startOf('month') : dayjs().startOf('year')
    const missingMonths = useMemo(() => monthWindow(reportingStart, dayjs()).filter(m => !recordMap.has(m)), [recordMap, reportingStart.valueOf()])
    const visible = useMemo(() => sorted.filter(row => {
        const date = monthDate(row.month)
        return date && !date.isBefore(range[0], 'month') && !date.isAfter(range[1], 'month')
    }), [sorted, range])

    const monthlyValue = useCallback((month: string, key: keyof Metrics): number | null => {
        const uploaded = numberOrNull(recordMap.get(month)?.[key])
        if (uploaded != null) return uploaded
        // Previous participant baseline fields are month-name keyed, without a year.
        // Only apply them to the participant's creation year to avoid repeating old data every year.
        const d = monthDate(month)
        if (!d || !baseline || d.year() !== baseline.year()) return null
        if (key === 'revenue') return numberOrNull(participant?.revenueHistory?.monthly?.[d.format('MMMM')])
        if (key === 'headPermanent') return numberOrNull(participant?.headcountHistory?.monthly?.[d.format('MMMM')]?.permanent)
        if (key === 'headTemporary') return numberOrNull(participant?.headcountHistory?.monthly?.[d.format('MMMM')]?.temporary)
        return null
    }, [recordMap, participant, baseline?.valueOf()])

    const chartMonths = useMemo(() => monthWindow(range[0], range[1]).filter(m => !!monthDate(m)), [range])
    const timeline = useMemo(() => chartMonths.map(month => ({
        month,
        revenue: monthlyValue(month, 'revenue'),
        permanent: monthlyValue(month, 'headPermanent'),
        temporary: monthlyValue(month, 'headTemporary'),
        orders: monthlyValue(month, 'orders'),
        customers: monthlyValue(month, 'customers'),
    })), [chartMonths, monthlyValue])
    const latestReported = sorted.find(r => SECTION_ITEMS.some(s => s.fields.some(f => numberOrNull(r[f]) != null)))
    const latestMonth = latestReported?.month ?? null
    const latestRevenue = latestMonth ? monthlyValue(latestMonth, 'revenue') : null
    const previousRevenue = latestMonth ? monthlyValue(monthId(monthDate(latestMonth)!.subtract(1, 'month')), 'revenue') : null
    const revenueChange = latestRevenue != null && previousRevenue != null && previousRevenue !== 0
        ? ((latestRevenue - previousRevenue) / previousRevenue) * 100 : null
    const latestPermanent = latestMonth ? monthlyValue(latestMonth, 'headPermanent') : null
    const latestTemporary = latestMonth ? monthlyValue(latestMonth, 'headTemporary') : null
    const employees = latestPermanent == null && latestTemporary == null ? null : (latestPermanent ?? 0) + (latestTemporary ?? 0)
    const totalOrders = visible.reduce((acc, r) => acc + (numberOrNull(r.orders) ?? 0), 0)
    const latestCustomers = sorted.find(r => numberOrNull(r.customers) != null)
    const lastCustomerValue = latestCustomers ? numberOrNull(latestCustomers.customers) : null
    const thisMonthReport = recordMap.get(monthId(dayjs()))
    const monthReported = thisMonthReport?.reportedSections?.length ?? SECTION_ITEMS.filter(s => s.fields.some(f => numberOrNull(thisMonthReport?.[f]) != null)).length
    const completion = Math.round(monthReported / SECTION_ITEMS.length * 100)

    const chartBase: Highcharts.Options = {
        chart: { backgroundColor: 'transparent', height: mobile ? 250 : 290, spacing: [12, 8, 12, 8] },
        credits: { enabled: false }, title: { text: undefined },
        xAxis: { categories: timeline.map(m => monthDate(m.month)!.format('MMM YY')) },
        legend: { enabled: !mobile },
        responsive: { rules: [{ condition: { maxWidth: 500 }, chartOptions: { legend: { enabled: false } } }] },
    }
    const revenueChart: Highcharts.Options = {
        ...chartBase, chart: { ...chartBase.chart, type: 'areaspline' },
        yAxis: { title: { text: undefined }, min: 0 },
        tooltip: { shared: true, valuePrefix: 'R', valueDecimals: 0 },
        plotOptions: { areaspline: { fillOpacity: 0.1, marker: { enabled: false } } },
        series: [{ type: 'areaspline', name: tr('Revenue'), data: timeline.map(m => m.revenue) }],
    }
    const employeeChart: Highcharts.Options = {
        ...chartBase, chart: { ...chartBase.chart, type: 'column' },
        yAxis: { title: { text: undefined }, allowDecimals: false, min: 0 },
        plotOptions: { column: { stacking: 'normal', borderRadius: 4 } },
        series: [
            { type: 'column', name: tr('Permanent'), data: timeline.map(m => m.permanent) },
            { type: 'column', name: tr('Temporary'), data: timeline.map(m => m.temporary) },
        ],
    }
    const customerChart: Highcharts.Options = {
        ...chartBase, yAxis: [{ title: { text: undefined }, min: 0 }, { title: { text: undefined }, opposite: true, min: 0 }],
        tooltip: { shared: true },
        series: [
            { type: 'column', name: tr('Orders'), data: timeline.map(m => m.orders), yAxis: 0 },
            { type: 'spline', name: tr('New customers'), data: timeline.map(m => m.customers), yAxis: 1 },
        ],
    }

    const openReport = (month?: string) => {
        const selected = month ?? missingMonths[0] ?? monthId(dayjs())
        const current = recordMap.get(selected)
        setSelectedMonth(selected)
        form.resetFields()
        const fields: Partial<ReportForm> = { monthKey: selected }
        SECTION_ITEMS.forEach(section => section.fields.forEach(key => {
            const v = numberOrNull(current?.[key])
            if (v != null) fields[key] = v
        }))
        form.setFieldsValue(fields)
        const available = SECTION_ITEMS.filter(section => section.fields.some(key => numberOrNull(current?.[key]) != null)).map(s => s.key)
        setSelectedSections(available.length ? available : ['revenue', 'employees', 'sales'])
        setReportStep('sections')
        setUploadPercent(0)
        setModalOpen(true)
    }
    const fileList = (value?: UploadFile[]) => Array.isArray(value) ? value : []
    const uploadFiles = async (files: UploadFile[], kind: 'revenue' | 'employee', month: string) => {
        if (!participant) throw new Error('Business profile unavailable')
        const urls: string[] = []
        for (const file of files) {
            if (!file.originFileObj) continue
            const clean = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
            const storageRef = ref(storage, `monthlyPerformance/${participant.id}/${month}/${kind}-${Date.now()}-${clean}`)
            await uploadBytes(storageRef, file.originFileObj)
            urls.push(await getDownloadURL(storageRef))
        }
        return urls
    }
    const submitReport = async (values: ReportForm) => {
        if (!participant || !userEmail) return message.error(tr('Business identity is unavailable.'))
        if (!selectedSections.length) return message.warning(tr('Choose at least one section.'))
        const month = values.monthKey
        if (!monthDate(month) || monthDate(month)!.isAfter(dayjs(), 'month')) return message.error(tr('Select a valid reporting month.'))
        try {
            setSaving(true)
            setUploadPercent(10)
            const old = recordMap.get(month)
            const payload: Partial<Metrics> = {}
            SECTION_ITEMS.filter(section => selectedSections.includes(section.key)).forEach(section => section.fields.forEach(key => {
                const figure = numberOrNull(values[key])
                if (figure != null) payload[key] = figure
            }))
            const revenueProof = selectedSections.includes('revenue') ? fileList(values.revenueProof) : []
            const employeeProof = selectedSections.includes('employees') ? fileList(values.employeeProof) : []
            const urlsRevenue = await uploadFiles(revenueProof, 'revenue', month)
            setUploadPercent(45)
            const urlsEmployee = await uploadFiles(employeeProof, 'employee', month)
            setUploadPercent(70)
            const previousSections = old?.reportedSections ?? SECTION_ITEMS.filter(s => s.fields.some(f => numberOrNull(old?.[f]) != null)).map(s => s.key)
            await setDoc(doc(db, 'monthlyPerformance', participant.id), {
                participantId: participant.id, email: userEmail, updatedAt: serverTimestamp(),
            }, { merge: true })
            await setDoc(doc(db, 'monthlyPerformance', participant.id, 'history', month), {
                month,
                ...payload,
                reportedSections: [...new Set([...previousSections, ...selectedSections])],
                ...(urlsRevenue.length && { revenueProofUrls: [...(old?.revenueProofUrls || []), ...urlsRevenue] }),
                ...(urlsEmployee.length && { employeeProofUrls: [...(old?.employeeProofUrls || []), ...urlsEmployee] }),
                ...(revenueProof.length && { revenueProofMeta: revenueProof.filter(f => f.originFileObj).map(f => ({ name: f.name, size: f.size, type: f.type })) }),
                ...(employeeProof.length && { employeeProofMeta: employeeProof.filter(f => f.originFileObj).map(f => ({ name: f.name, size: f.size, type: f.type })) }),
                ...(!old && { createdAt: serverTimestamp() }),
                updatedAt: serverTimestamp(),
            }, { merge: true })
            setUploadPercent(100)
            await fetchRecords(participant.id)
            setModalOpen(false)
            message.success(tr('Monthly performance saved successfully.'))
        } catch (error) {
            console.error('Save monthly performance failed', error)
            message.error(tr('Unable to save the report. Check your connection and try again.'))
        } finally { setSaving(false) }
    }

    const chartPanel = (heading: string, subtitle: string, options: Highcharts.Options, icon: React.ReactNode) => (
        <Card className="mp-panel" title={<Space>{icon}<span>{tr(heading)}</span></Space>}
            extra={<Text type="secondary" className="mp-panel-subtitle">{tr(subtitle)}</Text>}>
            <ThemedHighcharts immutable options={options} />
        </Card>
    )
    const historicRow = (record: MonthlyRecord) => {
        const perm = numberOrNull(record.headPermanent)
        const temp = numberOrNull(record.headTemporary)
        const headcount = perm == null && temp == null ? null : (perm ?? 0) + (temp ?? 0)
        const reported = SECTION_ITEMS.filter(s => s.fields.some(f => numberOrNull(record[f]) != null)).length
        return <button key={record.id} type="button" className="mp-history-row" onClick={() => setDetail(record)}>
            <div className="mp-history-date"><span className="mp-history-month">{record.month}</span><span className="mp-history-coverage">{reported} {tr('of 5 categories')}</span></div>
            <div className="mp-history-number"><small>{tr('Revenue')}</small><strong>{money(numberOrNull(record.revenue))}</strong></div>
            <div className="mp-history-number"><small>{tr('Employees')}</small><strong>{count(headcount)}</strong></div>
            <div className="mp-history-number"><small>{tr('New customers')}</small><strong>{count(numberOrNull(record.customers))}</strong></div>
            <ArrowRightOutlined className="mp-row-arrow" />
        </button>
    }

    return <DashboardPage className="incubatee-page mp-page">
        <Helmet><title>{tr('Business Performance | Smart Incubation')}</title></Helmet>

        {failure ? <Alert type="error" showIcon message={failure} action={<Button icon={<ReloadOutlined />} onClick={() => window.location.reload()}>{tr('Retry')}</Button>} /> : null}
        {loading ? <div className="mp-loading"><Skeleton active paragraph={{ rows: 3 }} /><Skeleton active paragraph={{ rows: 4 }} /></div> : participant && <>
            <div className="mp-status-bar">
                <div className="mp-status-copy">
                    <span className={`mp-status-mark ${monthReported ? 'is-done' : ''}`}>{monthReported ? <CheckCircleFilled /> : <ClockCircleOutlined />}</span>
                    <div><strong>{monthReported ? tr('This month is underway') : tr('Your monthly check-in is ready')}</strong>
                        <Text type="secondary">{dayjs().format('MMMM YYYY')} · {monthReported} {tr('of 5 sections reported')}</Text></div>
                </div>
                <div className="mp-status-progress"><Progress percent={completion} size="small" showInfo={false} /><Text type="secondary">{completion}%</Text></div>
                <Button type="default" onClick={() => openReport(monthId(dayjs()))}>{monthReported ? tr('Continue update') : tr('Start check-in')} <ArrowRightOutlined /></Button>
            </div>

            <Row gutter={[12, 12]} className="mp-metrics">
                <Col xs={12} lg={6}><MetricTile title="Latest revenue" value={money(latestRevenue)} icon={<DollarCircleOutlined />} hint={latestMonth || 'No report yet'} trend={revenueChange} /></Col>
                <Col xs={12} lg={6}><MetricTile title="Employees" value={count(employees)} icon={<TeamOutlined />} hint="Latest reported headcount" /></Col>
                <Col xs={12} lg={6}><MetricTile title="New customers" value={count(lastCustomerValue)} icon={<UsergroupAddOutlined />} hint={latestCustomers?.month || 'No report yet'} /></Col>
                <Col xs={12} lg={6}><MetricTile title="Months outstanding" value={String(missingMonths.length)} icon={<CalendarOutlined />} hint="Pending monthly reports" /></Col>
            </Row>

            <div className="mp-toolbar">
                <Segmented block={mobile} value={view} onChange={v => setView(v as View)} options={[
                    { label: tr('Overview'), value: 'overview', icon: <LineChartOutlined /> },
                    { label: tr('History'), value: 'history', icon: <CalendarOutlined /> },
                    { label: tr('Analytics'), value: 'analytics', icon: <BarChartOutlined /> },
                ]} />
                <DatePicker.RangePicker size="middle" picker="month" value={range} allowClear={false} onChange={dates => {
                    if (!dates?.[0] || !dates?.[1]) return
                    setRange([dates[0], dates[1]])
                }} />
            </div>

            {view === 'overview' && <div className="mp-content-grid">
                <div className="mp-main-stack">
                    {chartPanel('Revenue over time', 'Monthly turnover (ZAR)', revenueChart, <DollarCircleOutlined />)}
                    <Card className="mp-panel" title={tr('Recent reports')} extra={<Button type="link" onClick={() => setView('history')}>{tr('View all')} <ArrowRightOutlined /></Button>}>
                        {visible.length ? visible.slice(0, 4).map(historicRow) : <Empty description={tr('No reports in this period')} />}
                    </Card>
                </div>
                <div className="mp-side-stack">
                    <Card className="mp-panel mp-checklist" title={tr('Your reporting checklist')}>
                        <Text type="secondary">{tr('Choose a section to update your current month.')}</Text>
                        {SECTION_ITEMS.map(item => {
                            const complete = item.fields.every(key => numberOrNull(thisMonthReport?.[key]) != null)
                            return <button className="mp-checklist-item" key={item.key} type="button" onClick={() => {
                                openReport(monthId(dayjs())); setSelectedSections([item.key]); setReportStep('fields')
                            }}><span className="mp-checklist-icon">{item.icon}</span><span>{tr(item.title)}</span>
                                {complete ? <CheckCircleFilled style={{ color: token.colorSuccess }} /> : <ArrowRightOutlined />}</button>
                        })}
                    </Card>
                    <Card className="mp-panel mp-impact" title={tr('Your progress at a glance')}>
                        <div className="mp-impact-stat"><span>{tr('Reports submitted')}</span><strong>{records.length}</strong></div>
                        <div className="mp-impact-stat"><span>{tr('Orders in selected period')}</span><strong>{count(totalOrders)}</strong></div>
                        <div className="mp-impact-stat"><span>{tr('Reporting sections this month')}</span><strong>{monthReported} / 5</strong></div>
                        <Text type="secondary" className="mp-impact-note">{tr('These are reported business figures, not independently verified results.')}</Text>
                    </Card>
                </div>
            </div>}

            {view === 'history' && <Card className="mp-panel" title={tr('Monthly performance history')} extra={<Text type="secondary">{visible.length} {tr('reports')}</Text>}>
                {visible.length ? visible.map(historicRow) : <Empty description={tr('No monthly reports for this period')} />}
            </Card>}

            {view === 'analytics' && <div className="mp-chart-grid">
                {chartPanel('Revenue trend', 'Monthly turnover (ZAR)', revenueChart, <DollarCircleOutlined />)}
                {chartPanel('Employee composition', 'Permanent and temporary', employeeChart, <TeamOutlined />)}
                <div className="mp-chart-wide">{chartPanel('Orders and new customers', 'Monthly activity', customerChart, <ShopOutlined />)}</div>
            </div>}
        </>}

        <Modal centered open={!!detail} onCancel={() => setDetail(null)} title={detail?.month} footer={<Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={() => setDetail(null)}>{tr('Close')}</Button>
            <Button type="primary" onClick={() => { const month = detail?.month; setDetail(null); if (month) openReport(month) }}>{tr('Update this month')}</Button>
        </Space>}>
            {detail && <div className="mp-detail-grid">{SECTION_ITEMS.map(s => <div key={s.key} className="mp-detail-item"><span>{s.icon} {tr(s.title)}</span><strong>{s.fields.map(f => {
                const v = numberOrNull(detail[f]); return f === 'revenue' ? money(v) : count(v)
            }).join(' / ')}</strong></div>)}
                {(detail.revenueProofUrls?.length || detail.employeeProofUrls?.length) ? <div className="mp-detail-evidence"><Text strong>{tr('Supporting documents')}</Text>
                    {[...(detail.revenueProofUrls || []), ...(detail.employeeProofUrls || [])].map((url, i) => <a href={url} rel="noopener noreferrer" target="_blank" key={`${url}-${i}`}><FileTextOutlined /> {tr('Open document')} {i + 1}</a>)}
                </div> : null}
            </div>}
        </Modal>

        <Modal centered className="mp-report-modal" open={modalOpen} onCancel={() => !saving && setModalOpen(false)} closable={!saving}
            width={reportStep === 'sections' ? 610 : 690}
            title={<div className="mp-modal-title">{tr('Update business performance')}</div>}
            footer={<div className="mp-modal-footer">
                {reportStep === 'sections' ? <>
                    <Button onClick={() => setModalOpen(false)}>{tr('Cancel')}</Button>
                    <Button type="primary" disabled={!selectedSections.length} onClick={() => setReportStep('fields')}>{tr('Continue')} <ArrowRightOutlined /></Button>
                </> : <><Button disabled={saving} onClick={() => setReportStep('sections')}>{tr('Back')}</Button>
                    <Button type="primary" loading={saving} onClick={() => form.submit()} icon={<CloudUploadOutlined />}>{tr('Save report')}</Button></>}
            </div>}>
            <div className="mp-modal-body">
                <div className="mp-modal-steps"><span className={reportStep === 'sections' ? 'active' : ''}>1. {tr('Choose sections')}</span><span className={reportStep === 'fields' ? 'active' : ''}>2. {tr('Enter figures')}</span></div>
                {reportStep === 'sections' ? <>
                    <Text type="secondary">{tr('Select only what you can report. Unreported figures stay empty, not zero.')}</Text>
                    <div className="mp-section-picker">{SECTION_ITEMS.map(section => {
                        const checked = selectedSections.includes(section.key)
                        return <button type="button" key={section.key} aria-pressed={checked} className={`mp-section-choice ${checked ? 'selected' : ''}`} onClick={() => setSelectedSections(prev => checked ? prev.filter(v => v !== section.key) : [...prev, section.key])}>
                            <span className="mp-section-icon">{section.icon}</span><span className="mp-section-copy"><strong>{tr(section.title)}</strong><small>{tr(section.description)}</small></span>
                            {checked ? <CheckCircleFilled /> : <span className="mp-empty-check" />}
                        </button>
                    })}</div>
                </> : <Form<ReportForm> form={form} layout="vertical" requiredMark={false} onFinish={submitReport}>
                    <Form.Item name="monthKey" label={tr('Reporting month')} rules={[{ required: true }]}>
                        <Select showSearch options={monthWindow(reportingStart, dayjs()).reverse().map(month => ({ label: month, value: month }))} onChange={m => {
                            setSelectedMonth(m)
                            const existing = recordMap.get(m)
                            const updates: Partial<ReportForm> = { monthKey: m }
                            SECTION_ITEMS.forEach(s => s.fields.forEach(key => { updates[key] = numberOrNull(existing?.[key]) ?? undefined }))
                            form.setFieldsValue(updates)
                        }} />
                    </Form.Item>
                    <Text type="secondary" className="mp-form-hint">{tr('Figures are saved for')} {selectedMonth}. {tr('Previously submitted fields are preserved unless you update them.')}</Text>
                    {selectedSections.includes('revenue') && <div className="mp-form-section"><div className="mp-form-section-title"><DollarCircleOutlined /> {tr('Revenue')}</div>
                        {/* The amount and its evidence side by side; the attached files are listed underneath both. */}
                        <div className="mp-amount-evidence">
                            <Form.Item label={tr('Turnover for this month (R)')} name="revenue" rules={[{ required: true, message: tr('Enter this month’s revenue') }]}><InputNumber className="mp-input" min={0} precision={2} controls={false} placeholder="0.00" /></Form.Item>
                            <Form.Item name="revenueProof" label={tr('Bank statement / revenue evidence')} valuePropName="fileList" getValueFromEvent={event => Array.isArray(event) ? event : event?.fileList} rules={[{
                                validator: async (_, value) => {
                                    const hasOld = Boolean(recordMap.get(form.getFieldValue('monthKey'))?.revenueProofUrls?.length)
                                    if (!hasOld && !fileList(value).length) throw new Error(tr('Attach supporting evidence'))
                                },
                            }]}><Upload beforeUpload={() => false} multiple maxCount={5} accept=".pdf,.jpg,.jpeg,.png" showUploadList={false} className="mp-evidence-upload"><Button block icon={<CloudUploadOutlined />}>{tr('Attach evidence')}</Button></Upload></Form.Item>
                        </div>
                        <EvidenceFiles name="revenueProof" />
                    </div>}
                    {selectedSections.includes('employees') && <div className="mp-form-section"><div className="mp-form-section-title"><TeamOutlined /> {tr('Employment')}</div>
                        {/* Both head counts and their evidence on one row (evidence drops to its own row on phones); files listed underneath. */}
                        <div className="mp-amount-evidence is-three">
                        <Form.Item name="headPermanent" label={tr('Permanent')} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="mp-input" /></Form.Item>
                        <Form.Item name="headTemporary" label={tr('Temporary')} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="mp-input" /></Form.Item>
                        <Form.Item shouldUpdate={(prev, next) => prev.headPermanent !== next.headPermanent || prev.headTemporary !== next.headTemporary} noStyle>{({ getFieldValue }) => {
                            const headcount = (numberOrNull(getFieldValue('headPermanent')) ?? 0) + (numberOrNull(getFieldValue('headTemporary')) ?? 0)
                            return <Form.Item name="employeeProof" label={tr('Contracts or payslips')} valuePropName="fileList" getValueFromEvent={event => Array.isArray(event) ? event : event?.fileList} rules={[{
                                validator: async (_, value) => {
                                    const hasOld = Boolean(recordMap.get(form.getFieldValue('monthKey'))?.employeeProofUrls?.length)
                                    if (headcount > 0 && !hasOld && !fileList(value).length) throw new Error(tr('Attach employee evidence'))
                                },
                            }]}><Upload beforeUpload={() => false} multiple maxCount={5} accept=".pdf,.jpg,.jpeg,.png" disabled={headcount === 0} showUploadList={false} className="mp-evidence-upload"><Button block disabled={headcount === 0} icon={<CloudUploadOutlined />}>{tr('Attach evidence')}</Button></Upload></Form.Item>
                        }}</Form.Item>
                        </div>
                        <EvidenceFiles name="employeeProof" />
                    </div>}
                    {selectedSections.includes('sales') && <div className="mp-form-section"><div className="mp-form-section-title"><ShopOutlined /> {tr('Sales and customers')}</div><Row gutter={12}>
                        <Col xs={12}><Form.Item name="orders" label={tr('Orders submitted')} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="mp-input" /></Form.Item></Col>
                        <Col xs={12}><Form.Item name="customers" label={tr('New customers')} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="mp-input" /></Form.Item></Col>
                    </Row></div>}
                    {selectedSections.includes('traffic') && <div className="mp-form-section"><div className="mp-form-section-title"><LineChartOutlined /> {tr('Website traffic')}</div><Form.Item name="traffic" label={tr('Website visits this month')} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="mp-input" /></Form.Item></div>}
                    {selectedSections.includes('networking') && <div className="mp-form-section"><div className="mp-form-section-title"><UsergroupAddOutlined /> {tr('Networking')}</div><Form.Item name="networking" label={tr('Events attended this month')} rules={[{ required: true }]}><InputNumber min={0} precision={0} className="mp-input" /></Form.Item></div>}
                    {saving && <Progress percent={uploadPercent} size="small" status={uploadPercent === 100 ? 'success' : 'active'} />}
                </Form>}
            </div>
        </Modal>
    </DashboardPage >
}

export default MonthlyPerformanceForm
