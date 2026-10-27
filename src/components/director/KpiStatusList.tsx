import { Tag, Typography } from 'antd'
import { useLanguage } from '@/providers/LanguageProvider'
import type { KpiStatusItem } from '@/services/directorDashboardService'

const KPI_STATUS: Record<KpiStatusItem['status'], { label: string, color: string | undefined }> = {
    behind: { label: 'Behind', color: 'red' },
    on_track: { label: 'On track', color: 'green' },
    met: { label: 'Met', color: 'green' },
    no_data: { label: 'No data yet', color: undefined },
}

/** A programme's KPIs with their status for the current period (director dashboard and Programme performance). */
export const KpiStatusList = ({ items, emptyText }: { items: KpiStatusItem[], emptyText: string }) => {
    const { t } = useLanguage()
    if (!items.length) return <Typography.Text type="secondary">{emptyText}</Typography.Text>
    return (
        <ul className="director-kpi-list">
            {items.map((item) => (
                <li key={item.id}>
                    <span>
                        <Typography.Text>{item.name}</Typography.Text>
                        <Typography.Text type="secondary">{item.periodLabel}</Typography.Text>
                    </span>
                    <Tag bordered={false} color={KPI_STATUS[item.status].color}>{t(KPI_STATUS[item.status].label)}</Tag>
                </li>
            ))}
        </ul>
    )
}
