import { Segmented } from 'antd'
import { InboxOutlined, MailOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { useLanguage } from '@/providers/LanguageProvider'
import { previewOf, type AppNotification } from '@/hooks/useNotifications'
import { notificationIcon, useCardMotion, type NotificationFilter } from './notificationUi'

export const NotificationFilterSwitch = ({ value, onChange, unread, total }: { value: NotificationFilter, onChange: (value: NotificationFilter) => void, unread: number, total: number }) => {
  const { t } = useLanguage()
  return (
    <Segmented<NotificationFilter>
      block
      className="notif-filter"
      value={value}
      onChange={onChange}
      options={[
        { value: 'all', icon: <InboxOutlined />, label: <span className="notif-filter-label">{t('All')}<em>{total}</em></span> },
        { value: 'unread', icon: <MailOutlined />, label: <span className="notif-filter-label">{t('Unread')}<em>{unread}</em></span> },
      ]}
    />
  )
}

type SlimCardProps = {
  item: AppNotification
  index: number
  onClick: () => void
  selected?: boolean
  showPreview?: boolean
}

export const NotificationSlimCard = ({ item, index, onClick, selected, showPreview = true }: SlimCardProps) => {
  const motionProps = useCardMotion(index)
  const preview = previewOf(item)
  return (
    <motion.li {...motionProps} className="notif-card-wrap">
      <button
        type="button"
        className={`notif-card is-${item.tone}${item.read ? ' is-read' : ' is-unread'}${selected ? ' is-selected' : ''}`}
        onClick={onClick}
      >
        <span className="notif-card-icon">{notificationIcon(item)}</span>
        <span className="notif-card-copy">
          <span className="notif-card-title">{item.title}</span>
          {showPreview && preview.text && (
            <span className="notif-card-preview">
              <span className="notif-card-preview-text">{preview.text}</span>
              {preview.more > 0 && <em>+{preview.more}</em>}
            </span>
          )}
        </span>
        <span className="notif-card-meta">
          <span className="notif-card-time">{item.createdAt ? item.createdAt.fromNow(true) : ''}</span>
          {!item.read && <span className="notif-card-dot" aria-label="Unread" />}
        </span>
      </button>
    </motion.li>
  )
}

export const NotificationSkeletons = ({ count = 3 }: { count?: number }) => (
  <ul className="notif-list" aria-hidden="true">
    {Array.from({ length: count }, (_, index) => (
      <li key={index} className="notif-card-wrap">
        <div className="notif-skeleton" style={{ animationDelay: `${index * 0.12}s` }}>
          <span className="notif-skeleton-icon" />
          <span className="notif-skeleton-lines"><i /><i /></span>
        </div>
      </li>
    ))}
  </ul>
)
