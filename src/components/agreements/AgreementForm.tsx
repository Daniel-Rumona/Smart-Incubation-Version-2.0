import { useState } from 'react'
import { Button, Checkbox, Typography } from 'antd'
import { AuditOutlined, CheckCircleOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { COMPANY_AGREEMENTS, type CompanyAgreementKey } from '@/config/agreements'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/agreements.css'

type AgreementFormProps = {
  agreementKey: CompanyAgreementKey
  organisationName: string
  /** Shown beside the organisation name; omitted for the platform scope. */
  companyCode?: string
  /** Signs with the person's saved signature; resolves once recorded. */
  onSign: () => Promise<void>
  /** Step position, e.g. "1 of 2", when more than one agreement is being signed. */
  progress?: string
}

/**
 * One agreement to read and sign: the wording as it will be recorded, an explicit acceptance tick, then the
 * person's saved signature is attached. The wording is shown untranslated, since it is what gets recorded.
 */
export const AgreementForm = ({ agreementKey, organisationName, companyCode, onSign, progress }: AgreementFormProps) => {
  const { t } = useLanguage()
  const agreement = COMPANY_AGREEMENTS[agreementKey]
  const [accepted, setAccepted] = useState(false)
  const [signing, setSigning] = useState(false)

  const sign = async () => {
    setSigning(true)
    try {
      await onSign()
    } finally {
      setSigning(false)
    }
  }

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

      <Checkbox className="agreement-accept" checked={accepted} onChange={(event) => setAccepted(event.target.checked)}>
        {agreement.acceptLabel}
      </Checkbox>

      <div className="agreement-actions">
        <Typography.Text type="secondary">{t('Your saved signature is added when you sign.')}</Typography.Text>
        <Button type="primary" size="large" shape="round" icon={<CheckCircleOutlined />} disabled={!accepted} loading={signing} onClick={() => void sign()}>
          {t('Sign and accept')}
        </Button>
      </div>
    </div>
  )
}

export default AgreementForm
