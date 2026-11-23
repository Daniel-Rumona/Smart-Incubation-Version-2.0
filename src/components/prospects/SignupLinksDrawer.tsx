import { useCallback, useEffect, useState } from 'react'
import { App, Button, Drawer, Form, Input, List, QRCode, Select, Space, Switch, Tag, Typography } from 'antd'
import { PlusOutlined, WhatsAppOutlined } from '@ant-design/icons'
import type { ProspectModule } from '@/config/prospects'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { createSignupLink, listSignupLinks, setSignupLinkActive, signupLinkUrl } from '@/services/prospectsService'
import type { ProspectSignupLink } from '@/types/prospects'

/**
 * Sign-up links for events: a QR code to show on a screen or print, and a link to share on WhatsApp. People fill in
 * their own details and agree to be kept on record; they arrive as new prospects with the event as their source.
 */
export function SignupLinksDrawer({ module, open, onClose, programs, owners }: {
    module: ProspectModule
    open: boolean
    onClose: () => void
    programs: Array<{ id: string, name: string }>
    owners: Array<{ uid: string, name: string }>
}) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<{ label: string, programId?: string, ownerUid?: string }>()
    const [links, setLinks] = useState<ProspectSignupLink[]>()
    const [saving, setSaving] = useState(false)

    const load = useCallback(async () => {
        if (!user || !open) return
        setLinks(await listSignupLinks(user, module).catch(() => []))
    }, [module, open, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const create = async () => {
        if (!user) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            const program = programs.find((row) => row.id === values.programId)
            const owner = owners.find((row) => row.uid === values.ownerUid)
            await createSignupLink(user, module, { label: values.label, programId: program?.id, programName: program?.name, ownerUid: owner?.uid, ownerName: owner?.name })
            form.resetFields()
            await load()
        } catch {
            message.error(t('The link could not be created.'))
        } finally {
            setSaving(false)
        }
    }

    const toggle = async (link: ProspectSignupLink, active: boolean) => {
        if (!user) return
        await setSignupLinkActive(user, link, active).catch(() => message.error(t('The link could not be updated.')))
        await load()
    }

    return (
        <Drawer open={open} onClose={onClose} title={t('Sign-up links for events')} size="large">
            <Typography.Paragraph type="secondary">
                {t('Show the QR code at an event or share the link on WhatsApp. People fill in their own details and agree to be kept on record; they appear here as new prospects.')}
            </Typography.Paragraph>
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="label" label={t('Event or campaign')} rules={[{ required: true, whitespace: true, message: t('Name the event.') }]}>
                    <Input maxLength={120} placeholder={t('e.g. Township business expo, 14 March')} />
                </Form.Item>
                <Space wrap style={{ width: '100%' }}>
                    {module === 'incubation' && (
                        <Form.Item name="programId" label={t('Programme (optional)')} style={{ minWidth: 220 }}>
                            <Select allowClear options={programs.map((row) => ({ value: row.id, label: row.name }))} />
                        </Form.Item>
                    )}
                    <Form.Item name="ownerUid" label={t('Who follows up (optional)')} style={{ minWidth: 220 }}>
                        <Select allowClear options={owners.map((row) => ({ value: row.uid, label: row.name }))} />
                    </Form.Item>
                </Space>
                <Button type="primary" icon={<PlusOutlined />} loading={saving} onClick={() => void create()}>{t('Create link')}</Button>
            </Form>
            <List
                style={{ marginTop: 24 }}
                loading={!links}
                dataSource={links || []}
                locale={{ emptyText: t('No sign-up links yet.') }}
                renderItem={(link) => {
                    const url = signupLinkUrl(link.id)
                    return (
                        <List.Item extra={link.active ? <QRCode value={url} size={112} /> : null}>
                            <Space orientation="vertical" size={4}>
                                <Space wrap>
                                    <Typography.Text strong>{link.label}</Typography.Text>
                                    {link.active ? <Tag color="green">{t('Open')}</Tag> : <Tag>{t('Closed')}</Tag>}
                                    <Tag>{t('{count} sign-ups', undefined, { count: link.signups })}</Tag>
                                </Space>
                                {link.programName && <Typography.Text type="secondary">{link.programName}</Typography.Text>}
                                <Typography.Text copyable={{ text: url }} style={{ wordBreak: 'break-all' }}>{url}</Typography.Text>
                                <Space wrap>
                                    <Button size="small" icon={<WhatsAppOutlined />} href={`https://wa.me/?text=${encodeURIComponent(t('Register your interest here: {link}', undefined, { link: url }))}`} target="_blank" rel="noreferrer">{t('Share on WhatsApp')}</Button>
                                    <Space><Switch size="small" checked={link.active} onChange={(value) => void toggle(link, value)} /><Typography.Text>{t('Accepting sign-ups')}</Typography.Text></Space>
                                </Space>
                            </Space>
                        </List.Item>
                    )
                }}
            />
        </Drawer>
    )
}
