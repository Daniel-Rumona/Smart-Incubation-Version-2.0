import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
    Alert,
    App,
    Button,
    Input,
    Modal,
    Progress,
    Result,
    Space,
    Spin,
    Typography,
    Upload,
} from 'antd'
import {
    CheckCircleFilled,
    DownloadOutlined,
    EyeOutlined,
    FileDoneOutlined,
    InboxOutlined,
    PlusOutlined,
    RobotOutlined,
    SendOutlined,
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useSearchParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useTopbarBackButton } from '@/contexts/SystemLayoutTopbarContext'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import {
    downloadDocumentAgentOutput,
    fileToAgentAttachment,
    getDocumentAgentAssignment,
    persistDocumentAgentProgress,
    previewDocumentAgentOutput,
    sendDocumentAgentMessage,
    type DocumentAgentAssignment,
    type DocumentAgentChatMessage,
    type DocumentAgentPreview,
} from '@/services/documentAgentService'
import { getAgentDefinition } from '@/services/agentOrchestrationService'
import type { AgentDefinition, AgentId } from '@/types/agentOrchestration'
import '@/styles/agent-workspace.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { Paragraph, Text } = Typography
const { TextArea } = Input
const { Dragger } = Upload

type Props = { agentId?: AgentId }

const previewLabel = (value: string) =>
    value
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^./, (letter) => letter.toUpperCase())

const renderPreviewValue = (value: unknown): ReactNode => {
    if (Array.isArray(value)) {
        return (
            <ul>
                {value.map((item, index) => (
                    <li key={index}>
                        {typeof item === 'object' ? renderPreviewValue(item) : String(item)}
                    </li>
                ))}
            </ul>
        )
    }

    if (value && typeof value === 'object') {
        return (
            <div className="agent-preview-object">
                {Object.entries(value).map(([key, item]) => (
                    <div key={key}>
                        <Text strong>{previewLabel(key)}:</Text> {renderPreviewValue(item)}
                    </div>
                ))}
            </div>
        )
    }

    return <span>{String(value || 'To be confirmed')}</span>
}

