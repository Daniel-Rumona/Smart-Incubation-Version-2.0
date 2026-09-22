import { App, Button, Card, Col, DatePicker, Descriptions, Empty, Form, Input, Modal, Progress, Row, Select, Space, Tag, theme, Typography, Upload, type TableProps, type UploadProps } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, EditOutlined, EyeOutlined, FileProtectOutlined, FileSearchOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { listComplianceParticipants, saveComplianceDocument, scanComplianceDocuments, uploadComplianceFile, verifyComplianceDocument } from '@/services/operationsComplianceService'
import type { ComplianceDocument, ComplianceParticipant, ComplianceStatus, SaveComplianceDocument } from '@/types/compliance'
import { COMPLIANCE_DOCUMENT_TYPES } from '@/services/complianceService'
import '@/styles/operations-compliance.css'

const { TextArea } = Input
const MANUAL_STATUS_OPTIONS: Array<{ value: ComplianceStatus, icon: ReactNode }> = [
    { value: 'pending', icon: <ClockCircleOutlined /> },
    { value: 'valid', icon: <CheckCircleOutlined /> },
]
type DocumentForm = Omit<SaveComplianceDocument, 'participantId' | 'programId' | 'companyCode' | 'issueDate' | 'expiryDate' | 'documentName' | 'notes'> & { participantId: string, issueDate?: dayjs.Dayjs, expiryDate?: dayjs.Dayjs }
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const statusColor = (value: ComplianceStatus) => value === 'valid' ? 'green' : value === 'pending' ? 'blue' : value === 'expired' ? 'orange' : 'red'
const score = (participant: ComplianceParticipant) => participant.documents.length
    ? Math.round((participant.documents.filter((document) => document.currentStatus === 'valid').length / COMPLIANCE_DOCUMENT_TYPES.length) * 100)
    : 0
const missingCount = (participant: ComplianceParticipant) => Math.max(0, COMPLIANCE_DOCUMENT_TYPES.length - participant.documents.length)
const needsAction = (participant: ComplianceParticipant) => missingCount(participant) > 0 || participant.documents.some((document) => document.currentStatus !== 'valid')

