import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from 'remotion'
import { Backdrop } from '../components/Backdrop'
import { Captions } from '../components/Captions'
import { COLORS, LEAD_IN_FRAMES } from '../theme'
import type { SceneProps } from './types'

export type Point = { label: string; detail: string; color: string }

/**
 * A title and up to four cards that arrive one by one, each timed to roughly where the narration reaches it.
 * `finale` adds a closing badge under the cards (used for "Verified").
 */
export const PointsScene: React.FC<SceneProps & { points: Point[]; finale?: string }> = ({ scene, speechFrames, points, finale }) => {
  const frame = useCurrentFrame()
  const ease = Easing.bezier(0.16, 1, 0.3, 1)
  // Spread the cards over the first 80% of the speech, after the title.
  const cardStart = (index: number) => LEAD_IN_FRAMES + 20 + Math.round(((speechFrames * 0.8) / points.length) * index)
  const finaleStart = LEAD_IN_FRAMES + Math.round(speechFrames * 0.82)

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: '120px 150px 0', alignItems: 'center' }}>
        <Interactive.Div
          name="Title"
          style={{
            fontSize: 84,
            fontWeight: 800,
            letterSpacing: -2,
            textAlign: 'center',
            opacity: interpolate(frame, [0, 16], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }),
            translate: interpolate(frame, [0, 16], ['0px 24px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }),
          }}
        >
          {scene.title}
        </Interactive.Div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${points.length}, 1fr)`, gap: 32, width: '100%', marginTop: 80 }}>
          {points.map((point, index) => (
            <Interactive.Div
              key={point.label}
              name={`Card ${index + 1}`}
              style={{
                padding: '40px 36px',
                borderRadius: 26,
                background: COLORS.bgRaised,
                border: `1px solid ${COLORS.border}`,
                borderTop: `5px solid ${point.color}`,
                opacity: interpolate(frame, [cardStart(index), cardStart(index) + 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
                translate: interpolate(frame, [cardStart(index), cardStart(index) + 18], ['0px 40px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease }),
              }}
            >
              <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: 3, textTransform: 'uppercase', color: point.color }}>{String(index + 1).padStart(2, '0')}</div>
              <div style={{ fontSize: 46, fontWeight: 800, marginTop: 14, lineHeight: 1.1 }}>{point.label}</div>
              <div style={{ fontSize: 32, color: COLORS.muted, marginTop: 18, lineHeight: 1.4 }}>{point.detail}</div>
            </Interactive.Div>
          ))}
        </div>

        {finale && (
          <Interactive.Div
            name="Finale"
            style={{
              marginTop: 56,
              padding: '18px 44px',
              borderRadius: 999,
              fontSize: 40,
              fontWeight: 800,
              color: COLORS.bg,
              background: COLORS.good,
              boxShadow: '0 16px 50px -12px rgba(52, 211, 153, 0.6)',
              opacity: interpolate(frame, [finaleStart, finaleStart + 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
              scale: interpolate(frame, [finaleStart, finaleStart + 16], [0.7, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({ damping: 12 }), output: 'perceptual-scale' }),
            }}
          >
            {finale}
          </Interactive.Div>
        )}
      </AbsoluteFill>
      <Captions text={scene.narration} speechFrames={speechFrames} bottom={70} />
    </Backdrop>
  )
}
