import { useRef, useState } from 'react'
import { App, Button, Card, Space, Tag, Typography } from 'antd'
import { CheckCircleOutlined, ClearOutlined, EditOutlined, SignatureOutlined } from '@ant-design/icons'
import SignatureCanvas from 'react-signature-canvas'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { useIdentity } from '@/contexts/IdentityProvider'
import { useLanguage } from '@/providers/LanguageProvider'
import { saveOnboardingSignature } from '@/services/onboardingService'
import { captureSignatureStrokes } from '@/utils/signatureStrokes'
import '@/styles/agreements.css'
import '@/styles/signature-card.css'

const { Text } = Typography

/**
 * The signature on file, shown on every profile page: whether there is one and what it looks like, since it is
 * what goes onto agreements and documents the person signs. It can be added or replaced here. A new signature is
 * saved as a new file, so documents already signed keep the one they were signed with.
 */
export const SignatureCard = ({ bare = false }: { bare?: boolean }) => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user, updateIdentity } = useIdentity()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const canvasRef = useRef<SignatureCanvas>(null)
  const url = user?.signatureURL || ''

  const save = async () => {
    const canvas = canvasRef.current
    if (!canvas || canvas.isEmpty()) {
      message.warning(t('welcome.signature.drawRequired', 'Please draw your signature first.'))
      return
    }
    try {
      setSaving(true)
      const blob = await (await fetch(canvas.toDataURL('image/png'))).blob()
      const surface = canvas.getCanvas()
      const strokes = captureSignatureStrokes(canvas.toData(), surface.offsetWidth || surface.width, surface.offsetHeight || surface.height)
      const next = await saveOnboardingSignature(blob, 'drawn.png', strokes)
      updateIdentity({ signatureURL: next, signatureStrokes: strokes })
      message.success(t('Signature saved.'))
      setOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('welcome.signature.error', 'Your signature could not be saved.'))
    } finally {
      setSaving(false)
    }
  }

  const status = url
    ? <Tag color="green" icon={<CheckCircleOutlined />} style={{ margin: 0 }}>{t('On file')}</Tag>
    : <Tag style={{ margin: 0 }}>{t('Not added yet')}</Tag>
  const action = (
    <Button size="small" icon={<EditOutlined />} onClick={() => setOpen(true)}>{url ? t('Change') : t('Add signature')}</Button>
  )

  const content = (
    <div className="signature-card">
      {bare && <div className="signature-card-head"><strong><SignatureOutlined /> {t('Signature')}</strong>{status}<span className="signature-card-action">{action}</span></div>}
      {url ? (
        <div className="signature-card-paper">
          <img src={url} alt={t('Your signature')} />
        </div>
      ) : (
        <div className="signature-card-paper is-empty">
          <Text type="secondary">{t('No signature yet. Add one now, or you will be asked for it the first time you sign an agreement or document.')}</Text>
        </div>
      )}
      {url && <Text type="secondary" className="signature-card-note">{t('This goes on the agreements and documents you sign from now on. Documents you have already signed keep the signature you used then.')}</Text>}

      <ResponsiveModal
        open={open}
        onClose={() => { if (!saving) setOpen(false) }}
        title={url ? t('Change your signature') : t('Add your signature')}
        width={520}
        centered
        destroyOnHidden
        footer={(
          <div className="signature-card-modal-footer">
            <Button icon={<ClearOutlined />} onClick={() => canvasRef.current?.clear()} disabled={saving}>{t('Clear')}</Button>
            <Button type="primary" loading={saving} onClick={() => void save()}>{t('Save signature')}</Button>
          </div>
        )}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {url
            ? t('Draw your new signature below. Documents you have already signed keep the signature you used then.')
            : t('Draw your signature below. It is added to the agreements and documents you sign.')}
        </Text>
        <div className="consent-canvas">
          <SignatureCanvas ref={canvasRef} penColor="black" canvasProps={{ width: Math.min(470, window.innerWidth - 64), height: 180 }} />
        </div>
      </ResponsiveModal>
    </div>
  )

  if (bare) return content
  return (
    <Card className="dashboard-section-card motion-card" title={<Space><SignatureOutlined /> {t('Signature')} {status}</Space>} extra={action}>
      {content}
    </Card>
  )
}

export default SignatureCard
