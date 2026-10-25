import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CloseOutlined,
  LeftOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons'
import { createPortal } from 'react-dom'
import '@/styles/report-player.css'

export type PlayerTone = 'good' | 'warn' | 'risk' | 'info'

// Resolved by report-player.css, which picks a lighter or darker shade to suit the current theme.
const TONE_COLORS: Record<PlayerTone, string> = { good: 'var(--rp-good)', warn: 'var(--rp-warn)', risk: 'var(--rp-risk)', info: 'var(--rp-info)' }

export type PlayerStat = {
  label: string
  value: number
  prefix?: string
  suffix?: string
  /** Shown instead of the animated number (for pre-formatted values such as currency). */
  display?: string
  icon: ReactNode
  hint?: string
  tone?: PlayerTone
}

export type PlayerBar = { label: string; value: number; total: number; color: string; note?: string }

export type PlayerSlide =
  | { kind: 'title'; eyebrow: string; title: string; subtitle: string; icon: ReactNode; accent: string }
  | {
    kind: 'metrics'
    title: string
    lead: string
    icon: ReactNode
    accent: string
    stats: PlayerStat[]
    ring?: { label: string; value: number; caption: string; color: string }
    bars?: PlayerBar[]
    barsTitle?: string
  }
  | {
    kind: 'narrative'
    title: string
    lead?: string
    icon: ReactNode
    accent: string
    loading?: boolean
    paragraph?: string
    /** Keep to three or so, so the slide fits a phone without scrolling. `meta` is a second line, e.g. "Owner · due date". */
    points?: Array<{ icon: ReactNode; text: string; tone: PlayerTone; meta?: string }>
    note?: string
  }
  | {
    /**
     * One idea, said once: the lead sentence, at most one large figure the sentence doesn't already
     * state, and one visual. Use it instead of 'metrics' when stat cards would only repeat the lead.
     */
    kind: 'focus'
    title: string
    lead: string
    icon: ReactNode
    accent: string
    figure?: { value: string; label: string }
    /** Part-to-whole as one segmented bar; empty segments are left out. */
    breakdown?: PlayerBar[]
    breakdownTitle?: string
    bars?: PlayerBar[]
    barsTitle?: string
  }
  | { kind: 'closing'; title: string; subtitle: string; icon: ReactNode; accent: string }

const SLIDE_SECONDS = 10
// How long a slide stays up: long enough to read what's on it (about 3 words a second, plus a moment to take in
// the visual), never shorter than a plain slide, never so long the player feels stuck.
const WORDS_PER_SECOND = 3
const MAX_SLIDE_SECONDS = 40

const wordCount = (...texts: Array<string | undefined>) => texts.reduce((sum, text) => sum + (text ? text.trim().split(/\s+/).length : 0), 0)

const slideSeconds = (slide?: PlayerSlide) => {
  if (!slide) return SLIDE_SECONDS
  const words = slide.kind === 'narrative'
    ? wordCount(slide.title, slide.lead, slide.paragraph, ...(slide.points || []).flatMap((point) => [point.text, point.meta]), slide.note)
    : slide.kind === 'title' || slide.kind === 'closing'
      ? wordCount(slide.title, slide.subtitle)
      : wordCount(slide.title, slide.lead)
  return Math.min(MAX_SLIDE_SECONDS, Math.max(SLIDE_SECONDS, Math.round(4 + words / WORDS_PER_SECOND)))
}

