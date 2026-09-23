import { useState } from 'react'
import { Modal } from 'antd'
import { BulbOutlined, RobotOutlined } from '@ant-design/icons'
import { useLessonAgentChat } from '@/hooks/useLessonAgentChat'
import { AgentChatPanel } from '@/components/lms/AgentChatPanel'
import { ConversationMode } from '@/components/agent/ConversationMode'
import { lessonPageContext } from '@/lib/lessonAgentContext'
import { isAgentApiConfigured } from '@/config/agent'
import type { CourseLesson, CourseTemplate } from '@/services/courseTemplatesService'

type LessonHelpChatProps = {
    course: CourseTemplate
    lesson: CourseLesson
}

/**
 * "Don't understand? Ask AI" — available throughout a lesson's content
 * step. A learner-initiated chat scoped to this lesson, in the same visual
 * language as the workspace assistant (AgentFab), including voice.
 */
export const LessonHelpChat = ({ course, lesson }: LessonHelpChatProps) => {
    const [open, setOpen] = useState(false)
    const [voiceOpen, setVoiceOpen] = useState(false)
    const [draft, setDraft] = useState('')

    const page = lessonPageContext(
        course,
        lesson,
        'The learner is currently on this lesson and has opened a help chat because part of it is unclear. Break the content down further, use a concrete example, and keep answers short and encouraging.',
    )
    const { messages, send, isTyping } = useLessonAgentChat(page, `Lesson help: ${lesson.title}`)

    if (!isAgentApiConfigured) return null

    const submit = () => {
        if (!draft.trim()) return
        send(draft)
        setDraft('')
    }

    return (
        <>
            <button type="button" className="lesson-help-trigger" onClick={() => setOpen(true)}>
                <BulbOutlined /> Don't understand? Ask AI
            </button>

            <Modal open={open} onCancel={() => setOpen(false)} footer={null} width={480} title={null} className="agent-conversation-modal">
                <section className="agent-panel agent-modal-panel">
                    <header className="agent-panel-header agent-modal-header">
                        <div className="agent-assistant-identity">
                            <span className="agent-avatar"><RobotOutlined /></span>
                            <div>
                                <strong>Ask about this lesson</strong>
                                <span className="agent-status"><span />{lesson.title || 'This lesson'}</span>
                            </div>
                        </div>
                    </header>

                    <AgentChatPanel
                        messages={messages}
                        draft={draft}
                        onDraftChange={setDraft}
                        onSend={submit}
                        onVoice={() => setVoiceOpen(true)}
                        placeholder="What part don't you understand?"
                        emptyState={(
                            <div className="agent-message">
                                <span className="agent-avatar is-small"><RobotOutlined /></span>
                                <div className="agent-message-content">
                                    <p>Ask me anything about "{lesson.title || 'this lesson'}" — I can break it down differently or give an example.</p>
                                </div>
                            </div>
                        )}
                    />
                </section>
            </Modal>

            {voiceOpen && (
                <ConversationMode
                    messages={messages}
                    isTyping={isTyping}
                    onSend={(content) => send(content)}
                    onClose={() => setVoiceOpen(false)}
                />
            )}
        </>
    )
}

export default LessonHelpChat
