import { useEffect, useRef, useState } from 'react'
import { BulbOutlined } from '@ant-design/icons'
import type { RichTextItemAction } from '@/components/agent/AgentRichText'
import { useLessonAgentChat } from '@/hooks/useLessonAgentChat'
import { ConversationMode } from '@/components/agent/ConversationMode'
import ChatQuizCard from '@/components/lms/ChatQuizCard'
import MaterialsPanel, { type MaterialAction } from '@/components/lms/MaterialsPanel'
import { lessonPageContext, type MaterialText } from '@/lib/lessonAgentContext'
import { loadMaterialTexts } from '@/services/courseMaterialsService'
import { NEXT_QUIZ_LABEL, QUIZ_LABEL, QUIZ_PROMPT, matchQuizAnswer, optionLetter, parseChatQuiz, quizSpeech, type ChatQuiz } from '@/lib/lessonQuiz'
import { isAgentApiConfigured } from '@/config/agent'
import type { CourseLesson, CourseTemplate } from '@/services/courseTemplatesService'
import type { SmeBusiness } from '@/services/courseProgressService'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type LessonHelpChatProps = {
    course: CourseTemplate
    lesson: CourseLesson
    /** The learner's own business, so examples are about it. */
    business?: SmeBusiness
    /** Fired when the learner actually asks something, so the step can be recorded as interactive. */
    onInteract?: () => void
}

const SUGGESTIONS = [
    'Explain this lesson in simple terms',
    'Give me a real-life example',
    'What are the key points?',
    QUIZ_LABEL,
]

const MATERIAL_ACTIONS: MaterialAction[] = [
    { label: 'Summarise', instruction: 'Summarise this material in a few clear points' },
    { label: 'Key points', instruction: 'List the key points of this material' },
    { label: 'Elaborate', instruction: 'Elaborate on the most important ideas in this material' },
    { label: 'Simplify', instruction: 'Explain this material in simple, plain language' },
    { label: 'Example', instruction: 'Give an example from my own business that illustrates this material' },
]

const HELP_PURPOSE = 'The learner is currently on this lesson and has opened a help chat because part of it is unclear. Break the content down further, use a concrete example, and keep answers short and encouraging.'

const YOUR_BUSINESS_SUGGESTION = 'How does this apply to my business?'

const FOLLOW_UPS = ['Elaborate on that', 'Simplify that', 'Give me an example from my business', 'Summarise it in one sentence']

const ITEM_ACTIONS: RichTextItemAction[] = [
    { get label() { return tr('Elaborate') }, prompt: (item) => `Elaborate on this point: ${item}` },
    { get label() { return tr('Simplify') }, prompt: (item) => `Simplify this point: ${item}` },
    { get label() { return tr('Example') }, prompt: (item) => `Give me an example of this point from my own business: ${item}` },
]

/**
 * "Don't understand? Ask AI" — opens the same full-screen conversation
 * interface as the workspace assistant (typing and voice), scoped to this
 * lesson. Starts with the mic off; the mic button turns voice on. "Quiz me"
 * turns the assistant's questions into tappable multiple-choice cards.
 */
