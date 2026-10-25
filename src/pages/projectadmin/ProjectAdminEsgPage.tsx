import { App, Button, Card, Col, Divider, Empty, Progress, Row, Segmented, Space, Spin, Statistic, Tag, theme, Tooltip, Typography } from 'antd'
import { AimOutlined, ArrowDownOutlined, ArrowUpOutlined, BankOutlined, CheckCircleOutlined, CloudOutlined, ExperimentOutlined, SafetyCertificateOutlined, TeamOutlined, WarningOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import { animate, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import { loadEsgScorecard, type EsgScorecard } from '@/services/esgScorecardService'

// The confidence band is an arearange series, which lives in highcharts-more. Same registration as DirectorReportsPage.
const highchartsMore = typeof HighchartsMore === 'function' ? HighchartsMore : (HighchartsMore as { default?: unknown }).default
if (typeof highchartsMore === 'function') (highchartsMore as (highcharts: typeof Highcharts) => void)(Highcharts)

const { Paragraph, Text, Title } = Typography
type EsgView = 'overview' | 'e' | 's' | 'g'
/** How many quarters ahead the projections can reach; each is offered only once that many quarters are measured. */
const HORIZONS = [1, 2, 3, 4, 6, 8] as const
type Horizon = typeof HORIZONS[number]
/** The chart always shows at least this many quarters, even before the records go back that far. */
const MIN_QUARTERS_SHOWN = 4
type PillarKey = 'E' | 'S' | 'G'
type History = Array<number | null>

/** "next quarter", "2 quarters", ... - one phrase for every projection on the card. */
const horizonLabel = (count: number) => count === 1 ? tr('next quarter') : tr('{count} quarters', undefined, { count })

const ESG_TARGET = 80
/** Actuals draw first; the projection starts once they finish. */
const ACTUAL_MS = 900
const PROJECTION_MS = 800

type Initiative = { key: string; name: string; pillar: PillarKey; history: History; basis?: string; action: string }

type Pillar = {
    key: PillarKey
    title: string
    weight: number
    color: string
    icon: ReactNode
    /** Environmental is not captured yet, so it runs on illustrative figures. */
    sample: boolean
    history: History
    initiatives: Initiative[]
}

/** Illustrative only, until environmental data is captured. Kept in English like stored figures. */
const SAMPLE_ENVIRONMENTAL: Initiative[] = [
    { key: 'energy', name: 'Energy baseline', pillar: 'E', history: [64, 70, 77, 82], action: 'Keep collecting meter readings so the baseline stays current.' },
    { key: 'waste', name: 'Waste and recycling', pillar: 'E', history: [55, 61, 66, 70], action: 'Record waste volumes at each site visit.' },
    { key: 'emissions', name: 'Emissions evidence', pillar: 'E', history: [38, 44, 49, 52], action: 'Ask SMEs for fuel and electricity bills so emissions can be estimated.' },
]

const PILLAR_STYLE: Record<PillarKey, { title: () => string; weight: number; color: string; icon: ReactNode }> = {
    E: { title: () => tr('Environmental'), weight: 0.3, color: CHART_COLORS.success, icon: <CloudOutlined /> },
    S: { title: () => tr('Social'), weight: 0.4, color: CHART_COLORS.primary, icon: <TeamOutlined /> },
    G: { title: () => tr('Governance'), weight: 0.3, color: CHART_COLORS.violet, icon: <BankOutlined /> },
}

const round1 = (value: number) => Math.round(value * 10) / 10
const clampScore = (value: number) => Math.max(0, Math.min(100, value))
const present = (history: History) => history.flatMap((value, x) => (value === null ? [] : [[x, value] as [number, number]]))
const latest = (history: History) => present(history).at(-1)?.[1] ?? null
const previous = (history: History) => present(history).at(-2)?.[1] ?? null

/** Average of whatever was measured in each quarter; null where nothing was. */
const averageHistories = (histories: History[], length: number): History => Array.from({ length }, (_, x) => {
    const values = histories.map((history) => history[x]).filter((value): value is number => value !== null)
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null
})

/** Quarters with at least one real (not sample) figure; this is what a projection can lean on. */
const measuredQuarters = (scorecard: EsgScorecard) =>
    scorecard.quarters.filter((_, x) => scorecard.themes.some((item) => item.history[x] !== null)).length

/** Drops the early quarters before any records exist, keeping at least MIN_QUARTERS_SHOWN on the chart. */
const trimScorecard = (scorecard: EsgScorecard): EsgScorecard => {
    const firsts = scorecard.themes.map((item) => item.history.findIndex((value) => value !== null)).filter((index) => index >= 0)
    const latestStart = Math.max(0, scorecard.quarters.length - MIN_QUARTERS_SHOWN)
    const start = Math.min(firsts.length ? Math.min(...firsts) : latestStart, latestStart)
    return {
        ...scorecard,
        quarters: scorecard.quarters.slice(start),
        themes: scorecard.themes.map((item) => ({ ...item, history: item.history.slice(start) })),
    }
}

/** Sample histories are the most recent quarters; earlier ones stay blank. */
const alignSample = (history: History, length: number): History =>
    [...Array(Math.max(0, length - history.length)).fill(null), ...history.slice(-length)]

const buildPillars = (scorecard: EsgScorecard): Pillar[] => (['E', 'S', 'G'] as PillarKey[]).map((key) => {
    const style = PILLAR_STYLE[key]
    const initiatives: Initiative[] = key === 'E'
        ? SAMPLE_ENVIRONMENTAL.map((item) => ({ ...item, history: alignSample(item.history, scorecard.quarters.length) }))
        : scorecard.themes.filter((item) => item.pillar === key).map((item) => ({ ...item, pillar: key }))
    return {
        key,
        get title() { return style.title() },
        weight: style.weight,
        color: style.color,
        icon: style.icon,
        sample: key === 'E',
        initiatives,
        history: averageHistories(initiatives.map((item) => item.history), scorecard.quarters.length),
    }
})

/** Weighted across the pillars that have a figure that quarter. */
const overallHistory = (pillars: Pillar[], length: number): History => Array.from({ length }, (_, x) => {
    const scored = pillars.filter((pillar) => pillar.history[x] !== null)
    const weight = scored.reduce((sum, pillar) => sum + pillar.weight, 0)
    return weight ? Math.round(scored.reduce((sum, pillar) => sum + (pillar.history[x] as number) * pillar.weight, 0) / weight) : null
})

type Projection = { slope: number; points: Array<{ value: number; low: number; high: number }> }

/**
 * Straight-line fit through the measured quarters, carried forward `steps` quarters past the last one. The band
 * widens each quarter on top of the fit's own scatter, so further-out quarters read as less certain. With a single
 * measured quarter there is no trend, so it holds flat.
 */
const projectScores = (history: History, steps: number): Projection => {
    const points = present(history)
    const n = points.length
    if (!n) return { slope: 0, points: [] }
    const meanX = points.reduce((sum, [x]) => sum + x, 0) / n
    const meanY = points.reduce((sum, [, y]) => sum + y, 0) / n
    const variance = points.reduce((sum, [x]) => sum + (x - meanX) ** 2, 0)
    const slope = variance ? points.reduce((sum, [x, y]) => sum + (x - meanX) * (y - meanY), 0) / variance : 0
    const intercept = meanY - slope * meanX
    const scatter = n > 2 ? Math.sqrt(points.reduce((sum, [x, y]) => sum + (y - (intercept + slope * x)) ** 2, 0) / (n - 2)) : 4
    const lastX = history.length - 1
    return {
        slope,
        points: Array.from({ length: steps }, (_, index) => {
            const step = index + 1
            const value = clampScore(intercept + slope * (lastX + step))
            const spread = scatter + 1.5 * step
            return { value: round1(value), low: Math.round(clampScore(value - spread)), high: Math.round(clampScore(value + spread)) }
        }),
    }
}

/** Whole quarters until the fitted line crosses the target: 0 when already there, null when it never will. */
const quartersToTarget = (history: History, slope: number) => {
    const current = latest(history)
    if (current === null) return null
    if (current >= ESG_TARGET) return 0
    if (slope <= 0) return null
    return Math.ceil((ESG_TARGET - current) / slope)
}

type Timeline = { quarters: string[]; future: (steps: number) => string[] }

const timelineOf = (scorecard: EsgScorecard): Timeline => ({
    quarters: scorecard.quarters,
    future: (steps) => Array.from({ length: steps }, (_, index) => {
        const offset = scorecard.nextQuarter.quarter - 1 + index
        return `Q${(offset % 4) + 1} ${scorecard.nextQuarter.year + Math.floor(offset / 4)}`
    }),
})

/** Counts up to `value` on mount and whenever it changes. */
const CountUp = ({ value, decimals = 0 }: { value: number; decimals?: number }) => {
    const reduceMotion = useReducedMotion()
    const [display, setDisplay] = useState(reduceMotion ? value : 0)
    useEffect(() => {
        if (reduceMotion) {
            setDisplay(value)
            return
        }
        const controls = animate(0, value, { duration: ACTUAL_MS / 1000, ease: 'easeOut', onUpdate: setDisplay })
        return () => controls.stop()
    }, [reduceMotion, value])
    return <>{display.toFixed(decimals)}</>
}

const SampleTag = () => {
    const { t } = useLanguage()
    return <Tag icon={<ExperimentOutlined />} color="default" style={{ marginInlineEnd: 0 }}>{t('Sample data')}</Tag>
}

const buildProjectionChart = (
    series: Array<{ name: string; color: string; history: History }>,
    timeline: Timeline,
    horizon: Horizon,
    reduceMotion: boolean,
    height: number,
): Highcharts.Options => {
    const lastIndex = timeline.quarters.length - 1
    const categories = [...timeline.quarters, ...timeline.future(horizon)]
    const actualAnimation = reduceMotion ? false : { duration: ACTUAL_MS }
    const projectionAnimation = reduceMotion ? false : { defer: ACTUAL_MS, duration: PROJECTION_MS }
    const measured = series.filter((item) => present(item.history).length)
    const lows = measured.flatMap((item) => [...present(item.history).map(([, y]) => y), ...projectScores(item.history, horizon).points.map((point) => point.low)])

    return {
        chart: { height, animation: !reduceMotion },
        title: { text: undefined },
        xAxis: {
            categories,
            plotBands: [{ from: lastIndex + 0.5, to: categories.length - 0.5, color: 'rgba(124, 58, 237, .06)', label: { text: tr('Projection'), style: { color: CHART_COLORS.violet, fontWeight: '600' } } }],
        },
        yAxis: {
            min: lows.length ? Math.max(0, Math.floor((Math.min(...lows) - 5) / 10) * 10) : 0,
            max: 100,
            title: { text: tr('Score') },
            plotLines: [{ value: ESG_TARGET, color: CHART_COLORS.amber, dashStyle: 'Dash', width: 1.5, zIndex: 3, label: { text: tr('Target {value}', undefined, { value: ESG_TARGET }), align: 'left', style: { color: CHART_COLORS.amber } } }],
        },
        tooltip: { shared: true, valueDecimals: 0 },
        legend: { enabled: measured.length > 1 },
        plotOptions: { series: { marker: { radius: 3 } } },
        series: measured.flatMap((item): Highcharts.SeriesOptionsType[] => {
            const projection = projectScores(item.history, horizon)
            const [lastX, last] = present(item.history).at(-1) as [number, number]
            const id = item.name
            // Starts on the last measured quarter so the dashed line continues the solid one.
            const anchor: [number, number] = [lastX, last]
            return [
                { type: 'spline', id, name: item.name, color: item.color, data: present(item.history), animation: actualAnimation, lineWidth: 2.5 },
                { type: 'spline', linkedTo: id, name: tr('{name} projected', undefined, { name: item.name }), color: item.color, dashStyle: 'ShortDash', data: [anchor, ...projection.points.map((point, index) => [lastIndex + 1 + index, point.value])], animation: projectionAnimation, marker: { symbol: 'circle', fillColor: 'transparent', lineWidth: 1.5, lineColor: item.color } },
                { type: 'arearange', linkedTo: id, name: tr('Likely range'), color: item.color, fillOpacity: measured.length > 1 ? 0.1 : 0.18, lineWidth: 0, marker: { enabled: false }, enableMouseTracking: measured.length === 1, data: [[lastX, last, last], ...projection.points.map((point, index) => [lastIndex + 1 + index, point.low, point.high])], animation: projectionAnimation, zIndex: 0 },
            ]
        }),
    }
}

const PillarTile = ({ pillar, horizon, index, onOpen }: { pillar: Pillar; horizon: Horizon; index: number; onOpen: () => void }) => {
    const { t } = useLanguage()
    const { token } = theme.useToken()
    const reduceMotion = useReducedMotion()
    const score = latest(pillar.history)
    const prior = previous(pillar.history)
    const delta = score !== null && prior !== null ? score - prior : null
    const projected = projectScores(pillar.history, horizon).points[horizon - 1]?.value
    const [barPercent, setBarPercent] = useState(reduceMotion ? score ?? 0 : 0)
    useEffect(() => { setBarPercent(score ?? 0) }, [score])

    return (
        <motion.button
            type="button"
            onClick={onOpen}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: index * 0.08, ease: 'easeOut' }}
            whileHover={reduceMotion ? undefined : { y: -2 }}
            style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: 16, borderRadius: 14, border: `1px solid ${token.colorBorderSecondary}`, borderTop: `3px solid ${pillar.color}`, background: token.colorBgContainer, color: token.colorText }}
        >
            <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text strong><span style={{ color: pillar.color }}>{pillar.icon}</span> {pillar.key} · {pillar.title}</Text>
                <Space size={4}>
                    {pillar.sample && <SampleTag />}
                    {delta !== null && <Tag color={delta >= 0 ? 'green' : 'red'} icon={delta >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />} style={{ marginInlineEnd: 0 }}>{Math.abs(delta)}</Tag>}
                </Space>
            </Space>
            {score === null ? (
                <>
                    <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2, marginTop: 8, color: token.colorTextQuaternary }}>—</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>{t('Not enough records to score yet')}</Text>
                </>
            ) : (
                <>
                    <div style={{ fontSize: 30, fontWeight: 700, lineHeight: 1.2, marginTop: 8, color: pillar.color }}>
                        <CountUp value={score} /><Text type="secondary" style={{ fontSize: 14, fontWeight: 400 }}>/100</Text>
                    </div>
                    <Progress percent={barPercent} strokeColor={pillar.color} showInfo={false} size="small" />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                        {horizon === 1
                            ? t('Projected {value} next quarter', undefined, { value: Math.round(projected ?? score) })
                            : t('Projected {value} in {count} quarters', undefined, { value: Math.round(projected ?? score), count: horizon })}
                    </Text>
                </>
            )}
        </motion.button>
    )
}

