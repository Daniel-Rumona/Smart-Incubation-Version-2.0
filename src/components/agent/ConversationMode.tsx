import { useEffect, useRef, useState } from 'react'
import { Button, Input } from 'antd'
import { AudioMutedOutlined, AudioOutlined, CloseOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons'
import { synthesizeSpeech } from '@/services/agentService'
import { AgentRichText } from '@/components/agent/AgentRichText'
import { VoiceOrb, type VoiceOrbMode } from '@/components/agent/VoiceOrb'
import type { AgentChatMessage } from '@/types/agent'
import '@/styles/conversation-mode.css'

// The placeholder content queueTask() writes while a reply is still in
// flight — see BackgroundTasksProvider.tsx / AgenticHomePage.tsx.
const PENDING_AGENT_CONTENT = 'Working on this in the background…'

// Approximates how long ElevenLabs playback of a reply would take, so the
// orb's "speaking" phase has a believable duration until real audio drives
// it. ~2.5 words/sec is a conversational speech pace.
const estimateSpeakingMs = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean).length
    return Math.min(8000, Math.max(1500, (words / 2.5) * 1000))
}

// The Web Speech API has no lib.dom typings and is only exposed under a
// vendor prefix in Chromium — feature-detect and type just the surface this
// component uses rather than pulling in a typings package for one narrow use.
type SpeechRecognitionResultLike = {
    isFinal: boolean
    0: { transcript: string }
}

type SpeechRecognitionEventLike = {
    resultIndex: number
    results: ArrayLike<SpeechRecognitionResultLike>
}

type SpeechRecognitionErrorEventLike = {
    error: string
}

type SpeechRecognitionInstance = {
    lang: string
    interimResults: boolean
    continuous: boolean
    maxAlternatives: number
    start: () => void
    stop: () => void
    abort: () => void
    onresult: ((event: SpeechRecognitionEventLike) => void) | null
    onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
    onend: (() => void) | null
}

type SpeechRecognitionWindow = {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
}

const getSpeechRecognitionCtor = (): (new () => SpeechRecognitionInstance) | null => {
    if (typeof window === 'undefined') return null
    const globalWindow = window as unknown as SpeechRecognitionWindow
    return globalWindow.SpeechRecognition || globalWindow.webkitSpeechRecognition || null
}

const MIC_ERROR_MESSAGES: Record<string, string> = {
    'not-allowed': 'Microphone access was denied — allow it in your browser settings to talk.',
    'no-speech': "I didn't catch that — try again.",
    'audio-capture': 'No microphone was found.',
    network: 'Voice input needs a network connection.',
}

interface ConversationModeProps {
    messages: AgentChatMessage[]
    isTyping: boolean
    onSend: (content: string) => void
    onClose: () => void
}

// The orb's own "thinking" phase is derived straight from `isTyping` (see
// `displayPhase` below) rather than mirrored into this state — phase only
// tracks what conversation mode itself controls: mic capture and playback.
type ConversationPhase = Exclude<VoiceOrbMode, 'thinking'>

