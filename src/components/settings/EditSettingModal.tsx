import { useMemo, useState } from 'react'
import { Alert, App, Button, Checkbox, Input, Modal, Select, Typography } from 'antd'
import { SaveOutlined } from '@ant-design/icons'
import { ModalActions } from '@/components/shared/ModalActions'
import { ASSIGNMENT_OPTIONS, DELIVERY_ROLE_LABELS, DIVISION_OPTIONS, SETUP_SETTINGS } from '@/components/settings/setupSettings'
import { useLanguage } from '@/providers/LanguageProvider'
import { updateCompanySetting, type DirectSettingKey } from '@/services/companySettingsEditService'
import { DEFAULT_INTERVENTION_DELIVERY_ROLES, type InterventionDeliveryRole, type SystemSettingsRecord } from '@/types/companySettings'
import type { FullIdentity } from '@/types/identity'

type Props = {
  field?: DirectSettingKey
  user: FullIdentity
  settings: SystemSettingsRecord | null
  onClose: () => void
  onSaved: () => void
}


// The setting's saved value (delivery roles fall back to the default three; the label to Facilitators).
const currentValue = (field: DirectSettingKey | undefined, settings: SystemSettingsRecord | null) => {
  if (!field || !settings) return undefined
  if (field === 'interventionDeliveryRoles') return settings.interventionDeliveryRoles?.length ? settings.interventionDeliveryRoles : DEFAULT_INTERVENTION_DELIVERY_ROLES
  if (field === 'hasDepartments' || field === 'hasBranches') return Boolean(settings[field])
  return settings[field] || (field === 'consultantLabel' ? 'Facilitators' : undefined)
}

/**
 * Change one company setting directly. The modal is the confirmation: it says what the change does in the app
 * (worded from what the code does today) before the director saves.
 */
export const EditSettingModal = ({ field, user, settings, onClose, onSaved }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const current = useMemo(() => currentValue(field, settings), [field, settings])
  // The page mounts a fresh modal per setting (key={field}), so the draft always starts from that setting's value.
  // Departments and branches can only be turned on here, so their draft starts at "on".
  const [value, setValue] = useState<string | boolean | string[] | undefined>(() => (
    field === 'hasDepartments' || field === 'hasBranches' ? true : currentValue(field, settings)
  ))
  const [saving, setSaving] = useState(false)
  const roles = Array.isArray(value) ? value : []

  // What the change does, and whether it's worth a warning rather than a note.
  const impact = useMemo((): { tone: 'info' | 'warning', text: string } | null => {
    const roleNames = (roles: string[]) => roles.map((role) => t(DELIVERY_ROLE_LABELS[role as InterventionDeliveryRole] || role)).join(', ')
    if (!field || value === undefined) return null
    if (field === 'consultantLabel') return { tone: 'info', text: t('Shown wherever the app names facilitators, for example when assigning interventions.') }
    if (field === 'interventionDeliveryRoles') {
      const next: string[] = Array.isArray(value) ? value : []
      const before: string[] = Array.isArray(current) ? current : []
      const removed = before.filter((role) => !next.includes(role))
      const added = next.filter((role) => !before.includes(role))
      if (removed.length) return { tone: 'warning', text: t('{roles} won’t be offered when assigning new interventions and will no longer see their My interventions and appointments pages. Interventions already assigned to them stay assigned.', undefined, { roles: roleNames(removed) }) }
      if (added.length) return { tone: 'info', text: t('{roles} will be offered when assigning interventions and will see their My interventions pages.', undefined, { roles: roleNames(added) }) }
      return null
    }
    if (field === 'assignmentModel') {
      if (value === current) return null
      // Available work (functions/src/availableWork.ts) is on only for consultant_self_assign.
      if (value === 'consultant_self_assign') return { tone: 'warning', text: t('Facilitators get an Available work page and pick up interventions in their programmes and areas of support themselves. Facilitators with no areas set see nothing until operations add them. Operations can still assign and reassign.') }
      return { tone: 'warning', text: t('Facilitators will no longer see Available work; operations assign all interventions. Work they already picked up stays with them.') }
    }
    // Who picks up what comes from each facilitator's programmes and areas (Manage team), not from this setting.
    if (field === 'smeDivisionModel') return { tone: 'info', text: t('Recorded for reference only. Who picks up which SMEs’ work is decided by each facilitator’s programmes and areas of support on Manage team.') }
    if (field === 'hasDepartments') return { tone: 'warning', text: t('Adds the Structure page, where departments are added, and department options when setting up interventions. Turning departments off later needs a request to the platform admin.') }
    return { tone: 'warning', text: t('Adds the Structure page, where offices are added. Turning branches off later needs a request to the platform admin.') }
  }, [current, field, t, value])

  const unchanged = JSON.stringify(value) === JSON.stringify(current)
  const invalid = value === undefined
    || (field === 'consultantLabel' && !String(value).trim())
    || (field === 'interventionDeliveryRoles' && !roles.length)

  const save = async () => {
    if (!field || !settings || invalid) return
    setSaving(true)
    try {
      await updateCompanySetting(user, settings, field, field === 'consultantLabel' ? String(value).trim() : value as string | boolean | string[])
      message.success(t('Setting saved. The platform admin has been told about the change.'))
      onSaved()
      onClose()
    } catch (error) {
      console.error('[SETTINGS] Direct change failed:', error)
      message.error(t('The setting could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const title = field === 'hasDepartments' ? t('Turn on departments') : field === 'hasBranches' ? t('Turn on branches or offices') : field ? t(SETUP_SETTINGS[field]) : ''

  return (
    <Modal
      open={Boolean(field)}
      centered
      destroyOnHidden
      title={title}
      onCancel={onClose}
      footer={(
        <ModalActions>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} disabled={invalid || unchanged} onClick={() => void save()}>
            {impact?.tone === 'warning' ? t('Confirm change') : t('Save change')}
          </Button>
        </ModalActions>
      )}
    >
      <div className="settings-edit">
        {field === 'consultantLabel' && (
          <Input value={String(value ?? '')} maxLength={40} placeholder={t('For example: Mentors')} onChange={(event) => setValue(event.target.value)} />
        )}
        {field === 'interventionDeliveryRoles' && (
          <Checkbox.Group
            value={roles}
            onChange={(next) => setValue(next as string[])}
            options={(Object.keys(DELIVERY_ROLE_LABELS) as InterventionDeliveryRole[]).map((role) => ({ value: role, label: t(DELIVERY_ROLE_LABELS[role]) }))}
          />
        )}
        {field === 'assignmentModel' && (
          <Select className="settings-edit-select" value={value as string | undefined} placeholder={t('Choose an option')} onChange={setValue}
            options={Object.entries(ASSIGNMENT_OPTIONS).map(([key, label]) => ({ value: key, label: t(label) }))} />
        )}
        {field === 'smeDivisionModel' && (
          <Select className="settings-edit-select" value={value as string | undefined} placeholder={t('Choose an option')} onChange={setValue}
            options={Object.entries(DIVISION_OPTIONS).map(([key, label]) => ({ value: key, label: t(label) }))} />
        )}
        {(field === 'hasDepartments' || field === 'hasBranches') && (
          <Typography.Text>{field === 'hasDepartments' ? t('Your company will use departments.') : t('Your company will use branches or offices.')}</Typography.Text>
        )}
        {impact && <Alert type={impact.tone} showIcon message={impact.text} />}
        {field === 'interventionDeliveryRoles' && !roles.length && (
          <Typography.Text type="danger">{t('Choose at least one delivery role.')}</Typography.Text>
        )}
      </div>
    </Modal>
  )
}
