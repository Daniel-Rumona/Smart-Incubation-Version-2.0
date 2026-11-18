import { Fragment } from 'react'
import { interpolate, useCurrentFrame } from 'remotion'
import { BrandMark } from '../components/BrandMark'
import { LEAD_IN_FRAMES } from '../theme'
import { arrive, LIGHT, riseStyle, Stage, Words } from './look'
import type { PitchScene } from './script'

type Of<K extends PitchScene['kind']> = Extract<PitchScene, { kind: K }>
type Props<K extends PitchScene['kind']> = { scene: Of<K>; speechFrames: number }

/** At a share of the narration (0–1), in frames from the scene's start. */
const at = (speechFrames: number, share: number) => LEAD_IN_FRAMES + Math.round(speechFrames * share)

const SceneTitle: React.FC<{ tag: string; color: string; headline: string }> = ({ tag, color, headline }) => {
  const frame = useCurrentFrame()
  return (
    <div style={{ position: 'absolute', left: 80, top: 60 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, ...riseStyle(frame, 2) }}>
        <span style={{ width: 14, height: 14, borderRadius: '50%', background: color }} />
        <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: 4, textTransform: 'uppercase', color }}>{tag}</span>
      </div>
      <Words text={headline} start={6} style={{ marginTop: 12, fontSize: 62, fontWeight: 800, letterSpacing: -2, color: LIGHT.ink }} />
    </div>
  )
}

// ---- WhatsApp: the agent answering an owner, and taking a booking from a programme manager ----------------------------
// A mock-up, worded as the bot words things (functions/src/whatsappBot.ts): staff requests come back as a proposal
// with Confirm and Cancel, and nothing is written until the action PIN is given.

const WA = { header: '#008069', chat: '#efeae2', incoming: '#ffffff', outgoing: '#d9fdd3', tick: '#53bdeb', green: '#00a884', link: '#027eb5' }

type Message = { at: number; from: 'me' | 'bot'; body: React.ReactNode; time: string; buttons?: string[]; press?: number }
type Typing = { text: string; start: number; end: number }

