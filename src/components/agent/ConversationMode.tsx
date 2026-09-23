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

// How long to wait after the mic goes quiet before treating a spoken turn as
// finished and sending it. Long enough to survive a natural mid-sentence
// pause, short enough to still feel immediate once someone stops talking.
const SILENCE_MS = 1200

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
    // Accumulates finalized speech-recognition chunks for the turn currently
    // being spoken — cleared once that turn is sent (see SILENCE_MS above).
    const bufferRef = useRef('')
    const silenceTimerRef = useRef<number | undefined>(undefined)
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

    const playReply = async (text: string) => {
        // Stop capturing while the reply is read out loud — otherwise the mic
        // picks up the assistant's own voice and tries to transcribe it.
        // Listening resumes automatically once playback settles back to idle.
        window.clearTimeout(silenceTimerRef.current)
        bufferRef.current = ''
        detachRecognition()
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

    useEffect(() => () => {
        window.clearTimeout(silenceTimerRef.current)
        detachRecognition()
        stopSpeaking()
    }, [])

    // A finalized chunk of speech, sent as soon as SILENCE_MS of quiet
    // follows it — the mic itself is never stopped for this, so whatever is
    // said next just starts the next turn's buffer. This is what lets
    // someone keep talking through the assistant's "thinking" phase instead
    // of losing anything said while a previous turn is still in flight.
    const sendSpokenPhrase = (text: string) => {
        const content = text.trim()
        if (!content) return
        setDraft('')
        onSend(content)
    }

    // The manual text box overrides voice entirely — stop capturing so the
    // two inputs never race to send the same turn twice.
    const sendTypedMessage = (text: string) => {
        const content = text.trim()
        if (!content) return
        window.clearTimeout(silenceTimerRef.current)
        bufferRef.current = ''
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
        bufferRef.current = ''

        const recognition = new Ctor()
        recognition.lang = navigator.language || 'en-US'
        recognition.interimResults = true
        // Continuous so the session survives across multiple sentences and
        // natural pauses instead of ending — and dropping everything said
        // after it — the instant the first phrase finalizes.
        recognition.continuous = true
        recognition.maxAlternatives = 1

        const scheduleAutoSend = () => {
            window.clearTimeout(silenceTimerRef.current)
            silenceTimerRef.current = window.setTimeout(() => {
                const content = bufferRef.current.trim()
                bufferRef.current = ''
                if (content) sendSpokenPhrase(content)
            }, SILENCE_MS)
        }

        recognition.onresult = (event: SpeechRecognitionEventLike) => {
            let interimText = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]
                if (result.isFinal) {
                    bufferRef.current = `${bufferRef.current} ${result[0].transcript}`.trim()
                } else {
                    interimText += result[0].transcript
                }
            }
            // Mirrors what's being heard straight into the composer, like
            // dictation — the same box someone would otherwise type into.
            setDraft(`${bufferRef.current} ${interimText}`.trim())
            // Any activity — finalized or still interim — means the person
            // is still talking, so push the auto-send back out.
            scheduleAutoSend()
        }

        recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
            if (event.error === 'aborted') return
            setMicError(MIC_ERROR_MESSAGES[event.error] || 'Voice input failed — please try again.')
        }

        recognition.onend = () => {
            recognitionRef.current = null
            window.clearTimeout(silenceTimerRef.current)
            const content = bufferRef.current.trim()
            bufferRef.current = ''
            setPhase((current) => (current === 'listening' ? 'idle' : current))
            // Some browsers end a continuous session on their own well
            // before SILENCE_MS fires (long pauses, backgrounding, internal
            // timeouts) — flush anything already captured rather than lose
            // it, and the auto-restart effect below picks listening back up.
            if (content) sendSpokenPhrase(content)
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
    // reply finishes speaking, after a false start, whatever — so talking
    // again never needs another tap. Deliberately NOT gated on isTyping —
    // the mic keeps running through the assistant's "thinking" phase so nothing
    // said while a reply is in flight gets lost; playReply() is what pauses
    // capture for the "speaking" phase specifically, to avoid picking up the
    // assistant's own voice.
    useEffect(() => {
        if (muted || phase !== 'idle' || !voiceSupported) return
        startListening()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, muted, voiceSupported])

    const toggleMuted = () => {
        if (!muted) {
            window.clearTimeout(silenceTimerRef.current)
            bufferRef.current = ''
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
        window.clearTimeout(silenceTimerRef.current)
        bufferRef.current = ''
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
                        onPressEnter={() => sendTypedMessage(draft)}
                        placeholder={phase === 'listening' ? 'Listening…' : 'Type your message…'}
                        disabled={isBusy}
                        aria-label="Message"
                    />
                    <Button
                        type="primary"
                        shape="circle"
                        icon={<SendOutlined />}
                        onClick={() => sendTypedMessage(draft)}
                        disabled={!draft.trim() || isBusy}
                        aria-label="Send message"
                    />
                </div>
            </div>
        </div>
    )
}

export default ConversationMode
