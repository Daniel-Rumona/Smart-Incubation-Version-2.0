import { useEffect, useState } from 'react'
import { App, Button, Checkbox, Form, Input, Modal, Select, Typography } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { submitSystemSettingsChangeRequest } from '@/services/companySettingsService'
import { DEFAULT_INTERVENTION_DELIVERY_ROLES, type InterventionDeliveryRole, type SystemSettingsRecord } from '@/types/companySettings'
import type { FullIdentity } from '@/types/identity'
import { DELIVERY_ROLE_LABELS, OPTIONS_FOR, SETUP_SETTINGS, type SetupSettingKey } from '@/components/settings/setupSettings'
import { ModalActions } from '@/components/shared/ModalActions'

// Once the company exists, directors change the other settings themselves (EditSettingModal); these still need the
// platform admin: turning departments or branches off, branch-only visibility, and anything else.
const REQUEST_ONLY_SETTINGS: SetupSettingKey[] = ['hasDepartments', 'hasBranches', 'branchScopedManagement', 'other']

type Values = { setting: SetupSettingKey, option?: string, roles?: InterventionDeliveryRole[], label?: string, note?: string }

type Props = {
  open: boolean
  /** The setting the modal opens on (a row's Request link), or undefined for the general button. */
  initialSetting?: SetupSettingKey
  user: FullIdentity
  settings: SystemSettingsRecord | null
  onClose: () => void
  onSent: () => void
}

/**
 * Ask the platform admin to change a locked company setting: pick the setting and the option wanted, so the
 * request says exactly what to change. A "who delivers" request carries the roles, which approval applies directly.
 */
export const SetupChangeRequestModal = ({ open, initialSetting, user, settings, onClose, onSent }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const [form] = Form.useForm<Values>()
  const [sending, setSending] = useState(false)
  const setting = Form.useWatch('setting', form) as SetupSettingKey | undefined

  useEffect(() => {
    if (!open) return
    form.resetFields()
    form.setFieldsValue({
      setting: initialSetting || 'other',
      roles: settings?.interventionDeliveryRoles?.length ? settings.interventionDeliveryRoles : DEFAULT_INTERVENTION_DELIVERY_ROLES,
      label: settings?.consultantLabel || '',
    })
  }, [form, initialSetting, open, settings])

  const send = async () => {
    let values: Values
    try {
      values = await form.validateFields()
    } catch {
      return // the form shows what's missing
    }
    const key = values.setting
    // English summary for the admin, e.g. "Who assigns interventions: Operations assigns facilitators."
    const wanted = key === 'interventionDeliveryRoles'
      ? (values.roles || []).map((role) => DELIVERY_ROLE_LABELS[role]).join(', ')
      : key === 'consultantLabel'
        ? `"${(values.label || '').trim()}"`
        : key !== 'other' && values.option ? OPTIONS_FOR[key]?.[values.option] : ''
    const note = (values.note || '').trim()
    const reason = [
      key === 'other' ? '' : `${SETUP_SETTINGS[key]}: ${wanted}.`,
      note,
    ].filter(Boolean).join('\n')

    setSending(true)
    try {
      await submitSystemSettingsChangeRequest(user, settings, reason, key === 'interventionDeliveryRoles' ? values.roles : undefined)
      message.success(t('Request sent to the platform admin.'))
      onSent()
      onClose()
    } catch (error) {
      console.error('[SETTINGS] Change request failed:', error)
      message.error(t('The change request could not be submitted.'))
    } finally {
      setSending(false)
    }
  }

  const options = setting ? OPTIONS_FOR[setting] : undefined

  return (
    <Modal
      open={open}
      centered
      destroyOnHidden
      title={settings ? t('Request a setup change') : t('Request your company setup')}
      onCancel={onClose}
      footer={(
        <ModalActions>
          <Button type="primary" icon={<SendOutlined />} loading={sending} onClick={() => void send()}>{t('Send request')}</Button>
        </ModalActions>
      )}
    >
      <Form form={form} layout="vertical" requiredMark={false}>
        <Form.Item name="setting" label={t('Setting')} rules={[{ required: true }]}>
          <Select
            options={(settings ? REQUEST_ONLY_SETTINGS : (Object.keys(SETUP_SETTINGS) as SetupSettingKey[])).map((key) => ({ value: key, label: t(SETUP_SETTINGS[key]) }))}
            onChange={() => form.setFieldValue('option', undefined)}
          />
        </Form.Item>

        {options && (
          <Form.Item name="option" label={t('What you’d like')} rules={[{ required: true, message: t('Choose an option.') }]}>
            <Select placeholder={t('Choose an option')} options={Object.entries(options).map(([value, label]) => ({ value, label: t(label) }))} />
          </Form.Item>
        )}

        {setting === 'interventionDeliveryRoles' && (
          <Form.Item name="roles" label={t('What you’d like')} rules={[{ required: true, type: 'array', min: 1, message: t('Choose at least one delivery role.') }]}>
            <Checkbox.Group options={(Object.keys(DELIVERY_ROLE_LABELS) as InterventionDeliveryRole[]).map((role) => ({ value: role, label: t(DELIVERY_ROLE_LABELS[role]) }))} />
          </Form.Item>
        )}

        {setting === 'consultantLabel' && (
          <Form.Item name="label" label={t('What you’d like')} rules={[{ required: true, whitespace: true, message: t('Enter the name you use.') }]}>
            <Input maxLength={40} placeholder={t('For example: Mentors')} />
          </Form.Item>
        )}

        <Form.Item
          name="note"
          label={setting === 'other' ? t('What you need') : t('Anything else the admin should know (optional)')}
          rules={setting === 'other' ? [{ required: true, min: 10, message: t('Describe the change in a sentence or two.') }] : []}
        >
          <Input.TextArea rows={3} maxLength={600} placeholder={t('Example: we now have two regional offices and need managers to see only their own branch.')} />
        </Form.Item>
      </Form>
      <Typography.Text type="secondary" className="settings-request-hint">
        {t('The platform admin reviews it and replies in Change requests.')}
      </Typography.Text>
    </Modal>
  )
}
