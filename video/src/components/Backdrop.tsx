import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { COLORS, fontFamily } from '../theme'

/** The dark stage every scene sits on: two slow-drifting accent glows. */
export const Backdrop: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()

  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.bg, fontFamily, color: COLORS.text, overflow: 'hidden' }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at 50% 50%, ${COLORS.accentSoft}, transparent 60%)`,
          width: 1400,
          height: 1400,
          translate: interpolate(frame, [0, durationInFrames], ['-420px -520px', '-300px -460px']),
        }}
      />
      <AbsoluteFill
        style={{
          background: 'radial-gradient(circle at 50% 50%, rgba(96, 165, 250, 0.14), transparent 60%)',
          width: 1300,
          height: 1300,
          left: 'auto',
          top: 'auto',
          right: 0,
          bottom: 0,
          translate: interpolate(frame, [0, durationInFrames], ['520px 560px', '420px 480px']),
        }}
      />
      {children}
    </AbsoluteFill>
  )
}
