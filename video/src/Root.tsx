import { Composition } from 'remotion'
import { calculateShowcaseMetadata, Showcase } from './Showcase'
import { FPS, HEIGHT, WIDTH } from './theme'

export const RemotionRoot: React.FC = () => (
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
)
