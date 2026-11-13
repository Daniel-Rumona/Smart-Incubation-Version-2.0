import { Audio } from '@remotion/media'
import { linearTiming, TransitionSeries } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { Fragment } from 'react'
import { CalculateMetadataFunction, Sequence, staticFile } from 'remotion'
import { SCENES, type Scene } from './script'
import { FootageScene } from './scenes/FootageScene'
import { PointsScene } from './scenes/PointsScene'
import { TitleScene } from './scenes/TitleScene'
import { COLORS, FPS, LEAD_IN_FRAMES, TAIL_FRAMES, TRANSITION_FRAMES } from './theme'

export type Timing = { speechFrames: number; footageFrames?: number; hasAudio: boolean }
export type ShowcaseProps = { timings: Record<string, Timing> }

const durationOf = async (file: string) => {
  const input = new Input({ formats: ALL_FORMATS, source: new UrlSource(staticFile(file)) })
  return input.computeDuration()
}

// Before the narration exists (or if a clip is missing), scenes are sized from the script at ~2.6 words a second.
const estimateFrames = (text: string) => Math.ceil((text.split(/\s+/).length / 2.6) * FPS)

export const calculateShowcaseMetadata: CalculateMetadataFunction<ShowcaseProps> = async () => {
  const entries = await Promise.all(
    SCENES.map(async (scene): Promise<[string, Timing]> => {
      const audio = await durationOf(`voiceover/${scene.id}.mp3`).catch(() => null)
      const footage = scene.footage ? await durationOf(`recordings/${scene.footage}.mp4`).catch(() => null) : null
      return [scene.id, {
        speechFrames: audio ? Math.ceil(audio * FPS) : estimateFrames(scene.narration),
        footageFrames: footage ? Math.floor(footage * FPS) : undefined,
        hasAudio: audio !== null,
      }]
    }),
  )
  const timings = Object.fromEntries(entries)
  const total = SCENES.reduce((sum, scene) => sum + sceneFrames(timings[scene.id]), 0) - TRANSITION_FRAMES * (SCENES.length - 1)
  return { durationInFrames: total, props: { timings } }
}

// A product scene keeps showing its live footage after the narration ends, up to this much longer, so viewers
// see the screen in use rather than cutting away the moment the voice stops.
const MAX_FOOTAGE_OVERRUN_FRAMES = 15 * FPS

export const sceneFrames = (timing: Timing) => {
  const spoken = LEAD_IN_FRAMES + timing.speechFrames + TAIL_FRAMES
  if (!timing.footageFrames) return spoken
  return Math.max(spoken, Math.min(timing.footageFrames, spoken + MAX_FOOTAGE_OVERRUN_FRAMES))
}

const renderScene = (scene: Scene, timing: Timing) => {
  const props = { scene, speechFrames: timing.speechFrames, footageFrames: timing.footageFrames }
  switch (scene.id) {
    case 'intro':
      return <TitleScene {...props} eyebrow="Incubation, measured" heading="Smart Incubation" subheading="One platform, from application to impact." />
    case 'close':
      return <TitleScene {...props} eyebrow="Smart Incubation" heading="Support you can measure" subheading="Run one cohort, and see the results in your own data." />
    case 'method':
      return (
        <PointsScene
          {...props}
          points={[
            { label: 'Record', detail: 'Every SME captured the same way, with a baseline.', color: COLORS.info },
            { label: 'Track', detail: 'Every intervention, its status and what it is waiting on.', color: COLORS.warn },
            { label: 'Verify', detail: 'Outcomes checked, and compared against others.', color: COLORS.good },
          ]}
        />
      )
    case 'verified':
      return (
        <PointsScene
          {...props}
          finale="Outcome verified"
          points={[
            { label: 'Evidence', detail: 'No intervention reaches 100% without it.', color: COLORS.info },
            { label: 'Facilitator', detail: 'Reports the outcome on its own.', color: COLORS.accent },
            { label: 'SME', detail: 'Answers separately, without seeing the facilitator’s answer.', color: COLORS.warn },
          ]}
        />
      )
    case 'honest':
      return (
        <PointsScene
          {...props}
          points={[
            { label: 'Observation, not proof', detail: 'A facilitator’s answer is recorded for what it is.', color: COLORS.accent },
            { label: 'Comparison, not cause', detail: 'Impact figures say what they can show.', color: COLORS.good },
          ]}
        />
      )
    default:
      return <FootageScene {...props} />
  }
}

/** The whole showcase: one scene per narration clip, faded together, each scene as long as its narration. */
export const Showcase: React.FC<ShowcaseProps> = ({ timings }) => (
  <TransitionSeries>
    {SCENES.map((scene, index) => {
      const timing = timings[scene.id]
      return (
        <Fragment key={scene.id}>
          {index > 0 && <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })} />}
          <TransitionSeries.Sequence name={scene.title} durationInFrames={sceneFrames(timing)}>
            {renderScene(scene, timing)}
            {timing.hasAudio && (
              <Sequence from={LEAD_IN_FRAMES} name="Narration">
                <Audio src={staticFile(`voiceover/${scene.id}.mp3`)} />
              </Sequence>
            )}
          </TransitionSeries.Sequence>
        </Fragment>
      )
    })}
  </TransitionSeries>
)
