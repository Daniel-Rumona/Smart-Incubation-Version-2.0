import { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Col, List, Modal, Result, Row, Segmented, Select, Space, Tag, Typography, Upload } from 'antd'
import { ArrowLeftOutlined, EditOutlined, FileExcelOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { EsgContentIndex } from '@/components/esg/EsgContentIndex'
import { EsgDraftPanel } from '@/components/esg/EsgDraftPanel'
import { EsgFootprintPanel } from '@/components/esg/EsgFootprintPanel'
import { EsgRegisterTable } from '@/components/esg/EsgRegisterTable'
import { EsgReportFormModal } from '@/components/esg/EsgReportFormModal'
import { carbonTaxEstimate, footprintTotals, formatQuantity } from '@/config/esgEmissions'
import { ESG_SECTORS, alignedStandards, countryName } from '@/config/esgStandards'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { saveEsgRegister, setEsgReportStatus, subscribeEsgReport } from '@/services/esgReportsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { checkEsgReport, esgCompleteness } from '@/utils/esgReportChecks'
import { periodLabel, statementOfUse } from '@/utils/esgReportDocx'
import { readEsgToolkitFile, type EsgToolkitImport } from '@/utils/esgToolkitImport'
import type { EsgRegisterKey, EsgReport, EsgReportStatus } from '@/types/esg'
import '@/styles/training.css'

type ViewKey = 'figures' | 'footprint' | 'report' | 'more'
type MoreKey = 'standards' | 'risks' | 'stakeholders' | 'actions' | 'index'
const REGISTER_LABELS: Record<EsgRegisterKey, string> = { indicators: 'Figures', risks: 'Risk register', stakeholders: 'Stakeholder map', actions: 'Action plan' }

/** What each optional part is for, in a line. */
const MORE_HELP: Record<MoreKey, string> = {
    standards: 'The reporting standards this report follows and why. Change them under Report details.',
    risks: 'Optional: what could go wrong for the client, how likely and how serious, and what they do about it.',
    stakeholders: 'Optional: who cares about the client\'s impact (workers, community, regulators) and how the client talks to them.',
    actions: 'Optional: what the client will do to improve, who does it and by when.',
    index: 'The table GRI reports end with: which disclosure is where. Built for you from the figures and sections.',
}

export default function EsgReportPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { settings } = useSystemSettings()
    const navigate = useNavigate()
    const { reportId = '' } = useParams()
    const [report, setReport] = useState<EsgReport | null>()
    const [view, setView] = useState<ViewKey>('figures')
    const [more, setMore] = useState<MoreKey>('standards')
    const [noteClosed, setNoteClosed] = useState(false)
    const [openSections, setOpenSections] = useState<string[]>([])
    const [editing, setEditing] = useState(false)
    const [imported, setImported] = useState<EsgToolkitImport | null>(null)
    const [importing, setImporting] = useState(false)

    useEffect(() => {
        if (!user) return undefined
        return subscribeEsgReport(user, reportId, setReport, () => setReport(null))
    }, [reportId, user])

    const checks = useMemo(() => (report ? checkEsgReport(report) : []), [report])
    const issues = useMemo(() => {
        const byRow = new Map<string, string[]>()
        for (const check of checks) if (check.rowId) byRow.set(check.rowId, [...(byRow.get(check.rowId) || []), check.message])
        return byRow
    }, [checks])
    const aligned = useMemo(() => (report ? alignedStandards(report) : null), [report])
    const footprint = useMemo(() => (report ? footprintTotals(report.footprint) : null), [report])
    const provider = { name: String(settings.companyName || settings.name || ''), logoUrl: typeof settings.logoUrl === 'string' ? settings.logoUrl : null }

    useRegisterAgentPageContext({
        pageKey: 'esg-report',
        pageName: 'ESG report',
        purpose: 'Prepare one client\'s ESG report: the standards it is aligned to, the data, risk, stakeholder and action registers, checks, the written sections and the GRI content index.',
        currentFilters: { view },
        metrics: report ? { completenessPct: esgCompleteness(report), checks: checks.length, indicators: report.indicators.length, risks: report.risks.length } : {},
        dataSummary: report && aligned ? {
            client: report.clientName,
            sector: report.sector,
            country: report.country,
            period: periodLabel(report),
            status: report.status,
            standards: [aligned.sector?.id, ...aligned.topics.map((item) => item.id), ...aligned.frameworks.map((item) => item.label)].filter(Boolean),
            indicators: report.indicators.map((row) => ({ pillar: row.pillar, indicator: row.indicator, unit: row.unit, baseline: row.baseline, current: row.current, target: row.target, disclosure: row.disclosure })),
            checks: checks.slice(0, 12).map((check) => check.message),
            carbonFootprintTCO2e: footprint && report.footprint.sources.length ? {
                total: formatQuantity(footprint.total),
                scope1: formatQuantity(footprint.byScope[1]),
                scope2: formatQuantity(footprint.byScope[2]),
                scope3: formatQuantity(footprint.byScope[3]),
                sources: report.footprint.sources.map((source) => ({ scope: source.scope, source: source.label, unit: source.unit, factorKgPerUnit: source.factor, factorSource: source.factorSource })),
                carbonTaxPayer: report.footprint.carbonTaxPayer,
                carbonTaxEstimate: (() => {
                    const tax = carbonTaxEstimate(report.footprint, report)
                    return tax.applies ? { taxableTonnes: formatQuantity(tax.tonnes), beforeAllowancesZar: Math.round(tax.gross), allowancePct: tax.allowancePct, estimatedZar: Math.round(tax.net) } : tax.reason
                })(),
            } : null,
        } : {},
    })

    if (report === undefined) return <PageSkeleton variant="detail" label={t('Loading report')} />
    if (report === null || !user) {
        return <Result status="404" title={t('Report not found')} extra={<Button onClick={() => navigate('/esg/reports')}>{t('All reports')}</Button>} />
    }

    const readToolkit = async (file: File) => {
        try {
            const result = await readEsgToolkitFile(file)
            if (!Object.keys(result.sheets).length) {
                message.warning(t('No ESG registers were found. The workbook needs sheets headed like the ESG toolkit (Pillar, Indicator, Unit, ...).'))
                return
            }
            setImported(result)
        } catch {
            message.error(t('The workbook could not be read. Choose an Excel workbook (.xlsx).'))
        }
    }

    const applyImport = async (mode: 'add' | 'replace') => {
        if (!imported) return
        setImporting(true)
        try {
            for (const key of ['indicators', 'risks', 'stakeholders', 'actions'] as EsgRegisterKey[]) {
                const rows = imported[key]
                if (!rows) continue
                await saveEsgRegister(user, report.id, key, mode === 'replace' ? rows : [...report[key], ...rows])
            }
            message.success(t('Imported the ESG toolkit workbook.'))
            setImported(null)
            setView('figures')
        } catch {
            message.error(t('The registers could not be saved.'))
        } finally {
            setImporting(false)
        }
    }

    const changeStatus = async (status: EsgReportStatus) => {
        try {
            await setEsgReportStatus(user, report.id, status)
        } catch {
            message.error(t('The status could not be changed.'))
        }
    }

    const sector = ESG_SECTORS.find((item) => item.key === report.sector)?.label || report.sector

    return (
        <DashboardPage className="training-page">
            <MotionCard className="training-class-header">
                <Space orientation="vertical" size={4} style={{ width: '100%' }}>
                    <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate('/esg/reports')} className="training-back-link">{t('All ESG reports')}</Button>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }} wrap>
                        <Typography.Title level={4} style={{ margin: 0 }}>{report.clientName}</Typography.Title>
                        <Space wrap>
                            <Select
                                value={report.status}
                                onChange={(status) => void changeStatus(status)}
                                style={{ width: 140 }}
                                options={[{ value: 'draft', label: t('Draft') }, { value: 'in_review', label: t('In review') }, { value: 'final', label: t('Final') }]}
                            />
                            <Upload accept=".xlsx" showUploadList={false} beforeUpload={(file) => { void readToolkit(file); return false }}>
                                <Button icon={<FileExcelOutlined />}>{t('Import ESG toolkit')}</Button>
                            </Upload>
                            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>{t('Report details')}</Button>
                        </Space>
                    </Space>
                    <Typography.Text type="secondary">{t(sector)} · {countryName(report.country)} · {periodLabel(report)}</Typography.Text>
                    {aligned && (
                        <Space wrap size={[4, 4]}>
                            <Typography.Text type="secondary">{t('Follows')}:</Typography.Text>
                            <Tag color="green">GRI</Tag>
                            {aligned.sector && <Tag>{aligned.sector.id}</Tag>}
                            {aligned.frameworks.map((item) => <Tag key={item.id}>{item.short}</Tag>)}
                            {report.otherFrameworks && <Tag>{t('+ other')}</Tag>}
                            <Button type="link" size="small" onClick={() => setEditing(true)} style={{ paddingInline: 4 }}>{t('Change')}</Button>
                        </Space>
                    )}
                </Space>
            </MotionCard>

            {!noteClosed && (
                <Alert
                    type="info"
                    showIcon
                    closable
                    onClose={() => setNoteClosed(true)}
                    style={{ marginBottom: 12 }}
                    message={t('From the figures to the Word report')}
                    description={t('Add the client\'s figures (or import your ESG toolkit), record the carbon footprint (Scope 1, 2 and 3), write or AI-draft the sections, then download the Word report. It is set out like a published sustainability report: performance at a glance, climate and energy, the data tables, approval and the GRI content index.')}
                />
            )}

            <MotionCard>
                <Segmented
                    block
                    value={view}
                    onChange={(value) => setView(value as ViewKey)}
                    style={{ marginBottom: 16 }}
                    options={[
                        { value: 'figures', label: `${t('1. Figures')} (${report.indicators.length})` },
                        { value: 'footprint', label: `${t('2. Carbon footprint')}${report.footprint.sources.length ? ` (${formatQuantity(footprint?.total || 0)} t)` : ''}` },
                        { value: 'report', label: t('3. Written report') },
                        { value: 'more', label: t('More') },
                    ]}
                />
                {view === 'figures' && (
                    <>
                        <Typography.Paragraph type="secondary">{t('The client\'s figures: what is measured, its unit, the starting point (baseline), now (current) and the goal (target). Import them from the ESG toolkit, or add them here.')}</Typography.Paragraph>
                        <EsgRegisterTable key={`indicators-${report.updatedAt}`} register="indicators" rows={report.indicators as never} issues={issues} onSave={(rows) => saveEsgRegister(user, report.id, 'indicators', rows as never)} />
                    </>
                )}
                {view === 'footprint' && <EsgFootprintPanel key={`footprint-${report.updatedAt}`} report={report} issues={issues} />}
                {view === 'more' && (
                    <Space orientation="vertical" size={12} style={{ width: '100%' }}>
                        <Segmented
                            value={more}
                            onChange={(value) => setMore(value as MoreKey)}
                            options={[
                                { value: 'standards', label: t('Standards') },
                                { value: 'risks', label: `${t('Risks')} (${report.risks.length})` },
                                { value: 'stakeholders', label: `${t('Stakeholders')} (${report.stakeholders.length})` },
                                { value: 'actions', label: `${t('Actions')} (${report.actions.length})` },
                                { value: 'index', label: t('GRI content index') },
                            ]}
                        />
                        <Typography.Text type="secondary">{t(MORE_HELP[more])}</Typography.Text>
                        {(['risks', 'stakeholders', 'actions'] as const).includes(more as 'risks') && (
                            <EsgRegisterTable
                                key={`${more}-${report.updatedAt}`}
                                register={more as EsgRegisterKey}
                                rows={report[more as EsgRegisterKey] as never}
                                issues={issues}
                                onSave={(rows) => saveEsgRegister(user, report.id, more as EsgRegisterKey, rows as never)}
                            />
                        )}
                        {more === 'index' && <EsgContentIndex report={report} />}
                    </Space>
                )}
                {view === 'more' && more === 'standards' && aligned && (
                    <Space orientation="vertical" size={14} style={{ width: '100%' }}>
                        <Alert type="success" showIcon message={statementOfUse(report)} />
                        <Row gutter={[14, 14]}>
                            <Col xs={24} lg={12}>
                                <Card size="small" title={t('GRI Standards')}>
                                    <List size="small" dataSource={[
                                        ...aligned.universal.map((item) => `${item.id}: ${item.title}`),
                                        aligned.sector ? `${aligned.sector.id}: ${aligned.sector.title}` : t('No GRI Sector Standard for this sector'),
                                        ...aligned.topics.map((item) => `${item.id}: ${item.title}`),
                                    ]} renderItem={(item) => <List.Item>{item}</List.Item>} />
                                    {!aligned.topics.length && <Typography.Text type="secondary">{t('Topic Standards follow from the data: link each indicator to its GRI disclosure.')}</Typography.Text>}
                                </Card>
                            </Col>
                            <Col xs={24} lg={12}>
                                <Card size="small" title={t('Country and other frameworks')}>
                                    {aligned.frameworks.length || report.otherFrameworks ? (
                                        <List size="small" dataSource={aligned.frameworks} renderItem={(item) => (
                                            <List.Item><Space orientation="vertical" size={0}><Typography.Text strong>{item.label}</Typography.Text><Typography.Text type="secondary">{item.note}</Typography.Text></Space></List.Item>
                                        )} footer={report.otherFrameworks ? <Typography.Text>{t('Also: {frameworks}', undefined, { frameworks: report.otherFrameworks })}</Typography.Text> : undefined} />
                                    ) : <Typography.Text type="secondary">{t('None chosen. Add them under Report details.')}</Typography.Text>}
                                </Card>
                            </Col>
                        </Row>
                        <Card size="small" title={t('Why these standards')}>
                            <Space orientation="vertical">{aligned.reasons.map((reason) => <Typography.Text key={reason}>{reason}</Typography.Text>)}</Space>
                        </Card>
                    </Space>
                )}
                {view === 'report' && <EsgDraftPanel key={JSON.stringify(report.narrative)} report={report} provider={provider} openSections={openSections} onOpenSections={setOpenSections} />}
            </MotionCard>

            {editing && (
                <EsgReportFormModal report={report} knownClients={[]} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
            )}
            <Modal
                open={imported !== null}
                title={t('Import the ESG toolkit workbook')}
                onCancel={() => setImported(null)}
                footer={[
                    <Button key="cancel" onClick={() => setImported(null)}>{t('Cancel')}</Button>,
                    <Button key="add" loading={importing} onClick={() => void applyImport('add')}>{t('Add to what is there')}</Button>,
                    <Button key="replace" type="primary" loading={importing} onClick={() => void applyImport('replace')}>{t('Replace those registers')}</Button>,
                ]}
            >
                <List
                    size="small"
                    dataSource={(['indicators', 'risks', 'stakeholders', 'actions'] as EsgRegisterKey[]).filter((key) => imported?.[key])}
                    renderItem={(key) => (
                        <List.Item>
                            <Typography.Text>{t(REGISTER_LABELS[key])}: {t('{count} row(s) from the "{sheet}" sheet', undefined, { count: imported?.[key]?.length || 0, sheet: imported?.sheets[key] || '' })}</Typography.Text>
                        </List.Item>
                    )}
                />
                <Typography.Text type="secondary">{t('Each figure is linked to its GRI disclosure where the name makes it clear (Figures > More detail).')}</Typography.Text>
            </Modal>
        </DashboardPage>
    )
}
