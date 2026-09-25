import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, DatePicker, Input, List, Modal, Radio, Skeleton, Space, Tag, Typography } from 'antd'
import { CalendarOutlined } from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import type { Dayjs } from 'dayjs'
import { getFirebaseDb } from '@/config/firebase'
import { formatSpan, meetingTypeLabel, toDayjs, type MeetingType } from '@/components/interventions/appointmentSchedule'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
  getAppointmentRsvpContext,
  respondToAppointment,
  type AppointmentRsvpContext,
  type DeclineReasonCode,
} from '@/services/agentService'
import type { IncubateeWorkspace } from '@/types/incubatee'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type Invitation = {
  id: string
  title: string
  startTime: unknown
  endTime: unknown
  meetingType?: MeetingType
  location?: string
  meetingLink?: string
}

const CHUNK = 30 // Firestore `in` limit

const OTHER_OPTION = { code: 'other' as DeclineReasonCode, get label() { return tr('Another reason') }, proposeTime: true }

/**
 * Appointments that operations or a consultant has scheduled and the SME has not answered yet.
 * Accepting is one tap. Declining asks for a reason; the SME can suggest another time, or, before
 * any session has been held, say they no longer need the intervention (operations then confirms).
 * Writes go through the backend because SMEs cannot write appointments directly.
 */
export const AppointmentInvitations = ({ workspace, onChanged }: { workspace: IncubateeWorkspace, onChanged?: () => void }) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const companyCode = user?.companyCode
  const [invitations, setInvitations] = useState<Invitation[]>()
  const [busyId, setBusyId] = useState<string>()
  const [declining, setDeclining] = useState<Invitation>()

  const assignmentIds = useMemo(() => workspace.assignedInterventions
    .filter((item) => !item.agentId && !item.id.startsWith('unassigned-'))
    .map((item) => item.id), [workspace.assignedInterventions])

  const load = useCallback(async () => {
    if (!assignmentIds.length) {
      setInvitations([])
      return
    }
    try {
      const db = getFirebaseDb()
      const rows: Invitation[] = []
      for (let index = 0; index < assignmentIds.length; index += CHUNK) {
        const snapshot = await getDocs(query(
          collection(db, 'appointments'),
          where('assignedInterventionId', 'in', assignmentIds.slice(index, index + CHUNK)),
          ...(companyCode ? [where('companyCode', '==', companyCode)] : []),
        ))
        snapshot.docs.forEach((row) => {
          const data = row.data() as Record<string, unknown>
          if (String(data.status || 'pending') !== 'pending') return
          const start = toDayjs(data.startTime)
          if (!start || start.isBefore(new Date())) return
          rows.push({
            id: row.id,
            title: String(data.interventionTitle || 'Appointment'),
            startTime: data.startTime,
            endTime: data.endTime,
            meetingType: data.meetingType as MeetingType | undefined,
            location: typeof data.location === 'string' ? data.location : undefined,
            meetingLink: typeof data.meetingLink === 'string' ? data.meetingLink : undefined,
          })
        })
      }
      setInvitations(rows.sort((left, right) => (toDayjs(left.startTime)?.valueOf() ?? 0) - (toDayjs(right.startTime)?.valueOf() ?? 0)))
    } catch {
      setInvitations([]) // the rest of the page still works; invitations simply don't show
    }
  }, [assignmentIds, companyCode])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  const accept = async (item: Invitation) => {
    setBusyId(item.id)
    try {
      await respondToAppointment(item.id, { response: 'accept' })
      message.success(t('Appointment confirmed.'))
      await load()
      onChanged?.()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Your response could not be saved.'))
    } finally {
      setBusyId(undefined)
    }
  }

  if (!invitations?.length) return invitations === undefined ? <Skeleton active paragraph={{ rows: 1 }} /> : null

  return (
    <>
      <Card className="incubatee-card" style={{ marginBottom: 12 }} title={<Space><CalendarOutlined />{t('Appointments awaiting your response')}</Space>}>
        <List
          itemLayout="vertical"
          dataSource={invitations}
          renderItem={(item) => {
            const start = toDayjs(item.startTime)
            return (
              <List.Item
                key={item.id}
                actions={[
                  <Button key="accept" type="primary" loading={busyId === item.id} onClick={() => void accept(item)}>{t('Accept')}</Button>,
                  <Button key="decline" danger disabled={busyId === item.id} onClick={() => setDeclining(item)}>{t('Decline')}</Button>,
                ]}
              >
                <Space direction="vertical" size={2}>
                  <Typography.Text strong>{item.title}</Typography.Text>
                  <Typography.Text>{start ? `${start.format('dddd, DD MMMM YYYY')} · ${formatSpan({ id: item.id, interventionTitle: item.title, meetingType: item.meetingType ?? 'online', status: 'pending', startTime: item.startTime, endTime: item.endTime })}` : t('Time to be confirmed')}</Typography.Text>
                  <Space wrap size={6}>
                    <Tag>{meetingTypeLabel(item.meetingType)}</Tag>
                    {item.location && <Typography.Text type="secondary">{item.location}</Typography.Text>}
                  </Space>
                </Space>
              </List.Item>
            )
          }}
        />
      </Card>

      <DeclineModal
        invitation={declining}
        onClose={() => setDeclining(undefined)}
        onDone={async () => {
          setDeclining(undefined)
          await load()
          onChanged?.()
        }}
      />
    </>
  )
}

