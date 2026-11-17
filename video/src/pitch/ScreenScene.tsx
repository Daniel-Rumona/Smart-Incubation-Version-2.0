import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { Captions } from '../components/Captions'
import { fontFamily } from '../theme'
import { Clips } from './FeatureScene'
import type { PitchScene } from './script'

type Screen = Extract<PitchScene, { kind: 'screen' }>

/** The app fills the whole screen and the narration speaks over it. Nothing sits on top except the subtitles: no
 * tag, no headline card (a scene's `tag` and `headline` only name it in the script). */
export const ScreenScene: React.FC<{ scene: Screen; speechFrames: number }> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // A slow push-in, so the screen never sits dead.
  const push = interpolate(frame, [0, durationInFrames], [1, 1.02])

  return (
    <AbsoluteFill style={{ background: '#ffffff', fontFamily, overflow: 'hidden' }}>
      <AbsoluteFill style={{ scale: String(push) }}>
        <Clips clips={scene.clips} />
      </AbsoluteFill>
      {scene.captionsAt === 'top' ? (
        <Captions text={scene.narration} speechFrames={speechFrames} top={150} />
      ) : (
        <Captions text={scene.narration} speechFrames={speechFrames} bottom={34} />
      )}
    </AbsoluteFill>
  )
}
