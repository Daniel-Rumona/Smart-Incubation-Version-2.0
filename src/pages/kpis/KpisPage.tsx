import { App, Button, Card, Col, Dropdown, Empty, Form, Input, InputNumber, Radio, Row, Segmented, Select, Space, Tag, Typography } from 'antd'
import {
    CheckCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    MinusCircleOutlined,
    MoreOutlined,
    PlusOutlined,
    QuestionCircleOutlined,
    RiseOutlined,
    UserOutlined,
    WarningOutlined,
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { db } from '@/firebase'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import {
    archiveKpi,
    canEditKpis,
    computeActual,
    computeContribution,
    createKpi,
    listKpis,
    loadKpiData,
    periodFor,
    setManualActual,
    statusFor,
    targetFor,
    updateKpi,
    type KpiActual,
    type KpiData,
    type KpiPeriod,
    type KpiStatus,
} from '@/services/kpiService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import { listWorkspacePrograms } from '@/services/workspaceProgramsService'
import { KPI_CATALOGUE, type Kpi, type KpiDraft, type KpiKind, type KpiUnit } from '@/types/kpi'
import '@/styles/kpis.css'

const { Text } = Typography

type Option = { id: string; name: string }
type InterventionOption = { id: string; title: string; area: string }
type Row = { kpi: Kpi; period: KpiPeriod; actual: KpiActual; mine: KpiActual | null; target: { value: number; source: 'programme' | 'company' } | null; status: KpiStatus; pace: number | null }

// Same status colours as the reports (checked with the dataviz palette validator), per theme.
const STATUS_COLORS = {
    light: { met: '#15803D', on_track: '#2563EB', behind: '#DC2626', muted: '#64748B' },
    dark: { met: '#16A34A', on_track: '#3B82F6', behind: '#DC2626', muted: '#94A3B8' },
}

type FormValues = {
    name: string
    description?: string
    kind: KpiKind
    metric?: Kpi['metric']
    interventionIds?: string[]
    rule?: Kpi['rule']
    atLeast?: number
    unit?: KpiUnit
    direction?: Kpi['direction']
    cadence: Kpi['cadence']
    target?: number | null
    programTargets?: Array<{ programId?: string; value?: number }>
}

export const KpisPage = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { mode } = useThemeMode()
    const colors = STATUS_COLORS[mode === 'dark' ? 'dark' : 'light']
    const programId = isAllPrograms ? null : activeProgramId
    const editable = canEditKpis(user?.role)
    const companyCode = String(user?.companyCode || '')

    const [kpis, setKpis] = useState<Kpi[]>([])
    const [data, setData] = useState<KpiData>({ assignments: [], appointments: [] })
    const [programs, setPrograms] = useState<Option[]>([])
    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [offset, setOffset] = useState<0 | -1>(0)
    const [editing, setEditing] = useState<Kpi | 'new' | null>(null)
    const [recording, setRecording] = useState<Kpi | null>(null)
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm<FormValues>()
    const [actualForm] = Form.useForm<{ value: number; note?: string }>()

    const load = useCallback(async () => {
        if (!user) return
        setLoading(true)
        setError(null)
        try {
            const [nextKpis, nextData, nextPrograms, definitions] = await Promise.all([
                listKpis(companyCode),
                loadKpiData(companyCode),
                listWorkspacePrograms(user),
                companyCode ? getDocs(query(collection(db, 'interventions'), where('companyCode', '==', companyCode))) : Promise.resolve(null),
            ])
            setKpis(nextKpis)
            setData(nextData)
            setPrograms(nextPrograms.map((program) => ({ id: program.id, name: program.name })))
            setInterventions((definitions?.docs || [])
                .map((row) => ({ id: row.id, title: String(row.data().interventionTitle || 'Untitled intervention'), area: String(row.data().areaOfSupport || 'General') }))
                .sort((left, right) => left.title.localeCompare(right.title)))
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setLoading(false)
        }
    }, [companyCode, user])

    useEffect(() => { void load() }, [load])

    // Consultants see the company's KPIs read-only, with their own part of each alongside.
    const showsOwnPart = user?.role === 'consultant'
    const rows = useMemo<Row[]>(() => kpis.map((kpi) => {
        const period = periodFor(kpi.cadence, offset)
        const actual = computeActual(kpi, data, period, user, programId)
        const mine = showsOwnPart ? computeContribution(kpi, data, period, user, programId) : null
        const target = targetFor(kpi, programId)
        return { kpi, period, actual, mine, target, ...statusFor(kpi, actual, target?.value ?? null, period) }
    }), [data, kpis, offset, programId, showsOwnPart, user])

    const programName = (id: string) => programs.find((program) => program.id === id)?.name || t('Programme')
    const scopeName = programId ? programName(programId) : t('All programmes')

    const formatValue = (unit: KpiUnit, value: number | null) => {
        if (value === null) return '–'
        if (unit === 'percent') return `${value}%`
        if (unit === 'days') return value === 1 ? t('1 day') : t('{count} days', undefined, { count: value })
        if (unit === 'rating') return `${value.toFixed(1)} / 5`
        if (unit === 'currency') return formatCurrencyZAR(value)
        return value.toLocaleString()
    }

    const statusLabels: Record<KpiStatus, { label: string; icon: React.ReactNode; color: string }> = {
        met: { label: t('Met'), icon: <CheckCircleOutlined />, color: colors.met },
        on_track: { label: t('On track'), icon: <RiseOutlined />, color: colors.on_track },
        behind: { label: t('Behind'), icon: <WarningOutlined />, color: colors.behind },
        no_target: { label: t('No target'), icon: <MinusCircleOutlined />, color: colors.muted },
        no_data: { label: t('No data yet'), icon: <QuestionCircleOutlined />, color: colors.muted },
    }

    // One sentence on how the KPIs stand, naming the ones behind so the reader knows where to look.
    const verdict = (() => {
        if (!rows.length) return ''
        const count = (status: KpiStatus) => rows.filter((row) => row.status === status).length
        const behind = rows.filter((row) => row.status === 'behind').map((row) => row.kpi.name)
        const parts = [
            t('{met} met, {onTrack} on track and {behind} behind.', undefined, { met: count('met'), onTrack: count('on_track'), behind: behind.length }),
            behind.length ? t('Behind: {names}.', undefined, { names: behind.slice(0, 3).join(', ') + (behind.length > 3 ? ` +${behind.length - 3}` : '') }) : '',
            count('no_target') ? t('{count} without a target yet.', undefined, { count: count('no_target') }) : '',
        ]
        return parts.filter(Boolean).join(' ')
    })()

    // -----------------------------------------------------------------------
    // Editing
    // -----------------------------------------------------------------------

    const openEditor = (kpi: Kpi | 'new') => {
        setEditing(kpi)
        form.resetFields()
        if (kpi === 'new') {
            form.setFieldsValue({ kind: 'system', metric: 'completion_rate', name: t('Completion rate'), cadence: 'quarter', rule: 'any', unit: 'count', direction: 'higher', programTargets: [] })
            return
        }
        form.setFieldsValue({
            ...kpi,
            target: kpi.target,
            programTargets: Object.entries(kpi.programTargets).map(([programIdKey, value]) => ({ programId: programIdKey, value })),
        })
    }

    const kind = Form.useWatch('kind', form)
    const rule = Form.useWatch('rule', form)
    const metric = Form.useWatch('metric', form)
    const pickedInterventions = Form.useWatch('interventionIds', form) || []
    const unitInForm: KpiUnit = kind === 'system' ? KPI_CATALOGUE.find((item) => item.key === metric)?.unit || 'count' : kind === 'interventions' ? 'count' : Form.useWatch('unit', form) || 'count'
    const unitSuffix = unitInForm === 'percent' ? '%' : unitInForm === 'days' ? t('days') : unitInForm === 'rating' ? '/ 5' : unitInForm === 'currency' ? 'ZAR' : undefined

    const save = async () => {
        if (!user) return
        const values = await form.validateFields()
        const system = values.kind === 'system' ? KPI_CATALOGUE.find((item) => item.key === values.metric) : null
        const draft: KpiDraft = {
            name: values.name,
            description: values.description,
            kind: values.kind,
            metric: values.metric,
            interventionIds: values.interventionIds,
            rule: values.rule,
            atLeast: values.atLeast,
            unit: system ? system.unit : values.kind === 'interventions' ? 'count' : values.unit || 'count',
            direction: system ? system.direction : values.kind === 'interventions' ? 'higher' : values.direction || 'higher',
            cadence: values.cadence,
            target: typeof values.target === 'number' ? values.target : null,
            programTargets: Object.fromEntries((values.programTargets || []).filter((row) => row.programId && typeof row.value === 'number').map((row) => [row.programId as string, row.value as number])),
        }
        setSaving(true)
        try {
            if (editing === 'new') await createKpi(user, draft)
            else if (editing) await updateKpi(editing.id, draft)
            message.success(editing === 'new' ? t('KPI added') : t('KPI saved'))
            setEditing(null)
            await load()
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : t('The KPI could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const archive = (kpi: Kpi) => modal.confirm({
        title: t('Archive {name}?', undefined, { name: kpi.name }),
        content: t('It disappears from this page and the reports. Its history is kept.'),
        okText: t('Archive'),
        okButtonProps: { danger: true },
        onOk: async () => {
            await archiveKpi(kpi.id)
            await load()
        },
    })

    const saveActual = async () => {
        if (!user || !recording) return
        const values = await actualForm.validateFields()
        setSaving(true)
        try {
            await setManualActual(user, recording, periodFor(recording.cadence, offset).key, programId, values.value, values.note)
            message.success(t('Actual saved'))
            setRecording(null)
            await load()
        } catch (failure) {
            message.error(failure instanceof Error ? failure.message : t('The actual could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const ruleText = (kpi: Kpi) => {
        const count = kpi.interventionIds?.length || 0
        if (kpi.kind !== 'interventions' || !count) return null
        if (count === 1) return t('Counts SMEs that complete 1 intervention')
        if (kpi.rule === 'all') return t('Counts SMEs that complete all {count} interventions', undefined, { count })
        if (kpi.rule === 'atLeast') return t('Counts SMEs that complete at least {needed} of {count} interventions', undefined, { needed: kpi.atLeast || 1, count })
        return t('Counts SMEs that complete any of {count} interventions', undefined, { count })
    }

    // -----------------------------------------------------------------------
    // Render
    // -----------------------------------------------------------------------

    // Counts add up, so a share reads as "4 of the 31"; a rate, a median or a rating is the consultant's own figure.
    const ownPartText = (kpi: Kpi, mine: KpiActual, actual: KpiActual) => {
        if (mine.value === null) return t('Yours: no data yet')
        if (['count', 'currency', 'number'].includes(kpi.unit) && actual.value !== null) {
            return t('Yours: {mine} of the {total}', undefined, { mine: formatValue(kpi.unit, mine.value), total: formatValue(kpi.unit, actual.value) })
        }
        return t('Yours: {mine}', undefined, { mine: formatValue(kpi.unit, mine.value) })
    }

    const card = (row: Row) => {
        const { kpi, actual, mine, target, status, pace, period } = row
        const state = statusLabels[status]
        const higher = kpi.direction === 'higher'
        const fill = target && actual.value !== null && higher && target.value > 0 ? Math.min(100, (actual.value / target.value) * 100) : 0
        const menu = editable ? [
            { key: 'edit', icon: <EditOutlined />, label: t('Edit'), onClick: () => openEditor(kpi) },
            { key: 'archive', icon: <DeleteOutlined />, label: t('Archive'), danger: true, onClick: () => archive(kpi) },
        ] : []
        return (
            <Card className="kpi-card" key={kpi.id}>
                <div className="kpi-card-head">
                    <div className="kpi-card-title">
                        <strong>{kpi.name}</strong>
                        <span>{ruleText(kpi) || kpi.description || t(KPI_CATALOGUE.find((item) => item.key === kpi.metric)?.description || '')}</span>
                    </div>
                    {menu.length > 0 && (
                        <Dropdown trigger={['click']} menu={{ items: menu }} placement="bottomRight">
                            <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('KPI options')} />
                        </Dropdown>
                    )}
                </div>

                <div className="kpi-card-figure">
                    <span className="kpi-card-value">{formatValue(kpi.unit, actual.value)}</span>
                    <span className="kpi-card-target">
                        {target
                            ? (higher ? t('of {target} target', undefined, { target: formatValue(kpi.unit, target.value) }) : t('target {target} or fewer', undefined, { target: formatValue(kpi.unit, target.value) }))
                            : t('no target set')}
                        {target?.source === 'programme' && <Tag bordered={false} className="kpi-card-source">{t('Programme target')}</Tag>}
                    </span>
                </div>

                {mine && <div className="kpi-card-mine"><UserOutlined /> {ownPartText(kpi, mine, actual)}</div>}

                {target && higher && (
                    <div className="kpi-progress" role="img" aria-label={`${Math.round(fill)}%`}>
                        <span className="kpi-progress-fill" style={{ width: `${fill}%`, background: state.color }} />
                        {/* Where a count should be by now to finish the period on target. */}
                        {pace !== null && target.value > 0 && <span className="kpi-progress-pace" style={{ left: `${Math.min(100, (pace / target.value) * 100)}%` } as CSSProperties} title={t('Expected by now')} />}
                    </div>
                )}

                <div className="kpi-card-foot">
                    <span className="kpi-status" style={{ color: state.color }}>{state.icon} {state.label}</span>
                    <Text type="secondary" className="kpi-card-meta">
                        {[actual.detail, period.label].filter(Boolean).join(' · ')}
                    </Text>
                </div>

                {kpi.kind === 'manual' && (
                    <div className="kpi-card-manual">
                        <Text type="secondary">
                            {actual.manual ? t('Entered by {name}', undefined, { name: actual.manual.byName }) : t('No actual entered for {period}.', undefined, { period: period.label })}
                        </Text>
                        {editable && <Button size="small" onClick={() => { setRecording(kpi); actualForm.setFieldsValue({ value: actual.manual ? actual.value ?? undefined : undefined, note: actual.manual?.note }) }}>{actual.manual ? t('Update actual') : t('Enter actual')}</Button>}
                    </div>
                )}
            </Card>
        )
    }

    return (
        <DashboardPage className="kpis-page">
            <FilterBar
                compact
                primary={
                    <>
                        <Segmented<0 | -1>
                            value={offset}
                            onChange={setOffset}
                            options={[{ value: 0, label: t('Current period') }, { value: -1, label: t('Previous period') }]}
                        />
                        <Text type="secondary" className="kpis-scope">{scopeName}</Text>
                    </>
                }
                actions={editable ? <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>{t('New KPI')}</Button> : undefined}
            />

            {error ? (
                <Card><Empty description={t('KPIs could not be loaded: {error}', undefined, { error })} /></Card>
            ) : !loading && !rows.length ? (
                <Card className="kpis-empty">
                    <Empty
                        description={editable
                            ? t('Set the goals your team works towards. Each KPI tracks its actual against a target, for the company or per programme.')
                            : t('No KPIs have been set yet.')}
                    >
                        {editable && <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>{t('Add your first KPI')}</Button>}
                    </Empty>
                </Card>
            ) : (
                <>
                    <Card loading={loading} className="dashboard-section-card kpis-verdict">
                        <Text type="secondary">{t('{scope} · {period}', undefined, { scope: scopeName, period: offset === 0 ? t('Current period') : t('Previous period') })}</Text>
                        <p>{verdict}</p>
                        {showsOwnPart && <Text type="secondary" className="kpis-own-note">{t('These are your company’s figures. Your own part is shown on each card.')}</Text>}
                    </Card>
                    <Row gutter={[16, 16]}>
                        {rows.map((row) => <Col key={row.kpi.id} xs={24} md={12} xl={8}>{card(row)}</Col>)}
                    </Row>
                </>
            )}

            <ResponsiveModal
                open={editing !== null}
                onClose={() => setEditing(null)}
                title={editing === 'new' ? t('New KPI') : t('Edit KPI')}
                width={640}
                centered
                footer={<Space><Button onClick={() => setEditing(null)}>{t('Cancel')}</Button><Button type="primary" loading={saving} onClick={() => void save()}>{t('Save')}</Button></Space>}
            >
                <Form form={form} layout="vertical" requiredMark="optional" className="kpi-form">
                    <Form.Item name="kind" label={t('What does it measure?')}>
                        <Segmented<KpiKind>
                            block
                            options={[
                                { value: 'system', label: t('A system metric') },
                                { value: 'interventions', label: t('Interventions') },
                                { value: 'manual', label: t('Entered by hand') },
                            ]}
                        />
                    </Form.Item>

                    {kind === 'system' && (
                        <Form.Item name="metric" label={t('Metric')} rules={[{ required: true }]}>
                            <Select
                                options={KPI_CATALOGUE.map((item) => ({ value: item.key, label: t(item.name), description: t(item.description) }))}
                                optionRender={(option) => <div><div>{option.label}</div><Text type="secondary" style={{ fontSize: 12 }}>{option.data.description}</Text></div>}
                                onChange={(value) => {
                                    const current = form.getFieldValue('name')
                                    const wasCatalogueName = !current || KPI_CATALOGUE.some((item) => t(item.name) === current)
                                    if (wasCatalogueName) form.setFieldValue('name', t(KPI_CATALOGUE.find((item) => item.key === value)?.name || ''))
                                }}
                            />
                        </Form.Item>
                    )}

                    {kind === 'interventions' && (
                        <>
                            <Form.Item name="interventionIds" label={t('Interventions')} rules={[{ required: true, message: t('Pick at least one intervention.') }]}>
                                <Select
                                    mode="multiple"
                                    showSearch
                                    optionFilterProp="label"
                                    placeholder={t('Search interventions')}
                                    options={interventions.map((item) => ({ value: item.id, label: item.title, area: item.area }))}
                                    optionRender={(option) => <div><div>{option.label}</div><Text type="secondary" style={{ fontSize: 12 }}>{option.data.area}</Text></div>}
                                />
                            </Form.Item>
                            {pickedInterventions.length > 1 && (
                                <Form.Item name="rule" label={t('An SME counts when it completes')}>
                                    <Radio.Group className="kpi-rule">
                                        <Radio value="any">{t('Any one of them')}</Radio>
                                        <Radio value="all">{t('All of them')}</Radio>
                                        <Radio value="atLeast">
                                            <Space size={6}>
                                                {t('At least')}
                                                <Form.Item name="atLeast" noStyle initialValue={2}>
                                                    <InputNumber min={1} max={pickedInterventions.length} size="small" style={{ width: 64 }} disabled={rule !== 'atLeast'} />
                                                </Form.Item>
                                                {t('of them')}
                                            </Space>
                                        </Radio>
                                    </Radio.Group>
                                </Form.Item>
                            )}
                            <Text type="secondary" className="kpi-form-hint">
                                {t('An SME counts in the period it meets the rule. In a group intervention, each SME counts on its own.')}
                            </Text>
                        </>
                    )}

                    {kind === 'manual' && (
                        <Row gutter={12}>
                            <Col xs={24} sm={12}>
                                <Form.Item name="unit" label={t('Unit')}>
                                    <Select options={[
                                        { value: 'count', label: t('Count') },
                                        { value: 'percent', label: t('Percentage') },
                                        { value: 'currency', label: t('Rand (ZAR)') },
                                        { value: 'number', label: t('Number') },
                                    ]} />
                                </Form.Item>
                            </Col>
                            <Col xs={24} sm={12}>
                                <Form.Item name="direction" label={t('Better when it is')}>
                                    <Select options={[{ value: 'higher', label: t('Higher') }, { value: 'lower', label: t('Lower') }]} />
                                </Form.Item>
                            </Col>
                        </Row>
                    )}

                    <Form.Item name="name" label={t('Name')} rules={[{ required: true, message: t('Give the KPI a name.') }]}>
                        <Input maxLength={80} placeholder={t('Compliance-ready SMEs')} />
                    </Form.Item>
                    <Form.Item name="description" label={t('Description')}>
                        <Input.TextArea maxLength={200} autoSize={{ minRows: 1, maxRows: 3 }} placeholder={t('What it means and why it matters')} />
                    </Form.Item>

                    <Form.Item name="cadence" label={t('Tracked per')}>
                        <Segmented options={[{ value: 'month', label: t('Month') }, { value: 'quarter', label: t('Quarter') }, { value: 'year', label: t('Year') }]} />
                    </Form.Item>

                    <Form.Item name="target" label={t('Company target')} extra={t('Leave empty to track it without a target.')}>
                        <InputNumber min={0} style={{ width: 200 }} addonAfter={unitSuffix} />
                    </Form.Item>

                    <Form.List name="programTargets">
                        {(fields, { add, remove }) => (
                            <div className="kpi-program-targets">
                                <Text strong>{t('Programme targets')}</Text>
                                <Text type="secondary" className="kpi-form-hint">{t('A programme with its own target (for example a sponsor contract) uses it instead of the company one.')}</Text>
                                {fields.map((field) => (
                                    <Space.Compact key={field.key} block className="kpi-program-row">
                                        <Form.Item name={[field.name, 'programId']} noStyle rules={[{ required: true }]}>
                                            <Select placeholder={t('Programme')} style={{ width: '60%' }} options={programs.map((program) => ({ value: program.id, label: program.name }))} />
                                        </Form.Item>
                                        <Form.Item name={[field.name, 'value']} noStyle rules={[{ required: true }]}>
                                            <InputNumber min={0} placeholder={t('Target')} style={{ width: '40%' }} />
                                        </Form.Item>
                                        <Button icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label={t('Remove programme target')} />
                                    </Space.Compact>
                                ))}
                                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add()} disabled={!programs.length}>{t('Add programme target')}</Button>
                            </div>
                        )}
                    </Form.List>
                </Form>
            </ResponsiveModal>

            <ResponsiveModal
                open={recording !== null}
                onClose={() => setRecording(null)}
                title={recording ? t('Actual for {name}', undefined, { name: recording.name }) : ''}
                width={440}
                centered
                footer={<Space><Button onClick={() => setRecording(null)}>{t('Cancel')}</Button><Button type="primary" loading={saving} onClick={() => void saveActual()}>{t('Save')}</Button></Space>}
            >
                {recording && (
                    <Form form={actualForm} layout="vertical" requiredMark="optional">
                        <Text type="secondary" className="kpi-form-hint">
                            {t('{period} · {scope}', undefined, { period: periodFor(recording.cadence, offset).label, scope: scopeName })}
                        </Text>
                        <Form.Item name="value" label={t('Actual')} rules={[{ required: true, message: t('Enter the actual.') }]}>
                            <InputNumber min={0} style={{ width: 200 }} />
                        </Form.Item>
                        <Form.Item name="note" label={t('Source or note')}>
                            <Input maxLength={160} placeholder={t('Quarterly sponsor return')} />
                        </Form.Item>
                    </Form>
                )}
            </ResponsiveModal>
        </DashboardPage>
    )
}

export default KpisPage