export const LessonHelpChat = ({ course, lesson, business, onInteract }: LessonHelpChatProps) => {
    const { t } = useLanguage()
    const [open, setOpen] = useState(false)
    // Which option was picked for each quiz message, by message id.
    const [picked, setPicked] = useState<Record<string, number>>({})
    const materials = lesson.materials || []
    // null until the extracted text has been fetched (it is only needed once the chat opens).
    const [materialTexts, setMaterialTexts] = useState<Record<string, string> | null>(null)
    // Set by the materials panel just before it sends, so that one turn carries the chosen file's text.
    const focusRef = useRef<{ name: string, text: string, prompt: string } | null>(null)

    useEffect(() => {
        if (!open || !materials.length || materialTexts) return
        void loadMaterialTexts(materials).then(setMaterialTexts)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open])

    const readable: MaterialText[] = materials
        .filter((material) => materialTexts?.[material.id])
        .map((material) => ({ name: material.name, text: materialTexts?.[material.id] || '' }))

    const page = lessonPageContext(
        course,
        lesson,
        HELP_PURPOSE,
        business,
        { readable },
    )
    const { messages, send: sendMessage, appendLocal, isTyping } = useLessonAgentChat(page, `Lesson help: ${lesson.title}`)

    if (!isAgentApiConfigured) return null

    // The latest question still waiting on an answer, if any.
    const lastMessage = messages.at(-1)
    const lastQuiz = lastMessage?.role === 'agent' ? parseChatQuiz(lastMessage.content) : null
    const pendingQuiz = lastMessage && lastQuiz && picked[lastMessage.id] === undefined ? { id: lastMessage.id, quiz: lastQuiz } : null

    // Answering (by tap, typing or voice) is resolved here rather than by the
    // assistant, and recorded in the transcript so follow-ups have it as context.
    const answer = (messageId: string, quiz: ChatQuiz, index: number) => {
        onInteract?.()
        setPicked((current) => ({ ...current, [messageId]: index }))
        const right = index === quiz.correctIndex
        const correction = right ? '' : ` The right answer is ${optionLetter(quiz.correctIndex)}: ${quiz.options[quiz.correctIndex]}.`
        appendLocal(`${optionLetter(index)}. ${quiz.options[index]}`, `**${right ? 'Correct!' : 'Not quite.'}**${correction} ${quiz.explanation}`.trim())
    }

    const send = (content: string) => {
        onInteract?.()

        const focus = focusRef.current
        focusRef.current = null
        if (focus) {
            sendMessage(content, focus.prompt, lessonPageContext(course, lesson, HELP_PURPOSE, business, { readable, focus }))
            return
        }

        if (pendingQuiz) {
            const index = matchQuizAnswer(content, pendingQuiz.quiz)
            if (index !== undefined) {
                answer(pendingQuiz.id, pendingQuiz.quiz, index)
                return
            }
        }

        if (content === QUIZ_LABEL || content === NEXT_QUIZ_LABEL) {
            sendMessage(content, QUIZ_PROMPT)
            return
        }

        // A reply to an open question that isn't clearly an answer: say what it is replying to.
        const context = pendingQuiz
            ? `\n\n(Context: I am replying to your multiple-choice question "${pendingQuiz.quiz.question}" with options ${pendingQuiz.quiz.options.map((option, index) => `${optionLetter(index)}. ${option}`).join('; ')}.)`
            : ''
        sendMessage(content, context ? `${content}${context}` : undefined)
    }

    return (
        <>
            <button type="button" className="lesson-help-trigger" onClick={() => setOpen(true)}>
                <BulbOutlined /> {t('Don\'t understand? Ask AI')}
            </button>

            {open && (
                <ConversationMode
                    messages={messages}
                    isTyping={isTyping}
                    onSend={send}
                    onClose={() => setOpen(false)}
                    startInVoice={false}
                    followUps={FOLLOW_UPS}
                    itemActions={ITEM_ACTIONS}
                    sidePanelTitle={t('Materials')}
                    sidePanel={materials.length ? ({ send: sendFromPanel }) => (
                        <MaterialsPanel
                            materials={materials}
                            readableIds={new Set(Object.keys(materialTexts || {}))}
                            loading={!materialTexts}
                            actions={MATERIAL_ACTIONS}
                            onAction={(material, action) => {
                                focusRef.current = { name: material.name, text: materialTexts?.[material.id] || '', prompt: `${action.instruction}: "${material.name}".` }
                                sendFromPanel(`${action.label}: ${material.name}`)
                            }}
                        />
                    ) : undefined}
                    suggestions={business ? [YOUR_BUSINESS_SUGGESTION, ...SUGGESTIONS] : SUGGESTIONS}
                    intro={(
                        <div className="conversation-intro-card">
                            <span className="conversation-intro-icon"><BulbOutlined /></span>
                            <strong>{t('Ask about "')}{lesson.title || t('this lesson')}"</strong>
                            <p>{t('Stuck on something? I can explain it another way, give an example or quiz you. Pick a suggestion below or type your own question.')}</p>
                        </div>
                    )}
                    renderAgentMessage={(message) => {
                        const quiz = parseChatQuiz(message.content)
                        if (!quiz) return undefined
                        return (
                            <ChatQuizCard
                                quiz={quiz}
                                picked={picked[message.id]}
                                onPick={(index) => answer(message.id, quiz, index)}
                                onNext={() => send(NEXT_QUIZ_LABEL)}
                            />
                        )
                    }}
                    toSpeech={(message) => {
                        const quiz = parseChatQuiz(message.content)
                        return quiz ? quizSpeech(quiz) : undefined
                    }}
                />
            )}
        </>
    )
}

export default LessonHelpChat
