import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Empty, Select, Skeleton } from 'antd'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { loadTwinBusinesses, type TwinBusiness } from '@/services/digitalTwinService'
import {
  WEEKS_AHEAD, applyMoves, availableMoves, rankMoves, readinessOn, readyWeek, timeline, upcomingEvents,
} from '@/utils/digitalTwin'
import { READY_SCORE } from '@/utils/readiness'
import '@/styles/digital-twin.css'

/**
 * The digital twin of one SME, on one screen: its funding readiness as a 3D time machine (weeks rebuilt from its
 * records, then the weeks ahead on plan or with the moves picked), the six layers orbiting its core, the moves the
 * twin has tried, and a twin assistant in a side bar. Every number comes from src/utils/digitalTwin.ts, which runs
 * the control tower's own readiness rules.
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

const COLOR = { growth: '#34d399', support: '#60a5fa', skills: '#c4b5fd', compliance: '#fbbf24', sustainability: '#2dd4bf', readiness: '#f9a8d4', engagement: '#22c55e' } as const
type LayerKey = 'growth' | 'support' | 'skills' | 'compliance' | 'sustainability' | 'readiness'
type Layer = { key: LayerKey; name: string; short: string; value: string; source: string }

const layersOf = (business: TwinBusiness, funding: number, market: number): Layer[] => {
  const { input, courses } = business
  const revenue = input.revenueMonthly
  const last = revenue[revenue.length - 1]
  const change = revenue.length > 1 && revenue[0].value ? Math.round(((last.value - revenue[0].value) / Math.abs(revenue[0].value)) * 100) : null
  const plan = input.plan.filter((item) => item.status !== 'Declined')
  const done = plan.filter((item) => item.status === 'Completed').length
  const valid = input.documents.filter((doc) => String(doc.currentStatus || '').toLowerCase() === 'valid').length
  const nextExpiry = input.documents
    .filter((doc) => doc.expiresAt && doc.expiresAt.getTime() > input.now.getTime())
    .sort((a, b) => (a.expiresAt as Date).getTime() - (b.expiresAt as Date).getTime())[0]
  return [
    { key: 'growth', name: 'Growth', short: change === null ? '—' : `${change >= 0 ? '+' : ''}${change}%`, value: last ? `${money(last.value)} in ${last.period}` : 'No revenue yet', source: 'Monthly revenue (books integration next)' },
    { key: 'support', name: 'Support', short: `${done}/${plan.length}`, value: plan.length ? `${done} of ${plan.length} delivered${business.overdue ? `, ${business.overdue} overdue` : ''}` : 'No growth plan yet', source: 'Growth plan and interventions' },
    { key: 'skills', name: 'Skills', short: courses && courses.total ? `${courses.completed}/${courses.total}` : '—', value: courses && courses.total ? `${courses.completed} of ${courses.total} courses done` : 'No LMS courses yet', source: 'LMS courses' },
    { key: 'compliance', name: 'Compliance', short: `${valid}/${input.documents.length}`, value: input.documents.length ? `${valid} of ${input.documents.length} valid${nextExpiry ? `, next expiry ${shortDate(nextExpiry.expiresAt as Date)}` : ''}` : 'No documents', source: 'Compliance documents' },
    { key: 'sustainability', name: 'Sustainability', short: '—', value: 'Not measured yet', source: 'ESG reporting add-on' },
    { key: 'readiness', name: 'Readiness', short: `${funding}·${market}`, value: `Funding ${funding}, market ${market}`, source: 'Readiness rules (as the Control Tower)' },
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
  const [cursor, setCursor] = useState(0)
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
  // A different business starts with a clean slate: no moves, no conversation, the time machine at its start.
  const [scope, setScope] = useState<string | null>(null)
  if (business && scope !== business.id) {
    setScope(business.id)
    setPicked({})
    setChat([])
    setCursor(0)
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
      now: readinessOn(input, input.now), moves, ranked: rankMoves(input, moves), base, withMoves,
      baseReady: readyWeek(base), movesReady: withMoves ? readyWeek(withMoves) : null,
      events: upcomingEvents(moved || input, 12).slice(0, 4),
    }
  }, [business, picked])

  const weeks = twin ? twin.base.length : 0
  // The time machine plays the weeks in a loop: history first, then the days ahead.
  useEffect(() => {
    if (!playing || !weeks) return
    const timer = window.setInterval(() => setCursor((value) => (value + 1) % weeks), 260)
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

  const funding = twin.now.funding.score ?? 0
  const market = twin.now.market.score ?? 0
  const layers = layersOf(business, funding, market)
  const today = business.input.now
  const weekDate = (offset: number) => new Date(today.getTime() + offset * 7 * 86_400_000)
  const anyMove = Object.values(picked).some(Boolean)
  const series = twin.base.map((week, index) => (week.offset > 0 && twin.withMoves ? twin.withMoves[index] : week))
  const active = series[Math.min(cursor, series.length - 1)]
  const readyHeight = (READY_SCORE / 100) * 100

  const reasons = [
    ...(business.overdue ? [{ good: false, text: `${business.overdue} intervention${business.overdue === 1 ? '' : 's'} overdue` }] : []),
    ...twin.now.funding.gates.filter((gate) => gate.critical && gate.state !== 'met').map((gate) => ({ good: false, text: `${gate.label}: ${gate.detail.toLowerCase()}` })),
    ...(layers[0].short.startsWith('+') ? [{ good: true, text: `Revenue ${layers[0].short} over the months recorded` }] : []),
  ].slice(0, 3)
  const level = reasons.filter((reason) => !reason.good).length >= 3 ? 'High' : reasons.some((reason) => !reason.good) ? 'Medium' : 'Low'

  const helpful = twin.ranked.filter((move) => (move.weeksSooner ?? 0) > 0 || move.scoreGain > 0)
  const answerFor = (key: string) => {
    if (key === 'fast') {
      if (!helpful.length) return 'No single move open today changes the funding-ready date. Ask "Why is it not ready yet?" to see what stands in the way.'
      const all = timeline(applyMoves(business.input, twin.moves.filter((move) => helpful.some((row) => row.key === move.key))), 0, WEEKS_AHEAD)
      const week = readyWeek(all)
      return `These ${helpful.length} move${helpful.length === 1 ? '' : 's'} together ${week === null ? `lift funding readiness to ${all[12]?.funding ?? 0} in 12 weeks` : `make ${business.businessName} funding-ready by ${longDate(weekDate(week))}`}: ${helpful.map((move) => move.title.toLowerCase()).join('; ')}. I have switched them on, so the time machine shows that future.`
    }
    if (key === 'why') {
      const steps = twin.now.nextSteps.slice(0, 4).map((step) => step.gate.action || step.gate.label)
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

  return (
    <div className='dt-mode'>
      <header className='dt-top'>
        <div className='dt-title'>
          <div className='dt-badge' aria-hidden='true'>{business.businessName.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</div>
          <div className='dt-title-text'>
            <div className='dt-eyebrow'>Digital twin · Incubation SME</div>
            <h1>{business.businessName}</h1>
            <div className='dt-sub'>{[business.ownerName, business.sector, business.programName].filter(Boolean).join(' · ')}</div>
          </div>
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
          <div className='dt-panel'>
            <div className='dt-eyebrow'>On plan, funding-ready by</div>
            <div className='dt-date'>{twin.baseReady === null ? 'Not within 26 weeks' : longDate(weekDate(twin.baseReady))}</div>
            {anyMove && (
              <div className='dt-moved'>
                <span>With your moves</span>
                <strong>{twin.movesReady === null ? 'Not within 26 weeks' : longDate(weekDate(twin.movesReady))}</strong>
              </div>
            )}
            <div className='dt-fine'>Assumes open interventions are delivered on their due dates.</div>
          </div>
          <div className='dt-panel'>
            <div className='dt-eyebrow'>Needs attention · {level}</div>
            {reasons.map((reason) => <div key={reason.text} className='dt-reason'><i className={reason.good ? 'dt-good' : 'dt-warn'} aria-hidden='true' />{reason.text}</div>)}
            {peers && <div className='dt-fine'>Ahead of {peers.ahead} of {peers.others} peers in this programme and sector.</div>}
          </div>
          <div className='dt-panel dt-layers'>
            {layers.map((layer) => (
              <div key={layer.key} className='dt-layer' title={layer.source}>
                <i style={{ background: COLOR[layer.key], boxShadow: `0 0 8px ${COLOR[layer.key]}` }} aria-hidden='true' />
                <b>{layer.name}</b>
                <span>{layer.value}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className='dt-stage' aria-label='Twin core and time machine'>
          <div className='dt-readout' aria-live='polite'>
            <span>{active.offset < 0 ? 'Rebuilt from records' : active.offset === 0 ? 'Today' : anyMove ? 'With your moves' : 'On plan'}</span>
            <b>{longDate(active.date)}</b>
            <span>Funding readiness <strong>{active.funding}</strong>{active.band === 'ready' ? ' · ready' : ''}</span>
          </div>
          <div className='dt-scene'>
            <div className='dt-orbit-wrap'>
              <div className='dt-core'>
                <strong>{funding}</strong>
                <span>Funding readiness</span>
              </div>
              <div className='dt-orbit'>
                {layers.map((layer, index) => (
                  <div key={layer.key} className='dt-sat' style={{ '--a': `${index * 60}deg` } as CSSProperties}>
                    <div className='dt-sat-face'>
                      <i style={{ background: COLOR[layer.key], boxShadow: `0 0 10px ${COLOR[layer.key]}` }} aria-hidden='true' />
                      <b>{layer.name}</b>
                      <span>{layer.short}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className='dt-floor'>
              <div className='dt-grid-lines' aria-hidden='true' />
              <div className='dt-ready-plane' style={{ height: `${readyHeight}%` }} aria-hidden='true'><span>Funding-ready ({READY_SCORE})</span></div>
              <div className='dt-bars'>
                {series.map((week, index) => {
                  const future = week.offset > 0
                  const ready = week.band === 'ready'
                  const cls = ['dt-bar', future ? 'dt-bar-future' : '', future && anyMove ? 'dt-bar-moved' : '', ready ? 'dt-bar-ready' : '', week.offset === 0 ? 'dt-bar-today' : '', index === cursor ? 'dt-bar-active' : ''].filter(Boolean).join(' ')
                  return (
                    <button
                      key={week.offset}
                      type='button'
                      className={cls}
                      style={{ height: `${Math.max(3, week.funding)}%` }}
                      aria-label={`${shortDate(week.date)}: funding readiness ${week.funding}`}
                      onClick={() => { setPlaying(false); setCursor(index) }}
                    />
                  )
                })}
              </div>
            </div>
          </div>
        </section>

        <aside className='dt-side' aria-label='Moves'>
          <div className='dt-panel dt-moves'>
            <div className='dt-eyebrow'>Moves the twin has tried</div>
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
            {business.activity.slice(0, 3).map((item, index) => (
              <span key={`${item.title}-${item.at.getTime()}-${index}`} className={`dt-chip${index === 0 ? ' dt-new' : ''}`} title={item.detail}>
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
          {chat.map((message, index) => <div key={index} className={`dt-msg dt-msg-${message.from}`}>{message.text}</div>)}
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
