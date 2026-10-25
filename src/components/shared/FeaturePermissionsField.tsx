import { Checkbox } from 'antd'
import { FEATURE_PERMISSION_OPTIONS } from '@/config/permissions'
import type { IdentityPermission } from '@/types/identity'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/feature-permissions.css'

type FeaturePermissionsFieldProps = {
  value?: IdentityPermission[]
  onChange?: (permissions: IdentityPermission[]) => void
  /** Shows the access without letting it change, e.g. a manager looking at their own. */
  disabled?: boolean
}

const featurePermissions = FEATURE_PERMISSION_OPTIONS.map((option) => option.value)

export const FeaturePermissionsField = ({ value = [], onChange, disabled }: FeaturePermissionsFieldProps) => {
  const { t } = useLanguage()
  const selected = value.filter((permission) => featurePermissions.includes(permission))
  const baseline = value.filter((permission) => !featurePermissions.includes(permission))
  const fullAccess = featurePermissions.every((permission) => selected.includes(permission))
  const toggle = (permission: IdentityPermission, checked: boolean) => {
    const next = checked ? [...selected, permission] : selected.filter((item) => item !== permission)
    onChange?.([...baseline, ...next])
  }

  return (
    <div className="feature-permissions">
      <label className={`feature-permission-card feature-permission-card-full${fullAccess ? ' is-selected' : ''}`}>
        <Checkbox checked={fullAccess} disabled={disabled} onChange={(event) => onChange?.([...baseline, ...(event.target.checked ? featurePermissions : [])])} />
        <strong>{t('permissions.fullAccess')}</strong>
      </label>
      <div className="feature-permissions-grid">
        {FEATURE_PERMISSION_OPTIONS.map((option) => {
          const checked = selected.includes(option.value)
          return (
            <label key={option.value} className={`feature-permission-card${checked ? ' is-selected' : ''}`}>
              <Checkbox checked={checked} disabled={disabled} onChange={(event) => toggle(option.value, event.target.checked)} />
              <span>{t(option.labelKey)}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}
