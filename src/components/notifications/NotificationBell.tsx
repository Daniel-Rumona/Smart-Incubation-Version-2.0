import { useMemo, useState } from 'react'
import { Badge, Button, Dropdown, Empty } from 'antd'
import { BellOutlined, CheckOutlined, RightOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useLanguage } from '@/providers/LanguageProvider'
import { useNotifications, type AppNotification } from '@/hooks/useNotifications'
import { NotificationFilterSwitch, NotificationSkeletons, NotificationSlimCard } from './NotificationParts'
import type { NotificationFilter } from './notificationUi'
import '@/styles/notifications.css'

const PANEL_LIMIT = 6

/** Bell in the top bar. Opens a slim dropdown of what is coming up; the full inbox lives on /notifications. */
export const NotificationBell = () => {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const { enabled, loading, items, unread, reload, setRead, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<NotificationFilter>('all')

  const visible = useMemo(() => (filter === 'unread' ? items.filter((item) => !item.read) : items).slice(0, PANEL_LIMIT), [filter, items])

  if (!enabled) return null

  const openCenter = (id?: string) => {
    setOpen(false)
    navigate(id ? `/notifications?item=${encodeURIComponent(id)}` : '/notifications')
  }

  const pick = (item: AppNotification) => {
    void setRead(item, true)
    openCenter(item.id)
  }

  const panel = (
    <motion.div
      className="notif-panel"
      initial={reduce ? false : { opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="notif-panel-head">
        <div className="notif-panel-title">
          <strong>{t('Notifications')}</strong>
          <span>{unread ? t('{count} unread', undefined, { count: unread }) : t('You are all caught up')}</span>
        </div>
        {unread > 0 && (
          <Button type="text" size="small" icon={<CheckOutlined />} onClick={() => void markAllRead(items)}>
            {t('Mark all as read')}
          </Button>
        )}
      </header>

      <NotificationFilterSwitch value={filter} onChange={setFilter} unread={unread} total={items.length} />

      <div className="notif-panel-body">
        {loading ? (
          <NotificationSkeletons />
        ) : visible.length ? (
          <ul className="notif-list">
            <AnimatePresence initial>
              {visible.map((item, index) => (
                <NotificationSlimCard key={`${filter}-${item.id}`} item={item} index={index} onClick={() => pick(item)} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === 'unread' ? t('No unread notifications') : t('No notifications yet')} />
        )}
      </div>

      <footer className="notif-panel-foot">
        <Button type="link" onClick={() => openCenter()}>
          {t('View all notifications')} <RightOutlined />
        </Button>
      </footer>
    </motion.div>
  )

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      open={open}
      onOpenChange={(next) => { setOpen(next); if (next) void reload() }}
      classNames={{ root: 'notif-dropdown' }}
      popupRender={() => panel}
    >
      <Button
        type="text"
        shape="circle"
        icon={<Badge count={unread} size="small"><BellOutlined /></Badge>}
        className="app-icon-btn"
        aria-label={t('Notifications')}
      />
    </Dropdown>
  )
}

export default NotificationBell
