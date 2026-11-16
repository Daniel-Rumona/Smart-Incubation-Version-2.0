import { Video } from '@remotion/media'
import { AbsoluteFill, Easing, Freeze, Interactive, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Backdrop } from '../components/Backdrop'
import { Captions } from '../components/Captions'
import { COLORS } from '../theme'
import type { SceneProps } from './types'

// The recording sits in a browser-style frame at 80% of full size, leaving a header above and captions below.
const FRAME_WIDTH = 1536
const FRAME_HEIGHT = 864
const FRAME_TOP = 118
const MAX_PLAYBACK_RATE = 1.5

/** A live recording of the app, titled with who is signed in, with the narration as captions. Until the shot is
 * recorded (node record.mjs <shot>), the frame shows which shot is missing. */
export const FootageScene: React.FC<SceneProps> = ({ scene, speechFrames, footageFrames }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const src = staticFile(`recordings/${scene.footage}.mp4`)
  // A recording longer than its scene plays a little faster (at most 1.5x) so its last action still shows; one
  // that is longer still is cut at the scene's end.
  const rate = footageFrames ? Math.min(MAX_PLAYBACK_RATE, Math.max(1, footageFrames / durationInFrames)) : 1
  const playedFrames = footageFrames ? Math.min(durationInFrames, Math.ceil(footageFrames / rate)) : 0

  return (
    <Backdrop>
      <AbsoluteFill style={{ padding: `0 ${(1920 - FRAME_WIDTH) / 2}px` }}>
        <Interactive.Div
          name="Header"
          style={{
            position: 'absolute',
            top: 34,
            left: (1920 - FRAME_WIDTH) / 2,
            display: 'flex',
            alignItems: 'baseline',
            gap: 22,
            opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            translate: interpolate(frame, [0, 14], ['0px -12px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) }),
          }}
        >
          <span style={{ fontSize: 50, fontWeight: 800, letterSpacing: -1 }}>{scene.title}</span>
          <span style={{ fontSize: 26, fontWeight: 600, color: COLORS.accent, letterSpacing: 3, textTransform: 'uppercase' }}>{scene.role}</span>
        </Interactive.Div>

        <Interactive.Div
          name="Screen"
          style={{
            position: 'absolute',
            top: FRAME_TOP,
            left: (1920 - FRAME_WIDTH) / 2,
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT + 34,
            borderRadius: 18,
            overflow: 'hidden',
            border: `1px solid ${COLORS.border}`,
            background: COLORS.bgRaised,
            boxShadow: '0 40px 90px -30px rgba(139, 92, 246, 0.45), 0 18px 40px -20px rgba(0, 0, 0, 0.7)',
            opacity: interpolate(frame, [4, 20], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
            scale: interpolate(frame, [4, 24], [0.97, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1), output: 'perceptual-scale' }),
          }}
        >
          <div style={{ height: 34, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16, borderBottom: `1px solid ${COLORS.border}` }}>
            {[0, 1, 2].map((dot) => <i key={dot} style={{ width: 11, height: 11, borderRadius: '50%', background: 'rgba(255,255,255,0.16)' }} />)}
          </div>
          <div style={{ position: 'relative', width: FRAME_WIDTH, height: FRAME_HEIGHT, overflow: 'hidden' }}>
            {footageFrames ? (
              <>
                {/* Play the recording, then hold its last frame if the narration runs longer. */}
                <Sequence durationInFrames={playedFrames} layout="absolute-fill">
                  <Video src={src} muted playbackRate={rate} style={{ width: '100%', height: '100%' }} />
                </Sequence>
                {playedFrames < durationInFrames && (
                  <Sequence from={playedFrames} layout="absolute-fill">
                    <Freeze frame={playedFrames - 1}>
                      <Video src={src} muted playbackRate={rate} style={{ width: '100%', height: '100%' }} />
                    </Freeze>
                  </Sequence>
                )}
              </>
            ) : (
              <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', color: COLORS.muted, fontSize: 36 }}>
                Not recorded yet: node record.mjs {scene.footage}
              </AbsoluteFill>
            )}
          </div>
        </Interactive.Div>
      </AbsoluteFill>
      <Captions text={scene.subtitles ?? scene.narration} speechFrames={speechFrames} bottom={22} />
    </Backdrop>
  )
}
