import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { Select } from 'antd'
import { WEEKS_BACK } from '@/utils/digitalTwin'
import { READY_SCORE } from '@/utils/readiness'
import { longDate, shortDate, signed, weekDate, type LayerKey, type TwinBuild, type TwinKind, type TwinSubject, type ViewWeek } from '@/utils/twinView'
import '@/styles/digital-twin.css'

/**
 * The digital twin of one business, on one screen, for either side of the platform. The whole twin follows the
 * time machine: as it plays (or a week is picked), the core, the orbiting layers and the layer bars show that week,
 * rebuilt from the records or projected ahead, on plan or with the moves picked. Its colour says how it stands: red at
 * risk, amber to watch, green in order, and the picked moves count. The numbers all come from `build`, the side's
 * own rules.
 */

const COLOR: Record<LayerKey | 'engagement', string> = { growth: '#34d399', support: '#60a5fa', skills: '#c4b5fd', compliance: '#fbbf24', sustainability: '#2dd4bf', readiness: '#f9a8d4', engagement: '#22c55e' }
type Risk = 'risk' | 'watch' | 'order'
const RISK_LABEL: Record<Risk, string> = { risk: 'At risk', watch: 'Watch', order: 'In order' }
const toneOf = (week: ViewWeek): Risk => (week.ready || week.criticalOpen === 0 ? 'order' : week.criticalOpen === 1 ? 'watch' : 'risk')
const ago = (date: Date, now: Date) => {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return shortDate(date)
}

const QUESTIONS = [
  { key: 'fast', words: ['fast', 'quick', 'soon', 'best', 'how'] },
  { key: 'why', words: ['why', 'missing', 'gap', 'block', 'stop'] },
  { key: 'nothing', words: ['nothing', 'change', 'future', 'ahead', 'next'] },
] as const

type Props = {
  kind: TwinKind
  subjects: Array<{ subject: TwinSubject; score: number }>
  subject: TwinSubject
  build: (picked: Record<string, boolean>) => TwinBuild
  onSelect: (id: string) => void
}

