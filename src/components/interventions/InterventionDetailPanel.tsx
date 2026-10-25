import type { ReactNode } from 'react'
import { Button, Progress, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, CheckCircleFilled, ClockCircleFilled, EnvironmentOutlined, ExclamationCircleFilled, MinusCircleFilled, PhoneOutlined, SyncOutlined, VideoCameraOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import PlanOutcomeChips from '@/components/interventions/PlanOutcomeChips'
import { useLanguage } from '@/providers/LanguageProvider'
import { planStatusColor, type LivePlanItem } from '@/utils/liveDiagnosticPlan'
import '@/styles/intervention-detail.css'

const { Text, Title } = Typography
const SPRING = { type: 'spring', stiffness: 380, damping: 32 } as const

type Assignment = Record<string, unknown>
type EntryState = 'done' | 'active' | 'upcoming' | 'late'
type TimelineEntry = { key: string; title: string; subtitle?: string; date?: Date | null; state: EntryState; lines?: string[] }

export type InterventionDetailProps = {
  title: string
  area?: string
  executionMode?: 'single_session' | 'multi_step'
  live?: LivePlanItem
  /** Every assignment record for this intervention, including cancelled ones, so the history is complete. */
  assignments: Assignment[]
  /** The appointments booked against this intervention's assignments. */
  appointments?: Assignment[]
  onBack: () => void
  backLabel: string
}

const toDate = (value: unknown): Date | null => {
  if (!value) return null
  const date = typeof (value as { toDate?: () => Date }).toDate === 'function' ? (value as { toDate: () => Date }).toDate() : new Date(value as string)
  return Number.isNaN(date.getTime()) ? null : date
}
const formatDate = (date?: Date | null) => (date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const text = (value: unknown) => String(value ?? '').trim()
const norm = (value: unknown) => text(value).toLowerCase()
const isCancelled = (row: Assignment) => norm(row.status) === 'cancelled' || norm(row.assigneeStatus) === 'declined' || norm(row.participantStatus) === 'declined' || norm(row.participantCompletionStatus) === 'rejected'
const isDone = (row: Assignment) => norm(row.status) === 'completed' || norm(row.participantCompletionStatus) === 'confirmed'
const byCreated = (a: Assignment, b: Assignment) => (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0)

const APPOINTMENT_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: 'Awaiting SME', color: 'gold' },
  accepted: { label: 'Accepted', color: 'blue' },
  completed: { label: 'Completed', color: 'green' },
  cancelled: { label: 'Cancelled', color: 'red' },
}
const MEETING_ICON: Record<string, ReactNode> = { telephonic: <PhoneOutlined />, online: <VideoCameraOutlined />, in_person: <EnvironmentOutlined /> }
const MEETING_LABEL: Record<string, string> = { telephonic: 'Phone call', online: 'Online meeting', in_person: 'In person' }
const formatTime = (date?: Date | null) => (date ? date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '')

const ICON: Record<EntryState, ReactNode> = {
  done: <CheckCircleFilled />,
  active: <SyncOutlined />,
  upcoming: <MinusCircleFilled />,
  late: <ExclamationCircleFilled />,
}

/** One assignment's own story: assigned, scheduled, worked on, due, delivered, confirmed. */
const lifecycle = (row: Assignment, now: Date): TimelineEntry[] => {
  const key = text(row.id) || text(row.createdAt)
  const who = text(row.assigneeName) || 'the delivery owner'
  const actor = norm(row.deliveryActorType) === 'agent' ? 'agent' : 'facilitator'
  const entries: TimelineEntry[] = [{ key: `${key}-assigned`, title: 'Assigned', subtitle: `To ${who} (${actor})`, date: toDate(row.createdAt), state: 'done' }]
  const start = toDate(row.implementationDate)
  if (start) entries.push({ key: `${key}-start`, title: 'Implementation date', date: start, state: start.getTime() <= now.getTime() ? 'done' : 'upcoming' })
  if (isCancelled(row)) {
    entries.push({ key: `${key}-cancelled`, title: 'Cancelled or declined', date: toDate(row.updatedAt), state: 'late' })
    return entries
  }
  const progress = Number(row.progress) || 0
  const completedAt = toDate(row.completedAt)
  if (isDone(row)) {
    entries.push({ key: `${key}-delivered`, title: 'Delivered', date: completedAt || toDate(row.updatedAt), state: 'done' })
    entries.push({ key: `${key}-confirmed`, title: 'Confirmed by the SME', date: completedAt || toDate(row.updatedAt), state: 'done' })
    return entries
  }
  if (norm(row.status) === 'awaiting_confirmation') {
    entries.push({ key: `${key}-delivered`, title: 'Delivered', date: completedAt || toDate(row.updatedAt), state: 'done' })
    entries.push({ key: `${key}-await`, title: 'Awaiting SME confirmation', state: 'active' })
    return entries
  }
  if (progress > 0) entries.push({ key: `${key}-progress`, title: 'In progress', subtitle: `${progress}% complete`, date: toDate(row.updatedAt), state: 'active' })
  const due = toDate(row.dueDate)
  if (due) entries.push({ key: `${key}-due`, title: due.getTime() < now.getTime() ? 'Overdue' : 'Due', date: due, state: due.getTime() < now.getTime() ? 'late' : 'upcoming' })
  return entries
}

