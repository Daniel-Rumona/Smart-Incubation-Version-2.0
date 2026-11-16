import { interpolate, Sequence, useCurrentFrame, useVideoConfig } from 'remotion'
import { LEAD_IN_FRAMES } from '../theme'
import { AppWindow, Clips } from './FeatureScene'
import { arrive, LIGHT, riseStyle, SECTION_COLORS, Stage, Words } from './look'
import { SECTION_LABELS, type PitchScene } from './script'

type Of<K extends PitchScene['kind']> = Extract<PitchScene, { kind: K }>

/** A short silent card between parts: the part's colour wipes across and its name lands in white. */
export const ChapterScene: React.FC<{ scene: Of<'chapter'> }> = ({ scene }) => {
  const frame = useCurrentFrame()
  const wipe = arrive(frame, 0, 14)
  const color = SECTION_COLORS[scene.section]
  return (
    <Stage light={1}>
      <div style={{ position: 'absolute', inset: 0, background: color, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}>
        <div style={{ position: 'absolute', left: 160, top: 0, bottom: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <Words text={scene.headline} start={8} style={{ fontSize: 150, fontWeight: 800, letterSpacing: -5, color: '#fff' }} />
          <Words text={scene.line} start={16} style={{ marginTop: 12, fontSize: 46, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }} />
        </div>
      </div>
    </Stage>
  )
}

// The demo data the notifications show (scripts/seed-emulators-incubators.mjs), worded exactly as the system words
// them: the email is deadlineDigest.ts's buildEmail, the WhatsApp check-back and its reply are smeCheckbacks.ts and
// whatsappBot.ts.
const EMAIL_ROWS = [
  { title: 'Business Plan Refresh', sme: 'Ubuntu Harvest', who: 'Nomsa Consultant', when: '3 days overdue', overdue: true },
  { title: 'Marketing Strategy Development', sme: 'Ubuntu Harvest', who: 'Nomsa Consultant', when: 'due in 2 days', overdue: false },
  { title: 'Sales Pipeline Coaching', sme: 'Ilanga Solar Farms', who: 'Kagiso Consultant', when: 'due in 4 days', overdue: false },
]

/** At a share of the narration (0–1), in frames from the scene's start. */
const at = (speechFrames: number, share: number) => LEAD_IN_FRAMES + Math.round(speechFrames * share)

const Label: React.FC<{ text: string; color: string; style?: React.CSSProperties }> = ({ text, color, style }) => (
  <div style={{ position: 'absolute', zIndex: 2, padding: '10px 20px', borderRadius: 99, background: color, color: '#fff', fontSize: 24, fontWeight: 700, boxShadow: '0 12px 30px -12px rgba(0,0,0,0.45)', ...style }}>{text}</div>
)

/** The same reminder reaching people three ways: the bell in the app (live footage), an email, and WhatsApp. */
export const NotificationsScene: React.FC<{ scene: Of<'notifications'>; speechFrames: number }> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const app = at(speechFrames, 0.2)
  const email = at(speechFrames, 0.36)
  const phone = at(speechFrames, 0.44)
  const tap = at(speechFrames, 0.66)
  const language = at(speechFrames, 0.8)
  return (
    <Stage light={1}>
      <div style={{ position: 'absolute', left: 80, top: 64 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...riseStyle(frame, 2) }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: SECTION_COLORS.platform }} />
          <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color: SECTION_COLORS.platform }}>{SECTION_LABELS.platform}</span>
        </div>
        <Words text={scene.headline} start={6} style={{ marginTop: 14, fontSize: 62, fontWeight: 800, letterSpacing: -2, color: LIGHT.ink }} />
      </div>

      {/* The footage starts when the window arrives, not when the scene does. */}
      <Sequence from={app} layout="none">
        <div style={{ position: 'absolute', left: 60, top: 330 }}>
          <Label text="In the app" color={SECTION_COLORS.platform} style={{ left: -14, top: -22, ...riseStyle(frame, app + 6) }} />
          <AppWindow color={SECTION_COLORS.platform} width={820}>
            <Clips clips={scene.clips} />
          </AppWindow>
        </div>
      </Sequence>

      {/* Three columns side by side, so nothing covers the app's screen. */}
      <div style={{ position: 'absolute', left: 910, top: 350, ...riseStyle(frame, email, 60) }}>
        <Label text="By email" color="#2563eb" style={{ left: -14, top: -22 }} />
        <Email />
      </div>

      <div style={{ position: 'absolute', left: 1500, top: 150, ...riseStyle(frame, phone, 80) }}>
        <Label text="On WhatsApp" color="#16a34a" style={{ left: -14, top: -22 }} />
        <Phone tap={tap} />
      </div>

      <div style={{ position: 'absolute', left: 60, top: 910, display: 'flex', alignItems: 'center', gap: 16, ...riseStyle(frame, language, 30) }}>
        <span style={{ fontSize: 28, fontWeight: 700, color: LIGHT.ink }}>In local languages,</span>
        <span style={{ fontSize: 28, fontWeight: 700, color: SECTION_COLORS.platform }}>like Zulu</span>
      </div>
    </Stage>
  )
}

