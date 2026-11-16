import { useState, type ReactNode } from 'react'
import { App, Button } from 'antd'
import {
  BellOutlined,
  CheckCircleFilled,
  ClockCircleOutlined,
  EyeOutlined,
  FlagOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { answerAgentEscalation } from '@/services/agentService'
import type { AgentWatchCard, AgentWatchCardItem } from '@/types/agent'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/agent-watch.css'

type Props = {
  card: AgentWatchCard
}

const ICONS: Record<AgentWatchCard['type'], ReactNode> = {
  watch_fired: <EyeOutlined />,
  chaser_progress: <ClockCircleOutlined />,
  chaser_done: <CheckCircleFilled />,
  chaser_escalation: <FlagOutlined />,
  watch_ended: <StopOutlined />,
}

/**
 * A card the nightly watch run posted into the chat. A chaser's escalation card asks the user to choose;
 * the answer is applied by the backend, which also stamps it on this card (seen through the live chat).
 */
export const AgentWatchCardView = ({ card }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [busy, setBusy] = useState<'escalate' | 'decline' | null>(null)
  const [answered, setAnswered] = useState<AgentWatchCard['response']>()
  const response = card.response || answered

  const answer = async (decision: 'escalate' | 'decline') => {
    setBusy(decision)
    try {
      const result = await answerAgentEscalation(card.watchId, decision)
      setAnswered(decision === 'escalate' ? 'escalated' : 'declined')
      message.success(result.reply)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('That could not be completed.'))
    } finally {
      setBusy(null)
    }
  }

  const stateLabel = (state?: AgentWatchCardItem['state']) => {
    if (state === 'done') return t('Done')
    if (state === 'nudged') return t('Reminded')
    if (state === 'stuck') return t('Out of reminders')
    if (state === 'waiting') return t('Waiting')
    return null
  }

  return (
    <div className={`agent-watch-card is-${card.type}`}>
      <div className="agent-watch-card-head">
        <span className="agent-watch-card-icon" aria-hidden="true">{ICONS[card.type] || <BellOutlined />}</span>
        <div>
          <span className="agent-watch-card-kind">{card.type === 'watch_fired' || card.type === 'watch_ended' ? t('Watch') : t('Chaser')}</span>
          <strong>{card.title}</strong>
        </div>
      </div>
      {card.body && <p className="agent-watch-card-body">{card.body}</p>}
      {!!card.items?.length && (
        <ul className="agent-watch-card-items">
          {card.items.map((item, index) => (
            <li key={`${item.label}-${index}`} className={item.state ? `is-${item.state}` : undefined}>
              <span className="agent-watch-card-dot" aria-hidden="true" />
              <span className="agent-watch-card-copy">
                <span>{item.label}</span>
                {item.detail && <small>{item.detail}</small>}
              </span>
              {stateLabel(item.state) && <span className="agent-watch-card-state">{stateLabel(item.state)}</span>}
            </li>
          ))}
        </ul>
      )}
      {card.type === 'chaser_escalation' && (
        response
          ? <div className="agent-watch-card-answer">
            {response === 'escalated' ? t('Escalated to the programme leads.') : t('Not escalated. Chasing continues until the deadline.')}
          </div>
          : <div className="agent-watch-card-actions">
            <Button onClick={() => void answer('decline')} loading={busy === 'decline'} disabled={Boolean(busy)}>{t('Not now')}</Button>
            <Button type="primary" icon={<FlagOutlined />} onClick={() => void answer('escalate')} loading={busy === 'escalate'} disabled={Boolean(busy)}>
              {t('Escalate to programme lead')}
            </Button>
          </div>
      )}
    </div>
  )
}
