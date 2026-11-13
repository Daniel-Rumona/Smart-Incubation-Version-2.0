import { App, Avatar, Button, Card, Pagination, Spin, Col, DatePicker, Segmented, Empty, Form, Input, Modal, Row, Select, Space, Tag, Typography, Upload, type UploadProps } from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined, DownloadOutlined, CloseCircleOutlined, EditOutlined, EyeOutlined, QuestionCircleOutlined, FileProtectOutlined, FileSearchOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, SortAscendingOutlined, TrophyOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { listComplianceParticipants, saveComplianceDocument, scanComplianceDocuments, uploadComplianceFile, verifyComplianceDocument } from '@/services/operationsComplianceService'
import type { ComplianceDocument, ComplianceParticipant, SaveComplianceDocument } from '@/types/compliance'
import { COMPLIANCE_DOCUMENT_TYPES } from '@/services/complianceService'
import { requirementKeyFor } from '@/config/complianceDocuments'
import { COMPANY_AGREEMENTS, type CompanyAgreementKey } from '@/config/agreements'
import { latestAgreementsByPerson, listCompanyAgreements, type SignedAgreement } from '@/services/agreementsService'
import { getCompanyOverview } from '@/services/directorSetupService'
import { complianceReviewStatus, hasComplianceFile, localComplianceFinding } from '@/utils/complianceReview'
import '@/styles/operations-compliance.css'

const { TextArea } = Input
type DocumentForm = Omit<SaveComplianceDocument, 'participantId' | 'programId' | 'companyCode' | 'issueDate' | 'expiryDate' | 'documentName' | 'notes'> & { participantId: string, issueDate?: dayjs.Dayjs, expiryDate?: dayjs.Dayjs }
const REVIEW_STATUS = {
    missing: { label: 'Missing file', color: 'orange' },
    pending: { label: 'Pending review', color: 'blue' },
    verified: { label: 'Verified', color: 'green' },
    queried: { label: 'Needs changes', color: 'red' },
    expired: { label: 'Expired', color: 'orange' },
}
// Scored against the participant's programme: valid required documents out of required documents.
const requiredKeys = (participant: ComplianceParticipant) => participant.requirements.filter((requirement) => requirement.required).map((requirement) => requirement.key)
const keysWith = (participant: ComplianceParticipant, valid: boolean) => new Set(participant.documents
    .filter((document) => hasComplianceFile(document) && (!valid || complianceReviewStatus(document) === 'verified'))
    .map((document) => requirementKeyFor(document.type || document.key)))
const score = (participant: ComplianceParticipant) => {
    const required = requiredKeys(participant)
    if (!required.length) return 100
    const valid = keysWith(participant, true)
    return Math.round((required.filter((key) => valid.has(key)).length / required.length) * 100)
}
const missingCount = (participant: ComplianceParticipant) => {
    const onFile = keysWith(participant, false)
    return requiredKeys(participant).filter((key) => !onFile.has(key)).length
}
const needsAction = (participant: ComplianceParticipant) => missingCount(participant) > 0 || participant.documents.some((document) => complianceReviewStatus(document) !== 'verified')

