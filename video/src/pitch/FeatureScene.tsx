import { Video } from '@remotion/media'
import { AbsoluteFill, Freeze, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { FPS, LEAD_IN_FRAMES } from '../theme'
import { arrive, LIGHT, riseStyle, SECTION_COLORS, Stage, Words } from './look'
import { SECTION_LABELS, type Clip, type PitchScene } from './script'

type Feature = Extract<PitchScene, { kind: 'feature' }>

const SCREEN_WIDTH = 1150
const SCREEN_HEIGHT = Math.round((SCREEN_WIDTH * 9) / 16)
const CROSSFADE = 10
// A clip plays at between 0.6x and 2.2x so it fills its share of the scene; past that it holds its last frame.
const MIN_RATE = 0.6
const MAX_RATE = 2.2

/** One feature in one beat: what it is (left) and the app doing it (right). No step-by-step, no field names. */
export const FeatureScene: React.FC<{ scene: Feature; speechFrames: number; number: number; total: number }> = ({ scene, speechFrames, number, total }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const color = SECTION_COLORS[scene.section]
  const tilt = interpolate(frame, [0, durationInFrames], [-9, -3])

  return (
    <Stage light={1}>
      <div style={{ position: 'absolute', left: 100, top: 0, bottom: 0, width: 590, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, ...riseStyle(frame, 2) }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: color }} />
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color }}>{SECTION_LABELS[scene.section]}</span>
          <span style={{ fontSize: 24, fontWeight: 600, color: LIGHT.muted, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {String(number).padStart(2, '0')} / {String(total).padStart(2, '0')}
          </span>
        </div>
        <Words text={scene.headline} start={8} style={{ marginTop: 26, fontSize: 66, fontWeight: 800, lineHeight: 1.06, letterSpacing: -2, color: LIGHT.ink }} />
        <div style={{ marginTop: 44, display: 'flex', flexDirection: 'column', gap: 22 }}>
          {scene.bullets.map((bullet, index) => {
            const start = LEAD_IN_FRAMES + Math.round(speechFrames * (0.15 + index * 0.25))
            return (
              <div key={bullet} style={{ display: 'flex', alignItems: 'center', gap: 18, ...riseStyle(frame, start, 20) }}>
                <span style={{ flex: 'none', width: 38, height: 38, borderRadius: 12, background: `${color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </span>
                <span style={{ fontSize: 30, fontWeight: 600, color: LIGHT.ink }}>{bullet}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div style={{ position: 'absolute', right: 56, top: (1080 - SCREEN_HEIGHT - 34) / 2, perspective: 2200 }}>
        <div
          style={{
            width: SCREEN_WIDTH, borderRadius: 22, overflow: 'hidden', background: '#11111a',
            boxShadow: `0 60px 120px -50px rgba(21, 18, 31, 0.6), 0 0 0 1px rgba(21, 18, 31, 0.08), 0 30px 80px -40px ${color}88`,
            transform: `rotateY(${tilt}deg) rotateX(2deg)`, transformOrigin: '0% 50%',
            ...riseStyle(frame, 0, 60),
          }}
        >
          <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16, background: '#1b1b27' }}>
            {['#ff5f57', '#febc2e', '#28c840'].map((dot) => <i key={dot} style={{ width: 11, height: 11, borderRadius: '50%', background: dot, opacity: 0.85 }} />)}
          </div>
          <div style={{ position: 'relative', width: SCREEN_WIDTH, height: SCREEN_HEIGHT, overflow: 'hidden' }}>
            <Clips clips={scene.clips} />
          </div>
        </div>
      </div>
    </Stage>
  )
}

/** The scene's clips one after another, each given an equal share of the scene and crossfaded into the next. */
const Clips: React.FC<{ clips: Clip[] }> = ({ clips }) => {
  const { durationInFrames } = useVideoConfig()
  const slot = Math.floor(durationInFrames / clips.length)
  return (
    <>
      {clips.map((clip, index) => {
        const last = index === clips.length - 1
        const from = Math.max(0, index * slot - (index ? CROSSFADE : 0))
        const length = last ? durationInFrames - from : slot + (index ? CROSSFADE : 0)
        return (
          <Sequence key={index} from={from} durationInFrames={length} layout="absolute-fill">
            <ClipPlayer clip={clip} fadeIn={index > 0} />
          </Sequence>
        )
      })}
    </>
  )
}

const ClipPlayer: React.FC<{ clip: Clip; fadeIn: boolean }> = ({ clip, fadeIn }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const sourceFrames = Math.round((clip.to - clip.from) * FPS)
  const rate = Math.min(MAX_RATE, Math.max(MIN_RATE, sourceFrames / durationInFrames))
  const played = Math.min(durationInFrames, Math.floor(sourceFrames / rate))
  const [x, y, zoom] = clip.focus ?? [0.5, 0.5, 1.04]
  // A slow push in towards the point of interest, so even a still screen keeps moving.
  const scale = interpolate(frame, [0, durationInFrames], [Math.max(1, zoom * 0.92), zoom])
  const video = <Video src={staticFile(`recordings/${clip.src}.mp4`)} muted trimBefore={Math.round(clip.from * FPS)} trimAfter={Math.round(clip.to * FPS)} playbackRate={rate} style={{ width: '100%', height: '100%' }} />

  return (
    <AbsoluteFill style={{ opacity: fadeIn ? arrive(frame, 0, CROSSFADE) : 1, background: '#11111a' }}>
      <AbsoluteFill style={{ scale: String(scale), transformOrigin: `${x * 100}% ${y * 100}%` }}>
        <Sequence durationInFrames={played} layout="absolute-fill">{video}</Sequence>
        {played < durationInFrames && (
          <Sequence from={played} layout="absolute-fill">
            <Freeze frame={played - 1}>{video}</Freeze>
          </Sequence>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
