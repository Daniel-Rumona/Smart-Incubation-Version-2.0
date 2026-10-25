import { useState } from 'react'
import { Alert, App, Button, Card, Checkbox, Space, Typography, Upload } from 'antd'
import { PictureOutlined, SaveOutlined, TeamOutlined, UploadOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  AREA_LABELS,
  DELEGABLE_ROLES,
  ROLE_LABELS,
  canManageArea,
  readDelegation,
  saveCompanyLogo,
  saveDelegation,
  type Delegation,
  type DelegationArea,
  type DelegableRole,
} from '@/services/companyDelegationService'
import type { SystemSettingsRecord } from '@/types/companySettings'

const { Text } = Typography

type Props = { settings: SystemSettingsRecord | null; onChanged: () => void }

/** Director only: choose which roles may manage departments/offices and the company logo. */
export const DelegationCard = ({ settings, onChanged }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const [value, setValue] = useState<Delegation>(() => readDelegation(settings))
  const [saving, setSaving] = useState(false)

  if (!user || user.role !== 'director' || !user.companyCode || !settings) return null
  const companyCode = user.companyCode

  const save = async () => {
    try {
      setSaving(true)
      await saveDelegation(user, companyCode, value)
      message.success(t('Delegation saved.'))
      onChanged()
    } catch {
      message.error(t('Delegation could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="dashboard-section-card motion-card" title={<Space><TeamOutlined />{t('Delegate control')}</Space>}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Text type="secondary">{t('Choose who may manage each area. Everyone in your company can always see them.')}</Text>
        {(Object.keys(AREA_LABELS) as DelegationArea[]).map((area) => (
          <div key={area}>
            <Text strong>{t(AREA_LABELS[area].title)}</Text>
            <div><Text type="secondary">{t(AREA_LABELS[area].description)}</Text></div>
            <Checkbox.Group
              style={{ marginTop: 8 }}
              value={value[area]}
              onChange={(next) => setValue((current) => ({ ...current, [area]: next as DelegableRole[] }))}
              options={DELEGABLE_ROLES.map((role) => ({ value: role, label: t(ROLE_LABELS[role]) }))}
            />
          </div>
        ))}
        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>{t('Save delegation')}</Button>
      </Space>
    </Card>
  )
}

/** Directors, and project admins / operations when the director delegated branding to them. */
export const CompanyLogoCard = ({ settings, onChanged }: Props) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const [uploading, setUploading] = useState(false)

  if (!user?.companyCode || !settings) return null
  const companyCode = user.companyCode
  const logoUrl = String((settings as { logoUrl?: unknown }).logoUrl || '')
  const canChange = canManageArea(user.role, settings, 'branding')

  const upload = async (file: File) => {
    try {
      setUploading(true)
      await saveCompanyLogo(user, companyCode, file)
      message.success(t('Company logo updated. Reload the page to see it everywhere.'))
      onChanged()
    } catch {
      message.error(t('The logo could not be uploaded.'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="dashboard-section-card motion-card" title={<Space><PictureOutlined />{t('Company logo')}</Space>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        {logoUrl ? <img src={logoUrl} alt={t('Company logo')} style={{ maxHeight: 80, maxWidth: '100%' }} /> : <Text type="secondary">{t('No logo has been uploaded yet.')}</Text>}
        {canChange ? (
          <Upload accept=".png,.jpg,.jpeg,.webp" showUploadList={false} beforeUpload={(file) => { void upload(file); return false }}>
            <Button icon={<UploadOutlined />} loading={uploading}>{logoUrl ? t('Replace logo') : t('Upload logo')}</Button>
          </Upload>
        ) : (
          <Alert type="info" showIcon message={t('Your director manages the company logo.')} />
        )}
      </Space>
    </Card>
  )
}