/** Rows shown on the overview before "Show all"; a single pillar always shows all of its themes. */
const OVERVIEW_THEME_LIMIT = 5

/**
 * One row per theme, weakest first: the bar is this quarter, the dashed extension is the projection at the
 * chosen horizon, and the tick marks the target. Bars grow in first, then the projections follow.
 */
const ThemeRows = ({ items, pillars, horizon, limit, onOpen }: { items: Initiative[]; pillars: Pillar[]; horizon: Horizon; limit?: number; onOpen?: (key: PillarKey) => void }) => {
    const { t } = useLanguage()
    const { token } = theme.useToken()
    const reduceMotion = useReducedMotion()
    const [showAll, setShowAll] = useState(false)
    const colorOf = (key: PillarKey) => pillars.find((pillar) => pillar.key === key)?.color || CHART_COLORS.slate
    const rows = items
        .map((item) => {
            const current = latest(item.history)
            const prior = previous(item.history)
            const next = projectScores(item.history, horizon).points[horizon - 1]
            return { item, current, next: next ? Math.round(next.value) : null, delta: current !== null && prior !== null ? current - prior : null, color: colorOf(item.pillar) }
        })
        // Unmeasured themes sink to the bottom; the rest run weakest first.
        .sort((a, b) => (a.current ?? 101) - (b.current ?? 101))
    const visible = limit && !showAll ? rows.slice(0, limit) : rows
    const grow = (delay: number) => (reduceMotion ? { duration: 0 } : { duration: delay ? PROJECTION_MS / 1000 : ACTUAL_MS / 1000, delay, ease: 'easeOut' as const })

    return (
        <div>
            {visible.map((row, index) => {
                const gain = row.current !== null && row.next !== null && row.next > row.current ? row.next - row.current : 0
                const tooltip = row.current === null
                    ? t('Not measured yet')
                    : <>
                        <div><strong>{tr(row.item.name)}</strong></div>
                        <div>{t('Now')}: {row.current}%{row.delta !== null && ` (${row.delta >= 0 ? '+' : ''}${row.delta} ${t('since last quarter')})`}</div>
                        {row.next !== null && <div>{t('Projected in {horizon}', undefined, { horizon: horizonLabel(horizon) })}: {row.next}%</div>}
                        {row.item.basis && <div style={{ opacity: 0.75 }}>{tr(row.item.basis)}</div>}
                    </>
                return (
                    <Tooltip key={row.item.key} title={tooltip} placement="topLeft">
                        <div
                            role={onOpen ? 'button' : undefined}
                            tabIndex={onOpen ? 0 : undefined}
                            onClick={() => onOpen?.(row.item.pillar)}
                            onKeyDown={(event) => { if (onOpen && (event.key === 'Enter' || event.key === ' ')) onOpen(row.item.pillar) }}
                            style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 150px) minmax(0, 1fr) 72px', gap: 10, alignItems: 'center', padding: '5px 0', cursor: onOpen ? 'pointer' : 'default' }}
                        >
                            <Text ellipsis style={{ fontSize: 13 }}><span style={{ color: row.color, fontWeight: 600 }}>{row.item.pillar}</span> · {tr(row.item.name)}</Text>
                            <div style={{ position: 'relative', height: 14, borderRadius: 4, background: token.colorFillTertiary }}>
                                {row.current !== null && (
                                    <motion.div
                                        initial={{ width: reduceMotion ? `${row.current}%` : 0 }}
                                        animate={{ width: `${row.current}%` }}
                                        transition={{ ...grow(0), delay: reduceMotion ? 0 : index * 0.05 }}
                                        style={{ position: 'absolute', inset: '0 auto 0 0', borderRadius: 4, background: row.color }}
                                    />
                                )}
                                {gain > 0 && (
                                    <motion.div
                                        initial={{ opacity: reduceMotion ? 1 : 0, width: reduceMotion ? `${gain}%` : 0 }}
                                        animate={{ opacity: 1, width: `${gain}%` }}
                                        transition={grow(ACTUAL_MS / 1000 + index * 0.05)}
                                        style={{ position: 'absolute', top: 0, bottom: 0, left: `${row.current}%`, border: `1px dashed ${row.color}`, borderLeft: 0, borderRadius: '0 4px 4px 0', background: Highcharts.color(row.color).setOpacity(0.18).get() as string }}
                                    />
                                )}
                                <span style={{ position: 'absolute', top: -3, bottom: -3, left: `${ESG_TARGET}%`, borderLeft: `1.5px dashed ${CHART_COLORS.amber}` }} />
                            </div>
                            <Text style={{ fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap' }}>
                                {row.current === null ? '—' : `${row.current}%`}
                                {row.next !== null && row.current !== null && <Text type="secondary" style={{ fontSize: 11 }}> → {row.next}</Text>}
                            </Text>
                        </div>
                    </Tooltip>
                )
            })}
            {limit && rows.length > limit && (
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => setShowAll((value) => !value)}>
                    {showAll ? t('Show weakest {count}', undefined, { count: limit }) : t('Show all {count}', undefined, { count: rows.length })}
                </Button>
            )}
        </div>
    )
}

