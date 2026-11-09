import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from 'remotion'
import { Backdrop } from '../components/Backdrop'
import { BrandMark } from '../components/BrandMark'
import { Captions } from '../components/Captions'
import { COLORS } from '../theme'
import type { SceneProps } from './types'

/** Opening and closing card: the mark, the name, one line under it. */
export const TitleScene: React.FC<SceneProps & { eyebrow: string; heading: string; subheading: string }> = ({ scene, speechFrames, eyebrow, heading, subheading }) => {
  const frame = useCurrentFrame()
  const rise = (start: number) => ({
    opacity: interpolate(frame, [start, start + 18], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) }),
    translate: interpolate(frame, [start, start + 18], ['0px 30px', '0px 0px'], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.16, 1, 0.3, 1) }),
  })

  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingBottom: 80 }}>
        <Interactive.Div
          name="Mark"
          style={{
            scale: interpolate(frame, [0, 22], [0.6, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.spring({ damping: 14 }), output: 'perceptual-scale' }),
            opacity: interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' }),
            marginBottom: 44,
          }}
        >
          <BrandMark size={150} />
        </Interactive.Div>
        <Interactive.Div name="Eyebrow" style={{ ...rise(8), fontSize: 30, fontWeight: 600, letterSpacing: 8, textTransform: 'uppercase', color: COLORS.muted, marginBottom: 18 }}>
          {eyebrow}
        </Interactive.Div>
        <Interactive.Div name="Heading" style={{ ...rise(14), fontSize: 132, fontWeight: 800, letterSpacing: -3, lineHeight: 1.02 }}>
          {heading}
        </Interactive.Div>
        <Interactive.Div name="Subheading" style={{ ...rise(24), fontSize: 46, color: COLORS.muted, marginTop: 28, maxWidth: 1300 }}>
          {subheading}
        </Interactive.Div>
      </AbsoluteFill>
      <Captions text={scene.narration} speechFrames={speechFrames} bottom={70} />
    </Backdrop>
  )
}
