import type { ReactNode } from 'react'
import { Modal } from 'antd'
import { useThemeMode } from '@/providers/ThemeProvider'
import '@/styles/director.css'

/** The ring-of-dots summary modal (dark or light) used for drilling into a programme, sector, SME, etc. */
export type StatBlock = { icon?: ReactNode; label: string; value: string; delta?: { text: string; positive: boolean }; note?: string }

export type SummaryDetail = {
  title: string
  subtitle?: string
  center: { value: string; label: string }
  outer: { value: number; color: string; label: string }
  inner: { value: number; color: string; label: string }
  left: StatBlock[]
  right: StatBlock[]
  leftBottom: Array<{ icon: ReactNode; label: string; value: string }>
  rightBottom: Array<{ label: string; value: string }>
  rightBottomTitle?: string
}

export const NEON_PURPLE = '#8b5cf6'
export const NEON_GREEN = '#22e58a'

const useSummaryPalette = () => {
  const { mode } = useThemeMode()
  const dark = mode === 'dark'
  return {
    dark,
    text: dark ? '#ffffff' : '#141414',
    soft: dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.8)',
    muted: dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.55)',
    unlit: dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)',
    tile: dark ? 'rgba(139,92,246,0.35)' : 'rgba(139,92,246,0.14)',
    tileText: dark ? '#ffffff' : '#6d4bd8',
    up: dark ? NEON_GREEN : '#16a34a',
    down: dark ? '#ff6b6b' : '#dc2626',
    glow: dark ? 5 : 0,
  }
}

const DotRing = ({ outer, inner }: { outer: { value: number; color: string }; inner: { value: number; color: string } }) => {
  const palette = useSummaryPalette()
  const size = 340
  const center = size / 2
  const ring = (key: string, radius: number, count: number, dot: number, value: number, color: string) => {
    const lit = Math.round((value / 100) * count)
    return Array.from({ length: count }, (_, index) => {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2
      const on = index < lit
      return (
        <circle
          key={`${key}-${index}`}
          cx={center + radius * Math.cos(angle)}
          cy={center + radius * Math.sin(angle)}
          r={dot}
          fill={on ? color : palette.unlit}
          opacity={on ? 0.5 + 0.5 * (index / Math.max(lit, 1)) : 1}
          style={on && palette.dark ? { filter: `drop-shadow(0 0 5px ${color})` } : undefined}
        />
      )
    })
  }
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size, display: 'block', margin: '0 auto' }} aria-hidden>
      {ring('outer', 150, 44, 8, outer.value, outer.color)}
      {ring('inner', 104, 32, 7, inner.value, inner.color)}
    </svg>
  )
}

const StatBlockView = ({ stat, align }: { stat: StatBlock; align: 'left' | 'right' }) => {
  const palette = useSummaryPalette()
  return (
  <div style={{ textAlign: align }}>
    <div style={{ display: 'flex', justifyContent: align === 'left' ? 'flex-start' : 'flex-end', alignItems: 'center', gap: 8, color: palette.soft, fontWeight: 600 }}>
      {stat.icon}<span>{stat.label}</span>
    </div>
    <div style={{ display: 'flex', justifyContent: align === 'left' ? 'flex-start' : 'flex-end', alignItems: 'baseline', gap: 10, margin: '4px 0' }}>
      <span style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1, color: palette.text }}>{stat.value}</span>
      {stat.delta && <span style={{ fontSize: 13, fontWeight: 700, color: stat.delta.positive ? palette.up : palette.down }}>{stat.delta.positive ? '↑' : '↓'} {stat.delta.text}</span>}
    </div>
    {stat.note && <div style={{ fontSize: 12, color: palette.muted }}>{stat.note}</div>}
  </div>
  )
}

export const SummaryModal = ({ detail, onClose }: { detail: SummaryDetail | null; onClose: () => void }) => {
  const palette = useSummaryPalette()
  return (
  <Modal open={!!detail} onCancel={onClose} footer={null} width={940} centered destroyOnClose className={`director-summary-modal ${palette.dark ? 'is-dark' : 'is-light'}`} title={detail ? <div><div style={{ fontSize: 18, fontWeight: 700 }}>{detail.title}</div>{detail.subtitle && <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.6 }}>{detail.subtitle}</div>}</div> : ''}>
    {detail && (
      <div className="director-dark-grid">
        <div className="director-dark-side">
          {detail.left.map((stat) => <StatBlockView key={stat.label} stat={stat} align="left" />)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {detail.leftBottom.map((item) => (
              <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: palette.tileText, background: palette.tile }}>{item.icon}</span>
                <div><div style={{ fontSize: 12, color: palette.muted }}>{item.label}</div><div style={{ fontWeight: 700, color: palette.text }}>{item.value}</div></div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative' }}>
          <DotRing outer={detail.outer} inner={detail.inner} />
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span style={{ fontSize: 38, fontWeight: 800, letterSpacing: 2, color: palette.text }}>{detail.center.value}</span>
            <span style={{ fontSize: 12, letterSpacing: 3, color: palette.muted }}>{detail.center.label.toUpperCase()}</span>
          </div>
        </div>

        <div className="director-dark-side" style={{ textAlign: 'right' }}>
          {detail.right.map((stat) => <StatBlockView key={stat.label} stat={stat} align="right" />)}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 'auto' }}>
            {detail.rightBottomTitle && <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: palette.muted }}>{detail.rightBottomTitle}</div>}
            {detail.rightBottom.map((item) => (
              <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, color: palette.text }}>
                <span style={{ opacity: 0.75, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span><strong style={{ flexShrink: 0 }}>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
  </Modal>
  )
}


export default SummaryModal
