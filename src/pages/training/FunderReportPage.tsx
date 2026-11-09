import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, Col, Form, Input, Modal, Row, Select, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { BankOutlined, EditOutlined, FileTextOutlined, ManOutlined, PlusOutlined, PrinterOutlined, RiseOutlined, SafetyCertificateOutlined, TeamOutlined, UserAddOutlined, WalletOutlined, WomanOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type Highcharts from 'highcharts'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { ESG_SECTORS, countryName } from '@/config/esgStandards'
import { usesFirebaseEmulators } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getFunderSummary, inviteFunder, listFunders, listTrainingFunders, saveTrainingFunder } from '@/services/clientRevenueService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { rand } from '@/utils/trainingFormat'
import type { ClientFunderSummary, TrainingFunder, TrainingFunderAccount } from '@/types/clientRevenue'

type FunderFormValues = { name: string, contactName: string, contactEmail: string, giveAccess?: boolean }

/**
 * Staff only: the company's funders and who at each can sign in. Each funder's report shows only what is marked as
 * funded by it (classes, learners, ESG reports and income).
 */
const Funders = ({ funders, accounts, onChanged }: { funders: TrainingFunder[], accounts: TrainingFunderAccount[], onChanged: () => void }) => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<FunderFormValues>()
    const [editing, setEditing] = useState<TrainingFunder | 'new' | null>(null)
    const [saving, setSaving] = useState(false)
    const [inviting, setInviting] = useState<string | null>(null)

    const giveAccess = async (funder: TrainingFunder, name: string, email: string) => {
        setInviting(funder.id)
        try {
            const { setPasswordLink } = await inviteFunder({ funderId: funder.id, name, email })
            message.success(t('{name} can now sign in and see what {funder} funded. A link to set a password was emailed.', undefined, { name, funder: funder.name }))
            if (usesFirebaseEmulators && setPasswordLink) {
                modal.info({ title: t('Local testing: no email is sent'), width: 640, content: <Typography.Paragraph copyable style={{ wordBreak: 'break-all' }}>{setPasswordLink}</Typography.Paragraph> })
            }
            onChanged()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'email_already_exists'
                ? t('This email already has a Smartinc account. Use another address for the funder.')
                : t('Access could not be given.'))
        } finally {
            setInviting(null)
        }
    }

    const startEdit = (funder?: TrainingFunder) => {
        setEditing(funder || 'new')
        form.setFieldsValue({ name: funder?.name || '', contactName: funder?.contactName || '', contactEmail: funder?.contactEmail || '', giveAccess: !funder })
    }

    const save = async () => {
        if (!user || !editing) return
        const { giveAccess: andInvite, ...values } = await form.validateFields()
        setSaving(true)
        try {
            const id = await saveTrainingFunder(user, values, editing === 'new' ? undefined : editing)
            setEditing(null)
            if (andInvite && values.contactEmail) {
                await giveAccess({ id, companyCode: String(user.companyCode || ''), ...values }, values.contactName || values.name, values.contactEmail)
            } else {
                message.success(t('Funder saved.'))
                onChanged()
            }
        } catch {
            message.error(t('The funder could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Card title={t('Funders')} extra={<Button icon={<PlusOutlined />} onClick={() => startEdit()}>{t('Add funder')}</Button>} style={{ marginBottom: 16 }}>
            <Typography.Paragraph type="secondary">
                {t('Each funder signs in to see only what it funded: the classes, learners, ESG reports and income marked as funded by it. Funders never see learners\' names, ID numbers or contact details, or another funder\'s work.')}
            </Typography.Paragraph>
            <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={funders}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: t('No funders yet. Add each organisation that funds your work.') }}
                columns={[
                    { title: t('Funder'), dataIndex: 'name', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
                    { title: t('Contact'), key: 'contact', render: (_, funder) => [funder.contactName, funder.contactEmail].filter(Boolean).join(' · ') || '—' },
                    {
                        title: t('Can sign in'),
                        key: 'access',
                        render: (_, funder) => {
                            const own = accounts.filter((account) => account.funderId === funder.id)
                            if (own.length) return <Space wrap size={4}>{own.map((account) => <Tag key={account.uid} color="green">{account.name}</Tag>)}</Space>
                            return funder.contactEmail
                                ? <Button size="small" icon={<UserAddOutlined />} loading={inviting === funder.id} onClick={() => void giveAccess(funder, funder.contactName || funder.name, funder.contactEmail)}>{t('Give access')}</Button>
                                : <Typography.Text type="secondary">{t('Add a contact email first')}</Typography.Text>
                        },
                    },
                    { title: '', key: 'edit', align: 'right', render: (_, funder) => <Tooltip title={t('Edit funder')}><Button icon={<EditOutlined />} onClick={() => startEdit(funder)} aria-label={t('Edit funder')} /></Tooltip> },
                ]}
            />
            <Modal open={editing !== null} title={editing === 'new' ? t('Add funder') : t('Edit funder')} okText={t('Save')} confirmLoading={saving} onOk={() => void save()} onCancel={() => setEditing(null)} destroyOnHidden>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t('Funder organisation')} rules={[{ required: true, whitespace: true, message: t('Enter the funder\'s organisation.') }]}><Input maxLength={160} /></Form.Item>
                    <Form.Item name="contactName" label={t('Contact person')}><Input maxLength={120} /></Form.Item>
                    <Form.Item name="contactEmail" label={t('Their email address')} rules={[{ type: 'email', message: t('Enter a valid email address.') }]}><Input maxLength={160} /></Form.Item>
                    {editing === 'new' && (
                        <Form.Item name="giveAccess" valuePropName="checked">
                            <Checkbox>{t('Give the contact person access now')}</Checkbox>
                        </Form.Item>
                    )}
                </Form>
            </Modal>
        </Card>
    )
}