type Insight = { key: string; tone: 'good' | 'watch' | 'info'; title: string; text: string; pillar: PillarKey }

const reach = (quarters: number | null) => quarters === 0
    ? tr('is already at the {target} target', undefined, { target: ESG_TARGET })
    : quarters === null
        ? tr('will not reach {target} on the current trend', undefined, { target: ESG_TARGET })
        : tr('reaches {target} in about {count} quarter(s)', undefined, { target: ESG_TARGET, count: quarters })

const paceOf = (history: History) => {
    const { slope } = projectScores(history, 1)
    return { slope, quarters: quartersToTarget(history, slope) }
}

/** Worked out from the scores and projections, so the insights move with the data. */
const buildInsights = (pillars: Pillar[], pillarKey?: PillarKey): Insight[] => {
    const scope = pillarKey ? pillars.filter((pillar) => pillar.key === pillarKey) : pillars
    const measured = scope.flatMap((pillar) => pillar.initiatives).filter((item) => latest(item.history) !== null)
    if (!measured.length) {
        const pillar = scope[0]
        return [{
            key: 'empty',
            tone: 'watch',
            pillar: pillar.key,
            title: tr('No {name} data yet', undefined, { name: pillar.title }),
            text: tr('Insights appear once SMEs have headcount, ownership, check-back or compliance records.'),
        }]
    }
    const byScore = [...measured].sort((a, b) => (latest(a.history) as number) - (latest(b.history) as number))
    const weakest = byScore[0]
    const gap: Insight = {
        key: 'gap',
        tone: 'watch',
        pillar: weakest.pillar,
        title: tr('{name} is the biggest gap', undefined, { name: tr(weakest.name) }),
        text: tr('At {value}% it {reach}. {action}', undefined, { value: latest(weakest.history) as number, reach: reach(paceOf(weakest.history).quarters), action: tr(weakest.action) }),
    }

    if (pillarKey) {
        const pillar = scope[0]
        const pace = paceOf(pillar.history)
        const strongest = byScore[byScore.length - 1]
        return [
            {
                key: 'pace',
                tone: pace.slope > 0 ? 'good' : 'watch',
                pillar: pillarKey,
                title: tr('{name} trend', undefined, { name: pillar.title }),
                text: tr('Moving {sign}{pace} a quarter, the pillar score {reach}.', undefined, { sign: pace.slope >= 0 ? '+' : '', pace: pace.slope.toFixed(1), reach: reach(pace.quarters) }),
            },
            {
                key: 'strongest',
                tone: 'info',
                pillar: pillarKey,
                title: tr('{name} leads at {value}%', undefined, { name: tr(strongest.name), value: latest(strongest.history) as number }),
                text: tr('It {reach}. {action}', undefined, { reach: reach(paceOf(strongest.history).quarters), action: tr(strongest.action) }),
            },
            ...(byScore.length > 1 ? [gap] : []),
        ]
    }

    const paced = scope.filter((pillar) => latest(pillar.history) !== null).map((pillar) => ({ pillar, ...paceOf(pillar.history) }))
    const fastest = [...paced].sort((a, b) => b.slope - a.slope)[0]
    const slowest = [...paced].sort((a, b) => a.slope - b.slope)[0]

    return [
        {
            key: 'momentum',
            tone: 'good',
            pillar: fastest.pillar.key,
            title: tr('{name} momentum', undefined, { name: fastest.pillar.title }),
            text: tr('Rising fastest at {sign}{pace} a quarter, and {reach}.', undefined, { sign: fastest.slope >= 0 ? '+' : '', pace: fastest.slope.toFixed(1), reach: reach(fastest.quarters) }),
        },
        gap,
        ...(slowest.pillar.key !== fastest.pillar.key ? [{
            key: 'pace',
            tone: 'info' as const,
            pillar: slowest.pillar.key,
            title: tr('{name} is the slowest pillar', undefined, { name: slowest.pillar.title }),
            text: tr('Moving {sign}{pace} a quarter, it {reach}. Its weakest initiatives are where extra effort counts most.', undefined, { sign: slowest.slope >= 0 ? '+' : '', pace: slowest.slope.toFixed(1), reach: reach(slowest.quarters) }),
        }] : []),
    ]
}

