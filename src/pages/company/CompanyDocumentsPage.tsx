import { useEffect, useState } from 'react'
import { Card, Col, Row, Skeleton, Typography } from 'antd'
import { FileProtectOutlined, FolderOpenOutlined } from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { CompanyDetailsForm } from '@/components/training/CompanyDetailsForm'
import { LibraryList } from '@/components/training/LibraryList'
import { listTrainingLibrary } from '@/services/trainingLibraryService'
import { organisationCompleteness } from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import type { TrainingLibraryItem } from '@/types/training'

/**
 * A client company's documents: those it gives its training provider (CIPC registration, B-BBEE certificate, ...) and
 * the course materials and documents the provider shares with it.
 */
export default function CompanyDocumentsPage() {
    const { t } = useLanguage()
    const { user, organisation, detailsSettings, provider, reload } = useMyOrganisation()
    const [materials, setMaterials] = useState<TrainingLibraryItem[]>()

    useEffect(() => {
        if (!user) return
        let cancelled = false
        listTrainingLibrary(user).then((rows) => { if (!cancelled) setMaterials(rows) }, () => { if (!cancelled) setMaterials([]) })
        return () => { cancelled = true }
    }, [user])

    const done = organisation ? organisationCompleteness(organisation, detailsSettings) : null

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={12}>
                    <DashboardMetricCard loading={!done} icon={<FileProtectOutlined />} label={t('Our documents given')} mobileTitle={t('Ours')} value={done ? `${done.documents}/${done.documentsAsked}` : '—'} />
                </Col>
                <Col xs={12} lg={12}>
                    <DashboardMetricCard loading={!materials} icon={<FolderOpenOutlined />} label={t('Course materials from {provider}', undefined, { provider })} mobileTitle={t('Course materials')} value={materials?.length ?? 0} />
                </Col>
            </Row>
            <Row gutter={[14, 14]}>
                <Col xs={24} lg={12}>
                    <Card title={t('Our company documents')} style={{ height: '100%' }}>
                        <Typography.Paragraph type="secondary">{t('The documents {provider} asks of every company it trains. Only you and {provider} can open them.', undefined, { provider })}</Typography.Paragraph>
                        {organisation
                            ? detailsSettings.companyDocuments.length
                                ? <CompanyDetailsForm organisation={organisation} settings={detailsSettings} part="documents" onSaved={() => void reload()} />
                                : <Typography.Text type="secondary">{t('{provider} does not ask for any documents.', undefined, { provider })}</Typography.Text>
                            : <Skeleton active />}
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card title={t('Course materials')} style={{ height: '100%' }}>
                        <Typography.Paragraph type="secondary">{t('Documents and links {provider} shares with your company and your people.', undefined, { provider })}</Typography.Paragraph>
                        {materials ? <LibraryList items={materials} emptyText={t('Nothing shared yet.')} /> : <Skeleton active />}
                    </Card>
                </Col>
            </Row>
        </DashboardPage>
    )
}
