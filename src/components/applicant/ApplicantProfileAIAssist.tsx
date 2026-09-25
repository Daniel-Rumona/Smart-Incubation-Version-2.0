import { useRef, useState } from 'react'
import { Avatar, Button, Card, Input, Space, Tag, Typography, message } from 'antd'
import {
    AudioOutlined,
    CheckCircleOutlined,
    EditOutlined,
    PauseCircleOutlined,
    RobotOutlined,
    SendOutlined,
    ThunderboltOutlined,
    UserOutlined,
} from '@ant-design/icons'
import type { ApplicantProfileFormValues } from '@/pages/applicant/ApplicantProfilePage'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text, Paragraph } = Typography

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

type SpeechRecognitionType = {
    continuous: boolean
    interimResults: boolean
    lang: string
    start: () => void
    stop: () => void
    abort: () => void
    onresult: ((event: any) => void) | null
    onerror: ((event: any) => void) | null
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
            conversationHistory: input.conversationHistory || [],
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
            content: 'Tell me about the applicant and business. You can mix languages. I will use the AI engine to map the details into the profile form.',
        },
    ])
    const [followUps, setFollowUps] = useState<FollowUpQuestion[]>([])
    const [answerDraft, setAnswerDraft] = useState('')
    const recognitionRef = useRef<SpeechRecognitionType | null>(null)

    const applyResponse = (
        result: ApplicantAIResponse,
        options?: {
            answeredField?: string
            answeredLabel?: string
            suppressGenericMappedMessage?: boolean
        }
    ) => {
        const normalized = normalizeAIResponse(result)
        const fields = cleanExtractedFields(normalized.flatFields)
        const extractedMissing = normalized.missingFields || []
        const nextFollowUps = normalized.followUpQuestions || []

        onApplyExtractedFields(fields, extractedMissing)
        setFollowUps(nextFollowUps)

        const mappedCount = Object.keys(fields).length

        let assistantContent = normalized.assistantMessage

        if (!assistantContent || assistantContent.trim().startsWith('{')) {
            if (options?.answeredField) {
                const nextQuestion = nextFollowUps[0]?.question

                assistantContent = nextQuestion
                    ? `Got it. I updated ${options.answeredLabel || formatFieldLabel(options.answeredField)}. Next: ${nextQuestion}`
                    : `Got it. I updated ${options.answeredLabel || formatFieldLabel(options.answeredField)}. No further AI follow-up questions are pending.`
            } else if (mappedCount > 0) {
                assistantContent = `I mapped ${mappedCount} profile field${mappedCount === 1 ? '' : 's'}. Please review the form before saving.`
            } else if (extractedMissing.length > 0) {
                assistantContent = `I still need ${extractedMissing.length} item${extractedMissing.length === 1 ? '' : 's'} to complete the profile.`
            } else {
                assistantContent = 'I updated the profile details I could confirm. Please review before saving.'
            }
        }

        setConversation((current) => [
            ...current,
            {
                role: 'assistant',
                content: assistantContent,
            },
        ])
    }

    const handleExtract = async () => {
        if (!rawDump.trim()) {
            message.warning(t('Paste or dictate applicant details first'))
            return
        }

        const userMessage: ConversationMessage = { role: 'user', content: rawDump.trim() }
        const nextConversation = [...conversation, userMessage]

        try {
            setLoading(true)
            setConversation(nextConversation)

            const result = await extractApplicantDump({
                rawDump,
                currentValues,
                missingFields,
                conversationHistory: nextConversation,
            })

            applyResponse(result)
        } catch (error) {
            console.error(error)
            const errorMessage = error instanceof Error ? error.message : ''

            if (errorMessage.includes('503') || errorMessage.toLowerCase().includes('busy') || errorMessage.toLowerCase().includes('high demand')) {
                message.warning(t('The AI model is temporarily busy. Please try again in a moment.'))
            } else {
                message.error(t('AI mapping failed. Please try again.'))
            }
        } finally {
            setLoading(false)
        }
    }

    const handleAnswerFollowUp = async () => {
        const answer = answerDraft.trim()
        if (!answer) return

        const activeQuestion = followUps[0]
        if (!activeQuestion?.field) return

        const answeredField = activeQuestion.field as keyof ApplicantProfileFormValues
        const answeredPatch = {
            [answeredField]: answer,
        } as Partial<ApplicantProfileFormValues>

        const updatedValues = {
            ...currentValues,
            ...answeredPatch,
        }

        const nextFollowUpsBeforeAI = followUps.slice(1)
        const nextMissingBeforeAI = nextFollowUpsBeforeAI.map((item) => item.field)

        const nextConversation: ConversationMessage[] = [
            ...conversation,
            {
                role: 'user',
                content: answer,
                field: activeQuestion.field,
            },
        ]

        setConversation(nextConversation)
        setAnswerDraft('')
        setFollowUps(nextFollowUpsBeforeAI)

        onApplyExtractedFields(answeredPatch, nextMissingBeforeAI)

        const combinedDump = `${rawDump}\n${formatFieldLabel(activeQuestion.field)}: ${answer}`.trim()
        onRawDumpChange(combinedDump)

        try {
            setLoading(true)

            const result = await extractApplicantDump({
                rawDump: combinedDump,
                currentValues: updatedValues,
                missingFields: nextMissingBeforeAI,
                conversationHistory: nextConversation,
            })

            applyResponse(result, {
                answeredField: activeQuestion.field,
                answeredLabel: formatFieldLabel(activeQuestion.field),
                suppressGenericMappedMessage: true,
            })
        } catch (error) {
            console.error(error)

            message.warning(t('Your answer was applied, but AI could not refresh the next question. Please continue manually or try again.'))
        } finally {
            setLoading(false)
        }
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

        recognition.onresult = (event: any) => {
            let transcript = ''
            for (let index = event.resultIndex; index < event.results.length; index += 1) {
                transcript += event.results[index][0].transcript
            }
            onRawDumpChange(`${rawDump}${rawDump ? ' ' : ''}${transcript}`.trim())
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

    return (
        <div className="applicant-profile-ai">
            <Card className="applicant-profile-ai-panel" bordered={false}>
                <div className="applicant-profile-ai-head">
                    <Space>
                        <Avatar icon={<RobotOutlined />} />
                        <div>
                            <Text strong>{t('AI profile assist')}</Text>
                            <Paragraph type="secondary" style={{ margin: 0 }}>
                                {t('Paste a rough profile, dictate notes, then review the AI-mapped fields manually before saving.')}
                            </Paragraph>
                        </div>
                    </Space>
                    <Tag icon={<ThunderboltOutlined />} color="processing">
                        {t('AI engine')}
                    </Tag>
                </div>

                <Input.TextArea
                    value={rawDump}
                    onChange={(event) => onRawDumpChange(event.target.value)}
                    autoSize={{ minRows: 6, maxRows: 12 }}
                    placeholder={t('Example: My name is Daniel, my business is Smart Foods, we are in retail in Gauteng, trading for 2 years...')}
                />

                <div className="applicant-profile-ai-actions">
                    <Button icon={isListening ? <PauseCircleOutlined /> : <AudioOutlined />} onClick={toggleListening}>
                        {isListening ? t('Stop voice') : t('Voice input')}
                    </Button>
                    <Button type="primary" icon={<ThunderboltOutlined />} loading={loading} onClick={handleExtract}>
                        {t('Map with AI')}
                    </Button>
                </div>
            </Card>

            <Card className="applicant-profile-ai-panel" bordered={false}>
                <div className="applicant-profile-chat-list">
                    {conversation.map((item, index) => (
                        <div key={`${item.role}-${index}`} className={`applicant-profile-chat-row is-${item.role}`}>
                            <Avatar icon={item.role === 'assistant' ? <RobotOutlined /> : <UserOutlined />} />
                            <div className="applicant-profile-chat-bubble">
                                <Text>{item.content}</Text>
                            </div>
                        </div>
                    ))}
                </div>

                {followUps.length ? (
                    <div className="applicant-profile-followups">
                        <Text strong>{t('Next missing detail')}</Text>
                        <Card size="small" className="applicant-profile-followup-card">
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                <Tag icon={<EditOutlined />}>{formatFieldLabel(followUps[0].field)}</Tag>
                                <Text>{followUps[0].question}</Text>
                                <Space.Compact style={{ width: '100%' }}>
                                    <Input
                                        value={answerDraft}
                                        onChange={(event) => setAnswerDraft(event.target.value)}
                                        onPressEnter={handleAnswerFollowUp}
                                        placeholder={t('Type the answer')}
                                    />
                                    <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={handleAnswerFollowUp}>
                                        {t('Send')}
                                    </Button>
                                </Space.Compact>
                            </Space>
                        </Card>
                    </div>
                ) : (
                    <div className="applicant-profile-ai-done">
                        <CheckCircleOutlined />
                        <Text>{t('No AI follow-up questions pending. Switch to Manual to review fields before saving.')}</Text>
                    </div>
                )}
            </Card>
        </div>
    )
}