export const ConversationMode = ({ messages, isTyping, onSend, onClose }: ConversationModeProps) => {
    const [phase, setPhase] = useState<ConversationPhase>('idle')
    const [muted, setMuted] = useState(false)
    const [draft, setDraft] = useState('')
    const [micError, setMicError] = useState<string | null>(null)
    const [speakingAudioEl, setSpeakingAudioEl] = useState<HTMLAudioElement | null>(null)
    const speakingTimeoutRef = useRef<number | undefined>(undefined)
    const lastMessageCountRef = useRef(messages.length)
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)
    const finalTranscriptRef = useRef('')
    const voiceSupported = Boolean(getSpeechRecognitionCtor())
    const messagesRef = useRef<HTMLDivElement | null>(null)
    const currentAudioRef = useRef<HTMLAudioElement | null>(null)
    const currentAudioUrlRef = useRef<string | null>(null)
    const ttsAbortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        const element = messagesRef.current
        if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }, [messages, isTyping])

    useEffect(() => {
        if (!isTyping) return
        window.clearTimeout(speakingTimeoutRef.current)
    }, [isTyping])

    const stopSpeaking = () => {
        ttsAbortRef.current?.abort()
        ttsAbortRef.current = null
        window.clearTimeout(speakingTimeoutRef.current)
        if (currentAudioRef.current) {
            currentAudioRef.current.onended = null
            currentAudioRef.current.onerror = null
            currentAudioRef.current.pause()
            currentAudioRef.current = null
        }
        if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current)
            currentAudioUrlRef.current = null
        }
        setSpeakingAudioEl(null)
    }

    // Timed fallback for when ElevenLabs isn't configured or the request
    // fails — the orb still mimics a plausible speaking duration from the
    // reply's length, so voice being unavailable never breaks the flow.
    const fallbackTimedSpeaking = (text: string) => {
        setSpeakingAudioEl(null)
        speakingTimeoutRef.current = window.setTimeout(
            () => setPhase((current) => (current === 'speaking' ? 'idle' : current)),
            estimateSpeakingMs(text),
        )
    }

    const playReply = async (text: string) => {
        setPhase('speaking')
        const controller = new AbortController()
        ttsAbortRef.current = controller
        try {
            const blob = await synthesizeSpeech(text, controller.signal)
            if (controller.signal.aborted) return

            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            currentAudioRef.current = audio
            currentAudioUrlRef.current = url

            audio.onended = () => {
                URL.revokeObjectURL(url)
                if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null
                if (currentAudioRef.current === audio) currentAudioRef.current = null
                setSpeakingAudioEl((current) => (current === audio ? null : current))
                setPhase((current) => (current === 'speaking' ? 'idle' : current))
            }
            audio.onerror = () => {
                URL.revokeObjectURL(url)
                if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null
                fallbackTimedSpeaking(text)
            }

            setSpeakingAudioEl(audio)
            await audio.play()
        } catch {
            if (controller.signal.aborted) return
            fallbackTimedSpeaking(text)
        }
    }

    useEffect(() => {
        if (messages.length <= lastMessageCountRef.current) {
            lastMessageCountRef.current = messages.length
            return
        }
        const latest = messages[messages.length - 1]
        lastMessageCountRef.current = messages.length
        if (latest.role !== 'agent' || latest.content === PENDING_AGENT_CONTENT) return

        stopSpeaking()
        void playReply(latest.content)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages])

    const detachRecognition = () => {
        const recognition = recognitionRef.current
        if (!recognition) return
        recognition.onresult = null
        recognition.onerror = null
        recognition.onend = null
        try {
            recognition.abort()
        } catch {
            // already stopped
        }
        recognitionRef.current = null
    }

    useEffect(() => () => {
        detachRecognition()
        stopSpeaking()
    }, [])

    const sendMessage = (text: string) => {
        const content = text.trim()
        if (!content) return
        detachRecognition()
        stopSpeaking()
        setPhase((current) => (current === 'listening' || current === 'speaking' ? 'idle' : current))
        onSend(content)
        setDraft('')
    }

    const startListening = () => {
        const Ctor = getSpeechRecognitionCtor()
        if (!Ctor) {
            setMicError('Voice input is not supported in this browser — type your message instead.')
            return
        }

        setMicError(null)
        setDraft('')
        finalTranscriptRef.current = ''

        const recognition = new Ctor()
        recognition.lang = navigator.language || 'en-US'
        recognition.interimResults = true
        recognition.continuous = false
        recognition.maxAlternatives = 1

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
            let finalText = ''
            let interimText = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]
                if (result.isFinal) finalText += result[0].transcript
                else interimText += result[0].transcript
            }
            if (finalText.trim()) finalTranscriptRef.current = finalText.trim()
            // Mirrors what's being heard straight into the composer, like
            // dictation — the same box someone would otherwise type into.
            setDraft(finalTranscriptRef.current || interimText)
        }

        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
            if (event.error === 'aborted') return
            setMicError(MIC_ERROR_MESSAGES[event.error] || 'Voice input failed — please try again.')
        }

        recognition.onend = () => {
            recognitionRef.current = null
            const transcript = finalTranscriptRef.current
            finalTranscriptRef.current = ''
            setPhase((current) => (current === 'listening' ? 'idle' : current))
            if (transcript) sendMessage(transcript)
        }

        recognitionRef.current = recognition
        setPhase('listening')
        try {
            recognition.start()
        } catch {
            recognitionRef.current = null
            setPhase('idle')
        }
    }

    const stopListening = () => {
        recognitionRef.current?.stop()
    }

    // "Always on": once conversation mode is open and not muted, listening
    // restarts automatically every time we settle back to idle — after a
    // reply finishes, after a false start, whatever — so talking again never
    // needs another tap. Gated on !isTyping too so a reply already in flight
    // can't get a recognition session started underneath it (see the isTyping
    // effect above, which can flip phase to 'thinking' in the same commit).
    useEffect(() => {
        if (muted || isTyping || phase !== 'idle' || !voiceSupported) return
        startListening()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, muted, isTyping])

    const toggleMuted = () => {
        if (!muted) {
            stopListening()
            setMuted(true)
        } else {
            setMuted(false)
        }
    }

    // A real keystroke or focus (never our own recognition-driven setDraft
    // calls) means the user wants to type — stop competing with them. Muting
    // unconditionally (not just when already 'listening') also closes the
    // race where they click in just before the auto-restart effect below
    // fires and starts a recognition session underneath their typing.
    const handleManualTyping = () => {
        setMuted(true)
        stopListening()
    }

    const displayPhase: VoiceOrbMode = isTyping ? 'thinking' : phase
    const isBusy = isTyping || phase === 'speaking'

    return (
        <div className="conversation-mode" role="dialog" aria-modal="true" aria-label="Conversation mode">
            <button type="button" className="conversation-mode-exit-button" aria-label="Exit conversation mode" onClick={onClose}>
                <CloseOutlined />
            </button>

            <div className="conversation-mode-messages" ref={messagesRef}>
                {messages.map((item) => (
                    <div className={`agentic-chat-message is-${item.role}`} key={item.id}>
                        {item.role === 'agent' && <span><RobotOutlined /></span>}
                        {item.role === 'agent'
                            ? <div className="agentic-message-content">
                                {item.content === PENDING_AGENT_CONTENT
                                    ? <span className="agentic-pending-copy">Thinking…</span>
                                    : <AgentRichText content={item.content} />}
                            </div>
                            : <p>{item.content}</p>}
                    </div>
                ))}
            </div>

            <div className="conversation-mode-orb-row">
                <VoiceOrb mode={displayPhase} size={104} audioElement={speakingAudioEl} />
            </div>

            {micError && <p className="conversation-mode-mic-error" role="alert">{micError}</p>}

            <div className="conversation-mode-bottom">
                <div className="agentic-composer">
                    <button
                        type="button"
                        className={`conversation-mode-mic-button ${phase === 'listening' ? 'is-active' : ''}`}
                        onClick={toggleMuted}
                        disabled={!voiceSupported}
                        aria-pressed={!muted}
                        aria-label={muted ? 'Resume listening' : 'Mute microphone'}
                        title={voiceSupported ? undefined : 'Voice input is not supported in this browser'}
                    >
                        {muted || phase !== 'listening' ? <AudioMutedOutlined /> : <AudioOutlined />}
                    </button>
                    <Input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={handleManualTyping}
                        onFocus={handleManualTyping}
                        onPressEnter={() => sendMessage(draft)}
                        placeholder={phase === 'listening' ? 'Listening…' : 'Type your message…'}
                        disabled={isBusy}
                        aria-label="Message"
                    />
                    <Button
                        type="primary"
                        shape="circle"
                        icon={<SendOutlined />}
                        onClick={() => sendMessage(draft)}
                        disabled={!draft.trim() || isBusy}
                        aria-label="Send message"
                    />
                </div>
            </div>
        </div>
    )
}

export default ConversationMode