const buildTimeline = (props: InterventionDetailProps, now: Date): TimelineEntry[] => {
  const history = [...props.assignments].sort(byCreated)
  const entries: TimelineEntry[] = []

  if (props.executionMode === 'multi_step' && props.live?.stepRows.length) {
    props.live.stepRows.forEach((step, index) => {
      const row = history.filter(item => !isCancelled(item)).find(item => Number(item.stepIndex) === index || text(item.assignedStepTitle) === step.title)
      const lines = row ? [`${text(row.assigneeName) || 'Unassigned'}`, `Due ${formatDate(toDate(row.dueDate))}`] : ['Not assigned yet']
      const state: EntryState = step.state === 'completed' ? 'done' : step.state === 'delivered' || step.state === 'in_progress' ? 'active' : 'upcoming'
      entries.push({
        key: step.key,
        title: `Step ${index + 1}: ${step.title}`,
        subtitle: `${step.label}${step.state === 'in_progress' ? ` · ${step.progress}%` : ''} · ${step.share}% of the intervention`,
        date: row ? (state === 'done' ? toDate(row.completedAt) || toDate(row.updatedAt) : toDate(row.dueDate)) : null,
        state,
        lines,
      })
    })
  } else {
    const current = history.filter(item => !isCancelled(item))
    const rows = current.length ? history : []
    rows.forEach(row => entries.push(...lifecycle(row, now)))
    entries.sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity))
  }

  const outcome = props.live?.outcome
  if (outcome?.followUp && outcome.followUp.state !== 'done') {
    entries.push({ key: 'follow-up', title: 'Follow-up check', subtitle: outcome.followUp.state === 'overdue' ? 'Overdue' : 'Scheduled', date: outcome.followUp.dueAt, state: outcome.followUp.state === 'overdue' ? 'late' : 'upcoming' })
  }
  if (outcome?.result) {
    const label = outcome.result === 'achieved' ? 'Outcome achieved' : outcome.result === 'partially' ? 'Outcome partially achieved' : 'Outcome not yet achieved'
    entries.push({ key: 'result', title: label, subtitle: outcome.resultNote || undefined, state: outcome.result === 'achieved' ? 'done' : 'late' })
  }
  return entries
}

