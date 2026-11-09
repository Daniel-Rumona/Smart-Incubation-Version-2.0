import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Form, Input, Space, Typography } from 'antd'
import { doc, onSnapshot } from 'firebase/firestore'
import { Navigate, useNavigate } from 'react-router-dom'
import { getFirebaseDb } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { logoutUser } from '@/services/authService'
import { submitOrganisationRequest, type OrganisationAccessRequest } from '@/services/organisationAccessService'
import '@/styles/agreements.css'

export default function OrganisationAccessPage() {
  const { user, loading } = useFullIdentity()
  const { t } = useLanguage()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [request, setRequest] = useState<OrganisationAccessRequest | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const uid = user?.uid
  useEffect(() => {
    if (!uid) return
    return onSnapshot(doc(getFirebaseDb(), 'organisationAccessRequests', uid), snapshot => {
      setRequest(snapshot.exists() ? snapshot.data() as OrganisationAccessRequest : null)
      setReady(true)
      setError('')
    }, () => { setError(t('Your request could not be loaded. Please try again.')); setReady(true) })
  }, [uid, attempt, t])

  if (loading) return <PageSkeleton variant="detail" />
  if (!user) return <Navigate to="/auth" replace />
  if (!user.emailVerified) return <Navigate to="/email-verification" replace />

  const submit = async (values: Pick<OrganisationAccessRequest, 'contactName' | 'organisationName' | 'phone' | 'notes'>) => {
    setSaving(true)
    try {
      await submitOrganisationRequest(values)
      message.success(t('Your organisation access request has been submitted.'))
    } catch (err) {
      message.error(err instanceof Error ? err.message : t('Your request could not be submitted.'))
    } finally { setSaving(false) }
  }
  const status = request?.status || user.organisationAccessStatus
  return (
    <main className="consent-page">
      <Card className="consent-card" bordered={false}>
        <Typography.Title level={3}>{t('Organisation access')}</Typography.Title>
        {!ready ? <PageSkeleton variant="detail" /> : error ? (
          <Space orientation="vertical"><Alert type="error" showIcon message={error} /><Button onClick={() => setAttempt(value => value + 1)}>{t('Try again')}</Button></Space>
        ) : status === 'approved' ? (
          <Space orientation="vertical">
            <Alert type="success" showIcon message={t('Your organisation request has been approved.')} description={t('You can now set up your organisation and complete your agreements.')} />
            <Button type="primary" onClick={() => navigate('/welcome', { replace: true })}>{t('Continue setup')}</Button>
          </Space>
        ) : status ? (
          <Alert type={status === 'rejected' ? 'warning' : 'info'} showIcon
            message={t(status === 'rejected' ? 'Your organisation request was not approved.' : 'Awaiting approval')}
            description={status === 'rejected' ? request?.reason || t('Contact daniel@quantilytix.co.za to discuss your request.') : t('We will review your request before enabling organisation setup. You can return here to check its status.')} />
        ) : user.role === 'director' || user.companyCode || user.firstLoginComplete ? (
          <Button onClick={() => navigate('/welcome', { replace: true })}>{t('Return to your account')}</Button>
        ) : (
          <>
            <Typography.Paragraph>{t('Tell us about your organisation to arrange a demo and request access. Organisation setup is available after approval.')}</Typography.Paragraph>
            <Form layout="vertical" initialValues={{ contactName: user.name || user.displayName, phone: '', notes: '' }} onFinish={submit}>
              <Form.Item name="contactName" label={t('Your name')} rules={[{ required: true, whitespace: true, max: 120 }]}><Input maxLength={120} autoComplete="name" /></Form.Item>
              <Form.Item name="organisationName" label={t('Organisation name')} rules={[{ required: true, whitespace: true, min: 2, max: 120 }]}><Input maxLength={120} autoComplete="organization" /></Form.Item>
              <Form.Item label={t('Email')}><Input value={user.email} disabled /></Form.Item>
              <Form.Item name="phone" label={t('Phone')}><Input maxLength={40} autoComplete="tel" /></Form.Item>
              <Form.Item name="notes" label={t('Tell us about your programmes and demo availability')}><Input.TextArea rows={4} maxLength={2000} showCount /></Form.Item>
              <Space wrap><Button type="primary" htmlType="submit" loading={saving}>{t('Request access')}</Button><Button disabled={saving} onClick={() => navigate('/welcome')}>{t('Back')}</Button></Space>
            </Form>
          </>
        )}
        <Button type="link" style={{ marginTop: 24 }} onClick={() => void logoutUser().then(() => navigate('/auth', { replace: true })).catch(() => message.error(t('You could not be logged out. Please try again.')))}>{t('Sign out')}</Button>
      </Card>
    </main>
  )
}
