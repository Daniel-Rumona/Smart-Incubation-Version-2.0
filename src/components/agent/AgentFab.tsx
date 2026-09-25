import { App, Badge, Button, Input, Modal, Rate, Segmented, Space } from 'antd'
import {
    CloseOutlined,
    ExpandOutlined,
    LoadingOutlined,
    RobotOutlined,
    SendOutlined,
    ShrinkOutlined,
} from '@ant-design/icons'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useAgent } from '@/providers/AgentProvider'
import { useBackgroundTasks } from '@/providers/BackgroundTasksProvider'
import { useLanguage } from '@/providers/LanguageProvider'
import { submitAgentConversationRating } from '@/services/agentService'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import type { AgentChatMessage, AgentPageContext, AgentProposalStatus } from '@/types/agent'
import { AgentTaskPanel } from '@/components/agent/AgentTaskPet'
import { AgentRichText } from '@/components/agent/AgentRichText'
import { AgentProposalCard } from '@/components/agent/AgentProposalCard'
import '@/styles/agent-fab.css'

type AgentView = 'assistant' | 'tasks'

const createMessage = (
    role: AgentChatMessage['role'],
    content: string,
    rateable = false,
): AgentChatMessage => ({
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
    rateable,
})

const defaultPageContext = (): AgentPageContext => ({
    pageKey: 'workspace',
    pageName: 'Workspace',
    purpose: 'General workspace support.',
    updatedAt: new Date().toISOString(),
})

