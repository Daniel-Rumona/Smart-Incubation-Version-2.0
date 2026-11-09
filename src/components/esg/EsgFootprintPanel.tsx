import { useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, Col, Input, InputNumber, List, Modal, Popconfirm, Radio, Row, Select, Space, Table, Tag, Tooltip, Typography, Upload, type TableProps } from 'antd'
import { CloudOutlined, DeleteOutlined, FileExcelOutlined, InfoCircleOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import {
    BASIC_CARBON_TAX_ALLOWANCE,
    EMISSION_SOURCES,
    GRID_FACTOR_COUNTRIES,
    gridFactorsFor,
    MAX_CARBON_TAX_ALLOWANCE,
    SCOPE_LABELS,
    carbonTaxEstimate,
    emissionSourceKind,
    footprintDataYear,
    footprintMonths,
    footprintTotals,
    formatQuantity,
    importFootprintWorkbook,
    newEmissionSource,
    sourceTonnes,
    sourceUsage,
    type FootprintWorkbookImport,
} from '@/config/esgEmissions'
import { countryName } from '@/config/esgStandards'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { saveEsgFootprint } from '@/services/esgReportsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { readXlsx } from '@/utils/learnerSpreadsheet'
import { rand } from '@/utils/trainingFormat'
import type { EsgCarbonTaxPayer, EsgEmissionSource, EsgFootprint, EsgReport, EsgScope } from '@/types/esg'

type Props = {
    report: EsgReport
    /** Problems from the report checks, by source id. */
    issues: Map<string, string[]>
}

/**
 * The client's carbon footprint: Scope 1, 2 and 3 sources month by month, each with its emission factor and where the
 * factor comes from, the totals, and (for South African clients) the carbon tax position. Saving also puts each scope's
 * total in the figures (GRI 305-1/2/3). Mounted with a key that changes with the saved report, so it starts from what
 * is saved.
 */
export const EsgFootprintPanel = ({ report, issues }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [footprint, setFootprint] = useState<EsgFootprint>(report.footprint)
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [imported, setImported] = useState<FootprintWorkbookImport | null>(null)

    const months = useMemo(() => footprintMonths(report.periodStart), [report.periodStart])
    const context = useMemo(() => ({ country: report.country, year: footprintDataYear(report.periodStart) }), [report.country, report.periodStart])
    const totals = useMemo(() => footprintTotals(footprint), [footprint])
    const tax = useMemo(() => carbonTaxEstimate(footprint, report), [footprint, report])
    const southAfrican = report.country === 'ZA'
    const countryGrid = gridFactorsFor(context.year, report.country)

    const change = (next: EsgFootprint) => {
        setFootprint(next)
        setDirty(true)
    }
    const changeSource = (id: string, changes: Partial<EsgEmissionSource>) =>
        change({ ...footprint, sources: footprint.sources.map((source) => source.id === id ? { ...source, ...changes } : source) })

    const save = async (next = footprint) => {
        if (!user) return
        setSaving(true)
        try {
            await saveEsgFootprint(user, report, next)
            setDirty(false)
            message.success(t('Saved. The Scope 1, 2 and 3 totals are in the figures (GRI 305).'))
        } catch {
            message.error(t('The carbon footprint could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const add = (kind: string) => {
        const source = newEmissionSource(kind, context)
        const sources = [...footprint.sources, source].sort((a, b) => a.scope - b.scope)
        change({ ...footprint, sources })
    }

    const readWorkbook = async (file: File) => {
        try {
            const result = importFootprintWorkbook(readXlsx(await file.arrayBuffer()), { ...context, periodStart: report.periodStart })
            if (!result) {
                message.warning(t('No usage was found. The workbook needs blocks headed Month and Usage, like the carbon footprint calculator.'))
                return
            }
            setImported(result)
        } catch {
            message.error(t('The workbook could not be read. Choose an Excel workbook (.xlsx).'))
        }
    }

    const applyImport = async (mode: 'add' | 'replace') => {
        if (!imported) return
        const sources = [...(mode === 'replace' ? [] : footprint.sources), ...imported.sources].sort((a, b) => a.scope - b.scope)
        const next = { ...footprint, sources }
        setFootprint(next)
        setImported(null)
        await save(next)
    }

    const sourceOptions = ([1, 2, 3] as EsgScope[]).map((scope) => ({
        label: t(SCOPE_LABELS[scope]),
        // Grid losses are left out where the country's electricity factor already includes them (Türkiye).
        options: EMISSION_SOURCES.filter((item) => item.scope === scope && !(item.kind === 'grid_losses' && countryGrid && countryGrid.losses === null))
            .map((item) => ({ value: item.kind, label: `${t(item.label)} (${t(item.unit)})` })),
    })).concat([{ label: t('Other'), options: [{ value: 'custom', label: t('Another source, with its own factor') }] }])

    const columns: TableProps<EsgEmissionSource>['columns'] = [
        {
            title: t('Source'),
            key: 'source',
            fixed: 'left',
            width: 230,
            render: (_, source) => {
                const known = emissionSourceKind(source.kind)
                const found = issues.get(source.id)
                return (
                    <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                        <Space size={4} wrap>
                            {source.kind === 'custom' ? (
                                <Select size="small" value={source.scope} onChange={(scope) => changeSource(source.id, { scope, taxable: scope === 1 ? source.taxable : false })} options={[1, 2, 3].map((scope) => ({ value: scope, label: `${t('Scope')} ${scope}` }))} style={{ width: 92 }} />
                            ) : <Tag color={source.scope === 1 ? 'volcano' : source.scope === 2 ? 'gold' : 'blue'}>{t('Scope')} {source.scope}</Tag>}
                            {found?.length ? <Tooltip title={found.join(' ')}><Typography.Text type="warning">{t('Check')}</Typography.Text></Tooltip> : null}
                        </Space>
                        {source.kind === 'custom' ? (
                            <>
                                <Input size="small" value={source.label} placeholder={t('What is measured, e.g. Packaging')} onChange={(event) => changeSource(source.id, { label: event.target.value })} />
                                <Input size="small" value={source.unit} placeholder={t('Unit, e.g. kg')} onChange={(event) => changeSource(source.id, { unit: event.target.value })} />
                            </>
                        ) : (
                            <Typography.Text>
                                {t(source.label)} <Typography.Text type="secondary">({t(source.unit)})</Typography.Text>
                                {known && <Tooltip title={t(known.hint)}><InfoCircleOutlined style={{ marginLeft: 6, color: '#8c8c8c' }} /></Tooltip>}
                            </Typography.Text>
                        )}
                    </Space>
                )
            },
        },
        ...months.map((month, index) => ({
            title: month.label,
            key: `m${index}`,
            width: 96,
            render: (_: unknown, source: EsgEmissionSource) => (
                <InputNumber
                    size="small"
                    min={0}
                    value={source.monthly[index]}
                    aria-label={`${source.label} ${month.label}`}
                    onChange={(value) => changeSource(source.id, { monthly: source.monthly.map((item, position) => position === index ? (typeof value === 'number' ? value : null) : item) })}
                    style={{ width: '100%' }}
                />
            ),
        })),
        {
            title: t('Year total'),
            key: 'usage',
            width: 120,
            render: (_, source) => <Typography.Text>{formatQuantity(sourceUsage(source))} {t(source.unit)}</Typography.Text>,
        },
        {
            title: t('Emission factor (kg CO2e per unit)'),
            key: 'factor',
            width: 260,
            render: (_, source) => (
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                    <InputNumber size="small" min={0} step={0.001} value={source.factor} status={source.factor === null ? 'error' : undefined} placeholder={t('Enter the factor')} onChange={(value) => changeSource(source.id, { factor: typeof value === 'number' ? value : null })} style={{ width: '100%' }} />
                    <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 3 }} value={source.factorSource} placeholder={t('Where the factor comes from')} onChange={(event) => changeSource(source.id, { factorSource: event.target.value })} />
                </Space>
            ),
        },
        ...(southAfrican ? [{
            title: <Tooltip title={t('Scope 1 fuels other than petrol and diesel, which are taxed at the pump.')}>{t('Carbon tax')}</Tooltip>,
            key: 'taxable',
            width: 90,
            render: (_: unknown, source: EsgEmissionSource) => (source.scope === 1
                ? <Checkbox checked={source.taxable} onChange={(event) => changeSource(source.id, { taxable: event.target.checked })} aria-label={t('Counts for carbon tax')} />
                : <Typography.Text type="secondary">—</Typography.Text>),
        }] : []),
        {
            title: t('t CO2e'),
            key: 'tonnes',
            width: 100,
            fixed: 'right',
            render: (_, source) => <Typography.Text strong>{source.factor === null ? '—' : formatQuantity(sourceTonnes(source))}</Typography.Text>,
        },
        {
            title: '',
            key: 'remove',
            width: 52,
            fixed: 'right',
            render: (_, source) => (
                <Popconfirm title={t('Remove this source?')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => change({ ...footprint, sources: footprint.sources.filter((item) => item.id !== source.id) })}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('Remove source')} />
                </Popconfirm>
            ),
        },
    ]

    const taxPayer = (value: EsgCarbonTaxPayer) => change({ ...footprint, carbonTaxPayer: value })

    return (
        <Space orientation="vertical" size={16} style={{ width: '100%' }}>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                {t('The client\'s greenhouse gas emissions from what it used each month: Scope 1 (fuel it burns), Scope 2 (electricity it buys) and Scope 3 (travel, commuting and other value-chain sources). Each factor says where it comes from; change it when the client has a better one.')}
            </Typography.Paragraph>

            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard icon={<CloudOutlined />} label={t('Carbon footprint (t CO2e)')} mobileTitle={t('Total')} value={formatQuantity(totals.total)} /></Col>
                {([1, 2, 3] as EsgScope[]).map((scope) => (
                    <Col xs={12} lg={6} key={scope}>
                        <DashboardMetricCard
                            label={t(SCOPE_LABELS[scope])}
                            mobileTitle={`${t('Scope')} ${scope}`}
                            value={formatQuantity(totals.byScope[scope])}
                            hint={totals.total > 0 ? t('{share}% of the total', undefined, { share: Math.round((totals.byScope[scope] / totals.total) * 100) }) : undefined}
                        />
                    </Col>
                ))}
            </Row>

            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space wrap>
                    <Select
                        value={null}
                        placeholder={<span><PlusOutlined /> {t('Add a source')}</span>}
                        options={sourceOptions}
                        onChange={(kind: string | null) => { if (kind) add(kind) }}
                        style={{ width: 300 }}
                        popupMatchSelectWidth={380}
                        aria-label={t('Add a source')}
                    />
                    <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void readWorkbook(file); return false }}>
                        <Button icon={<FileExcelOutlined />}>{t('Import carbon footprint workbook')}</Button>
                    </Upload>
                </Space>
                <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={() => void save()}>{dirty ? t('Save changes') : t('Saved')}</Button>
            </Space>

            {totals.missingFactor.length > 0 && (
                <Alert type="error" showIcon message={t('{count} source(s) have usage but no emission factor, so they are left out of the totals: {sources}.', undefined, { count: totals.missingFactor.length, sources: totals.missingFactor.map((source) => source.label || t('unnamed')).join(', ') })} />
            )}
            {!countryGrid && footprint.sources.some((source) => source.kind === 'electricity' || source.kind === 'grid_losses') && (
                <Alert type="info" showIcon message={t('There is no built-in grid emission factor for {country} yet: enter the one published for that country.', undefined, { country: countryName(report.country) })} />
            )}
            {countryGrid?.note && footprint.sources.some((source) => source.kind === 'electricity') && (
                <Alert type="info" showIcon message={t(countryGrid.note)} />
            )}

            <Table<EsgEmissionSource>
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={footprint.sources}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: t('No sources yet. Add the client\'s fuel, electricity and travel, or import the carbon footprint workbook.') }}
                summary={() => footprint.sources.length ? (
                    <Table.Summary.Row>
                        <Table.Summary.Cell index={0}><Typography.Text strong>{t('t CO2e per month')}</Typography.Text></Table.Summary.Cell>
                        {totals.monthly.map((value, index) => <Table.Summary.Cell key={months[index].label} index={index + 1}>{formatQuantity(value)}</Table.Summary.Cell>)}
                        <Table.Summary.Cell index={13} />
                        <Table.Summary.Cell index={14} />
                        {southAfrican && <Table.Summary.Cell index={15} />}
                        <Table.Summary.Cell index={southAfrican ? 16 : 15}><Typography.Text strong>{formatQuantity(totals.total)}</Typography.Text></Table.Summary.Cell>
                        <Table.Summary.Cell index={southAfrican ? 17 : 16} />
                    </Table.Summary.Row>
                ) : null}
            />

            {southAfrican ? (
                <Card size="small" title={t('Carbon tax')}>
                    <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                        <Typography.Text>{t('Does {client} pay carbon tax directly?', undefined, { client: report.clientName })}</Typography.Text>
                        <Radio.Group value={footprint.carbonTaxPayer} onChange={(event) => taxPayer(event.target.value as EsgCarbonTaxPayer)}>
                            <Space orientation="vertical">
                                <Radio value="no">{t('No: it runs no activities listed in the Carbon Tax Act above the thresholds')}</Radio>
                                <Radio value="yes">{t('Yes: it submits a carbon tax return to SARS')}</Radio>
                                <Radio value="unsure">{t('Not sure yet')}</Radio>
                            </Space>
                        </Radio.Group>
                        <Typography.Text type="secondary">
                            {t('Only companies running activities listed in the Carbon Tax Act above set thresholds (for example boilers or furnaces of 10 MW thermal capacity or more) pay carbon tax directly, and only on Scope 1 emissions. The tax on petrol and diesel is paid at the pump through the carbon fuel levy. Electricity (Scope 2) and Scope 3 are not taxed on the client.')}
                        </Typography.Text>
                        {tax.applies && (
                            <>
                                <Space wrap align="center">
                                    <Typography.Text>{t('Tax-free allowances claimed')}</Typography.Text>
                                    <InputNumber min={0} max={MAX_CARBON_TAX_ALLOWANCE} value={footprint.allowancePct} suffix="%" onChange={(value) => change({ ...footprint, allowancePct: typeof value === 'number' ? value : BASIC_CARBON_TAX_ALLOWANCE })} style={{ width: 110 }} />
                                    <Typography.Text type="secondary">{t('{basic}% is the basic allowance for fuel combustion; add the others the client qualifies for (trade exposure, performance, carbon budget, offsets), up to {max}% in all.', undefined, { basic: BASIC_CARBON_TAX_ALLOWANCE, max: MAX_CARBON_TAX_ALLOWANCE })}</Typography.Text>
                                </Space>
                                <Table
                                    size="small"
                                    pagination={false}
                                    rowKey="year"
                                    dataSource={tax.years}
                                    locale={{ emptyText: t('No taxable Scope 1 fuel recorded (coal, gas, LPG, paraffin). Tick "Carbon tax" on the lines that count.') }}
                                    columns={[
                                        { title: t('Year'), dataIndex: 'year', key: 'year' },
                                        { title: t('Taxable Scope 1 (t CO2e)'), key: 'tonnes', render: (_: unknown, row: typeof tax.years[number]) => formatQuantity(row.tonnes) },
                                        { title: t('Rate per tonne'), key: 'rate', render: (_: unknown, row: typeof tax.years[number]) => (row.rate === null ? t('Not on file') : `${rand(row.rate)}${row.announced ? '' : ` (${t('latest announced')})`}`) },
                                        { title: t('Before allowances'), key: 'gross', render: (_: unknown, row: typeof tax.years[number]) => (row.rate === null ? '—' : rand(row.tonnes * row.rate)) },
                                    ]}
                                />
                                <Alert
                                    type="info"
                                    showIcon
                                    message={t('Estimated carbon tax: {net} ({gross} less {allowance}% allowances)', undefined, { net: rand(tax.net), gross: rand(tax.gross), allowance: tax.allowancePct })}
                                    description={t('An estimate for the report. The client\'s SARS carbon tax return, with its own allowances and offsets, decides the amount.')}
                                />
                            </>
                        )}
                    </Space>
                </Card>
            ) : (
                <Typography.Text type="secondary">{t('The carbon tax estimate is for South African clients.')}</Typography.Text>
            )}

            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('Method: emissions = usage x emission factor, in tonnes CO2e, following the GHG Protocol Corporate Standard. Scope 2 is location-based: the official grid emission factor of the client\'s country for the year (built in for {countries}).', undefined, { countries: GRID_FACTOR_COUNTRIES.map((code) => countryName(code)).join(', ') })}
            </Typography.Text>

            <Modal
                open={imported !== null}
                title={t('Import the carbon footprint workbook')}
                onCancel={() => setImported(null)}
                footer={[
                    <Button key="cancel" onClick={() => setImported(null)}>{t('Cancel')}</Button>,
                    <Button key="add" loading={saving} onClick={() => void applyImport('add')}>{t('Add to what is there')}</Button>,
                    <Button key="replace" type="primary" loading={saving} onClick={() => void applyImport('replace')}>{t('Replace the footprint')}</Button>,
                ]}
            >
                <Space orientation="vertical" size={10} style={{ width: '100%' }}>
                    <Typography.Text>{t('{count} source(s) with usage from the "{sheet}" sheet:', undefined, { count: imported?.sources.length || 0, sheet: imported?.sheet || '' })}</Typography.Text>
                    <List size="small" bordered dataSource={imported?.sources || []} renderItem={(source) => (
                        <List.Item><Space wrap><Tag>{t('Scope')} {source.scope}</Tag>{t(source.label)}: {formatQuantity(sourceUsage(source))} {t(source.unit)}</Space></List.Item>
                    )} />
                    {imported && imported.replacedFactors.length > 0 && (
                        <Alert type="warning" showIcon message={t('The workbook\'s own factors are replaced by the current published ones:')} description={<ul style={{ margin: 0, paddingLeft: 18 }}>{imported.replacedFactors.map((line) => <li key={line}>{line}</li>)}</ul>} />
                    )}
                    {imported && imported.needFactor.length > 0 && (
                        <Alert type="info" showIcon message={t('Enter the emission factor for: {sources}.', undefined, { sources: imported.needFactor.join(', ') })} />
                    )}
                    <Typography.Text type="secondary">{t('Months are placed by name into the reporting period ({period}).', undefined, { period: `${months[0].label} – ${months[11].label}` })}</Typography.Text>
                </Space>
            </Modal>
        </Space>
    )
}
