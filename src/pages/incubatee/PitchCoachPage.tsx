import { useEffect, useRef, useState } from 'react'
import {
    Alert,
    App,
    Button,
    Card,
    Col,
    Input,
    List,
    Modal,
    Popconfirm,
    Row,
    Segmented,
    Spin,
    Typography,
} from 'antd'
import {
    AudioOutlined,
    FileSearchOutlined,
    PhoneOutlined,
    PlusOutlined,
    RobotOutlined,
    DeleteOutlined,
} from '@ant-design/icons'
import { useSearchParams } from 'react-router-dom'
import { Conversation } from '@elevenlabs/client'
import DashboardPage from '@/components/shared/DashboardPage'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useTopbarBackButton } from '@/contexts/SystemLayoutTopbarContext'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import {
    createPitchProject,
    deletePitchProject,
    listPitchProjects,
    startPitchVoiceSession,
    type PitchProjectSummary,
    type PitchSessionMode,
} from '@/services/pitchCoachService'
import '@/styles/pitch-coach.css'
import { useLanguage } from '@/providers/LanguageProvider'

const { TextArea } = Input

type CallStatus = 'idle' | 'connecting' | 'connected' | 'ending'
type VoiceMode = 'speaking' | 'listening' | null

type DynamicVariableValue = string | number | boolean

