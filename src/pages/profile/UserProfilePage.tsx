import { useEffect, useState } from 'react'
import { App, Avatar, Button, Card, Col, Form, Input, Row, Space, Switch, Tag, Typography, Upload } from 'antd'
import {
  CameraOutlined,
  CheckCircleFilled,
  IdcardOutlined,
  MessageOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { ConsultantWorkCard } from '@/components/consultant/ConsultantWorkCard'
import SignatureCard from '@/components/profile/SignatureCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useIdentity } from '@/contexts/IdentityProvider'
import { getCompanyName, getUserProfile, saveUserProfile, uploadUserProfileImage, type UserProfileValues, type WhatsAppConsentStatus } from '@/services/userProfileService'
import { isValidWhatsAppNumber, saveWhatsAppConsent } from '@/services/onboardingService'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import '@/styles/profile.css'

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

// Same check as Manage team uses for staff phone numbers.
const PHONE_PATTERN = /^\+?[0-9\s-]{8,16}$/

const initialsOf = (name: string, email: string) =>
  (name || email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')

const sameValues = (left?: UserProfileValues, right?: UserProfileValues) => JSON.stringify(left) === JSON.stringify(right)

export const UserProfilePage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user, updateIdentity } = useIdentity()
  const [values, setValues] = useState<UserProfileValues>()
  // The profile as last saved, so the page can tell when there are unsaved changes.
  const [savedValues, setSavedValues] = useState<UserProfileValues>()
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showErrors, setShowErrors] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [whatsappConsent, setWhatsappConsent] = useState<WhatsAppConsentStatus>(null)
  const [savingWhatsapp, setSavingWhatsapp] = useState(false)

  useEffect(() => {
    if (!user) return
    const load = (next: UserProfileValues) => { setValues(next); setSavedValues(next) }
    void getUserProfile(user.uid)
      .then(({ saved: alreadySaved, whatsappConsent: consent, ...profile }) => {
        setSaved(alreadySaved)
        setWhatsappConsent(consent)
        load({ ...profile, name: profile.name || user.displayName })
      })
      .catch(() => load({ name: user.displayName, bio: '', phone: '', phoneIsWhatsApp: false, alternativePhone: '', alternativePhoneIsWhatsApp: false, profileImageUrl: '' }))
    if (user.companyCode) void getCompanyName(user.companyCode).then(setCompanyName)
  }, [user])

  const dirty = !!values && !!savedValues && !sameValues(values, savedValues)

  // Leaving the page (reload, close, typed URL) with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!user || !values) return <PageSkeleton variant="detail" label={t('Loading your profile')} />

  const update = (patch: Partial<UserProfileValues>) => setValues((current) => (current ? { ...current, ...patch } : current))

  // Problems shown under their field once a save has been tried, instead of a toast.
  const errors: Partial<Record<'name' | 'phone' | 'alternativePhone', string>> = {}
  if (!values.name.trim()) errors.name = t('Enter your name.')
  if (!values.phone.trim()) errors.phone = t('Add a phone number so your team can reach you.')
  else if (!PHONE_PATTERN.test(values.phone.trim())) errors.phone = t('Enter a valid phone number, including the country code.')
  if (values.alternativePhone.trim() && !PHONE_PATTERN.test(values.alternativePhone.trim())) errors.alternativePhone = t('Enter a valid phone number, including the country code.')
  const fieldError = (key: keyof typeof errors) => (showErrors ? errors[key] : undefined)

  const save = async () => {
    const first = (['name', 'phone', 'alternativePhone'] as const).find((key) => errors[key])
    if (first) {
      setShowErrors(true)
      const target = document.getElementById(`profile-field-${first}`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      target?.querySelector<HTMLElement>('input')?.focus()
      return
    }
    try {
      setSaving(true)
      await saveUserProfile(user.uid, values)
      updateIdentity({ displayName: values.name.trim(), name: values.name.trim(), profileImageUrl: values.profileImageUrl || null })
      setSavedValues(values)
      setSaved(true)
      setShowErrors(false)
      message.success(t(saved ? 'Profile updated.' : 'Profile saved.'))
    } catch {
      message.error(t('Your profile could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  // Accounts that predate consent keep getting alerts while their number is marked as WhatsApp, so show that as "on".
  const whatsappOn = whatsappConsent === 'opted_in' || (whatsappConsent === null && values.phoneIsWhatsApp)

  const changeWhatsapp = async (optIn: boolean) => {
    if (optIn && !isValidWhatsAppNumber(values.phone)) {
      setShowErrors(true)
      message.warning(t('Add a valid primary phone number above first, then turn this on.'))
      document.getElementById('profile-field-phone')?.querySelector<HTMLElement>('input')?.focus()
      return
    }
    try {
      setSavingWhatsapp(true)
      await saveWhatsAppConsent(optIn ? { optIn: true, phone: values.phone, source: 'profile' } : { optIn: false, source: 'profile' })
      setWhatsappConsent(optIn ? 'opted_in' : 'declined')
      if (optIn) {
        update({ phoneIsWhatsApp: true })
        setSavedValues((current) => (current ? { ...current, phoneIsWhatsApp: true } : current))
      }
      message.success(optIn ? t('WhatsApp updates are on.') : t('WhatsApp updates are off.'))
    } catch {
      message.error(t('Your WhatsApp choice could not be saved.'))
    } finally {
      setSavingWhatsapp(false)
    }
  }

  // A new photo saves straight away on top of the last saved profile, so it never saves half-finished edits with it.
  const uploadImage = async (file: File) => {
    if (!savedValues) return
    try {
      setUploading(true)
      const profileImageUrl = await uploadUserProfileImage(user.uid, file)
      await saveUserProfile(user.uid, { ...savedValues, profileImageUrl })
      updateIdentity({ profileImageUrl })
      setSavedValues({ ...savedValues, profileImageUrl })
      update({ profileImageUrl })
      setSaved(true)
      message.success(t('Photo updated.'))
    } catch {
      message.error(t('The photo could not be uploaded.'))
    } finally {
      setUploading(false)
    }
  }

  const focusField = (field: string) => {
    const target = document.getElementById(field)
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    target?.querySelector<HTMLElement>('input, textarea')?.focus()
  }

  const checklist: Array<{ key: string; label: string; done: boolean; required: boolean; action: string; onAction: () => void }> = [
    { key: 'name', label: t('Name and email'), done: !!savedValues?.name.trim(), required: true, action: t('Add'), onAction: () => focusField('profile-field-name') },
    { key: 'photo', label: t('Profile photo'), done: !!savedValues?.profileImageUrl, required: false, action: t('Add'), onAction: () => document.querySelector<HTMLElement>('.profile-photo-target')?.click() },
    { key: 'phone', label: t('Phone number'), done: !!savedValues?.phone.trim() && PHONE_PATTERN.test(savedValues.phone.trim()), required: true, action: t('Add'), onAction: () => focusField('profile-field-phone') },
    { key: 'whatsapp', label: t('WhatsApp updates'), done: whatsappOn, required: false, action: t('Turn on'), onAction: () => void changeWhatsapp(true) },
  ]
  const doneCount = checklist.filter((item) => item.done).length

  return (
    <DashboardPage>
      <Row gutter={[16, 16]}>
        {/* On desktop the identity card stays put while the details scroll, instead of stretching into an empty panel. */}
        <Col xs={24} lg={8} className="profile-identity-col">
          <Card
            className="dashboard-section-card motion-card"
            style={{ textAlign: 'center' }}
            styles={{ body: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 24 } }}
          >
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                void uploadImage(file)
                return false
              }}
            >
              <div className="profile-photo-target" style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}>
                <Avatar size={96} shape="circle" src={values.profileImageUrl || undefined} icon={!values.profileImageUrl && !values.name ? <UserOutlined /> : undefined} style={{ fontSize: 32 }}>
                  {initialsOf(values.name, user.email)}
                </Avatar>
                <Button shape="circle" icon={<CameraOutlined />} loading={uploading} style={{ position: 'absolute', right: -4, bottom: -4 }} aria-label={t('Change photo')} />
              </div>
            </Upload>
            <Title level={4} style={{ margin: '14px 0 6px' }}>{values.name || user.email}</Title>
            <Space size={6} wrap style={{ justifyContent: 'center' }}>
              <Tag color="purple" style={{ margin: 0 }}>{t(ROLE_LABELS[user.role] || user.role)}</Tag>
              {user.emailVerified && <Tag color="green" icon={<SafetyCertificateOutlined />} style={{ margin: 0 }}>{t('Verified')}</Tag>}
            </Space>
            {user.companyCode && <Text type="secondary" style={{ marginTop: 6 }}>{companyName || user.companyCode}</Text>}

            <div className="profile-checklist" aria-label={t('Profile checklist')}>
              <strong>{t('Profile {done} of {total} done', undefined, { done: doneCount, total: checklist.length })}</strong>
              <ul>
                {checklist.map((item) => (
                  <li key={item.key} className={item.done ? 'is-done' : item.required ? 'is-missing' : 'is-optional'}>
                    {item.done ? <CheckCircleFilled /> : <span className="profile-checklist-ring" />}
                    <span>{item.label}{!item.done && !item.required && <small> · {t('optional')}</small>}</span>
                    {!item.done && <button type="button" onClick={item.onAction}>{item.action}</button>}
                  </li>
                ))}
              </ul>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Card className="dashboard-section-card motion-card" title={<Space><IdcardOutlined /> {t('Personal details')}</Space>}>
              <Form layout="vertical">
                <Row gutter={12}>
                  <Col xs={24} md={12} id="profile-field-name">
                    <Form.Item label={t('Full name')} required validateStatus={fieldError('name') ? 'error' : undefined} help={fieldError('name')}>
                      <Input value={values.name} onChange={(event) => update({ name: event.target.value })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item label={t('Email')}>
                      <Input value={user.email} disabled />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={16} id="profile-field-phone">
                    <Form.Item label={t('Primary phone')} required validateStatus={fieldError('phone') ? 'error' : undefined} help={fieldError('phone')}>
                      <Input value={values.phone} placeholder={t('Include country code, e.g. +27...')} onChange={(event) => update({ phone: event.target.value })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label={t('WhatsApp number')}>
                      <Switch checked={values.phoneIsWhatsApp} checkedChildren={tr('Yes')} unCheckedChildren={tr('No')} onChange={(checked) => update({ phoneIsWhatsApp: checked })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={16} id="profile-field-alternativePhone">
                    <Form.Item label={t('Alternative phone')} validateStatus={fieldError('alternativePhone') ? 'error' : undefined} help={fieldError('alternativePhone')}>
                      <Input value={values.alternativePhone} placeholder={t('Optional')} onChange={(event) => update({ alternativePhone: event.target.value })} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={8}>
                    <Form.Item label={t('WhatsApp number')}>
                      <Switch checked={values.alternativePhoneIsWhatsApp} checkedChildren={tr('Yes')} unCheckedChildren={tr('No')} onChange={(checked) => update({ alternativePhoneIsWhatsApp: checked })} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item label={t('About you')} style={{ marginBottom: 0 }}>
                      <Input.TextArea rows={3} value={values.bio} maxLength={400} showCount placeholder={t('A short introduction colleagues will see')} onChange={(event) => update({ bio: event.target.value })} />
                    </Form.Item>
                  </Col>
                </Row>
              </Form>
            </Card>

            <Card className="dashboard-section-card motion-card" title={<Space><MessageOutlined /> {t('WhatsApp updates')}</Space>}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                  <Text strong style={{ display: 'block' }}>{t('Receive deadlines, follow-up reminders and appointment notices on WhatsApp')}</Text>
                  <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>
                    {whatsappOn
                      ? `${t('Sent to')} ${values.phone || t('your WhatsApp number')}. ${t('Reply STOP to the bot at any time to turn this off.')}`
                      : whatsappConsent === 'opted_out'
                        ? t('You opted out by replying STOP. Turn this on to start receiving updates again.')
                        : t('Off. We will not send you proactive WhatsApp messages.')}
                  </Text>
                </div>
                <Switch
                  size="default"
                  checked={whatsappOn}
                  loading={savingWhatsapp}
                  checkedChildren={tr('Yes')}
                  unCheckedChildren={tr('No')}
                  aria-label={t('WhatsApp updates')}
                  onChange={(checked) => void changeWhatsapp(checked)}
                />
              </div>
            </Card>

            <SignatureCard />

            {/* Company consultants (marketplace ones have their own profile page): areas and hours, set by operations. */}
            {user.role === 'consultant' && <ConsultantWorkCard uid={user.uid} companyCode={user.companyCode} />}

            <div className="profile-save-bar">
              {dirty && <span className="profile-unsaved">{t('Unsaved changes')}</span>}
              <Button block type="primary" icon={<SaveOutlined />} loading={saving} disabled={!dirty && !showErrors} onClick={() => void save()}>{t(saved ? 'Update profile' : 'Save profile')}</Button>
            </div>
          </Space>
        </Col>
      </Row>
    </DashboardPage>
  )
}

export default UserProfilePage
