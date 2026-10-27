import { Alert, App, Button, Card, Col, Empty, Form, Input, InputNumber, Radio, Row, Segmented, Select, Skeleton } from 'antd'
import {
    AimOutlined,
    AppstoreOutlined,
    CheckCircleOutlined,
    EditOutlined,
    FieldTimeOutlined,
    InboxOutlined,
    PlusOutlined,
    SaveOutlined,
    ThunderboltOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { AdminFormSectionHead } from '@/components/admin/AdminFormSectionHead'
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

type KpiSort = 'az' | 'ahead' | 'behind' | 'on_track'
type KpiListStatus = 'all' | PlatformKpiStatus

/** Positive means ahead of target; negative means behind. Respect lower-is-better KPIs. */
const targetVariance = (row: Row): number | null => {
    const { target, direction } = row.kpi
    const actual = row.actual.value
    if (target === null || actual === null || !Number.isFinite(target) || !Number.isFinite(actual)) return null
    const denominator = Math.max(Math.abs(target), 1)
    return ((direction === 'higher' ? actual - target : target - actual) / denominator) * 100
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
    const [search, setSearch] = useState('')
    const [listSort, setListSort] = useState<KpiSort>('az')
    const [listStatus, setListStatus] = useState<KpiListStatus>('all')
    const [selectedId, setSelectedId] = useState<string | null>(null)
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
    const visible = rows.filter((row) => {
        const matchesCategory = category === 'all' || row.kpi.category === category
        const q = search.trim().toLowerCase()
        return matchesCategory && (!q || [row.kpi.name, row.kpi.description, row.kpi.kind, row.kpi.category].some((value) => String(value ?? '').toLowerCase().includes(q)))
    })
    const listRows = useMemo(() => {
        const matched = visible.filter((row) => listStatus === 'all' || row.status === listStatus)
        return [...matched].sort((a, b) => {
            if (listSort === 'az') return a.kpi.name.localeCompare(b.kpi.name)
            if (listSort === 'on_track') {
                const priority = (status: PlatformKpiStatus) => status === 'on_track' ? 0 : status === 'met' ? 1 : 2
                const difference = priority(a.status) - priority(b.status)
                if (difference) return difference
            } else {
                const av = targetVariance(a)
                const bv = targetVariance(b)
                // Unmeasured/no-target KPIs always sort last.
                if (av === null && bv !== null) return 1
                if (av !== null && bv === null) return -1
                if (av !== null && bv !== null && av !== bv) {
                    return listSort === 'ahead' ? bv - av : av - bv
                }
            }
            return a.kpi.name.localeCompare(b.kpi.name)
        })
    }, [visible, listSort, listStatus])
    const selected = listRows.find((row) => row.kpi.id === selectedId) ?? listRows[0]
    const selectRow = (id: string) => setSelectedId(id)
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
        currentFilters: { category, search, period: offset, listSort, listStatus },
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

    const metricOptions = PLATFORM_METRICS.map((metric) => ({ value: metric.key, label: t(metric.name) }))

    const selectedCategory = selected ? PLATFORM_KPI_CATEGORIES.find((item) => item.key === selected.kpi.category) : undefined
    const selectedTarget = selected ? selected.kpi.target === null
        ? t('No target')
        : `${t('Target')} ${selected.kpi.direction === 'higher' ? '≥' : '≤'} ${formatValue(selected.kpi.target, selected.kpi.unit)}`
        : ''

    return (
        <DashboardPage className="platform-kpis-page admin-overview">
            {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />}
            <div className="platform-kpis-metrics">
                <div className="platform-kpis-metric"><AimOutlined /><span><strong>{rows.length}</strong><small>{t('KPIs tracked')}</small></span></div>
                <div className="platform-kpis-metric"><CheckCircleOutlined /><span><strong>{counts.good}</strong><small>{t('Met or on track')}</small></span></div>
                <div className="platform-kpis-metric"><WarningOutlined /><span><strong>{counts.behind}</strong><small>{t('Behind target')}</small></span></div>
                <div className="platform-kpis-metric"><FieldTimeOutlined /><span><strong>{counts.waiting}</strong><small>{t('Waiting for a value')}</small></span></div>
            </div>

            <FilterBar
                primary={<>
                    <Input.Search allowClear value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search KPIs')} className="platform-kpis-filter-search" />
                    <Segmented value={category} onChange={(value) => setCategory(value as typeof category)} options={[{ value: 'all', label: t('All') }, ...PLATFORM_KPI_CATEGORIES.map((item) => ({ value: item.key, label: t(item.label) }))]} />
                </>}
                actions={<>
                    <Segmented value={offset} onChange={(value) => setOffset(value as 0 | -1)} options={[{ value: 0, label: t('This period') }, { value: -1, label: t('Last period') }]} />
                    {missingRecommended > 0 && active.length > 0 && <Button icon={<AppstoreOutlined />} loading={seeding} onClick={() => void seed()}>{t('Add recommended ({count})', undefined, { count: missingRecommended })}</Button>}
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>{t('Add KPI')}</Button>
                </>}
            />

            {loading ? (
                <div className="platform-kpis-workspace"><Card><Skeleton active /></Card><Card><Skeleton active /></Card></div>
            ) : !active.length ? (
                <Card className="admin-card platform-kpis-empty" bordered={false}>
                    <span className="admin-kpi-icon"><AimOutlined /></span>
                    <h3>{t('No system KPIs yet')}</h3>
                    <p>{t('Start with a recommended set: adoption and engagement show whether what ships gets used; reliability and engineering show whether it is built well. Targets can be tuned after.')}</p>
                    <Button type="primary" shape="round" size="large" icon={<AppstoreOutlined />} loading={seeding} onClick={() => void seed()}>{t('Add {count} recommended KPIs', undefined, { count: RECOMMENDED_PLATFORM_KPIS.length })}</Button>
                    <Button type="link" onClick={() => openEditor()}>{t('Or add your own')}</Button>
                </Card>
            ) : (
                <div className="platform-kpis-workspace">
                    <section className="platform-kpis-list-panel">
                        <header className="platform-kpis-panel-heading">
                            <h2>{t('System KPIs')}</h2>
                            <span>{listRows.length} {t('of')} {rows.length}</span>
                        </header>
                        <div className="platform-kpis-list-controls">
                            <Select
                                aria-label={t('Sort KPIs')}
                                value={listSort}
                                onChange={setListSort}
                                options={[
                                    { value: 'az', label: t('A–Z') },
                                    { value: 'ahead', label: t('Most ahead') },
                                    { value: 'behind', label: t('Most behind') },
                                    { value: 'on_track', label: t('On track first') },
                                ]}
                            />
                            <Select
                                aria-label={t('Filter KPI status')}
                                value={listStatus}
                                onChange={setListStatus}
                                options={[
                                    { value: 'all', label: t('All statuses') },
                                    ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label: t(label) })),
                                ]}
                            />
                        </div>
                        <div className="platform-kpis-list-scroll">
                            {!listRows.length ? (
                                <Empty description={t('No KPIs match these filters.')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                            ) : listRows.map((row) => {
                                const variance = targetVariance(row)
                                return <button
                                    key={row.kpi.id}
                                    type="button"
                                    onClick={() => selectRow(row.kpi.id)}
                                    className={`platform-kpis-list-item is-${row.status} ${selected?.kpi.id === row.kpi.id ? 'is-selected' : ''}`}
                                    aria-pressed={selected?.kpi.id === row.kpi.id}
                                >
                                    <span className="platform-kpis-list-icon">{row.kpi.kind === 'auto' ? <ThunderboltOutlined /> : <EditOutlined />}</span>
                                    <span className="platform-kpis-list-copy">
                                        <strong>{row.kpi.name}</strong>
                                        <small><span className={`platform-kpis-list-status is-${row.status}`} />{t(STATUS_LABELS[row.status])} · {row.kpi.kind === 'auto' ? t('Automatic') : t('Manual')}</small>
                                    </span>
                                    <span className="platform-kpis-list-values">
                                        <span className="platform-kpis-list-number">{formatValue(row.actual.value, row.kpi.unit)}</span>
                                        {variance !== null && <small className={`platform-kpis-list-variance ${variance < 0 ? 'is-negative' : 'is-positive'}`}>{variance > 0 ? '+' : ''}{variance.toFixed(1)}%</small>}
                                    </span>
                                </button>
                            })}
                        </div>
                    </section>

                    <section className="platform-kpis-detail-panel">
                        {selected ? <>
                            <div className="platform-kpis-detail-scroll">
                                <header className="platform-kpis-detail-header">
                                    <div>
                                        <div className="platform-kpis-detail-badges">
                                            <span className={`platform-kpi-kind is-${selected.kpi.kind}`}>{selected.kpi.kind === 'auto' ? <ThunderboltOutlined /> : <EditOutlined />}{selected.kpi.kind === 'auto' ? t('Automatic') : t('Manual')}</span>
                                            <span className={`platform-kpi-status is-${selected.status}`}><i />{t(STATUS_LABELS[selected.status])}</span>
                                        </div>
                                        <h2>{selected.kpi.name}</h2>
                                        {selected.kpi.description && <p>{selected.kpi.description}</p>}
                                    </div>
                                </header>
                                <div className="platform-kpis-detail-stats">
                                    <div className="platform-kpis-detail-stat platform-kpis-detail-stat-primary"><span>{t('Actual')} · {selected.period.label}</span><strong>{formatValue(selected.actual.value, selected.kpi.unit)}</strong><small>{selectedTarget}</small></div>
                                    <div className="platform-kpis-detail-stat"><span>{t('Category')}</span><strong>{selectedCategory ? t(selectedCategory.label) : selected.kpi.category}</strong><small>{t('Source')}: {selected.kpi.kind === 'auto' ? t('Automatic') : t('Manual')}</small></div>
                                    <div className="platform-kpis-detail-stat"><span>{t('Measured every')}</span><strong>{selected.kpi.cadence === 'month' ? t('Month') : t('Quarter')}</strong><small>{t('Good is')}: {selected.kpi.direction === 'higher' ? t('Higher') : t('Lower')}</small></div>
                                </div>
                                <div className="platform-kpis-detail-section"><div className="platform-kpis-detail-section-head"><h3>{t('Target progress')}</h3><span>{selected.kpi.target === null ? t('No target') : `${Math.round(progressOf(selected.kpi, selected.actual.value))}%`}</span></div><div className={`platform-kpi-progress is-${selected.status}`}><span style={{ width: `${progressOf(selected.kpi, selected.actual.value)}%` }} /></div></div>
                                <div className="platform-kpis-detail-section platform-kpis-performance-section">
                                    <h3>{t('Recent performance')}</h3>
                                    <div className="platform-kpis-performance-chart" role="img" aria-label={t('Recent performance')}>
                                        {selected.history.map((item) => {
                                            const maximum = Math.max(1, ...selected.history.map((point) => Math.max(0, point.value ?? 0)))
                                            const height = item.value === null ? 0 : Math.max(item.value > 0 ? 4 : 0, Math.min(100, (Math.max(0, item.value) / maximum) * 100))
                                            return (
                                                <div className="platform-kpis-performance-column" key={item.period.key}>
                                                    <span className="platform-kpis-performance-value">{formatValue(item.value, selected.kpi.unit)}</span>
                                                    <div className="platform-kpis-performance-track">
                                                        <div className="platform-kpis-performance-bar" style={{ height: `${height}%` }} />
                                                    </div>
                                                    <span className="platform-kpis-performance-label">{item.period.shortLabel}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                                <p className="platform-kpis-detail-source">{selected.actual.manual ? t('Entered by {name}, {date}', undefined, { name: selected.actual.manual.byName || t('an admin'), date: dayjs(selected.actual.manual.at).format('D MMM') }) : selected.actual.detail || selected.period.label}</p>
                                {selected.kpi.kind === 'manual' && <Button icon={<FieldTimeOutlined />} block onClick={() => startEntry(selected)} type={selected.actual.value === null ? 'primary' : 'default'}>{selected.actual.value === null ? t('Enter value') : t('Update value')}</Button>}
                            </div>
                            <footer className="platform-kpis-detail-footer">
                                <Button block icon={<EditOutlined />} onClick={() => openEditor(selected.kpi)}>{t('Edit KPI')}</Button>
                                <Button block danger icon={<InboxOutlined />} onClick={() => archive(selected.kpi)}>{t('Archive')}</Button>
                            </footer>
                        </> : <div className="platform-kpis-no-selection"><Empty description={t('Select a KPI to view its details.')} /></div>}
                    </section>
                </div>
            )}

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
