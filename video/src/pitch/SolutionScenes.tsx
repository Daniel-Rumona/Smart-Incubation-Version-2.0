import { interpolate, useCurrentFrame } from 'remotion'
import { BrandMark } from '../components/BrandMark'
import { LEAD_IN_FRAMES } from '../theme'
import { arrive, LIGHT, riseStyle, SECTION_COLORS, Stage, Words } from './look'
import type { PitchScene } from './script'

type Of<K extends PitchScene['kind']> = Extract<PitchScene, { kind: K }>
type Props<K extends PitchScene['kind']> = { scene: Of<K>; speechFrames: number }

/** At a share of the narration (0–1), in frames from the scene's start. */
const at = (speechFrames: number, share: number) => LEAD_IN_FRAMES + Math.round(speechFrames * share)

/** The turn: the lightbulb in the logo switches on and the dark stage becomes light. */
export const RevealScene: React.FC<Props<'reveal'>> = ({ scene }) => {
  const frame = useCurrentFrame()
  const on = arrive(frame, 10, 10)
  const light = arrive(frame, 16, 22)
  const ring = arrive(frame, 10, 34)
  return (
    <Stage light={light}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'relative', ...riseStyle(frame, 0, 20) }}>
          <div
            style={{
              position: 'absolute', left: '50%', top: '50%', width: 900, height: 900, marginLeft: -450, marginTop: -450, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(167, 139, 250, 0.55), transparent 62%)',
              scale: String(0.2 + ring * 1.1), opacity: 1 - ring * 0.85,
            }}
          />
          <div style={{ filter: `grayscale(${1 - on}) brightness(${0.45 + on * 0.55})` }}>
            <BrandMark size={170} />
          </div>
        </div>
        <Words text={scene.headline} start={30} style={{ marginTop: 56, fontSize: 124, fontWeight: 800, letterSpacing: -4, color: LIGHT.ink, justifyContent: 'center' }} />
        <Words text={scene.tagline} start={46} style={{ marginTop: 14, fontSize: 48, fontWeight: 600, color: LIGHT.accent, justifyContent: 'center' }} />
      </div>
    </Stage>
  )
}

const WORKSPACES = [
  { name: 'Incubation', color: SECTION_COLORS.incubation, line: 'For programmes that grow small businesses', tags: ['Applications', 'Growth plans', 'Interventions', 'Impact and funders'], share: 0.15 },
  { name: 'Training', color: SECTION_COLORS.training, line: 'For providers who train their clients’ staff', tags: ['Classes', 'Tests', 'Certificates', 'Client companies'], share: 0.45 },
]

