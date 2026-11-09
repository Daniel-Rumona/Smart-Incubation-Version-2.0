import { useEffect, useState } from 'react'
import { Card, Descriptions, Result, Skeleton } from 'antd'
import { useParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { isFirebaseConfigured } from '@/config/firebase'
import { useLanguage } from '@/providers/LanguageProvider'
import { getCertificateVerification } from '@/services/trainingCertificatesService'
import type { CertificateVerification } from '@/types/training'
import '@/styles/training.css'

/**
 * Public page behind a certificate's link and QR code: anyone (an employer, a client) can confirm it was issued and
 * is still valid. No sign-in; it shows only what is printed on the certificate.
 */
export default function VerifyCertificatePage() {
    const { t } = useLanguage()
    const { certificateId = '' } = useParams()
    const [record, setRecord] = useState<CertificateVerification | null>()
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        if (!isFirebaseConfigured || !certificateId) return
        let cancelled = false
        void getCertificateVerification(certificateId)
            .then((found) => { if (!cancelled) setRecord(found) })
            .catch(() => { if (!cancelled) setFailed(true) })
        return () => { cancelled = true }
    }, [certificateId])

    const unavailable = failed || !isFirebaseConfigured || !certificateId

    const details = record && (
        <Descriptions column={1} bordered size="middle" className="verify-certificate-details">
            <Descriptions.Item label={t('Learner')}>{record.learnerName}</Descriptions.Item>
            <Descriptions.Item label={t('Course')}>{record.courseTitle}</Descriptions.Item>
            <Descriptions.Item label={t('Training dates')}>{record.trainingDates}</Descriptions.Item>
            <Descriptions.Item label={t('Issued by')}>{record.providerName}</Descriptions.Item>
            <Descriptions.Item label={t('Issued on')}>{dayjs(record.issuedOn).format('D MMMM YYYY')}</Descriptions.Item>
            <Descriptions.Item label={t('Certificate number')}>{record.certificateNumber}</Descriptions.Item>
        </Descriptions>
    )

    return (
        <main className="verify-certificate-page">
            <Card className="verify-certificate-card">
                {unavailable ? (
                    <Result status="warning" title={t('This certificate could not be checked right now')} subTitle={t('Please try again later.')} />
                ) : record === undefined ? (
                    <Skeleton active paragraph={{ rows: 6 }} />
                ) : record === null ? (
                    <Result status="warning" title={t('Certificate not found')} subTitle={t('Check the link, or ask the person who gave you the certificate for its QR code.')} />
                ) : record.status === 'valid' ? (
                    <Result status="success" title={t('Valid certificate of completion')} subTitle={t('This certificate was issued as shown below and is still valid.')} extra={details} />
                ) : (
                    <Result
                        status="error"
                        title={t('This certificate is no longer valid')}
                        subTitle={record.cancelledAt
                            ? t('It was cancelled on {date}.', undefined, { date: dayjs(record.cancelledAt).format('D MMMM YYYY') })
                            : t('It has been cancelled.')}
                        extra={details}
                    />
                )}
            </Card>
        </main>
    )
}
