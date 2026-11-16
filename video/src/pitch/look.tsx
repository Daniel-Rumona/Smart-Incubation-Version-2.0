import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion'
import { fontFamily } from '../theme'
import type { Section } from './script'

// The pitch's own look, unlike the walkthrough's: the problem is told in the dark, and from the moment the product is
// revealed (the lightbulb in its logo switches on) everything is light, with a colour per part of the product.
export const DARK = {
  bg: '#09090f',
  text: '#f5f5fa',
  muted: 'rgba(245, 245, 250, 0.6)',
  card: '#14141f',
  border: 'rgba(255, 255, 255, 0.09)',
  warn: '#fb923c',
}

export const LIGHT = {
  bg: '#f6f5fb',
  ink: '#15121f',
  muted: 'rgba(21, 18, 31, 0.6)',
  card: '#ffffff',
  border: 'rgba(21, 18, 31, 0.08)',
  accent: '#7c3aed',
}

export const SECTION_COLORS: Record<Section, string> = {
  platform: '#7c3aed',
  incubation: '#2563eb',
  training: '#059669',
  esg: '#d97706',
}

const OUT = Easing.bezier(0.16, 1, 0.3, 1)

/** 0 → 1 over `length` frames from `start`, eased out: for things that arrive. */
export const arrive = (frame: number, start: number, length = 18) =>
  interpolate(frame, [start, start + length], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: OUT })

/** Opacity, lift and blur for something arriving at `start`. */
export const riseStyle = (frame: number, start: number, distance = 28): React.CSSProperties => {
  const t = arrive(frame, start)
  return { opacity: t, translate: `0px ${(1 - t) * distance}px`, filter: `blur(${(1 - t) * 8}px)` }
}

/** A line of text that arrives word by word, three frames apart. */
export const Words: React.FC<{ text: string; start: number; style?: React.CSSProperties; highlight?: string }> = ({ text, start, style, highlight }) => {
  const frame = useCurrentFrame()
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '0.26em', ...style }}>
      {text.split(' ').map((word, index) => (
        <span key={index} style={{ display: 'inline-block', ...riseStyle(frame, start + index * 3, 22), color: highlight }}>
          {word}
        </span>
      ))}
    </div>
  )
}

/** The stage: dark, light, or (for the reveal) dark turning light as `light` goes 0 → 1. */
export const Stage: React.FC<{ light: number; children: React.ReactNode }> = ({ light, children }) => (
  <AbsoluteFill style={{ backgroundColor: DARK.bg, fontFamily, overflow: 'hidden' }}>
    <AbsoluteFill style={{ backgroundColor: LIGHT.bg, opacity: light }} />
    {/* A faint dot grid on the light stage, so it reads as a surface rather than a blank page. */}
    <AbsoluteFill
      style={{
        opacity: light * 0.55,
        backgroundImage: 'radial-gradient(rgba(21, 18, 31, 0.09) 1.4px, transparent 1.4px)',
        backgroundSize: '34px 34px',
        maskImage: 'radial-gradient(ellipse at 50% 45%, black 30%, transparent 80%)',
      }}
    />
    {children}
  </AbsoluteFill>
)