const INSIGHT_TONES: Record<Insight['tone'], { icon: ReactNode; color: string }> = {
    good: { icon: <CheckCircleOutlined />, color: CHART_COLORS.success },
    watch: { icon: <WarningOutlined />, color: CHART_COLORS.amber },
    info: { icon: <SafetyCertificateOutlined />, color: CHART_COLORS.primary },
}

const InsightList = ({ pillars, pillar: pillarKey, onOpen }: { pillars: Pillar[]; pillar?: PillarKey; onOpen: (key: PillarKey) => void }) => {
    const { t, language } = useLanguage()
    const { token } = theme.useToken()
    const reduceMotion = useReducedMotion()
    const insights = useMemo(() => buildInsights(pillars, pillarKey), [pillars, pillarKey, language]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {insights.map((insight, index) => {
                const tone = INSIGHT_TONES[insight.tone]
                const pillar = pillars.find((item) => item.key === insight.pillar) as Pillar
                return (
                    <motion.div
                        key={insight.key}
                        initial={reduceMotion ? false : { opacity: 0, x: 12 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.35, delay: 0.15 + index * 0.1, ease: 'easeOut' }}
                        style={{ display: 'flex', gap: 10, padding: '8px 10px', border: `1px solid ${token.colorBorderSecondary}`, borderLeft: `3px solid ${tone.color}` }}
                    >
                        <span style={{ color: tone.color, fontSize: 15, lineHeight: '20px' }}>{tone.icon}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <Space size={6} wrap>
                                <Text strong style={{ fontSize: 13 }}>{insight.title}</Text>
                                {pillar.sample && <SampleTag />}
                            </Space>
                            <Paragraph type="secondary" style={{ margin: '2px 0 0', fontSize: 12 }}>
                                {insight.text}
                                {/* On a pillar view the pillar is already open. */}
                                {!pillarKey && (
                                    <Button size="small" type="link" style={{ padding: '0 0 0 4px', height: 'auto', fontSize: 12, color: pillar.color }} onClick={() => onOpen(insight.pillar)}>
                                        {t('Open {pillar}', undefined, { pillar: pillar.key })} →
                                    </Button>
                                )}
                            </Paragraph>
                        </div>
                    </motion.div>
                )
            })}
        </Space>
    )
}