export const AgentFab = ({ placement = 'floating' }: { placement?: 'floating' | 'topbar' }) => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { getActivePageContext } = useAgent()
    const { tasks, queueTask } = useBackgroundTasks()
    const { user } = useFullIdentity()

    const [open, setOpen] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const [view, setView] = useState<AgentView>('assistant')
    const [draft, setDraft] = useState('')
    const [messages, setMessages] = useState<AgentChatMessage[]>([])
    const [ratingMessageId, setRatingMessageId] = useState<string>()
    const [sessionRating, setSessionRating] = useState<number>()
    const [ratingDismissed, setRatingDismissed] = useState(false)

    const conversationId = useId()
    const bodyRef = useRef<HTMLDivElement>(null)
    const context = getActivePageContext() ?? defaultPageContext()

    const activeTaskCount = tasks.filter((task) =>
        ['queued', 'running'].includes(task.status),
    ).length
    const failedTaskCount = tasks.filter((task) => task.status === 'failed').length
    const taskCount = tasks.length

    // The English text is what gets sent to the agent (and logged); only the button label is translated.
    const templates = useMemo(() => {
        const explain = `Explain ${context.pageName}`
        const nextSteps = `What can I do on ${context.pageName}?`
        const base = [
            { prompt: explain, label: t('agent.template.explain', explain).replace('{page}', context.pageName) },
            { prompt: nextSteps, label: t('agent.template.nextSteps', nextSteps).replace('{page}', context.pageName) },
        ]

        if (context.pageKey.includes('program')) {
            return [...base, { prompt: 'Help me understand these programs', label: t('agent.template.programs', 'Help me understand these programs') }]
        }

        if (context.pageKey.includes('tracker')) {
            return [...base, { prompt: 'Help me understand this tracker', label: t('agent.template.tracker', 'Help me understand this tracker') }]
        }

        if (context.pageKey.includes('profile')) {
            return [...base, { prompt: 'Help me complete this profile', label: t('agent.template.profile', 'Help me complete this profile') }]
        }

        return base
    }, [context.pageKey, context.pageName, t])

    useEffect(() => {
        if (view !== 'assistant') return

        bodyRef.current?.scrollTo({
            top: bodyRef.current.scrollHeight,
            behavior: 'smooth',
        })
    }, [messages, view])

    const send = (content = draft) => {
        const nextContent = content.trim()
        if (!nextContent) return

        const userMessage = createMessage('user', nextContent)
        const pendingMessage = createMessage('agent', 'Working on this in the background…')
        const history = messages

        setMessages((current) => [...current, userMessage, pendingMessage])
        setDraft('')
        queueTask({
            title: `Workspace: ${nextContent}`,
            prompt: nextContent,
            page: context,
            history,
            onCompleted: (result, proposal) => setMessages((current) => current.map((item) => item.id === pendingMessage.id
                ? { ...item, content: result, ...(proposal ? { proposal, proposalStatus: 'pending' as const } : {}) }
                : item)),
            onFailed: (error) => {
                setMessages((current) => current.map((item) => item.id === pendingMessage.id
                    ? { ...item, content: error }
                    : item))
                message.error(error)
            },
        })
    }

    const updateProposal = (messageId: string, proposalStatus: AgentProposalStatus, proposalNote?: string) => {
        setMessages((current) => current.map((item) => item.id === messageId
            ? { ...item, proposalStatus, proposalNote }
            : item))
    }

    const rateAgentMessage = async (
        chatMessage: AgentChatMessage,
        rating: number,
    ) => {
        if (!user || !rating || chatMessage.rating) return

        try {
            setRatingMessageId(chatMessage.id)

            await submitAgentConversationRating({
                user,
                conversationId,
                messageId: chatMessage.id,
                page: context,
                rating,
            })

            setMessages((current) =>
                current.map((item) =>
                    item.id === chatMessage.id ? { ...item, rating } : item,
                ),
            )
            setSessionRating(rating)

            message.success(
                t('agent.rating.saved', 'Thank you for rating this response.'),
            )
        } catch {
            message.error(
                t(
                    'agent.rating.error',
                    'Your rating could not be saved. Please try again.',
                ),
            )
        } finally {
            setRatingMessageId(undefined)
        }
    }

    const closePanel = () => {
        setOpen(false)
        setExpanded(false)
    }

    const toggleAgent = () => {
        if (open) {
            closePanel()
            return
        }

        setOpen(true)
    }

    const taskAlertMessage = failedTaskCount > 0
        ? (failedTaskCount === 1
            ? t('{count} background task needs attention', undefined, { count: failedTaskCount })
            : t('{count} background tasks need attention', undefined, { count: failedTaskCount }))
        : activeTaskCount > 0
            ? (activeTaskCount === 1
                ? t('{count} background task running', undefined, { count: activeTaskCount })
                : t('{count} background tasks running', undefined, { count: activeTaskCount }))
            : (taskCount === 1
                ? t('{count} background task ready', undefined, { count: taskCount })
                : t('{count} background tasks ready', undefined, { count: taskCount }))
    const completedResponses = messages.filter((item) => item.role === 'agent' && item.content !== 'Working on this in the background…')
    const sessionRatingTarget = completedResponses.at(-1)
    const showSessionRating = Boolean(sessionRatingTarget && completedResponses.length >= 3 && !sessionRating && !ratingDismissed)

    return (
        <>
            <Modal
                open={open}
                centered
                footer={null}
                width={expanded ? 1040 : 620}
                title={t('Thuso')}
                onCancel={closePanel}
                className="agent-conversation-modal"
            >
                <section className={`agent-panel agent-modal-panel ${expanded ? 'is-expanded' : ''}`}>
                    <header className="agent-panel-header agent-modal-header">
                        <div className="agent-assistant-identity">
                            <span className="agent-avatar">
                                <RobotOutlined />
                            </span>
                            <div>
                                <strong>{t('Thuso')}</strong>
                                <span className="agent-status">
                                    <span />
                                    {view === 'assistant'
                                        ? activeTaskCount > 0
                                            ? `${activeTaskCount} ${t('agent.tasks.running', 'running')}`
                                            : t('agent.ready', `${context.pageName} ready`)
                                        : activeTaskCount > 0
                                            ? `${activeTaskCount} ${t('agent.tasks.running', 'running')}`
                                            : t('agent.tasks.idle', 'Background tasks')}
                                </span>
                            </div>
                        </div>
                        <Segmented
                            className="agent-header-segmented"
                            value={view}
                            onChange={(value) => setView(value as AgentView)}
                            options={[
                                { value: 'assistant', label: t('agent.helper', 'Helper') },
                                {
                                    value: 'tasks',
                                    label: <Space size={6}><span>{t('agent.tasks.title', 'Tasks')}</span>{taskCount > 0 && <Badge count={activeTaskCount || taskCount} size="small" overflowCount={99} />}</Space>,
                                },
                            ]}
                        />
                        <Button
                            type="text"
                            shape="circle"
                            icon={expanded ? <ShrinkOutlined /> : <ExpandOutlined />}
                            onClick={() => setExpanded((value) => !value)}
                            aria-label={t('agent.toggleFullscreen', 'Toggle fullscreen')}
                        />
                    </header>

                    {view === 'assistant' ? (
                        <div className="agent-panel-body" ref={bodyRef}>
                            {taskCount > 0 && (
                                <div className={`agent-task-signal ${failedTaskCount > 0 ? 'is-error' : activeTaskCount > 0 ? 'is-active' : 'is-ready'}`}>
                                    <span className="agent-task-signal-icon">
                                        {activeTaskCount > 0 ? <LoadingOutlined spin /> : failedTaskCount > 0 ? <CloseOutlined /> : <RobotOutlined />}
                                    </span>
                                    <div className="agent-message-content">
                                        <strong>{taskAlertMessage}</strong>
                                        <span>{activeTaskCount > 0 ? t('Continuing while you work') : t('Open Tasks to review the results')}</span>
                                    </div>
                                    <Button size="small" onClick={() => setView('tasks')}>
                                        {t('agent.tasks.view', 'View tasks')}
                                    </Button>
                                </div>
                            )}

                            {messages.length === 0 && (
                                <>
                                    <div className="agent-message">
                                        <span className="agent-avatar is-small">
                                            <RobotOutlined />
                                        </span>
                                        <div>
                                            <p>
                                                {t(
                                                    'agent.pageReady',
                                                    `I am ready to help with ${context.pageName}.`,
                                                ).replace('{page}', context.pageName)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="agent-templates">
                                        {templates.map((template) => (
                                            <Button key={template.prompt} onClick={() => void send(template.prompt)}>
                                                {template.label}
                                            </Button>
                                        ))}
                                    </div>
                                </>
                            )}

                            {messages.map((chatMessage) => (
                                <div
                                    className={`agent-message is-${chatMessage.role} ${chatMessage.content === 'Working on this in the background…' ? 'is-pending' : ''}`}
                                    key={chatMessage.id}
                                >
                                    {chatMessage.role === 'agent' && (
                                        <span className="agent-avatar is-small">
                                            <RobotOutlined />
                                        </span>
                                    )}

                                    {chatMessage.role === 'agent'
                                        ? <div className="agent-message-content">
                                            {chatMessage.content === 'Working on this in the background…'
                                                ? <span className="agent-pending-copy"><LoadingOutlined spin />{chatMessage.content}</span>
                                                : <AgentRichText content={chatMessage.content} />}
                                            {chatMessage.proposal && (
                                                <AgentProposalCard
                                                    proposal={chatMessage.proposal}
                                                    status={chatMessage.proposalStatus ?? 'pending'}
                                                    note={chatMessage.proposalNote}
                                                    onChange={(status, note) => updateProposal(chatMessage.id, status, note)}
                                                />
                                            )}
                                        </div>
                                        : <p>{chatMessage.content}</p>}

                            </div>
                            ))}

                        </div>
                    ) : (
                        <div className="agent-panel-body agent-panel-task-body">
                            <AgentTaskPanel />
                        </div>
                    )}

                    {view === 'assistant' && (
                        <>{showSessionRating && sessionRatingTarget && <div className="agent-session-rating">
                            <span>{t('How helpful has Thuso been in this session?')}</span>
                            <Rate disabled={ratingMessageId === sessionRatingTarget.id} onChange={(value) => void rateAgentMessage(sessionRatingTarget, value)} />
                            <Button type="text" size="small" onClick={() => setRatingDismissed(true)}>{t('Not now')}</Button>
                        </div>}
                        <footer className="agent-panel-footer">
                            <Input
                                value={draft}
                                onChange={(event) => setDraft(event.target.value)}
                                onPressEnter={() => void send()}
                                placeholder={t('agent.placeholder', 'Ask Thuso about this page...')}
                                suffix={(
                                    <Button
                                        type="text"
                                        size="small"
                                        icon={<SendOutlined />}
                                        onClick={() => void send()}
                                        disabled={!draft.trim()}
                                        aria-label={t('agent.send', 'Send')}
                                    />
                                )}
                            />
                        </footer>
                        </>
                    )}
                </section>
            </Modal>

            {placement === 'topbar' && <Button type="text" shape="circle" icon={<RobotOutlined />} onClick={toggleAgent} className="app-icon-btn agent-topbar-trigger" aria-label={t('agent.title', 'Open Thuso')} />}
        </>
    )
}
