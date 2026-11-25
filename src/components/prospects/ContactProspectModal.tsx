import { useMemo, useState } from 'react'
import { Alert, App, Button, DatePicker, Form, Input, Modal, Segmented, Space, Typography } from 'antd'
import { MailOutlined, WhatsAppOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { logProspectContact, type ContactChannel } from '@/services/prospectsService'
import { prospectName, type Prospect } from '@/types/prospects'
import { phoneKey } from '@/utils/contactKeys'
import { DEFAULT_FOLLOW_UP_WORKING_DAYS, addWorkingDays } from '@/utils/prospectFormat'

/**
 * Reaching out to a prospect. Either the message is prepared here and opened in the person's own WhatsApp or email app
 * (only when the prospect agreed to messages), or a call or meeting that already happened is written down. Either way
 * the contact is recorded: it moves a "new" prospect to "contacted", sets the next follow-up and shows in the history.
 */
export function ContactProspectModal({ prospect, onClose, onRecorded }: { prospect: Prospect, onClose: () => void, onRecorded: () => void }) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const mayMessage = prospect.consent.contactAllowed
    const phone = phoneKey(prospect.phone).replace('+', '')
    const sender = String(user?.displayName || user?.name || '').trim()
    const name = prospect.contactName || prospectName(prospect)
    const business = prospect.businessName || t('your business')
    const [channel, setChannel] = useState<ContactChannel>(mayMessage && phone ? 'whatsapp' : mayMessage && prospect.email ? 'email' : 'call')
    const [purpose, setPurpose] = useState<'hello' | 'info'>('hello')
    const templates = useMemo(() => ({
        hello: t('Hi {name}, it is {sender}. Thank you for your interest. I would love to tell you more about how we can help. When is a good time to talk?', undefined, { name, sender }),
        info: t('Hi {name}, it is {sender}. To see how we can help {business}, please could you send us: your business registration number, what the business does, how long it has been trading and how many people it employs? Thank you!', undefined, { name, sender, business }),
    }), [business, name, sender, t])
    const [text, setText] = useState(templates.hello)
    const [note, setNote] = useState('')
    const [followUp, setFollowUp] = useState<string>(addWorkingDays(DEFAULT_FOLLOW_UP_WORKING_DAYS))
    const [saving, setSaving] = useState(false)
    const messaging = channel === 'whatsapp' || channel === 'email'

    const pick = (next: 'hello' | 'info') => { setPurpose(next); setText(templates[next]) }
    const link = channel === 'whatsapp'
        ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
        : `mailto:${prospect.email}?subject=${encodeURIComponent(t('Following up'))}&body=${encodeURIComponent(text)}`

    const record = async () => {
        if (!user) return
        setSaving(true)
        try {
            await logProspectContact(user, prospect, { channel, note: note.trim() || (messaging ? text.slice(0, 200) : ''), nextFollowUpAt: followUp })
            message.success(t('Contact recorded.'))
            onRecorded()
            onClose()
        } catch (error) {
            console.error('Prospect contact failed', error)
            message.error(t('The contact could not be recorded.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal open title={t('Contact {name}', undefined, { name: prospectName(prospect) })} footer={null} onCancel={onClose} destroyOnHidden>
            <Form layout="vertical">
                <Form.Item label={t('How')}>
                    <Segmented
                        block
                        value={channel}
                        onChange={(value) => setChannel(value as ContactChannel)}
                        options={[
                            ...(mayMessage && phone ? [{ value: 'whatsapp', label: 'WhatsApp' }] : []),
                            ...(mayMessage && prospect.email ? [{ value: 'email', label: t('Email') }] : []),
                            { value: 'call', label: t('Phone call') },
                            { value: 'meeting', label: t('Meeting') },
                        ]}
                    />
                </Form.Item>
                {!mayMessage && <Alert type="info" showIcon style={{ marginBottom: 12 }} title={t('They have not agreed to messages from us, so only a call or meeting can be recorded here.')} />}
                {messaging ? (
                    <>
                        <Form.Item label={t('Message')}>
                            <Segmented
                                value={purpose}
                                onChange={(value) => pick(value as 'hello' | 'info')}
                                options={[{ value: 'hello', label: t('Say hello') }, { value: 'info', label: t('Ask for more information') }]}
                                style={{ marginBottom: 8 }}
                            />
                            <Input.TextArea rows={5} value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} />
                        </Form.Item>
                        <Space style={{ marginBottom: 16 }}>
                            <Button icon={channel === 'whatsapp' ? <WhatsAppOutlined /> : <MailOutlined />} href={link} target="_blank" rel="noreferrer">
                                {channel === 'whatsapp' ? t('Open in WhatsApp') : t('Open in your email app')}
                            </Button>
                            <Typography.Text type="secondary">{t('Send it there, then record it below.')}</Typography.Text>
                        </Space>
                    </>
                ) : (
                    <Form.Item label={t('What was said')}>
                        <Input.TextArea rows={3} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder={t('e.g. interested, wants a proposal')} />
                    </Form.Item>
                )}
                <Form.Item label={t('Next follow-up')}>
                    <DatePicker
                        style={{ width: '100%' }}
                        format="D MMM YYYY"
                        value={followUp ? dayjs(followUp) : null}
                        onChange={(value) => setFollowUp(value ? value.format('YYYY-MM-DD') : '')}
                        disabledDate={(date) => !!date && date.format('YYYY-MM-DD') < addWorkingDays(0)}
                    />
                </Form.Item>
            </Form>
            <Button type="primary" block loading={saving} onClick={() => void record()}>
                {messaging ? t('I sent it: record it') : t('Record this contact')}
            </Button>
        </Modal>
    )
}
