import { useCallback, useEffect, useState } from 'react'
import { App, Button, Empty, Input, Skeleton, Tag, Typography } from 'antd'
import { DownOutlined, SendOutlined, UpOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadOverdueByProgramme, requestProgrammeUpdate, type OverdueProgramme } from '@/services/directorUpdateRequestService'
import type { FullIdentity } from '@/types/identity'

type Props = {
    open: boolean
    onClose: () => void
    user: FullIdentity
    activeProgramId: string
    /** Programme id → name, from the dashboard, so the names match its table. */
    programmeNames: Map<string, string>
}

// Interventions listed per programme before "show all".
const PREVIEW_ITEMS = 5

/**
 * Overdue interventions grouped by programme. The director doesn't chase each one; they ask the programme's
 * operations and project admins for an update, and see when they last did.
 */
export const OverdueUpdatesModal = ({ open, onClose, user, activeProgramId, programmeNames }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [groups, setGroups] = useState<OverdueProgramme[] | null>(null)
    const [expanded, setExpanded] = useState<string | null>(null)
    const [composing, setComposing] = useState<string | null>(null)
    const [note, setNote] = useState('')
    const [sending, setSending] = useState(false)

    const load = useCallback(async () => {
        try {
            setGroups(await loadOverdueByProgramme(user, activeProgramId, programmeNames))
        } catch (error) {
            console.error('[DIRECTOR] Failed to load overdue interventions:', error)
            message.error(t('Overdue interventions could not be loaded.'))
            setGroups([])
        }
    }, [activeProgramId, message, programmeNames, t, user])

    useEffect(() => {
        if (!open) return
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load, open])

    const close = () => {
        setComposing(null)
        setNote('')
        onClose()
    }

    const send = async (group: OverdueProgramme) => {
        setSending(true)
        try {
            const { recipients } = await requestProgrammeUpdate(user, group, note)
            if (!recipients) {
                message.warning(t('No operations or project admin users work on {programme} yet.', undefined, { programme: group.programName }))
                return
            }
            message.success(recipients === 1
                ? t('Update requested from 1 person.')
                : t('Update requested from {count} people.', undefined, { count: recipients }))
            setComposing(null)
            setNote('')
            void load()
        } catch (error) {
            console.error('[DIRECTOR] Failed to request an update:', error)
            message.error(t('The update request could not be sent.'))
        } finally {
            setSending(false)
        }
    }

    const total = (groups || []).reduce((sum, group) => sum + group.items.length, 0)

    return (
        <ResponsiveModal
            open={open}
            onClose={close}
            width={720}
            centered
            title={groups ? t('Overdue interventions ({count})', undefined, { count: total }) : t('Overdue interventions')}
        >
            {!groups ? <Skeleton active paragraph={{ rows: 4 }} /> : !groups.length ? (
                <Empty description={t('Nothing is overdue.')} />
            ) : (
                <div className="director-overdue">
                    <Typography.Paragraph type="secondary" className="director-overdue-intro">
                        {t('Ask each programme’s operations and project admins for an update. They get it in their notifications.')}
                    </Typography.Paragraph>
                    {groups.map((group) => {
                        const isExpanded = expanded === group.programId
                        const shown = isExpanded ? group.items : group.items.slice(0, PREVIEW_ITEMS)
                        const name = group.programId === 'unassigned' ? t('No programme') : group.programName
                        return (
                            <section key={group.programId} className="director-overdue-group">
                                <div className="director-overdue-head">
                                    <div>
                                        <Typography.Text strong>{name}</Typography.Text>
                                        <div className="director-overdue-meta">
                                            <Tag bordered={false} color="red">{t('{count} overdue', undefined, { count: group.items.length })}</Tag>
                                            <Typography.Text type="secondary">
                                                {group.oldestDaysLate === 1 ? t('Oldest is 1 day late') : t('Oldest is {days} days late', undefined, { days: group.oldestDaysLate })}
                                            </Typography.Text>
                                        </div>
                                        <Typography.Text type="secondary" className="director-overdue-last">
                                            {group.lastRequest
                                                ? t('Last asked {date} by {name}', undefined, { date: group.lastRequest.at.format('D MMM, HH:mm'), name: group.lastRequest.byName })
                                                : t('No update requested yet')}
                                        </Typography.Text>
                                    </div>
                                    {composing !== group.programId && (
                                        <Button icon={<SendOutlined />} onClick={() => { setComposing(group.programId); setNote('') }}>
                                            {t('Ask for an update')}
                                        </Button>
                                    )}
                                </div>

                                {composing === group.programId && (
                                    <div className="director-overdue-compose">
                                        <Input.TextArea
                                            value={note}
                                            onChange={(event) => setNote(event.target.value)}
                                            placeholder={t('Add a note (optional)')}
                                            autoSize={{ minRows: 2, maxRows: 4 }}
                                            maxLength={300}
                                        />
                                        <div className="director-overdue-compose-actions">
                                            <Button onClick={() => setComposing(null)} disabled={sending}>{t('Cancel')}</Button>
                                            <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void send(group)}>
                                                {t('Send request')}
                                            </Button>
                                        </div>
                                    </div>
                                )}

                                <ul className="director-overdue-items">
                                    {shown.map((item) => (
                                        <li key={item.id}>
                                            <span>
                                                <Typography.Text>{item.title}</Typography.Text>
                                                <Typography.Text type="secondary">
                                                    {item.assignee ? `${item.sme} · ${item.assignee}` : item.sme}
                                                </Typography.Text>
                                            </span>
                                            <Tag bordered={false} color={item.daysLate > 14 ? 'red' : 'orange'}>
                                                {item.daysLate === 1 ? t('1 day late') : t('{days} days late', undefined, { days: item.daysLate })}
                                            </Tag>
                                        </li>
                                    ))}
                                </ul>
                                {group.items.length > PREVIEW_ITEMS && (
                                    <Button type="link" size="small" className="director-overdue-more" icon={isExpanded ? <UpOutlined /> : <DownOutlined />} onClick={() => setExpanded(isExpanded ? null : group.programId)}>
                                        {isExpanded ? t('Show fewer') : t('Show all {count}', undefined, { count: group.items.length })}
                                    </Button>
                                )}
                            </section>
                        )
                    })}
                    <Typography.Text type="secondary" className="director-overdue-asof">
                        {t('As at {date}', undefined, { date: dayjs().format('D MMM YYYY, HH:mm') })}
                    </Typography.Text>
                </div>
            )}
        </ResponsiveModal>
    )
}
