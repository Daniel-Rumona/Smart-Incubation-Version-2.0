import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CloseOutlined,
  LeftOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightOutlined,
} from '@ant-design/icons'
import '@/styles/report-player.css'

export type PlayerTone = 'good' | 'warn' | 'risk' | 'info'

const TONE_COLORS: Record<PlayerTone, string> = { good: '#34d399', warn: '#fbbf24', risk: '#f0808a', info: '#60a5fa' }

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
    points?: Array<{ icon: ReactNode; text: string; tone: PlayerTone }>
    note?: string
  }
  | { kind: 'closing'; title: string; subtitle: string; icon: ReactNode; accent: string }

const SLIDE_SECONDS = 10
const NARRATIVE_SECONDS = 16

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
          <circle cx="105" cy="105" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="16" />
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
      <div key={position} className={`rp-slide${back ? ' is-back' : ''}`} style={style}>
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
              {slide.points?.map((point, index) => (
                <div key={index} className="rp-point" style={{ '--rp-i': index, '--rp-tone': TONE_COLORS[point.tone] } as CSSProperties}>
                  <span className="rp-point-icon">{point.icon}</span>
                  <span>{point.text}</span>
                </div>
              ))}
              {slide.note && <div className="rp-note">{slide.note}</div>}
            </>
          )}
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
}

/** Full-screen, auto-advancing report presentation with animated slides. Arrow keys / space navigate, Esc closes. */
export const ReportPlayer = ({ open, onClose, slides }: Props) => {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [back, setBack] = useState(false)
  const timer = useRef<number>(undefined)
  const last = slides.length - 1
  const slide = slides[Math.min(index, last)]
  const duration = slide?.kind === 'narrative' ? NARRATIVE_SECONDS : SLIDE_SECONDS

  const goTo = useCallback((next: number) => {
    setBack(next < index)
    setIndex(Math.max(0, Math.min(last, next)))
  }, [index, last])

  useEffect(() => {
    if (open) {
      setIndex(0)
      setPlaying(true)
      setBack(false)
    }
  }, [open])

  useEffect(() => {
    window.clearTimeout(timer.current)
    if (!open || !playing || !slide || slide.kind === 'closing' || (slide.kind === 'narrative' && slide.loading)) return
    timer.current = window.setTimeout(() => goTo(index + 1), duration * 1000)
    return () => window.clearTimeout(timer.current)
  }, [duration, goTo, index, open, playing, slide])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') goTo(index + 1)
      else if (event.key === 'ArrowLeft') goTo(index - 1)
      else if (event.key === ' ') { event.preventDefault(); setPlaying((value) => !value) }
      else if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, index, onClose, open])

  const segments = useMemo(() => slides.map((_, position) => position), [slides])
  if (!open || !slide) return null

  return (
    <div className={`rp-overlay${playing ? '' : ' is-paused'}`} style={{ '--rp-accent': slide.accent, '--rp-accent-soft': hexToRgba(slide.accent, 0.3), '--rp-duration': `${duration}s` } as CSSProperties} role="dialog" aria-label="Report player">
      <div className="rp-backdrop" />
      <div className="rp-orb is-a" />
      <div className="rp-orb is-b" />

      <div className="rp-topbar">
        <div className="rp-timeline">
          {segments.map((position) => (
            <div key={position} className={`rp-timeline-seg${position < index ? ' is-done' : position === index ? ' is-current' : ''}`} onClick={() => goTo(position)}>
              <span key={position === index ? `${index}-${playing}` : undefined} />
            </div>
          ))}
        </div>
        <button type="button" className="rp-icon-btn" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
        </button>
        <button type="button" className="rp-icon-btn" onClick={onClose} aria-label="Close report player"><CloseOutlined /></button>
      </div>

      <div className="rp-stage">
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
  )
}

export default ReportPlayer
