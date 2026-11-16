import { useEffect, useState } from 'react'
import { App, Button, Empty, Popconfirm, Segmented, Skeleton } from 'antd'
import { ClockCircleOutlined, EyeOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { stopAgentWatch } from '@/services/agentService'
import { subscribeMyAgentWatches, type AgentWatchSummary } from '@/services/agentWatchesService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/agent-watch.css'

type Props = {
  open: boolean
  uid?: string
  onClose: () => void
  /** Put an example request in the composer so the user can start a new watch or chaser. */
  /** Example requests built from the workspace's own data (see agentWatchExamples.ts). */
  examples: Array<{ text: string, kind: 'watch' | 'chaser' }>
  onStartExample: (example: { text: string, kind: 'watch' | 'chaser' }) => void
}

/** The user's watches and chasers: what is running, how far each chaser has got, and a way to stop one. */
export const AgentWatchesModal = ({ open, uid, onClose, examples, onStartExample }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [watches, setWatches] = useState<AgentWatchSummary[] | null>(null)
  const [view, setView] = useState<'active' | 'finished'>('active')
  const [stopping, setStopping] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !uid) return undefined
    setWatches(null)
    return subscribeMyAgentWatches(uid, setWatches, () => setWatches([]))
  }, [open, uid])

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

  const statusLabel = (status: AgentWatchSummary['status']) => ({
    active: t('Active'), done: t('Done'), stopped: t('Stopped'), expired: t('Ended'),
  })[status]

  const shown = (watches || []).filter((watch) => (view === 'active') === (watch.status === 'active'))


  return (
    <ResponsiveModal open={open} onClose={onClose} title={t('Watches and chasers')} width={620}>
      <div className="agent-watches">
        <p className="agent-watches-intro">
          {t('Ask me in plain words to watch for something or to chase a list of interventions. I check every night and post what I find in this chat.')}
        </p>
        <Segmented
          value={view}
          onChange={(value) => setView(value as 'active' | 'finished')}
          options={[{ value: 'active', label: t('Running') }, { value: 'finished', label: t('Finished') }]}
        />
        {watches === null ? (
          <Skeleton active paragraph={{ rows: 3 }} />
        ) : shown.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={view === 'active' ? t('Nothing running yet.') : t('Nothing finished yet.')} />
        ) : (
          <ul className="agent-watches-list">
            {shown.map((watch) => (
              <li key={watch.id}>
                <span className={`agent-watches-icon is-${watch.kind}`} aria-hidden="true">
                  {watch.kind === 'chaser' ? <ClockCircleOutlined /> : <EyeOutlined />}
                </span>
                <div className="agent-watches-copy">
                  <strong>{watch.title}</strong>
                  {watch.request && <span className="agent-watches-request">“{watch.request}”</span>}
                  <small>
                    {[
                      watch.kind === 'chaser' ? t('Chaser') : t('Watch'),
                      statusLabel(watch.status),
                      watch.kind === 'chaser' && watch.total
                        ? t('{done} of {total} {goal}', undefined, { done: watch.done ?? 0, total: watch.total, goal: watch.goal === 'completed' ? t('completed') : t('accepted') })
                        : null,
                      watch.endsAt ? (watch.kind === 'chaser' ? t('Due {date}', undefined, { date: dayjs(watch.endsAt).format('D MMM') }) : t('Until {date}', undefined, { date: dayjs(watch.endsAt).format('D MMM YYYY') })) : null,
                      watch.lastRunAt ? t('Last checked {date}', undefined, { date: dayjs(watch.lastRunAt).format('D MMM, HH:mm') }) : t('Not checked yet'),
                    ].filter(Boolean).join(' · ')}
                  </small>
                </div>
                {watch.status === 'active' && (
                  <Popconfirm
                    title={watch.kind === 'chaser' ? t('Stop this chaser? No more reminders will be sent.') : t('Stop this watch?')}
                    okText={t('Stop')}
                    cancelText={t('Keep')}
                    onConfirm={() => stop(watch)}
                  >
                    <Button size="small" loading={stopping === watch.id}>{t('Stop')}</Button>
                  </Popconfirm>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="agent-watches-examples">
          <span>{t('Try asking')}</span>
          {examples.map((example) => (
            <button key={example.text} type="button" onClick={() => onStartExample(example)}>{example.text}</button>
          ))}
        </div>
      </div>
    </ResponsiveModal>
  )
}
