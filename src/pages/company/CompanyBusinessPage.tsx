import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Col, DatePicker, Form, InputNumber, Modal, Popconfirm, Row, Skeleton, Space, Typography, type TableProps } from 'antd'
import { DeleteOutlined, PlusOutlined, RiseOutlined, TeamOutlined, WalletOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type Highcharts from 'highcharts'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CompanyDetailsForm } from '@/components/training/CompanyDetailsForm'
import { deleteOrganisationMetric, listOrganisationMetrics, saveOrganisationMetric } from '@/services/companyPortalService'
import { useLanguage } from '@/providers/LanguageProvider'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import { rand } from '@/utils/trainingFormat'
import type { TrainingOrgMetric } from '@/types/training'

type FigureValues = { period: Dayjs, revenue: number, employees?: number }

/**
 * A client company's business: its details and, month by month, its revenue and employees against the yearly
 * baseline it gave. Its training provider's funders see these only as totals across the businesses served.
 */
export default function CompanyBusinessPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user, organisation, detailsSettings, reload } = useMyOrganisation()
    const [form] = Form.useForm<FigureValues>()
    const [metrics, setMetrics] = useState<TrainingOrgMetric[]>()
    const [adding, setAdding] = useState(false)
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!user || !organisation) return
        setMetrics(await listOrganisationMetrics(user, organisation).catch(() => []))
    }, [organisation, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const numberOf = (value: unknown) => (value === undefined || value === null || value === '' ? null : Number(value))
    const baseline = numberOf(organisation?.details.baselineRevenue)
    const baselineEmployees = numberOf(organisation?.details.employees)
    const all = useMemo(() => metrics || [], [metrics])
    const latest = all[all.length - 1]
    const change = latest && baseline ? Math.round(((latest.revenue - baseline) / baseline) * 1000) / 10 : null

    const chart = useMemo(() => all.length ? ({
        chart: { type: 'column', height: 260 },
        title: { text: undefined },
        xAxis: { categories: all.map((row) => dayjs(`${row.period}-01`).format('MMM YY')) },
        yAxis: {
            title: { text: undefined },
            min: 0,
            ...(baseline ? { plotLines: [{ value: baseline / 12, width: 2, dashStyle: 'Dash', label: { text: t('Baseline per month') } }] } : {}),
        },
        tooltip: { valuePrefix: 'R ' },
        legend: { enabled: false },
        series: [{ type: 'column', name: t('Revenue'), data: all.map((row) => row.revenue) }],
    }) as Highcharts.Options : null, [all, baseline, t])

    const save = async () => {
        if (!user || !organisation) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            await saveOrganisationMetric(user, organisation, { period: values.period.format('YYYY-MM'), revenue: values.revenue, employees: values.employees ?? null })
            message.success(t('Figures saved.'))
            setAdding(false)
            await load()
        } catch {
            message.error(t('The figures could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const remove = async (metric: TrainingOrgMetric) => {
        if (!user || !organisation) return
        await deleteOrganisationMetric(user, organisation, metric).catch(() => message.error(t('The figures could not be removed.')))
        await load()
    }

    const columns: TableProps<TrainingOrgMetric>['columns'] = [
        { title: t('Month'), dataIndex: 'period', render: (value: string) => dayjs(`${value}-01`).format('MMMM YYYY') },
        { title: t('Revenue'), dataIndex: 'revenue', align: 'right', render: (value: number) => rand(value) },
        { title: t('Employees'), dataIndex: 'employees', align: 'center', render: (value?: number) => value ?? '—' },
        {
            title: '',
            key: 'actions',
            align: 'right',
            render: (_, row) => (
                <Popconfirm title={t('Remove these figures?')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => remove(row)}>
                    <Button danger size="small" icon={<DeleteOutlined />} aria-label={t('Remove')} />
                </Popconfirm>
            ),
        },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!organisation} icon={<WalletOutlined />} label={t('Baseline revenue (a year)')} mobileTitle={t('Baseline')} value={baseline !== null ? rand(baseline) : '—'} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!metrics} icon={<RiseOutlined />} label={latest ? t('Revenue, {month}', undefined, { month: dayjs(`${latest.period}-01`).format('MMM YYYY') }) : t('Latest revenue')} mobileTitle={t('Latest')} value={latest ? rand(latest.revenue) : '—'} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!metrics} icon={<RiseOutlined />} label={t('Last 12 months against the baseline')} mobileTitle={t('Change')} value={(() => {
                    const year = all.filter((row) => row.period >= dayjs().subtract(11, 'month').format('YYYY-MM'))
                    if (!baseline || !year.length) return change !== null ? `${change > 0 ? '+' : ''}${change}%` : '—'
                    const yearly = (year.reduce((total, row) => total + row.revenue, 0) / year.length) * 12
                    const pct = Math.round(((yearly - baseline) / baseline) * 1000) / 10
                    return `${pct > 0 ? '+' : ''}${pct}%`
                })()} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!metrics} icon={<TeamOutlined />} label={t('Employees')} value={latest?.employees ?? baselineEmployees ?? '—'} /></Col>
            </Row>
            <Card
                title={t('Revenue by month')}
                extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>{t('Add figures')}</Button>}
                style={{ marginBottom: 16 }}
            >
                <Typography.Paragraph type="secondary">{t('Record your revenue (and employees) each month or quarter, so the effect of the training shows against your baseline.')}</Typography.Paragraph>
                {chart && <ThemedHighcharts options={chart} />}
                <ResponsiveDataView
                    rowKey="id"
                    rows={[...all].reverse()}
                    columns={columns}
                    loading={!metrics}
                    emptyText={t('No figures yet. Add last month\'s revenue to start.')}
                    renderCard={(row) => (
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{dayjs(`${row.period}-01`).format('MMM YYYY')}</Typography.Text>
                            <Typography.Text>{rand(row.revenue)}{row.employees !== undefined ? ` · ${t('{count} employees', undefined, { count: row.employees })}` : ''}</Typography.Text>
                        </Space>
                    )}
                />
            </Card>
            <Card title={t('Business details')}>
                {organisation
                    ? <CompanyDetailsForm organisation={organisation} settings={detailsSettings} part="details" onSaved={() => void reload()} />
                    : <Skeleton active />}
            </Card>
            <Modal open={adding} title={t('Add figures')} okText={t('Save')} confirmLoading={saving} onOk={() => void save()} onCancel={() => setAdding(false)} destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false} initialValues={{ period: dayjs().subtract(1, 'month') }}>
                    <Form.Item name="period" label={t('Month')} rules={[{ required: true, message: t('Choose the month.') }]} extra={t('Recording a month again replaces it.')}>
                        <DatePicker picker="month" style={{ width: '100%' }} format="MMMM YYYY" disabledDate={(date) => date.isAfter(dayjs(), 'month')} />
                    </Form.Item>
                    <Form.Item name="revenue" label={t('Revenue for the month')} rules={[{ required: true, message: t('Enter the revenue.') }]}>
                        <InputNumber min={0} step={1000} prefix="R" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name="employees" label={t('Employees (optional)')}>
                        <InputNumber min={0} style={{ width: '100%' }} />
                    </Form.Item>
                </Form>
            </Modal>
        </DashboardPage>
    )
}
