import { Alert, App, Button, Card, Col, Dropdown, Empty, Form, Input, InputNumber, Radio, Row, Segmented, Select, Skeleton } from 'antd'
import {
    AimOutlined,
    AppstoreOutlined,
    CheckCircleOutlined,
    EditOutlined,
    FieldTimeOutlined,
    InboxOutlined,
    MoreOutlined,
    PlusOutlined,
    SaveOutlined,
    SettingOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { AdminFormSectionHead } from '@/components/admin/AdminFormSectionHead'
import { AdminKpiTile, AdminMiniBars, AdminShareRing } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    createPlatformKpi,
    listPlatformKpis,
    loadPlatformKpiData,
    narrowPlatformKpiData,
    platformKpiActual,
    platformKpiStatus,
    platformPeriod,
    seedRecommendedPlatformKpis,
    setPlatformKpiActive,
    setPlatformManualActual,
    updatePlatformKpi,
    type PlatformKpiActual,
    type PlatformKpiData,
    type PlatformKpiPeriod,
    type PlatformKpiStatus,
} from '@/services/platformKpiService'
import {
    PLATFORM_KPI_CATEGORIES,
    PLATFORM_KPI_UNITS,
    PLATFORM_METRICS,
    RECOMMENDED_PLATFORM_KPIS,
    type PlatformKpi,
    type PlatformKpiCategory,
    type PlatformKpiDraft,
    type PlatformKpiUnit,
} from '@/types/platformKpi'
import '@/styles/platform-kpis.css'

type Row = { kpi: PlatformKpi; period: PlatformKpiPeriod; actual: PlatformKpiActual; status: PlatformKpiStatus; history: Array<{ period: PlatformKpiPeriod; value: number | null }> }

const STATUS_LABELS: Record<PlatformKpiStatus, string> = { met: 'Met', on_track: 'On track', behind: 'Behind', no_target: 'No target', no_data: 'No data yet' }

/** "99.5%", "2.5 s", "R 15", "4.2 / 5", "12". */
const formatValue = (value: number | null, unit: PlatformKpiUnit) => {
    if (value === null) return '—'
    const number = value.toLocaleString('en-ZA', { maximumFractionDigits: 1 })
    if (unit === 'percent') return `${number}%`
    if (unit === 'seconds') return `${number} s`
    if (unit === 'minutes') return `${number} min`
    if (unit === 'hours') return `${number} h`
    if (unit === 'days') return `${number} d`
    if (unit === 'rating') return `${number} / 5`
    if (unit === 'currency') return `R ${number}`
    return number
}

/** How far along the bar is: the actual's share of the target, flipped for lower-is-better figures. */
const progressOf = (kpi: PlatformKpi, value: number | null) => {
    if (value === null || kpi.target === null) return 0
    if (kpi.direction === 'higher') return kpi.target ? Math.min(100, (value / kpi.target) * 100) : 100
    if (value <= kpi.target) return 100
    return Math.max(4, Math.min(100, (kpi.target / value) * 100))
}

type FormValues = PlatformKpiDraft