const Phone: React.FC<{ name: string; status: string; messages: Message[]; typing: Typing[] }> = ({ name, status, messages, typing }) => {
  const frame = useCurrentFrame()
  const typingNow = typing.find((entry) => frame >= entry.start && frame < entry.end + 2)
  const typed = typingNow ? typingNow.text.slice(0, Math.floor(interpolate(frame, [typingNow.start, typingNow.end], [0, typingNow.text.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))) : ''
  // The bot "types" for a moment before each of its messages.
  const botTyping = messages.some((message) => message.from === 'bot' && frame >= message.at - 20 && frame < message.at)
  const bubble: React.CSSProperties = { maxWidth: 318, padding: '9px 12px 7px', borderRadius: 12, fontSize: 17, lineHeight: 1.38, color: '#111b21', boxShadow: '0 1px 1px rgba(0,0,0,0.12)', whiteSpace: 'pre-line' }
  return (
    <div style={{ width: 410, height: 830, borderRadius: 54, background: '#111', padding: 14, boxShadow: '0 60px 120px -50px rgba(21,18,31,0.7), 0 0 0 1px rgba(255,255,255,0.06) inset' }}>
      <div style={{ width: '100%', height: '100%', borderRadius: 42, overflow: 'hidden', background: WA.chat, display: 'flex', flexDirection: 'column' }}>
        <div style={{ background: WA.header, color: '#fff', padding: '44px 16px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: LIGHT.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>SI</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{name}</div>
            <div style={{ fontSize: 13.5, opacity: 0.85 }}>{botTyping ? 'typing…' : status}</div>
          </div>
        </div>
        {/* Newest at the bottom; older messages scroll up out of view. */}
        <div style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, overflow: 'hidden' }}>
          {messages.filter((message) => frame >= message.at).map((message, index) => {
            const mine = message.from === 'me'
            const pressed = message.press ? interpolate(frame, [message.press, message.press + 4, message.press + 12], [0, 1, 0.6], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) : 0
            return (
              <Fragment key={index}>
                <div style={{ ...bubble, alignSelf: mine ? 'flex-end' : 'flex-start', background: mine ? WA.outgoing : WA.incoming, [mine ? 'borderTopRightRadius' : 'borderTopLeftRadius']: 2, ...riseStyle(frame, message.at, 14) }}>
                  {message.body}
                  <div style={{ textAlign: 'right', fontSize: 12, color: '#667781', marginTop: 3 }}>
                    {message.time} {mine && <span style={{ color: WA.tick }}>✓✓</span>}
                  </div>
                </div>
                {message.buttons && (
                  <div style={{ display: 'flex', gap: 6, width: 318, ...riseStyle(frame, message.at + 4, 10) }}>
                    {message.buttons.map((label, position) => (
                      <div key={label} style={{ flex: 1, background: position === 0 ? `rgba(0,168,132,${0.08 + pressed * 0.35})` : WA.incoming, color: WA.link, textAlign: 'center', padding: '9px 0', borderRadius: 10, fontSize: 16.5, fontWeight: 600, scale: String(position === 0 ? 1 - pressed * 0.05 : 1) }}>{label}</div>
                    ))}
                  </div>
                )}
              </Fragment>
            )
          })}
          {botTyping && (
            <div style={{ ...bubble, alignSelf: 'flex-start', background: WA.incoming, display: 'flex', gap: 5, padding: '13px 14px' }}>
              {[0, 1, 2].map((dot) => <i key={dot} style={{ width: 8, height: 8, borderRadius: '50%', background: '#8696a0', opacity: 0.4 + 0.6 * Math.abs(Math.sin(frame / 5 + dot)) }} />)}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 22px' }}>
          <div style={{ flex: 1, minHeight: 44, borderRadius: 22, background: '#fff', padding: '11px 16px', fontSize: 17, color: typed ? '#111b21' : '#8696a0', lineHeight: 1.3 }}>
            {typed || 'Message'}
            {typingNow && <span style={{ display: 'inline-block', width: 2, height: 19, marginLeft: 1, verticalAlign: 'text-bottom', background: WA.green, opacity: Math.floor(frame / 8) % 2 ? 1 : 0.2 }} />}
          </div>
          <div style={{ width: 44, height: 44, borderRadius: '50%', background: WA.green, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width={20} height={20} viewBox="0 0 24 24" fill="#fff"><path d="M3 20.5l18-8.5L3 3.5v6.6l12 1.9-12 1.9z" /></svg>
          </div>
        </div>
      </div>
    </div>
  )
}

const Who: React.FC<{ label: string; color: string; start: number }> = ({ label, color, start }) => {
  const frame = useCurrentFrame()
  return <div style={{ position: 'absolute', zIndex: 2, left: -16, top: -24, padding: '10px 20px', borderRadius: 99, background: color, color: '#fff', fontSize: 23, fontWeight: 700, boxShadow: '0 12px 30px -12px rgba(0,0,0,0.45)', ...riseStyle(frame, start, 16) }}>{label}</div>
}

export const WhatsAppScene: React.FC<Props<'whatsapp'>> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const s = (share: number) => at(speechFrames, share)
  const owner: Message[] = [
    { at: s(0.2), from: 'me', time: '08:14', body: 'Hi, what do I still need to do for the programme?' },
    {
      at: s(0.27), from: 'bot', time: '08:14',
      body: <>Hi Thandiwe 👋 Two things are waiting on you:{'\n'}1. Upload your <b>B-BBEE certificate</b>{'\n'}2. Confirm <b>Marketing Strategy Development</b> is complete{'\n\n'}Your next session is <b>Thu 19 Nov, 10:00</b> with Nomsa.</>,
    },
  ]
  const manager: Message[] = [
    { at: s(0.57), from: 'me', time: '11:02', body: 'Book a session with Bophelo Organics on Thursday at 10' },
    {
      at: s(0.63), from: 'bot', time: '11:02', buttons: ['Confirm', 'Cancel'], press: s(0.72),
      body: <>📅 <b>Schedule an appointment</b>{'\n'}Bophelo Organics · Mentoring session{'\n'}Thu 19 Nov 2026, 10:00 to 11:00{'\n'}With Nomsa Consultant</>,
    },
    { at: s(0.76), from: 'bot', time: '11:03', body: 'Authorisation required. Reply with your bot action PIN to confirm.' },
    { at: s(0.83), from: 'me', time: '11:03', body: '••••' },
    { at: s(0.9), from: 'bot', time: '11:03', body: <>✅ <b>Booked.</b> Bophelo Organics has been sent the invite to accept.</> },
  ]
  return (
    <Stage light={1}>
      {/* A soft green glow behind the phones. */}
      <div style={{ position: 'absolute', left: 700, top: 220, width: 900, height: 900, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,168,132,0.18), transparent 65%)', scale: String(0.9 + 0.1 * Math.sin(frame / 30)) }} />
      <SceneTitle tag="On WhatsApp" color="#16a34a" headline={scene.headline} />
      <div style={{ position: 'absolute', left: 80, top: 250, width: 480, display: 'flex', flexDirection: 'column', gap: 26 }}>
        {[
          { text: 'Owners ask in their own words', start: s(0.05) },
          { text: 'Answers from their own records', start: s(0.3) },
          { text: 'Staff run the programme from the road', start: s(0.45) },
          { text: 'Nothing changes without a tap and a PIN', start: s(0.74) },
        ].map((line) => (
          <div key={line.text} style={{ display: 'flex', alignItems: 'center', gap: 16, ...riseStyle(frame, line.start, 20) }}>
            <span style={{ flex: 'none', width: 36, height: 36, borderRadius: 11, background: 'rgba(22,163,74,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            </span>
            <span style={{ fontSize: 30, fontWeight: 700, color: LIGHT.ink, lineHeight: 1.2 }}>{line.text}</span>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 700, top: 200, ...riseStyle(frame, s(0.02), 80) }}>
        <Who label="Business owner" color="#059669" start={s(0.04)} />
        <Phone name="Smart Incubation" status="Business account" messages={owner} typing={[{ text: 'Hi, what do I still need to do for the programme?', start: s(0.08), end: s(0.19) }]} />
      </div>
      <div style={{ position: 'absolute', left: 1240, top: 200, ...riseStyle(frame, s(0.38), 80) }}>
        <Who label="Programme manager" color={LIGHT.accent} start={s(0.4)} />
        <Phone
          name="Smart Incubation"
          status="Business account"
          messages={manager}
          typing={[
            { text: 'Book a session with Bophelo Organics on Thursday at 10', start: s(0.43), end: s(0.56) },
            { text: '••••', start: s(0.79), end: s(0.82) },
          ]}
        />
      </div>
    </Stage>
  )
}

// ---- Data flow: the books in Qx-Core feeding Smart Incubation, and on to impact and the ESG report ----------------------

const BOOKS = '#be185d'
const HUB = { x: 1160, y: 590 }

/** A connector that draws itself, then carries moving light along it. */
const Wire: React.FC<{ from: [number, number]; to: [number, number]; start: number; color: string }> = ({ from, to, start, color }) => {
  const frame = useCurrentFrame()
  const drawn = arrive(frame, start, 20)
  const [x1, y1] = from
  const [x2, y2] = to
  const mid = (x1 + x2) / 2
  const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={6} strokeLinecap="round" pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - drawn} />
      {drawn >= 1 && <path d={d} fill="none" stroke={color} strokeWidth={6} strokeLinecap="round" pathLength={100} strokeDasharray="6 14" strokeDashoffset={-frame * 1.2} />}
    </>
  )
}

/** A labelled pill travelling from one point to another on a loop, in its own lane (`lane` pixels above or below the
 * line) that closes in as it arrives. */
const Packet: React.FC<{ label: string; from: [number, number]; to: [number, number]; start: number; period: number; color: string; lane: number }> = ({ label, from, to, start, period, color, lane }) => {
  const frame = useCurrentFrame()
  if (frame < start) return null
  const t = ((frame - start) % period) / period
  const x = from[0] + (to[0] - from[0]) * t
  const y = from[1] + (to[1] - from[1]) * t + lane * Math.sin(t * Math.PI)
  const fade = interpolate(t, [0, 0.12, 0.85, 1], [0, 1, 1, 0])
  return (
    <div style={{ position: 'absolute', left: x, top: y, translate: '-50% -50%', padding: '7px 16px', borderRadius: 99, background: color, color: '#fff', fontSize: 20, fontWeight: 700, opacity: fade, boxShadow: `0 10px 26px -10px ${color}`, whiteSpace: 'nowrap' }}>{label}</div>
  )
}

const Card: React.FC<{ left: number; top: number; width: number; start: number; color: string; title: string; caption: string; children?: React.ReactNode }> = ({ left, top, width, start, color, title, caption, children }) => {
  const frame = useCurrentFrame()
  const lit = arrive(frame, start + 8, 20)
  return (
    <div style={{ position: 'absolute', left, top, width, padding: '22px 24px', borderRadius: 24, background: '#fff', border: `2px solid ${color}${Math.round(30 + lit * 60).toString(16)}`, boxShadow: `0 40px 80px -40px rgba(21,18,31,0.45), 0 0 ${lit * 50}px -10px ${color}88`, ...riseStyle(frame, start, 40) }}>
      <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', color }}>{caption}</div>
      <div style={{ marginTop: 4, fontSize: 32, fontWeight: 800, color: LIGHT.ink, letterSpacing: -0.6 }}>{title}</div>
      {children}
    </div>
  )
}

const Row: React.FC<{ text: string; start: number; color: string }> = ({ text, start, color }) => {
  const frame = useCurrentFrame()
  const tick = arrive(frame, start, 12)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, fontSize: 22, fontWeight: 600, color: LIGHT.ink, ...riseStyle(frame, start, 14) }}>
      <span style={{ width: 26, height: 26, borderRadius: 8, background: `${color}1f`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray={24} strokeDashoffset={24 * (1 - tick)} /></svg>
      </span>
      {text}
    </div>
  )
}

export const DataflowScene: React.FC<Props<'dataflow'>> = ({ scene, speechFrames }) => {
  const frame = useCurrentFrame()
  const s = (share: number) => at(speechFrames, share)
  const hubOn = arrive(frame, s(0.1), 20)
  const ring = (offset: number) => ((frame + offset) % 60) / 60
  const impactStart = s(0.48)
  const esgStart = s(0.8)
  const bars = [0.42, 0.55, 0.5, 0.68, 0.74, 0.9]
  const surveyStrike = arrive(frame, s(0.66), 14)
  return (
    <Stage light={1}>
      <SceneTitle tag="Qx-Core integration" color={BOOKS} headline={scene.headline} />

      <svg width={1920} height={1080} style={{ position: 'absolute', inset: 0 }}>
        <Wire from={[380, 470]} to={[460, 590]} start={2} color={BOOKS} />
        <Wire from={[380, 760]} to={[460, 620]} start={6} color={BOOKS} />
        <Wire from={[820, 600]} to={[HUB.x - 120, HUB.y]} start={s(0.04)} color={BOOKS} />
        <Wire from={[HUB.x + 120, HUB.y]} to={[1430, 390]} start={impactStart - 6} color="#2563eb" />
        <Wire from={[HUB.x + 120, HUB.y]} to={[1430, 790]} start={esgStart - 6} color="#d97706" />
      </svg>

      {/* Who keeps the books: the owner, or the implementor on their behalf. */}
      <Card left={50} top={390} width={330} start={0} color={BOOKS} caption="Kept by" title="The business owner">
        <div style={{ marginTop: 8, fontSize: 20, color: LIGHT.muted }}>Just by chatting to Qx-Core</div>
      </Card>
      <Card left={50} top={680} width={330} start={4} color={BOOKS} caption="Or kept by" title="The implementor">
        <div style={{ marginTop: 8, fontSize: 20, color: LIGHT.muted }}>On the owner’s behalf</div>
      </Card>

      <Card left={460} top={420} width={360} start={2} color={BOOKS} caption="Qx-Core" title="The books">
        <Row text="Sales and invoices" start={8} color={BOOKS} />
        <Row text="Bank statements" start={14} color={BOOKS} />
        <Row text="Costs and stock" start={20} color={BOOKS} />
      </Card>

      {/* The hub: Smart Incubation, with rings of light while data arrives. */}
      <div style={{ position: 'absolute', left: HUB.x - 120, top: HUB.y - 120, width: 240, height: 240 }}>
        {[0, 20, 40].map((offset) => (
          <div key={offset} style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `3px solid ${LIGHT.accent}`, scale: String(1 + ring(offset) * 0.7), opacity: hubOn * (1 - ring(offset)) * 0.6 }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: `0 40px 90px -30px rgba(124,58,237,${0.3 + hubOn * 0.4})`, border: `3px solid rgba(124,58,237,${0.2 + hubOn * 0.6})`, ...riseStyle(frame, s(0.05), 30) }}>
          <BrandMark size={84} />
          <div style={{ fontSize: 20, fontWeight: 800, color: LIGHT.ink, textAlign: 'center', lineHeight: 1.1 }}>Smart<br />Incubation</div>
        </div>
      </div>

      {/* Three kinds of figure, a third of a loop apart, so they travel one after another. */}
      <Packet label="Revenue" from={[870, 600]} to={[HUB.x - 170, HUB.y]} start={s(0.16)} period={60} color={BOOKS} lane={-80} />
      <Packet label="Costs" from={[870, 600]} to={[HUB.x - 170, HUB.y]} start={s(0.16) + 20} period={60} color="#9d174d" lane={0} />
      <Packet label="Cash flow" from={[870, 600]} to={[HUB.x - 170, HUB.y]} start={s(0.16) + 40} period={60} color="#db2777" lane={80} />

      <div style={{ position: 'absolute', left: 900, top: 790, display: 'flex', gap: 12 }}>
        {['Every day', 'No typing', 'Real transactions'].map((chip, index) => (
          <span key={chip} style={{ padding: '10px 20px', borderRadius: 99, background: LIGHT.accent, color: '#fff', fontSize: 22, fontWeight: 700, ...riseStyle(frame, s(0.06 + index * 0.16), 20) }}>{chip}</span>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 940, top: 870, fontSize: 26, fontWeight: 700, color: LIGHT.muted, ...riseStyle(frame, s(0.64), 20) }}>
        <span style={{ position: 'relative' }}>
          Survey forms
          <i style={{ position: 'absolute', left: 0, top: '52%', height: 4, width: `${surveyStrike * 100}%`, background: '#dc2626', borderRadius: 2 }} />
        </span>
      </div>

      <Card left={1430} top={250} width={430} start={impactStart} color="#2563eb" caption="Measured" title="Readiness and impact">
        <div style={{ marginTop: 16, height: 120, display: 'flex', alignItems: 'flex-end', gap: 12 }}>
          {bars.map((height, index) => (
            <div key={index} style={{ flex: 1, height: `${height * 100 * arrive(frame, impactStart + 10 + index * 4, 18)}%`, borderRadius: 6, background: index === bars.length - 1 ? '#2563eb' : 'rgba(37,99,235,0.35)' }} />
          ))}
        </div>
      </Card>

      <Card left={1430} top={640} width={430} start={esgStart} color="#d97706" caption="The final output" title="ESG report">
        <Row text="Carbon footprint, scopes 1-3" start={esgStart + 10} color="#d97706" />
        <Row text="Drafted with AI, ready to share" start={esgStart + 18} color="#d97706" />
      </Card>
    </Stage>
  )
}
