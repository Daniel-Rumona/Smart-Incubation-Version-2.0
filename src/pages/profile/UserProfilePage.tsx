import { useEffect, useState } from 'react'
import { App, Avatar, Button, Card, Col, Form, Input, Row, Space, Switch, Tag, Typography, Upload } from 'antd'
import {
  BankOutlined,
  CameraOutlined,
  IdcardOutlined,
  MailOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  UserOutlined,
} from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useIdentity } from '@/contexts/IdentityProvider'
import { getCompanyName, getUserProfile, saveUserProfile, uploadUserProfileImage, type UserProfileValues } from '@/services/userProfileService'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Text, Title } = Typography

const ROLE_LABELS: Record<string, string> = {
  systemadmin: 'System administrator',
  admin: 'Administrator',
  director: 'Director',
  projectadmin: 'Project administrator',
  projectmanager: 'Project manager',
  operations: 'Operations',
  consultant: 'Consultant',
  incubatee: 'SME',
}

const initialsOf = (name: string, email: string) =>
  (name || email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')


export const UserProfilePage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user, updateIdentity } = useIdentity()
  const [values, setValues] = useState<UserProfileValues>()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    if (!user) return
    void getUserProfile(user.uid)
      .then(({ saved: alreadySaved, ...profile }) => {
        setSaved(alreadySaved)
        setValues({ ...profile, name: profile.name || user.displayName })
      })
      .catch(() => setValues({ name: user.displayName, bio: '', phone: '', phoneIsWhatsApp: false, alternativePhone: '', alternativePhoneIsWhatsApp: false, profileImageUrl: '' }))
    if (user.companyCode) void getCompanyName(user.companyCode).then(setCompanyName)
  }, [user])

  if (!user || !values) return <LoadingOverlay tip={t('Loading your profile')} />

  const update = (patch: Partial<UserProfileValues>) => setValues((current) => (current ? { ...current, ...patch } : current))

  const save = async (next: UserProfileValues = values) => {
    if (!next.name.trim()) {
      message.warning(t('Please enter your name.'))
      return false
    }
    try {
      setSaving(true)
      await saveUserProfile(user.uid, next)
      updateIdentity({ displayName: next.name.trim(), name: next.name.trim(), profileImageUrl: next.profileImageUrl || null })
      setSaved(true)
      message.success(t(saved ? 'Profile updated.' : 'Profile saved.'))
      return true
    } catch {
      message.error(t('Your profile could not be saved.'))
      return false
    } finally {
      setSaving(false)
    }
  }

  const uploadImage = async (file: File) => {
    try {
      setUploading(true)
      const profileImageUrl = await uploadUserProfileImage(user.uid, file)
      const next = { ...values, profileImageUrl }
      setValues(next)
      await save(next)
    } catch {
      message.error(t('The photo could not be uploaded.'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <DashboardPage>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card
            className="dashboard-section-card motion-card"
            style={{ height: '100%', textAlign: 'center' }}
            styles={{ body: { height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: 24 } }}
          >
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadImage(file)
                return false
              }}
            >
              <div style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
                <Avatar size={112} shape="circle" src={values.profileImageUrl || undefined} icon={!values.profileImageUrl && !values.name ? <UserOutlined /> : undefined} style={{ fontSize: 38 }}>
                  {initialsOf(values.name, user.email)}
                </Avatar>
                <Button shape="circle" icon={<CameraOutlined />} loading={uploading} style={{ position: 'absolute', right: -4, bottom: -4 }} aria-label={t('Change photo')} />
              </div>
            </Upload>
            <Title level={4} style={{ margin: '16px 0 8px' }}>{values.name || user.email}</Title>
            <Space size={6} wrap style={{ justifyContent: 'center' }}>
              <Tag color="purple" style={{ margin: 0 }}>{ROLE_LABELS[user.role] || user.role}</Tag>
              {user.emailVerified && <Tag color="green" icon={<SafetyCertificateOutlined />} style={{ margin: 0 }}>{t('Verified')}</Tag>}
            </Space>
            <div style={{ width: '100%', marginTop: 22, paddingTop: 20, borderTop: '1px solid rgba(109, 93, 251, 0.16)', display: 'flex', flexDirection: 'column', gap: 14, textAlign: 'left' }}>
              {[
                { key: 'email', icon: <MailOutlined />, label: t('Email'), value: user.email },
                { key: 'company', icon: <BankOutlined />, label: t('Company'), value: user.companyCode ? (companyName || user.companyCode) : '' },
                { key: 'phone', icon: <PhoneOutlined />, label: t('Phone'), value: values.phone },
              ].filter((item) => item.value).map((item) => (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{ width: 36, height: 36, flexShrink: 0, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#6d5dfb', background: 'rgba(109, 93, 251, 0.12)' }}>{item.icon}</span>
                  <div style={{ minWidth: 0, lineHeight: 1.3 }}>
                    <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{item.label}</Text>
                    <Text strong ellipsis style={{ display: 'block' }}>{item.value}</Text>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card className="dashboard-section-card motion-card" title={<Space><IdcardOutlined /> {t('Personal details')}</Space>}>
              <Form layout="vertical">
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item label={t('Full name')} required>
                      <Input value={values.name} onChange={(event) => update({ name: event.target.value })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label={t('Email')}>
                      <Input value={user.email} disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label={t('Role')}>
                      <Input value={ROLE_LABELS[user.role] || user.role} disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label={t('Company')}>
                      <Input value={user.companyCode ? (companyName || user.companyCode) : '—'} disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={16}>
                    <Form.Item label={t('Primary phone')}>
                      <Input value={values.phone} placeholder={t('Include country code, e.g. +27...')} onChange={(event) => update({ phone: event.target.value })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label={t('WhatsApp number')}>
                      <Switch checked={values.phoneIsWhatsApp} checkedChildren={tr('Yes')} unCheckedChildren={tr('No')} onChange={(checked) => update({ phoneIsWhatsApp: checked })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={16}>
                    <Form.Item label={t('Alternative phone')}>
                      <Input value={values.alternativePhone} placeholder={t('Optional')} onChange={(event) => update({ alternativePhone: event.target.value })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label={t('WhatsApp number')}>
                      <Switch checked={values.alternativePhoneIsWhatsApp} checkedChildren={tr('Yes')} unCheckedChildren={tr('No')} onChange={(checked) => update({ alternativePhoneIsWhatsApp: checked })} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item label={t('About you')}>
                      <Input.TextArea rows={3} value={values.bio} maxLength={400} showCount placeholder={t('A short introduction colleagues will see')} onChange={(event) => update({ bio: event.target.value })} />
                    </Form.Item>
                  </Col>
                </Row>
                <Button block type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void save()}>{t(saved ? 'Update profile' : 'Save profile')}</Button>
              </Form>
            </Card>

          </Space>
        </Col>
      </Row>
    </DashboardPage>
  )
}

export default UserProfilePage
