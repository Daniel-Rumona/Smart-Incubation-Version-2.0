import { useEffect, useRef, useState } from 'react'
import { Button, Input, Typography, message } from 'antd'
import { AudioOutlined, CheckOutlined, PauseCircleOutlined, SendOutlined } from '@ant-design/icons'
import type { ApplicantProfileFormValues } from '@/pages/applicant/ApplicantProfilePage'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/applicant/ai-assist.css'

const { Text } = Typography

const AGENT_API_BASE_URL = String(import.meta.env.VITE_AGENT_API_BASE_URL || '').replace(/\/$/, '')
const AGENT_SHARED_SECRET = String(import.meta.env.VITE_AGENT_SHARED_SECRET || '').trim()

type ApplicantProfileAIAssistProps = {
    rawDump: string
    currentValues: ApplicantProfileFormValues
    missingFields: string[]
    onRawDumpChange: (value: string) => void
    onApplyExtractedFields: (values: Partial<ApplicantProfileFormValues>, missingFields: string[]) => void
}

type FollowUpQuestion = {
    field: string
    question: string
}

type ConversationMessage = {
    role: 'assistant' | 'user'
    content: string
    field?: string
    /** Labels of the details a reply filled in; shown as chips, never sent to the AI. */
    mapped?: string[]
}

type ApplicantAIResponse = {
    ok?: boolean
    transcript?: string
    detectedLanguages?: string[]
    languageMixSummary?: string
    flatFields?: Partial<ApplicantProfileFormValues>
    missingFields?: string[]
    followUpQuestions?: FollowUpQuestion[]
    assistantMessage?: string
    confidence?: number
    model?: string
    generatedAt?: string
}

type RawApplicantAIResponse = ApplicantAIResponse & {
    reply?: string
    result?: ApplicantAIResponse | RawApplicantAIResponse
    data?: ApplicantAIResponse | RawApplicantAIResponse
}

type SpeechResultEvent = {
    resultIndex: number
    results: ArrayLike<ArrayLike<{ transcript: string }>>
}

type SpeechRecognitionType = {
    continuous: boolean
    interimResults: boolean
    lang: string
    start: () => void
    stop: () => void
    abort: () => void
    onresult: ((event: SpeechResultEvent) => void) | null
    onerror: ((event: unknown) => void) | null
    onend: (() => void) | null
}

declare global {
    interface Window {
        SpeechRecognition?: new () => SpeechRecognitionType
        webkitSpeechRecognition?: new () => SpeechRecognitionType
    }
}

const FIELD_LABELS: Record<string, string> = {
    participantName: 'Full name',
    fullName: 'Full name',
    email: 'Email address',
    gender: 'Gender',
    idNumber: 'ID number',
    phone: 'Phone number',
    alternativePhone: 'Alternative phone',
    maritalStatus: 'Marital status',
    employmentStatus: 'Employment status',
    educationLevel: 'Education level',
    disabilityStatus: 'Disability status',
    businessName: 'Business name',
    sector: 'Sector',
    natureOfBusiness: 'Nature of business',
    beeLevel: 'B-BBEE level',
    youthOwnedPercent: 'Youth-owned percentage',
    femaleOwnedPercent: 'Female-owned percentage',
    blackOwnedPercent: 'Black-owned percentage',
    registrationStatus: 'Registration status',
    registrationNumber: 'Registration number',
    dateOfRegistration: 'Date of registration',
    yearsOfTrading: 'Years of trading',
    businessAddress: 'Business address',
    city: 'City',
    postalCode: 'Postal code',
    province: 'Province',
    hostCommunity: 'Host community',
    locationType: 'Location type',
}

function formatFieldLabel(field?: string) {
    if (!field) return 'Question'
    if (FIELD_LABELS[field]) return FIELD_LABELS[field]

    return field
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^./, (char) => char.toUpperCase())
}

function cleanExtractedFields(values?: Partial<ApplicantProfileFormValues>): Partial<ApplicantProfileFormValues> {
    if (!values) return {}

    return Object.fromEntries(
        Object.entries(values).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '')
    ) as Partial<ApplicantProfileFormValues>
}

