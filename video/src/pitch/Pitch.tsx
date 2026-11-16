import { Audio } from '@remotion/media'
import { linearTiming, TransitionSeries } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { Fragment } from 'react'
import { CalculateMetadataFunction, Sequence, staticFile } from 'remotion'
import { FPS, LEAD_IN_FRAMES, TAIL_FRAMES } from '../theme'
import { ChapterScene, NotificationsScene } from './ChannelScenes'
import { FeatureScene } from './FeatureScene'
import { HookScene, ProblemScene } from './ProblemScenes'
import { PITCH, type PitchScene } from './script'
import { CloseScene, OutcomesScene, RevealScene, WorkspacesScene } from './SolutionScenes'

export type PitchProps = { speech: Record<string, number> }

const TRANSITION = 12
// The reveal and the close hold a little longer after the voice, so the logo and the call to action can land.
// A chapter card has no narration: it is just this hold, under two seconds.
const HOLD: Partial<Record<PitchScene['kind'], number>> = { reveal: 24, close: 60, outcomes: 18, hook: 10, chapter: 26, notifications: 20 }

const voiceFile = (id: string) => `voiceover/pitch/${id}.mp3`
// Until the narration is generated, scenes are sized from the script at about 2.5 words a second.
const estimate = (text: string) => (text ? Math.ceil((text.split(/\s+/).length / 2.5) * FPS) : 0)

const sceneFrames = (scene: PitchScene, speech: number) => LEAD_IN_FRAMES + speech + TAIL_FRAMES + (HOLD[scene.kind] ?? 0)

export const calculatePitchMetadata: CalculateMetadataFunction<PitchProps> = async () => {
  const speech = Object.fromEntries(
    await Promise.all(
      PITCH.map(async (scene) => {
        if (!scene.narration) return [scene.id, 0] as const
        const seconds = await new Input({ formats: ALL_FORMATS, source: new UrlSource(staticFile(voiceFile(scene.id))) }).computeDuration().catch(() => null)
        return [scene.id, seconds ? Math.ceil(seconds * FPS) : -estimate(scene.narration)] as const
      }),
    ),
  )
  const total = PITCH.reduce((sum, scene) => sum + sceneFrames(scene, Math.abs(speech[scene.id])), 0) - TRANSITION * (PITCH.length - 1)
  return { durationInFrames: total, props: { speech } }
}

const render = (scene: PitchScene, speechFrames: number) => {
  switch (scene.kind) {
    case 'hook': return <HookScene scene={scene} speechFrames={speechFrames} />
    case 'problem': return <ProblemScene scene={scene} speechFrames={speechFrames} />
    case 'reveal': return <RevealScene scene={scene} speechFrames={speechFrames} />
    case 'workspaces': return <WorkspacesScene scene={scene} speechFrames={speechFrames} />
    case 'chapter': return <ChapterScene scene={scene} />
    case 'feature': return <FeatureScene scene={scene} speechFrames={speechFrames} />
    case 'notifications': return <NotificationsScene scene={scene} speechFrames={speechFrames} />
    case 'outcomes': return <OutcomesScene scene={scene} speechFrames={speechFrames} />
    case 'close': return <CloseScene scene={scene} speechFrames={speechFrames} />
  }
}

/** The pitch: problem, solution, key features, outcome. Each scene is as long as its narration (`speech`, in frames;
 * negative while the clip is missing and the length is an estimate). */
export const Pitch: React.FC<PitchProps> = ({ speech }) => (
  <TransitionSeries>
    {PITCH.map((scene, index) => {
      const spoken = speech[scene.id] ?? -estimate(scene.narration)
      return (
        <Fragment key={scene.id}>
          {index > 0 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />}
          <TransitionSeries.Sequence name={scene.id} durationInFrames={sceneFrames(scene, Math.abs(spoken))}>
            {render(scene, Math.abs(spoken))}
            {spoken > 0 && (
              <Sequence from={LEAD_IN_FRAMES} name="Narration">
                <Audio src={staticFile(voiceFile(scene.id))} />
              </Sequence>
            )}
          </TransitionSeries.Sequence>
        </Fragment>
      )
    })}
  </TransitionSeries>
)
