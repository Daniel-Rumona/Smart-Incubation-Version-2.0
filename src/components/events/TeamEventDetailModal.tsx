import { useEffect, useMemo, useState } from 'react'
import { App, Avatar, Button, Empty, Popconfirm, Popover, Progress, QRCode, Space, Table, Tag, Typography } from 'antd'
import { CopyOutlined, EditOutlined, StopOutlined, WhatsAppOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { statusOption } from '@/config/prospects'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { canManageProspects, listProspects, signupLinkUrl } from '@/services/prospectsService'
import { cancelTeamEvent, canManageTeamEvents, resendTeamEventMessages } from '@/services/teamEventsService'
import { prospectName, type Prospect } from '@/types/prospects'
import { TEAM_EVENT_TYPE_LABELS, type TeamEvent, type TeamEventAttendee } from '@/types/teamEvents'
import { eventLinkOwners, eventSignups, signupFunnel } from '@/utils/teamEventStats'

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

/**
 * One team event. Every event shows when, where, who is going and notes. When the team is looking for SMEs there it
 * also shows each person's sign-up code and WhatsApp status, how far the sign-ups got, and who signed up through whom.
 */
export function TeamEventDetailModal({ event, onClose, onEdit }: {
    event?: TeamEvent
    onClose: () => void
    onEdit: (event: TeamEvent, turnOnRecruiting?: boolean) => void
}) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [prospects, setProspects] = useState<Prospect[]>()
    const canManage = canManageTeamEvents(user)
    const seesSignups = canManageProspects(user)

    useEffect(() => {
        if (!event?.recruiting || !user || !seesSignups) return
        let cancelled = false
        void listProspects(user, 'incubation')
            .then((rows) => { if (!cancelled) setProspects(rows) })
            .catch(() => { if (!cancelled) setProspects([]) })
        return () => { cancelled = true }
    }, [event?.id, event?.recruiting, seesSignups, user])

    const signups = useMemo(() => (event && prospects ? eventSignups(event, prospects) : []), [event, prospects])
    const owners = useMemo(() => (event ? eventLinkOwners(event) : new Map<string, string>()), [event])
    const funnel = signupFunnel(signups)
    const countFor = (uid: string) => signups.filter((row) => row.signupLinkId && owners.get(row.signupLinkId) === uid).length

    if (!event) return null

    const start = dayjs(event.startTime)
    const end = dayjs(event.endTime)
    const when = `${start.format('ddd D MMM YYYY')} · ${start.format('HH:mm')}–${end.isSame(start, 'day') ? end.format('HH:mm') : end.format('D MMM HH:mm')}`
    const nameOf = (uid: string) => event.attendees.find((row) => row.uid === uid)?.name || ''

    const resend = async (uid?: string) => {
        if (!user) return
        try {
            await resendTeamEventMessages(user, event, uid)
            message.success(t('Sending again.'))
        } catch {
            message.error(t('Could not send again.'))
        }
    }

    const cancel = async () => {
        if (!user) return
        try {
            await cancelTeamEvent(user, event)
            message.success(t('Event cancelled.'))
            onClose()
        } catch {
            message.error(t('The event could not be cancelled.'))
        }
    }

    const whatsAppCell = (person: TeamEventAttendee) => {
        const code = event.codes[person.uid] || {}
        if (code.sentAt) {
            return <Space size={4} wrap><Tag color="green">{t('Sent {time}', undefined, { time: dayjs(code.sentAt).format('D MMM HH:mm') })}</Tag>{canManage && <Button size="small" icon={<WhatsAppOutlined />} onClick={() => void resend(person.uid)}>{t('Resend')}</Button>}</Space>
        }
        if (code.sendProblem === 'no_number') return <Tag color="orange">{t('No WhatsApp number')}</Tag>
        if (code.sendProblem === 'failed') return <Space size={4} wrap><Tag color="red">{t('Not sent')}</Tag>{canManage && <Button size="small" icon={<WhatsAppOutlined />} onClick={() => void resend(person.uid)}>{t('Try again')}</Button>}</Space>
        if (event.notifyOnWhatsApp) return <Tag>{t('Sending…')}</Tag>
        return canManage ? <Button size="small" icon={<WhatsAppOutlined />} onClick={() => void resend(person.uid)}>{t('Send')}</Button> : <Typography.Text type="secondary">—</Typography.Text>
    }

    const codeCell = (person: TeamEventAttendee) => {
        const linkId = event.codes[person.uid]?.linkId
        if (!linkId) return <Typography.Text type="secondary">{t('Making the code…')}</Typography.Text>
        const url = signupLinkUrl(linkId)
        return (
            <Popover
                trigger="click"
                content={(
                    <Space orientation="vertical" align="center">
                        <QRCode value={url} size={220} bgColor="#ffffff" color="#111111" />
                        <Typography.Text type="secondary">{t('{name}’s code', undefined, { name: person.name.split(/\s+/)[0] })}</Typography.Text>
                        <Space wrap>
                            <Button size="small" icon={<CopyOutlined />} onClick={() => void navigator.clipboard?.writeText(url).then(() => message.success(t('Link copied.')))}>{t('Copy link')}</Button>
                            <Button size="small" href={`${url}/qr`} target="_blank" rel="noreferrer">{t('Open full screen')}</Button>
                        </Space>
                    </Space>
                )}
            >
                <button type="button" className="team-event-qr" aria-label={t('Show {name}’s code', undefined, { name: person.name })}>
                    <QRCode value={url} size={56} bordered={false} bgColor="#ffffff" color="#111111" />
                </button>
            </Popover>
        )
    }

    const person = (row: TeamEventAttendee) => (
        <Space size={8}>
            <Avatar size={28} style={{ background: 'var(--ant-color-primary)', flex: 'none' }}>{initials(row.name)}</Avatar>
            <span>{row.uid === user?.uid ? t('{name} (you)', undefined, { name: row.name }) : row.name}</span>
        </Space>
    )

    const footer = canManage ? (
        <Space wrap style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Popconfirm title={t('Cancel this event?')} description={event.recruiting ? t('Its sign-up codes close. People who already signed up stay in Prospects.') : undefined} okText={t('Cancel event')} cancelText={t('Keep it')} onConfirm={() => void cancel()}>
                <Button danger icon={<StopOutlined />}>{t('Cancel event')}</Button>
            </Popconfirm>
            <Button type="primary" icon={<EditOutlined />} onClick={() => onEdit(event)}>{t('Edit event')}</Button>
        </Space>
    ) : null

    return (
        <ResponsiveModal open={Boolean(event)} onClose={onClose} width={event.recruiting ? 920 : 640} footer={footer} title={(
            <Space wrap size={8}>
                <span>{event.title}</span>
                {event.recruiting && <Tag className="team-event-recruit-tag">{t('Looking for SMEs')}</Tag>}
            </Space>
        )}>
            <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
                {[when, event.venue, t(TEAM_EVENT_TYPE_LABELS[event.type])].filter(Boolean).join(' · ')}
            </Typography.Paragraph>

            {!event.recruiting ? (
                <div className="team-event-grid">
                    <section>
                        <Typography.Title level={5}>{t('Team going')}</Typography.Title>
                        <Space orientation="vertical" size={10}>
                            {event.attendees.map((row) => <div key={row.uid} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>{person(row)}{event.notifyOnWhatsApp && whatsAppCell(row)}</div>)}
                        </Space>
                    </section>
                    <section>
                        <Typography.Title level={5}>{t('Notes')}</Typography.Title>
                        <Typography.Paragraph type={event.notes ? undefined : 'secondary'}>{event.notes || t('No notes.')}</Typography.Paragraph>
                        {canManage && <Button onClick={() => onEdit(event, true)}>{t('Look for SMEs here too')}</Button>}
                    </section>
                </div>
            ) : (
                <>
                    <div className="team-event-grid is-recruiting">
                        <section>
                            <Typography.Title level={5}>{t('Team going')}</Typography.Title>
                            <Table
                                size="small"
                                rowKey="uid"
                                pagination={false}
                                dataSource={event.attendees}
                                scroll={{ x: true }}
                                columns={[
                                    { title: t('Person'), key: 'person', render: (_, row) => person(row) },
                                    { title: t('Their code'), key: 'code', render: (_, row) => codeCell(row) },
                                    { title: t('On WhatsApp'), key: 'whatsapp', responsive: ['md'], render: (_, row) => whatsAppCell(row) },
                                    ...(seesSignups ? [{ title: t('Sign-ups'), key: 'signups', align: 'right' as const, render: (_: unknown, row: TeamEventAttendee) => (prospects ? countFor(row.uid) : '…') }] : []),
                                ]}
                            />
                        </section>
                        <section>
                            <Typography.Title level={5}>{t('Sign-ups so far')}</Typography.Title>
                            {seesSignups ? (
                                <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                                    {([
                                        [t('Signed up'), funnel.signedUp],
                                        [t('Contacted'), funnel.contacted],
                                        [t('Applied'), funnel.applied],
                                        [t('Joined'), funnel.joined],
                                    ] as const).map(([label, value]) => (
                                        <div key={label}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{label}</span><strong>{value}</strong></div>
                                            <Progress percent={funnel.signedUp ? Math.round((value / funnel.signedUp) * 100) : 0} showInfo={false} size="small" />
                                        </div>
                                    ))}
                                </Space>
                            ) : (
                                <Typography.Paragraph type="secondary">{t('Operations see who signed up in Prospects.')}</Typography.Paragraph>
                            )}
                            <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
                                {event.programName ? t('Programme they’d join: {name}.', undefined, { name: event.programName }) : t('No programme chosen: sort sign-ups out in Prospects.')}
                                {' '}{t('Codes close the day after the event.')}
                            </Typography.Paragraph>
                        </section>
                    </div>

                    {seesSignups && (
                        <section style={{ marginTop: 16 }}>
                            <Typography.Title level={5}>{t('Who signed up')}</Typography.Title>
                            {prospects && signups.length === 0 ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nobody yet. Sign-ups show here as people scan the codes.')} />
                            ) : (
                                <Table
                                    size="small"
                                    rowKey="id"
                                    loading={!prospects}
                                    pagination={signups.length > 10 ? { pageSize: 10 } : false}
                                    dataSource={signups}
                                    columns={[
                                        { title: t('Business'), key: 'name', render: (_, row) => <Space orientation="vertical" size={0}><strong>{prospectName(row)}</strong>{row.businessName && <Typography.Text type="secondary">{row.contactName}</Typography.Text>}</Space> },
                                        { title: t('Through'), key: 'through', render: (_, row) => nameOf((row.signupLinkId && owners.get(row.signupLinkId)) || '') || row.ownerName || '—' },
                                        { title: t('Status'), key: 'status', render: (_, row) => { const option = statusOption('incubation', row.status); return <Tag color={option.color}>{t(option.label)}</Tag> } },
                                    ]}
                                />
                            )}
                        </section>
                    )}
                </>
            )}
        </ResponsiveModal>
    )
}