/** A selectable card used for binary choices, e.g. the manual document status field. */
const OptionCard = ({ icon, title, selected, onClick }: { icon: ReactNode, title: string, selected?: boolean, onClick: () => void }) => {
    const { token } = theme.useToken()
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                cursor: 'pointer',
            }}
        >
            <span style={{ fontSize: 16, color: selected ? token.colorPrimary : token.colorTextSecondary }}>{icon}</span>
            <strong>{title}</strong>
        </button>
    )
}
const StatusField = ({ value, onChange }: { value?: ComplianceStatus, onChange?: (value: ComplianceStatus) => void }) => (
    <Row gutter={12}>
        {MANUAL_STATUS_OPTIONS.map((option) => (
            <Col span={12} key={option.value}>
                <OptionCard icon={option.icon} title={titleCase(option.value)} selected={value === option.value} onClick={() => onChange?.(option.value)} />
            </Col>
        ))}
    </Row>
)

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
    const [active, setActive] = useState<ComplianceParticipant>()
    const [editing, setEditing] = useState<ComplianceDocument>()
    const [documentParticipant, setDocumentParticipant] = useState<ComplianceParticipant>()
    const [verifyDocument, setVerifyDocument] = useState<ComplianceDocument>()
    const [documentModalOpen, setDocumentModalOpen] = useState(false)
    const [reviewModalOpen, setReviewModalOpen] = useState(false)
    const [file, setFile] = useState<File>()
    const [uploading, setUploading] = useState(false)
    const [scanning, setScanning] = useState<'all' | string>()

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

    // Landed here from the risk register's "Take Action" - open the review modal for the
    // flagged SME instead of leaving the user to find them in the list.
    useEffect(() => {
        const focusParticipantId = (location.state as { focusParticipantId?: string } | null)?.focusParticipantId
        if (!focusParticipantId) return
        const participant = participants.find((row) => row.participantId === focusParticipantId)
        if (!participant) return
        setActive(participant)
        setReviewModalOpen(true)
        navigate(location.pathname, { replace: true, state: null })
    }, [location.pathname, location.state, navigate, participants])

    const visibleParticipants = useMemo(() => participants.filter((participant) => {
        const matchesFilter = filter === 'all' || (filter === 'issues' ? needsAction(participant) : !needsAction(participant))
        return matchesFilter && `${participant.businessName} ${participant.email || ''} ${participant.phone || ''}`.toLowerCase().includes(search.trim().toLowerCase())
    }), [filter, participants, search])
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

    const openDocumentModal = (participant?: ComplianceParticipant, document?: ComplianceDocument) => {
        const selectedParticipant = participant || active
        setEditing(document)
        setDocumentParticipant(participant)
        setFile(undefined)
        form.resetFields()
        form.setFieldsValue({
            participantId: selectedParticipant?.id,
            type: document?.type,
            currentStatus: document?.currentStatus === 'valid' ? 'valid' : 'pending',
            issueDate: document?.issueDate ? dayjs(document.issueDate) : undefined,
            expiryDate: document?.expiryDate ? dayjs(document.expiryDate) : undefined,
        })
        setDocumentModalOpen(true)
    }
    const save = async (values: DocumentForm) => {
        if (!user) return
        const participant = participants.find((row) => row.id === values.participantId)
        if (!participant) return message.error(t('operations.compliance.selectParticipant'))
        try {
            setUploading(true)
            const url = file ? await uploadComplianceFile(values.participantId, values.type, file) : editing?.url
            await saveComplianceDocument(user, {
                participantId: participant.participantId,
                programId: participant.programId,
                companyCode: participant.companyCode || user.companyCode || undefined,
                type: values.type,
                documentName: values.type,
                currentStatus: values.currentStatus,
                issueDate: values.issueDate?.format('YYYY-MM-DD'),
                expiryDate: values.expiryDate?.format('YYYY-MM-DD'),
                fileName: file?.name || editing?.fileName,
                url,
            }, editing?.id)
            message.success(t(editing ? 'operations.compliance.updated' : 'operations.compliance.added'))
            setDocumentModalOpen(false)
            await load()
        } catch (error) {
            message.error(t(error instanceof Error && error.message === 'duplicate-document-type' ? 'operations.compliance.duplicate' : 'operations.compliance.saveError'))
        } finally {
            setUploading(false)
        }
    }
    const verify = async (decision: 'verified' | 'queried') => {
        if (!user || !verifyDocument) return
        const reason = verifyForm.getFieldValue('reason')
        if (decision === 'queried' && !reason?.trim()) return message.error(t('operations.compliance.queryReasonRequired'))
        await verifyComplianceDocument(user, verifyDocument.id, decision, reason)
        message.success(t(decision === 'verified' ? 'operations.compliance.verified' : 'operations.compliance.queried'))
        setVerifyDocument(undefined)
        verifyForm.resetFields()
        await load()
    }
    const scan = async (participant?: ComplianceParticipant) => {
        try {
            setScanning(participant?.participantId || 'all')
            const result = await scanComplianceDocuments({
                participantId: participant?.participantId,
                programId: participant?.programId || activeProgramId,
                updateDatabase: true,
            })
            const successMessage = participant
                ? t('operations.compliance.scanOneComplete')
                : t('operations.compliance.scanAllComplete').replace('{{count}}', String(result.totals.participants))
            message.success(successMessage)
            await load()
        } catch (error) {
            message.error(t(error instanceof Error && error.message === 'agent-api-not-configured' ? 'operations.compliance.scanNotConfigured' : 'operations.compliance.scanError'))
        } finally {
            setScanning(undefined)
        }
    }

    const participantColumns: TableProps<ComplianceParticipant>['columns'] = [
        { title: t('operations.compliance.participant'), dataIndex: 'businessName', render: (value: string, row) => <Space orientation="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{row.email || t('common.noEmail')}</Typography.Text></Space> },
        { title: t('operations.compliance.documents'), render: (_, row) => row.documents.length },
        { title: t('common.score'), render: (_, row) => <Progress percent={score(row)} size="small" /> },
        { title: t('common.status'), render: (_, row) => needsAction(row) ? <Tag color="orange">{t('operations.common.needsAction')}</Tag> : <Tag color="green">{t('operations.participants.compliant')}</Tag> },
        { title: '', render: (_, row) => <Space><Button icon={<FileSearchOutlined />} loading={scanning === row.participantId} onClick={() => void scan(row)}>{t('operations.compliance.scan')}</Button><Button icon={<EyeOutlined />} onClick={() => { setActive(row); setReviewModalOpen(true) }}>{t('common.review')}</Button></Space> },
    ]
    const documentColumns: TableProps<ComplianceDocument>['columns'] = [
        { title: t('common.type'), dataIndex: 'type' },
        { title: t('common.document'), dataIndex: 'documentName' },
        { title: t('common.status'), dataIndex: 'currentStatus', render: (value: ComplianceStatus) => <Tag color={statusColor(value)}>{titleCase(value)}</Tag> },
        { title: t('common.verification'), dataIndex: 'verificationStatus', render: (value: string) => <Tag>{titleCase(value || 'pending')}</Tag> },
        { title: t('common.expiry'), dataIndex: 'expiryDate', render: (value?: string) => value ? dayjs(value).format('DD MMM YYYY') : 'N/A' },
        { title: '', render: (_, document) => <Space><Button type="text" icon={<EditOutlined />} onClick={() => openDocumentModal(active, document)} /><Button type="text" icon={<CheckCircleOutlined />} onClick={() => setVerifyDocument(document)} /></Space> },
    ]
    const uploadProps: UploadProps = { beforeUpload: (nextFile) => { setFile(nextFile); return false }, maxCount: 1, onRemove: () => { setFile(undefined) } }

    return <DashboardPage className="operations-compliance-page">
        <Row gutter={[12, 12]} className="operations-compliance-metrics">
            <Col xs={12} lg={6}><DashboardMetricCard icon={<FileProtectOutlined />} label={t('nav.participants')} value={metrics.participants} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('operations.compliance.documents')} value={metrics.documents} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<WarningOutlined />} label={t('operations.common.needsAction')} value={metrics.needsAction} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<CloseCircleOutlined />} label={t('operations.compliance.missing')} value={metrics.missing} /></Col>
        </Row>
        <FilterBar primary={<><Input prefix={<SearchOutlined />} placeholder={t('operations.compliance.search')} value={search} onChange={(event) => setSearch(event.target.value)} allowClear /><Select value={filter} onChange={setFilter} options={[{ value: 'all', label: t('operations.compliance.allParticipants') }, { value: 'issues', label: t('operations.compliance.onlyActionNeeded') }, { value: 'clean', label: t('operations.compliance.onlyCompliant') }]} /></>} actions={<Space><Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('common.refresh')}</Button><Button icon={<FileSearchOutlined />} loading={scanning === 'all'} onClick={() => void scan()}>{t('operations.compliance.scanAll')}</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openDocumentModal()}>{t('operations.compliance.addDocument')}</Button></Space>} />
        <Card className="operations-compliance-card"><ResponsiveDataView rowKey="id" rows={visibleParticipants} columns={participantColumns} loading={loading} emptyText={t('operations.compliance.empty')} renderCard={(row) => <div className="operations-compliance-mobile-card"><Space orientation="vertical" size={8} className="operations-compliance-card-content"><Typography.Text strong>{row.businessName}</Typography.Text><Typography.Text type="secondary">{row.email || t('common.noEmail')}</Typography.Text><Progress percent={score(row)} size="small" /></Space><Space className="operations-compliance-card-actions"><Button icon={<FileSearchOutlined />} loading={scanning === row.participantId} onClick={() => void scan(row)}>{t('operations.compliance.scan')}</Button><Button icon={<EyeOutlined />} onClick={() => { setActive(row); setReviewModalOpen(true) }}>{t('common.review')}</Button></Space></div>} /></Card>
        <Modal title={active ? `${t('nav.compliance')}: ${active.businessName}` : t('nav.compliance')} open={reviewModalOpen} onCancel={() => setReviewModalOpen(false)} width={960} footer={<Space><Button onClick={() => setReviewModalOpen(false)}>{t('common.close')}</Button><Button icon={<FileSearchOutlined />} loading={!!active && scanning === active.participantId} onClick={() => active && void scan(active)}>{t('operations.compliance.scan')}</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openDocumentModal(active)}>{t('operations.compliance.addDocument')}</Button></Space>}>
            {active ? <><Descriptions bordered size="small" items={[{ key: 'name', label: t('operations.compliance.participant'), children: active.businessName }, { key: 'email', label: t('common.email'), children: active.email || 'N/A' }, { key: 'score', label: t('operations.compliance.score'), children: `${score(active)}%` }]} style={{ marginBottom: 16 }} /><ResponsiveDataView rowKey="id" columns={documentColumns} rows={active.documents} emptyText={t('operations.compliance.noDocuments')} renderCard={(document) => <div className="operations-compliance-mobile-card"><Space orientation="vertical" className="operations-compliance-card-content"><Typography.Text strong>{document.type}</Typography.Text><Typography.Text>{document.documentName}</Typography.Text><Tag color={statusColor(document.currentStatus)}>{titleCase(document.currentStatus)}</Tag></Space><Space className="operations-compliance-card-actions"><Button icon={<EditOutlined />} onClick={() => openDocumentModal(active, document)}>{t('common.edit')}</Button><Button icon={<CheckCircleOutlined />} onClick={() => setVerifyDocument(document)}>{t('operations.compliance.verify')}</Button></Space></div>} /></> : <Empty />}
        </Modal>
        <Modal open={documentModalOpen} title={documentParticipant ? `${t(editing ? 'operations.compliance.editDocument' : 'operations.compliance.addDocument')}: ${documentParticipant.businessName}` : t(editing ? 'operations.compliance.editDocument' : 'operations.compliance.addDocument')} footer={null} onCancel={() => setDocumentModalOpen(false)}>
            <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
                <Form.Item name="participantId" label={t('operations.compliance.participant')} rules={documentParticipant ? [] : [{ required: true }]} style={documentParticipant ? { display: 'none' } : undefined}><Select showSearch optionFilterProp="label" options={participants.map((participant) => ({ value: participant.id, label: participant.businessName }))} /></Form.Item>
                <Form.Item name="type" label={t('operations.compliance.documentType')} rules={[{ required: true }]}><Select options={COMPLIANCE_DOCUMENT_TYPES.map((value) => ({ value, label: value }))} /></Form.Item>
                <Row gutter={12}><Col span={12}><Form.Item name="issueDate" label={t('operations.compliance.issueDate')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col><Col span={12}><Form.Item name="expiryDate" label={t('operations.compliance.expiryDate')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col></Row>
                <Form.Item name="currentStatus" label={t('common.status')} rules={[{ required: true }]}><StatusField /></Form.Item>
                <Form.Item label={t('common.file')}><Upload {...uploadProps}><Button icon={<UploadOutlined />}>{t('operations.compliance.chooseFile')}</Button></Upload></Form.Item>
                <Button block type="primary" htmlType="submit" loading={uploading}>{t(uploading ? 'common.saving' : 'operations.compliance.saveDocument')}</Button>
            </Form>
        </Modal>
        <Modal open={!!verifyDocument} title={t('operations.compliance.verifyDocument')} onCancel={() => setVerifyDocument(undefined)} footer={<Space><Button onClick={() => setVerifyDocument(undefined)}>{t('common.cancel')}</Button><Button onClick={() => void verify('queried')}>{t('operations.compliance.query')}</Button><Button type="primary" onClick={() => void verify('verified')}>{t('operations.compliance.verify')}</Button></Space>}>
            <Descriptions bordered size="small" items={[{ key: 'type', label: t('common.type'), children: verifyDocument?.type }, { key: 'document', label: t('common.document'), children: verifyDocument?.documentName }]} />
            <Form form={verifyForm} layout="vertical"><Form.Item name="reason" label={t('operations.compliance.queryReason')}><TextArea rows={3} placeholder={t('operations.compliance.queryReasonPlaceholder')} /></Form.Item></Form>
        </Modal>
    </DashboardPage>
}