const hexToRgba = (hex: string, alpha: number) => {
  const clean = hex.replace('#', '')
  const value = parseInt(clean.length === 3 ? clean.split('').map((part) => part + part).join('') : clean, 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

const AnimatedNumber = ({ value, prefix = '', suffix = '', display }: { value: number; prefix?: string; suffix?: string; display?: string }) => {
  const [shown, setShown] = useState(0)
  useEffect(() => {
    if (display) return
    const started = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 1200)
      setShown(Math.round(value * (1 - (1 - progress) ** 3)))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [display, value])
  return <>{display ?? `${prefix}${shown.toLocaleString()}${suffix}`}</>
}

const Ring = ({ value, color, label, caption }: { value: number; color: string; label: string; caption: string }) => {
  const radius = 84
  const circumference = 2 * Math.PI * radius
  const [offset, setOffset] = useState(circumference)
  useEffect(() => {
    const timer = window.setTimeout(() => setOffset(circumference * (1 - Math.max(0, Math.min(100, value)) / 100)), 60)
    return () => window.clearTimeout(timer)
  }, [circumference, value])
  return (
    <div>
      <div className="rp-ring-wrap">
        <svg width="210" height="210" viewBox="0 0 210 210" aria-hidden>
          <circle className="rp-ring-track" cx="105" cy="105" r={radius} fill="none" strokeWidth="16" />
          <circle
            className="rp-ring-arc"
            cx="105"
            cy="105"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="16"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 105 105)"
            style={{ filter: `drop-shadow(0 0 10px ${hexToRgba(color, 0.6)})` }}
          />
        </svg>
        <div className="rp-ring-center"><strong><AnimatedNumber value={value} suffix="%" /></strong><span>{label}</span></div>
      </div>
      <div className="rp-ring-caption">{caption}</div>
    </div>
  )
}

const SlideHead = ({ icon, eyebrow, title, lead }: { icon: ReactNode; eyebrow?: string; title: string; lead?: string }) => (
  <div className="rp-head">
    <span className="rp-head-icon">{icon}</span>
    <div>
      {eyebrow && <div className="rp-eyebrow">{eyebrow}</div>}
      <h2 className="rp-title">{title}</h2>
      {lead && <p className="rp-lead">{lead}</p>}
    </div>
  </div>
)

const SlideView = ({ slide, back, position }: { slide: PlayerSlide; back: boolean; position: number }) => {
  const style = { '--rp-accent': slide.accent, '--rp-accent-soft': hexToRgba(slide.accent, 0.3) } as CSSProperties

  if (slide.kind === 'title' || slide.kind === 'closing') {
    return (
      <div key={position} className={`rp-slide rp-hero${back ? ' is-back' : ''}`} style={style}>
        <SlideHead icon={slide.icon} eyebrow={slide.kind === 'title' ? slide.eyebrow : undefined} title={slide.title} lead={slide.kind === 'title' ? slide.subtitle : slide.subtitle} />
      </div>
    )
  }

  if (slide.kind === 'narrative') {
    return (
      <div key={position} className={`rp-slide rp-narrative-slide${back ? ' is-back' : ''}`} style={style}>
        <SlideHead icon={slide.icon} title={slide.title} lead={slide.lead} />
        <div className="rp-narrative">
          {slide.loading ? (
            <>
              <div className="rp-shimmer" style={{ width: '90%' }} />
              <div className="rp-shimmer" style={{ width: '78%' }} />
              <div className="rp-shimmer" style={{ width: '84%' }} />
              <div className="rp-note">Writing the commentary…</div>
            </>
          ) : (
            <>
              {slide.paragraph && <p className="rp-paragraph">{slide.paragraph}</p>}
              {!!slide.points?.length && (
                <div className="rp-points">
                  {slide.points.map((point, index) => (
                    <div key={index} className="rp-point" style={{ '--rp-i': index, '--rp-tone': TONE_COLORS[point.tone] } as CSSProperties}>
                      <span className="rp-point-icon">{point.icon}</span>
                      <span className="rp-point-text">
                        <span>{point.text}</span>
                        {point.meta && <span className="rp-point-meta">{point.meta}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {slide.note && <div className="rp-note">{slide.note}</div>}
            </>
          )}
        </div>
      </div>
    )
  }

  if (slide.kind === 'focus') {
    const segments = (slide.breakdown || []).filter((segment) => segment.value > 0)
    return (
      <div key={position} className={`rp-slide${back ? ' is-back' : ''}`} style={style}>
        <SlideHead icon={slide.icon} title={slide.title} lead={slide.lead} />
        <div className={`rp-focus${slide.figure ? ' has-figure' : ''}`}>
          {slide.figure && (
            <div className="rp-focus-figure">
              <strong>{slide.figure.value}</strong>
              <span>{slide.figure.label}</span>
            </div>
          )}
          <div className="rp-focus-visual">
            {segments.length > 0 && (
              <div className="rp-breakdown">
                {slide.breakdownTitle && <div className="rp-eyebrow">{slide.breakdownTitle}</div>}
                <div className="rp-breakdown-bar" role="img" aria-label={segments.map((segment) => `${segment.value} ${segment.label}`).join(', ')}>
                  {segments.map((segment) => <span key={segment.label} style={{ flexGrow: segment.value, background: segment.color }} />)}
                </div>
                <div className="rp-breakdown-legend">
                  {segments.map((segment, index) => (
                    <span key={segment.label} style={{ '--rp-i': index } as CSSProperties}>
                      <i style={{ background: segment.color }} />
                      {/* An empty note hides the count, for numbers the lead already says. */}
                      {segment.note !== '' && <strong>{segment.note ?? segment.value}</strong>} {segment.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {slide.bars && slide.bars.length > 0 && (
              <div className="rp-bars">
                {slide.barsTitle && <div className="rp-eyebrow">{slide.barsTitle}</div>}
                {slide.bars.map((bar, index) => (
                  <div key={bar.label} className="rp-bar-row" style={{ '--rp-i': index } as CSSProperties}>
                    <div className="rp-bar-top"><span>{bar.label}</span><span>{bar.note ?? bar.value}</span></div>
                    <div className="rp-bar-track"><div className="rp-bar-fill" style={{ width: `${bar.total ? Math.min(100, (bar.value / bar.total) * 100) : 0}%`, background: bar.color, '--rp-i': index } as CSSProperties} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  const hasSide = Boolean(slide.ring || slide.bars?.length)
  return (
    <div key={position} className={`rp-slide${back ? ' is-back' : ''}`} style={style}>
      <SlideHead icon={slide.icon} title={slide.title} lead={slide.lead} />
      <div className={`rp-body${hasSide ? ' has-side' : ''}`}>
        <div className="rp-stats">
          {slide.stats.map((stat, index) => (
            <div key={stat.label} className="rp-stat" style={{ '--rp-i': index, '--rp-tone': TONE_COLORS[stat.tone || 'info'] } as CSSProperties}>
              <div className="rp-stat-icon">{stat.icon}</div>
              <div className="rp-stat-value"><AnimatedNumber value={stat.value} prefix={stat.prefix} suffix={stat.suffix} display={stat.display} /></div>
              <div className="rp-stat-label">{stat.label}</div>
              {stat.hint && <div className="rp-stat-hint">{stat.hint}</div>}
            </div>
          ))}
        </div>
        {hasSide && (
          <div className="rp-panel">
            {slide.ring && <Ring value={slide.ring.value} color={slide.ring.color} label={slide.ring.label} caption={slide.ring.caption} />}
            {slide.bars && slide.bars.length > 0 && (
              <div className="rp-bars" style={{ marginTop: slide.ring ? 22 : 0 }}>
                {slide.barsTitle && <div className="rp-eyebrow">{slide.barsTitle}</div>}
                {slide.bars.map((bar, index) => (
                  <div key={bar.label} className="rp-bar-row" style={{ '--rp-i': index } as CSSProperties}>
                    <div className="rp-bar-top"><span>{bar.label}</span><span>{bar.note ?? `${bar.value}${bar.total ? ` of ${bar.total}` : ''}`}</span></div>
                    <div className="rp-bar-track"><div className="rp-bar-fill" style={{ width: `${bar.total ? Math.min(100, (bar.value / bar.total) * 100) : 0}%`, background: bar.color, '--rp-i': index } as CSSProperties} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type Props = {
  open: boolean
  onClose: () => void
  slides: PlayerSlide[]
  /** Viewport point the player ripples open from and closes back into, normally the Play button's centre. Defaults to the middle of the screen. */
  origin?: { x: number; y: number } | null
}

type Phase = 'closed' | 'entering' | 'open' | 'closing'

// Fallback in case transitionend never fires (tab hidden mid-close, reduced motion).
const CLOSE_FALLBACK_MS = 700

/** Full-screen, auto-advancing report presentation with animated slides. Arrow keys / space navigate, Esc closes. */
export const ReportPlayer = ({ open, onClose, slides, origin }: Props) => {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [back, setBack] = useState(false)
  const [phase, setPhase] = useState<Phase>('closed')
  const timer = useRef<number>(undefined)
  const overlayRef = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  // Stored as a share of the viewport, not pixels: callers may go fullscreen as the player opens, which resizes the window mid-ripple.
  const rippleOrigin = useRef({ x: 50, y: 50 })
  const last = slides.length - 1
  const slide = slides[Math.min(index, last)]
  const duration = slideSeconds(slide)
  const live = phase === 'open'
  // Reading holds the player: a slide taller than the screen waits until it has been scrolled to the end, and
  // touching or scrolling the slide starts its countdown again, so it never moves on mid-sentence.
  const stageRef = useRef<HTMLDivElement>(null)
  const [heldForScroll, setHeldForScroll] = useState(false)
  const [readingNudge, setReadingNudge] = useState(0)
  const lastNudge = useRef(0)
  const nudge = useCallback(() => {
    const now = Date.now()
    if (now - lastNudge.current < 1000) return
    lastNudge.current = now
    setReadingNudge((value) => value + 1)
  }, [])
  const reachedEnd = (stage: HTMLDivElement) => stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 24

  const goTo = useCallback((next: number) => {
    setBack(next < index)
    setIndex(Math.max(0, Math.min(last, next)))
  }, [index, last])

  useEffect(() => {
    if (open) {
      returnFocus.current = document.activeElement as HTMLElement | null
      rippleOrigin.current = origin
        ? { x: (origin.x / window.innerWidth) * 100, y: (origin.y / window.innerHeight) * 100 }
        : { x: 50, y: 50 }
      setIndex(0)
      setPlaying(true)
      setBack(false)
      setPhase('entering')
    } else {
      setPhase((current) => (current === 'closed' ? current : 'closing'))
    }
    // origin is read once per open, on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Paint the collapsed circle once, then let the transition grow it.
  useLayoutEffect(() => {
    if (phase !== 'entering') return
    overlayRef.current?.getBoundingClientRect()
    const grow = () => setPhase('open')
    const frame = requestAnimationFrame(grow)
    // Frames don't run in a background tab; don't leave the player stuck at a zero-size circle.
    const fallback = window.setTimeout(grow, 50)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(fallback)
    }
  }, [phase])

  const finishClose = useCallback(() => {
    setPhase('closed')
    returnFocus.current?.focus?.()
  }, [])

  useEffect(() => {
    if (phase !== 'closing') return
    const fallback = window.setTimeout(finishClose, CLOSE_FALLBACK_MS)
    return () => window.clearTimeout(fallback)
  }, [finishClose, phase])

  // Browser fullscreen while the player is open, so even the browser's own bars go. Leaving fullscreen
  // (Esc, or the browser's own control) closes the player too, so one Esc does both. Fullscreen can be
  // refused (embedded frames, no user gesture); the player still covers the whole window then.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    if (!open) return
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.()?.catch(() => undefined)
    const onChange = () => { if (!document.fullscreenElement) onCloseRef.current() }
    document.addEventListener('fullscreenchange', onChange)
    return () => {
      document.removeEventListener('fullscreenchange', onChange)
      if (document.fullscreenElement) document.exitFullscreen?.()?.catch(() => undefined)
    }
  }, [open])

  useEffect(() => {
    if (phase === 'closed') return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [phase])

  // Each slide starts at the top; one that doesn't fit is held until it's been read to the end.
  // Measured after paint, and again when the commentary finishes loading and the slide grows.
  const slideLoading = slide?.kind === 'narrative' && !!slide.loading
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage || !live) return
    stage.scrollTop = 0
    const frame = requestAnimationFrame(() => setHeldForScroll(!reachedEnd(stage)))
    return () => cancelAnimationFrame(frame)
  }, [index, live, slideLoading])

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!live || !playing || heldForScroll || !slide || slide.kind === 'closing' || slideLoading) return
    timer.current = window.setTimeout(() => goTo(index + 1), duration * 1000)
    return () => window.clearTimeout(timer.current)
  }, [duration, goTo, heldForScroll, index, live, playing, readingNudge, slide, slideLoading])

  useEffect(() => {
    if (!live) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goTo(index + 1)
      else if (event.key === 'ArrowLeft') goTo(index - 1)
      else if (event.key === ' ') { event.preventDefault(); setPlaying((value) => !value) }
      else if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, index, onClose, live])

  const segments = useMemo(() => slides.map((_, position) => position), [slides])
  if (phase === 'closed' || !slide) return null

  const ripple = { '--rp-x': `${rippleOrigin.current.x}%`, '--rp-y': `${rippleOrigin.current.y}%` } as CSSProperties

  // Rendered into <body>: inside the page, any ancestor with a transform (the page fade-in keeps one)
  // turns position: fixed into "fixed to that box", and the top bar would show above the player.
  return createPortal(
    <>
    {/* The ripple: a wash in the first slide's accent leads, the player follows a beat behind it. */}
    <div className="rp-ripple-wash" data-phase={phase} style={{ ...ripple, '--rp-wash': slides[0]?.accent } as CSSProperties} aria-hidden="true" />
    <div
      ref={overlayRef}
      className={`rp-overlay${playing && !heldForScroll ? '' : ' is-paused'}`}
      data-phase={phase}
      style={{ ...ripple, '--rp-accent': slide.accent, '--rp-accent-soft': hexToRgba(slide.accent, 0.3), '--rp-duration': `${duration}s` } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Report player"
      onTransitionEnd={(event) => {
        if (phase === 'closing' && event.target === event.currentTarget && event.propertyName === 'clip-path') finishClose()
      }}
    >
      <div className="rp-backdrop" />
      <div className="rp-orb is-a" />
      <div className="rp-orb is-b" />

      <div className="rp-topbar">
        <div className="rp-timeline">
          {segments.map((position) => (
            <div key={position} className={`rp-timeline-seg${position < index ? ' is-done' : position === index ? ' is-current' : ''}`} onClick={() => goTo(position)}>
              {/* Re-keyed so the progress bar restarts with the countdown (a new slide, resuming, or a reading nudge). */}
              <span key={position === index ? `${index}-${playing}-${readingNudge}` : undefined} />
            </div>
          ))}
        </div>
        <button type="button" className="rp-icon-btn" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
        </button>
        <button type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close report player"><CloseOutlined /></button>
      </div>

      <div
        ref={stageRef}
        className="rp-stage"
        onScroll={(event) => {
          if (heldForScroll && reachedEnd(event.currentTarget)) setHeldForScroll(false)
          nudge()
        }}
        onWheel={nudge}
        onTouchStart={nudge}
        onPointerDown={nudge}
      >
        <SlideView slide={slide} back={back} position={index} />
      </div>

      <div className="rp-controls">
        <button type="button" className="rp-icon-btn" onClick={() => goTo(index - 1)} disabled={index === 0} aria-label="Previous slide"><LeftOutlined /></button>
        <span className="rp-counter">{index + 1} / {slides.length}</span>
        {index === last
          ? <button type="button" className="rp-icon-btn" onClick={() => { setBack(true); setIndex(0); setPlaying(true) }} aria-label="Replay"><ReloadOutlined /></button>
          : <button type="button" className="rp-icon-btn" onClick={() => goTo(index + 1)} aria-label="Next slide"><RightOutlined /></button>}
      </div>
    </div>
    </>,
    document.body,
  )
}

export default ReportPlayer