type TranscriptTurn = {
    role: string
    message: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asRecord = (value: unknown): Record<string, any> =>
    value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {}

const firstText = (...values: unknown[]): string => {
    const value = values.find(
        (candidate) =>
            typeof candidate === 'string' &&
            candidate.trim(),
    )

    return typeof value === 'string'
        ? value.trim()
        : ''
}

const errorMessageOf = (
    error: unknown,
    fallback: string,
): string => {
    if (error instanceof Error && error.message) {
        return error.message
    }

    if (typeof error === 'string' && error.trim()) {
        return error.trim()
    }

    return fallback
}

const cleanDynamicVariables = (
    value: unknown,
): Record<string, DynamicVariableValue> => {
    const raw = asRecord(value)

    return Object.fromEntries(
        Object.entries(raw).filter(([, item]) => {
            return (
                typeof item === 'string' ||
                typeof item === 'number' ||
                typeof item === 'boolean'
            )
        }),
    ) as Record<string, DynamicVariableValue>
}

const PitchCoachPage = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [searchParams] = useSearchParams()

    useTopbarBackButton({ hideSidebar: true })

    const assignmentId =
        searchParams.get('assignmentId') || undefined

    const identity = user as (
        typeof user & {
            companyCode?: string
            participantId?: string
        }
    )

    const companyCode =
        identity?.companyCode || ''

    const participantId =
        identity?.participantId ||
        identity?.uid ||
        ''

    const [project, setProject] =
        useState<PitchProjectSummary | null>(null)

    const [projects, setProjects] = useState<PitchProjectSummary[]>([])

    const [briefText, setBriefText] =
        useState('')

    const [projectName, setProjectName] = useState('')

    const [mode, setMode] =
        useState<PitchSessionMode>('interactive')

    const [loadingProject, setLoadingProject] =
        useState(true)

    const [creating, setCreating] =
        useState(false)

    const [projectManagerOpen, setProjectManagerOpen] = useState(false)
    const [newProjectOpen, setNewProjectOpen] = useState(false)
    const [newProjectMode, setNewProjectMode] = useState<PitchSessionMode>('interactive')
    const [deletingProjectId, setDeletingProjectId] = useState<string>()

    const [callStatus, setCallStatus] =
        useState<CallStatus>('idle')

    const [voiceMode, setVoiceMode] =
        useState<VoiceMode>(null)

    const [caption, setCaption] =
        useState('')

    const [orbScale, setOrbScale] =
        useState(1)

    const conversationRef =
        useRef<Conversation | null>(null)

    const frameRef =
        useRef<number | null>(null)

    const transcriptRef =
        useRef<TranscriptTurn[]>([])

    const sessionStartedAtRef =
        useRef<number | null>(null)

    const disconnectHandledRef =
        useRef(false)

    useRegisterAgentPageContext({
        pageKey: 'pitching',
        pageName: 'Pitching Coach',
        purpose:
            'Help the user prepare, practise, evaluate, and improve their business pitch.',

        currentFilters: {
            mode,
            assignmentId,
        },

        metrics: {
            hasProject: Boolean(project),
            callStatus,
            voiceMode,
        },

        dataSummary: {
            coachingModes: {
                guidedConversation: {
                    label: t('Guided Conversation'),
                    description:
                        t('A collaborative coaching session where the agent and user work through the pitch together. The agent asks focused questions one at a time, adapts to each answer, probes unclear areas, and progressively helps the user build and strengthen the pitch.'),
                    agentBehaviour: [
                        'Use a conversational back-and-forth approach.',
                        'Ask one focused question at a time.',
                        'Use previous answers when deciding what to ask next.',
                        'Probe vague, weak, contradictory, or incomplete answers.',
                        'Help the user formulate stronger responses instead of simply rating them.',
                        'Gradually build toward a complete and coherent pitch.',
                    ],
                },

                pitchFirst: {
                    label: t('Pitch-First Review'),
                    description:
                        t('The user delivers their pitch first, ideally within two minutes. The agent listens to the complete pitch before evaluating it, then provides a rating, identifies strengths and weaknesses, and asks targeted questions to refine the pitch.'),
                    agentBehaviour: [
                        'Do not interrupt the initial pitch with coaching questions.',
                        'Treat the first submission as the user presenting an actual pitch.',
                        'After the pitch, evaluate it against the approved pitch criteria.',
                        'Give a clear rating with reasons grounded in what the user actually said.',
                        'Identify strong areas, missing information, weak claims, and unclear sections.',
                        'Ask targeted follow-up questions based on the identified gaps.',
                        'Use the follow-up answers to help produce a stronger next version of the pitch.',
                        'Allow the user to retry or present an improved pitch after refinement.',
                    ],
                },
            },
        },
    })

    useEffect(() => {
        if (!companyCode) {
            void Promise.resolve().then(() => {
                setLoadingProject(false)
            })
            return
        }

        let active = true

        void listPitchProjects(
            companyCode,
            assignmentId,
        )
            .then((result) => {
                if (!active) return

                setProject(
                    result.projects[0] || null,
                )
                setProjects(result.projects)
            })
            .catch((error) => {
                if (!active) return

                message.error(
                    errorMessageOf(
                        error,
                        'The pitch coaching workspace could not be loaded.',
                    ),
                )
            })
            .finally(() => {
                if (active) {
                    setLoadingProject(false)
                }
            })

        return () => {
            active = false
        }
    }, [
        assignmentId,
        companyCode,
        message,
    ])

    useEffect(() => {
        return () => {
            void conversationRef.current
                ?.endSession()
                .catch(() => undefined)

            conversationRef.current = null

            if (frameRef.current !== null) {
                cancelAnimationFrame(
                    frameRef.current,
                )
                frameRef.current = null
            }
        }
    }, [])

    const createProject = async () => {
        if (!companyCode) {
            message.error(
                t('Your company context could not be resolved.'),
            )
            return
        }

        if (!briefText.trim()) {
            message.warning(
                t('Add the pitch, interview, job, or funding brief first.'),
            )
            return
        }

        setCreating(true)

        try {
            const result =
                await createPitchProject({
                    companyCode,
                    assignmentId,
                    participantId,
                    text: briefText.trim(),
                    uiTitle: projectName.trim() || undefined,
                })

            setProject(result.mapping)
            setProjects((current) => [result.mapping, ...current])
            setNewProjectOpen(false)
            setBriefText('')
            setProjectName('')
            setMode(newProjectMode)

            message.success(
                t('Pitch coaching project created.'),
            )
        } catch (error) {
            message.error(
                errorMessageOf(
                    error,
                    'The project could not be created.',
                ),
            )
        } finally {
            setCreating(false)
        }
    }

    const deleteProject = async (projectToDelete: PitchProjectSummary) => {
        if (!companyCode) return
        setDeletingProjectId(projectToDelete.externalProjectId)
        try {
            await deletePitchProject(projectToDelete.externalProjectId, companyCode)
            setProjects((current) => current.filter((item) => item.id !== projectToDelete.id))
            setProject((current) => current?.id === projectToDelete.id
                ? projects.find((item) => item.id !== projectToDelete.id) || null
                : current)
            message.success(t('Pitching project deleted.'))
        } catch (error) {
            message.error(errorMessageOf(error, 'The project could not be deleted.'))
        } finally {
            setDeletingProjectId(undefined)
        }
    }

    const stopVolumeLoop = () => {
        if (frameRef.current !== null) {
            cancelAnimationFrame(
                frameRef.current,
            )

            frameRef.current = null
        }

        setOrbScale(1)
    }

    const applyOutputVolume = (
        value: unknown,
    ) => {
        const volume = Number(value)

        if (!Number.isFinite(volume)) {
            return
        }

        const normalized = Math.max(
            0,
            Math.min(1, volume),
        )

        setOrbScale(
            1 + normalized * 0.32,
        )
    }

    const pollVolume = () => {
        const conversation =
            conversationRef.current

        if (
            !conversation ||
            !conversation.isOpen()
        ) {
            stopVolumeLoop()
            return
        }

        try {
            const volume =
                conversation.getOutputVolume()

            if (
                volume &&
                typeof (
                    volume as unknown as Promise<number>
                )?.then === 'function'
            ) {
                void Promise.resolve(volume)
                    .then(applyOutputVolume)
                    .catch(() => undefined)
            } else {
                applyOutputVolume(volume)
            }
        } catch {
            // Volume metering is visual only.
        }

        frameRef.current =
            requestAnimationFrame(
                pollVolume,
            )
    }

    const resetSessionCapture = () => {
        transcriptRef.current = []
        sessionStartedAtRef.current = null
        disconnectHandledRef.current = false
    }

    const getCapturedSession = () => {
        const startedAt =
            sessionStartedAtRef.current

        const durationSeconds =
            startedAt
                ? Math.max(
                    1,
                    Math.round(
                        (
                            Date.now() -
                            startedAt
                        ) / 1000,
                    ),
                )
                : 0

        const transcript =
            transcriptRef.current
                .map((turn) => {
                    const speaker =
                        turn.role === 'agent'
                            ? 'Coach'
                            : 'Participant'

                    return `${speaker}: ${turn.message}`
                })
                .join('\n')

        return {
            transcript,
            durationSeconds,
        }
    }

    const handleDisconnected = () => {
        if (disconnectHandledRef.current) {
            return
        }

        disconnectHandledRef.current = true

        const captured =
            getCapturedSession()

        /*
         * We capture the complete voice session here so it is ready
         * for Pitchfy transcript scoring once analyzePitchTranscript
         * is exposed by pitchCoachService.
         */
        if (captured.transcript) {
            console.debug(
                '[Pitch Voice] Session captured',
                {
                    durationSeconds:
                        captured.durationSeconds,
                    transcriptLength:
                        captured.transcript.length,
                },
            )
        }

        conversationRef.current = null

        setCallStatus('idle')
        setVoiceMode(null)
        setCaption('')

        stopVolumeLoop()
    }

    const requestMicrophonePermission =
        async () => {
            if (
                !navigator.mediaDevices
                    ?.getUserMedia
            ) {
                throw new Error(
                    'Microphone access is not available in this browser. Make sure the site is opened over HTTPS and microphone access is supported.',
                )
            }

            const stream =
                await navigator.mediaDevices
                    .getUserMedia({
                        audio: true,
                    })

            /*
             * This request is only used to obtain/verify permission.
             * ElevenLabs opens its own microphone stream when the
             * conversation begins.
             */
            stream
                .getTracks()
                .forEach((track) => {
                    track.stop()
                })
        }

    const startCall = async () => {
        if (
            !project?.externalProjectId ||
            !companyCode
        ) {
            return
        }

        if (callStatus !== 'idle') {
            return
        }

        setCallStatus('connecting')
        setVoiceMode(null)
        setCaption('')

        resetSessionCapture()

        try {
            /*
             * ElevenLabs requires microphone permission for
             * a voice conversation.
             */
            try {
                await requestMicrophonePermission()
            } catch (error) {
                const name =
                    error instanceof DOMException
                        ? error.name
                        : ''

                if (
                    name === 'NotAllowedError' ||
                    name ===
                    'PermissionDeniedError'
                ) {
                    throw new Error(
                        'Microphone access was blocked. Allow microphone access for this site and try again.',
                    )
                }

                throw error
            }

            /*
             * Pitchfy returns connection context:
             * agentId + briefing + dynamicVariables.
             */
            const result =
                await startPitchVoiceSession(
                    project.externalProjectId,
                    companyCode,
                    mode,
                )

            const voice =
                asRecord(
                    result.voiceSession,
                )

            const agentId =
                firstText(
                    voice.agentId,
                    voice.agent_id,
                )

            if (!agentId) {
                throw new Error(
                    'The voice coach could not be resolved from the session response.',
                )
            }

            const dynamicVariables =
                cleanDynamicVariables(
                    voice.dynamicVariables ||
                    voice.dynamic_variables,
                )

            /*
             * Pitchfy's ElevenLabs agent is public.
             *
             * There is intentionally NO signedUrl here.
             * The browser connects directly to ElevenLabs
             * with the public agentId.
             */
            const conversation =
                await Conversation.startSession({
                    agentId,

                    ...(Object.keys(
                        dynamicVariables,
                    ).length
                        ? {
                            dynamicVariables,
                        }
                        : {}),

                    onConnect: () => {
                        sessionStartedAtRef.current =
                            Date.now()

                        disconnectHandledRef.current =
                            false

                        setCallStatus(
                            'connected',
                        )
                    },

                    onDisconnect: () => {
                        handleDisconnected()
                    },

                    onError: (
                        errorMessage,
                    ) => {
                        message.error(
                            errorMessageOf(
                                errorMessage,
                                'The voice call ended unexpectedly.',
                            ),
                        )

                        handleDisconnected()
                    },

                    onModeChange: ({
                        mode: nextMode,
                    }) => {
                        setVoiceMode(
                            nextMode,
                        )

                        if (
                            nextMode ===
                            'speaking' &&
                            frameRef.current ===
                            null
                        ) {
                            frameRef.current =
                                requestAnimationFrame(
                                    pollVolume,
                                )
                        } else if (
                            nextMode !==
                            'speaking'
                        ) {
                            stopVolumeLoop()
                        }
                    },

                    onMessage: ({
                        message: text,
                        role,
                    }) => {
                        const cleaned =
                            text?.trim()

                        if (!cleaned) {
                            return
                        }

                        transcriptRef.current.push({
                            role:
                                role ||
                                'unknown',
                            message:
                                cleaned,
                        })

                        if (
                            role ===
                            'agent'
                        ) {
                            setCaption(
                                cleaned,
                            )
                        }
                    },
                })

            conversationRef.current =
                conversation
        } catch (error) {
            conversationRef.current =
                null

            setCallStatus('idle')
            setVoiceMode(null)

            stopVolumeLoop()

            message.error(
                errorMessageOf(
                    error,
                    'The voice call could not be started.',
                ),
            )
        }
    }

    const endCall = async () => {
        const conversation =
            conversationRef.current

        if (!conversation) {
            handleDisconnected()
            return
        }

        setCallStatus('ending')

        try {
            await conversation.endSession()
        } catch (error) {
            message.error(
                errorMessageOf(
                    error,
                    'The voice call could not be ended cleanly.',
                ),
            )
        } finally {
            /*
             * ElevenLabs normally fires onDisconnect after
             * endSession. Calling this as a fallback ensures
             * the UI always resets if that callback does not fire.
             */
            handleDisconnected()
        }
    }

    if (loadingProject) {
        return (
            <DashboardPage className="pitch-coach-page">
                <div className="pitch-coach-loading">
                    <Spin size="large" />

                    <Typography.Text
                        type="secondary"
                    >
                        {t('Loading pitch coaching workspace')}
                    </Typography.Text>
                </div>
            </DashboardPage>
        )
    }

    if (!companyCode) {
        return (
            <DashboardPage className="pitch-coach-page">
                <Alert
                    type="error"
                    showIcon
                    message={t('Company context is missing')}
                    description={t('Your user profile must have a company code before the Pitch Preparation Agent can be used.')}
                />
            </DashboardPage>
        )
    }

    const statusLabel =
        callStatus === 'connecting'
            ? 'Connecting…'
            : callStatus === 'ending'
                ? 'Ending call…'
                : callStatus ===
                    'connected'
                    ? voiceMode ===
                        'speaking'
                        ? 'Coach is speaking…'
                        : 'Listening…'
                    : 'Tap start when you are ready to practise out loud.'

    return (
        <DashboardPage className="pitch-coach-page">
            {!project ? (
                <Row
                    gutter={[20, 20]}
                    align="stretch"
                >
                    <Col xs={24} xl={15}>
                        <Card className="pitch-coach-card pitch-coach-setup-card">
                            <div className="pitch-coach-section-heading">
                                <div className="pitch-coach-section-icon">
                                    <FileSearchOutlined />
                                </div>

                                <div>
                                    <Typography.Title
                                        level={4}
                                    >
                                        {t('Set the practice brief')}
                                    </Typography.Title>

                                    <Typography.Text
                                        type="secondary"
                                    >
                                        {t('Add the funding brief, pitch requirement, job description, presentation brief, or interview context you are preparing for.')}
                                    </Typography.Text>
                                </div>
                            </div>

                            <TextArea
                                className="pitch-coach-brief-input"
                                rows={12}
                                value={
                                    briefText
                                }
                                onChange={(
                                    event,
                                ) =>
                                    setBriefText(
                                        event
                                            .target
                                            .value,
                                    )
                                }
                                placeholder={t('Paste the full brief here...')}
                                maxLength={
                                    200000
                                }
                                showCount
                            />

                            <Button
                                className="pitch-coach-create-button"
                                type="primary"
                                size="large"
                                block
                                icon={
                                    <RobotOutlined />
                                }
                                loading={
                                    creating
                                }
                                onClick={() =>
                                    void createProject()
                                }
                            >
                                {t('Create pitching brief')}
                            </Button>
                        </Card>
                    </Col>

                    <Col xs={24} xl={9}>
                        <Card className="pitch-coach-card pitch-coach-tips-card">
                            <Typography.Title
                                level={5}
                            >
                                {t('What happens next')}
                            </Typography.Title>

                            <ul className="pitch-coach-steps">
                                <li>
                                    <span className="pitch-coach-step-icon">
                                        <FileSearchOutlined />
                                    </span>

                                    <div>
                                        <Typography.Text
                                            strong
                                        >
                                            {t('Set your brief')}
                                        </Typography.Text>

                                        <Typography.Text
                                            type="secondary"
                                        >
                                            {t('The coach uses it to prepare what to ask you about.')}
                                        </Typography.Text>
                                    </div>
                                </li>

                                <li>
                                    <span className="pitch-coach-step-icon">
                                        <AudioOutlined />
                                    </span>

                                    <div>
                                        <Typography.Text
                                            strong
                                        >
                                            {t('Practise out loud')}
                                        </Typography.Text>

                                        <Typography.Text
                                            type="secondary"
                                        >
                                            {t('Choose interactive interview or pitch-first mode, then start a live voice call.')}
                                        </Typography.Text>
                                    </div>
                                </li>
                            </ul>
                        </Card>
                    </Col>
                </Row>
            ) : (
                <div className="pitch-coach-active-layout">
                <Card className="pitch-coach-card pitch-coach-orb-card">
                    <div className="pitch-coach-control-row">
                        <Segmented<PitchSessionMode>
                            block
                            className="pitch-coach-mode-segmented"
                            value={mode}
                            disabled={
                                callStatus !==
                                'idle'
                            }
                            onChange={(value) => {
                                if (value === 'pitch_first' && value !== mode) {
                                    setNewProjectMode('pitch_first')
                                    setNewProjectOpen(true)
                                    return
                                }
                                setMode(value)
                            }}
                            options={[
                                {
                                    label:
                                        t('Interactive interview'),
                                    value:
                                        'interactive',
                                },
                                {
                                    label:
                                        t('Pitch first'),
                                    value:
                                        'pitch_first',
                                },
                            ]}
                        />
                    </div>

                    <div className="pitch-orb-stage">
                        <div
                            className={[
                                'pitch-orb-wrap',
                                callStatus ===
                                    'connecting'
                                    ? 'is-connecting'
                                    : '',
                                voiceMode ===
                                    'listening'
                                    ? 'is-listening'
                                    : '',
                                voiceMode ===
                                    'speaking'
                                    ? 'is-speaking'
                                    : '',
                            ]
                                .filter(
                                    Boolean,
                                )
                                .join(' ')}
                        >
                            <span className="pitch-orb-ring" />
                            <span className="pitch-orb-ring" />
                            <span className="pitch-orb-ring" />

                            <div
                                className="pitch-orb"
                                style={
                                    {
                                        '--orb-scale':
                                            orbScale,
                                    } as React.CSSProperties
                                }
                            />
                        </div>

                        <Typography.Text
                            type="secondary"
                            className="pitch-orb-status"
                        >
                            {statusLabel}
                        </Typography.Text>

                        {caption &&
                            callStatus ===
                            'connected' && (
                                <Typography.Paragraph className="pitch-orb-caption">
                                    {
                                        caption
                                    }
                                </Typography.Paragraph>
                            )}

                        {callStatus ===
                            'idle' ? (
                            <Button
                                type="primary"
                                size="large"
                                shape="round"
                                icon={
                                    <AudioOutlined />
                                }
                                onClick={() =>
                                    void startCall()
                                }
                            >
                                {t('Start voice practice')}
                            </Button>
                        ) : (
                            <Button
                                danger
                                size="large"
                                shape="round"
                                icon={
                                    <PhoneOutlined />
                                }
                                loading={
                                    callStatus ===
                                    'connecting' ||
                                    callStatus ===
                                    'ending'
                                }
                                onClick={() =>
                                    void endCall()
                                }
                            >
                                {callStatus ===
                                    'connecting'
                                    ? t('Connecting…')
                                    : callStatus ===
                                        'ending'
                                        ? t('Ending…')
                                        : t('End call')}
                            </Button>
                        )}
                    </div>
                </Card>

                <aside className="pitch-coach-project-panel">
                    <Card
                        className="pitch-coach-card"
                        title={t('Pitching projects')}
                        extra={<Button type="text" icon={<PlusOutlined />} onClick={() => { setNewProjectMode('interactive'); setNewProjectOpen(true) }}>{t('New')}</Button>}
                    >
                        <Typography.Text type="secondary" className="pitch-coach-project-panel-copy">
                            {t('Switch between practice briefs without losing your current workspace.')}
                        </Typography.Text>
                        <List
                            className="pitch-coach-project-list"
                            dataSource={projects}
                            renderItem={(item, index) => (
                                <List.Item
                                    className={item.id === project.id ? 'is-active' : ''}
                                    actions={[<Button key="open" type="link" size="small" onClick={() => setProject(item)}>{t('Open')}</Button>]}
                                >
                                    <List.Item.Meta
                                        title={item.uiTitle || `Pitch project ${index + 1}`}
                                        description={item.status === 'active' ? t('Ready to practise') : item.status}
                                    />
                                </List.Item>
                            )}
                        />
                        <Button block onClick={() => setProjectManagerOpen(true)}>{t('Manage projects')}</Button>
                    </Card>
                </aside>
                </div>
            )}

            <Modal open={newProjectOpen} title={newProjectMode === 'pitch_first' ? t('Start a new pitch-first project') : t('Start a new pitching project')} footer={null} onCancel={() => setNewProjectOpen(false)}>
                <Typography.Paragraph type="secondary">{t('Add the brief you are preparing for. The coach will use it to tailor your practice.')}</Typography.Paragraph>
                <Input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={t('Project name (for your workspace)')} maxLength={120} style={{ marginBottom: 12 }} />
                <TextArea rows={8} value={briefText} onChange={(event) => setBriefText(event.target.value)} placeholder={t('Paste the full brief here...')} maxLength={200000} showCount />
                <Button block type="primary" icon={<RobotOutlined />} loading={creating} onClick={() => void createProject()} style={{ marginTop: 16 }}>{t('Create pitching brief')}</Button>
            </Modal>

            <Modal open={projectManagerOpen} title={t('Manage pitching projects')} footer={null} onCancel={() => setProjectManagerOpen(false)}>
                <List
                    dataSource={projects}
                    locale={{ emptyText: t('No pitching projects yet.') }}
                    renderItem={(item, index) => (
                        <List.Item actions={[
                            <Button key="open" type="link" onClick={() => { setProject(item); setProjectManagerOpen(false) }}>{t('Open')}</Button>,
                            <Popconfirm key="delete" title={t('Delete this pitching project?')} description={t('This also removes its provider workspace and cannot be undone.')} okText={t('Delete')} okButtonProps={{ danger: true, loading: deletingProjectId === item.externalProjectId }} onConfirm={() => void deleteProject(item)}>
                                <Button type="text" danger icon={<DeleteOutlined />} aria-label={t('Delete project')} />
                            </Popconfirm>,
                        ]}>
                            <List.Item.Meta title={item.uiTitle || `Pitch project ${index + 1}`} description={item.status === 'active' ? t('Ready to practise') : item.status} />
                        </List.Item>
                    )}
                />
                <Button block icon={<PlusOutlined />} onClick={() => { setProjectManagerOpen(false); setNewProjectMode('interactive'); setNewProjectOpen(true) }}>{t('Start a new project')}</Button>
            </Modal>
        </DashboardPage>
    )
}

export default PitchCoachPage
