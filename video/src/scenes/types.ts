import type { Scene } from '../script'

export type SceneProps = {
  scene: Scene
  /** Length of the narration, in frames. */
  speechFrames: number
  /** Length of the scene's live recording, in frames, when it has one. */
  footageFrames?: number
}
