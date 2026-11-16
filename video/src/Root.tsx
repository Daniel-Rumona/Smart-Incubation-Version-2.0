import { Composition } from 'remotion'
import { calculatePitchMetadata, Pitch } from './pitch/Pitch'
import { calculateShowcaseMetadata, Showcase } from './Showcase'
import { FPS, HEIGHT, WIDTH } from './theme'

export const RemotionRoot: React.FC = () => (
  <>
  <Composition
    id="Pitch"
    component={Pitch}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    // Replaced by calculatePitchMetadata, which sizes the pitch to its narration.
    durationInFrames={FPS * 240}
    defaultProps={{ speech: {} }}
    calculateMetadata={calculatePitchMetadata}
  />
  <Composition
    id="Showcase"
    component={Showcase}
    width={WIDTH}
    height={HEIGHT}
    fps={FPS}
    // Replaced by calculateShowcaseMetadata, which sizes the video to the narration and recordings.
    durationInFrames={FPS * 200}
    defaultProps={{ timings: {} }}
    calculateMetadata={calculateShowcaseMetadata}
  />
  </>
)
