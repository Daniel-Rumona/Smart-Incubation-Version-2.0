import { useEffect, useState } from 'react'
import { App, Button, Card, Col, Drawer, Empty, List, Row, Space, Table, Tag, Typography } from 'antd'
import { CheckCircleOutlined, FileTextOutlined, FileWordOutlined } from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ESG_SECTORS, countryName, esgFramework, sectorStandardFor } from '@/config/esgStandards'
import { listMyOrganisationEsgReports } from '@/services/companyPortalService'
import { useLanguage } from '@/providers/LanguageProvider'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import { ESG_SECTIONS } from '@/utils/esgReportChecks'
import { downloadEsgReportDocx, periodLabel, statementOfUse } from '@/utils/esgReportDocx'
import type { EsgReport } from '@/types/esg'

/**
 * A client company's ESG reports, as its training provider prepares them: shown once shared for review or final
 * (never a draft). Read-only, with the Word report to download.
 */
export default function CompanyEsgPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user, provider, logoUrl } = useMyOrganisation()
    const [reports, setReports] = useState<EsgReport[]>()
    const [open, setOpen] = useState<EsgReport | null>(null)
    const [downloading, setDownloading] = useState(false)

    useEffect(() => {
        if (!user) return
        let cancelled = false
        listMyOrganisationEsgReports(user).then((rows) => { if (!cancelled) setReports(rows) }, () => { if (!cancelled) setReports([]) })
        return () => { cancelled = true }
    }, [user])

    const download = async (report: EsgReport) => {
        setDownloading(true)
        try {
            await downloadEsgReportDocx(report, { name: provider, logoUrl })
        } catch {
            message.error(t('The Word report could not be made.'))
        } finally {
            setDownloading(false)
        }
    }

    const all = reports || []
    const statusTag = (report: EsgReport) => report.status === 'final'
        ? <Tag color="green" icon={<CheckCircleOutlined />}>{t('Final')}</Tag>
        : <Tag color="gold">{t('In review')}</Tag>

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={12}><DashboardMetricCard loading={!reports} icon={<FileTextOutlined />} label={t('ESG reports shared with you')} mobileTitle={t('Reports')} value={all.length} /></Col>
                <Col xs={12} lg={12}><DashboardMetricCard loading={!reports} icon={<CheckCircleOutlined />} label={t('Final')} value={all.filter((report) => report.status === 'final').length} /></Col>
            </Row>
            <Card title={t('Your ESG reports')}>
                <List
                    loading={!reports}
                    dataSource={all}
                    locale={{ emptyText: <Empty description={t('{provider} shares your ESG report here once it is ready for your review.', undefined, { provider })} /> }}
                    renderItem={(report) => (
                        <List.Item
                            extra={(
                                <Space wrap>
                                    <Button onClick={() => setOpen(report)}>{t('View')}</Button>
                                    <Button type="primary" icon={<FileWordOutlined />} loading={downloading} onClick={() => void download(report)}>{t('Word report')}</Button>
                                </Space>
                            )}
                        >
                            <List.Item.Meta
                                title={<Space wrap>{t('ESG report')} · {periodLabel(report)}{statusTag(report)}</Space>}
                                description={[t(ESG_SECTORS.find((item) => item.key === report.sector)?.label || report.sector), countryName(report.country)].join(' · ')}
                            />
                        </List.Item>
                    )}
                />
            </Card>
            <Drawer open={Boolean(open)} onClose={() => setOpen(null)} size="large" title={open ? `${t('ESG report')} · ${periodLabel(open)}` : ''}>
                {open && (
                    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
                        <Space wrap>{statusTag(open)}<Button icon={<FileWordOutlined />} loading={downloading} onClick={() => void download(open)}>{t('Download the Word report')}</Button></Space>
                        <section>
                            <Typography.Title level={5}>{t('Standards')}</Typography.Title>
                            <Typography.Paragraph>{statementOfUse(open)}</Typography.Paragraph>
                            <Space wrap size={[4, 4]}>
                                <Tag color="green">GRI</Tag>
                                {sectorStandardFor(open.sector) && <Tag>{sectorStandardFor(open.sector)?.id}</Tag>}
                                {open.frameworks.map((id) => <Tag key={id}>{esgFramework(id)?.short(open.periodStart) || id}</Tag>)}
                            </Space>
                        </section>
                        {ESG_SECTIONS.map((section) => {
                            const written = open.narrative.find((item) => item.key === section.key && item.text.trim())
                            return written ? (
                                <section key={section.key}>
                                    <Typography.Title level={5}>{t(section.title)}</Typography.Title>
                                    {written.text.split(/\n{2,}/).map((paragraph, index) => <Typography.Paragraph key={index}>{paragraph}</Typography.Paragraph>)}
                                </section>
                            ) : null
                        })}
                        {open.indicators.length > 0 && (
                            <section>
                                <Typography.Title level={5}>{t('Figures')}</Typography.Title>
                                <Table
                                    rowKey="id"
                                    size="small"
                                    pagination={false}
                                    scroll={{ x: 'max-content' }}
                                    dataSource={open.indicators}
                                    columns={[
                                        { title: t('What is measured'), dataIndex: 'indicator' },
                                        { title: t('Unit'), dataIndex: 'unit' },
                                        { title: t('Baseline'), dataIndex: 'baseline' },
                                        { title: t('Current'), dataIndex: 'current' },
                                        { title: t('Target'), dataIndex: 'target' },
                                    ]}
                                />
                            </section>
                        )}
                    </Space>
                )}
            </Drawer>
        </DashboardPage>
    )
}
