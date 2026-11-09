import { Card, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, SignatureOutlined } from '@ant-design/icons'
import { useIdentity } from '@/contexts/IdentityProvider'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/signature-card.css'

const { Text } = Typography

/**
 * The signature on file, shown on every profile page: whether there is one and what it looks like, since it is
 * what goes onto agreements and documents the person signs. It is set up during Welcome or when first signing.
 */
export const SignatureCard = ({ bare = false }: { bare?: boolean }) => {
  const { t } = useLanguage()
  const { user } = useIdentity()
  const url = user?.signatureURL || ''

  const status = url
    ? <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>{t('On file')}</Tag>
    : <Tag style={{ margin: 0 }}>{t('Not added yet')}</Tag>

  const content = (
    <div className="signature-card">
      {bare && <div className="signature-card-head"><strong><SignatureOutlined /> {t('Signature')}</strong>{status}</div>}
      {url ? (
        <div className="signature-card-paper">
          <img src={url} alt={t('Your signature')} />
        </div>
      ) : (
        <div className="signature-card-paper is-empty">
          <Text type="secondary">{t('No signature yet. You will be asked to add one the first time you sign an agreement or document.')}</Text>
        </div>
      )}
      {url && <Text type="secondary" className="signature-card-note">{t('This goes on the agreements and documents you sign.')}</Text>}
    </div>
  )

  if (bare) return content
  return (
    <Card className="dashboard-section-card motion-card" title={<Space><SignatureOutlined /> {t('Signature')} {status}</Space>}>
      {content}
    </Card>
  )
}

export default SignatureCard
