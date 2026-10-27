import { Card, Progress, Skeleton, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, MinusOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import { USER_ROLE_LABELS, type UserRole } from '@/config/roles'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/admin-dashboard.css'

export type AdminKpiTrend = { amount: string; direction: 'up' | 'down' | 'flat'; tone: 'good' | 'bad' | 'neutral'; text: string }

/** A figure in a soft rounded card: icon disc, large number, optional change badge and a small chart on the right. */
export function AdminKpiTile({ icon, label, value, trend, note, loading, visual, compact }: {
  icon: ReactNode
  label: string
  /** Numbers get thousands separators; text (a duration, a page name) is shown as is. */
  value: ReactNode
  trend?: AdminKpiTrend
  /** A short line under the figure that says what it measures. */
  note?: ReactNode
  loading?: boolean
  /** Small chart beside the figure, e.g. monthly bars or a share ring. */
  visual?: ReactNode
  /** A slimmer card for rows of quick figures: less padding, smaller figure, one-line label. */
  compact?: boolean
}) {
  return (
    <Card className={compact ? 'admin-card admin-kpi is-compact' : 'admin-card admin-kpi'} bordered={false}>
      {loading ? <Skeleton active paragraph={{ rows: 1 }} /> : (
        <div className="admin-kpi-body">
          <div className="admin-kpi-copy">
            <Typography.Text className="admin-kpi-label">{label}</Typography.Text>
            <div className="admin-kpi-value-line">
              <span className="admin-kpi-icon">{icon}</span>
              <span className={typeof value === 'number' ? 'admin-kpi-value' : 'admin-kpi-value is-text'} title={typeof value === 'string' ? value : undefined}>{typeof value === 'number' ? value.toLocaleString() : value}</span>
              {trend && (
                <span className={`admin-kpi-trend is-${trend.tone}`} title={trend.text} aria-label={trend.text}>
                  {trend.direction === 'up' ? <ArrowUpOutlined /> : trend.direction === 'down' ? <ArrowDownOutlined /> : <MinusOutlined />}
                  {trend.amount}
                </span>
              )}
            </div>
            {note && <span className="admin-kpi-note">{note}</span>}
          </div>
          {visual}
        </div>
      )}
    </Card>
  )
}

/** Small labelled columns beside a KPI; the last one is drawn in the accent colour. */
export function AdminMiniBars({ bars }: { bars: Array<{ key: string | number; label: string; value: number }> }) {
  const max = Math.max(...bars.map((bar) => bar.value), 1)
  return (
    <div className="admin-kpi-bars" aria-hidden="true">
      {bars.map((bar, index) => (
        <div key={bar.key} className="admin-kpi-bar-col">
          <span className={index === bars.length - 1 ? 'admin-kpi-bar is-current' : 'admin-kpi-bar'} style={{ height: `${Math.max(8, (bar.value / max) * 100)}%` }} />
          <small>{bar.label}</small>
        </div>
      ))}
    </div>
  )
}

export function AdminRoleTag({ role }: { role: string }) {
  const { t } = useLanguage()
  const label = USER_ROLE_LABELS[role as UserRole]
  return <span className="admin-role-tag">{label ? t(label) : role || t('Unknown')}</span>
}

/** A value's share of a total, as a small ring beside a KPI. */
export function AdminShareRing({ value, total, muted, size = 58 }: { value: number; total: number; muted?: boolean; size?: number }) {
  const percent = total ? Math.min(100, Math.round((value / total) * 100)) : 0
  // A plain span for the label: at 100% antd would otherwise colour its own text green.
  return <Progress type="circle" size={size} percent={percent} strokeWidth={10} strokeColor={muted ? '#a99ffc' : '#6d5dfb'} trailColor="rgba(109, 93, 251, .14)" format={() => <span className="admin-share-ring-label">{percent}%</span>} />
}