export const CompliancePage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const location = useLocation()
    const navigate = useNavigate()
    const [form] = Form.useForm<DocumentForm>()
    const [verifyForm] = Form.useForm<{ reason?: string }>()
    const [participants, setParticipants] = useState<ComplianceParticipant[]>([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [filter, setFilter] = useState('all')
    const [sort, setSort] = useState('action')
    const [listPage, setListPage] = useState({ key: '', page: 1 })
    const [active, setActive] = useState<ComplianceParticipant>()
    const [editing, setEditing] = useState<ComplianceDocument>()
    const [documentParticipant, setDocumentParticipant] = useState<ComplianceParticipant>()
    const [verificationDecision, setVerificationDecision] = useState<'verified' | 'queried'>('verified')
    const [verifying, setVerifying] = useState(false)
    const [verifyDocument, setVerifyDocument] = useState<ComplianceDocument>()
    const [lockedDocumentType, setLockedDocumentType] = useState<string>()
    const [documentModalOpen, setDocumentModalOpen] = useState(false)
    const [mobileDetailOpen, setMobileDetailOpen] = useState(false)
    const [file, setFile] = useState<File>()
    const [uploading, setUploading] = useState(false)
    const [scanning, setScanning] = useState<'all' | string>()
    // Agreements SMEs signed (Code of Conduct, consent form), latest per person and agreement.
    const [agreements, setAgreements] = useState<Map<string, Partial<Record<CompanyAgreementKey, SignedAgreement>>>>(new Map())
    const [organisation, setOrganisation] = useState<{ name: string, logoUrl?: string | null }>({ name: '' })
    const [downloading, setDownloading] = useState<string>()

    useEffect(() => {
        const companyCode = String(user?.companyCode || '').trim()
        if (!user || !companyCode) return
        let cancelled = false
        void Promise.all([listCompanyAgreements(companyCode).catch(() => []), getCompanyOverview(companyCode, user.uid).catch(() => null)])
            .then(([rows, company]) => {
                if (cancelled) return
                setAgreements(latestAgreementsByPerson(rows))
                setOrganisation({ name: company?.name || companyCode, logoUrl: company?.logoUrl })
            })
        return () => { cancelled = true }
    }, [user])

    const downloadAgreement = async (record: SignedAgreement, participant: ComplianceParticipant) => {
        try {
            setDownloading(record.id)
            const { downloadAgreementDocx } = await import('@/utils/agreementDocx')
            const result = await downloadAgreementDocx(record, { organisationName: organisation.name || record.companyName, fallbackBusinessName: participant.businessName, logoUrl: organisation.logoUrl })
            if (!result.signatureEmbedded) message.info(t('Downloaded. The signature image could not be added, so the document notes that an electronic signature is on file.'))
        } catch {
            message.error(t('The agreement could not be downloaded.'))
        } finally {
            setDownloading(undefined)
        }
    }

    const agreementsFor = (participant: ComplianceParticipant) => agreements.get(participant.participantId) || {}

    const load = async () => {
        if (!user) return
        try {
            setLoading(true)
            const rows = await listComplianceParticipants(user, activeProgramId)
            setParticipants(rows)
            setActive((current) => rows.find((row) => row.id === current?.id))
        } catch {
            message.error(t('operations.compliance.loadError'))
        } finally {
            setLoading(false)
        }
    }
    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [activeProgramId, user]) // eslint-disable-line react-hooks/exhaustive-deps

    // Landed here from the risk register's "Take Action" - select the details for the
    // flagged SME instead of leaving the user to find them in the list.
    useEffect(() => {
        const focusParticipantId = (location.state as { focusParticipantId?: string } | null)?.focusParticipantId
        if (!focusParticipantId) return
        const participant = participants.find((row) => row.participantId === focusParticipantId)
        if (!participant) return
        // Consume the external risk-register navigation request once its participant loads.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActive(participant)
        setMobileDetailOpen(true)
        navigate(location.pathname, { replace: true, state: null })
    }, [location.pathname, location.state, navigate, participants])

    const visibleParticipants = useMemo(() => participants.filter((participant) => {
        const matchesFilter = filter === 'all' || (filter === 'issues' ? needsAction(participant) : !needsAction(participant))
        return matchesFilter && `${participant.businessName} ${participant.email || ''} ${participant.phone || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    }).sort((a, b) => {
        if (sort === 'name') return a.businessName.localeCompare(b.businessName)
        if (sort === 'score') return score(b) - score(a) || a.businessName.localeCompare(b.businessName)
        return Number(needsAction(b)) - Number(needsAction(a)) || score(a) - score(b) || a.businessName.localeCompare(b.businessName)
    }), [filter, participants, search, sort])
    const metrics = useMemo(() => {
        const documents = participants.flatMap((participant) => participant.documents)
        return {
            participants: participants.length,
            documents: documents.length,
            needsAction: participants.filter(needsAction).length,
            missing: participants.reduce((total, participant) => total + missingCount(participant), 0),
        }
    }, [participants])
    useRegisterAgentPageContext({ pageKey: 'operations-compliance', pageName: 'Compliance', purpose: 'Review SME compliance documents, upload evidence, and record verification decisions.', filters: { search, filter, activeProgramId }, metrics, tables: { visibleParticipants: visibleParticipants.length }, selectedRecord: active?.businessName })

    const openDocumentModal = (participant?: ComplianceParticipant, document?: ComplianceDocument, requirementType?: string) => {
        const selectedParticipant = participant || active
        setLockedDocumentType(document?.type || requirementType)
        setEditing(document)
        setDocumentParticipant(participant)
        setFile(undefined)
        form.resetFields()
        form.setFieldsValue({
            participantId: selectedParticipant?.id,
            type: document?.type || requirementType,
            currentStatus: document?.currentStatus === 'valid' ? 'valid' : 'pending',
            issueDate: document?.issueDate ? dayjs(document.issueDate) : undefined,
            expiryDate: document?.expiryDate ? dayjs(document.expiryDate) : undefined,
        })
        setDocumentModalOpen(true)
    }
    const save = async (values: DocumentForm) => {
        if (!user || uploading) return
        const documentType = lockedDocumentType || values.type
        const participant = participants.find((row) => row.id === values.participantId)
        if (!participant) return message.error(t('operations.compliance.selectParticipant'))
        if (!file && !editing?.url?.trim()) return message.error(t('Please attach a document before saving.'))
        try {
            setUploading(true)
            const url = file ? await uploadComplianceFile(participant.participantId, documentType, file) : editing?.url
            await saveComplianceDocument(user, {
                participantId: participant.participantId,
                programId: participant.programId,
                companyCode: participant.companyCode || user.companyCode || undefined,
                type: documentType,
                documentName: documentType,
                currentStatus: 'pending',
                issueDate: values.issueDate?.format('YYYY-MM-DD'),
                expiryDate: values.expiryDate?.format('YYYY-MM-DD'),
                fileName: file?.name || editing?.fileName,
                url,
            }, editing?.id)
            message.success(t(editing ? 'operations.compliance.updated' : 'operations.compliance.added'))
            setDocumentModalOpen(false)
            void load()
        } catch (error) {
            console.error('Compliance document save failed', error)
            message.error(t(error instanceof Error && error.message === 'duplicate-document-type' ? 'operations.compliance.duplicate' : 'Could not save the document. Please retry; AI scanning is not required to save.'))
        } finally {
            setUploading(false)
        }
    }
    const openVerification = (document: ComplianceDocument) => {
        if (!hasComplianceFile(document)) return
        verifyForm.resetFields()
        setVerificationDecision(complianceReviewStatus(document) === 'verified' ? 'queried' : 'verified')
        setVerifyDocument(document)
    }
    const verify = async (values: { reason?: string }) => {
        if (!user || !verifyDocument || !hasComplianceFile(verifyDocument) || verifying) return
        setVerifying(true)
        try {
            await verifyComplianceDocument(user, verifyDocument.id, verificationDecision, verificationDecision === 'queried' ? values.reason?.trim() : undefined)
            message.success(t(verificationDecision === 'verified' ? 'operations.compliance.verified' : 'operations.compliance.queried'))
            setVerifyDocument(undefined)
            verifyForm.resetFields()
            await load()
        } catch {
            message.error(t('Could not save the review. Please try again.'))
        } finally {
            setVerifying(false)
        }
    }
    const scan = async (participant?: ComplianceParticipant) => {
        if (!(participant ? participant.documents.some(hasComplianceFile) : participants.some((row) => row.documents.some(hasComplianceFile)))) return
        try {
            setScanning(participant?.participantId || 'all')
            const result = await scanComplianceDocuments({
                participantId: participant?.participantId,
                programId: participant?.programId || activeProgramId,
                updateDatabase: true,
            })
            if (!result.totals.participants) {
                message.info(t('No uploaded documents were available to scan in this scope.'))
                return
            }
            await load()
            const checkedAt = new Date().toISOString()
            const targets = new Set((participant ? [participant] : participants.filter((row) => row.documents.some(hasComplianceFile))).map((row) => row.id))
            const hasServerFindings = result.results?.some((item) => item.findings?.length)
            setParticipants((current) => current.map((row) => {
                if (!targets.has(row.id)) return row
                const scanned = result.results?.find((item) => item.participantId === row.participantId)
                const serverFindings = scanned?.findings || []
                return { ...row, scan: {
                    source: serverFindings.length ? 'server' as const : 'local' as const,
                    scannedAt: scanned?.summary.scannedAt || checkedAt,
                    findings: row.documents.map((document) => serverFindings.find((finding) => finding.documentId === document.id) || localComplianceFinding(document)),
                } }
            }))
            message.success(t(hasServerFindings
                ? 'Scan complete. Document findings are shown on the cards.'
                : 'File and date checks are shown on the cards. The server returned no detailed findings, so these checks use the saved document records.'))
        } catch (error) {
            message.error(t(error instanceof Error && error.message === 'agent-api-not-configured' ? 'operations.compliance.scanNotConfigured' : error instanceof Error && error.message.startsWith('The compliance scan endpoint') ? error.message : 'operations.compliance.scanError'))
        } finally {
            setScanning(undefined)
        }
    }

    const selected = visibleParticipants.find((row) => row.id === active?.id) || visibleParticipants[0]
    const pageKey = JSON.stringify([search, filter, sort, activeProgramId, selected?.id])
    const selectedPage = Math.floor(Math.max(0, visibleParticipants.findIndex((row) => row.id === selected?.id)) / 12) + 1
    const currentPage = Math.min(listPage.key === pageKey ? listPage.page : selectedPage, Math.max(1, Math.ceil(visibleParticipants.length / 12)))
    const pageParticipants = visibleParticipants.slice((currentPage - 1) * 12, currentPage * 12)
    const documentRank = (document: ComplianceDocument) => complianceReviewStatus(document) === 'verified' ? 2 : complianceReviewStatus(document) === 'pending' ? 1 : 0
    const selectedDocuments = [...(selected?.documents || [])].sort((a, b) => documentRank(a) - documentRank(b))

    const uploadProps: UploadProps = { beforeUpload: (nextFile) => { setFile(nextFile); return false }, maxCount: 1, onRemove: () => { setFile(undefined) } }

    return <DashboardPage className="operations-compliance-page">
        <Row gutter={[12, 12]} className="operations-compliance-metrics">
            <Col xs={12} lg={6}><DashboardMetricCard icon={<FileProtectOutlined />} label={t('nav.participants')} value={metrics.participants} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('operations.compliance.documents')} value={metrics.documents} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<WarningOutlined />} label={t('operations.common.needsAction')} value={metrics.needsAction} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<CloseCircleOutlined />} label={t('operations.compliance.missing')} value={metrics.missing} /></Col>
        </Row>
        <Card className="operations-compliance-card compliance-toolbar-card">
            <div className="compliance-toolbar">
                <Input aria-label={t('operations.compliance.search')} prefix={<SearchOutlined />} placeholder={t('operations.compliance.search')} value={search} onChange={(event) => setSearch(event.target.value)} allowClear />
                <Select aria-label={t('common.status')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('operations.compliance.allParticipants') }, { value: 'issues', label: t('operations.compliance.onlyActionNeeded') }, { value: 'clean', label: t('operations.compliance.onlyCompliant') }]} />
                <Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('common.refresh')}</Button>
                {participants.some((row) => row.documents.some(hasComplianceFile)) && <Button icon={<FileSearchOutlined />} loading={scanning === 'all'} onClick={() => void scan()}>{t('operations.compliance.scanAll')}</Button>}
            </div>
        </Card>
        <div className={`compliance-workspace${mobileDetailOpen && selected ? ' compliance-workspace--detail' : ''}`}>
            <Card className="operations-compliance-card compliance-participants">
                <Select className="compliance-list-sort" aria-label={t('Sort participants')} prefix={<span className="compliance-sort-prefix">{t('Sort by')}</span>} variant="borderless" value={sort} onChange={setSort} options={[
                    { value: 'action', label: <Space size={8}><WarningOutlined />{t('Needs attention first')}</Space> },
                    { value: 'score', label: <Space size={8}><TrophyOutlined />{t('Highest compliance score')}</Space> },
                    { value: 'name', label: <Space size={8}><SortAscendingOutlined />{t('Name A–Z')}</Space> },
                ]} />
                <Spin spinning={loading}>
                    <nav aria-label={t('nav.participants')} className="compliance-participant-list">
                        {pageParticipants.map((row) => (
                            <button type="button" key={row.id} className={`compliance-participant${selected?.id === row.id ? ' compliance-participant--selected' : ''}`} aria-current={selected?.id === row.id ? 'true' : undefined} onClick={() => { setActive(row); setMobileDetailOpen(true) }}>
                                <Avatar size={36} className="compliance-participant-avatar" aria-hidden="true">{row.businessName.replace(/\(.*?\)/g, ' ').split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word) && !/^(ltd|pty|inc|cc|npc)\.?$/i.test(word)).slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase() || '?'}</Avatar>
                                <div className="compliance-participant-main">
                                    <div className="compliance-participant-name" title={row.businessName}>{row.businessName}</div>
                                    <div className="compliance-participant-meta" title={row.email}>{row.email || t('common.noEmail')}</div>
                                    <div className="compliance-participant-meta">{t('{missing} of {total} required missing', undefined, { missing: missingCount(row), total: requiredKeys(row).length })} · {row.documents.filter((document) => complianceReviewStatus(document) === 'pending').length} {t('Pending')}</div>
                                </div>
                                <div className="compliance-participant-side">
                                    <span className={`compliance-score compliance-score--${score(row) === 100 ? 'good' : score(row) >= 50 ? 'warning' : 'low'}`} title={t('operations.compliance.score')}>{score(row)}%</span>
                                    <Tag color={needsAction(row) ? 'orange' : 'green'} variant="filled">{t(needsAction(row) ? 'operations.common.needsAction' : 'operations.participants.compliant')}</Tag>
                                </div>
                            </button>
                        ))}
                        {!loading && !visibleParticipants.length && <Empty description={t('operations.compliance.empty')} />}
                    </nav>
                    {visibleParticipants.length > 12 && <div className="compliance-list-pagination"><Pagination size="small" current={currentPage} pageSize={12} total={visibleParticipants.length} showSizeChanger={false} showLessItems onChange={(page) => setListPage({ key: pageKey, page })} /></div>}
                </Spin>
            </Card>
            <Card className="operations-compliance-card compliance-detail">
                <Button className="compliance-back" icon={<ArrowLeftOutlined />} onClick={() => setMobileDetailOpen(false)}>{t('Back to participants')}</Button>
                <div className="compliance-detail-header">
                    <div className="compliance-detail-identity">
                        <div className="compliance-detail-title"><Typography.Title level={4}>{selected?.businessName || t('nav.compliance')}</Typography.Title>
                            {selected && <span className={`compliance-score compliance-score--${score(selected) === 100 ? 'good' : score(selected) >= 50 ? 'warning' : 'low'}`} title={t('operations.compliance.score')}>{score(selected)}%</span>}
                        </div>
                        {selected && <Typography.Text type="secondary">{selected.email || t('common.noEmail')}</Typography.Text>}
                    </div>
                    {selected && <Space wrap>
                        {selected.documents.some(hasComplianceFile) && <Button icon={<FileSearchOutlined />} loading={scanning === selected.participantId} onClick={() => void scan(selected)}>{t('operations.compliance.scan')}</Button>}
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => openDocumentModal(selected)}>{t('operations.compliance.addDocument')}</Button>
                    </Space>}
                </div>
            {selected ? <><div className="compliance-missing-requirements">
                {selected.requirements.filter((requirement) => requirement.required && !selected.documents.some((document) => requirementKeyFor(document.type || document.key) === requirement.key)).map((requirement) => (
                    <div className="compliance-agreement-row" key={requirement.key}>
                        <div><Typography.Text strong>{requirement.name}</Typography.Text><Typography.Text type="secondary">{t('Missing required document')}</Typography.Text></div>
                        <Button icon={<PlusOutlined />} onClick={() => openDocumentModal(selected, undefined, requirement.name)}>{t('operations.compliance.addDocument')}</Button>
                    </div>
                ))}
            </div><div className="compliance-agreements"><Typography.Text strong>{t('Signed agreements')}</Typography.Text><div className="compliance-agreements-list">{(Object.keys(COMPANY_AGREEMENTS) as CompanyAgreementKey[]).map((key) => { const record = agreementsFor(selected)[key]; return <div key={key} className="compliance-agreement-row"><div><Typography.Text strong>{COMPANY_AGREEMENTS[key].title}</Typography.Text><Typography.Text type="secondary">{record ? t('Signed {date}', undefined, { date: record.acceptedAt ? dayjs(record.acceptedAt).format('D MMM YYYY, HH:mm') : '' }) : t('Not signed yet')}</Typography.Text></div>{record ? <Button icon={<DownloadOutlined />} loading={downloading === record.id} onClick={() => void downloadAgreement(record, selected)}>{t('Word document')}</Button> : <Tag color="orange">{t('Not signed')}</Tag>}</div> })}</div></div><section className="compliance-document-list" aria-label={t('operations.compliance.documents')}>
                <Typography.Text strong>{t('operations.compliance.documents')}</Typography.Text>
                {selected.scan && !selected.scan.findings.length && <Typography.Paragraph type="secondary">{t('The last scan returned no document findings. Update the scan backend and scan again.')}</Typography.Paragraph>}
                {selectedDocuments.length ? selectedDocuments.map((document) => {
                    const reviewStatus = complianceReviewStatus(document)
                    const validated = reviewStatus === 'verified'
                    const status = REVIEW_STATUS[reviewStatus]
                    const finding = selected.scan?.findings.find((item) => item.documentId === document.id)
                    const findingCurrent = finding && (finding.url || '') === (document.url || '') && (finding.expiryDate || '') === (document.expiryDate || '') && finding.currentStatus === document.currentStatus && finding.verificationStatus === document.verificationStatus
                    return <article className="compliance-document-card" key={document.id}>
                        <div className="compliance-document-heading">
                            <div className="compliance-document-name"><FileProtectOutlined /><div>
                                <Typography.Text strong>{document.type}</Typography.Text>
                            </div></div>
                            <Tag color={status.color}>{t(status.label)}</Tag>
                        </div>
                        <div className="compliance-document-meta">
                            <span>{t('common.expiry')}: <strong>{document.expiryDate ? dayjs(document.expiryDate).format('D MMM YYYY') : t('N/A')}</strong></span>
                        </div>
                        {document.verificationStatus === 'queried' && document.verificationComment && <div className="compliance-document-query"><QuestionCircleOutlined /><span>{document.verificationComment}</span></div>}
                        {hasComplianceFile(document) && finding && <div className="compliance-scan-finding">
                            <FileSearchOutlined />
                            <div><Typography.Text strong>{t(finding.reviewKind === 'content' ? 'AI document review' : finding.reviewKind === 'unavailable' ? 'AI review unavailable' : 'File and date check')} · {selected.scan?.scannedAt ? dayjs(selected.scan.scannedAt).format('D MMM, HH:mm') : ''}</Typography.Text>
                            <Typography.Paragraph>{t(findingCurrent ? finding.message : 'This document changed since the last scan. Scan again for current findings.')}</Typography.Paragraph>
                            <Typography.Text type="secondary">{t(finding.reviewKind === 'content' ? 'AI findings are advisory. Review the document before verifying.' : finding.reviewKind === 'unavailable' ? 'No AI approval was made.' : 'Content was not reviewed. The backend needs the AI content-review update.')}</Typography.Text></div>
                        </div>}
                        <div className="compliance-document-actions">
                            {document.url && <Button icon={<EyeOutlined />} href={document.url} target="_blank" rel="noopener noreferrer">{t('View document')}</Button>}
                            <Button icon={hasComplianceFile(document) ? <EditOutlined /> : <UploadOutlined />} onClick={() => openDocumentModal(selected, document)}>{t(hasComplianceFile(document) ? 'common.edit' : 'Upload document')}</Button>
                            {hasComplianceFile(document) && <Button type={validated ? 'default' : 'primary'} icon={validated ? <QuestionCircleOutlined /> : <CheckCircleOutlined />} onClick={() => openVerification(document)}>{t(validated ? 'operations.compliance.query' : 'operations.compliance.verify')}</Button>}
                        </div>
                    </article>
                }) : <Empty description={t('operations.compliance.noDocuments')} />}
            </section></> : <Empty />}
            </Card>
        </div>
        <Modal open={documentModalOpen} title={lockedDocumentType ? `${t(editing && hasComplianceFile(editing) ? 'operations.compliance.editDocument' : 'Upload document')}: ${lockedDocumentType}` : t('operations.compliance.addDocument')} footer={null} onCancel={() => { if (!uploading) setDocumentModalOpen(false) }} closable={!uploading} maskClosable={!uploading} keyboard={!uploading}>
            {documentParticipant && <Typography.Paragraph type="secondary">{documentParticipant.businessName}</Typography.Paragraph>}
            <Form form={form} disabled={uploading} layout="vertical" onFinish={(values) => void save(values)}>
                <Form.Item name="participantId" label={t('operations.compliance.participant')} rules={documentParticipant ? [] : [{ required: true }]} style={documentParticipant ? { display: 'none' } : undefined}><Select showSearch optionFilterProp="label" options={participants.map((participant) => ({ value: participant.id, label: participant.businessName }))} /></Form.Item>
                {lockedDocumentType ? <Form.Item name="type" hidden><Input /></Form.Item> : <Form.Item name="type" label={t('operations.compliance.documentType')} rules={[{ required: true }]}><Select options={COMPLIANCE_DOCUMENT_TYPES.map((value) => ({ value, label: value }))} /></Form.Item>}
                <Row gutter={12}><Col span={12}><Form.Item name="issueDate" label={t('operations.compliance.issueDate')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item name="expiryDate" label={t('operations.compliance.expiryDate')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col></Row>
                <Typography.Paragraph type="secondary">{t('Saved documents require review before they count as verified.')}</Typography.Paragraph>
                <Form.Item label={t('common.file')}><Upload {...uploadProps}><Button icon={<UploadOutlined />}>{t('operations.compliance.chooseFile')}</Button></Upload></Form.Item>
                <Button block type="primary" htmlType="submit" loading={uploading}>{t(uploading ? 'common.saving' : 'operations.compliance.saveDocument')}</Button>
            </Form>
        </Modal>
        <Modal open={!!verifyDocument} title={t('Review document')} onCancel={() => { if (!verifying) setVerifyDocument(undefined) }} closable={!verifying} maskClosable={!verifying} keyboard={!verifying} footer={null} width={520}>
            <div className="compliance-review-summary"><FileProtectOutlined /><div>
                <Typography.Text strong>{verifyDocument?.type}</Typography.Text>
                <Typography.Text type="secondary">{verifyDocument?.fileName || verifyDocument?.documentName}</Typography.Text>
            </div></div>
            <Form form={verifyForm} layout="vertical" onFinish={(values) => void verify(values)}>
                <Form.Item label={t('Review decision')}>
                    <Segmented block value={verificationDecision} disabled={verifying} onChange={(value) => setVerificationDecision(value as 'verified' | 'queried')} options={[
                        { value: 'verified', label: t('operations.compliance.verify'), icon: <CheckCircleOutlined /> },
                        { value: 'queried', label: t('operations.compliance.query'), icon: <QuestionCircleOutlined /> },
                    ]} />
                </Form.Item>
                <div className={`compliance-review-explanation compliance-review-explanation--${verificationDecision}`}>
                    {verificationDecision === 'verified' ? <CheckCircleOutlined /> : <QuestionCircleOutlined />}
                    <div><Typography.Text strong>{t(verificationDecision === 'verified' ? 'Confirm this document is valid' : 'Request a correction or clarification')}</Typography.Text>
                    <Typography.Paragraph>{t(verificationDecision === 'verified' ? 'This marks the document as verified and valid for compliance.' : 'Explain what needs to change. The document will be marked as queried and will no longer count as valid.')}</Typography.Paragraph></div>
                </div>
                {verificationDecision === 'queried' && <Form.Item name="reason" label={t('What needs to be corrected?')} rules={[{ required: true, whitespace: true, message: t('operations.compliance.queryReasonRequired') }]}>
                    <TextArea disabled={verifying} rows={4} placeholder={t('For example: Please upload a clearer copy showing the full registration number.')} />
                </Form.Item>}
                <Button block type="primary" htmlType="submit" loading={verifying} icon={verificationDecision === 'verified' ? <CheckCircleOutlined /> : <QuestionCircleOutlined />}>{t(verificationDecision === 'verified' ? 'Verify document' : 'Save query')}</Button>
            </Form>
        </Modal>
    </DashboardPage>
}
