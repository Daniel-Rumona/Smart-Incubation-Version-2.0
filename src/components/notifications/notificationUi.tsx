import {
  BellOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { AppNotification, NotificationTone } from '@/hooks/useNotifications'

export type NotificationFilter = 'all' | 'unread'

const TONE_ICON: Record<NotificationTone, ReactNode> = {
  danger: <WarningOutlined />,
  warning: <ClockCircleOutlined />,
  success: <CheckCircleOutlined />,
  info: <BellOutlined />,
}

export const notificationIcon = (item: AppNotification) => (/appointment|reschedul|meeting/i.test(item.type) ? <CalendarOutlined /> : TONE_ICON[item.tone])

/** Cards slide in one after another; with reduced motion they simply appear. */
export const useCardMotion = (index: number) => {
  const reduce = useReducedMotion()
  if (reduce) return {}
  return {
    layout: 'position' as const,
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, x: 16, transition: { duration: 0.12 } },
    transition: { duration: 0.26, delay: Math.min(index, 8) * 0.05, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  }
}

