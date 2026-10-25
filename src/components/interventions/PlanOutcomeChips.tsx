import { Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, FileDoneOutlined } from '@ant-design/icons'
import type { LivePlanOutcome } from '@/utils/liveDiagnosticPlan'
import { useLanguage } from '@/providers/LanguageProvider'

const shortDate = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Delivery and impact are different things: "Completed" says the work was delivered and confirmed. This shows what
 * followed from it: the deliverable received, the follow-up check, and the facilitator's verdict on the outcome.
 */
export const PlanOutcomeChips = ({ outcome, showIntended = false }: { outcome?: LivePlanOutcome; showIntended?: boolean }) => {
  const { t } = useLanguage()
  if (!outcome) return null

  const followUp = outcome.followUp
  return (
    <Space direction="vertical" size={6} style={{ width: '100%' }}>
      {showIntended && outcome.intendedOutcome && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{t('Intended outcome')}: {outcome.intendedOutcome}</Typography.Text>
      )}
      <Space wrap size={6}>
        {outcome.deliverableName && (
          outcome.deliverableReceived
            ? <Tag icon={<FileDoneOutlined />} color="green">{outcome.deliverableName}: {t('received')}</Tag>
            : <Tag icon={<FileDoneOutlined />} color={outcome.deliverableRequired ? 'orange' : 'default'}>{outcome.deliverableName}: {t('not uploaded yet')}</Tag>
        )}
        {outcome.result ? (
          <Tag
            icon={outcome.result === 'achieved' ? <CheckCircleOutlined /> : <ExclamationCircleOutlined />}
            color={outcome.result === 'achieved' ? 'green' : outcome.result === 'partially' ? 'gold' : 'orange'}
          >
            {outcome.result === 'achieved' ? t('Outcome achieved') : outcome.result === 'partially' ? t('Outcome partially achieved') : t('Outcome not yet achieved')}
          </Tag>
        ) : null}
        {followUp && followUp.state !== 'done' && (
          <Tag icon={<ClockCircleOutlined />} color={followUp.state === 'overdue' ? 'red' : followUp.state === 'due_soon' ? 'gold' : 'blue'}>
            {followUp.state === 'overdue' ? t('Follow-up overdue') : t('Follow-up due')} {shortDate(followUp.dueAt)}
          </Tag>
        )}
        {followUp?.state === 'done' && <Tag icon={<CheckCircleOutlined />} color="green">{t('Follow-up done')}</Tag>}
      </Space>
    </Space>
  )
}

export default PlanOutcomeChips