export const PlatformKpisPage = () => {
    const { message, modal } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [kpis, setKpis] = useState<PlatformKpi[]>([])
    const [data, setData] = useState<PlatformKpiData>()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string>()
    const [category, setCategory] = useState<'all' | PlatformKpiCategory>('all')
    const [offset, setOffset] = useState<0 | -1>(0)
    const [editing, setEditing] = useState<PlatformKpi | 'new'>()
    const [entering, setEntering] = useState<Row>()
    const [saving, setSaving] = useState(false)
    const [seeding, setSeeding] = useState(false)
    const [form] = Form.useForm<FormValues>()
    const [entryForm] = Form.useForm<{ value: number; note?: string }>()
    const kind = Form.useWatch('kind', form)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [nextKpis, nextData] = await Promise.all([listPlatformKpis(user), loadPlatformKpiData(user)])
            setKpis(nextKpis)
            setData(nextData)
            setError(undefined)
        } catch {
            setError(t('System KPIs could not be loaded.'))
        } finally {
            setLoading(false)
        }
    }, [t, user])
    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const active = useMemo(() => kpis.filter((kpi) => kpi.active), [kpis])
    const missingRecommended = RECOMMENDED_PLATFORM_KPIS.filter((seed) => !active.some((kpi) => kpi.seedKey === seed.seedKey)).length

    // The company picked in the top bar narrows the automatic figures.
    const { activeCompanyCode, isAllCompanies } = useActiveCompanyCode()
    const companyCode = isAllCompanies ? undefined : activeCompanyCode
    const scopedData = useMemo(() => data && companyCode ? narrowPlatformKpiData(data, companyCode) : data, [companyCode, data])

    const rows = useMemo<Row[]>(() => active.map((kpi) => {
        const period = platformPeriod(kpi.cadence, offset)
        const actual = platformKpiActual(kpi, scopedData, period)
        const history = Array.from({ length: 6 }, (_, index) => {
            const past = platformPeriod(kpi.cadence, offset - 5 + index)
            return { period: past, value: platformKpiActual(kpi, scopedData, past).value }
        })
        return { kpi, period, actual, status: platformKpiStatus(kpi, actual, period), history }
    }), [active, offset, scopedData])
    const visible = rows.filter((row) => category === 'all' || row.kpi.category === category)
    const counts = {
        good: rows.filter((row) => row.status === 'met' || row.status === 'on_track').length,
        behind: rows.filter((row) => row.status === 'behind').length,
        waiting: rows.filter((row) => row.kpi.kind === 'manual' && row.actual.value === null).length,
    }

    useRegisterAgentPageContext({
        pageKey: 'admin-platform-kpis',
        pageName: 'System KPIs',
        purpose: 'Track how the platform itself is used and built: adoption, engagement, reliability, AI quality and engineering health against targets.',
        metrics: { tracked: rows.length, onTrackOrMet: counts.good, behind: counts.behind, awaitingEntry: counts.waiting },
    })

    const openEditor = (kpi?: PlatformKpi) => {
        setEditing(kpi || 'new')
        form.setFieldsValue(kpi
            ? { name: kpi.name, description: kpi.description, category: kpi.category, kind: kpi.kind, metric: kpi.metric, unit: kpi.unit, direction: kpi.direction, cadence: kpi.cadence, target: kpi.target }
            : { kind: 'manual', category: 'engineering', unit: 'count', direction: 'higher', cadence: 'month', target: null, name: '', description: '' })
    }

    const save = async (values: FormValues) => {
        if (!user || !editing) return
        setSaving(true)
        try {
            if (editing === 'new') await createPlatformKpi(user, values)
            else await updatePlatformKpi(user, editing.id, values)
            message.success(editing === 'new' ? t('KPI added.') : t('KPI updated.'))
            setEditing(undefined)
            await load()
        } catch {
            message.error(t('The KPI could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const saveEntry = async (values: { value: number; note?: string }) => {
        if (!user || !entering) return
        setSaving(true)
        try {
            await setPlatformManualActual(user, entering.kpi, entering.period.key, values.value, values.note)
            message.success(t('Value saved.'))
            setEntering(undefined)
            await load()
        } catch {
            message.error(t('The value could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const seed = async () => {
        if (!user) return
        setSeeding(true)
        try {
            const added = await seedRecommendedPlatformKpis(user, kpis)
            message.success(t('{count} recommended KPIs added.', undefined, { count: added }))
            await load()
        } catch {
            message.error(t('The recommended KPIs could not be added.'))
        } finally {
            setSeeding(false)
        }
    }

    const archive = (kpi: PlatformKpi) => modal.confirm({
        title: t('Archive this KPI?'),
        content: t('It stops showing here. Values entered so far are kept.'),
        okText: t('Archive'),
        onOk: async () => {
            if (!user) return
            await setPlatformKpiActive(user, kpi.id, false)
            await load()
        },
    })

    const startEntry = (row: Row) => {
        setEntering(row)
        entryForm.setFieldsValue({ value: row.actual.value ?? undefined, note: row.actual.manual?.note })
    }

    const periodLabel = offset === 0 ? t('This period') : t('Last period')
    const metricOptions = PLATFORM_METRICS.map((metric) => ({ value: metric.key, label: t(metric.name) }))

    const card = (row: Row) => {
        const { kpi, actual, status, history, period } = row
        const target = kpi.target === null ? t('No target') : `${t('Target')} ${kpi.direction === 'higher' ? '≥' : '≤'} ${formatValue(kpi.target, kpi.unit)}`
        return (
            <Col key={kpi.id} xs={24} md={12} xl={8}>
                <Card className="admin-card platform-kpi-card" bordered={false}>
                    <div className="platform-kpi-top">
                        <span className={`platform-kpi-kind is-${kpi.kind}`}>{kpi.kind === 'auto' ? <ThunderboltOutlined /> : <EditOutlined />}{kpi.kind === 'auto' ? t('Automatic') : t('Manual')}</span>
                        <span className={`platform-kpi-status is-${status}`}><i />{t(STATUS_LABELS[status])}</span>
                        <Dropdown trigger={['click']} menu={{
                            items: [
                                ...(kpi.kind === 'manual' ? [{ key: 'enter', icon: <FieldTimeOutlined />, label: t('Enter value') }] : []),
                                { key: 'edit', icon: <SettingOutlined />, label: t('Edit KPI') },
                                { key: 'archive', icon: <InboxOutlined />, label: t('Archive'), danger: true },
                            ],
                            onClick: ({ key }) => key === 'enter' ? startEntry(row) : key === 'edit' ? openEditor(kpi) : archive(kpi),
                        }}>
                            <Button type="text" shape="circle" size="small" icon={<MoreOutlined />} aria-label={t('KPI actions')} />
                        </Dropdown>
                    </div>
                    <h3 className="platform-kpi-name">{kpi.name}</h3>
                    {kpi.description && <p className="platform-kpi-description" title={kpi.description}>{kpi.description}</p>}
                    <div className="platform-kpi-figure">
                        <div>
                            <strong>{formatValue(actual.value, kpi.unit)}</strong>
                            <span>{target}</span>
                        </div>
                        <AdminMiniBars bars={history.map((item) => ({ key: item.period.key, label: item.period.shortLabel.slice(0, 3), value: item.value ?? 0 }))} />
                    </div>
                    <div className={`platform-kpi-progress is-${status}`} aria-hidden="true"><span style={{ width: `${progressOf(kpi, actual.value)}%` }} /></div>
                    <div className="platform-kpi-foot">
                        <span>{actual.manual
                            ? t('Entered by {name}, {date}', undefined, { name: actual.manual.byName || t('an admin'), date: dayjs(actual.manual.at).format('D MMM') })
                            : actual.detail || period.label}</span>
                        {kpi.kind === 'manual' && <Button size="small" shape="round" type={actual.value === null ? 'primary' : 'default'} onClick={() => startEntry(row)}>{actual.value === null ? t('Enter value') : t('Update')}</Button>}
                    </div>
                </Card>
            </Col>
        )
    }

    const grouped = PLATFORM_KPI_CATEGORIES.map((group) => ({ ...group, rows: visible.filter((row) => row.kpi.category === group.key) })).filter((group) => group.rows.length)

    return (
        <DashboardPage className="platform-kpis-page admin-overview">
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
            {companyCode && <Alert type="info" showIcon message={t('Automatic figures are for {company} only. Manual figures and targets are platform-wide.', undefined, { company: companyCode })} style={{ marginBottom: 16 }} />}
            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<AimOutlined />} label={t('KPIs tracked')} value={rows.length} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<CheckCircleOutlined />} label={t('Met or on track')} value={counts.good} visual={<AdminShareRing value={counts.good} total={rows.length} />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<WarningOutlined />} label={t('Behind target')} value={counts.behind} visual={<AdminShareRing value={counts.behind} total={rows.length} muted />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading} icon={<FieldTimeOutlined />} label={t('Waiting for a value')} value={counts.waiting} /></Col>
            </Row>

            <FilterBar
                primary={<Segmented value={category} onChange={(value) => setCategory(value as typeof category)} options={[{ value: 'all', label: t('All') }, ...PLATFORM_KPI_CATEGORIES.map((item) => ({ value: item.key, label: t(item.label) }))]} />}
                actions={<>
                    <Segmented value={offset} onChange={(value) => setOffset(value as 0 | -1)} options={[{ value: 0, label: t('This period') }, { value: -1, label: t('Last period') }]} />
                    {missingRecommended > 0 && active.length > 0 && <Button icon={<AppstoreOutlined />} loading={seeding} onClick={() => void seed()}>{t('Add recommended ({count})', undefined, { count: missingRecommended })}</Button>}
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t('Add KPI')}</Button>
                </>}
            />

            {loading ? (
                <Row gutter={[16, 16]}>{[0, 1, 2].map((index) => <Col key={index} xs={24} md={12} xl={8}><Card className="admin-card" bordered={false}><Skeleton active /></Card></Col>)}</Row>
            ) : !active.length ? (
                <Card className="admin-card platform-kpis-empty" bordered={false}>
                    <span className="admin-kpi-icon"><AimOutlined /></span>
                    <h3>{t('No system KPIs yet')}</h3>
                    <p>{t('Start with a recommended set: adoption and engagement show whether what ships gets used; reliability and engineering show whether it is built well. Targets can be tuned after.')}</p>
                    <Button type="primary" shape="round" size="large" icon={<AppstoreOutlined />} loading={seeding} onClick={() => void seed()}>{t('Add {count} recommended KPIs', undefined, { count: RECOMMENDED_PLATFORM_KPIS.length })}</Button>
                    <Button type="link" onClick={() => openEditor()}>{t('Or add your own')}</Button>
                </Card>
            ) : !grouped.length ? (
                <Card className="admin-card" bordered={false}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No KPIs in this category.')} /></Card>
            ) : grouped.map((group) => (
                <section key={group.key} className="platform-kpis-group">
                    <div className="platform-kpis-group-head">
                        <h2>{t(group.label)}</h2>
                        <span>{t('{count} KPIs · {period}', undefined, { count: group.rows.length, period: periodLabel })}</span>
                    </div>
                    <Row gutter={[16, 16]}>{group.rows.map(card)}</Row>
                </section>
            ))}

            <ResponsiveModal
                open={!!editing}
                onClose={() => setEditing(undefined)}
                width={720}
                centered
                destroyOnHidden={false}
                className="admin-modal admin-form-modal is-plain-header"
                title={editing === 'new' ? t('Add KPI') : t('Edit KPI')}
                footer={<Button block shape="round" size="large" type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => form.submit()}>{editing === 'new' ? t('Add KPI') : t('Save changes')}</Button>}
            >
                <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void save(values)}>
                    <section className="admin-form-modal-section">
                        <AdminFormSectionHead icon={<AimOutlined />} title={t('What it measures')} />
                        <Form.Item name="kind" label={t('Source')}>
                            <Radio.Group optionType="button" buttonStyle="solid" options={[{ value: 'auto', label: t('Worked out by the app') }, { value: 'manual', label: t('Entered each period') }]} />
                        </Form.Item>
                        {kind === 'auto' && (
                            <Form.Item name="metric" label={t('Metric')} rules={[{ required: true }]}>
                                <Select size="large" options={metricOptions} onChange={(key) => {
                                    const metric = PLATFORM_METRICS.find((item) => item.key === key)
                                    if (metric) form.setFieldsValue({ name: form.getFieldValue('name') || metric.name, description: metric.description, unit: metric.unit, direction: metric.direction, category: metric.category })
                                }} />
                            </Form.Item>
                        )}
                        <Form.Item name="name" label={t('Name')} rules={[{ required: true }]}><Input size="large" /></Form.Item>
                        <Form.Item name="description" label={t('How it is measured')}><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} /></Form.Item>
                        <Form.Item name="category" label={t('Category')}><Select size="large" options={PLATFORM_KPI_CATEGORIES.map((item) => ({ value: item.key, label: t(item.label) }))} /></Form.Item>
                    </section>
                    <section className="admin-form-modal-section">
                        <AdminFormSectionHead icon={<AimOutlined />} title={t('Target')} hint={t('Leave the target empty to track the figure without one')} />
                        <Row gutter={12}>
                            <Col xs={24} md={12}><Form.Item name="unit" label={t('Unit')}><Select size="large" disabled={kind === 'auto'} options={PLATFORM_KPI_UNITS.map((item) => ({ value: item.key, label: t(item.label) }))} /></Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name="target" label={t('Target')}><InputNumber size="large" style={{ width: '100%' }} min={0} /></Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name="direction" label={t('Good is')}><Segmented block options={[{ value: 'higher', label: t('Higher') }, { value: 'lower', label: t('Lower') }]} /></Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name="cadence" label={t('Measured every')}><Segmented block options={[{ value: 'month', label: t('Month') }, { value: 'quarter', label: t('Quarter') }]} /></Form.Item></Col>
                        </Row>
                    </section>
                </Form>
            </ResponsiveModal>

            <ResponsiveModal
                open={!!entering}
                onClose={() => setEntering(undefined)}
                width={520}
                centered
                destroyOnHidden={false}
                className="admin-modal admin-form-modal is-plain-header"
                title={entering ? `${entering.kpi.name} · ${entering.period.label}` : undefined}
                footer={<Button block shape="round" size="large" type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => entryForm.submit()}>{t('Save value')}</Button>}
            >
                <Form form={entryForm} layout="vertical" requiredMark={false} onFinish={(values) => void saveEntry(values)}>
                    <section className="admin-form-modal-section">
                        {entering?.kpi.description && <p className="admin-form-modal-note">{entering.kpi.description}</p>}
                        <Form.Item name="value" label={t('Value')} rules={[{ required: true }]} extra={entering && entering.kpi.target !== null ? `${t('Target')} ${entering.kpi.direction === 'higher' ? '≥' : '≤'} ${formatValue(entering.kpi.target, entering.kpi.unit)}` : undefined}>
                            <InputNumber size="large" style={{ width: '100%' }} min={0} addonAfter={entering ? t(PLATFORM_KPI_UNITS.find((unit) => unit.key === entering.kpi.unit)?.label || '') : undefined} />
                        </Form.Item>
                        <Form.Item name="note" label={t('Note (optional)')}><Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t('Where the figure came from, or what explains it')} /></Form.Item>
                    </section>
                </Form>
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default PlatformKpisPage
