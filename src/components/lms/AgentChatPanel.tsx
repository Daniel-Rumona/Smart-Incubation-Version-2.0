import { useEffect, useRef, type ReactNode } from 'react'
import { Button, Input } from 'antd'
import { AudioOutlined, LoadingOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons'
import { AgentRichText } from '@/components/agent/AgentRichText'
import { AGENT_PENDING_CONTENT } from '@/hooks/useLessonAgentChat'
import type { AgentChatMessage } from '@/types/agent'
import '@/styles/agent-fab.css'

type AgentChatPanelProps = {
    messages: AgentChatMessage[]
    draft: string
    onDraftChange: (value: string) => void
    onSend: () => void
    /** Omit to hide the mic trigger (voice conversation mode). */
    onVoice?: () => void
    placeholder?: string
    emptyState?: ReactNode
}

/** The message list + composer shared by every LMS AI surface — same markup and classes as the "Thuso" workspace assistant (agent-fab.css), so it reads as the same product. */
export const AgentChatPanel = ({ messages, draft, onDraftChange, onSend, onVoice, placeholder, emptyState }: AgentChatPanelProps) => {
    const bodyRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
    }, [messages])

    return (
        <>
            <div className="agent-panel-body" ref={bodyRef}>
                {messages.length === 0 && emptyState}

                {messages.map((chatMessage) => (
                    <div className={`agent-message is-${chatMessage.role} ${chatMessage.content === AGENT_PENDING_CONTENT ? 'is-pending' : ''}`} key={chatMessage.id}>
                        {chatMessage.role === 'agent' && <span className="agent-avatar is-small"><RobotOutlined /></span>}

                        {chatMessage.role === 'agent'
                            ? <div className="agent-message-content">
                                {chatMessage.content === AGENT_PENDING_CONTENT
                                    ? <span className="agent-pending-copy"><LoadingOutlined spin />{chatMessage.content}</span>
                                    : <AgentRichText content={chatMessage.content} />}
                            </div>
                            : <p>{chatMessage.content}</p>}
                    </div>
                ))}
            </div>

            <footer className="agent-panel-footer">
                <Input
                    value={draft}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onPressEnter={onSend}
                    placeholder={placeholder || 'Ask a question…'}
                    prefix={onVoice && (
                        <Button type="text" size="small" icon={<AudioOutlined />} onClick={onVoice} aria-label="Start voice conversation" />
                    )}
                    suffix={(
                        <Button type="text" size="small" icon={<SendOutlined />} onClick={onSend} disabled={!draft.trim()} aria-label="Send" />
                    )}
                />
            </footer>
        </>
    )
}

export default AgentChatPanel
