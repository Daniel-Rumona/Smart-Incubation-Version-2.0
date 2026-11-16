import { useMemo, useState } from 'react'
import { Button, Descriptions, Input, Modal, Select, Space, Tag, Typography } from 'antd'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import type { ImpactResult } from '@/services/matchedImpactLogic'

const labels = { reportable: 'Reportable', early: 'Early signal', insufficient: 'Not enough data' }
const colour = { reportable: 'green', early: 'gold', insufficient: 'default' }
const amount = (row: ImpactResult, value: number | null) => value == null || row.status === 'insufficient' ? '—' : `${value > 0 ? '+' : ''}${value} ${row.metric === 'jobs' ? 'jobs' : 'pts'}`

export default function MatchedImpactPanel({ rows, programNames, showProgramme }: {
    rows: ImpactResult[], programNames: Record<string, string>, showProgramme: boolean,
}) {
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState('all')
    const [selected, setSelected] = useState<ImpactResult | null>(null)
    const filtered = useMemo(() => rows.filter(row => (status === 'all' || row.status === status)
        && row.interventionTitle.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => (b.liftPercent ?? -Infinity) - (a.liftPercent ?? -Infinity)), [rows, search, status])
    return <div className="impact-matched-panel">
        <div className="impact-evidence-summary">
            {Object.entries(labels).map(([key, label]) => <Tag key={key} color={colour[key as keyof typeof colour]}>{rows.filter(row => row.status === key).length} {label}</Tag>)}
        </div>
        <div className="impact-table-toolbar">
            <Input placeholder="Search interventions" aria-label="Search interventions" value={search} onChange={event => setSearch(event.target.value)} allowClear />
            <Select aria-label="Evidence status" value={status} onChange={setStatus} style={{ minWidth: 180 }} options={[{ value: 'all', label: 'All evidence' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} />
        </div>
        <Typography.Paragraph type="secondary" className="impact-table-caption">Compared with similar SMEs in the same programme. Revenue is in percentage points; jobs are people per SME.</Typography.Paragraph>
        <ResponsiveDataView rows={filtered} rowKey={row => `${row.programId}-${row.interventionId}-${row.metric}`} emptyText="No SME-confirmed completions with an identifiable intervention in this scope."
            columns={[
                { title: 'Intervention', dataIndex: 'interventionTitle', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
                ...(showProgramme ? [{ title: 'Programme', render: (_: unknown, row: ImpactResult) => programNames[row.programId] || 'Programme' }] : []),
                { title: 'Evidence', render: (_, row) => <Space wrap><Tag color={colour[row.status]}>{labels[row.status]}</Tag>{row.demo && <Tag>Demo data</Tag>}</Space> },
                { title: 'Difference', align: 'right', render: (_, row) => amount(row, row.liftPercent) },
                { title: 'SMEs / comparison', align: 'right', render: (_, row) => `${row.treatedCount} / ${row.comparisonCount}` },
                { title: '', align: 'right', render: (_, row) => <Button type="text" onClick={() => setSelected(row)}>Details →</Button> },
            ]}
            renderCard={row => <Space direction="vertical"><Typography.Text strong>{row.interventionTitle}</Typography.Text>{showProgramme && <Typography.Text>{programNames[row.programId] || 'Programme'}</Typography.Text>}<Tag color={colour[row.status]}>{labels[row.status]}</Tag>{row.demo && <Tag>Demo data</Tag>}<Typography.Text>{amount(row, row.liftPercent)}</Typography.Text><Button onClick={() => setSelected(row)}>Details</Button></Space>}
        />
        <Modal title={selected?.interventionTitle} open={!!selected} onCancel={() => setSelected(null)} footer={null} width={720}>
            {selected && <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Space><Tag color={colour[selected.status]}>{labels[selected.status]}</Tag>{selected.demo && <Tag>Demo data</Tag>}</Space>
                {selected.headline && <Typography.Paragraph>{selected.headline}</Typography.Paragraph>}
                <Descriptions layout="vertical" column={2} items={[
                    { key: 'lift', label: 'Difference vs comparison', children: amount(selected, selected.liftPercent) },
                    { key: 'range', label: 'Likely range (90%)', children: selected.status === 'insufficient' ? '—' : `${amount(selected, selected.rangeLowPercent)} to ${amount(selected, selected.rangeHighPercent)}` },
                    { key: 'treated', label: 'Completing SMEs: average change', children: selected.status === 'insufficient' || selected.treatedChangePercent == null ? '—' : `${selected.treatedChangePercent > 0 ? '+' : ''}${selected.treatedChangePercent}${selected.metric === 'revenue' ? '%' : ' jobs'}` },
                    { key: 'comparison', label: 'Comparison SMEs: average change', children: selected.status === 'insufficient' || selected.comparisonChangePercent == null ? '—' : `${selected.comparisonChangePercent > 0 ? '+' : ''}${selected.comparisonChangePercent}${selected.metric === 'revenue' ? '%' : ' jobs'}` },
                    { key: 'sample', label: 'SMEs measured / comparison', children: `${selected.treatedCount} / ${selected.comparisonCount}` },
                    { key: 'missing', label: 'Without sufficient reports or comparison', children: selected.treatedWithoutData },
                    { key: 'overlap', label: 'Also completed other interventions', children: `${Math.round(selected.overlapShare * 100)}%` },
                    { key: 'match', label: 'Matching: sector + size / sector / programme', children: `${selected.matching.sectorAndBand} / ${selected.matching.sector} / ${selected.matching.programme}` },
                    { key: 'period', label: 'Completion months', children: selected.period ? `${selected.period.from} – ${selected.period.to}` : '—' },
                    { key: 'achieved', label: 'Outcome achieved: difference', children: amount(selected, selected.byOutcome.achieved.liftPercent) },
                    { key: 'notAchieved', label: 'Outcome partial/not yet: difference', children: amount(selected, selected.byOutcome.notAchieved.liftPercent) },
                ]} />
                <Typography.Text type="secondary">A link, not proof of cause. Shared interventions and differences between SMEs can affect this estimate.</Typography.Text>
            </Space>}
        </Modal>
    </div>
}
