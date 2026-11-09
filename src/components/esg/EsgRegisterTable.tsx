import { useMemo, useState } from 'react'
import { App, Button, Input, InputNumber, Popconfirm, Select, Space, Switch, Table, Tooltip, Typography, type TableProps } from 'antd'
import { DeleteOutlined, PlusOutlined, SaveOutlined, WarningOutlined } from '@ant-design/icons'
import { GRI_DISCLOSURES, suggestDisclosure } from '@/config/esgStandards'
import { useLanguage } from '@/providers/LanguageProvider'
import { newRowId } from '@/utils/esgToolkitImport'
import type { EsgPillar, EsgRegisterKey } from '@/types/esg'

type ColumnType = 'text' | 'long' | 'pillar' | 'score' | 'disclosure' | 'date'
type RegisterColumn = { key: string, title: string, type: ColumnType, width?: number }
type Row = Record<string, unknown> & { id: string }

/** The registers' columns, as headed in the facilitator's ESG toolkit workbook. */
const REGISTER_COLUMNS: Record<EsgRegisterKey, RegisterColumn[]> = {
    indicators: [
        { key: 'pillar', title: 'Area', type: 'pillar', width: 76 },
        { key: 'indicator', title: 'What is measured', type: 'long', width: 240 },
        { key: 'unit', title: 'Unit', type: 'text', width: 90 },
        { key: 'baseline', title: 'Baseline', type: 'text', width: 100 },
        { key: 'current', title: 'Current', type: 'text', width: 100 },
        { key: 'target', title: 'Target', type: 'text', width: 100 },
        { key: 'period', title: 'Period', type: 'text', width: 100 },
        { key: 'owner', title: 'Owner', type: 'text', width: 120 },
        { key: 'evidence', title: 'Evidence source', type: 'long', width: 170 },
        { key: 'qualityCheck', title: 'Quality check', type: 'text', width: 120 },
        { key: 'disclosure', title: 'GRI disclosure', type: 'disclosure', width: 240 },
    ],
    risks: [
        { key: 'pillar', title: 'Area', type: 'pillar', width: 76 },
        { key: 'risk', title: 'Risk', type: 'long', width: 220 },
        { key: 'stakeholders', title: 'Affected stakeholders', type: 'text', width: 160 },
        { key: 'likelihood', title: 'Likelihood 1-5', type: 'score', width: 100 },
        { key: 'impact', title: 'Impact 1-5', type: 'score', width: 100 },
        { key: 'mitigation', title: 'Mitigation / control', type: 'long', width: 220 },
        { key: 'owner', title: 'Owner', type: 'text', width: 120 },
        { key: 'reviewDate', title: 'Review date', type: 'date', width: 150 },
        { key: 'status', title: 'Status', type: 'text', width: 110 },
    ],
    stakeholders: [
        { key: 'stakeholder', title: 'Stakeholder', type: 'text', width: 160 },
        { key: 'concern', title: 'Concern', type: 'long', width: 220 },
        { key: 'influence', title: 'Influence 1-5', type: 'score', width: 100 },
        { key: 'impact', title: 'Impact 1-5', type: 'score', width: 100 },
        { key: 'engagement', title: 'Engagement method', type: 'text', width: 170 },
        { key: 'owner', title: 'Owner', type: 'text', width: 120 },
        { key: 'nextReview', title: 'Next review', type: 'date', width: 150 },
    ],
    actions: [
        { key: 'pillar', title: 'Area', type: 'pillar', width: 76 },
        { key: 'action', title: 'Action', type: 'long', width: 220 },
        { key: 'baseline', title: 'Baseline', type: 'text', width: 120 },
        { key: 'target', title: 'Target', type: 'text', width: 140 },
        { key: 'kpi', title: 'KPI', type: 'text', width: 130 },
        { key: 'owner', title: 'Owner', type: 'text', width: 120 },
        { key: 'startDate', title: 'Start date', type: 'date', width: 150 },
        { key: 'dueDate', title: 'Due date', type: 'date', width: 150 },
        { key: 'budget', title: 'Budget ZAR', type: 'text', width: 110 },
        { key: 'evidence', title: 'Evidence', type: 'text', width: 150 },
        { key: 'status', title: 'Status', type: 'text', width: 110 },
    ],
}

/** The few columns shown at first; the rest of the toolkit's columns are one switch away ("More detail"). */
const BASIC_COLUMNS: Record<EsgRegisterKey, string[]> = {
    indicators: ['pillar', 'indicator', 'unit', 'baseline', 'current', 'target'],
    risks: ['risk', 'likelihood', 'impact', 'mitigation'],
    stakeholders: ['stakeholder', 'concern', 'engagement'],
    actions: ['action', 'owner', 'dueDate', 'status'],
}

const blankRow = (register: EsgRegisterKey): Row => {
    const row: Row = { id: newRowId() }
    for (const column of REGISTER_COLUMNS[register]) row[column.key] = column.type === 'score' ? null : column.type === 'pillar' ? 'E' : ''
    return row
}

