import { Video } from '@remotion/media'
import { AbsoluteFill, Freeze, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { FPS, LEAD_IN_FRAMES } from '../theme'
import { arrive, LIGHT, riseStyle, SECTION_COLORS, Stage, Words } from './look'
import { SECTION_LABELS, type Clip, type PitchScene } from './script'

type Feature = Extract<PitchScene, { kind: 'feature' }>

// The app's screen, shown whole: a 16:9 window as large as the frame allows beside the text column.
export const SCREEN_WIDTH = 1240
export const SCREEN_HEIGHT = Math.round((SCREEN_WIDTH * 9) / 16)
const CROSSFADE = 10
// A clip plays at between 0.6x and 2x so it fills its share of the scene; past that it holds its last frame.
const MIN_RATE = 0.6
const MAX_RATE = 2

/** One feature in one beat: what it is (left) and the app doing it (right). No step-by-step, no field names. */
export const FeatureScene: React.FC<{ scene: Feature; speechFrames: number }> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const color = SECTION_COLORS[scene.section]

  return (
    <Stage light={1}>
      <div style={{ position: 'absolute', left: 80, top: 0, bottom: 0, width: 520, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...riseStyle(frame, 2) }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: color }} />
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color }}>{SECTION_LABELS[scene.section]}</span>
        </div>
        <Words text={scene.headline} start={8} style={{ marginTop: 24, fontSize: 62, fontWeight: 800, lineHeight: 1.06, letterSpacing: -2, color: LIGHT.ink }} />
        <div style={{ marginTop: 40, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {scene.bullets.map((bullet, index) => {
            const start = LEAD_IN_FRAMES + Math.round(speechFrames * (0.15 + index * 0.25))
            return (
              <div key={bullet} style={{ display: 'flex', alignItems: 'center', gap: 16, ...riseStyle(frame, start, 20) }}>
                <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 11, background: `${color}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                </span>
                <span style={{ fontSize: 28, fontWeight: 600, color: LIGHT.ink, lineHeight: 1.25 }}>{bullet}</span>
              </div>
            )
          })}
        </div>
      </div>

      <AppWindow color={color} style={{ position: 'absolute', right: 50, top: (1080 - SCREEN_HEIGHT - 34) / 2 }}>
        <Clips clips={scene.clips} />
      </AppWindow>
    </Stage>
  )
}

/** A plain browser-style window around the footage: it floats in, then drifts very slightly so it never sits dead. */
export const AppWindow: React.FC<{ color: string; width?: number; style?: React.CSSProperties; children: React.ReactNode }> = ({ color, width = SCREEN_WIDTH, style, children }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const height = Math.round((width * 9) / 16)
  const drift = interpolate(frame, [0, durationInFrames], [6, -6])
  return (
    <div style={{ ...style, translate: `0px ${drift}px` }}>
      <div
        style={{
          width, borderRadius: 18, overflow: 'hidden', background: '#11111a',
          boxShadow: `0 50px 100px -45px rgba(21, 18, 31, 0.55), 0 0 0 1px rgba(21, 18, 31, 0.08), 0 30px 80px -40px ${color}88`,
          ...riseStyle(frame, 0, 50),
        }}
      >
        <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16, background: '#1b1b27' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((dot) => <i key={dot} style={{ width: 11, height: 11, borderRadius: '50%', background: dot, opacity: 0.85 }} />)}
        </div>
        <div style={{ position: 'relative', width, height, overflow: 'hidden' }}>{children}</div>
      </div>
    </div>
  )
}

/** The scene's clips one after another, each given a share of the scene in proportion to its length (so the whole
 * scene plays at one even pace), and crossfaded into the next. */
export const Clips: React.FC<{ clips: Clip[] }> = ({ clips }) => {
  const { durationInFrames } = useVideoConfig()
  const lengths = clips.map((clip) => Math.max(0.1, clip.to - clip.from))
  const total = lengths.reduce((sum, length) => sum + length, 0)
  const starts = lengths.map((_, index) => Math.round((durationInFrames * lengths.slice(0, index).reduce((sum, length) => sum + length, 0)) / total))
  return (
    <>
      {clips.map((clip, index) => {
        const last = index === clips.length - 1
        const from = Math.max(0, starts[index] - (index ? CROSSFADE : 0))
        const length = last ? durationInFrames - from : starts[index + 1] - from
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
  const video = <Video src={staticFile(`recordings/${clip.src}.mp4`)} muted trimBefore={Math.round(clip.from * FPS)} trimAfter={Math.round(clip.to * FPS)} playbackRate={rate} style={{ width: '100%', height: '100%' }} />
  // An optional push-in on one point of the screen, over the middle of the clip.
  const zoom = clip.zoom ? 1 + (clip.zoom.scale - 1) * arrive(frame, Math.round(durationInFrames * 0.2), Math.round(durationInFrames * 0.3)) : 1

  return (
    <AbsoluteFill style={{ opacity: fadeIn ? arrive(frame, 0, CROSSFADE) : 1, background: '#ffffff', scale: String(zoom), transformOrigin: clip.zoom ? `${clip.zoom.x * 100}% ${clip.zoom.y * 100}%` : undefined }}>
      <Sequence durationInFrames={played} layout="absolute-fill">{video}</Sequence>
      {played < durationInFrames && (
        <Sequence from={played} layout="absolute-fill">
          <Freeze frame={played - 1}>{video}</Freeze>
        </Sequence>
      )}
    </AbsoluteFill>
  )
}
