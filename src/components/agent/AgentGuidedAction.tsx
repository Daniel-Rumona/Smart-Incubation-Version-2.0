import { Avatar, Button, DatePicker, Drawer, Form, Grid, Input, Modal, Segmented, Select, Skeleton, Switch, Tag, TimePicker, Typography } from 'antd'
import { ArrowLeftOutlined, LeftOutlined, RightOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import type { AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { loadAgentFormData, type AgentFormOwner, type AgentFormSme } from '@/services/agentFormDataService'
import { useLanguage } from '@/providers/LanguageProvider'
import { initialsOf } from '@/utils/initials'
import '@/styles/agent-guided-action.css'

export type GuidedActionKind = 'appointment' | 'assignment'

type Props = {
  kind: GuidedActionKind | null
  assignments: AssignedIntervention[]
  onClose: () => void
  /** `prompt` carries every picked value to the agent; `display` is the short line shown in the chat. */
  onSubmit: (prompt: string, display: string) => void
}

type FormValues = {
  interventionId?: string
  ownerId?: string
  dueDate?: Dayjs
  withAppointment?: boolean
  date?: Dayjs
  time?: Dayjs
  duration?: number
  meetingType?: 'online' | 'telephonic' | 'in_person'
  meetingLink?: string
  location?: string
}

const CLOSED_STATUSES = ['completed', 'cancelled', 'canceled', 'declined', 'rejected']
const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()
const isActiveHumanAssignment = (item: AssignedIntervention) => {
  const raw = item as AssignedIntervention & { deliveryActorType?: string, participantCompletionStatus?: string }
  return !CLOSED_STATUSES.includes(normalize(item.status))
    && normalize(raw.participantCompletionStatus) !== 'confirmed'
    && normalize(raw.deliveryActorType) !== 'agent'
    && normalize(item.assigneeType) !== 'agent'
}

const DURATIONS = [30, 45, 60, 90, 120]

export const AgentGuidedAction = ({ kind, assignments, onClose, onSubmit }: Props) => {
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const screens = Grid.useBreakpoint()
  const isMobile = !screens.md
  const [form] = Form.useForm<FormValues>()
  const [loading, setLoading] = useState(false)
  const [smes, setSmes] = useState<AgentFormSme[]>([])
  const [owners, setOwners] = useState<AgentFormOwner[]>([])
  const [step, setStep] = useState<'sme' | 'details'>('sme')
  const [search, setSearch] = useState('')
  const [index, setIndex] = useState(0)
  const [direction, setDirection] = useState(1)
  const [selected, setSelected] = useState<AgentFormSme>()
  const meetingType = Form.useWatch('meetingType', form)
  const withAppointment = Form.useWatch('withAppointment', form)

  const open = kind !== null

  useEffect(() => {
    if (!kind || !user) return
    let cancelled = false
    setStep('sme')
    setSearch('')
    setIndex(0)
    setSelected(undefined)
    form.resetFields()
    setLoading(true)
    void loadAgentFormData(user)
      .then((data) => { if (!cancelled) { setSmes(data.smes); setOwners(data.owners) } })
      .catch(() => { if (!cancelled) { setSmes([]); setOwners([]) } })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kind, user, form])

  const activeAssignmentsBySme = useMemo(() => {
    const map = new Map<string, AssignedIntervention[]>()
    assignments.filter(isActiveHumanAssignment).forEach((item) => {
      const key = String(item.participantId || '')
      if (key) map.set(key, [...(map.get(key) || []), item])
    })
    return map
  }, [assignments])

  const candidates = useMemo(() => {
    const pool = kind === 'appointment' ? smes.filter((sme) => activeAssignmentsBySme.has(sme.id)) : smes
    const needle = normalize(search)
    return needle ? pool.filter((sme) => normalize(`${sme.name} ${sme.programName || ''} ${sme.sector || ''}`).includes(needle)) : pool
  }, [activeAssignmentsBySme, kind, search, smes])

  const safeIndex = candidates.length ? Math.min(index, candidates.length - 1) : 0
  const current = candidates[safeIndex]

  const move = (delta: number) => {
    if (candidates.length < 2) return
    setDirection(delta)
    setIndex((safeIndex + delta + candidates.length) % candidates.length)
  }

  const choose = () => {
    if (!current) return
    setSelected(current)
    form.resetFields()
    form.setFieldsValue({ meetingType: 'online', duration: 60, withAppointment: false })
    if (kind === 'appointment') {
      const options = activeAssignmentsBySme.get(current.id) || []
      if (options.length === 1) form.setFieldValue('interventionId', options[0].id)
    } else if (current.requiredInterventions.length === 1) {
      form.setFieldValue('interventionId', current.requiredInterventions[0].id)
    }
    setDirection(1)
    setStep('details')
  }

  const interventionOptions = useMemo(() => {
    if (!selected) return []
    if (kind === 'appointment') {
      return (activeAssignmentsBySme.get(selected.id) || []).map((item) => ({
        value: item.id,
        label: `${item.interventionTitle || 'Intervention'}${item.assigneeName ? ` · ${item.assigneeName}` : ''}`,
      }))
    }
    return selected.requiredInterventions.map((item) => ({ value: item.id, label: item.title }))
  }, [activeAssignmentsBySme, kind, selected])

  const slotText = (values: FormValues) => {
    const start = dayjs(`${values.date!.format('YYYY-MM-DD')} ${values.time!.format('HH:mm')}`)
    const end = start.add(values.duration || 60, 'minute')
    const meeting = [
      `Meeting type: ${values.meetingType}`,
      values.meetingLink?.trim() ? `Meeting link: ${values.meetingLink.trim()}` : '',
      values.location?.trim() ? `Location: ${values.location.trim()}` : '',
    ].filter(Boolean).join('. ')
    return { start, text: `Start: ${start.format('YYYY-MM-DDTHH:mm')}. End: ${end.format('YYYY-MM-DDTHH:mm')}. ${meeting}.`, label: start.format('ddd D MMM, HH:mm') }
  }

  const submit = (values: FormValues) => {
    if (!selected) return
    if (kind === 'appointment') {
      const assignment = assignments.find((item) => item.id === values.interventionId)
      const title = assignment?.interventionTitle || 'the intervention'
      const slot = slotText(values)
      onSubmit(
        `Schedule an appointment with the details I picked in the form, and prepare it for my confirmation. SME: ${selected.name} (participantId ${selected.id}). Intervention: ${title} (assignmentId ${values.interventionId}). ${slot.text}`,
        `Schedule an appointment for ${selected.name} – ${title}, ${slot.label}`,
      )
    } else {
      const intervention = selected.requiredInterventions.find((item) => item.id === values.interventionId)
      const owner = owners.find((item) => item.id === values.ownerId)
      const parts = [
        `Assign an intervention with the details I picked in the form, and prepare it for my confirmation. SME: ${selected.name} (participantId ${selected.id}). Intervention: ${intervention?.title} (interventionId ${intervention?.id}). Delivery owner: ${owner?.name} (assigneeId ${owner?.id}).`,
        values.dueDate ? `Due date: ${values.dueDate.format('YYYY-MM-DD')}.` : '',
        values.withAppointment ? `First appointment — ${slotText(values).text}` : '',
      ].filter(Boolean)
      onSubmit(parts.join(' '), `Assign ${intervention?.title} to ${owner?.name} for ${selected.name}${values.withAppointment ? ` with a first appointment on ${slotText(values).label}` : ''}`)
    }
    onClose()
  }

  const appointmentFields = (
    <>
      <div className="agent-guided-row">
        <Form.Item name="date" label={t('Date')} rules={[{ required: true, message: t('Pick a date.') }]}>
          <DatePicker style={{ width: '100%' }} disabledDate={(day) => day.isBefore(dayjs().startOf('day'))} inputReadOnly={isMobile} />
        </Form.Item>
        <Form.Item name="time" label={t('Start time')} rules={[{ required: true, message: t('Pick a start time.') }]}>
          <TimePicker style={{ width: '100%' }} format="HH:mm" minuteStep={5} needConfirm={false} inputReadOnly={isMobile} />
        </Form.Item>
      </div>
      <Form.Item name="duration" label={t('Duration')}>
        <Segmented block options={DURATIONS.map((value) => ({ value, label: `${value} min` }))} />
      </Form.Item>
      <Form.Item name="meetingType" label={t('How will you meet?')}>
        <Segmented block options={[{ value: 'online', label: t('Online') }, { value: 'telephonic', label: t('Phone call') }, { value: 'in_person', label: t('In person') }]} />
      </Form.Item>
      {meetingType === 'online' && (
        <Form.Item name="meetingLink" label={t('Meeting link (optional)')} rules={[{ pattern: /^https?:\/\//i, message: t('The link must start with http:// or https://') }]}>
          <Input placeholder="https://" />
        </Form.Item>
      )}
      {meetingType === 'in_person' && (
        <Form.Item name="location" label={t('Location')} rules={[{ required: true, message: t('Where will you meet?') }]}>
          <Input />
        </Form.Item>
      )}
    </>
  )

  const smeStep = (
    <div className="agent-guided-step">
      <Input allowClear prefix={<SearchOutlined />} value={search} placeholder={t('Search SMEs')} onChange={(event) => { setSearch(event.target.value); setIndex(0) }} />
      {loading ? (
        <div className="agent-guided-carousel"><Skeleton.Avatar active size={96} /></div>
      ) : current ? (
        <>
          <div className="agent-guided-carousel">
            <Button shape="circle" icon={<LeftOutlined />} onClick={() => move(-1)} disabled={candidates.length < 2} aria-label={t('Previous SME')} />
            <div className="agent-guided-stage">
              <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                  key={current.id}
                  className="agent-guided-sme-card"
                  initial={{ opacity: 0, x: direction * 36 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: direction * -36 }}
                  transition={{ duration: 0.16 }}
                >
                  <Avatar size={96} src={current.imageUrl}>{initialsOf(current.name)}</Avatar>
                  <Typography.Title level={4}>{current.name}</Typography.Title>
                  <div className="agent-guided-tags">
                    {current.programName && <Tag>{current.programName}</Tag>}
                    {current.sector && <Tag>{current.sector}</Tag>}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
            <Button shape="circle" icon={<RightOutlined />} onClick={() => move(1)} disabled={candidates.length < 2} aria-label={t('Next SME')} />
          </div>
          <Typography.Text type="secondary" className="agent-guided-count">{safeIndex + 1} / {candidates.length}</Typography.Text>
          <Button type="primary" size="large" block onClick={choose}>{t('Select')}</Button>
        </>
      ) : (
        <div className="agent-guided-empty">
          {search
            ? t('No SMEs match your search.')
            : kind === 'appointment'
              ? t('No SME has an active assignment to schedule an appointment for yet.')
              : t('No SME has a confirmed plan ready for an intervention assignment.')}
        </div>
      )}
    </div>
  )

  const detailsStep = selected && (
    <Form form={form} layout="vertical" requiredMark={false} onFinish={submit} className="agent-guided-step">
      <button type="button" className="agent-guided-chosen" onClick={() => { setDirection(-1); setStep('sme') }}>
        <Avatar size={36} src={selected.imageUrl}>{initialsOf(selected.name)}</Avatar>
        <span><strong>{selected.name}</strong><small>{t('Change SME')}</small></span>
        <ArrowLeftOutlined />
      </button>
      <Form.Item name="interventionId" label={t('Intervention')} rules={[{ required: true, message: t('Choose an intervention.') }]}>
        <Select showSearch optionFilterProp="label" options={interventionOptions} placeholder={t('Choose an intervention')} />
      </Form.Item>
      {kind === 'assignment' && (
        <>
          <Form.Item name="ownerId" label={t('Delivery owner')} rules={[{ required: true, message: t('Choose who will deliver it.') }]}>
            <Select showSearch optionFilterProp="label" placeholder={t('Choose a team member')} options={owners.map((owner) => ({ value: owner.id, label: `${owner.name}${owner.id === user?.uid ? ` (${t('Me')})` : ''}` }))} />
          </Form.Item>
          <Form.Item name="dueDate" label={t('Due date (optional)')}>
            <DatePicker style={{ width: '100%' }} disabledDate={(day) => day.isBefore(dayjs().startOf('day'))} inputReadOnly={isMobile} />
          </Form.Item>
          <Form.Item name="withAppointment" label={t('Add a first appointment')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </>
      )}
      {(kind === 'appointment' || withAppointment) && appointmentFields}
      <Button type="primary" size="large" block htmlType="submit">{t('Prepare with the agent')}</Button>
    </Form>
  )

  const title: ReactNode = kind === 'appointment' ? t('Schedule an appointment') : t('Assign an intervention')
  const body = (
    <AnimatePresence mode="wait" initial={false} custom={direction}>
      <motion.div
        key={step}
        initial={{ opacity: 0, x: direction * 28 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: direction * -28 }}
        transition={{ duration: 0.18 }}
      >
        {step === 'sme' ? smeStep : detailsStep}
      </motion.div>
    </AnimatePresence>
  )

  return isMobile ? (
    <Drawer open={open} onClose={onClose} placement="bottom" height="auto" title={title} destroyOnHidden className="agent-guided-drawer" styles={{ body: { maxHeight: '78dvh', overflowY: 'auto' } }}>
      {body}
    </Drawer>
  ) : (
    <Modal open={open} onCancel={onClose} footer={null} title={title} width={520} centered destroyOnHidden className="agent-guided-modal">
      {body}
    </Modal>
  )
}
