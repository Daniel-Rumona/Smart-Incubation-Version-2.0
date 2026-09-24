import { useEffect, useState } from 'react'
import { Button } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled } from '@ant-design/icons'
import {
  AGENT_ACTION_EXECUTED_EVENT,
  AgentRequestError,
  cancelAgentProposal,
  confirmAgentProposal,
} from '@/services/agentService'
import type { AgentProposal, AgentProposalStatus } from '@/types/agent'
import '@/styles/agent-proposal.css'

type Props = {
  proposal: AgentProposal
  status: AgentProposalStatus
  note?: string
  onChange: (status: AgentProposalStatus, note?: string) => void
}

/**
 * Confirmation card for an action the assistant has prepared. The card only ever sends the
 * proposal id; the backend holds the validated details and performs the write on confirm.
 */
export const AgentProposalCard = ({ proposal, status, note, onChange }: Props) => {
  const [now, setNow] = useState(() => Date.now())
  const expiresAt = Date.parse(proposal.expiresAt)
  const expired = status === 'pending' && Number.isFinite(expiresAt) && now >= expiresAt

  useEffect(() => {
    if (status !== 'pending' || !Number.isFinite(expiresAt)) return
    const remaining = expiresAt - Date.now()
    if (remaining <= 0) return
    const timer = window.setTimeout(() => setNow(Date.now()), remaining + 250)
    return () => window.clearTimeout(timer)
  }, [status, expiresAt])

  const confirm = async () => {
    onChange('confirming')
    try {
      const result = await confirmAgentProposal(proposal.id)
      onChange('executed', result.reply)
      window.dispatchEvent(new CustomEvent(AGENT_ACTION_EXECUTED_EVENT, { detail: { tool: proposal.tool } }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'That action could not be completed.'
      // An HTTP answer means the server has decided (rejected or already used); no answer means retry is safe.
      onChange(error instanceof AgentRequestError ? 'failed' : 'pending', message)
    }
  }

  const cancel = async () => {
    onChange('confirming')
    try {
      await cancelAgentProposal(proposal.id)
      onChange('cancelled', 'Discarded — nothing was changed.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not discard that action.'
      onChange(error instanceof AgentRequestError ? 'failed' : 'pending', message)
    }
  }

  const busy = status === 'confirming'
  const resolved = status === 'executed' || status === 'cancelled' || status === 'failed' || expired

  return (
    <div className={`agent-proposal is-${expired ? 'expired' : status}`} role="group" aria-label={proposal.title}>
      <div className="agent-proposal-head">
        {status === 'executed' && <CheckCircleFilled />}
        {(status === 'failed' || status === 'cancelled') && <CloseCircleFilled />}
        {!resolved && <ExclamationCircleFilled />}
        <strong>{proposal.title}</strong>
        <span className="agent-proposal-tag">
          {status === 'executed' ? 'Done' : status === 'cancelled' ? 'Discarded' : status === 'failed' ? 'Not done' : expired ? 'Expired' : 'Needs your OK'}
        </span>
      </div>

      <dl className="agent-proposal-rows">
        {proposal.summary.map((row, index) => (
          row.value
            ? (
              <div key={`${row.label}-${index}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            )
            : <div key={`${row.label}-${index}`} className="is-section"><dt>{row.label}</dt></div>
        ))}
      </dl>

      {!resolved && proposal.warnings.length > 0 && (
        <ul className="agent-proposal-warnings">
          {proposal.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      {expired && <p className="agent-proposal-note">This expired. Ask again and I&apos;ll prepare it afresh.</p>}
      {note && !expired && <p className={`agent-proposal-note ${status === 'failed' ? 'is-error' : ''}`}>{note}</p>}

      {!resolved && (
        <div className="agent-proposal-actions">
          <Button type="primary" loading={busy} disabled={busy} onClick={() => void confirm()}>Confirm</Button>
          <Button disabled={busy} onClick={() => void cancel()}>Discard</Button>
        </div>
      )}
    </div>
  )
}
