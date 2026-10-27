import { useCallback, useEffect, useMemo, useState } from 'react'
import { collection, doc, getDocs, limit, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { loadIncubateeWorkspace, markIncubateeNotification } from '@/services/incubateeWorkspaceService'

export type NotificationTone = 'danger' | 'warning' | 'success' | 'info'

export type AppNotification = {
  id: string
  source: 'staff' | 'incubatee'
  type: string
  title: string
  /** Full text. Staff digests are multi-line; SME notifications are title-only. */
  body: string
  link?: string
  createdAt: Dayjs | null
  read: boolean
  tone: NotificationTone
}

dayjs.extend(relativeTime)

// Consultants get the follow-up reminders from functions/src/followUps.ts in the same collection.
const STAFF_ROLES = ['operations', 'projectadmin', 'projectmanager', 'consultant']
const CHANGED_EVENT = 'app-notifications-changed'

export const isStaffNotificationRole = (role?: string) => !!role && STAFF_ROLES.includes(role)
export const hasNotificationInbox = (role?: string) => role === 'incubatee' || isStaffNotificationRole(role)

const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string | number | Date)
  return parsed.isValid() ? parsed : null
}

export const describeType = (type?: string) => {
  if (!type) return ''
  const label = type.replaceAll('_', ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

const incubateeTone = (type: string): NotificationTone => {
  if (/overdue|declin|reject|fail|missing|expired/i.test(type)) return 'danger'
  if (/appointment|due|reminder|pending|awaiting|reschedul/i.test(type)) return 'warning'
  if (/accept|approv|complete|verified|confirm/i.test(type)) return 'success'
  return 'info'
}

/** First meaningful line plus how many more there are, e.g. "Compliance Review (Acme): 3 days overdue  +2 more". */
export const previewOf = (item: AppNotification): { text: string, more: number } => {
  const lines = item.body.split('\n').map((line) => line.trim()).filter(Boolean)
  if (!lines.length) return { text: describeType(item.type), more: 0 }
  return { text: lines[0], more: lines.length - 1 }
}

const write = async (item: AppNotification, read: boolean) => {
  if (item.source === 'incubatee') await markIncubateeNotification(item.id, read)
  else await updateDoc(doc(db, 'staffNotifications', item.id), { readAt: read ? serverTimestamp() : null })
}

const notifyChanged = () => window.dispatchEvent(new Event(CHANGED_EVENT))

/**
 * One inbox for whoever is signed in: the operations-side digest for staff, the participant feed for SMEs.
 * Every consumer (bell, center page) reloads when any of them changes a notification.
 */
export const useNotifications = () => {
  const { user } = useFullIdentity()
  const [items, setItems] = useState<AppNotification[]>([])
  const [loading, setLoading] = useState(true)
  const enabled = !!user && hasNotificationInbox(user.role)

  const load = useCallback(async () => {
    if (!user || !enabled) { setItems([]); setLoading(false); return }
    try {
      if (user.role === 'incubatee') {
        // Marketplace-only SMEs do not have an accepted programme application, so their
        // workspace is intentionally absent. Their inbox must not depend on that workspace.
        // New notifications are addressed directly to the signed-in account; retain the
        // workspace feed as a fallback for older programme notifications.
        const [workspaceResult, addressedResult] = await Promise.allSettled([
          loadIncubateeWorkspace(user),
          getDocs(query(collection(db, 'notifications'), where('recipientUid', '==', user.uid), limit(50))),
        ])
        const rows = new Map<string, { id: string, type?: string, title?: string, message?: unknown, createdAt?: unknown, read?: boolean, readBy?: Record<string, unknown>, recipientRoles?: unknown }>()
        if (workspaceResult.status === 'fulfilled') {
          workspaceResult.value?.notifications.forEach((row) => rows.set(row.id, row))
        }
        if (addressedResult.status === 'fulfilled') {
          addressedResult.value.docs.forEach((document) => {
            const data = document.data()
            const recipientRoles = data.recipientRoles
            if (Array.isArray(recipientRoles) && !recipientRoles.includes('incubatee')) return
            rows.set(document.id, {
              id: document.id,
              type: typeof data.type === 'string' ? data.type : '',
              title: String(typeof data.message === 'object' && data.message !== null ? data.title || 'Notification' : data.title || data.message || 'Notification'),
              createdAt: data.createdAt,
              read: data.readBy?.incubatee === true,
            })
          })
        }
        setItems([...rows.values()].map((row) => ({
          id: row.id,
          source: 'incubatee' as const,
          type: row.type || '',
          title: row.title || 'Notification',
          body: '',
          createdAt: toDay(row.createdAt),
          read: row.read === true,
          tone: incubateeTone(row.type || ''),
        })))
      } else {
        const snapshot = await getDocs(query(collection(db, 'staffNotifications'), where('recipientUid', '==', user.uid), limit(50)))
        setItems(snapshot.docs.map((row) => {
          const data = row.data()
          const overdue = Number(data.counts?.overdue || 0)
          const type = String(data.type || '')
          return {
            id: row.id,
            source: 'staff' as const,
            type,
            title: String(data.title || 'Notification'),
            body: String(data.body || ''),
            link: typeof data.link === 'string' ? data.link : undefined,
            createdAt: toDay(data.createdAt),
            read: Boolean(data.readAt),
            tone: overdue > 0 ? 'danger' as const : type.includes('deadline') ? 'warning' as const : 'info' as const,
          }
        }))
      }
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [enabled, user])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  useEffect(() => {
    const handler = () => void load()
    window.addEventListener(CHANGED_EVENT, handler)
    return () => window.removeEventListener(CHANGED_EVENT, handler)
  }, [load])

  const setRead = useCallback(async (item: AppNotification, read: boolean) => {
    if (item.read === read) return
    setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read } : row)))
    try {
      await write(item, read)
      notifyChanged()
    } catch {
      setItems((current) => current.map((row) => (row.id === item.id ? { ...row, read: item.read } : row)))
    }
  }, [])

  const markAllRead = useCallback(async (rows: AppNotification[]) => {
    const unread = rows.filter((row) => !row.read)
    if (!unread.length) return
    const ids = new Set(unread.map((row) => row.id))
    setItems((current) => current.map((row) => (ids.has(row.id) ? { ...row, read: true } : row)))
    try {
      await Promise.all(unread.map((row) => write(row, true)))
      notifyChanged()
    } catch {
      void load()
    }
  }, [load])

  // Unread first, newest first inside each group, so what needs attention is never below the fold.
  const ordered = useMemo(() => [...items].sort((left, right) => {
    if (left.read !== right.read) return left.read ? 1 : -1
    return (right.createdAt?.valueOf() || 0) - (left.createdAt?.valueOf() || 0)
  }), [items])

  return {
    enabled,
    loading,
    items: ordered,
    unread: items.filter((item) => !item.read).length,
    reload: load,
    setRead,
    markAllRead,
  }
}
