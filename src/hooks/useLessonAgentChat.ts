import { useState } from 'react'
import { useBackgroundTasks } from '@/providers/BackgroundTasksProvider'
import type { AgentChatMessage, AgentPageContext } from '@/types/agent'

export const AGENT_PENDING_CONTENT = 'Working on this in the background…'

const makeMessage = (role: AgentChatMessage['role'], content: string): AgentChatMessage => ({
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    content,
})

/**
 * A single conversation against the same workspace-assistant backend the
 * global "Thuso" chat and the agentic home page use (queueTask ->
 * sendAgentMessage -> ai-backend /api/agent), scoped to whatever
 * AgentPageContext the caller supplies (see lessonAgentContext.ts).
 */
export const useLessonAgentChat = (page: AgentPageContext, titlePrefix?: string) => {
    const { queueTask } = useBackgroundTasks()
    const [messages, setMessages] = useState<AgentChatMessage[]>([])

    /** A normal turn: the learner's own message, shown in the transcript. `prompt` lets the assistant receive fuller instructions than the short text the learner sees. */
    const send = (content: string, prompt?: string) => {
        const trimmed = content.trim()
        if (!trimmed) return

        const userMessage = makeMessage('user', trimmed)
        const pendingMessage = makeMessage('agent', AGENT_PENDING_CONTENT)
        const history = messages

        setMessages((current) => [...current, userMessage, pendingMessage])
        queueTask({
            title: titlePrefix ? `${titlePrefix}: ${trimmed}` : undefined,
            prompt: prompt ?? trimmed,
            page,
            history,
            onCompleted: (result) => setMessages((current) => current.map((item) => (item.id === pendingMessage.id ? { ...item, content: result } : item))),
            onFailed: (error) => setMessages((current) => current.map((item) => (item.id === pendingMessage.id ? { ...item, content: error } : item))),
        })
    }

    /** A proactive opener — queues a prompt without showing it as something the learner typed. */
    const sendSystem = (prompt: string) => {
        const pendingMessage = makeMessage('agent', AGENT_PENDING_CONTENT)
        const history = messages

        setMessages((current) => [...current, pendingMessage])
        queueTask({
            title: titlePrefix,
            prompt,
            page,
            history,
            onCompleted: (result) => setMessages((current) => current.map((item) => (item.id === pendingMessage.id ? { ...item, content: result } : item))),
            onFailed: (error) => setMessages((current) => current.map((item) => (item.id === pendingMessage.id ? { ...item, content: error } : item))),
        })
    }

    /** An exchange resolved on the client (no assistant call), kept in the transcript so later turns have it as context. */
    const appendLocal = (userText: string, agentText: string) => {
        setMessages((current) => [...current, makeMessage('user', userText), makeMessage('agent', agentText)])
    }

    const isTyping = messages.at(-1)?.role === 'agent' && messages.at(-1)?.content === AGENT_PENDING_CONTENT

    return { messages, send, sendSystem, appendLocal, isTyping }
}
