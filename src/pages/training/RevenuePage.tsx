import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, AutoComplete, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { DeleteOutlined, DollarOutlined, EditOutlined, PlusOutlined, RiseOutlined, WalletOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type Highcharts from 'highcharts'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { FunderSelect } from '@/components/training/FunderSelect'
import { CLIENT_MODULES } from '@/config/clientModules'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { addRevenue, deleteRevenue, listRevenue, updateRevenue } from '@/services/clientRevenueService'
import { listEsgReports } from '@/services/esgReportsService'
import { listCompanyTrainingLearners, listTrainingClasses } from '@/services/trainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel, rand } from '@/utils/trainingFormat'
import type { ClientRevenueEntry, ClientRevenueValues, RevenueService } from '@/types/clientRevenue'
import type { EsgReport } from '@/types/esg'
import type { TrainingClass } from '@/types/training'


const SERVICE_COLOURS: Record<RevenueService, string> = { training: 'blue', esg_reporting: 'green', other: 'default' }

type FormValues = Omit<ClientRevenueValues, 'date' | 'paidOn'> & { date: Dayjs, paidOn?: Dayjs }

const RevenueFormModal = ({ entry, classes, reports, organisations, onClose, onSaved }: {
    entry?: ClientRevenueEntry
    classes: TrainingClass[]
    reports: EsgReport[]
    organisations: string[]
    onClose: () => void
    onSaved: () => void
}) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<FormValues>()
    const [saving, setSaving] = useState(false)
    const service = Form.useWatch('service', form)
    const status = Form.useWatch('status', form)

    useEffect(() => {
        form.setFieldsValue({
            date: entry?.date ? dayjs(entry.date) : dayjs(),
            organisation: entry?.organisation || '',
            service: entry?.service || 'training',
            classId: entry?.classId,
            reportId: entry?.reportId,
            funderId: entry?.funderId,
            description: entry?.description || '',
            amount: entry?.amount ?? 0,
            status: entry?.status || 'invoiced',
            paidOn: entry?.paidOn ? dayjs(entry.paidOn) : undefined,
        })
    }, [entry, form])

    const submit = async () => {
        if (!user) return
        const values = await form.validateFields()
        const payload: ClientRevenueValues = { ...values, date: values.date.format('YYYY-MM-DD'), paidOn: values.paidOn?.format('YYYY-MM-DD') }
        setSaving(true)
        try {
            if (entry) await updateRevenue(user, entry.id, payload)
            else await addRevenue(user, payload)
            message.success(entry ? t('Income updated.') : t('Income recorded.'))
            onSaved()
        } catch {
            message.error(t('The income could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal open title={entry ? t('Edit income') : t('Record income')} okText={t('Save')} confirmLoading={saving} onOk={() => void submit()} onCancel={onClose} width={600}>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Row gutter={12}>
                    <Col xs={24} sm={12}><Form.Item name="date" label={t('Invoice date')} rules={[{ required: true }]}><DatePicker style={{ width: '100%' }} format="D MMM YYYY" /></Form.Item></Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="service" label={t('For')}>
                            <Select options={[{ value: 'training', label: t('Training') }, { value: 'esg_reporting', label: t('ESG reporting') }, { value: 'other', label: t('Other') }]} />
                        </Form.Item>
                    </Col>
                </Row>
                <Form.Item name="organisation" label={t('Client organisation')} rules={[{ required: true, whitespace: true, message: t('Enter who was invoiced.') }]}>
                    <AutoComplete options={organisations.map((value) => ({ value }))} filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} maxLength={160} />
                </Form.Item>
                {service === 'training' && (
                    <Form.Item name="classId" label={t('Class (optional)')}>
                        <Select allowClear options={classes.map((item) => ({ value: item.id, label: `${item.courseTitle} · ${classDatesLabel(item)}` }))} />
                    </Form.Item>
                )}
                {service === 'esg_reporting' && (
                    <Form.Item name="reportId" label={t('ESG report (optional)')}>
                        <Select allowClear options={reports.map((item) => ({ value: item.id, label: `${item.clientName} · ${item.periodEnd.slice(0, 4)}` }))} />
                    </Form.Item>
                )}
                <Form.Item name="funderId" label={t('Funded by (optional)')} extra={t('Leave empty to follow the class or report it is for.')}>
                    <FunderSelect placeholder={t('From its class or report')} />
                </Form.Item>
                <Form.Item name="description" label={t('Description')}><Input maxLength={200} placeholder={t('e.g. 5 learners, ESG Awareness Training')} /></Form.Item>
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item name="amount" label={t('Amount (ZAR)')} rules={[{ required: true }, { type: 'number', min: 0.01, message: t('Enter the amount.') }]}>
                            <InputNumber style={{ width: '100%' }} min={0} step={100} prefix="R" />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name="status" label={t('Status')}>
                            <Select options={[{ value: 'invoiced', label: t('Invoiced, not paid yet') }, { value: 'paid', label: t('Paid') }]} />
                        </Form.Item>
                    </Col>
                </Row>
                {status === 'paid' && <Form.Item name="paidOn" label={t('Paid on')}><DatePicker style={{ width: '100%' }} format="D MMM YYYY" /></Form.Item>}
            </Form>
        </Modal>
    )
}

export default function RevenuePage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { settings } = useSystemSettings()
    const [entries, setEntries] = useState<ClientRevenueEntry[]>()
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [reports, setReports] = useState<EsgReport[]>([])
    const [organisations, setOrganisations] = useState<string[]>([])
    const [serviceFilter, setServiceFilter] = useState<'all' | RevenueService>('all')
    const [editing, setEditing] = useState<ClientRevenueEntry | 'new' | null>(null)
    const esgOn = settings[CLIENT_MODULES.esgReporting.setting] === true

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [rows, classRows, reportRows, learners] = await Promise.all([
                listRevenue(user),
                listTrainingClasses(user).catch(() => []),
                esgOn ? listEsgReports(user).catch(() => []) : Promise.resolve([]),
                listCompanyTrainingLearners(user).catch(() => []),
            ])
            setEntries(rows)
            setClasses(classRows)
            setReports(reportRows)
            setOrganisations([...new Set([...rows.map((row) => row.organisation), ...learners.map((row) => row.organisation), ...reportRows.map((row) => row.clientName)].filter(Boolean))].sort())
        } catch {
            setEntries([])
            message.error(t('Income could not be loaded.'))
        }
    }, [esgOn, message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const all = useMemo(() => entries || [], [entries])
    const visible = all.filter((entry) => serviceFilter === 'all' || entry.service === serviceFilter)
    const months = useMemo(() => Array.from({ length: 12 }, (_, index) => dayjs().startOf('month').subtract(11 - index, 'month').format('YYYY-MM')), [])
    const sum = (rows: ClientRevenueEntry[]) => rows.reduce((total, row) => total + row.amount, 0)
    const thisMonth = sum(all.filter((row) => row.date.startsWith(dayjs().format('YYYY-MM'))))
    const last12 = sum(all.filter((row) => row.date.slice(0, 7) >= months[0]))
    const outstanding = sum(all.filter((row) => row.status === 'invoiced'))
    const paid = sum(all.filter((row) => row.status === 'paid' && row.date.slice(0, 7) >= months[0]))

    const chart = useMemo(() => ({
        chart: { type: 'column', height: 280 },
        title: { text: undefined },
        xAxis: { categories: months.map((month) => dayjs(`${month}-01`).format('MMM YY')) },
        yAxis: { title: { text: 'ZAR' }, min: 0 },
        tooltip: { shared: true, valuePrefix: 'R ' },
        plotOptions: { column: { stacking: 'normal' } },
        series: (['training', 'esg_reporting', 'other'] as RevenueService[]).map((service) => ({
            type: 'column' as const,
            name: { training: t('Training'), esg_reporting: t('ESG reporting'), other: t('Other') }[service],
            data: months.map((month) => sum(all.filter((row) => row.service === service && row.date.startsWith(month)))),
        })),
    }), [all, months, t])

    useRegisterAgentPageContext({
        pageKey: 'training-revenue',
        pageName: 'Revenue',
        purpose: 'The company\'s own income from training and ESG reporting: invoices, payments, what is outstanding, and revenue per month. Its funder sees these totals on the funder report.',
        currentFilters: { service: serviceFilter },
        metrics: { thisMonthZar: thisMonth, last12MonthsZar: last12, paidLast12MonthsZar: paid, outstandingZar: outstanding, entries: all.length },
        dataSummary: { byMonth: months.map((month) => ({ month, zar: sum(all.filter((row) => row.date.startsWith(month))) })) },
    })

    const remove = async (entry: ClientRevenueEntry) => {
        if (!user) return
        try {
            await deleteRevenue(user, entry.id)
            await load()
        } catch {
            message.error(t('The income could not be deleted.'))
        }
    }

    const forLabel = (entry: ClientRevenueEntry) => {
        const trainingClass = classes.find((item) => item.id === entry.classId)
        if (trainingClass) return `${trainingClass.courseTitle} · ${classDatesLabel(trainingClass)}`
        const report = reports.find((item) => item.id === entry.reportId)
        return report ? `${report.clientName} ESG report` : ''
    }
    const serviceTag = (service: RevenueService) => <Tag color={SERVICE_COLOURS[service]}>{{ training: t('Training'), esg_reporting: t('ESG reporting'), other: t('Other') }[service]}</Tag>

    const columns: TableProps<ClientRevenueEntry>['columns'] = [
        { title: t('Date'), dataIndex: 'date', render: (value: string) => dayjs(value).format('D MMM YYYY') },
        { title: t('Client organisation'), dataIndex: 'organisation' },
        { title: t('For'), key: 'for', render: (_, entry) => <Space orientation="vertical" size={0}>{serviceTag(entry.service)}<Typography.Text type="secondary">{forLabel(entry) || entry.description}</Typography.Text></Space> },
        { title: t('Amount'), dataIndex: 'amount', align: 'right', render: (value: number) => <Typography.Text strong>{rand(value)}</Typography.Text> },
        { title: t('Status'), dataIndex: 'status', render: (value: string, entry) => value === 'paid' ? <Tag color="green">{t('Paid')}{entry.paidOn ? ` ${dayjs(entry.paidOn).format('D MMM')}` : ''}</Tag> : <Tag color="gold">{t('Invoiced')}</Tag> },
        {
            title: '',
            key: 'actions',
            align: 'right',
            render: (_, entry) => (
                <Space>
                    <Tooltip title={t('Edit')}><Button icon={<EditOutlined />} onClick={() => setEditing(entry)} aria-label={t('Edit')} /></Tooltip>
                    <Popconfirm title={t('Delete this income?')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => remove(entry)}>
                        <Tooltip title={t('Delete')}><Button danger icon={<DeleteOutlined />} aria-label={t('Delete')} /></Tooltip>
                    </Popconfirm>
                </Space>
            ),
        },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!entries} icon={<DollarOutlined />} label={t('This month')} value={rand(thisMonth)} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!entries} icon={<RiseOutlined />} label={t('Last 12 months')} value={rand(last12)} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!entries} icon={<WalletOutlined />} label={t('Paid (12 months)')} value={rand(paid)} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!entries} icon={<WalletOutlined />} label={t('Outstanding')} value={rand(outstanding)} /></Col>
            </Row>
            <Card title={t('Revenue per month')} style={{ marginBottom: 16 }}>
                <ThemedHighcharts options={chart as Highcharts.Options} />
            </Card>
            <FilterBar
                compact
                primary={(
                    <Select value={serviceFilter} onChange={setServiceFilter} options={[{ value: 'all', label: t('All income') }, { value: 'training', label: t('Training') }, { value: 'esg_reporting', label: t('ESG reporting') }, { value: 'other', label: t('Other') }]} />
                )}
                actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>{t('Record income')}</Button>}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={!entries}
                emptyText={all.length ? t('No income matches this filter.') : t('No income recorded yet. Record each invoice; your funder sees the totals.')}
                renderCard={(entry) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{entry.organisation}</Typography.Text>
                            <Typography.Text strong>{rand(entry.amount)}</Typography.Text>
                        </Space>
                        <Space wrap>{serviceTag(entry.service)}<Typography.Text type="secondary">{dayjs(entry.date).format('D MMM YYYY')}</Typography.Text></Space>
                        <Space><Button size="small" icon={<EditOutlined />} onClick={() => setEditing(entry)}>{t('Edit')}</Button></Space>
                    </Space>
                )}
            />
            {editing && (
                <RevenueFormModal
                    entry={editing === 'new' ? undefined : editing}
                    classes={classes}
                    reports={reports}
                    organisations={organisations}
                    onClose={() => setEditing(null)}
                    onSaved={() => { setEditing(null); void load() }}
                />
            )}
        </DashboardPage>
    )
}
