import { useEffect, useState } from 'react'
import { App, Button, Popconfirm, Tooltip } from 'antd'
import { CloseOutlined, EyeOutlined, FieldTimeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { stopAgentWatch } from '@/services/agentService'
import { subscribeMyAgentWatches, type AgentWatchSummary } from '@/services/agentWatchesService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/agent-watch.css'

type Props = {
  uid?: string
  /** Open the full list (running and finished). */
  onOpenAll: () => void
}

/**
 * The left column during a chat: the user's running watches and chasers, each with a stop button.
 * Shows nothing when none are running.
 */
export const AgentWatchRail = ({ uid, onOpenAll }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [watches, setWatches] = useState<AgentWatchSummary[]>([])
  const [stopping, setStopping] = useState<string | null>(null)

  useEffect(() => {
    if (!uid) return undefined
    return subscribeMyAgentWatches(uid, (rows) => setWatches(rows.filter((row) => row.status === 'active')), () => setWatches([]))
  }, [uid])

  if (!watches.length) return null

  const stop = async (watch: AgentWatchSummary) => {
    setStopping(watch.id)
    try {
      await stopAgentWatch(watch.id)
      message.success(watch.kind === 'chaser' ? t('Chaser stopped.') : t('Watch stopped.'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('That could not be completed.'))
    } finally {
      setStopping(null)
    }
  }

  const detail = (watch: AgentWatchSummary) => {
    if (watch.kind === 'chaser') {
      return [
        watch.total ? t('{done} of {total} {goal}', undefined, { done: watch.done ?? 0, total: watch.total, goal: watch.goal === 'completed' ? t('completed') : t('accepted') }) : null,
        watch.endsAt ? t('Due {date}', undefined, { date: dayjs(watch.endsAt).format('D MMM') }) : null,
      ].filter(Boolean).join(' · ')
    }
    return watch.endsAt ? t('Until {date}', undefined, { date: dayjs(watch.endsAt).format('D MMM') }) : t('Watching')
  }

  return (
    <aside className="agent-watch-rail" aria-label={t('Running watches and chasers')}>
      <header>
        <span>{t('Watching')}</span>
        <Button type="link" size="small" onClick={onOpenAll}>{t('See all')}</Button>
      </header>
      <ul>
        {watches.map((watch) => (
          <li key={watch.id} className={`is-${watch.kind}`}>
            <span className="agent-watch-rail-icon" aria-hidden="true">{watch.kind === 'chaser' ? <FieldTimeOutlined /> : <EyeOutlined />}</span>
            <Tooltip title={watch.request || undefined} placement="right">
              <div className="agent-watch-rail-copy">
                <strong>{watch.title}</strong>
                <small>{detail(watch)}</small>
                {watch.kind === 'chaser' && !!watch.total && (
                  <span className="agent-watch-rail-progress" aria-hidden="true">
                    <span style={{ width: `${Math.round(((watch.done ?? 0) / watch.total) * 100)}%` }} />
                  </span>
                )}
              </div>
            </Tooltip>
            <Popconfirm
              title={watch.kind === 'chaser' ? t('Stop this chaser? No more reminders will be sent.') : t('Stop this watch?')}
              okText={t('Stop')}
              cancelText={t('Keep')}
              placement="right"
              onConfirm={() => stop(watch)}
            >
              <Button
                type="text"
                size="small"
                className="agent-watch-rail-stop"
                icon={<CloseOutlined />}
                loading={stopping === watch.id}
                aria-label={t('Stop {name}', undefined, { name: watch.title })}
              />
            </Popconfirm>
          </li>
        ))}
      </ul>
    </aside>
  )
}
