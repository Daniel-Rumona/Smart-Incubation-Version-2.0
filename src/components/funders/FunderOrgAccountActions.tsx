import { useEffect, useState } from 'react'
import { App, Button, Flex, Form, Input, Typography } from 'antd'
import { UserAddOutlined } from '@ant-design/icons'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useLanguage } from '@/providers/LanguageProvider'
import { funderOrgErrorMessage, inviteFunderColleague, subscribeOwnOrganisation, type FunderOrganisation } from '@/services/funderOrganisationsService'
import { isOrgFunder } from '@/services/funderScopeService'
import type { FullIdentity } from '@/types/identity'
import '@/styles/funder-organisations.css'

/**
 * A funder organisation member's own control in the account menu: inviting a colleague, once the organisation is
 * confirmed. The programmes it funds (and unlinking them) live on the funder Portfolio page. `onOpen` closes the menu.
 */
export default function FunderOrgAccountActions({ user, onOpen }: { user: FullIdentity | null; onOpen: () => void }) {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const orgId = isOrgFunder(user) ? String(user?.funderOrgId || '') : ''
  const [organisation, setOrganisation] = useState<FunderOrganisation | null>(null)
  const [busy, setBusy] = useState(false)
  const [teamOpen, setTeamOpen] = useState(false)
  const [form] = Form.useForm<{ name: string; email: string }>()

  useEffect(() => {
    if (!orgId) return
    return subscribeOwnOrganisation(orgId, setOrganisation, () => setOrganisation(null))
  }, [orgId])

  const name = organisation?.name || user?.funderOrgName || t('Your organisation')

  const inviteColleague = async () => {
    const values = await form.validateFields()
    setBusy(true)
    try {
      await inviteFunderColleague(values)
      message.success(t('Invite sent. They see the same programmes once they set a password.'))
      form.resetFields()
      setTeamOpen(false)
    } catch (error) {
      message.error(funderOrgErrorMessage(error, t('That didn\'t work. Try again.'), t('That email address already has an account. Use another address.')))
    } finally {
      setBusy(false)
    }
  }

  if (!orgId || organisation?.status !== 'confirmed') return null

  return (
    <>
      <Button block icon={<UserAddOutlined />} onClick={() => { onOpen(); setTeamOpen(true) }}>{t('Invite a colleague')}</Button>

      <ResponsiveModal
        open={teamOpen}
        onClose={() => setTeamOpen(false)}
        title={t('Invite a colleague')}
        footer={<Flex justify="flex-end" gap={8}>
          <Button onClick={() => setTeamOpen(false)}>{t('Cancel')}</Button>
          <Button type="primary" icon={<UserAddOutlined />} loading={busy} onClick={() => void inviteColleague()}>{t('Send invite')}</Button>
        </Flex>}
      >
        <Typography.Paragraph type="secondary">{t('They get their own sign-in to {name}\'s dashboard and see the same programmes as you.', undefined, { name })}</Typography.Paragraph>
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label={t('Name')} rules={[{ required: true, whitespace: true, message: t('Enter your colleague\'s name.') }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="email" label={t('Work email')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]}>
            <Input type="email" maxLength={200} placeholder="name@funder.org" />
          </Form.Item>
        </Form>
      </ResponsiveModal>
    </>
  )
}
