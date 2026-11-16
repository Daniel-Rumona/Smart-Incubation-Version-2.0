import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
import { LEAD_IN_FRAMES } from '../theme'
import { arrive, DARK, riseStyle, Stage, Words } from './look'
import { PAPER, SCATTERED, type PitchScene } from './script'

type Of<K extends PitchScene['kind']> = Extract<PitchScene, { kind: K }>
type Props<K extends PitchScene['kind']> = { scene: Of<K>; speechFrames: number }

/** The opening line, centred and large; the second half lands in warning orange. */
export const HookScene: React.FC<Props<'hook'>> = ({ scene, speechFrames }) => {
  const second = LEAD_IN_FRAMES + Math.round(speechFrames * 0.5)
  return (
    <Stage light={0}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 18 }}>
        <Words text={scene.lines[0]} start={LEAD_IN_FRAMES} style={{ fontSize: 96, fontWeight: 800, color: DARK.text, letterSpacing: -2.5, justifyContent: 'center' }} />
        <Words text={scene.lines[1]} start={second} highlight={DARK.warn} style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2.5, justifyContent: 'center' }} />
      </div>
    </Stage>
  )
}

/** One of the three problems: a numbered headline on the left, and on the right a picture of the mess. */
export const ProblemScene: React.FC<Props<'problem'>> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  return (
    <Stage light={0}>
      <div style={{ position: 'absolute', left: 130, top: 0, bottom: 0, width: 720, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 26 }}>
        <div style={{ ...riseStyle(frame, 4), color: DARK.warn, fontSize: 26, fontWeight: 700, letterSpacing: 5, textTransform: 'uppercase' }}>
          The problem · {scene.step} of 3
        </div>
        <Words text={scene.headline} start={LEAD_IN_FRAMES} style={{ fontSize: 92, fontWeight: 800, lineHeight: 1.04, color: DARK.text, letterSpacing: -2.5 }} />
      </div>
      <div style={{ position: 'absolute', left: 900, right: 90, top: 120, bottom: 120 }}>
        {scene.motif === 'scattered' && <Scattered speechFrames={speechFrames} />}
        {scene.motif === 'weeks' && <Weeks speechFrames={speechFrames} />}
        {scene.motif === 'paper' && <Paper speechFrames={speechFrames} />}
      </div>
    </Stage>
  )
}

// Where each scattered file sits, and its tilt: deliberately untidy.
const SPOTS: [left: number, top: number, turn: number][] = [
  [0, 10, -5], [450, 60, 4], [50, 260, 3], [470, 330, -4], [0, 530, -2], [440, 600, 5],
]

/** Files and chats arriving one after another, each with its own small problem, drifting apart. */
const Scattered: React.FC<{ speechFrames: number }> = ({ speechFrames }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const gap = (speechFrames * 0.75) / SCATTERED.length
  return (
    <>
      {SCATTERED.map((item, index) => {
        const [left, top, turn] = SPOTS[index]
        const drift = interpolate(frame, [0, durationInFrames], [0, 1])
        return (
          <div
            key={item.title}
            style={{
              position: 'absolute',
              left: left + (index % 2 ? 18 : -18) * drift,
              top: top + (index < 3 ? -14 : 14) * drift,
              rotate: `${turn + (index % 2 ? 1.5 : -1.5) * drift}deg`,
              width: 470,
              padding: '24px 26px',
              borderRadius: 18,
              background: DARK.card,
              border: `1px solid ${DARK.border}`,
              boxShadow: '0 24px 50px -20px rgba(0, 0, 0, 0.8)',
              display: 'flex',
              gap: 18,
              alignItems: 'center',
              ...riseStyle(frame, LEAD_IN_FRAMES + 8 + index * gap, 40),
            }}
          >
            <div style={{ flex: 'none', width: 66, height: 66, borderRadius: 16, background: item.color, color: '#fff', fontSize: 22, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {item.badge}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: DARK.text, fontSize: 27, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
              <div style={{ color: DARK.warn, fontSize: 22, marginTop: 4 }}>{item.note}</div>
            </div>
          </div>
        )
      })}
    </>
  )
}

const CHORES = ['Chasing updates', 'Merging spreadsheets', 'Checking the numbers', 'Rewriting the draft']

/** A report that takes weeks: a day counter ticking up and a progress bar that barely moves. */
const Weeks: React.FC<{ speechFrames: number }> = ({ speechFrames }) => {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  const day = Math.max(1, Math.round(interpolate(frame, [LEAD_IN_FRAMES, durationInFrames - 10], [1, 23], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })))
  const chore = CHORES[Math.min(CHORES.length - 1, Math.floor(interpolate(frame, [LEAD_IN_FRAMES, LEAD_IN_FRAMES + speechFrames], [0, CHORES.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })))]
  const progress = interpolate(frame, [LEAD_IN_FRAMES, durationInFrames], [4, 38], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', ...riseStyle(frame, LEAD_IN_FRAMES + 6, 40) }}>
      <div style={{ padding: '44px 48px', borderRadius: 26, background: DARK.card, border: `1px solid ${DARK.border}` }}>
        <div style={{ color: DARK.muted, fontSize: 26, fontWeight: 600 }}>Quarterly funder report</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18, marginTop: 12 }}>
          <span style={{ color: DARK.text, fontSize: 150, fontWeight: 800, letterSpacing: -5, fontVariantNumeric: 'tabular-nums' }}>Day {day}</span>
        </div>
        <div style={{ height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.08)', marginTop: 26, overflow: 'hidden' }}>
          <div style={{ width: `${progress}%`, height: '100%', borderRadius: 8, background: DARK.warn }} />
        </div>
        <div style={{ color: DARK.warn, fontSize: 28, marginTop: 22 }}>{chore}…</div>
      </div>
    </div>
  )
}

/** Sheets of paper, one per chore, landing on a pile. */
const Paper: React.FC<{ speechFrames: number }> = ({ speechFrames }) => {
  const frame = useCurrentFrame()
  const gap = (speechFrames * 0.7) / PAPER.length
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {PAPER.map((label, index) => {
        const start = LEAD_IN_FRAMES + 6 + index * gap
        const t = arrive(frame, start, 16)
        return (
          <div
            key={label}
            style={{
              position: 'absolute',
              left: 90 + index * 120,
              top: 40 + index * 120,
              width: 470,
              height: 300,
              padding: '34px 36px',
              borderRadius: 10,
              background: '#f3efe4',
              boxShadow: '0 30px 60px -24px rgba(0, 0, 0, 0.85)',
              rotate: `${[-6, 3, -2, 5][index]}deg`,
              opacity: t,
              scale: String(1.25 - 0.25 * t),
              translate: `0px ${(1 - t) * -60}px`,
            }}
          >
            <div style={{ color: '#2b2617', fontSize: 34, fontWeight: 800 }}>{label}</div>
            {[0, 1, 2, 3, 4].map((line) => (
              <div key={line} style={{ height: 10, borderRadius: 5, background: 'rgba(43, 38, 23, 0.14)', marginTop: line ? 18 : 30, width: `${[92, 78, 85, 64, 40][line]}%` }} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