const Email: React.FC = () => (
  <div style={{ width: 560, borderRadius: 18, background: '#fff', boxShadow: '0 40px 90px -40px rgba(21,18,31,0.55), 0 0 0 1px rgba(21,18,31,0.08)', padding: '26px 26px', fontSize: 16, color: '#1f2937' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ width: 44, height: 44, borderRadius: '50%', background: LIGHT.accent, color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>SI</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 700 }}>Smart Incubation</div>
        <div style={{ color: '#6b7280', fontSize: 15 }}>to Olwethu · 07:00</div>
      </div>
    </div>
    <div style={{ marginTop: 16, fontSize: 21, fontWeight: 800, lineHeight: 1.25 }}>Intervention deadlines: 1 overdue and 2 due soon</div>
    <div style={{ marginTop: 12 }}>Hello Olwethu,</div>
    <div style={{ marginTop: 6 }}>There are <b>1 overdue and 2 due soon</b> interventions in your programmes.</div>
    <div style={{ marginTop: 12 }}>
      {EMAIL_ROWS.map((row) => (
        <div key={row.title} style={{ display: 'flex', gap: 12, padding: '7px 0', borderBottom: '1px solid #e5e7eb', alignItems: 'baseline' }}>
          <span style={{ flex: 1.6 }}><b>{row.title}</b> <span style={{ color: '#6b7280', fontSize: 14 }}>{row.sme}</span></span>
          <span style={{ flex: 1, color: '#4b5563', fontSize: 15 }}>{row.who}</span>
          <span style={{ flex: 0.9, fontWeight: 700, color: row.overdue ? '#dc2626' : '#b45309', fontSize: 15 }}>{row.when}</span>
        </div>
      ))}
    </div>
    <div style={{ display: 'inline-block', marginTop: 16, padding: '11px 18px', borderRadius: 10, background: '#6d5dfb', color: '#fff', fontWeight: 700 }}>Review interventions</div>
  </div>
)

const WA = { header: '#008069', chat: '#efeae2', incoming: '#ffffff', outgoing: '#d9fdd3', link: '#027eb5', tick: '#53bdeb' }

/** A WhatsApp check-back: the question with Yes / Partly / No buttons, a tap on Yes, and the bot's reply. */
const Phone: React.FC<{ tap: number }> = ({ tap }) => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pressed = interpolate(frame, [tap, tap + 4, tap + 10], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const reply = tap + Math.round(fps * 0.5)
  const answer = tap + Math.round(fps * 1.6)
  const bubble: React.CSSProperties = { maxWidth: 300, padding: '10px 12px 8px', borderRadius: 12, fontSize: 18, lineHeight: 1.35, boxShadow: '0 1px 1px rgba(0,0,0,0.12)' }
  return (
    <div style={{ width: 380, height: 790, borderRadius: 52, background: '#111', padding: 14, boxShadow: '0 50px 100px -40px rgba(21,18,31,0.65)' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 42, overflow: 'hidden', background: WA.chat, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: WA.header, color: '#fff', padding: '46px 18px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: LIGHT.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>SI</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 19 }}>Smart Incubation</div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>Business account</div>
          </div>
        </div>
        <div style={{ flex: 1, padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ ...bubble, alignSelf: 'flex-start', background: WA.incoming, borderTopLeftRadius: 2 }}>
            Hi Thandiwe 👋 Has the change from <b>Cash Flow &amp; Budgeting Workshop</b> happened in your business?
            <div style={{ textAlign: 'right', fontSize: 13, color: '#667781', marginTop: 4 }}>09:00</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 300 }}>
            {['Yes', 'Partly', 'No'].map((choice) => (
              <div key={choice} style={{ background: choice === 'Yes' ? `rgba(0,128,105,${0.06 + pressed * 0.3})` : WA.incoming, color: WA.link, textAlign: 'center', padding: '10px 0', borderRadius: 10, fontSize: 18, fontWeight: 600, scale: String(choice === 'Yes' ? 1 - pressed * 0.04 : 1) }}>
                {choice}
              </div>
            ))}
          </div>
          {frame >= reply && (
            <div style={{ ...bubble, alignSelf: 'flex-end', background: WA.outgoing, borderTopRightRadius: 2, ...riseStyle(frame, reply, 14) }}>
              Yes <span style={{ fontSize: 13, color: '#667781', marginLeft: 8 }}>09:02</span> <span style={{ color: WA.tick, fontSize: 14 }}>✓✓</span>
            </div>
          )}
          {frame >= answer && (
            <div style={{ ...bubble, alignSelf: 'flex-start', background: WA.incoming, borderTopLeftRadius: 2, ...riseStyle(frame, answer, 14) }}>
              Thank you. Recorded <b>Yes</b> for Cash Flow &amp; Budgeting Workshop.
              <div style={{ textAlign: 'right', fontSize: 13, color: '#667781', marginTop: 4 }}>09:02</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