type Props = {
    register: EsgRegisterKey
    rows: Row[]
    /** Problems from the report checks, by row id. */
    issues: Map<string, string[]>
    onSave: (rows: Row[]) => Promise<void>
}

/** Mounted with a key that changes when the saved rows change, so it always starts from what is saved. */
export const EsgRegisterTable = ({ register, rows: savedRows, issues, onSave }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [rows, setRows] = useState<Row[]>(savedRows)
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [allColumns, setAllColumns] = useState(false)
    const shown = REGISTER_COLUMNS[register].filter((column) => allColumns || BASIC_COLUMNS[register].includes(column.key))

    const disclosureOptions = useMemo(() => (['E', 'S', 'G'] as EsgPillar[]).map((pillar) => ({
        label: { E: t('Environmental'), S: t('Social'), G: t('Governance') }[pillar],
        options: GRI_DISCLOSURES.filter((item) => item.pillar === pillar).map((item) => ({ value: item.id, label: `${item.id} ${item.title}` })),
    })), [t])

    const change = (id: string, key: string, value: unknown) => {
        setDirty(true)
        setRows((current) => current.map((row) => {
            if (row.id !== id) return row
            const next = { ...row, [key]: value }
            // An indicator gets its GRI disclosure suggested as soon as it has a name, until one is chosen.
            if (register === 'indicators' && (key === 'indicator' || key === 'unit') && !row.disclosure) {
                next.disclosure = suggestDisclosure(String(next.indicator || ''), String(next.unit || ''))
            }
            return next
        }))
    }

    const save = async () => {
        setSaving(true)
        try {
            await onSave(rows)
            setDirty(false)
            message.success(t('Saved.'))
        } catch {
            message.error(t('The register could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const editor = (column: RegisterColumn, row: Row) => {
        const value = row[column.key]
        if (column.type === 'pillar') {
            return <Select size="small" value={value as string} onChange={(next) => change(row.id, column.key, next)} options={[{ value: 'E', label: t('Environment') }, { value: 'S', label: t('Social') }, { value: 'G', label: t('Governance') }]} style={{ width: '100%' }} />
        }
        if (column.type === 'score') {
            return <InputNumber size="small" min={1} max={5} value={value as number | null} onChange={(next) => change(row.id, column.key, next ?? null)} style={{ width: '100%' }} />
        }
        if (column.type === 'disclosure') {
            return <Select size="small" allowClear showSearch optionFilterProp="label" value={(value as string) || undefined} onChange={(next) => change(row.id, column.key, next || '')} options={disclosureOptions} placeholder={t('Choose')} style={{ width: '100%' }} popupMatchSelectWidth={420} />
        }
        if (column.type === 'long') {
            return <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={String(value ?? '')} onChange={(event) => change(row.id, column.key, event.target.value)} />
        }
        return <Input size="small" type={column.type === 'date' ? 'date' : 'text'} value={String(value ?? '')} onChange={(event) => change(row.id, column.key, event.target.value)} />
    }

    const columns: TableProps<Row>['columns'] = [
        {
            title: '',
            key: 'issues',
            width: 36,
            fixed: 'left',
            render: (_, row) => {
                const found = issues.get(row.id)
                return found?.length ? <Tooltip title={found.join(' ')}><WarningOutlined style={{ color: '#d48806' }} /></Tooltip> : null
            },
        },
        ...shown.map((column) => ({
            title: t(column.title),
            key: column.key,
            width: column.key === 'pillar' ? 140 : column.width,
            render: (_: unknown, row: Row) => editor(column, row),
        })),
        ...(register === 'risks' ? [{
            title: t('Score'),
            key: 'score',
            width: 70,
            render: (_: unknown, row: Row) => (typeof row.likelihood === 'number' && typeof row.impact === 'number' ? <Typography.Text strong>{row.likelihood * row.impact}</Typography.Text> : '—'),
        }] : []),
        {
            title: '',
            key: 'remove',
            width: 52,
            fixed: 'right',
            render: (_, row) => (
                <Popconfirm title={t('Remove this row?')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => { setDirty(true); setRows((current) => current.filter((item) => item.id !== row.id)) }}>
                    <Button size="small" danger icon={<DeleteOutlined />} aria-label={t('Remove row')} />
                </Popconfirm>
            ),
        },
    ]

    return (
        <Space orientation="vertical" style={{ width: '100%' }} size={12}>
            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                <Space wrap>
                    <Button icon={<PlusOutlined />} onClick={() => { setDirty(true); setRows((current) => [...current, blankRow(register)]) }}>{t('Add row')}</Button>
                    <Space size={6}><Switch size="small" checked={allColumns} onChange={setAllColumns} aria-label={t('More detail')} /><Typography.Text type="secondary">{t('More detail')}</Typography.Text></Space>
                </Space>
                <Button type="primary" icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={() => void save()}>{dirty ? t('Save changes') : t('Saved')}</Button>
            </Space>
            <Table<Row>
                rowKey="id"
                size="small"
                columns={columns}
                dataSource={rows}
                pagination={false}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: t('Nothing here yet. Add a row, or import the ESG toolkit workbook.') }}
            />
        </Space>
    )
}