const DeclineModal = ({ invitation, onClose, onDone }: { invitation?: Invitation, onClose: () => void, onDone: () => Promise<void> }) => (
  <Modal
    open={Boolean(invitation)}
    title={invitation ? `Decline ${invitation.title}` : 'Decline appointment'}
    onCancel={onClose}
    footer={null}
    destroyOnHidden
  >
    {invitation && <DeclineForm key={invitation.id} invitation={invitation} onClose={onClose} onDone={onDone} />}
  </Modal>
)

const DeclineForm = ({ invitation, onClose, onDone }: { invitation: Invitation, onClose: () => void, onDone: () => Promise<void> }) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [context, setContext] = useState<AppointmentRsvpContext>()
  const [loadError, setLoadError] = useState(false)
  const [code, setCode] = useState<DeclineReasonCode>()
  const [detail, setDetail] = useState('')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [saving, setSaving] = useState(false)
  const invitationId = invitation.id

  useEffect(() => {
    let cancelled = false
    void getAppointmentRsvpContext(invitationId)
      .then((result) => { if (!cancelled) setContext(result) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [invitationId])

  const options = context ? [...context.declineOptions, OTHER_OPTION] : []
  const selected = options.find((option) => option.code === code)
  const dropping = code === 'no_longer_needed'

  const submit = async () => {
    if (!code) return
    if (code === 'other' && !detail.trim()) {
      message.warning(t('Please tell us briefly why you cannot make it.'))
      return
    }
    setSaving(true)
    try {
      await respondToAppointment(invitation.id, {
        response: 'decline',
        reasonCode: code,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
        ...(selected?.proposeTime && range ? { proposedStart: range[0].toISOString(), proposedEnd: range[1].toISOString() } : {}),
      })
      message.success(dropping ? t('Thanks. The programme team will confirm this with you.') : t('Your response has been sent.'))
      await onDone()
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('Your response could not be saved.'))
      setSaving(false)
    }
  }

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      {loadError && <Alert type="error" showIcon message={t('We could not load the reasons. Please try again.')} />}
      {!context && !loadError && <Skeleton active paragraph={{ rows: 3 }} />}
      {context && (
        <>
          <Typography.Text>{t('What is the reason?')}</Typography.Text>
          <Radio.Group value={code} onChange={(event) => setCode(event.target.value as DeclineReasonCode)}>
            <Space direction="vertical">
              {options.map((option) => <Radio key={option.code} value={option.code}>{option.label}</Radio>)}
            </Space>
          </Radio.Group>

          {selected?.proposeTime && (
            <div>
              <Typography.Text type="secondary">{t('Suggest another time (optional)')}</Typography.Text>
              <DatePicker.RangePicker
                showTime={{ format: 'HH:mm', minuteStep: 15 }}
                format="DD MMM YYYY HH:mm"
                style={{ width: '100%', marginTop: 4 }}
                value={range}
                onChange={(value) => setRange(value && value[0] && value[1] ? [value[0], value[1]] : null)}
                disabledDate={(date) => date.isBefore(new Date(), 'day')}
              />
            </div>
          )}

          {code && (
            <Input.TextArea
              rows={3}
              maxLength={300}
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder={code === 'other' ? t('Tell us briefly why you cannot make it') : t('Anything else we should know? (optional)')}
            />
          )}

          {dropping && (
            <Alert type="info" showIcon message={t('Your programme team will confirm this before the intervention is removed.')} />
          )}
        </>
      )}
      <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
        <Button onClick={onClose}>{t('Cancel')}</Button>
        <Button danger type="primary" disabled={!code || !context} loading={saving} onClick={() => void submit()}>
          {dropping ? t('Send request') : t('Decline appointment')}
        </Button>
      </Space>
    </Space>
  )
}

export default AppointmentInvitations
