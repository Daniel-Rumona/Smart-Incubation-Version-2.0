import type { ReactNode, RefObject } from 'react'
import { useEffect, useRef } from 'react'
import { Card, Grid, Skeleton, Typography } from 'antd'
import { RightOutlined } from '@ant-design/icons'
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
    onClick?: () => void
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
    onClick,
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
                className="dashboard-metric-row"
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

                    <span className="dashboard-metric-value">
                        {isNumericValue ? (
                            <AnimatedMetricValue value={value} />
                        ) : (
                            value
                        )}
                    </span>

                    {hint && (
                        <Typography.Text
                            type="secondary"
                            className="dashboard-metric-hint"
                        >
                            {hint}
                        </Typography.Text>
                    )}
                </div>

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