function parsePossibleJson(value: unknown): ApplicantAIResponse | null {
    if (!value || typeof value !== 'string') return null

    const trimmed = value.trim()
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')

    if (start < 0 || end <= start) return null

    try {
        return JSON.parse(trimmed.slice(start, end + 1)) as ApplicantAIResponse
    } catch {
        return null
    }
}

function normalizeAIResponse(payload: unknown): ApplicantAIResponse {
    const raw = (payload || {}) as RawApplicantAIResponse

    if (raw.result) return normalizeAIResponse(raw.result)
    if (raw.data) return normalizeAIResponse(raw.data)

    const parsedFromAssistant = parsePossibleJson(raw.assistantMessage)
    if (parsedFromAssistant) return normalizeAIResponse(parsedFromAssistant)

    const parsedFromReply = parsePossibleJson(raw.reply)
    if (parsedFromReply) return normalizeAIResponse(parsedFromReply)

    const fields = cleanExtractedFields(raw.flatFields)
    const missing = Array.isArray(raw.missingFields) ? raw.missingFields.filter(Boolean) : []
    const questions = Array.isArray(raw.followUpQuestions)
        ? raw.followUpQuestions.filter((item) => item?.field && item?.question)
        : []

    const assistantMessage =
        raw.assistantMessage && !String(raw.assistantMessage).trim().startsWith('{')
            ? raw.assistantMessage
            : raw.reply && !String(raw.reply).trim().startsWith('{')
                ? raw.reply
                : `I mapped ${Object.keys(fields).length} fields and found ${missing.length} missing items.`

    return {
        ok: raw.ok ?? true,
        transcript: raw.transcript,
        detectedLanguages: Array.isArray(raw.detectedLanguages) ? raw.detectedLanguages : [],
        languageMixSummary: raw.languageMixSummary || '',
        flatFields: fields,
        missingFields: missing,
        followUpQuestions: questions,
        assistantMessage,
        confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
        model: raw.model,
        generatedAt: raw.generatedAt,
    }
}

async function extractApplicantDump(input: {
    rawDump: string
    currentValues?: Record<string, unknown>
    missingFields?: string[]
    conversationHistory?: ConversationMessage[]
    language?: string
}) {
    if (!AGENT_API_BASE_URL) {
        throw new Error('VITE_AGENT_API_BASE_URL is not configured')
    }

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    }

    if (AGENT_SHARED_SECRET) {
        headers.Authorization = `Bearer ${AGENT_SHARED_SECRET}`
    }

    const response = await fetch(`${AGENT_API_BASE_URL}/api/applicant/dump`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            rawDump: input.rawDump,
            currentValues: input.currentValues || {},
            missingFields: input.missingFields || [],
            conversationHistory: (input.conversationHistory || []).map(({ role, content, field }) => ({ role, content, field })),
            language: input.language || 'mixed',
        }),
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(errorText || 'AI applicant mapping failed')
    }

    const payload = await response.json()
    const result = normalizeAIResponse(payload)

    if (result.ok === false) {
        throw new Error(result.assistantMessage || 'AI applicant mapping failed')
    }

    return result
}