const AgentWorkspacePage = ({ agentId = 'business-plan' }: Props) => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [searchParams] = useSearchParams()

    useTopbarBackButton({ hideSidebar: true })
    const assignmentId = searchParams.get('assignmentId') || ''

    const [definition, setDefinition] = useState<AgentDefinition | null>()
    const [assignment, setAssignment] = useState<DocumentAgentAssignment | null>()
    const [assignmentError, setAssignmentError] = useState('')
    const [messages, setMessages] = useState<DocumentAgentChatMessage[]>([])
    const [answers, setAnswers] = useState<Record<string, string>>({})
    const [missingFields, setMissingFields] = useState<string[]>([])
    const [requestedDocuments, setRequestedDocuments] = useState<string[]>([])
    const [documentsRead, setDocumentsRead] = useState<string[]>([])
    const [selectedDocument, setSelectedDocument] = useState<string | null>(null)
    const [providedDocuments, setProvidedDocuments] = useState<string[]>([])
    const [input, setInput] = useState('')
    const [sending, setSending] = useState(false)
    const [generating, setGenerating] = useState(false)
    const [previewing, setPreviewing] = useState(false)
    const [preview, setPreview] = useState<DocumentAgentPreview>()
    const [previewOpen, setPreviewOpen] = useState(false)
    const conversationRef = useRef<HTMLDivElement | null>(null)

    const ready = messages.length > 0 && missingFields.length === 0

    useEffect(() => {
        let active = true

        void Promise.resolve().then(() => setDefinition(undefined))

        getAgentDefinition(agentId)
            .then((result) => {
                if (active) setDefinition(result)
            })
            .catch(() => {
                if (active) setDefinition(null)
            })

        return () => {
            active = false
        }
    }, [agentId])

    const completion = useMemo(() => {
        const captured = Object.keys(answers).length
        const total = captured + missingFields.length
        return total ? Math.round((captured / total) * 100) : 0
    }, [answers, missingFields.length])

    useEffect(() => {
        const stream = conversationRef.current
        if (!stream) return

        stream.scrollTo({
            top: stream.scrollHeight,
            behavior: messages.length > 1 ? 'smooth' : 'auto',
        })
    }, [messages, sending])

    useRegisterAgentPageContext({
        pageKey: `${agentId}-workspace`,
        pageName: definition?.name || 'Document Agent',
        purpose:
            'A conversational workspace that gathers evidence and produces an editable Word document.',
        metrics: {
            completion,
            documentsRead: documentsRead.length,
            ready,
        },
        dataSummary: {
            assignmentId: assignment?.id || null,
            intervention: assignment?.interventionTitle || null,
        },
    })

    useEffect(() => {
        if (!user || !assignmentId || !definition) return

        let active = true

        void getDocumentAgentAssignment(assignmentId, agentId, user)
            .then(async (context) => {
                if (!active) return

                setAssignment(context)
                setAssignmentError('')

                const business = context.businessContext
                const currentPosition = [
                    business.natureOfBusiness,
                    business.stage ? `Stage: ${business.stage}` : '',
                    business.yearsOfTrading ? `${business.yearsOfTrading} years trading` : '',
                    business.challenges ? `Current challenges: ${business.challenges}` : '',
                ]
                    .filter(Boolean)
                    .join('. ')

                const knownAnswers: Record<string, string | undefined> =
                    agentId === 'strategic-plan'
                        ? {
                            organizationName: context.businessName,
                            sectorLocation:
                                [business.sector, business.location].filter(Boolean).join(' · ') ||
                                undefined,
                            currentPosition: currentPosition || undefined,
                            vision: business.vision,
                            mission: business.mission,
                        }
                        : {
                            companyName: context.businessName,
                            industryLocation:
                                [business.sector, business.location].filter(Boolean).join(' · ') ||
                                undefined,
                            description: business.natureOfBusiness,
                            productsServices: business.productsServices,
                            targetCustomers: business.targetCustomers,
                            revenueModel: business.revenueModel,
                            team: business.team,
                            goals: business.goals,
                            challenges: business.challenges,
                        }

                const startingAnswers = Object.fromEntries(
                    Object.entries(knownAnswers).filter(
                        (entry): entry is [string, string] => Boolean(entry[1]?.trim()),
                    ),
                )

                const result = await sendDocumentAgentMessage({
                    agentId,
                    message: '',
                    answers: startingAnswers,
                    history: [],
                    interventionContext: {
                        title: context.interventionTitle,
                        executionMode: context.executionMode,
                        steps: context.steps,
                        targetMetric: context.targetMetric,
                        targetValue: context.targetValue,
                    },
                })

                if (!active) return

                setAnswers(result.answers)
                setPreview(undefined)
                setMissingFields(result.missingFields)
                setRequestedDocuments(result.requestedDocuments)
                setMessages([{ role: 'agent', content: result.reply }])
            })
            .catch((error) => {
                if (!active) return

                setAssignment(null)
                setAssignmentError(
                    error instanceof Error ? error.message : 'This agent workspace is unavailable.',
                )
            })

        return () => {
            active = false
        }
    }, [agentId, assignmentId, definition, user])

    const send = async (
        text: string,
        attachments = [] as Awaited<ReturnType<typeof fileToAgentAttachment>>[],
    ): Promise<boolean> => {
        if (!assignment || !user || sending || (!text.trim() && !attachments.length)) {
            return false
        }

        const userTurn: DocumentAgentChatMessage = {
            role: 'user',
            content:
                text.trim() || `Attached ${attachments.map((item) => item.name).join(', ')}`,
        }

        const nextHistory = [...messages, userTurn]

        setMessages(nextHistory)
        setInput('')
        setSending(true)

        try {
            const result = await sendDocumentAgentMessage({
                agentId,
                message: userTurn.content,
                answers,
                history: messages,
                attachments,
                interventionContext: {
                    title: assignment.interventionTitle,
                    executionMode: assignment.executionMode || 'single_session',
                    steps: assignment.steps || [],
                    targetMetric: assignment.targetMetric,
                    targetValue: assignment.targetValue,
                },
            })

            const completeHistory: DocumentAgentChatMessage[] = [
                ...nextHistory,
                { role: 'agent', content: result.reply },
            ]

            setMessages(completeHistory)
            setAnswers(result.answers)
            setPreview(undefined)
            setMissingFields(result.missingFields)
            setRequestedDocuments(result.requestedDocuments)
            setDocumentsRead((current) => [
                ...new Set([...current, ...result.documentsRead]),
            ])

            const nextSteps = (assignment.steps || []).map((step) => {
                const update = result.stepUpdates?.find((item) => item.id === step.id)

                return update
                    ? {
                        ...step,
                        status: update.status,
                        evidence: update.evidence || step.evidence,
                    }
                    : step
            })

            const updatedAssignment = {
                ...assignment,
                steps: nextSteps,
            }

            setAssignment(updatedAssignment)

            await persistDocumentAgentProgress(
                updatedAssignment,
                result.answers,
                completeHistory,
                result.ready,
                user,
            )

            return true
        } catch (error) {
            message.error(error instanceof Error ? error.message : t('The agent could not respond.'))
            setMessages(nextHistory)
            return false
        } finally {
            setSending(false)
        }
    }

    const attach = async (file: File, requestedDocument?: string) => {
        try {
            const attachment = await fileToAgentAttachment(file)
            const sent = await send(
                requestedDocument
                    ? `I attached ${file.name} for the requested document "${requestedDocument}". Please read it and use relevant verified information.`
                    : `I attached ${file.name}. Please read it and use relevant verified information.`,
                [attachment],
            )

            if (sent && requestedDocument) {
                setProvidedDocuments((current) => [
                    ...new Set([...current, requestedDocument]),
                ])
                setSelectedDocument(null)
            }

            return sent
        } catch (error) {
            message.error(
                error instanceof Error ? error.message : t('The document could not be attached.'),
            )
            return false
        }
    }

    const generate = async () => {
        if (!assignment || !user || !ready || !preview) return

        setGenerating(true)

        try {
            await downloadDocumentAgentOutput(assignment, answers, user)
            message.success(t('Your final document is saved in the library and ready to download.'))
            setPreviewOpen(false)
        } catch (error) {
            message.error(
                error instanceof Error ? error.message : t('The document could not be created.'),
            )
        } finally {
            setGenerating(false)
        }
    }

    const buildPreview = async () => {
        if (!ready || previewing) return

        setPreviewing(true)

        try {
            const result = await previewDocumentAgentOutput(agentId, answers)
            setPreview(result)
            setPreviewOpen(true)
        } catch (error) {
            message.error(
                error instanceof Error ? error.message : t('The document preview could not be created.'),
            )
        } finally {
            setPreviewing(false)
        }
    }

    if (!assignmentId) {
        return (
            <DashboardPage>
                <Result
                    status="403"
                    title={t('Assigned intervention required')}
                    subTitle={t('Open this agent from an active intervention on your Interventions page.')}
                />
            </DashboardPage>
        )
    }

    if (definition === undefined) {
        return <LoadingOverlay tip={t('Loading agent')} />
    }

    if (definition === null) {
        return (
            <DashboardPage>
                <Result
                    status="404"
                    title={t('Agent unavailable')}
                    subTitle={t('This agent is not currently registered in the platform catalogue. Ask a system administrator to check the Agent Registry.')}
                />
            </DashboardPage>
        )
    }

    if (assignment === undefined && !assignmentError) {
        return <LoadingOverlay tip={t('Opening conversational agent')} />
    }

    if (!assignment) {
        return (
            <DashboardPage>
                <Result
                    status="403"
                    title={t('Agent workspace unavailable')}
                    subTitle={assignmentError}
                />
            </DashboardPage>
        )
    }

    const assignmentSteps = assignment.steps || []
    const firstIncompleteStepIndex = assignmentSteps.findIndex(
        (step) => step.status !== 'completed',
    )
    const currentStepIndex = assignmentSteps.length
        ? firstIncompleteStepIndex >= 0
            ? firstIncompleteStepIndex
            : assignmentSteps.length - 1
        : 0
    const currentStep =
        assignment.executionMode === 'multi_step' && assignmentSteps.length
            ? assignmentSteps[currentStepIndex]
            : null

    return (
        <div className="agent-workspace-page conversational-agent-page">
            <Helmet>
                <title>{definition?.name || t('Document Agent')} {t('| Smart Incubation')}</title>
            </Helmet>

            <div className="agent-workspace-layout">
                <main className="agent-chat-column">
                    <div className="agent-conversation-stream" ref={conversationRef}>
                        {!messages.length ? (
                            <div className="agent-conversation-empty">
                                <Spin size="small" />
                                <Text type="secondary">{t('Starting conversation…')}</Text>
                            </div>
                        ) : (
                            messages.map((item, index) => (
                                <div
                                    className={`agent-message-row ${item.role}`}
                                    key={`${item.role}-${index}`}
                                >
                                    {item.role === 'agent' && (
                                        <div className="agent-message-agent-mark" aria-hidden="true">
                                            <RobotOutlined />
                                        </div>
                                    )}

                                    <div className="agent-message-bubble">
                                        <Paragraph>{item.content}</Paragraph>
                                    </div>
                                </div>
                            ))
                        )}

                        {sending && (
                            <div className="agent-message-row agent">
                                <div className="agent-message-agent-mark" aria-hidden="true">
                                    <RobotOutlined />
                                </div>
                                <div className="agent-message-bubble agent-thinking">
                                    <Spin size="small" />
                                    <Text type="secondary">{t('Thinking…')}</Text>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="agent-composer-anchor">
                        <div className="agent-composer-shell">
                            <Upload
                                beforeUpload={(file) => {
                                    void attach(file as File)
                                    return false
                                }}
                                showUploadList={false}
                                accept=".pdf,.docx,.txt,.csv"
                                disabled={sending}
                            >
                                <Button
                                    type="text"
                                    shape="circle"
                                    className="agent-composer-action agent-composer-add"
                                    icon={<PlusOutlined />}
                                    aria-label={t('Attach document')}
                                    disabled={sending}
                                />
                            </Upload>

                            <TextArea
                                value={input}
                                onChange={(event) => setInput(event.target.value)}
                                placeholder={t('Message your document agent…')}
                                autoSize={{ minRows: 1, maxRows: 6 }}
                                disabled={sending}
                                onPressEnter={(event) => {
                                    if (!event.shiftKey) {
                                        event.preventDefault()
                                        void send(input)
                                    }
                                }}
                            />

                            <Button
                                type="primary"
                                shape="circle"
                                className="agent-composer-action agent-composer-send"
                                icon={<SendOutlined />}
                                aria-label={t('Send message')}
                                disabled={!input.trim() || sending}
                                loading={sending}
                                onClick={() => void send(input)}
                            />
                        </div>
                    </div>
                </main>

                <aside className="agent-side-panel">
                    <div className="agent-side-header">
                        <div className="agent-side-heading-copy">
                            <Text strong>{definition?.name}</Text>
                            <Text type="secondary" ellipsis>
                                {currentStep ? `Step ${currentStepIndex + 1} of ${assignmentSteps.length}` : assignment.interventionTitle}
                            </Text>
                        </div>

                        <span className={`agent-readiness-badge${ready ? ' is-ready' : ''}`}>
                            {ready ? <CheckCircleFilled /> : `${completion}%`}
                        </span>
                    </div>

                    <Progress
                        className="agent-side-progress"
                        percent={completion}
                        showInfo={false}
                        size="small"
                        strokeColor={{ from: '#7c3aed', to: '#2563eb' }}
                    />

                    {currentStep && (
                        <div
                            className="agent-current-step-compact"
                            title={currentStep.description || currentStep.title}
                        >
                            <span className="agent-current-step-dot" />
                            <div className="agent-current-step-copy">
                                <Text type="secondary">{t('Current step')}</Text>
                                <Text strong ellipsis>{currentStep.title}</Text>
                            </div>
                            <span className="agent-step-count">
                                {currentStepIndex + 1}/{assignmentSteps.length}
                            </span>
                        </div>
                    )}

                    <section className="agent-documents-panel">
                        <div className="agent-documents-head">
                            <Text strong>{t('Documents')}</Text>
                            <span className="agent-document-count">
                                {providedDocuments.length}/{requestedDocuments.length}
                            </span>
                        </div>

                        <div className="agent-document-pills">
                            {requestedDocuments.length ? (
                                requestedDocuments.map((item) => {
                                    const provided = providedDocuments.includes(item)

                                    return (
                                        <button
                                            type="button"
                                            className={`agent-document-pill${provided ? ' is-provided' : ''}`}
                                            key={item}
                                            title={item}
                                            onClick={() => setSelectedDocument(item)}
                                        >
                                            <span className="agent-document-pill-icon">
                                                {provided ? <CheckCircleFilled /> : <FileDoneOutlined />}
                                            </span>
                                            <span className="agent-document-pill-label">{item}</span>
                                            <PlusOutlined className="agent-document-pill-action" />
                                        </button>
                                    )
                                })
                            ) : (
                                <div className="agent-documents-empty">
                                    <CheckCircleFilled />
                                    <Text type="secondary">{t('No documents needed')}</Text>
                                </div>
                            )}
                        </div>
                    </section>

                    <div className="agent-side-footer">
                        <Button
                            type="primary"
                            block
                            icon={<EyeOutlined />}
                            disabled={!ready}
                            loading={previewing}
                            onClick={() => void buildPreview()}
                        >
                            {preview ? t('Refresh preview') : ready ? t('Build preview') : `${missingFields.length} topic${missingFields.length === 1 ? '' : 's'} remaining`}
                        </Button>
                    </div>
                </aside>
            </div>

            <Modal
                open={Boolean(selectedDocument)}
                onCancel={() => {
                    if (!sending) setSelectedDocument(null)
                }}
                centered
                width={520}
                footer={null}
                closable={!sending}
                maskClosable={!sending}
                className="agent-document-upload-modal"
                title={t('Upload supporting document')}
            >
                <div className="agent-upload-modal-content">
                    <div className="agent-upload-request-pill">
                        <FileDoneOutlined />
                        <span>{selectedDocument}</span>
                    </div>

                    <Text type="secondary" className="agent-upload-modal-help">
                        {t('Upload the file that best supports this request. The agent will read it and use only relevant verified information.')}
                    </Text>

                    <Dragger
                        multiple={false}
                        showUploadList={false}
                        accept=".pdf,.docx,.txt,.csv"
                        disabled={sending}
                        beforeUpload={(file) => {
                            if (selectedDocument) {
                                void attach(file as File, selectedDocument)
                            }
                            return false
                        }}
                    >
                        <p className="ant-upload-drag-icon">
                            {sending ? <Spin /> : <InboxOutlined />}
                        </p>
                        <p className="ant-upload-text">
                            {sending ? t('Reading document…') : t('Click or drag a file here')}
                        </p>
                        <p className="ant-upload-hint">{t('PDF, DOCX, TXT or CSV')}</p>
                    </Dragger>
                </div>
            </Modal>

            <Modal
                open={previewOpen}
                onCancel={() => setPreviewOpen(false)}
                width={900}
                centered
                title={`${definition?.name || 'Document'} preview`}
                footer={
                    <Space>
                        <Button onClick={() => setPreviewOpen(false)}>{t('Keep editing')}</Button>
                        <Button
                            type="primary"
                            icon={<DownloadOutlined />}
                            loading={generating}
                            onClick={() => void generate()}
                        >
                            {t('Finalise and download')}
                        </Button>
                    </Space>
                }
            >
                <Alert
                    type="info"
                    showIcon
                    title={t('Review before finalising')}
                    description={t('This is a working preview. Ask the agent for changes, rebuild the preview, then finalise only when you are happy.')}
                    style={{ marginBottom: 16 }}
                />

                <div className="agent-document-preview">
                    {Object.entries(preview?.preview || {}).map(([key, value]) => (
                        <section key={key}>
                            <Typography.Title level={4}>{previewLabel(key)}</Typography.Title>
                            {renderPreviewValue(value)}
                        </section>
                    ))}
                </div>
            </Modal>
        </div>
    )
}

export default AgentWorkspacePage
