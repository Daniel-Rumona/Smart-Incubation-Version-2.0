import { useEffect, useRef, useState } from 'react'
import { useLessonAgentChat } from '@/hooks/useLessonAgentChat'
import { AgentChatPanel } from '@/components/lms/AgentChatPanel'
import { ConversationMode } from '@/components/agent/ConversationMode'
import { lessonPageContext } from '@/lib/lessonAgentContext'
import type { CourseLesson, CourseTemplate } from '@/services/courseTemplatesService'

type LessonAiReviewProps = {
    course: CourseTemplate
    lesson: CourseLesson
}

/**
 * The AI-led review step: opens the conversation itself (looking at the
 * lesson's own content and quiz as its source material) rather than waiting
 * for the learner to ask something, then continues as a normal chat.
 * Rendered inline inside the step frame — never gates moving on.
 */
export const LessonAiReview = ({ course, lesson }: LessonAiReviewProps) => {
    const [draft, setDraft] = useState('')
    const [voiceOpen, setVoiceOpen] = useState(false)
    const startedRef = useRef<string | null>(null)

    const page = lessonPageContext(
        course,
        lesson,
        'Proactively open a short, friendly review of what the learner just covered in this lesson. Reference a specific point from the lesson content, then ask a question or invite them to explain a part back in their own words rather than just repeating the content. Keep it to a few sentences.',
    )
    const { messages, send, sendSystem, isTyping } = useLessonAgentChat(page, `Lesson review: ${lesson.title}`)

    useEffect(() => {
        if (startedRef.current === lesson.id) return
        startedRef.current = lesson.id
        sendSystem(`Open the review for "${lesson.title || 'this lesson'}".`)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lesson.id])

    const submit = () => {
        if (!draft.trim()) return
        send(draft)
        setDraft('')
    }

    return (
        <div className="lesson-review-panel">
            <AgentChatPanel
                messages={messages}
                draft={draft}
                onDraftChange={setDraft}
                onSend={submit}
                onVoice={() => setVoiceOpen(true)}
                placeholder="Reply, or ask a follow-up…"
            />

            {voiceOpen && (
                <ConversationMode
                    messages={messages}
                    isTyping={isTyping}
                    onSend={(content) => send(content)}
                    onClose={() => setVoiceOpen(false)}
                />
            )}
        </div>
    )
}

export default LessonAiReview
