import { useEffect, useState } from 'react'
import { App, Button, Checkbox, DatePicker, Form, Input, Modal, Select, Switch, Typography } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { ModalActions } from '@/components/shared/ModalActions'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { createTeamEvent, updateTeamEvent } from '@/services/teamEventsService'
import { TEAM_EVENT_TYPES, TEAM_EVENT_TYPE_LABELS, type TeamEvent, type TeamEventType } from '@/types/teamEvents'

export type TeamMember = { uid: string, name: string, whatsApp: boolean }

type Values = {
    title: string
    type: TeamEventType
    timeRange: [Dayjs, Dayjs]
    venue?: string
    notes?: string
    attendeeUids: string[]
    recruiting: boolean
    programId?: string
    notifyOnWhatsApp: boolean
}

/**
 * Add or change a team event: what, when, where and who from the team is going. "We'll be looking for SMEs here" is
 * off by default; switching it on gives each person going their own sign-up code (made by the server).
 */
export function TeamEventModal({ open, event, defaultDate, members, programs, onClose, onSaved }: {
    open: boolean
    event?: TeamEvent
    defaultDate?: Dayjs
    members: TeamMember[]
    programs: Array<{ id: string, name: string }>
    onClose: () => void
    onSaved?: (id: string) => void
}) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<Values>()
    const recruiting = Form.useWatch('recruiting', form)
    const notify = Form.useWatch('notifyOnWhatsApp', form)
    const attendeeUids = Form.useWatch('attendeeUids', form)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) return
        const day = defaultDate || dayjs()
        form.setFieldsValue(event
            ? {
                title: event.title, type: event.type, timeRange: [dayjs(event.startTime), dayjs(event.endTime)], venue: event.venue, notes: event.notes,
                attendeeUids: event.attendeeUids, recruiting: event.recruiting, programId: event.programId, notifyOnWhatsApp: event.notifyOnWhatsApp,
            }
            : {
                title: '', type: 'expo', timeRange: [day.hour(9).minute(0).second(0), day.hour(15).minute(0).second(0)], venue: '', notes: '',
                attendeeUids: user?.uid && members.some((row) => row.uid === user.uid) ? [user.uid] : [], recruiting: false, programId: undefined, notifyOnWhatsApp: true,
            })
    }, [defaultDate, event, form, members, open, user?.uid])

    const withoutWhatsApp = (attendeeUids || []).map((uid) => members.find((row) => row.uid === uid)).filter((row) => row && !row.whatsApp)

    const save = async () => {
        if (!user) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            const [start, end] = values.timeRange
            const program = programs.find((row) => row.id === values.programId)
            const payload = {
                title: values.title,
                type: values.type,
                startTime: start.toISOString(),
                endTime: end.toISOString(),
                venue: values.venue || '',
                notes: values.notes || '',
                attendees: values.attendeeUids.map((uid) => ({ uid, name: members.find((row) => row.uid === uid)?.name || '' })),
                recruiting: values.recruiting === true,
                programId: program?.id,
                programName: program?.name,
                notifyOnWhatsApp: values.notifyOnWhatsApp === true,
            }
            const id = event ? (await updateTeamEvent(user, event, payload), event.id) : await createTeamEvent(user, payload)
            message.success(event ? t('Event saved.') : t('Event added to the calendar.'))
            onSaved?.(id)
            onClose()
        } catch {
            message.error(t('The event could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const saveLabel = event
        ? t('Save event')
        : recruiting && notify ? t('Add to calendar and send codes') : t('Add to calendar')

    return (
        <Modal open={open} title={event ? t('Edit event') : t('New event')} onCancel={onClose} footer={null} width={600} destroyOnHidden>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={() => void save()}>
                <Form.Item name="title" label={t('Event name')} rules={[{ required: true, whitespace: true, message: t('Name the event.') }]}>
                    <Input maxLength={120} placeholder={t('e.g. Township business expo')} />
                </Form.Item>
                <div className="team-event-form-row">
                    <Form.Item name="type" label={t('Type')}>
                        <Select options={TEAM_EVENT_TYPES.map((key) => ({ value: key, label: t(TEAM_EVENT_TYPE_LABELS[key]) }))} />
                    </Form.Item>
                    <Form.Item name="timeRange" label={t('Date and time')} rules={[{ required: true, message: t('Choose when it is.') }]}>
                        <DatePicker.RangePicker showTime={{ format: 'HH:mm', minuteStep: 15 }} format="DD MMM YYYY HH:mm" style={{ width: '100%' }} />
                    </Form.Item>
                </div>
                <Form.Item name="venue" label={t('Venue')}>
                    <Input maxLength={160} />
                </Form.Item>
                <Form.Item name="attendeeUids" label={t('Who from the team is going')} rules={[{ required: true, type: 'array', min: 1, message: t('Add at least one person.') }]}>
                    <Select mode="multiple" optionFilterProp="label" options={members.map((row) => ({ value: row.uid, label: row.uid === user?.uid ? t('{name} (you)', undefined, { name: row.name }) : row.name }))} />
                </Form.Item>
                <Form.Item name="notes" label={t('Notes (optional)')}>
                    <Input.TextArea rows={2} maxLength={1000} />
                </Form.Item>

                <Form.Item name="recruiting" valuePropName="checked" noStyle>
                    <RecruitingToggle />
                </Form.Item>
                {recruiting && (
                    <div className="team-event-recruit-extra">
                        <Form.Item name="programId" label={t('For which programme (optional)')} extra={t('Sign-ups are linked to it and can be invited to apply straight away. Leave it empty to sort them out later.')}>
                            <Select allowClear placeholder={t('Not decided yet')} options={programs.map((row) => ({ value: row.id, label: row.name }))} />
                        </Form.Item>
                    </div>
                )}
                <Form.Item name="notifyOnWhatsApp" valuePropName="checked" style={{ marginTop: 12 }}>
                    <Checkbox>{recruiting ? t('Send each person their code on WhatsApp') : t('Let each person know on WhatsApp')}</Checkbox>
                </Form.Item>
                {notify && withoutWhatsApp.length > 0 && (
                    <Typography.Paragraph type="secondary" style={{ marginTop: -12 }}>
                        {t('No WhatsApp number for {names}. They can see their code on the event.', undefined, { names: withoutWhatsApp.map((row) => row?.name).join(', ') })}
                    </Typography.Paragraph>
                )}
                <ModalActions>
                    <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>{saveLabel}</Button>
                </ModalActions>
            </Form>
        </Modal>
    )
}

/** The "looking for SMEs" switch as a card the whole of which can be clicked. */
function RecruitingToggle({ checked, onChange }: { checked?: boolean, onChange?: (value: boolean) => void }) {
    const { t } = useLanguage()
    return (
        <div
            role="switch"
            aria-checked={Boolean(checked)}
            tabIndex={0}
            className={`team-event-recruit${checked ? ' is-on' : ''}`}
            onClick={() => onChange?.(!checked)}
            onKeyDown={(keyEvent) => { if (keyEvent.key === ' ' || keyEvent.key === 'Enter') { keyEvent.preventDefault(); onChange?.(!checked) } }}
        >
            <Switch checked={Boolean(checked)} size="small" tabIndex={-1} />
            <div>
                <Typography.Text strong>{t('We’ll be looking for SMEs here')}</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{t('Gives each person going their own sign-up code, and counts who signs up.')}</Typography.Paragraph>
            </div>
        </div>
    )
}
