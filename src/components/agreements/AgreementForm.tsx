import { useEffect, useRef, useState } from 'react'
import { App, Button, Checkbox, Typography } from 'antd'
import { AuditOutlined, CheckCircleFilled, CheckCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import SignatureReplay from '@/components/shared/SignatureReplay'
import { COMPANY_AGREEMENTS, type CompanyAgreementKey } from '@/config/agreements'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/agreements.css'
import '@/styles/signature-replay.css'

type AgreementFormProps = {
  agreementKey: CompanyAgreementKey
  organisationName: string
  /** Shown beside the organisation name; omitted for the platform scope. */
  companyCode?: string
  /** Records the agreement with the person's saved signature; throws if it could not be saved. */
  onSign: () => Promise<void>
  /** Moves on, once the signature has been written onto the line and the agreement is saved. */
  onSigned: () => void
  /** Step position, e.g. "1 of 2", when more than one agreement is being signed. */
  progress?: string
}

type Phase = 'ready' | 'signing' | 'signed'

/** How long "Signed" stays on screen before the next step, so the person sees it land. */
const SIGNED_PAUSE_MS = 700

/**
 * One agreement to read and sign: the wording as it will be recorded, an explicit acceptance tick, then the
 * person's saved signature writes itself onto the line while the agreement is saved. The wording is shown
 * untranslated, since it is what gets recorded.
 */
export const AgreementForm = ({ agreementKey, organisationName, companyCode, onSign, onSigned, progress }: AgreementFormProps) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const agreement = COMPANY_AGREEMENTS[agreementKey]
  const [accepted, setAccepted] = useState(false)
  const [phase, setPhase] = useState<Phase>('ready')
  // Signed means both the save landed and the signature finished writing.
  const progressRef = useRef({ saved: false, written: false })
  const signedRef = useRef(onSigned)

  useEffect(() => { signedRef.current = onSigned }, [onSigned])

  useEffect(() => {
    if (phase !== 'signed') return
    const timeout = window.setTimeout(() => signedRef.current(), SIGNED_PAUSE_MS)
    return () => window.clearTimeout(timeout)
  }, [phase])

  const settle = () => {
    if (progressRef.current.saved && progressRef.current.written) setPhase(current => (current === 'signing' ? 'signed' : current))
  }

  const sign = async () => {
    progressRef.current = { saved: false, written: false }
    setPhase('signing')
    try {
      await onSign()
      progressRef.current.saved = true
      settle()
    } catch (error) {
      setPhase('ready')
      message.error(error instanceof Error ? error.message : t('The agreement could not be saved.'))
    }
  }

  const signerName = user?.name || user?.displayName || user?.email || ''
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="agreement-form">
      <div className="agreement-head">
        <span className="agreement-icon">{agreementKey === 'code-of-conduct' ? <AuditOutlined /> : <SafetyCertificateOutlined />}</span>
        <div>
          {progress && <span className="agreement-progress">{progress}</span>}
          <Typography.Title level={4}>{agreement.title}</Typography.Title>
          <Typography.Paragraph>{agreement.subtitle}</Typography.Paragraph>
          <Typography.Text type="secondary">
            {t('Recorded for {organisation}', undefined, { organisation: companyCode && companyCode !== 'platform' ? `${organisationName} (${companyCode})` : organisationName })}
          </Typography.Text>
        </div>
      </div>

      <div className="agreement-body" tabIndex={0} aria-label={agreement.title}>
        {agreement.sections.map((section) => (
          <section key={section.title}>
            <h5>{section.title}</h5>
            {section.body && <p>{section.body}</p>}
            {section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}
          </section>
        ))}
      </div>

      <Checkbox className="agreement-accept" checked={accepted} disabled={phase !== 'ready'} onChange={(event) => setAccepted(event.target.checked)}>
        {agreement.acceptLabel}
      </Checkbox>

      <div className={`sign-document-sheet agreement-signature is-${phase}`}>
        <div className="sign-document-line">
          <span className="sign-document-mark" aria-hidden="true">×</span>
          {phase === 'ready' && <span className="sign-document-placeholder">{t('Your saved signature is added when you sign.')}</span>}
          <SignatureReplay
            strokes={user?.signatureStrokes}
            imageUrl={user?.signatureURL}
            playing={phase !== 'ready'}
            alt={t('{name} signature', undefined, { name: signerName })}
            onComplete={() => { progressRef.current.written = true; settle() }}
          />
        </div>
        <div className="sign-document-meta">
          <Typography.Text strong>{signerName}</Typography.Text>
          <Typography.Text type="secondary">{today}</Typography.Text>
        </div>
      </div>

      <div className="agreement-actions">
        <span className="agreement-signed-status" aria-live="polite">
          {phase === 'signed' && <Typography.Text className="sign-document-done"><CheckCircleFilled /> {t('Signed')}</Typography.Text>}
        </span>
        <Button type="primary" size="large" shape="round" icon={<CheckCircleOutlined />} disabled={!accepted || phase === 'signed'} loading={phase === 'signing'} onClick={() => void sign()}>
          {phase === 'signing' ? t('Signing...') : t('Sign and accept')}
        </Button>
      </div>
    </div>
  )
}

export default AgreementForm
