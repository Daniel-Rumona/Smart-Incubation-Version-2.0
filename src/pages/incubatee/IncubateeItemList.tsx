import type { ReactNode } from 'react'
import { Empty, Tag } from 'antd'
import { TAG_COLOR, formatStatus, statusTone } from '@/utils/status'

export type DashboardItem = {
    id: string
    title: string
    meta?: string
    status: string
    icon: ReactNode
    action?: ReactNode
}

/** One compact row per item: state icon, title over its context line, standard status tag, optional action. */
export const IncubateeItemList = ({ items, emptyText }: { items: DashboardItem[], emptyText: string }) => {
    if (!items.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />

    return (
        <ul className="incubatee-items">
            {items.map((item) => {
                const tone = statusTone(item.status)
                return (
                    <li
                        className="incubatee-item"
                        key={item.id}
                    >
                        <span className={`incubatee-item-icon is-${tone}`}>{item.icon}</span>

                        <span className="incubatee-item-copy">
                            <strong title={item.title}>{item.title}</strong>
                            {item.meta && <span title={item.meta}>{item.meta}</span>}
                        </span>

                        <Tag
                            className="incubatee-item-status"
                            color={TAG_COLOR[tone]}
                            bordered={false}
                        >
                            {formatStatus(item.status)}
                        </Tag>

                        {item.action}
                    </li>
                )
            })}
        </ul>
    )
}

export default IncubateeItemList
