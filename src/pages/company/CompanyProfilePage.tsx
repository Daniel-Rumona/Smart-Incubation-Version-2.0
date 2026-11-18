import { Card, Skeleton, Tabs, Typography } from 'antd'
import DashboardPage from '@/components/shared/DashboardPage'
import { CompanyDetailsForm } from '@/components/training/CompanyDetailsForm'
import CompanyBusinessPage from '@/pages/company/CompanyBusinessPage'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import { organisationCompleteness } from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/company-portal.css'

/**
 * The client company's profile: everything about the business in one place. Its details, the documents its
 * training provider asks for, and its business figures month by month.
 */
export default function CompanyProfilePage() {
    const { t } = useLanguage()
    const { organisation, detailsSettings, provider, reload } = useMyOrganisation()

    if (!organisation) return <DashboardPage><Skeleton active paragraph={{ rows: 8 }} /></DashboardPage>
    const done = organisationCompleteness(organisation, detailsSettings)

    return (
        <DashboardPage className="training-page cp-page">
            <div className="cp-head">
                <div>
                    <Typography.Title level={3} style={{ margin: 0 }}>{organisation.name}</Typography.Title>
                    <Typography.Text type="secondary">{t('Company profile · {fields} of {fieldsAsked} details and {documents} of {documentsAsked} documents given', undefined, { fields: done.fields, fieldsAsked: done.fieldsAsked, documents: done.documents, documentsAsked: done.documentsAsked })}</Typography.Text>
                </div>
            </div>
            <Tabs
                size="large"
                items={[
                    {
                        key: 'details', label: t('Company details'),
                        children: <Card><CompanyDetailsForm organisation={organisation} settings={detailsSettings} part="details" onSaved={() => void reload()} /></Card>,
                    },
                    {
                        key: 'documents', label: t('Documents'),
                        children: (
                            <Card>
                                <Typography.Paragraph type="secondary">{t('The documents {provider} asks of every company it trains. Only you and {provider} can open them.', undefined, { provider })}</Typography.Paragraph>
                                {detailsSettings.companyDocuments.length
                                    ? <CompanyDetailsForm organisation={organisation} settings={detailsSettings} part="documents" onSaved={() => void reload()} />
                                    : <Typography.Text type="secondary">{t('{provider} does not ask for any documents.', undefined, { provider })}</Typography.Text>}
                            </Card>
                        ),
                    },
                    { key: 'figures', label: t('Business figures'), children: <CompanyBusinessPage /> },
                ]}
            />
        </DashboardPage>
    )
}
