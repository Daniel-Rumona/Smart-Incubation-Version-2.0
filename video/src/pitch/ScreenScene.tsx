import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { Captions } from '../components/Captions'
import { fontFamily, LEAD_IN_FRAMES } from '../theme'
import { Clips } from './FeatureScene'
import { arrive, riseStyle } from './look'
import type { PitchScene } from './script'

type Screen = Extract<PitchScene, { kind: 'screen' }>

/** The app fills the whole screen and the AI narrates: no split, no side text. On top, only a small tag and headline,
 * subtitles, and the narrator's orb, which moves with the voice. */
export const ScreenScene: React.FC<{ scene: Screen; speechFrames: number }> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const top = scene.captionsAt === 'top'
  // A slow push-in, so the screen never sits dead.
  const push = interpolate(frame, [0, durationInFrames], [1, 1.03])
  // On arrival a band of light sweeps across the screen, and its edge glows in the scene's colour.
  const sweep = interpolate(frame, [2, 26], [-40, 140], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const glow = interpolate(frame, [0, 10, 40], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <AbsoluteFill style={{ background: '#0b0b12', fontFamily, overflow: 'hidden' }}>
      <AbsoluteFill style={{ scale: String(push) }}>
        <Clips clips={scene.clips} />
      </AbsoluteFill>
      <AbsoluteFill style={{ pointerEvents: 'none', background: `linear-gradient(105deg, transparent ${sweep - 14}%, rgba(255,255,255,0.16) ${sweep}%, transparent ${sweep + 14}%)` }} />
      <AbsoluteFill style={{ pointerEvents: 'none', boxShadow: `inset 0 0 0 4px ${scene.color}, inset 0 0 120px ${scene.color}66`, opacity: glow }} />

      {/* The tag and headline: a glass card that lands, then stays small in the corner over the subtitles. */}
      <div style={{ position: 'absolute', left: 40, ...(top ? { top: 96 } : { bottom: 116 }), ...riseStyle(frame, 4, top ? -20 : 20) }}>
        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, padding: '14px 22px 16px', borderRadius: 18, background: 'rgba(11, 11, 18, 0.8)', border: '1px solid rgba(255,255,255,0.12)', boxShadow: `0 20px 50px -20px ${scene.color}aa`, backdropFilter: 'blur(10px)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, fontWeight: 700, letterSpacing: 3, textTransform: 'uppercase', color: tint(scene.color) }}>
            <i style={{ width: 9, height: 9, borderRadius: '50%', background: scene.color, boxShadow: `0 0 12px ${scene.color}` }} />
            {scene.tag}
          </span>
          <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -0.8, color: '#f8fafc' }}>{scene.headline}</span>
        </div>
      </div>

      {top ? (
        <Captions text={scene.narration} speechFrames={speechFrames} top={214} />
      ) : (
        <Captions text={scene.narration} speechFrames={speechFrames} bottom={34} />
      )}

      <Narrator color={scene.color} speechFrames={speechFrames} />
    </AbsoluteFill>
  )
}

/** A lighter version of a tag colour, readable on the dark glass. */
const tint = (color: string) => `color-mix(in srgb, ${color} 55%, white)`

/** The AI narrator: a turning orb of light whose bars move while the voice speaks. */
export const Narrator: React.FC<{ color: string; speechFrames: number }> = ({ color, speechFrames }) => {
  const frame = useCurrentFrame()
  const speaking = frame >= LEAD_IN_FRAMES && frame < LEAD_IN_FRAMES + speechFrames
  const level = arrive(frame, LEAD_IN_FRAMES - 6, 8) * (1 - arrive(frame, LEAD_IN_FRAMES + speechFrames, 10))
  return (
    <div style={{ position: 'absolute', right: 40, bottom: 34, display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px 10px 10px', borderRadius: 99, background: 'rgba(11, 11, 18, 0.8)', border: '1px solid rgba(255,255,255,0.12)', ...riseStyle(frame, 6, 16) }}>
      <div style={{ position: 'relative', width: 46, height: 46 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: `conic-gradient(from ${frame * 6}deg, ${color}, #22d3ee, #f472b6, ${color})`, filter: 'blur(1px)' }} />
        <div style={{ position: 'absolute', inset: 4, borderRadius: '50%', background: '#0b0b12', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
          {[0, 1, 2, 3].map((bar) => {
            const wave = speaking ? 0.35 + 0.65 * Math.abs(Math.sin(frame / (3.2 + bar * 0.7) + bar * 1.7)) : 0.25
            return <i key={bar} style={{ width: 3.5, height: 6 + 16 * wave * level, borderRadius: 2, background: '#f8fafc' }} />
          })}
        </div>
      </div>
      <span style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc', letterSpacing: 0.3 }}>AI narrator</span>
    </div>
  )
}
