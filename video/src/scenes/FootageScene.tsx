import { Video } from '@remotion/media'
import { AbsoluteFill, Easing, Freeze, Img, Interactive, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { Backdrop } from '../components/Backdrop'
import { Captions } from '../components/Captions'
import { COLORS } from '../theme'
import type { SceneProps } from './types'

// Which screen each recording shows, and the still to fall back on before it has been recorded.
const SCREENS: Record<string, { label: string; still: string }> = {
  applications: { label: 'Applications', still: 'applications.jpg' },
  diagnostic: { label: 'Diagnostic Growth Plan', still: 'diagnostic-plan.jpg' },
  monitoring: { label: 'Intervention monitoring', still: 'monitoring.jpg' },
  readiness: { label: 'SME Control Tower', still: 'control-tower.jpg' },
  kpis: { label: 'Programme KPIs', still: 'kpis.jpg' },
  impact: { label: 'Impact analysis', still: 'impact.jpg' },
}

// The recording sits in a browser-style frame at 80% of full size, leaving a header above and captions below.
const FRAME_WIDTH = 1536
const FRAME_HEIGHT = 864
const FRAME_TOP = 118

/** A live recording of one screen of the app, titled, with the narration as captions. */
export const FootageScene: React.FC<SceneProps> = ({ scene, speechFrames, footageFrames }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const screen = SCREENS[scene.footage ?? ''] ?? { label: scene.title, still: '' }
  const src = staticFile(`recordings/${scene.footage}.mp4`)

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
          <span style={{ fontSize: 26, fontWeight: 600, color: COLORS.accent, letterSpacing: 3, textTransform: 'uppercase' }}>{screen.label}</span>
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
                <Sequence durationInFrames={footageFrames} layout="absolute-fill">
                  <Video src={src} muted style={{ width: '100%', height: '100%' }} />
                </Sequence>
                {footageFrames < durationInFrames && (
                  <Sequence from={footageFrames} layout="absolute-fill">
                    <Freeze frame={footageFrames - 1}>
                      <Video src={src} muted style={{ width: '100%', height: '100%' }} />
                    </Freeze>
                  </Sequence>
                )}
              </>
            ) : (
              screen.still && (
                <Img
                  src={staticFile(screen.still)}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    objectPosition: 'top',
                    scale: interpolate(frame, [0, durationInFrames], [1, 1.06], { extrapolateRight: 'clamp' }),
                  }}
                />
              )
            )}
          </div>
        </Interactive.Div>
      </AbsoluteFill>
      <Captions text={scene.narration} speechFrames={speechFrames} bottom={22} />
    </Backdrop>
  )
}
