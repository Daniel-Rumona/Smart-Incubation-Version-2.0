import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Empty, List, Modal, Space, Tag, Typography } from 'antd'
import { BellOutlined, ClockCircleOutlined, WarningOutlined } from '@ant-design/icons'
import { collection, doc, getDocs, limit, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import '@/styles/notifications.css'

dayjs.extend(relativeTime)

type StaffNotification = {
  id: string
  type: string
  title: string
  body: string
  link?: string
  counts?: { overdue?: number, dueSoon?: number }
  createdAt?: unknown
  read: boolean
}

const OPERATIONS_SIDE_ROLES = ['operations', 'projectadmin', 'projectmanager']

const toDayjs = (value: unknown) => {
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  return null
}

/** In-system inbox for operations-side staff (the overdue / near-due intervention digest lands here). */
export const StaffNotificationBell = () => {
  const { user } = useFullIdentity()
  const navigate = useNavigate()
  const [items, setItems] = useState<StaffNotification[]>([])
  const [open, setOpen] = useState(false)
  const enabled = !!user && OPERATIONS_SIDE_ROLES.includes(user.role)

  const load = useCallback(async () => {
    if (!user || !enabled) return
    try {
      const snapshot = await getDocs(query(collection(db, 'staffNotifications'), where('recipientUid', '==', user.uid), limit(30)))
      setItems(snapshot.docs.map((row) => {
        const data = row.data()
        return {
          id: row.id,
          type: String(data.type || ''),
          title: String(data.title || 'Notification'),
          body: String(data.body || ''),
          link: typeof data.link === 'string' ? data.link : undefined,
          counts: data.counts,
          createdAt: data.createdAt,
          read: Boolean(data.readAt),
        }
      }))
    } catch {
      setItems([])
    }
  }, [enabled, user])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const ordered = useMemo(() => [...items].sort((left, right) => {
    if (left.read !== right.read) return left.read ? 1 : -1
    return (toDayjs(right.createdAt)?.valueOf() || 0) - (toDayjs(left.createdAt)?.valueOf() || 0)
  }), [items])

  const unread = items.filter((item) => !item.read).length

  const markRead = async (item: StaffNotification) => {
    if (item.read) return
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read: true } : row)))
    await updateDoc(doc(db, 'staffNotifications', item.id), { readAt: serverTimestamp() }).catch(() => undefined)
  }

  const openItem = async (item: StaffNotification) => {
    await markRead(item)
    if (item.link) {
      setOpen(false)
      navigate(item.link)
    }
  }

  const markAll = async () => {
    await Promise.all(items.filter((item) => !item.read).map((item) => markRead(item)))
  }

  if (!enabled) return null

  return (
    <>
      <Button
        type="text"
        shape="circle"
        icon={<Badge count={unread} size="small"><BellOutlined /></Badge>}
        onClick={() => { setOpen(true); void load() }}
        className="app-icon-btn"
        aria-label="Notifications"
      />
      <Modal open={open} onCancel={() => setOpen(false)} title="Notifications" footer={null} className="notifications-modal">
        <div className="notifications-summary">
          <Typography.Text type="secondary">{unread ? `${unread} unread` : 'You are all caught up'}</Typography.Text>
          {unread > 0 && <Button type="link" size="small" onClick={() => void markAll()}>Mark all as read</Button>}
        </div>
        <List
          className="notifications-list"
          dataSource={ordered}
          locale={{ emptyText: <Empty description="No notifications yet" /> }}
          renderItem={(item) => (
            <List.Item className={`notification-item ${item.read ? 'is-read' : 'is-unread'}`} onClick={() => void openItem(item)} style={{ cursor: 'pointer' }}>
              <List.Item.Meta
                avatar={item.type === 'intervention_deadlines' && (item.counts?.overdue || 0) > 0 ? <WarningOutlined style={{ color: '#E07A7A', fontSize: 18 }} /> : <ClockCircleOutlined style={{ color: '#f59e0b', fontSize: 18 }} />}
                title={<Space wrap><Typography.Text strong>{item.title}</Typography.Text>{!item.read && <Tag color="purple" style={{ margin: 0 }}>New</Tag>}</Space>}
                description={(
                  <div>
                    <div style={{ whiteSpace: 'pre-line' }}>{item.body}</div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{toDayjs(item.createdAt)?.fromNow() || ''}</Typography.Text>
                  </div>
                )}
              />
            </List.Item>
          )}
        />
      </Modal>
    </>
  )
}

export default StaffNotificationBell
