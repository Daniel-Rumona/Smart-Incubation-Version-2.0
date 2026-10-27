import { useEffect, useRef, useState } from 'react'
import { App, Button, Card, Typography } from 'antd'
import { ClearOutlined, SignatureOutlined } from '@ant-design/icons'
import { Navigate, useNavigate } from 'react-router-dom'
import SignatureCanvas from 'react-signature-canvas'
import { AgreementForm } from '@/components/agreements/AgreementForm'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import type { CompanyAgreementKey } from '@/config/agreements'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { agreementScope, missingAgreements, requiredAgreements, signAgreement } from '@/services/agreementsService'
import { getCompanyOverview } from '@/services/directorSetupService'
import { saveOnboardingSignature } from '@/services/onboardingService'
import { captureSignatureStrokes } from '@/utils/signatureStrokes'
import { getRoleHomePath } from '@/utils/roleRouting'
import { markAgreementsChecked } from '@/hooks/useAgreementGate'
import '@/styles/agreements.css'

/**
 * For people who finished Welcome before agreements existed, or after the wording changed: signature (only if they
 * have none), then each agreement they still need to sign. Welcome itself handles new accounts.
 */
export const ConsentPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { user, loading, updateIdentity } = useFullIdentity()
  const [pending, setPending] = useState<CompanyAgreementKey[] | null>(null)
  const [organisationName, setOrganisationName] = useState('')
  const [savingSignature, setSavingSignature] = useState(false)
  const canvasRef = useRef<SignatureCanvas>(null)

  useEffect(() => {
    if (!user) return
    let cancelled = false
    const scope = agreementScope(user)
    void Promise.all([
      missingAgreements(user).catch(() => requiredAgreements(user.role)),
      scope === 'platform' ? Promise.resolve(null) : getCompanyOverview(scope, user.uid).catch(() => null),
    ]).then(([missing, company]) => {
      if (cancelled) return
      setPending(missing)
      setOrganisationName(company?.name || (scope === 'platform' ? 'Smart Incubation' : scope))
    })
    return () => { cancelled = true }
  }, [user])

  if (loading || (user && pending === null)) return <PageSkeleton variant="detail" label={t('Loading')} />
  if (!user) return <Navigate to="/auth" replace />
  if (!user.firstLoginComplete) return <Navigate to="/welcome" replace />

  const home = getRoleHomePath(user.role, user.isApplicant, user.smeOnboardingComplete)
  const remaining = pending || []
  if (!remaining.length) return <Navigate to={home} replace />

  const saveSignature = async () => {
    const canvas = canvasRef.current
    if (!canvas || canvas.isEmpty()) {
      message.warning(t('welcome.signature.drawRequired', 'Please draw your signature first.'))
      return
    }
    try {
      setSavingSignature(true)
      const blob = await (await fetch(canvas.toDataURL('image/png'))).blob()
      const surface = canvas.getCanvas()
      const strokes = captureSignatureStrokes(canvas.toData(), surface.offsetWidth || surface.width, surface.offsetHeight || surface.height)
      const url = await saveOnboardingSignature(blob, 'drawn.png', strokes)
      updateIdentity({ signatureURL: url, signatureStrokes: strokes })
      message.success(t('welcome.signature.drawSuccess', 'Drawn signature saved.'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('welcome.signature.error', 'Your signature could not be saved.'))
    } finally {
      setSavingSignature(false)
    }
  }

  const sign = async (key: CompanyAgreementKey) => {
    try {
      await signAgreement(user, key, { signatureURL: user.signatureURL || '', companyName: organisationName })
      const next = remaining.filter((item) => item !== key)
      setPending(next)
      message.success(t('Signed.'))
      if (!next.length) {
        markAgreementsChecked(user.uid)
        navigate(home, { replace: true })
      }
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('The agreement could not be saved.'))
    }
  }

  const current = remaining[0]
  const total = requiredAgreements(user.role).length

  return (
    <main className="consent-page">
      <Card className="consent-card" bordered={false}>
        <div className="consent-intro">
          <Typography.Title level={3}>{t('Before you continue')}</Typography.Title>
          <Typography.Paragraph type="secondary">
            {t('We need your signed agreement to keep using Smart Incubation. It records what information we hold about you, why, and who it may be shared with, as POPIA requires.')}
          </Typography.Paragraph>
        </div>

        {!user.signatureURL ? (
          <div className="consent-signature">
            <div className="agreement-head">
              <span className="agreement-icon"><SignatureOutlined /></span>
              <div>
                <Typography.Title level={4}>{t('welcome.signature.title', 'Add your signature')}</Typography.Title>
                <Typography.Paragraph>{t('Draw your signature below. It is added to the agreements you sign, and you can replace it later from your profile.')}</Typography.Paragraph>
              </div>
            </div>
            <div className="consent-canvas">
              <SignatureCanvas ref={canvasRef} penColor="black" canvasProps={{ width: Math.min(520, window.innerWidth - 80), height: 180 }} />
            </div>
            <div className="agreement-actions">
              <Button icon={<ClearOutlined />} onClick={() => canvasRef.current?.clear()}>{t('Clear')}</Button>
              <Button type="primary" size="large" shape="round" loading={savingSignature} onClick={() => void saveSignature()}>{t('Save signature')}</Button>
            </div>
          </div>
        ) : (
          <AgreementForm
            key={current}
            agreementKey={current}
            organisationName={organisationName}
            companyCode={agreementScope(user)}
            progress={total > 1 ? t('{index} of {total}', undefined, { index: total - remaining.length + 1, total }) : undefined}
            onSign={() => sign(current)}
          />
        )}
      </Card>
    </main>
  )
}

export default ConsentPage
