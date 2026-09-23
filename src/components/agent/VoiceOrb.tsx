import { useEffect, useRef } from 'react'
import '@/styles/voice-orb.css'

export type VoiceOrbMode = 'idle' | 'listening' | 'thinking' | 'speaking'

interface VoiceOrbProps {
    mode: VoiceOrbMode
    size?: number
    className?: string
    /** The <audio> element currently playing a spoken reply, if any — while
     * present and `mode === 'speaking'`, the orb reacts to its real playback
     * level via an AnalyserNode instead of the simulated speaking waveform. */
    audioElement?: HTMLAudioElement | null
}

const LAYER_BASE_DURATIONS = [7, 9, 11]

// Drives the orb's "liveliness" from a simulated amplitude for idle/
// listening/thinking (there's no mic-level signal worth reacting to for
// those) and from real ElevenLabs playback levels for speaking, when an
// audioElement is supplied — see the AnalyserNode setup below.
export const VoiceOrb = ({ mode, size = 220, className, audioElement }: VoiceOrbProps) => {
    const scaleRef = useRef<HTMLDivElement | null>(null)
    const glowRef = useRef<HTMLDivElement | null>(null)
    const layerRefs = useRef<Array<HTMLDivElement | null>>([])
    const modeRef = useRef(mode)
    const tickRef = useRef(0)
    const noiseRef = useRef(0)
    const audioContextRef = useRef<AudioContext | null>(null)
    const analyserRef = useRef<AnalyserNode | null>(null)
    const analyserDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null)

    useEffect(() => {
        modeRef.current = mode
    }, [mode])

    // A MediaElementAudioSourceNode can only ever be created once per <audio>
    // element (the browser throws on a second attempt), which is fine here —
    // ConversationMode hands us a fresh element per reply, never reuses one.
    useEffect(() => {
        analyserRef.current = null
        if (!audioElement) return

        try {
            const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
            if (!AudioCtx) throw new Error('AudioContext unsupported')
            const context = new AudioCtx()
            const source = context.createMediaElementSource(audioElement)
            const analyser = context.createAnalyser()
            analyser.fftSize = 256
            analyser.smoothingTimeConstant = 0.7
            source.connect(analyser)
            // Routing through Web Audio replaces the element's own output path,
            // so the analyser must still connect onward or playback goes silent.
            analyser.connect(context.destination)

            audioContextRef.current = context
            analyserRef.current = analyser
            analyserDataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
        } catch {
            analyserRef.current = null
        }

        return () => {
            analyserRef.current = null
            const context = audioContextRef.current
            audioContextRef.current = null
            if (context) void context.close().catch(() => {})
        }
    }, [audioElement])

    useEffect(() => {
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        let frameId: number

        const tick = () => {
            tickRef.current += 1
            const t = tickRef.current
            let amplitude: number
            let speed: number

            switch (modeRef.current) {
                case 'listening': {
                    noiseRef.current += (Math.random() - 0.5) * 0.08
                    noiseRef.current = Math.max(-1, Math.min(1, noiseRef.current * 0.9))
                    amplitude = 0.08 + Math.abs(noiseRef.current) * 0.12
                    speed = 1.4
                    break
                }
                case 'thinking': {
                    amplitude = 0.05 + Math.sin(t * 0.05) * 0.02
                    speed = 1
                    break
                }
                case 'speaking': {
                    const analyser = analyserRef.current
                    const data = analyserDataRef.current
                    if (analyser && data) {
                        analyser.getByteFrequencyData(data)
                        let sum = 0
                        for (let i = 0; i < data.length; i++) sum += data[i]
                        const level = sum / data.length / 255
                        amplitude = 0.06 + level * 0.42
                        speed = 1.1 + level * 2.4
                    } else {
                        const wave = Math.sin(t * 0.15) * 0.5 + Math.sin(t * 0.37) * 0.3 + Math.sin(t * 0.61) * 0.2
                        amplitude = 0.14 + Math.abs(wave) * 0.16
                        speed = 2.2
                    }
                    break
                }
                default: {
                    amplitude = 0.03 + Math.sin(t * 0.02) * 0.01
                    speed = 0.6
                }
            }

            if (prefersReducedMotion) {
                amplitude = 0.02
                speed = 0.4
            }

            if (scaleRef.current) {
                scaleRef.current.style.transform = `scale(${(1 + amplitude).toFixed(4)})`
            }
            if (glowRef.current) {
                glowRef.current.style.opacity = String(Math.min(1, 0.4 + amplitude * 1.5))
            }
            layerRefs.current.forEach((el, index) => {
                if (!el) return
                el.style.animationDuration = `${(LAYER_BASE_DURATIONS[index] / speed).toFixed(2)}s`
            })

            frameId = requestAnimationFrame(tick)
        }

        frameId = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(frameId)
    }, [])

    return (
        <div className={`voice-orb ${className || ''}`} style={{ width: size, height: size }} data-mode={mode}>
            <div className="voice-orb-glow" ref={glowRef} />
            <div className="voice-orb-scale" ref={scaleRef}>
                <div className="voice-orb-layer voice-orb-layer-1" ref={(el) => { layerRefs.current[0] = el }} />
                <div className="voice-orb-layer voice-orb-layer-2" ref={(el) => { layerRefs.current[1] = el }} />
                <div className="voice-orb-layer voice-orb-layer-3" ref={(el) => { layerRefs.current[2] = el }} />
            </div>
        </div>
    )
}

export default VoiceOrb