export default function FunderReportPage() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [summary, setSummary] = useState<ClientFunderSummary | null>()
    const [funders, setFunders] = useState<TrainingFunder[]>([])
    const [accounts, setAccounts] = useState<TrainingFunderAccount[]>([])
    const [viewAs, setViewAs] = useState<string>('')
    const isStaff = user?.role === 'projectadmin' || user?.role === 'operations'

    useEffect(() => {
        let cancelled = false
        getFunderSummary(isStaff ? viewAs || undefined : undefined).then((data) => { if (!cancelled) setSummary(data) }, () => { if (!cancelled) setSummary(null) })
        return () => { cancelled = true }
    }, [isStaff, viewAs])

    const loadFunders = useCallback(async () => {
        if (!user || !isStaff) return
        const [rows, people] = await Promise.all([listTrainingFunders(user).catch(() => []), listFunders(user).catch(() => [])])
        setFunders(rows)
        setAccounts(people)
    }, [isStaff, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void loadFunders(), 0)
        return () => window.clearTimeout(timeout)
    }, [loadFunders])

    const revenueChart = useMemo(() => summary ? ({
        chart: { type: 'column', height: 260 },
        title: { text: undefined },
        xAxis: { categories: summary.revenue.byMonth.map((item) => dayjs(`${item.month}-01`).format('MMM YY')) },
        yAxis: { title: { text: 'ZAR' }, min: 0 },
        tooltip: { shared: true, valuePrefix: 'R ' },
        plotOptions: { column: { stacking: 'normal' } },
        series: [
            { type: 'column', name: t('Training'), data: summary.revenue.byMonth.map((item) => item.training) },
            { type: 'column', name: t('ESG reporting'), data: summary.revenue.byMonth.map((item) => item.esgReporting) },
            { type: 'column', name: t('Other'), data: summary.revenue.byMonth.map((item) => item.other) },
        ],
    }) as Highcharts.Options : null, [summary, t])

    const trainingChart = useMemo(() => summary ? ({
        chart: { type: 'column', height: 260 },
        title: { text: undefined },
        xAxis: { categories: summary.training.byMonth.map((item) => dayjs(`${item.month}-01`).format('MMM YY')) },
        yAxis: { title: { text: t('Learners') }, min: 0, allowDecimals: false },
        series: [{ type: 'column', name: t('Learners trained'), data: summary.training.byMonth.map((item) => item.learners) }],
    }) as Highcharts.Options : null, [summary, t])

    const people = summary?.training.people
    // Nobody's age known yet (no dates of birth, no South African ID numbers): a dash, not a misleading 0.
    const youthValue = people && summary && summary.training.learners > 0 && people.ageUnknown >= summary.training.learners ? '—' : people?.youth ?? 0
    useRegisterAgentPageContext({
        pageKey: 'training-funder',
        pageName: 'Funder report',
        purpose: 'The read-only report a funder sees: only what that funder funded. Revenue (paid and outstanding), learners trained and certified with their gender, youth and disability, the businesses served with their baseline revenue and employees, and the ESG reports produced. Totals only, no learner personal information.',
        metrics: summary ? {
            funder: summary.funderName || 'whole company (staff view)',
            revenueLast12MonthsZar: summary.revenue.last12Months, paidZar: summary.revenue.paid, outstandingZar: summary.revenue.outstanding,
            learnersTrained: summary.training.learners, learnersCertified: summary.training.learnersCertified, passRatePct: summary.training.passRatePct ?? 'none yet',
            women: summary.training.people.female, men: summary.training.people.male, youth: summary.training.people.youth, withDisability: summary.training.people.withDisability,
            businessesWithDetails: summary.businesses.withDetails, combinedBaselineRevenueZar: summary.businesses.baselineRevenue, employees: summary.businesses.employees,
            organisations: summary.organisations.length, esgReports: summary.esg.reports, esgReportsFinal: summary.esg.final,
        } : {},
        dataSummary: summary ? { organisations: summary.organisations.slice(0, 20), beeLevels: summary.businesses.beeLevels } : {},
    })

    const genderTotal = (people?.female || 0) + (people?.male || 0)
    const share = (count: number) => (genderTotal ? ` (${Math.round((count / genderTotal) * 100)}%)` : '')

    return (
        <DashboardPage className="training-page">
            {isStaff && (
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={viewAs ? t('This is what this funder sees when they sign in.') : t('The whole company. Choose a funder to see exactly what that funder sees.')}
                />
            )}
            <Card style={{ marginBottom: 16 }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                    <Space orientation="vertical" size={0}>
                        <Typography.Title level={4} style={{ margin: 0 }}>
                            {summary?.funderName ? `${summary.companyName} · ${summary.funderName}` : summary?.companyName || t('Funder report')}
                        </Typography.Title>
                        <Typography.Text type="secondary">
                            {summary ? t('Report for funders · updated {time} · totals only, no learner personal information', undefined, { time: dayjs(summary.generatedAt).format('D MMM YYYY, HH:mm') }) : t('Loading the report')}
                        </Typography.Text>
                    </Space>
                    <Space wrap>
                        {isStaff && (
                            <Select
                                value={viewAs}
                                onChange={(value) => { setViewAs(value); setSummary(undefined) }}
                                style={{ minWidth: 240 }}
                                aria-label={t('Show the report for')}
                                options={[{ value: '', label: t('The whole company') }, ...funders.map((funder) => ({ value: funder.id, label: t('As {funder} sees it', undefined, { funder: funder.name }) }))]}
                            />
                        )}
                        <Button icon={<PrinterOutlined />} onClick={() => window.print()}>{t('Print or save as PDF')}</Button>
                    </Space>
                </Space>
            </Card>
            {summary === null && <Alert type="error" showIcon message={t('The report could not be loaded.')} style={{ marginBottom: 16 }} />}
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<RiseOutlined />} label={t('Revenue, last 12 months')} mobileTitle={t('Revenue')} value={rand(summary?.revenue.last12Months || 0)} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<WalletOutlined />} label={t('Paid · outstanding')} value={`${rand(summary?.revenue.paid || 0)} · ${rand(summary?.revenue.outstanding || 0)}`} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<TeamOutlined />} label={t('Learners trained')} value={summary?.training.learners ?? 0} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<SafetyCertificateOutlined />} label={t('Certified (pass rate)')} mobileTitle={t('Certified')} value={`${summary?.training.learnersCertified ?? 0}${summary?.training.passRatePct !== null && summary?.training.passRatePct !== undefined ? ` (${summary.training.passRatePct}%)` : ''}`} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<WomanOutlined />} label={t('Women trained')} mobileTitle={t('Women')} value={`${people?.female ?? 0}${share(people?.female || 0)}`} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<ManOutlined />} label={t('Men trained')} mobileTitle={t('Men')} value={`${people?.male ?? 0}${share(people?.male || 0)}`} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<TeamOutlined />} label={t('Youth (under 35)')} mobileTitle={t('Youth')} value={youthValue} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!summary} icon={<BankOutlined />} label={t('Businesses served')} mobileTitle={t('Businesses')} value={summary?.organisations.length ?? 0} /></Col>
            </Row>
            <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
                <Col xs={24} lg={12}><Card title={t('Revenue per month')}>{revenueChart && <ThemedHighcharts options={revenueChart} />}</Card></Col>
                <Col xs={24} lg={12}><Card title={t('Learners trained per month')}>{trainingChart && <ThemedHighcharts options={trainingChart} />}</Card></Col>
            </Row>
            {summary && (
                <Row gutter={[14, 14]} style={{ marginBottom: 16 }}>
                    <Col xs={24} lg={12}>
                        <Card title={t('People trained')} style={{ height: '100%' }}>
                            <Space orientation="vertical" size={6}>
                                <Typography.Text>{t('Women: {women} · Men: {men}', undefined, { women: summary.training.people.female, men: summary.training.people.male })}{summary.training.people.genderUnknown ? ` · ${t('Not given: {count}', undefined, { count: summary.training.people.genderUnknown })}` : ''}</Typography.Text>
                                <Typography.Text>{t('Youth (under 35 at the start of their class): {count}', undefined, { count: summary.training.people.youth })}{summary.training.people.ageUnknown ? ` · ${t('Age not given: {count}', undefined, { count: summary.training.people.ageUnknown })}` : ''}</Typography.Text>
                                <Typography.Text>{t('With a disability: {count}', undefined, { count: summary.training.people.withDisability })}</Typography.Text>
                                <Typography.Text type="secondary">{t('Gender and age are as each person gave them, or read from a South African ID number.')}</Typography.Text>
                            </Space>
                        </Card>
                    </Col>
                    <Col xs={24} lg={12}>
                        <Card title={t('Businesses')} style={{ height: '100%' }}>
                            <Space orientation="vertical" size={6}>
                                <Typography.Text>{t('Details given: {count} of {total} businesses', undefined, { count: summary.businesses.withDetails, total: summary.organisations.length })}</Typography.Text>
                                <Typography.Text>{t('Combined baseline revenue: {amount}', undefined, { amount: rand(summary.businesses.baselineRevenue) })}</Typography.Text>
                                <Typography.Text>{t('Employees: {count}', undefined, { count: summary.businesses.employees })}</Typography.Text>
                                {summary.businesses.withLatestFigures > 0 && summary.businesses.revenueGrowthPct !== null && (
                                    <Typography.Text strong>
                                        {t('Revenue now: {amount} a year ({change} on their baseline, from {count} with figures since)', undefined, {
                                            amount: rand(summary.businesses.latestRevenue),
                                            change: `${summary.businesses.revenueGrowthPct > 0 ? '+' : ''}${summary.businesses.revenueGrowthPct}%`,
                                            count: summary.businesses.withLatestFigures,
                                        })}
                                    </Typography.Text>
                                )}
                                {summary.businesses.beeLevels.length > 0 && (
                                    <Space wrap size={4}>{summary.businesses.beeLevels.map((item) => <Tag key={item.level}>{t('B-BBEE {level}: {count}', undefined, { level: item.level, count: item.count })}</Tag>)}</Space>
                                )}
                            </Space>
                        </Card>
                    </Col>
                </Row>
            )}
            <Card title={t('Client organisations served')} style={{ marginBottom: 16 }}>
                <Table
                    rowKey="name"
                    size="small"
                    loading={!summary}
                    dataSource={summary?.organisations || []}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    scroll={{ x: 'max-content' }}
                    columns={[
                        { title: t('Organisation'), dataIndex: 'name' },
                        { title: t('Learners trained'), dataIndex: 'learners', align: 'center' },
                        { title: t('Certified'), dataIndex: 'certified', align: 'center' },
                        { title: t('ESG reports'), dataIndex: 'esgReports', align: 'center' },
                        { title: t('Revenue (12 months)'), dataIndex: 'revenue', align: 'right', render: (value: number) => rand(value) },
                    ]}
                />
            </Card>
            {summary && summary.esg.reports > 0 && (
                <Card title={t('ESG reporting')} style={{ marginBottom: 16 }}>
                    <Space orientation="vertical">
                        <Typography.Text>{t('{reports} report(s): {final} final, {progress} in progress.', undefined, { reports: summary.esg.reports, final: summary.esg.final, progress: summary.esg.inProgress })}</Typography.Text>
                        <Space wrap>{summary.esg.countries.map((code) => <Tag key={code} icon={<FileTextOutlined />}>{countryName(code)}</Tag>)}</Space>
                        <Space wrap>{summary.esg.sectors.map((key) => <Tag key={key} color="green">{t(ESG_SECTORS.find((item) => item.key === key)?.label || key)}</Tag>)}</Space>
                    </Space>
                </Card>
            )}
            {isStaff && <Funders funders={funders} accounts={accounts} onChanged={() => void loadFunders()} />}
        </DashboardPage>
    )
}
