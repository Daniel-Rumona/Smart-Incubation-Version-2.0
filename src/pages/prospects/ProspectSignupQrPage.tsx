import { useEffect, useState } from 'react'
import { Card, QRCode, Result, Skeleton, Typography } from 'antd'
import { useParams } from 'react-router-dom'
import { isFirebaseConfigured } from '@/config/firebase'
import { useLanguage } from '@/providers/LanguageProvider'
import { getSignupInfo, signupLinkUrl, type SignupInfo } from '@/services/prospectsService'
import '@/styles/training.css'

/**
 * A team member's own sign-up code, full screen (/p/<code>/qr): the link WhatsApp sends them for an event where the
 * team is looking for SMEs. They open it on their phone and show it at the stand; people scan it and land on the
 * sign-up form (/p/<code>). No sign-in: the code is already public, it only opens the form.
 */
export default function ProspectSignupQrPage() {
    const { t } = useLanguage()
    const { code = '' } = useParams()
    const [info, setInfo] = useState<SignupInfo | null>()

    useEffect(() => {
        if (!isFirebaseConfigured || !code) return
        let cancelled = false
        void getSignupInfo(code)
            .then((found) => { if (!cancelled) setInfo(found) })
            .catch(() => { if (!cancelled) setInfo(null) })
        return () => { cancelled = true }
    }, [code])

    return (
        <main className="verify-certificate-page">
            <Card className="verify-certificate-card" style={{ textAlign: 'center' }}>
                {info === undefined && isFirebaseConfigured && code ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                ) : !info ? (
                    <Result status="warning" title={t('This sign-up link is closed')} subTitle={t('Ask the person who shared it for a new one.')} />
                ) : (
                    <>
                        {info.logoUrl && <img src={info.logoUrl} alt="" style={{ maxHeight: 48, marginBottom: 8 }} />}
                        <Typography.Title level={3} style={{ marginTop: 0, marginBottom: 4 }}>{info.label || t('Register your interest')}</Typography.Title>
                        <Typography.Paragraph type="secondary">{t('Scan to leave your details with {company}.', undefined, { company: info.companyName || t('the programme team') })}</Typography.Paragraph>
                        <div style={{ display: 'grid', placeItems: 'center', margin: '12px 0' }}>
                            <QRCode value={signupLinkUrl(code)} size={260} bgColor="#ffffff" color="#111111" />
                        </div>
                        {info.ownerFirstName && <Typography.Text type="secondary">{t('{name}’s code', undefined, { name: info.ownerFirstName })}</Typography.Text>}
                    </>
                )}
            </Card>
        </main>
    )
}
