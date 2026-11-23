import { useEffect, useState } from 'react'
import { Alert, Card, Table, Typography } from 'antd'
import { PROSPECT_SOURCES, type ProspectModule } from '@/config/prospects'
import { useLanguage } from '@/providers/LanguageProvider'
import { getProspectFunnel } from '@/services/prospectsService'
import type { ProspectFunnel as FunnelResult } from '@/types/prospects'
import { rand } from '@/utils/trainingFormat'

/**
 * Reach beyond the enrolled cohort, per source: reached, engaged, invited (or sent a proposal), and converted.
 * Numbers only, worked out on the server. Staff see the whole company and, per event or campaign, how many it brought
 * and (training) the income from the clients it brought. A funder sees only the prospects tied to what it funds.
 * These numbers are reach, not impact: they change no impact figure.
 */
export function ProspectFunnel({ module, companyCode, refreshKey, result: given }: { module: ProspectModule, companyCode?: string, refreshKey?: unknown, result?: FunnelResult }) {
    const { t } = useLanguage()
    const [loaded, setLoaded] = useState<FunnelResult>()
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        if (given) return
        let cancelled = false
        getProspectFunnel(module, companyCode)
            .then((value) => { if (!cancelled) { setLoaded(value); setFailed(false) } })
            .catch(() => { if (!cancelled) { setLoaded({ rows: [], byEvent: [], scope: 'company' }); setFailed(true) } })
        return () => { cancelled = true }
    }, [companyCode, given, module, refreshKey])

    const result = given || loaded
    const all = result?.rows.find((row) => row.source === 'all')
    const sourceLabel = (source: string) => (source === 'all' ? t('All sources') : t(PROSPECT_SOURCES.find((option) => option.key === source)?.label || 'Other'))
    const converted = module === 'training' ? t('Became clients') : t('Joined')
    const verb = module === 'training' ? t('became clients') : t('joined')

    if (failed) return <Alert type="info" showIcon title={t('The reach figures are not available right now.')} />
    return (
        <div>
            {all && all.reached > 0 && (
                <Typography.Paragraph>
                    {result?.scope === 'funded'
                        ? t('{reached} reached through what you fund; {converted} of them {verb} ({pct}%).', undefined, { reached: all.reached, converted: all.converted, pct: all.conversionPct, verb })
                        : t('{reached} reached beyond the enrolled cohort; {converted} of them {verb} ({pct}%).', undefined, { reached: all.reached, converted: all.converted, pct: all.conversionPct, verb })}
                </Typography.Paragraph>
            )}
            <Table
                size="small"
                rowKey="source"
                loading={!result}
                pagination={false}
                dataSource={result?.rows || []}
                scroll={{ x: 'max-content' }}
                locale={{ emptyText: t('No prospects recorded yet.') }}
                columns={[
                    { title: t('Source'), key: 'source', render: (_, row) => (row.source === 'all' ? <Typography.Text strong>{sourceLabel(row.source)}</Typography.Text> : sourceLabel(row.source)) },
                    { title: t('Reached'), dataIndex: 'reached', align: 'center' },
                    { title: t('Contacted'), dataIndex: 'engaged', align: 'center' },
                    { title: module === 'training' ? t('Proposal sent') : t('Invited'), dataIndex: 'invited', align: 'center' },
                    { title: converted, dataIndex: 'converted', align: 'center' },
                    { title: t('Conversion'), key: 'pct', align: 'center', render: (_, row) => `${row.conversionPct}%` },
                ]}
            />
            {result && result.byEvent.length > 0 && (
                <>
                    <Typography.Title level={5} style={{ marginTop: 20 }}>
                        {module === 'training' ? t('Which events and campaigns bring paying clients') : t('Which events and campaigns bring businesses that join')}
                    </Typography.Title>
                    <Table
                        size="small"
                        rowKey={(row) => `${row.source}|${row.event}`}
                        pagination={{ pageSize: 8, hideOnSinglePage: true }}
                        dataSource={result.byEvent}
                        scroll={{ x: 'max-content' }}
                        columns={[
                            { title: t('Event or campaign'), key: 'event', render: (_, row) => <span>{row.event}<Typography.Text type="secondary">{` · ${sourceLabel(row.source)}`}</Typography.Text></span> },
                            { title: t('Reached'), dataIndex: 'reached', align: 'center' },
                            { title: t('Contacted'), dataIndex: 'engaged', align: 'center' },
                            { title: converted, dataIndex: 'converted', align: 'center' },
                            { title: t('Conversion'), key: 'pct', align: 'center', render: (_, row) => `${row.conversionPct}%` },
                            ...(module === 'training' ? [{ title: t('Income from these clients'), key: 'revenue', align: 'right' as const, render: (_: unknown, row: FunnelResult['byEvent'][number]) => (row.revenue ? rand(row.revenue) : '—') }] : []),
                        ]}
                    />
                    {module === 'training' && (
                        <Typography.Text type="secondary">{t('Income is what was paid or invoiced by the clients each event brought, matched on the client company\'s name.')}</Typography.Text>
                    )}
                </>
            )}
        </div>
    )
}

/**
 * The funnel in a card for funder pages: only the prospects tied to what the funder pays for (its programmes, or the
 * classes it funds), numbers only, and only when there are any.
 */
export function ProspectReachCard({ module, companyCode }: { module: ProspectModule, companyCode: string }) {
    const { t } = useLanguage()
    const [result, setResult] = useState<FunnelResult | null>(null)
    useEffect(() => {
        let cancelled = false
        if (!companyCode) return
        getProspectFunnel(module, companyCode)
            .then((value) => { if (!cancelled) setResult(value.rows.some((row) => row.source === 'all' && row.reached > 0) ? value : null) })
            .catch(() => { if (!cancelled) setResult(null) })
        return () => { cancelled = true }
    }, [companyCode, module])
    if (!result) return null
    const funded = result.scope === 'funded'
    return (
        <Card
            title={funded ? t('Reach through what you fund') : t('Reach beyond the enrolled cohort')}
            style={{ marginTop: 16, marginBottom: 16 }}
            extra={<Typography.Text type="secondary">{funded
                ? (module === 'training' ? t('Businesses and people booked into the classes you fund.') : t('Businesses reached for the programmes you fund.'))
                : t('Businesses and people reached; this changes no impact figure.')}</Typography.Text>}
        >
            <ProspectFunnel module={module} companyCode={companyCode} result={result} />
        </Card>
    )
}
