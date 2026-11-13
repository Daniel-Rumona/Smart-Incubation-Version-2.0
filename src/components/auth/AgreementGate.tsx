import { useEffect, useState, type PropsWithChildren } from 'react'
import { Alert, Button, Card } from 'antd'
import { Navigate } from 'react-router-dom'
import { COMPANY_AGREEMENTS_VERSION } from '@/config/agreements'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useLanguage } from '@/providers/LanguageProvider'
import { agreementScope, missingAgreements } from '@/services/agreementsService'
import type { FullIdentity } from '@/types/identity'
import '@/styles/agreements.css'

// Remount for each identity, organisation or required agreement set. No browser-storage
// flag can bypass verification, and the workspace cannot mount while it is pending.
export const AgreementGate = ({ children }: PropsWithChildren) => {
  const { user, loading } = useFullIdentity()
  const { t } = useLanguage()
  if (loading) return <LoadingOverlay tip={t('Loading')} />
  if (!user) return <Navigate to="/auth" replace />
  if (!user.emailVerified) return <Navigate to="/email-verification" replace />
  if (user.organisationAccessStatus && user.organisationAccessStatus !== 'approved') return <Navigate to="/organisation-access" replace />
  if (!user.firstLoginComplete) return <Navigate to="/welcome" replace />
  const key = JSON.stringify([user.uid, agreementScope(user), user.role, COMPANY_AGREEMENTS_VERSION])
  return <VerifiedAgreements key={key} user={user}>{children}</VerifiedAgreements>
}

const VerifiedAgreements = ({ user, children }: PropsWithChildren<{ user: FullIdentity }>) => {
  const { t } = useLanguage()
  const [status, setStatus] = useState<'checking' | 'signed' | 'missing' | 'error'>('checking')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    void missingAgreements(user).then(
      (missing) => { if (!cancelled) setStatus(missing.length ? 'missing' : 'signed') },
      () => { if (!cancelled) setStatus('error') },
    )
    return () => { cancelled = true }
  }, [user, attempt])

  if (status === 'checking') return <LoadingOverlay tip={t('Checking your agreements')} />
  if (status === 'missing') return <Navigate to="/consent" replace />
  if (status === 'error') return (
    <main className="consent-page">
      <Card className="consent-card" bordered={false}>
        <Alert type="error" showIcon message={t('Your agreements could not be verified. Please try again.')} />
        <Button onClick={() => { setStatus('checking'); setAttempt((value) => value + 1) }}>
          {t('Try again')}
        </Button>
      </Card>
    </main>
  )
  return children
}