export default function ApplicantProfileAIAssist({
    rawDump,
    currentValues,
    missingFields,
    onRawDumpChange,
    onApplyExtractedFields,
}: ApplicantProfileAIAssistProps) {
    const { t } = useLanguage()
    const [loading, setLoading] = useState(false)
    const [isListening, setIsListening] = useState(false)
    const [conversation, setConversation] = useState<ConversationMessage[]>([
        {
            role: 'assistant',
            content: t('Tell me about yourself and your business, in your own words. Any language is fine, and you can type or talk.'),
        },
    ])
    const [followUps, setFollowUps] = useState<FollowUpQuestion[]>([])
    // One message box: the first message is profile notes, later ones answer the current question.
    const [draft, setDraft] = useState('')
    const recognitionRef = useRef<SpeechRecognitionType | null>(null)
    const endRef = useRef<HTMLDivElement | null>(null)
    const asked = conversation.some((item) => item.role === 'user')
    const allDone = t("That's everything I needed. Check the details on your profile, then save.")

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [conversation, followUps])

    const applyResponse = (
        result: ApplicantAIResponse,
        options?: {
            answeredField?: string
            answeredLabel?: string
        }
    ) => {
        const normalized = normalizeAIResponse(result)
        const fields = cleanExtractedFields(normalized.flatFields)
        const extractedMissing = normalized.missingFields || []
        const nextFollowUps = normalized.followUpQuestions || []

        onApplyExtractedFields(fields, extractedMissing)
        setFollowUps(nextFollowUps)

        // Which details changed, as labels for the chips under the reply.
        const mapped = [...new Set(Object.keys(fields).map((field) => t(formatFieldLabel(field))))]

        // The AI's own wording wins; the fallbacks only cover replies with no usable message.
        let assistantContent = normalized.assistantMessage
        if (!assistantContent || assistantContent.trim().startsWith('{') || /^I mapped \d+ fields/.test(assistantContent)) {
            if (options?.answeredField) {
                assistantContent = t('Got it, I updated {field}.', undefined, { field: t(options.answeredLabel || formatFieldLabel(options.answeredField)) })
            } else if (mapped.length) {
                assistantContent = mapped.length === 1 ? t('I filled in 1 detail:') : t('I filled in {count} details:', undefined, { count: mapped.length })
            } else {
                assistantContent = t("I couldn't pick out any details from that. Try adding your name, business name, sector and where you're based.")
            }
        }

        setConversation((current) => [
            ...current,
            { role: 'assistant', content: assistantContent, mapped },
            ...(nextFollowUps.length ? [] : [{ role: 'assistant' as const, content: allDone }]),
        ])
    }

    const reportFailure = (error: unknown) => {
        console.error(error)
        const errorMessage = error instanceof Error ? error.message : ''
        if (errorMessage.includes('503') || errorMessage.toLowerCase().includes('busy') || errorMessage.toLowerCase().includes('high demand')) {
            message.warning(t('The AI model is temporarily busy. Please try again in a moment.'))
        } else {
            message.error(t('AI mapping failed. Please try again.'))
        }
    }

    const sendNotes = async (text: string) => {
        const combinedDump = [rawDump.trim(), text].filter(Boolean).join('\n')
        const nextConversation: ConversationMessage[] = [...conversation, { role: 'user', content: text }]

        setConversation(nextConversation)
        onRawDumpChange(combinedDump)

        try {
            setLoading(true)
            applyResponse(await extractApplicantDump({
                rawDump: combinedDump,
                currentValues,
                missingFields,
                conversationHistory: nextConversation,
            }))
        } catch (error) {
            reportFailure(error)
        } finally {
            setLoading(false)
        }
    }

    const sendAnswer = async (answer: string, activeQuestion: FollowUpQuestion) => {
        const answeredField = activeQuestion.field as keyof ApplicantProfileFormValues
        const answeredPatch = { [answeredField]: answer } as Partial<ApplicantProfileFormValues>
        const updatedValues = { ...currentValues, ...answeredPatch }
        const nextFollowUpsBeforeAI = followUps.slice(1)
        const nextMissingBeforeAI = nextFollowUpsBeforeAI.map((item) => item.field)
        const nextConversation: ConversationMessage[] = [...conversation, { role: 'user', content: answer, field: activeQuestion.field }]

        setConversation(nextConversation)
        setFollowUps(nextFollowUpsBeforeAI)
        onApplyExtractedFields(answeredPatch, nextMissingBeforeAI)

        const combinedDump = `${rawDump}\n${formatFieldLabel(activeQuestion.field)}: ${answer}`.trim()
        onRawDumpChange(combinedDump)

        try {
            setLoading(true)
            applyResponse(await extractApplicantDump({
                rawDump: combinedDump,
                currentValues: updatedValues,
                missingFields: nextMissingBeforeAI,
                conversationHistory: nextConversation,
            }), {
                answeredField: activeQuestion.field,
                answeredLabel: formatFieldLabel(activeQuestion.field),
            })
        } catch (error) {
            console.error(error)
            message.warning(t('Your answer was applied, but AI could not refresh the next question. Please continue manually or try again.'))
        } finally {
            setLoading(false)
        }
    }

    const send = () => {
        const text = draft.trim()
        if (!text || loading) return
        if (isListening) {
            recognitionRef.current?.stop()
            setIsListening(false)
        }
        setDraft('')
        if (followUps[0]?.field) void sendAnswer(text, followUps[0])
        else void sendNotes(text)
    }

    const skipQuestion = () => {
        const rest = followUps.slice(1)
        setFollowUps(rest)
        if (!rest.length) setConversation((current) => [...current, { role: 'assistant', content: allDone }])
    }

    const toggleListening = () => {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition

        if (!Recognition) {
            message.warning(t('Voice capture is not supported in this browser'))
            return
        }

        if (isListening) {
            recognitionRef.current?.stop()
            setIsListening(false)
            return
        }

        const recognition = new Recognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'en-ZA'

        // Spoken words land in the message box, so they can be checked before sending.
        const before = draft
        recognition.onresult = (event) => {
            let transcript = ''
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                transcript += event.results[index][0].transcript
            }
            setDraft(`${before}${before ? ' ' : ''}${transcript}`.trim())
        }

        recognition.onerror = () => {
            setIsListening(false)
            message.error(t('Voice capture stopped unexpectedly'))
        }

        recognition.onend = () => setIsListening(false)
        recognitionRef.current = recognition
        recognition.start()
        setIsListening(true)
    }

    const question = followUps[0]

    return (
        <div className="ai-assist">
            <Text type="secondary" className="ai-assist-note">{t('Nothing is saved until you check it and save your profile.')}</Text>

            <div className="ai-assist-chat" aria-live="polite">
                {conversation.map((item, index) => (
                    <div key={`${item.role}-${index}`} className={`ai-assist-bubble is-${item.role}`}>
                        <span>{item.content}</span>
                        {!!item.mapped?.length && (
                            <span className="ai-assist-chips">
                                {item.mapped.map((label) => <span key={label} className="ai-assist-chip"><CheckOutlined aria-hidden="true" /> {label}</span>)}
                            </span>
                        )}
                    </div>
                ))}
                {question && !loading && (
                    <div className="ai-assist-bubble is-assistant is-question">
                        <span className="ai-assist-field">{t(formatFieldLabel(question.field))}</span>
                        <span>{question.question}</span>
                    </div>
                )}
                {loading && (
                    <div className="ai-assist-bubble is-assistant is-typing" role="status" aria-label={t('Reading your message')}>
                        <span className="ai-assist-dot" /><span className="ai-assist-dot" /><span className="ai-assist-dot" />
                    </div>
                )}
                <div ref={endRef} />
            </div>

            <div className="ai-assist-composer">
                <Button
                    shape="circle"
                    className={isListening ? 'is-listening' : undefined}
                    icon={isListening ? <PauseCircleOutlined /> : <AudioOutlined />}
                    onClick={toggleListening}
                    aria-label={isListening ? t('Stop voice') : t('Voice input')}
                />
                <Input.TextArea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onPressEnter={(event) => {
                        if (event.shiftKey) return
                        event.preventDefault()
                        send()
                    }}
                    autoSize={{ minRows: 1, maxRows: asked ? 4 : 6 }}
                    placeholder={question
                        ? t('Type your answer')
                        : asked
                            ? t('Add anything else about you or your business')
                            : t('Example: My name is Thandeka, I run Ubuntu Bakery in Soweto, we have been trading since 2019...')}
                />
                <Button type="primary" shape="circle" icon={<SendOutlined />} loading={loading} disabled={!draft.trim()} onClick={send} aria-label={t('Send')} />
            </div>

            {question && (
                <div className="ai-assist-status">
                    <Text type="secondary">
                        {followUps.length === 1 ? t('1 more question') : t('{count} more questions', undefined, { count: followUps.length })}
                    </Text>
                    <Button type="link" size="small" onClick={skipQuestion} disabled={loading}>{t('Skip this one')}</Button>
                </div>
            )}
        </div>
    )
}
