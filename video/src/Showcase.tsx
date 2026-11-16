import { Audio } from '@remotion/media'
import { linearTiming, TransitionSeries } from '@remotion/transitions'
import { fade } from '@remotion/transitions/fade'
import { ALL_FORMATS, Input, UrlSource } from 'mediabunny'
import { Fragment } from 'react'
import { CalculateMetadataFunction, Sequence, staticFile } from 'remotion'
import { SCENES, type Scene, type Tone } from './script'
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

// A product scene keeps showing its live footage after the narration ends, up to this much longer, so the last
// action lands before the fade. record.mjs times each shot to its narration, so this is a small margin.
const MAX_FOOTAGE_OVERRUN_FRAMES = 3 * FPS

export const sceneFrames = (timing: Timing) => {
  const spoken = LEAD_IN_FRAMES + timing.speechFrames + TAIL_FRAMES
  if (!timing.footageFrames) return spoken
  return Math.max(spoken, Math.min(timing.footageFrames, spoken + MAX_FOOTAGE_OVERRUN_FRAMES))
}

const TONES: Record<Tone, string> = { info: COLORS.info, warn: COLORS.warn, good: COLORS.good, accent: COLORS.accent }

const renderScene = (scene: Scene, timing: Timing) => {
  const props = { scene, speechFrames: timing.speechFrames, footageFrames: timing.footageFrames }
  switch (scene.kind) {
    case 'title':
    case 'chapter':
      return <TitleScene {...props} eyebrow={scene.eyebrow ?? ''} heading={scene.title} subheading={scene.subheading ?? ''} compact={scene.kind === 'chapter'} />
    case 'points':
      return <PointsScene {...props} points={(scene.points ?? []).map((point) => ({ label: point.label, detail: point.detail, color: TONES[point.tone] }))} />
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