/** Exactly two workspaces side by side, with the ESG add-on as a bar under both (not a third workspace). */
export const WorkspacesScene: React.FC<Props<'workspaces'>> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const addOn = at(speechFrames, 0.74)
  const reach = arrive(frame, addOn + 6, 16)
  return (
    <Stage light={1}>
      <Words text={scene.headline} start={4} style={{ position: 'absolute', top: 110, left: 0, right: 0, justifyContent: 'center', fontSize: 80, fontWeight: 800, letterSpacing: -2.5, color: LIGHT.ink }} />
      <div style={{ position: 'absolute', top: 290, left: 190, right: 190, display: 'flex', gap: 60 }}>
        {WORKSPACES.map((space) => (
          <div
            key={space.name}
            style={{
              flex: 1, padding: '44px 48px', borderRadius: 30, background: LIGHT.card, border: `1px solid ${LIGHT.border}`,
              borderTop: `10px solid ${space.color}`, boxShadow: '0 40px 80px -40px rgba(21, 18, 31, 0.35)',
              ...riseStyle(frame, at(speechFrames, space.share), 50),
            }}
          >
            <div style={{ fontSize: 64, fontWeight: 800, color: space.color, letterSpacing: -1.5 }}>{space.name}</div>
            <div style={{ fontSize: 30, color: LIGHT.muted, marginTop: 8 }}>{space.line}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 30 }}>
              {space.tags.map((tag) => (
                <span key={tag} style={{ fontSize: 24, fontWeight: 600, color: space.color, background: `${space.color}14`, padding: '8px 18px', borderRadius: 99 }}>{tag}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* The add-on: two short connectors reach up into both workspaces. */}
      {[0.25, 0.75].map((x) => (
        <div key={x} style={{ position: 'absolute', top: 745, left: `calc(190px + (100% - 380px) * ${x})`, width: 4, height: 60 * reach, marginLeft: -2, background: SECTION_COLORS.esg, borderRadius: 2 }} />
      ))}
      <div
        style={{
          position: 'absolute', top: 800, left: 190, right: 190, padding: '26px 40px', borderRadius: 24, background: SECTION_COLORS.esg, color: '#fff',
          display: 'flex', alignItems: 'baseline', gap: 22, ...riseStyle(frame, addOn, 30),
        }}
      >
        <span style={{ fontSize: 40, fontWeight: 800 }}>ESG reporting</span>
        <span style={{ fontSize: 28, fontWeight: 600, opacity: 0.9 }}>An add-on for either workspace</span>
      </div>
    </Stage>
  )
}

// Where in the narration each outcome is said ("less admin", "proof instead of promises", "reports in minutes").
const OUTCOME_SHARES = [0.55, 0.68, 0.82]

/** The three outcomes, each ticked off as it is said. */
export const OutcomesScene: React.FC<Props<'outcomes'>> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  return (
    <Stage light={1}>
      <div style={{ position: 'absolute', left: 260, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 30 }}>
        <div style={{ ...riseStyle(frame, LEAD_IN_FRAMES), fontSize: 30, fontWeight: 700, letterSpacing: 5, textTransform: 'uppercase', color: LIGHT.accent }}>
          The result
        </div>
        <Words text={scene.lead} start={LEAD_IN_FRAMES + 8} style={{ fontSize: 44, fontWeight: 600, color: LIGHT.muted, marginBottom: 14 }} />
        {scene.lines.map((line, index) => {
          const start = at(speechFrames, OUTCOME_SHARES[index] ?? 0.9) - 6
          const tick = arrive(frame, start + 4, 12)
          return (
            <div key={line} style={{ display: 'flex', alignItems: 'center', gap: 34, ...riseStyle(frame, start, 36) }}>
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: LIGHT.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', scale: String(0.6 + 0.4 * tick) }}>
                <svg width={46} height={46} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray={24} strokeDashoffset={24 * (1 - tick)} />
                </svg>
              </div>
              <span style={{ fontSize: 96, fontWeight: 800, letterSpacing: -3, color: LIGHT.ink }}>{line}</span>
            </div>
          )
        })}
      </div>
    </Stage>
  )
}

/** The last frame people see: the name, the promise, and what to do next. */
export const CloseScene: React.FC<Props<'close'>> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const pulse = interpolate(Math.sin(frame / 9), [-1, 1], [0, 1])
  return (
    <Stage light={1}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={riseStyle(frame, 2, 30)}>
          <BrandMark size={140} />
        </div>
        <Words text={scene.headline} start={10} style={{ marginTop: 46, fontSize: 116, fontWeight: 800, letterSpacing: -4, color: LIGHT.ink, justifyContent: 'center' }} />
        <Words text={scene.tagline} start={at(speechFrames, 0.2)} style={{ marginTop: 10, fontSize: 46, fontWeight: 600, color: LIGHT.accent, justifyContent: 'center' }} />
        <div
          style={{
            marginTop: 64, padding: '24px 58px', borderRadius: 99, background: LIGHT.accent, color: '#fff', fontSize: 40, fontWeight: 700,
            boxShadow: `0 ${18 + pulse * 10}px ${40 + pulse * 20}px -16px rgba(124, 58, 237, ${0.45 + pulse * 0.2})`,
            ...riseStyle(frame, at(speechFrames, 0.55), 30),
          }}
        >
          {scene.action}
        </div>
      </div>
    </Stage>
  )
}
