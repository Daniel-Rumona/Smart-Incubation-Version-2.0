import { useRef, useState } from 'react'
import { App, Button, QRCode, type ButtonProps } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useLanguage } from '@/providers/LanguageProvider'
import { certificateVerifyUrl } from '@/services/trainingCertificatesService'
import { downloadCertificatePdf } from '@/utils/certificatePdf'
import type { TrainingCertificate } from '@/types/training'

type Props = Omit<ButtonProps, 'onClick' | 'loading'> & {
    certificate: TrainingCertificate
    label?: string
}

/** Downloads the certificate as a PDF. The QR code (its verification link) is drawn off-screen and copied onto the page. */
export const CertificateDownloadButton = ({ certificate, label, ...buttonProps }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const qrRef = useRef<HTMLDivElement>(null)
    const [busy, setBusy] = useState(false)
    const verifyUrl = certificateVerifyUrl(certificate.id)

    const download = async () => {
        setBusy(true)
        try {
            await downloadCertificatePdf(certificate, verifyUrl, qrRef.current?.querySelector('canvas') ?? null)
        } catch {
            message.error(t('The certificate could not be created. Please try again.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <>
            <div ref={qrRef} aria-hidden style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}>
                <QRCode value={verifyUrl} type="canvas" size={480} bordered={false} color="#1f2a30" bgColor="#ffffff" errorLevel="M" />
            </div>
            <Button icon={<DownloadOutlined />} loading={busy} onClick={() => void download()} {...buttonProps}>
                {label || t('Download certificate')}
            </Button>
        </>
    )
}
