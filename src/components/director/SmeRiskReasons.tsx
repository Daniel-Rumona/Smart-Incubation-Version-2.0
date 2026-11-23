import type { ReactNode } from 'react'
import { Progress, Space, Tag, Typography } from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    FallOutlined,
    FileSearchOutlined,
    TeamOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { CHART_COLORS } from '@/config/chartPalette'
import { tr, useLanguage } from '@/providers/LanguageProvider'
import type { DirectorPortfolioSme } from '@/types/director'

const { Text } = Typography

export type RiskReason = {
    key: string
    severity: 'High' | 'Medium'
    icon: ReactNode
    title: string
    detail: string
    short: string
    gauge?: { value: number; max: number; mediumAt: number; highAt: number }
}

/** Monthly figures older than this many days count as "stopped reporting"; twice as long is high. */
const REPORT_GAP_DAYS = 60

/**
 * Why an SME needs attention, in plain words, from what its own record shows. The first four mirror deriveRisk in
 * directorPortfolioService (progress < 45 / growth < 20 is High, < 65 / < 40 is Medium) plus the delivery signals.
 * Not reporting and falling jobs are shown as reasons too, but they don't change the High/Medium/Low rating, so the
 * dashboards that count by rating keep their numbers.
 */
export const buildRiskReasons = (sme: DirectorPortfolioSme, now = dayjs()): RiskReason[] => {
    const reasons: RiskReason[] = []
    const { progress, execution, metrics } = sme

    if (progress < 65) {
        reasons.push({
            key: 'progress',
            severity: progress < 45 ? 'High' : 'Medium',
            icon: <CheckCircleOutlined />,
            title: tr('Delivery progress is behind'),
            detail: `Average intervention progress is ${progress}%${progress < 45 ? ', under the 45% high-risk line' : ', under the 65% healthy line'}.${execution.required ? ` ${execution.completed} of ${execution.required} required interventions are complete.` : ''}`,
            short: `${progress}% progress`,
            gauge: { value: progress, max: 100, mediumAt: 65, highAt: 45 },
        })
    }

    if (metrics.growthRate < 40) {
        reasons.push({
            key: 'growth',
            severity: metrics.growthRate < 20 ? 'High' : 'Medium',
            icon: <FallOutlined />,
            title: metrics.growthRate < 0 ? tr('Revenue is declining') : tr('Revenue growth is weak'),
            detail: metrics.growthRate < 0
                ? `Revenue has fallen ${Math.abs(metrics.growthRate)}% over the last six months of recorded history.`
                : `Revenue grew only ${metrics.growthRate}% over the last six months, under the ${metrics.growthRate < 20 ? '20% high-risk' : '40% healthy'} line.`,
            short: metrics.growthRate < 0 ? `Revenue ${metrics.growthRate}%` : `Growth ${metrics.growthRate}%`,
            gauge: { value: Math.max(metrics.growthRate, 0), max: 100, mediumAt: 40, highAt: 20 },
        })
    }

    // Stopped sending monthly figures: every other number here goes stale with them.
    const lastReport = sme.lastReport ? dayjs(sme.lastReport) : null
    const joined = sme.joinedAt ? dayjs(sme.joinedAt) : null
    if (lastReport?.isValid()) {
        const days = now.diff(lastReport, 'day')
        if (days >= REPORT_GAP_DAYS) {
            const months = Math.floor(days / 30)
            reasons.push({
                key: 'reporting',
                severity: days >= REPORT_GAP_DAYS * 2 ? 'High' : 'Medium',
                icon: <FileSearchOutlined />,
                title: tr('Has stopped reporting monthly figures'),
                detail: `The last monthly report was on ${lastReport.format('D MMM YYYY')}, ${months} months ago. Revenue and growth here may be out of date.`,
                short: `No report ${months} mo`,
            })
        }
    } else if (joined?.isValid() && now.diff(joined, 'day') >= REPORT_GAP_DAYS) {
        reasons.push({
            key: 'reporting',
            severity: 'Medium',
            icon: <FileSearchOutlined />,
            title: tr('Has never reported monthly figures'),
            detail: `Joined on ${joined.format('D MMM YYYY')} and has not sent a monthly report since, so there is no revenue or jobs record to go on.`,
            short: tr('Never reported'),
        })
    }

    const jobs = sme.growth?.jobs
    if (jobs && jobs.latest < jobs.start) {
        reasons.push({
            key: 'jobs',
            severity: 'Medium',
            icon: <TeamOutlined />,
            title: tr('Jobs are down since joining'),
            detail: `Reported jobs went from ${jobs.start} when the SME joined to ${jobs.latest} in the latest report.`,
            short: `Jobs ${jobs.start}→${jobs.latest}`,
        })
    }

    if (execution.overdue > 0) {
        reasons.push({
            key: 'overdue',
            severity: execution.overdue >= 2 ? 'High' : 'Medium',
            icon: <ClockCircleOutlined />,
            title: `${execution.overdue} overdue intervention${execution.overdue === 1 ? '' : 's'}`,
            detail: tr('These were due before today and are not yet completed.'),
            short: `${execution.overdue} overdue`,
        })
    }

    if (execution.unresponsive > 0) {
        reasons.push({
            key: 'unresponsive',
            severity: 'Medium',
            icon: <ExclamationCircleOutlined />,
            title: `Slow to respond (${execution.unresponsive})`,
            detail: tr('The consultant accepted these interventions but the SME has not responded for 7 or more days.'),
            short: `${execution.unresponsive} unresponsive`,
        })
    }

    return reasons.sort((left, right) => (left.severity === right.severity ? 0 : left.severity === 'High' ? -1 : 1))
}