export default function ProjectAdminEsgPage() {
    const { t, language } = useLanguage()
    const { message } = App.useApp()
    const navigate = useNavigate()
    const reduceMotion = Boolean(useReducedMotion())
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [scorecard, setScorecard] = useState<EsgScorecard | null>(null)
    const [loading, setLoading] = useState(true)
    const [view, setView] = useState<EsgView>('overview')
    const [chosenHorizon, setHorizon] = useState<Horizon>(4)

    useEffect(() => {
        if (identityLoading) return
        if (!user) {
            setLoading(false)
            return
        }
        let active = true
        setLoading(true)
        loadEsgScorecard(user, { activeProgramId, isAllPrograms })
            .then((data) => { if (active) setScorecard(trimScorecard(data)) })
            .catch(() => { if (active) message.error(t('ESG figures could not be loaded.')) })
            .finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [activeProgramId, identityLoading, isAllPrograms, user]) // eslint-disable-line react-hooks/exhaustive-deps

    const pillars = useMemo(() => (scorecard ? buildPillars(scorecard) : []), [scorecard, language]) // eslint-disable-line react-hooks/exhaustive-deps
    const timeline = useMemo(() => (scorecard ? timelineOf(scorecard) : null), [scorecard])
    const maxHorizon = scorecard ? Math.max(1, measuredQuarters(scorecard)) : 1
    // Never project further ahead than there is history behind it. The choice is kept, so it returns once
    // enough quarters are measured (or another programme with more history is picked).
    const horizon = [...HORIZONS].reverse().find((count) => count <= Math.min(chosenHorizon, maxHorizon)) ?? 1
    const selectedPillar = pillars.find((pillar) => pillar.key.toLowerCase() === view)
    const overall = latest(overallHistory(pillars, scorecard?.quarters.length || 0))
    const documentsTheme = scorecard?.themes.find((item) => item.key === 'documents')
    const belowTarget = pillars.flatMap((pillar) => pillar.initiatives).filter((item) => {
        const value = latest(item.history)
        return value !== null && value < ESG_TARGET
    }).length

    const overviewChart = useMemo(
        () => timeline && buildProjectionChart(pillars.map((pillar) => ({ name: pillar.title, color: pillar.color, history: pillar.history })), timeline, horizon, reduceMotion, 300),
        [pillars, timeline, horizon, reduceMotion],
    )

    const mainCardRef = useRef<HTMLDivElement>(null)
    /** Theme rows and insights sit low in the card, so opening a pillar brings its top back into view. */
    const openPillar = (key: PillarKey) => {
        setView(key.toLowerCase() as EsgView)
        mainCardRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
    }
    const ready = !loading && scorecard && timeline && overviewChart

    return (
        <DashboardPage className="project-admin-esg-page">
            <DashboardHeader title={t('ESG scorecard')} subtitle={tr('A granular view of environmental, social, and governance performance across the programme portfolio.')} actions={<Button type="primary" onClick={() => navigate('/projectadmin/esg/performance')}>{t('Individual performance')}</Button>} />
            <Row gutter={[16, 16]}>
                <Col xs={24} md={12} xl={6}>
                    <Card className="dashboard-section-card" loading={loading}>
                        <Statistic title={t('Overall ESG score')} value={overall ?? '—'} suffix={overall === null ? undefined : '/100'} valueStyle={{ color: CHART_COLORS.violet }} />
                        <Progress percent={overall ?? 0} strokeColor={CHART_COLORS.violet} showInfo={false} />
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('Environmental is sample data until it is captured')}</Text>
                    </Card>
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <Card className="dashboard-section-card" loading={loading}>
                        <Statistic title={t('SMEs measured')} value={scorecard?.smes ?? 0} valueStyle={{ color: CHART_COLORS.primary }} />
                        <Text type="secondary">{t('Active SMEs in this programme scope')}</Text>
                    </Card>
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <Card className="dashboard-section-card" loading={loading}>
                        <Statistic title={t('Valid compliance documents')} value={latest(documentsTheme?.history || []) ?? '—'} suffix={latest(documentsTheme?.history || []) === null ? undefined : '%'} valueStyle={{ color: CHART_COLORS.success }} />
                        <Text type="secondary">{documentsTheme ? tr(documentsTheme.basis) : ''}</Text>
                    </Card>
                </Col>
                <Col xs={24} md={12} xl={6}>
                    <Card className="dashboard-section-card" loading={loading}>
                        <Statistic title={t('Themes below target')} value={belowTarget} valueStyle={{ color: CHART_COLORS.amber }} />
                        <Text type="secondary">{t('Under {target}% this quarter', undefined, { target: ESG_TARGET })}</Text>
                    </Card>
                </Col>
            </Row>
            <Card ref={mainCardRef} className="dashboard-section-card" style={{ marginTop: 16, scrollMarginTop: 80 }}>
                <Segmented block value={view} onChange={(value) => setView(value as EsgView)} options={[{ label: t('ESG overview'), value: 'overview' }, { label: t('E · Environmental'), value: 'e' }, { label: t('S · Social'), value: 's' }, { label: t('G · Governance'), value: 'g' }]} style={{ marginBottom: 20 }} />
                <Space wrap style={{ justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
                    <Text type="secondary">{t('Dashed lines project the current quarterly trend forward; the shaded band is the likely range.')}</Text>
                    <Space size={8}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('Project ahead')}</Text>
                        <Segmented
                            size="small"
                            value={horizon}
                            onChange={(value) => setHorizon(value as Horizon)}
                            options={HORIZONS.map((count) => ({
                                value: count,
                                disabled: count > maxHorizon,
                                label: (
                                    <Tooltip title={count > maxHorizon
                                        ? t('Needs {count} quarters of records; {have} so far', undefined, { count, have: maxHorizon })
                                        : horizonLabel(count)}
                                    >
                                        <span>{t('{count}Q', undefined, { count })}</span>
                                    </Tooltip>
                                ),
                            }))}
                        />
                    </Space>
                </Space>
                {!ready ? <div style={{ textAlign: 'center', padding: 48 }}><Spin /></div> : (
                    <>
                        {view === 'overview' && (
                            <Row gutter={[16, 16]}>
                                {pillars.map((pillar, index) => (
                                    <Col xs={24} md={8} key={pillar.key}>
                                        <PillarTile pillar={pillar} horizon={horizon} index={index} onOpen={() => setView(pillar.key.toLowerCase() as EsgView)} />
                                    </Col>
                                ))}
                                <Col span={24}>
                                    <Title level={5} style={{ marginTop: 4 }}>{t('Score trend and projection')}</Title>
                                    {/* Remounting on horizon change replays the draw-in, so the new projection animates. */}
                                    <ThemedHighcharts key={`overview-${horizon}`} options={overviewChart} />
                                </Col>
                            </Row>
                        )}
                        {selectedPillar && <PillarDetail key={selectedPillar.key} pillar={selectedPillar} timeline={timeline} horizon={horizon} />}
                        <Divider style={{ margin: '16px 0' }} />
                        {/* Keyed on the view and horizon so either change replays the bars and insights. */}
                        <Row gutter={[24, 16]} key={`${view}-${horizon}`}>
                            <Col xs={24} lg={14}>
                                <Space style={{ justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                                    <Text strong>{t('Themes')}</Text>
                                    <Text type="secondary" style={{ fontSize: 12 }}>{t('Weakest first · dashed = {horizon}', undefined, { horizon: horizonLabel(horizon) })}</Text>
                                </Space>
                                <ThemeRows
                                    items={selectedPillar ? selectedPillar.initiatives : pillars.flatMap((pillar) => pillar.initiatives)}
                                    pillars={pillars}
                                    horizon={horizon}
                                    limit={selectedPillar ? undefined : OVERVIEW_THEME_LIMIT}
                                    onOpen={selectedPillar ? undefined : openPillar}
                                />
                            </Col>
                            <Col xs={24} lg={10}>
                                <Text strong style={{ display: 'block', marginBottom: 8 }}>{t('Key insights')}</Text>
                                <InsightList pillars={pillars} pillar={selectedPillar?.key} onOpen={openPillar} />
                            </Col>
                        </Row>
                    </>
                )}
            </Card>
        </DashboardPage>
    )
}

const PILLAR_SOURCES: Record<PillarKey, () => string> = {
    E: () => tr('Illustrative figures. Environmental records (energy, waste, emissions) are not captured on the platform yet.'),
    S: () => tr('Measured from SME headcount history, ownership on applications, and facilitator check-back results.'),
    G: () => tr('Measured from compliance documents: verification status, expiry dates, tax and B-BBEE records.'),
}

function PillarDetail({ pillar, timeline, horizon }: { pillar: Pillar; timeline: Timeline; horizon: Horizon }) {
    const { t, language } = useLanguage()
    const reduceMotion = Boolean(useReducedMotion())
    const score = latest(pillar.history)
    const projection = projectScores(pillar.history, horizon)
    const quarters = quartersToTarget(pillar.history, projection.slope)
    const [ringPercent, setRingPercent] = useState(reduceMotion ? score ?? 0 : 0)
    useEffect(() => { setRingPercent(score ?? 0) }, [score])

    const chart = useMemo(
        () => buildProjectionChart([{ name: pillar.title, color: pillar.color, history: pillar.history }], timeline, horizon, reduceMotion, 300),
        [pillar, timeline, horizon, reduceMotion, language], // eslint-disable-line react-hooks/exhaustive-deps
    )

    if (score === null) {
        return <Empty description={<Space direction="vertical" size={4}><Text strong>{t('No {name} records to score yet', undefined, { name: pillar.title })}</Text><Text type="secondary">{PILLAR_SOURCES[pillar.key]()}</Text></Space>} />
    }

    const pace = t('{sign}{value} a quarter', undefined, { sign: projection.slope >= 0 ? '+' : '', value: projection.slope.toFixed(1) })
    const outlook = quarters === 0
        ? t('Already at or above the {target} target.', undefined, { target: ESG_TARGET })
        : quarters === null
            ? t('The trend is flat or falling, so it will not reach {target} without action.', undefined, { target: ESG_TARGET })
            : t('At this pace it reaches the {target} target in about {count} quarter(s).', undefined, { target: ESG_TARGET, count: quarters })

    return (
        <Row gutter={[24, 16]} align="middle">
            <Col xs={24} md={8} style={{ textAlign: 'center' }}>
                <Progress type="circle" percent={ringPercent} strokeColor={pillar.color} format={() => <><strong><CountUp value={score} /></strong><small>/100</small></>} />
                <Space direction="vertical" size={4} style={{ marginTop: 16, width: '100%' }}>
                    <Space size={8} style={{ justifyContent: 'center' }} wrap>
                        <Title level={4} style={{ margin: 0 }}>{pillar.icon} {pillar.key} · {pillar.title}</Title>
                        {pillar.sample && <SampleTag />}
                    </Space>
                    <Paragraph type="secondary" style={{ margin: 0 }}>{PILLAR_SOURCES[pillar.key]()}</Paragraph>
                </Space>
            </Col>
            <Col xs={24} md={16}>
                <Space wrap style={{ marginBottom: 8 }}>
                    <Tag color={projection.slope >= 0 ? 'green' : 'red'} icon={projection.slope >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}>{pace}</Tag>
                    <Tag color={quarters === null ? 'orange' : 'blue'} icon={<AimOutlined />}>{outlook}</Tag>
                </Space>
                <ThemedHighcharts key={`${pillar.key}-${horizon}`} options={chart} />
            </Col>
        </Row>
    )
}