export default function InterventionDetailPanel(props: InterventionDetailProps) {
  const { t } = useLanguage()
  const reduced = useReducedMotion()
  const now = new Date()
  const { live, assignments } = props
  const timeline = buildTimeline(props, now)
  const stepOfAssignment = new Map(assignments.map(row => [text(row.id), text(row.assignedStepTitle)]))
  const appointments = [...(props.appointments || [])].sort((a, b) => (toDate(a.startTime)?.getTime() || 0) - (toDate(b.startTime)?.getTime() || 0))

  const live_ = assignments.filter(item => !isCancelled(item)).sort(byCreated)
  const current = live_.find(item => !isDone(item)) || live_[live_.length - 1]
  const actor = norm(current?.deliveryActorType) === 'agent' ? t('Agent') : t('Human')
  const hours = Number(current?.timeSpent) || 0
  const details: Array<[string, string]> = current ? [
    [t('Assignee'), `${text(current.assigneeName) || t('Unnamed')} (${actor})`],
    [t('Implementation date'), formatDate(toDate(current.implementationDate))],
    [t('Due date'), formatDate(toDate(current.dueDate))],
    [t('Target'), current.targetMetric ? `${Number(current.targetActual) || 0} / ${Number(current.targetValue) || 0} ${text(current.targetMetric)}` : '—'],
    [t('Time spent'), hours ? `${hours} h` : '—'],
    [t('Notes'), text(current.notes) || '—'],
  ] : []

  return (
    <motion.div className="id-panel" initial={reduced ? false : { opacity: 0, x: 32 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: 32 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={props.onBack} className="id-back">{props.backLabel}</Button>

      <div className="id-head">
        <div>
          <Title level={4} className="id-title">{props.title}</Title>
          <div className="id-tags">
            {props.area ? <Tag>{props.area}</Tag> : null}
            <Tag color={props.executionMode === 'multi_step' ? 'purple' : 'default'}>{props.executionMode === 'multi_step' ? `${t('Multi-step')} (${live?.totalSteps || 0})` : t('Single session')}</Tag>
            {live ? <Tag color={planStatusColor(live.status)}>{t(live.status)}</Tag> : null}
          </div>
        </div>
        <div className="id-progress">
          <Text type="secondary">{t('Progress')}</Text>
          <motion.div className="id-progress-value" key={live?.progress} initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>{live?.progress ?? 0}%</motion.div>
        </div>
      </div>
      <Progress percent={live?.progress ?? 0} status={live?.status === 'Completed' ? 'success' : 'active'} showInfo={false} />
      {live?.totalSteps && live.totalSteps > 1 ? <Text type="secondary">{live.completedSteps} {t('of')} {live.totalSteps} {t('steps completed')}</Text> : null}
      <PlanOutcomeChips outcome={live?.outcome} showIntended />

      <div className="id-grid">
        <section className="id-section">
          <Title level={5}>{t('Timeline')}</Title>
          {timeline.length ? (
            <ol className="id-timeline">
              {timeline.map((entry, index) => (
                <motion.li
                  key={entry.key}
                  className={`id-entry is-${entry.state}`}
                  initial={reduced ? false : { opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 10) * 0.05 }}
                >
                  <span className="id-node">{entry.state === 'upcoming' ? <ClockCircleFilled /> : ICON[entry.state]}</span>
                  <div className="id-entry-body">
                    <div className="id-entry-top">
                      <Text strong>{t(entry.title)}</Text>
                      {entry.date ? <Text type="secondary" className="id-entry-date">{formatDate(entry.date)}</Text> : null}
                    </div>
                    {entry.subtitle ? <Text type="secondary" className="id-entry-sub">{entry.subtitle}</Text> : null}
                    {entry.lines?.length ? <Text type="secondary" className="id-entry-sub">{entry.lines.join(' · ')}</Text> : null}
                  </div>
                </motion.li>
              ))}
            </ol>
          ) : <Text type="secondary">{t('Nothing has happened on this intervention yet.')}</Text>}
        </section>

        <section className="id-section">
          <Title level={5}>{t('Details')}</Title>
          {details.length ? (
            <dl className="id-fields">
              {details.map(([label, value]) => (
                <div key={label} className="id-field">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          ) : <Text type="secondary">{t('Not assigned yet.')}</Text>}
        </section>
        <section className="id-section id-appointments">
          <Title level={5}>{t('Appointments')} <Tag>{appointments.length}</Tag></Title>
          {appointments.length ? (
            <ul className="id-appointment-list">
              {appointments.map((appointment, index) => {
                const start = toDate(appointment.startTime)
                const end = toDate(appointment.endTime)
                const status = APPOINTMENT_STATUS[norm(appointment.status)] || { label: text(appointment.status) || 'Unknown', color: 'default' }
                const kind = norm(appointment.meetingType)
                const step = stepOfAssignment.get(text(appointment.assignedInterventionId))
                const where = kind === 'online' ? text(appointment.meetingLink) : kind === 'in_person' ? text(appointment.location) : ''
                const summary = text(appointment.discussionSummary)
                return (
                  <motion.li
                    key={text(appointment.id) || index}
                    className="id-appointment"
                    initial={reduced ? false : { opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 8) * 0.04 }}
                  >
                    <span className="id-appointment-icon">{MEETING_ICON[kind] || <ClockCircleFilled />}</span>
                    <div className="id-appointment-body">
                      <div className="id-entry-top">
                        <Text strong>{formatDate(start)}{start ? ` · ${formatTime(start)}${end ? `–${formatTime(end)}` : ''}` : ''}</Text>
                        <Tag color={status.color} style={{ marginInlineEnd: 0 }}>{t(status.label)}</Tag>
                      </div>
                      <Text type="secondary" className="id-entry-sub">
                        {[t(MEETING_LABEL[kind] || 'Meeting'), step ? `${t('Step')}: ${step}` : '', where].filter(Boolean).join(' · ')}
                      </Text>
                      {summary ? <Text className="id-entry-sub">{summary}</Text> : null}
                    </div>
                  </motion.li>
                )
              })}
            </ul>
          ) : <Text type="secondary">{t('No appointments booked for this intervention.')}</Text>}
        </section>
      </div>
    </motion.div>
  )
}
