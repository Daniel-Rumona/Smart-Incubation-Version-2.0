import { useState } from 'react'
import { Alert, App, Button, Form, Modal, QRCode, Select, Space, Typography } from 'antd'
import { MailOutlined, WhatsAppOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { callableMessage } from '@/services/programLinkService'
import { inviteProspect } from '@/services/prospectsService'
import { prospectName, type Prospect } from '@/types/prospects'
import { phoneKey } from '@/utils/contactKeys'

/**
 * Invites an incubation prospect to a programme with a personal link: when they sign up through it, they are
 * matched to this prospect and what we know about them is filled in. Staff copy the link, open it in WhatsApp, or
 * have the system email it; WhatsApp and email only when the prospect agreed to messages.
 */
export function InviteProspectModal({ prospect, programs, onClose, onInvited }: {
    prospect: Prospect
    programs: Array<{ id: string, name: string }>
    onClose: () => void
    onInvited: () => void
}) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const [programId, setProgramId] = useState(prospect.programId || programs[0]?.id)
    const [link, setLink] = useState<string>()
    const [busy, setBusy] = useState<'link' | 'email' | null>(null)
    const mayMessage = prospect.consent.contactAllowed
    const phone = phoneKey(prospect.phone).replace('+', '')
    const program = programs.find((row) => row.id === programId)

    const run = async (sendEmail: boolean) => {
        if (!programId) return
        setBusy(sendEmail ? 'email' : 'link')
        try {
            const result = await inviteProspect(prospect, programId, sendEmail)
            setLink(result.link)
            if (result.emailed) message.success(t('Invite emailed to {email}.', undefined, { email: prospect.email }))
            onInvited()
        } catch (error) {
            message.error(callableMessage(error, t('The invite could not be prepared.')) === 'no_email_consent'
                ? t('They have not agreed to receive emails from us.')
                : t('The invite could not be prepared.'))
        } finally {
            setBusy(null)
        }
    }

    const whatsappText = link && t('Hi {name}, you are invited to apply for {programme}. Sign up here: {link}', undefined, {
        name: prospect.contactName || prospectName(prospect), programme: program?.name || '', link,
    })

    return (
        <Modal open title={t('Invite {name}', undefined, { name: prospectName(prospect) })} footer={null} onCancel={onClose} destroyOnHidden>
            <Form layout="vertical">
                <Form.Item label={t('Programme')}>
                    <Select value={programId} onChange={(value) => { setProgramId(value); setLink(undefined) }} options={programs.map((row) => ({ value: row.id, label: row.name }))} placeholder={t('Choose a programme')} />
                </Form.Item>
            </Form>
            {!programs.length && <Alert type="warning" showIcon title={t('Create a programme first: the invite is to a programme.')} />}
            {!mayMessage && <Alert type="info" showIcon style={{ marginBottom: 12 }} title={t('They have not agreed to messages from us, so the link can be copied but not sent from here.')} />}
            {link ? (
                <Space orientation="vertical" align="center" style={{ width: '100%' }}>
                    <QRCode value={link} size={160} />
                    <Typography.Paragraph copyable={{ text: link }} style={{ wordBreak: 'break-all', textAlign: 'center' }}>{link}</Typography.Paragraph>
                    <Space wrap>
                        {mayMessage && phone && (
                            <Button icon={<WhatsAppOutlined />} href={`https://wa.me/${phone}?text=${encodeURIComponent(whatsappText || '')}`} target="_blank" rel="noreferrer">{t('Open in WhatsApp')}</Button>
                        )}
                        {mayMessage && prospect.email && (
                            <Button icon={<MailOutlined />} loading={busy === 'email'} onClick={() => void run(true)}>{t('Email it')}</Button>
                        )}
                    </Space>
                </Space>
            ) : (
                <Button type="primary" block disabled={!programId} loading={busy === 'link'} onClick={() => void run(false)}>{t('Create invite link')}</Button>
            )}
        </Modal>
    )
}
