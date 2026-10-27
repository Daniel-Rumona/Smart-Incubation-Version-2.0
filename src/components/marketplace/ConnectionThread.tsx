import { useState } from 'react'
import { Button, Input, Typography } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useLanguage } from '@/providers/LanguageProvider'
import type { ConnectionParty, ConnectionPlan, ConnectionRequest, ConnectionRequestStatus } from '@/types/connectionRequest'
import '@/styles/marketplace.css'

const { Text } = Typography

/** What each status means, worded for whoever is reading it. English keys for t(). */
export const connectionStatusText = (status: ConnectionRequestStatus, viewer: ConnectionParty, declinedBy?: ConnectionParty) => {
    if (status === 'declined') {
        if (declinedBy === 'sme') return viewer === 'sme' ? 'You declined' : 'The SME declined'
        if (declinedBy === 'consultant') return viewer === 'consultant' ? 'You declined' : 'The consultant declined'
        return 'Declined'
    }
    const text: Record<Exclude<ConnectionRequestStatus, 'declined'>, Record<ConnectionParty, string>> = {
        pending: { sme: 'Waiting for the consultant', consultant: 'New', operations: 'Waiting for the consultant' },
        contacted: { sme: 'In conversation', consultant: 'In conversation', operations: 'In conversation' },
        proposed: { sme: 'Plan waiting for you', consultant: 'Plan sent', operations: 'Plan sent to the SME' },
        matched: { sme: 'Started', consultant: 'Started', operations: 'Plan accepted' },
    }
    return text[status][viewer]
}

export const connectionStatusColor: Record<ConnectionRequestStatus, string> = {
    pending: 'gold',
    contacted: 'blue',
    proposed: 'purple',
    matched: 'green',
    declined: 'default',
}

export const formatMoney = (amount: number, currency = 'ZAR') => {
    try {
        return new Intl.NumberFormat('en-ZA', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
    } catch {
        return `${currency} ${amount.toLocaleString()}`
    }
}

const modeLabel = (mode?: string) => (mode === 'in_person' ? 'In person' : mode === 'hybrid' ? 'Hybrid' : mode === 'online' ? 'Online' : '')

/** The plan's interventions, their sessions, due dates and prices, and the total. Prices are for agreement only. */
export function PlanSummary({ plan }: { plan: ConnectionPlan }) {
    const { t } = useLanguage()
    const sessions = plan.items.reduce((sum, item) => sum + (Number(item.sessions) || 0), 0)
    const dates = plan.items.map((item) => item.dueDate).filter(Boolean).sort()
    return (
        <div className="marketplace-plan">
            <Text type="secondary" className="marketplace-plan-summary">
                {[
                    plan.items.length === 1 ? t('1 intervention') : t('{count} interventions', undefined, { count: plan.items.length }),
                    sessions === 1 ? t('1 session') : t('{count} sessions', undefined, { count: sessions }),
                    dates.length ? t('done by {date}', undefined, { date: dayjs(dates[dates.length - 1]).format('D MMM YYYY') }) : '',
                    plan.version > 1 ? t('revised plan') : '',
                ].filter(Boolean).join(' · ')}
            </Text>
            {plan.items.map((item, index) => (
                <div key={`${item.title}-${index}`} className="marketplace-plan-row">
                    <div className="marketplace-plan-text">
                        <Text strong>{item.title}</Text>
                        <Text type="secondary">
                            {[
                                Number(item.sessions) === 1 ? t('1 session') : t('{count} sessions', undefined, { count: Number(item.sessions) || 0 }),
                                modeLabel(item.deliveryMode) && t(modeLabel(item.deliveryMode)),
                                item.dueDate && t('due {date}', undefined, { date: dayjs(item.dueDate).format('D MMM') }),
                            ].filter(Boolean).join(' · ')}
                        </Text>
                    </div>
                    <Text strong className="marketplace-plan-price">{formatMoney(Number(item.price) || 0, plan.currency)}</Text>
                </div>
            ))}
            <div className="marketplace-plan-row is-total">
                <Text strong>{t('Total')}</Text>
                <Text strong className="marketplace-plan-price">{formatMoney(plan.total, plan.currency)}</Text>
            </div>
            <Text type="secondary" className="marketplace-plan-note">{t('Prices are what you agree to. Payment is arranged directly, outside Smart Incubation.')}</Text>
        </div>
    )
}

type ThreadProps = {
    request: ConnectionRequest
    viewer: ConnectionParty
    /** Omit to show the thread read-only. */
    onSend?: (text: string) => Promise<void>
    placeholder?: string
}

/** The short conversation on a request: what the SME first asked, then the messages either way. */
export function ConnectionThread({ request, viewer, onSend, placeholder }: ThreadProps) {
    const { t } = useLanguage()
    const [draft, setDraft] = useState('')
    const [sending, setSending] = useState(false)
    const send = async () => {
        if (!onSend || !draft.trim()) return
        setSending(true)
        try {
            await onSend(draft)
            setDraft('')
        } finally {
            setSending(false)
        }
    }
    const nameFor = (from: ConnectionParty, name: string) => (from === viewer ? t('You') : name || (from === 'sme' ? request.smeName : from === 'consultant' ? request.targetName : t('Operations')))
    return (
        <div className="marketplace-thread">
            {request.note && (
                <div className={`marketplace-message${viewer === 'sme' ? ' is-mine' : ''}`}>
                    <Text type="secondary" className="marketplace-message-meta">{viewer === 'sme' ? t('You') : request.smeName} · {t('first request')}</Text>
                    <div className="marketplace-message-text">{request.note}</div>
                </div>
            )}
            {(request.messages || []).map((message) => (
                <div key={message.id} className={`marketplace-message${message.from === viewer ? ' is-mine' : ''}${message.from === 'operations' ? ' is-operations' : ''}`}>
                    <Text type="secondary" className="marketplace-message-meta">{nameFor(message.from, message.name)} · {dayjs(message.at).format('D MMM, HH:mm')}</Text>
                    <div className="marketplace-message-text">{message.text}</div>
                </div>
            ))}
            {onSend && (
                <div className="marketplace-composer">
                    <Input.TextArea
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        maxLength={1000}
                        placeholder={placeholder || t('Write a message')}
                        onPressEnter={(event) => { if (!event.shiftKey) { event.preventDefault(); void send() } }}
                    />
                    <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!draft.trim()} onClick={() => void send()} aria-label={t('Send')} />
                </div>
            )}
        </div>
    )
}
