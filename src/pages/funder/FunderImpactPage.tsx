import { useEffect, useMemo, useState } from 'react'
import { Alert, Card, Col, Empty, Row, Segmented, Select, Skeleton, Typography } from 'antd'
import type Highcharts from 'highcharts'
import { useSearchParams } from 'react-router-dom'
import { DollarOutlined, RiseOutlined, TeamOutlined, ToolOutlined } from '@ant-design/icons'
import { AdminKpiTile } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveImplementor } from '@/hooks/useActiveImplementor'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadFunderImpact, MAJORITY_OWNED, type FunderImpact, type ImpactPanel } from '@/services/funderImpactService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import { buildDemoImpact } from '@/pages/funder/funderImpactDemo'
import '@/styles/admin-dashboard.css'
import '@/styles/funder.css'

/** Rand in short form for the headline tiles: R50.7m, R850k. */
const shortRand = (value: number) => {
    if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
    if (value >= 1_000) return `R${Math.round(value / 1_000)}k`
    return formatCurrencyZAR(value)
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}%`

/** Up to this many panels side by side; beyond it a picker chooses them and a ranking shows everyone. */
const MAX_PANELS = 4

type RankKey = 'smes' | 'jobsCreated' | 'revenueGrowth' | 'costPerJob' | 'funding'
/** What the ranking can sort by; cost per job ranks lowest first. */
const RANKINGS: Array<{ key: RankKey; label: string; lowerIsBetter?: boolean; funding?: boolean }> = [
    { key: 'smes', label: 'SMEs' },
    { key: 'jobsCreated', label: 'Jobs created' },
    { key: 'revenueGrowth', label: 'Revenue growth' },
    { key: 'costPerJob', label: 'Cost per job', lowerIsBetter: true, funding: true },
    { key: 'funding', label: 'Funding', funding: true },
]

/** One implementor's or programme's impact, set out like an annual-report page: large figures in a few sections. */
const ImpactPanelCard = ({ panel, fundingTracked }: { panel: ImpactPanel; fundingTracked: boolean }) => {
    const { t } = useLanguage()
    const disc = (value: number, label: string) => (
        <div className="impact-disc-row" key={label}>
            <span className="impact-disc">{value.toLocaleString()}</span>
            <span>{label}</span>
        </div>
    )
    return (
        <Card className="admin-card impact-panel" variant="borderless">
            <div className="impact-panel-head">
                <h3>{panel.name}</h3>
                {panel.implementor && <span>{panel.implementor}</span>}
            </div>

            <div className="impact-section">
                <h4>{t('Development impact')}</h4>
                <div className="impact-hero">
                    {fundingTracked && (
                        <div>
                            <b>{panel.funding === null ? '—' : shortRand(panel.funding)}</b>
                            <span>{t('Funding committed')}</span>
                        </div>
                    )}
                    <div>
                        <b>{panel.smes.toLocaleString()}</b>
                        <span>{t('SMEs supported')}</span>
                    </div>
                </div>
                {fundingTracked && (panel.costPerJob !== null || panel.costPerSme !== null) && (
                    <div className="impact-pair">
                        {panel.costPerSme !== null && <div><b>{shortRand(panel.costPerSme)}</b><span>{t('per SME')}</span></div>}
                        {panel.costPerJob !== null && <div><b>{shortRand(panel.costPerJob)}</b><span>{t('per job created')}</span></div>}
                    </div>
                )}
            </div>

            <div className="impact-section">
                <h4>{t('Beneficiary profile')}</h4>
                {panel.ownershipKnown ? (
                    <div className="impact-discs">
                        {disc(panel.blackOwned, t('Black-owned'))}
                        {disc(panel.blackWomenOwned, t('Black women-owned'))}
                        {disc(panel.youthOwned, t('Youth-owned'))}
                    </div>
                ) : <Typography.Text type="secondary">{t('No ownership recorded yet.')}</Typography.Text>}
            </div>

            <div className="impact-section">
                <h4>{t('Growth outcomes')}</h4>
                <div className="impact-discs">
                    {disc(panel.jobsCreated, t('Jobs created'))}
                    {disc(panel.jobsSustained, t('Jobs sustained'))}
                </div>
                <div className="impact-pair">
                    <div>
                        <b>{panel.revenueGrowth === null ? '—' : signed(panel.revenueGrowth)}</b>
                        <span>{panel.revenueGrowth === null ? t('Needs two months of reports') : t('Average SME revenue growth')}</span>
                    </div>
                </div>
            </div>

            <div className="impact-section">
                <h4>{t('Support delivered')}</h4>
                <div className="impact-pair">
                    <div><b>{panel.interventionsCompleted.toLocaleString()}</b><span>{t('Interventions completed')}</span></div>
                    <div><b>{panel.meetingHours.toLocaleString()}</b><span>{t('Hours of mentoring and meetings')}</span></div>
                </div>
                {panel.areas.length > 0 && (
                    <div className="impact-discs is-small">
                        {panel.areas.slice(0, 4).map((row) => disc(row.completed, t(row.area)))}
                    </div>
                )}
            </div>
        </Card>
    )
}

/**
 * Funder Impact: what the funded programmes achieved and for whom, the figures a funder puts in its own report.
 * Funding committed, beneficiary profile, jobs and revenue growth, support delivered, and implementors or programmes
 * side by side. Follows the implementor and programme selectors.
 */
export const FunderImpactPage = () => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { activeImplementor } = useActiveImplementor()
    const [data, setData] = useState<FunderImpact>()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(false)
    const [compare, setCompare] = useState<'implementors' | 'programmes'>('implementors')
    const [picked, setPicked] = useState<Record<'implementors' | 'programmes', string[] | undefined>>({ implementors: undefined, programmes: undefined })
    const [rankBy, setRankBy] = useState<RankKey>('jobsCreated')

    // ?demo=1 shows made-up figures (funderImpactDemo.ts) to see the page full; nothing is read or saved.
    const [searchParams] = useSearchParams()
    const demo = searchParams.get('demo') === '1'

    useEffect(() => {
        if (!user) return
        let active = true
        const timeout = window.setTimeout(() => {
            setLoading(true)
                ; (demo ? Promise.resolve(buildDemoImpact()) : loadFunderImpact(user, activeProgramId, activeImplementor))
                    .then((next) => { if (active) { setData(next); setError(false) } })
                    .catch((reason) => { console.error(reason); if (active) setError(true) })
                    .finally(() => { if (active) setLoading(false) })
        }, 0)
        return () => { active = false; window.clearTimeout(timeout) }
    }, [activeImplementor, activeProgramId, demo, user])

    const totals = data?.totals
    // One implementor in view: comparing programmes is the only comparison left.
    const view = (data?.implementors.length || 0) < 2 ? 'programmes' : compare
    const allPanels = useMemo(() => (data ? (view === 'implementors' ? data.implementors : data.programmes) : []), [data, view])
    const crowded = allPanels.length > MAX_PANELS
    // The panels in view: all of them up to MAX_PANELS; beyond that, the ones picked (or the largest by SMEs to start).
    const shownPanels = useMemo(() => {
        if (!crowded) return allPanels
        const keys = (picked[view] || []).filter((key) => allPanels.some((panel) => panel.key === key))
        return keys.length
            ? keys.map((key) => allPanels.find((panel) => panel.key === key)!).filter(Boolean)
            : allPanels.slice(0, MAX_PANELS)
    }, [allPanels, crowded, picked, view])
    const pick = (keys: string[]) => setPicked((current) => ({ ...current, [view]: keys.slice(0, MAX_PANELS) }))
    // From the ranking: add one to the panels, dropping the last picked when there are already four.
    const addToPanels = (key: string) => {
        const current = shownPanels.map((panel) => panel.key)
        if (current.includes(key)) return
        pick(current.length >= MAX_PANELS ? [...current.slice(0, MAX_PANELS - 1), key] : [...current, key])
    }

    const rankings = RANKINGS.filter((row) => !row.funding || data?.fundingTracked)
    const ranking = rankings.find((row) => row.key === rankBy) || rankings[0]
    const ranked = allPanels
        .filter((panel) => panel[ranking.key] !== null)
        .sort((left, right) => ranking.lowerIsBetter
            ? (left[ranking.key] as number) - (right[ranking.key] as number)
            : (right[ranking.key] as number) - (left[ranking.key] as number))
    // Rebuilt each render: cheap, and its click handler needs the current panels.
    const rankingChart: Highcharts.Options = (() => {
        const shown = new Set(shownPanels.map((panel) => panel.key))
        const format = (value: number) => (ranking.key === 'revenueGrowth' ? signed(value)
            : ranking.key === 'funding' || ranking.key === 'costPerJob' ? shortRand(value)
                : value.toLocaleString())
        return {
            chart: { type: 'bar', height: Math.max(200, ranked.length * 34 + 60) },
            title: { text: undefined },
            legend: { enabled: false },
            xAxis: { categories: ranked.map((panel) => panel.name), lineWidth: 0, tickLength: 0 },
            yAxis: { title: { text: undefined }, gridLineDashStyle: 'Dash', labels: { formatter() { return format(Number(this.value)) } } },
            tooltip: { formatter() { return `<b>${String(this.key ?? '')}</b><br/>${t(ranking.label)}: ${format(Number(this.y))}<br/><span style="font-size:11px">${t('Click to add it to the panels')}</span>` } },
            plotOptions: {
                bar: { borderRadius: 4, pointPadding: 0.12, groupPadding: 0.06, cursor: 'pointer', dataLabels: { enabled: true, formatter() { return format(Number(this.y)) }, style: { fontSize: '11px', fontWeight: '600', textOutline: 'none' } } },
                series: { point: { events: { click() { const key = ranked[Number(this.index)]?.key; if (key) addToPanels(key) } } } },
            },
            // Bars of the panels in view are full colour; the rest are lighter.
            series: [{ type: 'bar', name: t(ranking.label), data: ranked.map((panel) => ({ y: panel[ranking.key] as number, color: shown.has(panel.key) ? '#6d5dfb' : 'rgba(109, 93, 251, .35)' })) }],
        }
    })()

    useRegisterAgentPageContext({
        pageKey: 'funder-impact',
        pageName: 'Funder impact',
        purpose: 'What the funded programmes achieved and for whom: funding committed, beneficiary ownership, jobs created and sustained, revenue growth, support delivered, and implementors or programmes compared.',
        metrics: {
            smes: totals?.smes || 0,
            jobsCreated: totals?.jobsCreated || 0,
            jobsSustained: totals?.jobsSustained || 0,
            revenueGrowth: totals?.revenueGrowth ?? 0,
            funding: totals?.funding ?? 0,
        },
    })

    const ownership = totals?.ownershipKnown
        ? [
            { label: t('Black-owned'), value: totals.blackOwned },
            { label: t('Black women-owned'), value: totals.blackWomenOwned },
            { label: t('Women-owned'), value: totals.womenOwned },
            { label: t('Youth-owned'), value: totals.youthOwned },
        ]
        : []

    return (
        <DashboardPage className="funder-page admin-overview funder-impact-page">
            {error && <Alert type="error" showIcon message={t('Impact figures could not be loaded.')} style={{ marginBottom: 16 }} />}

            <Row gutter={[16, 16]} className="funder-row">
                <Col xs={12} md={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<DollarOutlined />}
                        label={t('Funding committed')}
                        value={totals?.funding === null || totals?.funding === undefined ? '—' : shortRand(totals.funding)}
                        note={!data?.fundingTracked
                            ? t('Recorded on funder organisation links')
                            : totals?.programmes
                                ? t('{funded} of {total} programmes have an amount', undefined, { funded: totals.fundedProgrammes, total: totals.programmes })
                                : t('No programmes yet')}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <AdminKpiTile
                        compact
                        loading={loading}
                        icon={<TeamOutlined />}
                        label={t('SMEs supported')}
                        value={totals?.smes ?? 0}
                        note={totals?.costPerSme ? t('{amount} per SME', undefined, { amount: formatCurrencyZAR(totals.costPerSme) }) : t('In the programmes in view')}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <AdminKpiTile onMobile
                        compact
                        loading={loading}
                        icon={<RiseOutlined />}
                        label={t('Jobs created')}
                        value={totals ? (totals.jobsCreated > 0 ? `+${totals.jobsCreated.toLocaleString()}` : totals.jobsCreated.toLocaleString()) : 0}
                        note={totals ? t('{count} jobs sustained', undefined, { count: totals.jobsSustained.toLocaleString() }) : undefined}
                    />
                </Col>
                <Col xs={12} md={6}>
                    <AdminKpiTile onMobile
                        compact
                        loading={loading}
                        icon={<RiseOutlined />}
                        label={t('Average revenue growth')}
                        value={totals?.revenueGrowth === null || totals?.revenueGrowth === undefined ? '—' : signed(totals.revenueGrowth)}
                        note={totals?.smesWithRevenue ? t('Per SME since joining · {count} SMEs', undefined, { count: totals.smesWithRevenue }) : t('Needs two months of reports')}
                    />
                </Col>
            </Row>

            <Row gutter={[16, 16]} className="funder-row">
                <Col xs={24} lg={12}>
                    <Card className="admin-card" variant="borderless">
                        <div className="admin-card-head"><div>
                            <h3>{t('Beneficiary profile')}</h3>
                            <span>{t('SMEs {percent}% or more owned, from their applications', undefined, { percent: MAJORITY_OWNED })}</span>
                        </div></div>
                        {loading ? <Skeleton active /> : ownership.length ? (
                            <>
                                <div className="funder-impact-figures">
                                    {ownership.map((row) => (
                                        <div key={row.label}><b>{row.value.toLocaleString()}</b><span>{row.label}</span></div>
                                    ))}
                                </div>
                                <Typography.Text type="secondary" className="funder-impact-note">
                                    {t('Ownership is recorded for {known} of {total} SMEs.', undefined, { known: totals?.ownershipKnown || 0, total: totals?.smes || 0 })}
                                </Typography.Text>
                            </>
                        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No ownership recorded on these SMEs\' applications yet.')} />}
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card className="admin-card" variant="borderless">
                        <div className="admin-card-head"><div>
                            <h3>{t('Support delivered')}</h3>
                            <span>{t('Completed interventions and meetings held')}</span>
                        </div></div>
                        {loading ? <Skeleton active /> : (
                            <>
                                <div className="funder-impact-figures">
                                    <div><b>{(totals?.interventionsCompleted || 0).toLocaleString()}</b><span>{t('Interventions completed')}</span></div>
                                    <div><b>{(totals?.meetingHours || 0).toLocaleString()}</b><span>{t('Hours of mentoring and meetings')}</span></div>
                                    <div><b>{(totals?.meetingsHeld || 0).toLocaleString()}</b><span>{t('Meetings held')}</span></div>
                                </div>
                                {totals?.areas.length ? (
                                    <div className="funder-chips funder-impact-areas">
                                        {totals.areas.slice(0, 8).map((row) => <span key={row.area}><ToolOutlined /> {t(row.area)} <b>{row.completed}</b></span>)}
                                    </div>
                                ) : null}
                            </>
                        )}
                    </Card>
                </Col>
            </Row>

            <Card className="admin-card funder-row impact-compare" variant="borderless">
                <div className="admin-card-head">
                    <div>
                        <h3>{t('Compare')}</h3>
                        <span>{crowded
                            ? t('Up to {count} side by side. Pick them here, or click a bar in the ranking below.', undefined, { count: MAX_PANELS })
                            : t('Each implementor or programme side by side')}</span>
                    </div>
                    {(data?.implementors.length || 0) > 1 && (
                        <Segmented
                            value={view}
                            onChange={(value) => setCompare(value as 'implementors' | 'programmes')}
                            options={[{ value: 'implementors', label: t('Implementors') }, { value: 'programmes', label: t('Programmes') }]}
                        />
                    )}
                </div>
                {!loading && crowded && (
                    <Select
                        mode="multiple"
                        className="impact-picker"
                        value={shownPanels.map((panel) => panel.key)}
                        onChange={(keys: string[]) => pick(keys)}
                        maxCount={MAX_PANELS}
                        optionFilterProp="label"
                        placeholder={view === 'implementors' ? t('Choose implementors to compare') : t('Choose programmes to compare')}
                        options={allPanels.map((panel) => ({ value: panel.key, label: panel.implementor && view === 'programmes' ? `${panel.name} · ${panel.implementor}` : panel.name }))}
                        aria-label={view === 'implementors' ? t('Implementors to compare') : t('Programmes to compare')}
                    />
                )}
                {loading ? <Skeleton active /> : (data && shownPanels.length ? (
                    <Row gutter={[16, 16]} className={`impact-panels is-${shownPanels.length}`}>
                        {shownPanels.map((panel) => (
                            <Col key={panel.key} xs={24} md={shownPanels.length > 1 ? 12 : 24} xl={24 / Math.min(shownPanels.length, MAX_PANELS)}>
                                <ImpactPanelCard panel={panel} fundingTracked={data.fundingTracked} />
                            </Col>
                        ))}
                    </Row>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SMEs in the programmes in view yet.')} />)}

                {!loading && crowded && (
                    <div className="impact-ranking">
                        <div className="admin-card-head">
                            <div>
                                <h3>{view === 'implementors' ? t('All {count} implementors ranked', undefined, { count: allPanels.length }) : t('All {count} programmes ranked', undefined, { count: allPanels.length })}</h3>
                                <span>{ranking.lowerIsBetter ? t('Lowest first') : t('Highest first')}{ranked.length < allPanels.length ? ` · ${t('{count} without a figure left out', undefined, { count: allPanels.length - ranked.length })}` : ''}</span>
                            </div>
                            <Segmented value={ranking.key} onChange={(value) => setRankBy(value as RankKey)} options={rankings.map((row) => ({ value: row.key, label: t(row.label) }))} />
                        </div>
                        {ranked.length ? <ThemedHighcharts options={rankingChart} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No figures to rank by yet.')} />}
                    </div>
                )}
            </Card>
        </DashboardPage>
    )
}

export default FunderImpactPage