export const TwinScreen = ({ kind, subjects, subject, build, onSelect }: Props) => {
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [playing, setPlaying] = useState(true)
  const [cursor, setCursor] = useState(WEEKS_BACK)
  const [chatOpen, setChatOpen] = useState(false)
  const [chat, setChat] = useState<Array<{ from: 'you' | 'twin'; text: string }>>([])
  const [draft, setDraft] = useState('')

  // A different business starts with a clean slate: no moves, no conversation, the time machine on today.
  const [scope, setScope] = useState(subject.id)
  if (scope !== subject.id) {
    setScope(subject.id)
    setPicked({})
    setChat([])
    setCursor(WEEKS_BACK)
  }

  const twin = useMemo(() => build(picked), [build, picked])
  const weeks = twin.base.length
  // The time machine plays the weeks in a loop: from today to the end, then the history, and round again.
  useEffect(() => {
    if (!playing || !weeks) return
    const timer = window.setInterval(() => setCursor((value) => (value + 1) % weeks), 420)
    return () => window.clearInterval(timer)
  }, [playing, weeks])

  const peers = useMemo(() => {
    const group = subjects.filter((row) => row.subject.peerGroup === subject.peerGroup)
    if (group.length < 3) return null
    const mine = group.find((row) => row.subject.id === subject.id)?.score ?? 0
    return { ahead: group.filter((row) => row.subject.id !== subject.id && row.score < mine).length, others: group.length - 1 }
  }, [subjects, subject])

  const today = subject.now
  const anyMove = Object.values(picked).some(Boolean)
  const series = twin.base.map((week, index) => (week.offset > 0 && twin.moved ? twin.moved[index] : week))
  const index = Math.min(cursor, series.length - 1)
  const active = series[index]
  const planWeek = twin.base[index]
  const movedNow = anyMove && active.offset > 0
  const layers = active.layers.map((layer, position) => {
    const before = planWeek.layers[position]?.n
    return { ...layer, delta: movedNow && layer.n !== null && before !== null && before !== undefined && layer.n !== before ? signed(layer.n - before) : null }
  })
  const coreDelta = movedNow && active.score !== planWeek.score ? signed(active.score - planWeek.score) : null
  const when = active.offset < 0 ? 'Rebuilt from records' : active.offset === 0 ? 'Today' : anyMove ? 'With your moves' : 'On plan'
  const open = twin.reasons.filter((reason) => !reason.good && !reason.fixed).length
  const risk: Risk = open >= 2 ? 'risk' : open === 1 ? 'watch' : 'order'
  const readyText = (offset: number | null) => (offset === null ? 'Not within 26 weeks' : longDate(weekDate(today, offset)))

  const ask = (key: 'fast' | 'why' | 'nothing', asked?: string) => {
    const text = { fast: `Fastest way to be ${kind.readyPhrase}?`, why: `Why is it not ${kind.readyPhrase} yet?`, nothing: 'What happens if nothing changes?' }[key]
    setChat((current) => [...current, { from: 'you', text: asked || text }, { from: 'twin', text: twin.answers[key] }])
    if (key === 'fast') setPicked(Object.fromEntries(twin.helpful.map((move) => [move, true])))
    setChatOpen(true)
  }
  const send = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    const lower = text.toLowerCase()
    const match = QUESTIONS.map((row) => ({ row, hits: row.words.filter((word) => lower.includes(word)).length })).sort((a, b) => b.hits - a.hits)[0]
    setDraft('')
    if (!match.hits) {
      setChat((current) => [...current, { from: 'you', text }, { from: 'twin', text: `I can answer these for now: the fastest way to be ${kind.readyPhrase}, why it is not yet, and what happens if nothing changes. Free questions through the assistant come next.` }])
      return
    }
    ask(match.row.key, text)
  }

  return (
    <div className={`dt-mode dt-risk-${risk}`}>
      <header className='dt-top'>
        <div className='dt-title'>
          <div className='dt-badge' aria-hidden='true'>{subject.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div className='dt-title-text'>
            <div className='dt-eyebrow'>{kind.eyebrow}</div>
            <h1>{subject.name}</h1>
            <div className='dt-sub'>{subject.sub}</div>
          </div>
          <span key={risk} className='dt-status'><i aria-hidden='true' />{RISK_LABEL[risk]}</span>
        </div>
        <div className='dt-tools'>
          <Select
            showSearch
            optionFilterProp='label'
            aria-label='Business'
            value={subject.id}
            className='dt-select'
            options={subjects.map((row) => ({ value: row.subject.id, label: row.subject.name }))}
            onChange={onSelect}
          />
          <button type='button' className='dt-ai' aria-label='Open the twin assistant' aria-expanded={chatOpen} onClick={() => setChatOpen(!chatOpen)}>
            <svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.8' strokeLinecap='round' strokeLinejoin='round' aria-hidden='true'>
              <path d='M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z' /><path d='M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' />
            </svg>
            <span>Ask the twin</span>
          </button>
        </div>
      </header>

      <div className='dt-main'>
        <aside className='dt-side' aria-label='Where it is heading'>
          <div className='dt-panel dt-shimmer'>
            <div className='dt-eyebrow'>On plan, {kind.readyPhrase} by</div>
            <div key={readyText(twin.baseReady)} className='dt-date dt-flip'>{readyText(twin.baseReady)}</div>
            {anyMove && (
              <div className='dt-moved'>
                <span>With your moves</span>
                <strong key={readyText(twin.movedReady)} className='dt-flip'>{readyText(twin.movedReady)}</strong>
              </div>
            )}
            <div className='dt-fine'>{kind.assumption}</div>
          </div>

          <div className='dt-panel dt-attention'>
            <div className='dt-attention-head'>
              <span className='dt-eyebrow'>Needs attention</span>
              <span key={risk} className='dt-level'>{RISK_LABEL[risk]}</span>
            </div>
            {twin.reasons.length === 0 && <div className='dt-reason'><i className='dt-good' aria-hidden='true' /><span>Nothing needs attention. Everything is in order.</span></div>}
            {twin.reasons.map((reason, position) => (
              <div key={reason.text} className={`dt-reason${reason.fixed ? ' dt-fixed' : ''}`} style={{ animationDelay: `${position * 90}ms` }}>
                <i className={reason.fixed || reason.good ? 'dt-good' : 'dt-warn'} aria-hidden='true' />
                <span>{reason.text}{reason.fixed && <em> · fixed by your move</em>}</span>
              </div>
            ))}
            {peers && <div className='dt-fine'>Ahead of {peers.ahead} of {peers.others} peers in the same group.</div>}
          </div>

          <div className='dt-panel dt-layers'>
            <div className='dt-eyebrow'>{when} · {shortDate(active.date)}</div>
            {layers.map((layer) => (
              <div key={layer.key} className='dt-layer' title={layer.source}>
                <div className='dt-layer-top'>
                  <i style={{ background: COLOR[layer.key], boxShadow: `0 0 8px ${COLOR[layer.key]}` }} aria-hidden='true' />
                  <b>{layer.name}</b>
                  <span key={layer.value} className='dt-layer-value dt-pop'>{layer.value}</span>
                  {layer.delta && <span key={`${layer.key}${layer.delta}`} className='dt-delta'>{layer.delta}</span>}
                </div>
                <div className='dt-track' aria-hidden='true'>
                  <div className='dt-fill' style={{ width: `${layer.pct}%`, background: COLOR[layer.key], boxShadow: `0 0 10px ${COLOR[layer.key]}` }} />
                </div>
              </div>
            ))}
          </div>
        </aside>

        <section className='dt-stage' aria-label='Twin core and time machine'>
          <div className='dt-readout' aria-live='polite'>
            <span>{when}</span>
            <b>{longDate(active.date)}</b>
            <span>{kind.scoreLabel} <strong>{active.score}</strong>{active.ready ? ` · ${kind.readyPhrase}` : ''}</span>
          </div>
          <div className='dt-scene'>
            <div className='dt-orbit-wrap'>
              <div className={`dt-core${active.ready ? ' dt-core-ready' : ''}`}>
                <strong key={active.score} className='dt-pop'>{active.score}</strong>
                <span>{active.offset === 0 ? kind.scoreLabel : shortDate(active.date)}</span>
                {coreDelta && <em key={coreDelta} className='dt-core-delta'>{coreDelta} with moves</em>}
              </div>
              <div className='dt-orbit'>
                {layers.map((layer, position) => (
                  <div key={layer.key} className='dt-sat' style={{ '--a': `${position * 60}deg` } as CSSProperties}>
                    <div className={`dt-sat-face${layer.delta ? ' dt-sat-up' : ''}`}>
                      <i style={{ background: COLOR[layer.key], boxShadow: `0 0 10px ${COLOR[layer.key]}` }} aria-hidden='true' />
                      <b>{layer.name}</b>
                      <span key={layer.short} className='dt-pop'>{layer.short}</span>
                      {layer.delta && <em>{layer.delta}</em>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className='dt-floor'>
              <div className='dt-grid-lines' aria-hidden='true' />
              <div className='dt-ready-plane' style={{ height: `${READY_SCORE}%` }} aria-hidden='true'><span>{kind.readyPhrase} ({READY_SCORE})</span></div>
              <div className='dt-bars'>
                <div className='dt-today-beam' style={{ left: `${((WEEKS_BACK + 0.5) / series.length) * 100}%` }} aria-hidden='true'>
                  <span>Today · {shortDate(today)}</span>
                </div>
                {series.map((week, position) => {
                  const future = week.offset > 0
                  const cls = ['dt-bar', `dt-bar-${toneOf(week)}`, future ? 'dt-bar-future' : '', future && anyMove ? 'dt-bar-moved' : '', week.offset === 0 ? 'dt-bar-today' : '', position === index ? 'dt-bar-active' : ''].filter(Boolean).join(' ')
                  return (
                    <button
                      key={week.offset}
                      type='button'
                      className={cls}
                      style={{ height: `${Math.max(3, week.score)}%` }}
                      aria-label={`${shortDate(week.date)}: ${kind.scoreLabel.toLowerCase()} ${week.score}`}
                      onClick={() => { setPlaying(false); setCursor(position) }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <aside className='dt-side' aria-label='Moves'>
          <div className='dt-panel dt-moves'>
            <div className='dt-eyebrow'>What if: moves the twin has tried</div>
            {twin.moves.length === 0 && <div className='dt-fine'>No moves open right now.</div>}
            {twin.moves.slice(0, 6).map((move) => (
              <button key={move.key} type='button' aria-pressed={!!picked[move.key]} className={`dt-move${picked[move.key] ? ' dt-on' : ''}`} onClick={() => setPicked((current) => ({ ...current, [move.key]: !current[move.key] }))}>
                <span className='dt-box' aria-hidden='true'>{picked[move.key] ? '✓' : ''}</span>
                <span className='dt-move-text'><b>{move.title}</b><small>{move.kind} · {move.detail}</small></span>
                <span className='dt-effect'>{(move.weeksSooner ?? 0) > 0 ? `${move.weeksSooner} wk sooner` : move.scoreGain > 0 ? `+${move.scoreGain}` : '—'}</span>
              </button>
            ))}
          </div>
        </aside>
      </div>

      <footer className='dt-bottom'>
        <button type='button' className='dt-play' aria-pressed={playing} onClick={() => setPlaying(!playing)}>{playing ? 'Pause' : 'Play'}</button>
        <div className='dt-strip'>
          <div className='dt-eyebrow'>Coming up</div>
          <div className='dt-chips'>
            {twin.events.length === 0 && <span className='dt-fine'>Nothing due in the next 12 weeks.</span>}
            {twin.events.map((event) => <span key={`${event.text}-${event.date.getTime()}`} className={`dt-chip dt-chip-${event.tone}`}><b>{shortDate(event.date)}</b> {event.text}</span>)}
          </div>
        </div>
        <div className='dt-strip dt-pulse'>
          <div className='dt-eyebrow'>Live pulse</div>
          <div className='dt-chips'>
            {subject.activity.length === 0 && <span className='dt-fine'>Nothing recorded yet.</span>}
            {subject.activity.slice(0, 3).map((item, position) => (
              <span key={`${item.title}-${item.at.getTime()}-${position}`} className={`dt-chip${position === 0 ? ' dt-new' : ''}`} title={item.detail}>
                <i style={{ background: COLOR[item.layer], boxShadow: `0 0 8px ${COLOR[item.layer]}` }} aria-hidden='true' />{item.title} <em>{ago(item.at, today)}</em>
              </span>
            ))}
          </div>
        </div>
      </footer>

      {chatOpen && <aside className='dt-chat' aria-label='Twin assistant'>
        <div className='dt-chat-head'>
          <b>Ask the twin</b>
          <button type='button' className='dt-close' aria-label='Close the twin assistant' onClick={() => setChatOpen(false)}>×</button>
        </div>
        <div className='dt-chat-body'>
          {chat.length === 0 && <div className='dt-fine'>Answers come from the twin's own rules, so every number matches the screen.</div>}
          {chat.map((message, position) => <div key={position} className={`dt-msg dt-msg-${message.from}`}>{message.text}</div>)}
        </div>
        <div className='dt-chips'>
          <button type='button' className='dt-question' onClick={() => ask('fast')}>Fastest way to be {kind.readyPhrase}?</button>
          <button type='button' className='dt-question' onClick={() => ask('why')}>Why is it not {kind.readyPhrase} yet?</button>
          <button type='button' className='dt-question' onClick={() => ask('nothing')}>What happens if nothing changes?</button>
        </div>
        <form className='dt-chat-form' onSubmit={send}>
          <label htmlFor='dt-ask' className='dt-visually-hidden'>Ask the twin</label>
          <input id='dt-ask' value={draft} onChange={(event) => setDraft(event.target.value)} placeholder='Ask about this business…' />
          <button type='submit' className='dt-send'>Ask</button>
        </form>
      </aside>}
    </div>
  )
}

export default TwinScreen
