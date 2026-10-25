import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Grid, Input, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined, MailOutlined, SearchOutlined } from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useNavigate, useSearchParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { NotificationFilterSwitch, NotificationSkeletons, NotificationSlimCard } from '@/components/notifications/NotificationParts'
import { notificationIcon, type NotificationFilter } from '@/components/notifications/notificationUi'
import { describeType, useNotifications, type AppNotification } from '@/hooks/useNotifications'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/notifications.css'

const TONE_LABEL = { danger: 'Needs attention', warning: 'Coming up', success: 'Good news', info: 'Update' } as const

const Detail = ({ item, onToggleRead, onBack }: { item: AppNotification, onToggleRead: () => void, onBack?: () => void }) => {
  const { t } = useLanguage()
  const navigate = useNavigate()
  const reduce = useReducedMotion()
  const lines = item.body.split('\n').map((line) => line.trim()).filter(Boolean)

  return (
    <motion.article
      key={item.id}
      className="notif-detail"
      initial={reduce ? false : { opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
    >
      {onBack && <Button type="text" icon={<ArrowLeftOutlined />} className="notif-detail-back" onClick={onBack}>{t('Back to notifications')}</Button>}

      <header className="notif-detail-head">
        <span className={`notif-detail-icon is-${item.tone}`}>{notificationIcon(item)}</span>
        <div>
          <Typography.Title level={4}>{item.title}</Typography.Title>
          <div className="notif-detail-meta">
            <Tag className={`notif-tone is-${item.tone}`}>{t(TONE_LABEL[item.tone])}</Tag>
            {describeType(item.type) && <Tag>{describeType(item.type)}</Tag>}
            {item.createdAt && <span title={item.createdAt.format('DD MMM YYYY HH:mm')}>{item.createdAt.fromNow()} · {item.createdAt.format('DD MMM YYYY HH:mm')}</span>}
          </div>
        </div>
      </header>

      <section className="notif-detail-body">
        {lines.length > 1 ? (
          <ul>
            {lines.map((line, index) => (
              <motion.li key={`${index}-${line}`} initial={reduce ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 + index * 0.04, duration: 0.2 }}>
                {line}
              </motion.li>
            ))}
          </ul>
        ) : lines.length === 1 ? (
          <p>{lines[0]}</p>
        ) : (
          <Typography.Text type="secondary">{t('This notification has no further details.')}</Typography.Text>
        )}
      </section>

      <footer className="notif-detail-actions">
        {item.link && (
          <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={() => navigate(item.link!)}>
            {t('Open related page')}
          </Button>
        )}
        <Button icon={item.read ? <MailOutlined /> : <CheckOutlined />} onClick={onToggleRead}>
          {item.read ? t('Mark as unread') : t('Mark as read')}
        </Button>
      </footer>
    </motion.article>
  )
}

export const NotificationCenterPage = () => {
  const { t } = useLanguage()
  const screens = Grid.useBreakpoint()
  const compact = !screens.lg
  const [params, setParams] = useSearchParams()
  const { loading, items, unread, setRead, markAllRead } = useNotifications()
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [search, setSearch] = useState('')

  const requestedId = params.get('item')

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return items
      .filter((item) => filter === 'all' || !item.read)
      .filter((item) => !needle || `${item.title} ${item.body} ${item.type}`.toLowerCase().includes(needle))
  }, [filter, items, search])

  const selected = items.find((item) => item.id === requestedId) || (compact ? undefined : visible[0])

  useEffect(() => {
    if (selected && !selected.read && requestedId === selected.id) void setRead(selected, true)
  }, [requestedId, selected, setRead])

  const select = (item: AppNotification) => setParams({ item: item.id }, { replace: true })
  const clearSelection = () => setParams({}, { replace: true })

  const list = (
    <section className="notif-center-list">
      <div className="notif-center-tools">
        <Input allowClear prefix={<SearchOutlined />} placeholder={t('Search notifications')} value={search} onChange={(event) => setSearch(event.target.value)} />
        <NotificationFilterSwitch value={filter} onChange={setFilter} unread={unread} total={items.length} />
        {unread > 0 && (
          <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => void markAllRead(items)}>{t('Mark all as read')}</Button>
        )}
      </div>

      <div className="notif-center-scroll">
        {loading ? (
          <NotificationSkeletons count={5} />
        ) : visible.length ? (
          <ul className="notif-list">
            <AnimatePresence initial>
              {visible.map((item, index) => (
                <NotificationSlimCard key={`${filter}-${item.id}`} item={item} index={index} selected={selected?.id === item.id} onClick={() => select(item)} />
              ))}
            </AnimatePresence>
          </ul>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={search ? t('No notifications match your search') : filter === 'unread' ? t('No unread notifications') : t('No notifications yet')} />
        )}
      </div>
    </section>
  )

  const detail = selected
    ? <Detail key={selected.id} item={selected} onToggleRead={() => void setRead(selected, !selected.read)} onBack={compact ? clearSelection : undefined} />
    : <div className="notif-detail-empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Select a notification to see the details')} /></div>

  return (
    <DashboardPage className="notification-center-page">
      <div className={`notif-center${compact ? ' is-compact' : ''}`}>
        {(!compact || !selected) && list}
        {(!compact || selected) && <section className="notif-center-detail">{detail}</section>}
      </div>
    </DashboardPage>
  )
}

export default NotificationCenterPage