export const riskSeverityColor = (severity: 'High' | 'Medium') => (severity === 'High' ? CHART_COLORS.danger : CHART_COLORS.amber)

/** The short reasons as tags, for a list row or table cell. */
export const RiskReasonTags = ({ sme, max = 3 }: { sme: DirectorPortfolioSme, max?: number }) => {
    const reasons = buildRiskReasons(sme).slice(0, max)
    if (!reasons.length) return null
    return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {reasons.map(reason => <Tag key={reason.key} variant="filled" color={reason.severity === 'High' ? 'red' : 'orange'} style={{ margin: 0 }}>{reason.short}</Tag>)}
        </div>
    )
}

/** Each reason in full: what it is, how serious, and the line it crossed. */
export const RiskReasonList = ({ sme, emptyText }: { sme: DirectorPortfolioSme, emptyText?: string }) => {
    const { t } = useLanguage()
    const reasons = buildRiskReasons(sme)
    if (!reasons.length) return emptyText ? <Text type="secondary">{emptyText}</Text> : null
    return (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {reasons.map(reason => (
                <div key={reason.key} style={{ display: 'flex', gap: 14, padding: '12px 14px', borderRadius: 14, background: `${riskSeverityColor(reason.severity)}12` }}>
                    <span style={{ width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: riskSeverityColor(reason.severity), background: `${riskSeverityColor(reason.severity)}22`, flexShrink: 0 }}>{reason.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <Text strong>{reason.title}</Text>
                            <Tag color={reason.severity === 'High' ? 'red' : 'orange'} style={{ marginInlineEnd: 0 }}>{reason.severity}</Tag>
                        </div>
                        <Text type="secondary" style={{ fontSize: 13 }}>{reason.detail}</Text>
                        {reason.gauge && (
                            <div style={{ marginTop: 6 }}>
                                <Progress percent={Math.min(100, Math.round((reason.gauge.value / reason.gauge.max) * 100))} strokeColor={riskSeverityColor(reason.severity)} size="small" format={() => `${reason.gauge!.value}%`} />
                                <Text type="secondary" style={{ fontSize: 11 }}>{t('High risk below')} {reason.gauge.highAt}{t('% · healthy from')} {reason.gauge.mediumAt}%</Text>
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </Space>
    )
}
