import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Empty, Select, Skeleton } from 'antd'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { loadTwinBusinesses, type TwinBusiness } from '@/services/digitalTwinService'
import {
  WEEKS_AHEAD, WEEKS_BACK, applyMoves, availableMoves, rankMoves, readinessOn, readyWeek, timeline, upcomingEvents, type TwinWeek,
} from '@/utils/digitalTwin'
import { READY_SCORE } from '@/utils/readiness'
import '@/styles/digital-twin.css'

/**
 * The digital twin of one SME, on one screen. The whole twin follows the time machine: as it plays (or a week is
 * picked), the core, the orbiting layers and the layer bars show that week, rebuilt from the records or projected
 * ahead, on plan or with the moves picked. Its colour says how it stands: red at risk, amber to watch, green in order,
 * and the picked moves count, so fixing the problems turns it green. Every number comes from src/utils/digitalTwin.ts,
 * which runs the control tower's own readiness rules.
 */

// Dates and money through one formatter each, with the locale set explicitly.
const LOCALE = 'en-ZA'
const TZ = 'Africa/Johannesburg'
const longDate = (date: Date) => date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ })
const shortDate = (date: Date) => date.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', timeZone: TZ })
const money = (value: number) => `R ${Math.round(value).toLocaleString(LOCALE)}`
const ago = (date: Date, now: Date) => {
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return shortDate(date)
}
const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`

const COLOR = { growth: '#34d399', support: '#60a5fa', skills: '#c4b5fd', compliance: '#fbbf24', sustainability: '#2dd4bf', readiness: '#f9a8d4', engagement: '#22c55e' } as const
type LayerKey = 'growth' | 'support' | 'skills' | 'compliance' | 'sustainability' | 'readiness'
type Layer = { key: LayerKey; name: string; short: string; value: string; pct: number; delta: string | null; source: string }
type Risk = 'risk' | 'watch' | 'order'
const RISK_LABEL: Record<Risk, string> = { risk: 'At risk', watch: 'Watch', order: 'In order' }

/** The six layers in one week, with what the moves changed against the plan in that same week. */
const layersFor = (business: TwinBusiness, week: TwinWeek, plan: TwinWeek, moved: boolean): Layer[] => {
  const share = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0)
  const diff = (now: number, before: number) => (moved && now !== before ? signed(now - before) : null)
  const courses = business.courses
  return [
    {
      key: 'growth', name: 'Growth', short: week.revenueChange === null ? '—' : `${signed(week.revenueChange)}%`,
      value: week.revenue === null ? 'No revenue yet' : `${money(week.revenue)} a month`,
      pct: week.revenueChange === null ? 0 : Math.max(4, Math.min(100, 50 + week.revenueChange)), delta: null, source: 'Monthly revenue (books integration next)',
    },
    {
      key: 'support', name: 'Support', short: `${week.delivered}/${week.planTotal}`,
      value: week.planTotal ? `${week.delivered} of ${week.planTotal} delivered` : 'No growth plan yet',
      pct: share(week.delivered, week.planTotal), delta: diff(week.delivered, plan.delivered), source: 'Growth plan and interventions',
    },
    {
      key: 'skills', name: 'Skills', short: courses && courses.total ? `${courses.completed}/${courses.total}` : '—',
      value: courses && courses.total ? `${courses.completed} of ${courses.total} courses done` : 'No LMS courses yet',
      pct: courses && courses.total ? share(courses.completed, courses.total) : 0, delta: null, source: 'LMS courses',
    },
    {
      key: 'compliance', name: 'Compliance', short: `${week.documentsValid}/${week.documentsTotal}`,
      value: week.documentsTotal ? `${week.documentsValid} of ${week.documentsTotal} documents valid` : 'No documents',
      pct: share(week.documentsValid, week.documentsTotal), delta: diff(week.documentsValid, plan.documentsValid), source: 'Compliance documents',
    },
    { key: 'sustainability', name: 'Sustainability', short: '—', value: 'Not measured yet', pct: 0, delta: null, source: 'ESG reporting add-on' },
    {
      key: 'readiness', name: 'Readiness', short: `${week.funding}·${week.market}`, value: `Funding ${week.funding}, market ${week.market}`,
      pct: week.funding, delta: diff(week.funding, plan.funding), source: 'Readiness rules (as the Control Tower)',
    },
  ]
}

const QUESTIONS = [
  { key: 'fast', text: 'Fastest way to funding-ready?', words: ['fast', 'quick', 'soon', 'best', 'how'] },
  { key: 'why', text: 'Why is it not ready yet?', words: ['why', 'missing', 'gap', 'block', 'stop'] },
  { key: 'nothing', text: 'What happens if nothing changes?', words: ['nothing', 'change', 'future', 'ahead', 'next'] },
]

export const DigitalTwinPage = () => {
  const { user } = useFullIdentity()
  const { activeProgramId } = useActiveProgramId()
  const { participantId } = useParams()
  const navigate = useNavigate()
  const [businesses, setBusinesses] = useState<TwinBusiness[] | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [playing, setPlaying] = useState(true)
  const [cursor, setCursor] = useState(WEEKS_BACK)
  const [chatOpen, setChatOpen] = useState(false)
  const [chat, setChat] = useState<Array<{ from: 'you' | 'twin'; text: string }>>([])
  const [draft, setDraft] = useState('')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadTwinBusinesses(user, activeProgramId)
      .then((rows) => { if (!cancelled) setBusinesses(rows.sort((a, b) => a.businessName.localeCompare(b.businessName))) })
      .catch((reason: Error) => { if (!cancelled) setError(reason.message === 'forbidden' ? 'You do not have access to the digital twin.' : 'The twin could not be loaded.') })
    return () => { cancelled = true }
  }, [user, activeProgramId])

  // Opens on the business furthest along, unless one is named in the address.
  const business = useMemo(() => {
    if (!businesses?.length) return null
    const named = businesses.find((row) => row.id === participantId)
    if (named) return named
    const score = (row: TwinBusiness) => readinessOn(row.input, row.input.now).funding.score ?? 0
    return [...businesses].sort((a, b) => score(b) - score(a))[0]
  }, [businesses, participantId])

  // A different business starts with a clean slate: no moves, no conversation, the time machine on today.
  const [scope, setScope] = useState<string | null>(null)
  if (business && scope !== business.id) {
    setScope(business.id)
    setPicked({})
    setChat([])
    setCursor(WEEKS_BACK)
  }

  const twin = useMemo(() => {
    if (!business) return null
    const input = business.input
    const moves = availableMoves(input)
    const chosen = moves.filter((move) => picked[move.key])
    const moved = chosen.length ? applyMoves(input, chosen) : null
    const base = timeline(input)
    const withMoves = moved ? timeline(moved) : null
    return {
      today: readinessOn(input, input.now),
      todayMoved: moved ? readinessOn(moved, input.now) : null,
      moves, chosen, ranked: rankMoves(input, moves), base, withMoves,
      baseReady: readyWeek(base), movesReady: withMoves ? readyWeek(withMoves) : null,
      events: upcomingEvents(moved || input, 12).slice(0, 4),
    }
  }, [business, picked])

  const weeks = twin ? twin.base.length : 0
  // The time machine plays the weeks in a loop: from today to the end, then the history, and round again.
  useEffect(() => {
    if (!playing || !weeks) return
    const timer = window.setInterval(() => setCursor((value) => (value + 1) % weeks), 420)
    return () => window.clearInterval(timer)
  }, [playing, weeks])

  const peers = useMemo(() => {
    if (!business || !businesses) return null
    const group = businesses.filter((row) => row.programId === business.programId && (row.sector || '') === (business.sector || ''))
    if (group.length < 3) return null
    const score = (row: TwinBusiness) => readinessOn(row.input, row.input.now).funding.score ?? 0
    const mine = score(business)
    return { ahead: group.filter((row) => row.id !== business.id && score(row) < mine).length, others: group.length - 1 }
  }, [business, businesses])

  if (error) return <div className='dt-mode dt-center'><Empty description={error} /></div>
  if (!businesses) return <div className='dt-mode dt-center'><Skeleton active paragraph={{ rows: 10 }} /></div>
  if (!business || !twin) return <div className='dt-mode dt-center'><Empty description='No SMEs in this workspace yet.' /></div>

  const today = business.input.now
  const weekDate = (offset: number) => new Date(today.getTime() + offset * 7 * 86_400_000)
  const anyMove = twin.chosen.length > 0
  const series = twin.base.map((week, index) => (week.offset > 0 && twin.withMoves ? twin.withMoves[index] : week))
  const index = Math.min(cursor, series.length - 1)
  const active = series[index]
  const planWeek = twin.base[index]
  const movedNow = anyMove && active.offset > 0
  const layers = layersFor(business, active, planWeek, movedNow)
  const coreDelta = movedNow && active.funding !== planWeek.funding ? signed(active.funding - planWeek.funding) : null
  const when = active.offset < 0 ? 'Rebuilt from records' : active.offset === 0 ? 'Today' : anyMove ? 'With your moves' : 'On plan'

  // Needs attention today; a reason the picked moves would fix is struck through and no longer counts.
  const gateFixed = (key: string) => !!twin.todayMoved?.funding.gates.find((gate) => gate.key === key && gate.state === 'met')
  const overdueFixed = twin.chosen.some((move) => move.kind === 'Intervention')
  const revenueChange = twin.base[WEEKS_BACK].revenueChange
  const reasons = [
    ...(business.overdue ? [{ good: false, fixed: overdueFixed, text: `${business.overdue} intervention${business.overdue === 1 ? '' : 's'} overdue` }] : []),
    ...twin.today.funding.gates.filter((gate) => gate.critical && gate.state !== 'met').map((gate) => ({ good: false, fixed: gateFixed(gate.key), text: `${gate.label}: ${gate.detail.toLowerCase()}` })),
    ...(revenueChange !== null && revenueChange < -5 ? [{ good: false, fixed: false, text: `Revenue ${revenueChange}% over the months recorded` }] : []),
    ...(revenueChange !== null && revenueChange > 0 ? [{ good: true, fixed: false, text: `Revenue ${signed(revenueChange)}% over the months recorded` }] : []),
  ].slice(0, 4)
  const open = reasons.filter((reason) => !reason.good && !reason.fixed).length
  const risk: Risk = open >= 2 ? 'risk' : open === 1 ? 'watch' : 'order'

  const helpful = twin.ranked.filter((move) => (move.weeksSooner ?? 0) > 0 || move.scoreGain > 0)
  const funding = twin.today.funding.score ?? 0
  const answerFor = (key: string) => {
    if (key === 'fast') {
      if (!helpful.length) return 'No single move open today changes the funding-ready date. Ask "Why is it not ready yet?" to see what stands in the way.'
      const all = timeline(applyMoves(business.input, twin.moves.filter((move) => helpful.some((row) => row.key === move.key))), 0, WEEKS_AHEAD)
      const week = readyWeek(all)
      return `These ${helpful.length} move${helpful.length === 1 ? '' : 's'} together ${week === null ? `lift funding readiness to ${all[12]?.funding ?? 0} in 12 weeks` : `make ${business.businessName} funding-ready by ${longDate(weekDate(week))}`}: ${helpful.map((move) => move.title.toLowerCase()).join('; ')}. I have switched them on, so the whole twin now shows that future.`
    }
    if (key === 'why') {
      const steps = twin.today.nextSteps.slice(0, 4).map((step) => step.gate.action || step.gate.label)
      return steps.length ? `Funding readiness is ${funding}; ready means ${READY_SCORE} or more with every critical gate met. What stands in the way: ${steps.join('; ')}.` : 'Every gate the readiness rules check is met.'
    }
    const expiring = upcomingEvents(business.input, 12).filter((event) => event.tone === 'expiry')
    return `On plan, funding readiness goes from ${funding} today to ${twin.base.find((week) => week.offset === 12)?.funding ?? funding} in 12 weeks${twin.baseReady === null ? ', and it is not funding-ready within 26 weeks' : `, funding-ready by ${longDate(weekDate(twin.baseReady))}`}. ${expiring.length ? `Watch: ${expiring.map((event) => `${event.text.toLowerCase()} on ${shortDate(event.date)}`).join(', ')}.` : 'No documents expire in that time.'} This assumes each open intervention is delivered on its due date.`
  }
  const ask = (key: string, asked?: string) => {
    const question = QUESTIONS.find((row) => row.key === key) as typeof QUESTIONS[number]
    setChat((current) => [...current, { from: 'you', text: asked || question.text }, { from: 'twin', text: answerFor(key) }])
    if (key === 'fast') setPicked(Object.fromEntries(helpful.map((move) => [move.key, true])))
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
      setChat((current) => [...current, { from: 'you', text }, { from: 'twin', text: 'I can answer these for now: the fastest way to funding-ready, why it is not ready yet, and what happens if nothing changes. Free questions through the assistant come next.' }])
      return
    }
    ask(match.row.key, text)
  }
  const readyText = (offset: number | null) => (offset === null ? 'Not within 26 weeks' : longDate(weekDate(offset)))

  return (
    <div className={`dt-mode dt-risk-${risk}`}>
      <header className='dt-top'>
        <div className='dt-title'>
          <div className='dt-badge' aria-hidden='true'>{business.businessName.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div className='dt-title-text'>
            <div className='dt-eyebrow'>Digital twin · Incubation SME</div>
            <h1>{business.businessName}</h1>
            <div className='dt-sub'>{[business.ownerName, business.sector, business.programName].filter(Boolean).join(' · ')}</div>
          </div>
          <span key={risk} className='dt-status'><i aria-hidden='true' />{RISK_LABEL[risk]}</span>
        </div>
        <div className='dt-tools'>
          <Select
            showSearch
            optionFilterProp='label'
            aria-label='Business'
            value={business.id}
            className='dt-select'
            options={businesses.map((row) => ({ value: row.id, label: row.businessName }))}
            onChange={(id) => navigate(`/operations/participants/digital-twin/${id}`)}
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
            <div className='dt-eyebrow'>On plan, funding-ready by</div>
            <div key={readyText(twin.baseReady)} className='dt-date dt-flip'>{readyText(twin.baseReady)}</div>
            {anyMove && (
              <div className='dt-moved'>
                <span>With your moves</span>
                <strong key={readyText(twin.movesReady)} className='dt-flip'>{readyText(twin.movesReady)}</strong>
              </div>
            )}
            <div className='dt-fine'>Assumes open interventions are delivered on their due dates.</div>
          </div>

          <div className='dt-panel dt-attention'>
            <div className='dt-attention-head'>
              <span className='dt-eyebrow'>Needs attention</span>
              <span key={risk} className='dt-level'>{RISK_LABEL[risk]}</span>
            </div>
            {reasons.length === 0 && <div className='dt-reason'><i className='dt-good' aria-hidden='true' /><span>Nothing needs attention. Everything is in order.</span></div>}
            {reasons.map((reason, position) => (
              <div key={reason.text} className={`dt-reason${reason.fixed ? ' dt-fixed' : ''}`} style={{ animationDelay: `${position * 90}ms` }}>
                <i className={reason.fixed || reason.good ? 'dt-good' : 'dt-warn'} aria-hidden='true' />
                <span>{reason.text}{reason.fixed && <em> · fixed by your move</em>}</span>
              </div>
            ))}
            {peers && <div className='dt-fine'>Ahead of {peers.ahead} of {peers.others} peers in this programme and sector.</div>}
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
            <span>Funding readiness <strong>{active.funding}</strong>{active.band === 'ready' ? ' · ready' : ''}</span>
          </div>
          <div className='dt-scene'>
            <div className='dt-orbit-wrap'>
              <div className={`dt-core${active.band === 'ready' ? ' dt-core-ready' : ''}`}>
                <strong key={active.funding} className='dt-pop'>{active.funding}</strong>
                <span>{active.offset === 0 ? 'Funding readiness' : shortDate(active.date)}</span>
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
              <div className='dt-ready-plane' style={{ height: `${READY_SCORE}%` }} aria-hidden='true'><span>Funding-ready ({READY_SCORE})</span></div>
              <div className='dt-bars'>
                <div className='dt-today-beam' style={{ left: `${((WEEKS_BACK + 0.5) / series.length) * 100}%` }} aria-hidden='true'>
                  <span>Today · {shortDate(today)}</span>
                </div>
                {series.map((week, position) => {
                  const future = week.offset > 0
                  // Each week in its own risk colour: what was (or will be) missing that week.
                  const tone = week.band === 'ready' || week.criticalOpen === 0 ? 'order' : week.criticalOpen === 1 ? 'watch' : 'risk'
                  const cls = ['dt-bar', `dt-bar-${tone}`, future ? 'dt-bar-future' : '', future && anyMove ? 'dt-bar-moved' : '', week.offset === 0 ? 'dt-bar-today' : '', position === index ? 'dt-bar-active' : ''].filter(Boolean).join(' ')
                  return (
                    <button
                      key={week.offset}
                      type='button'
                      className={cls}
                      style={{ height: `${Math.max(3, week.funding)}%` }}
                      aria-label={`${shortDate(week.date)}: funding readiness ${week.funding}`}
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
            {twin.ranked.length === 0 && <div className='dt-fine'>No moves open: nothing to renew or bring forward.</div>}
            {twin.ranked.slice(0, 6).map((move) => (
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
            {business.activity.length === 0 && <span className='dt-fine'>Nothing recorded yet.</span>}
            {business.activity.slice(0, 3).map((item, position) => (
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
          {QUESTIONS.map((question) => <button key={question.key} type='button' className='dt-question' onClick={() => ask(question.key)}>{question.text}</button>)}
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

export default DigitalTwinPage
