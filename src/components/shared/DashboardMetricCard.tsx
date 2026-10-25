import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { Card, Grid, Skeleton, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined, RightOutlined } from '@ant-design/icons'
import { useCountUp } from 'react-countup'

import '@/styles/dashboard.css'

type DashboardMetricCardProps = {
    icon?: ReactNode
    label: string
    /** Shorter label swapped in on mobile. Falls back to `label` when omitted. */
    mobileTitle?: string
    value: ReactNode
    hint?: string
    iconClassName?: string
    clickable?: boolean
    /** Highlights the card as the current filter selection. */
    active?: boolean
    loading?: boolean
    /** Set to false to omit this card entirely on mobile. Defaults to true. */
    onMobile?: boolean
    /**
     * Phones show two metrics as full cards and the rest as a slim one-line strip (count + label). By default
     * the first two in the row are the full ones; 'key' keeps this card full wherever it sits, 'strip' slims it.
     */
    mobileProminence?: 'key' | 'strip'
    onClick?: () => void
    /**
     * Change against an earlier period. Shown as a compact badge beside the figure (an arrow and `amount`, e.g. "12");
     * `text` is the full sentence ("+12 vs 30 days ago") for the tooltip and screen readers. `tone` says whether it's good news.
     */
    trend?: { text: string; amount?: string; direction?: 'up' | 'down' | 'flat'; tone: 'good' | 'bad' | 'neutral' }
    /** A few recent values (oldest first) drawn as a small line, to show direction at a glance. */
    sparkline?: number[]
}

/**
 * A smooth path through the points using monotone cubic interpolation (Fritsch–Carlson): it curves like a
 * spline but never overshoots, so a count never appears to dip below zero or peak above its real value.
 */
const smoothPath = (points: Array<[number, number]>) => {
    const count = points.length
    const slopes = points.slice(0, -1).map(([x, y], index) => (points[index + 1][1] - y) / (points[index + 1][0] - x))
    const tangents = points.map((_, index) => {
        if (index === 0) return slopes[0]
        if (index === count - 1) return slopes[count - 2]
        const before = slopes[index - 1]
        const after = slopes[index]
        return before * after <= 0 ? 0 : (before + after) / 2
    })
    // Keep the curve monotone between points where the data is.
    slopes.forEach((slope, index) => {
        if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; return }
        const a = tangents[index] / slope
        const b = tangents[index + 1] / slope
        const length = Math.hypot(a, b)
        if (length > 3) { tangents[index] = (3 / length) * a * slope; tangents[index + 1] = (3 / length) * b * slope }
    })
    return points.reduce((path, [x, y], index) => {
        if (index === 0) return `M${x},${y}`
        const [x0, y0] = points[index - 1]
        const step = (x - x0) / 3
        return `${path} C${x0 + step},${y0 + tangents[index - 1] * step} ${x - step},${y - tangents[index] * step} ${x},${y}`
    }, '')
}

/** A tiny trend curve: no axes or labels, the card's value and trend text carry the numbers. */
function Sparkline({ values }: { values: number[] }) {
    if (values.length < 2) return null
    const max = Math.max(...values)
    const min = Math.min(...values)
    const span = max - min || 1
    const points = values.map((value, index): [number, number] => [(index / (values.length - 1)) * 100, 26 - ((value - min) / span) * 22])
    const line = smoothPath(points)
    return (
        <svg className="dashboard-metric-sparkline" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true">
            <path d={`${line} L100,28 L0,28 Z`} className="dashboard-metric-sparkline-area" />
            <path d={line} className="dashboard-metric-sparkline-line" vectorEffect="non-scaling-stroke" />
        </svg>
    )
}

type AnimatedMetricValueProps = {
    value: number
}

