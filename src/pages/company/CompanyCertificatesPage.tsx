import { useEffect, useMemo, useState } from 'react'
import { Button, Col, Row, Space, Tag, Typography, type TableProps } from 'antd'
import { BookOutlined, SafetyCertificateOutlined, StopOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { CertificateDownloadButton } from '@/components/training/CertificateDownloadButton'
import { listMyOrganisationCertificates } from '@/services/companyPortalService'
import { certificateVerifyUrl } from '@/services/trainingCertificatesService'
import { useLanguage } from '@/providers/LanguageProvider'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import type { TrainingCertificate } from '@/types/training'

/** A client company's certificates: every certificate its people have earned, to download or check. */
export default function CompanyCertificatesPage() {
    const { t } = useLanguage()
    const { user, provider } = useMyOrganisation()
    const [certificates, setCertificates] = useState<TrainingCertificate[]>()
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        if (!user) return
        let cancelled = false
        listMyOrganisationCertificates(user).then((rows) => { if (!cancelled) setCertificates(rows) }, () => { if (!cancelled) { setFailed(true); setCertificates([]) } })
        return () => { cancelled = true }
    }, [user])

    const all = useMemo(() => certificates || [], [certificates])
    const valid = all.filter((certificate) => certificate.status === 'valid')

    const columns: TableProps<TrainingCertificate>['columns'] = [
        { title: t('Name'), dataIndex: 'learnerName', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
        { title: t('Course'), key: 'course', render: (_, row) => <Space orientation="vertical" size={0}><span>{row.courseTitle}</span><Typography.Text type="secondary">{row.trainingDates}</Typography.Text></Space> },
        { title: t('Certificate'), dataIndex: 'certificateNumber' },
        { title: t('Issued'), dataIndex: 'issuedOn', render: (value: string) => dayjs(value).format('D MMM YYYY') },
        { title: t('Status'), dataIndex: 'status', render: (status: string) => status === 'valid' ? <Tag color="green" icon={<SafetyCertificateOutlined />}>{t('Valid')}</Tag> : <Tag icon={<StopOutlined />}>{t('Cancelled')}</Tag> },
        {
            title: '',
            key: 'actions',
            align: 'right',
            render: (_, row) => (
                <Space wrap>
                    {row.status === 'valid' && <CertificateDownloadButton certificate={row} size="small" />}
                    <Button size="small" href={certificateVerifyUrl(row.id)} target="_blank" rel="noopener noreferrer">{t('Verification page')}</Button>
                </Space>
            ),
        },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={8}><DashboardMetricCard loading={!certificates} icon={<SafetyCertificateOutlined />} label={t('Valid certificates')} mobileTitle={t('Valid')} value={valid.length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={!certificates} icon={<BookOutlined />} label={t('Courses completed')} mobileTitle={t('Courses')} value={new Set(valid.map((row) => row.courseTitle)).size} /></Col>
                <Col xs={24} lg={8}><DashboardMetricCard loading={!certificates} icon={<SafetyCertificateOutlined />} label={t('Latest issued')} value={valid[0] ? dayjs(valid[0].issuedOn).format('D MMM YYYY') : '—'} /></Col>
            </Row>
            <ResponsiveDataView
                rowKey="id"
                rows={all}
                columns={columns}
                loading={!certificates}
                emptyText={failed ? t('Your certificates could not be loaded. Refresh the page to try again.') : t('No certificates yet. {provider} issues one to each of your people who passes.', undefined, { provider })}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{row.learnerName}</Typography.Text>
                            {row.status === 'valid' ? <Tag color="green">{t('Valid')}</Tag> : <Tag>{t('Cancelled')}</Tag>}
                        </Space>
                        <Typography.Text type="secondary">{row.courseTitle} · {row.trainingDates}</Typography.Text>
                        <Typography.Text>{row.certificateNumber}</Typography.Text>
                        <Space wrap>
                            {row.status === 'valid' && <CertificateDownloadButton certificate={row} size="small" />}
                            <Button size="small" href={certificateVerifyUrl(row.id)} target="_blank" rel="noopener noreferrer">{t('Verification page')}</Button>
                        </Space>
                    </Space>
                )}
            />
        </DashboardPage>
    )
}