function AnimatedMetricValue({ value }: AnimatedMetricValueProps) {
    const countUpRef = useRef<HTMLSpanElement | null>(null)

    const { update } = useCountUp({
        ref: countUpRef as RefObject<HTMLElement>,
        end: value,
        duration: 1.2,
        separator: ',',
        startOnMount: true,
    })

    // The hook animates to whatever it mounted with; pages that load their data
    // after the first render need the number told about the new total.
    useEffect(() => {
        update(value)
    }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <span
            ref={countUpRef}
            className="dashboard-metric-count"
        >
            {value.toLocaleString()}
        </span>
    )
}

export default function DashboardMetricCard({
    icon,
    label,
    mobileTitle,
    value,
    hint,
    iconClassName = '',
    clickable = false,
    active = false,
    loading = false,
    onMobile = true,
    mobileProminence,
    onClick,
    trend,
    sparkline,
}: DashboardMetricCardProps) {
    const isMobile = !Grid.useBreakpoint().md

    if (isMobile && !onMobile) {
        return null
    }

    const displayLabel = isMobile && mobileTitle ? mobileTitle : label
    const isNumericValue = typeof value === 'number'

    const cardClassName = [
        'dashboard-metric-card',
        'motion-card',
        loading ? 'is-loading' : '',
        !loading && (clickable || onClick) ? 'is-clickable' : '',
        !loading && active ? 'is-active' : '',
        mobileProminence ? `is-mobile-${mobileProminence}` : '',
    ]
        .filter(Boolean)
        .join(' ')

    const iconClassNames = [
        'dashboard-metric-icon',
        iconClassName,
    ]
        .filter(Boolean)
        .join(' ')

    if (loading) {
        return (
            <Card
                className={cardClassName}
                bordered
            >
                <div
                    className="dashboard-metric-row"
                    aria-busy="true"
                >
                    <Skeleton.Avatar
                        active
                        shape="circle"
                        size={34}
                    />

                    <div className="dashboard-metric-copy">
                        <Skeleton.Input
                            active
                            size="small"
                            className="dashboard-metric-skeleton-label"
                        />

                        <Skeleton.Input
                            active
                            size="small"
                            className="dashboard-metric-skeleton-value"
                        />
                    </div>
                </div>
            </Card>
        )
    }

    return (
        <Card
            className={cardClassName}
            bordered
            onClick={onClick}
        >
            <div
                className={sparkline ? 'dashboard-metric-row has-sparkline' : 'dashboard-metric-row'}
                title={hint}
            >
                {icon && (
                    <span className={iconClassNames}>
                        {icon}
                    </span>
                )}

                <div className="dashboard-metric-copy">
                    <Typography.Text
                        type="secondary"
                        className="dashboard-metric-label"
                    >
                        {displayLabel}
                    </Typography.Text>

                    {/* The change sits beside the figure it describes, keeping the card to two lines. */}
                    <div className="dashboard-metric-value-line">
                        <span className="dashboard-metric-value">
                            {isNumericValue ? (
                                <AnimatedMetricValue value={value} />
                            ) : (
                                value
                            )}
                        </span>
                        {trend && (
                            <span className={`dashboard-metric-trend is-${trend.tone}`} title={trend.text} aria-label={trend.text}>
                                {trend.direction === 'up' ? <ArrowUpOutlined /> : trend.direction === 'down' ? <ArrowDownOutlined /> : trend.direction === 'flat' ? <MinusOutlined /> : null}
                                {trend.amount ?? trend.text}
                            </span>
                        )}
                    </div>

                    {hint && (
                        <Typography.Text
                            type="secondary"
                            className="dashboard-metric-hint"
                        >
                            {hint}
                        </Typography.Text>
                    )}
                </div>

                {sparkline && <Sparkline values={sparkline} />}

                {(clickable || Boolean(onClick)) && (
                    <span
                        className="dashboard-metric-arrow"
                        aria-hidden="true"
                    >
                        <RightOutlined />
                    </span>
                )}
            </div>
        </Card>
    )
}
