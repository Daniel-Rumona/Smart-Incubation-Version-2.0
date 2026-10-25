import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { App, Avatar, Button, Card, Col, Empty, Grid, Input, Progress, Row, Segmented, Select, Skeleton, Space, Tag, Typography } from 'antd'
import {
  ArrowLeftOutlined, CheckCircleFilled, CheckCircleOutlined, ClockCircleFilled, ClockCircleOutlined, CloseCircleFilled, MailOutlined,
  MinusCircleFilled, PhoneOutlined, RightOutlined, SearchOutlined, TeamOutlined, WarningOutlined,
} from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadControlTower, type ControlTowerSme } from '@/services/controlTowerService'
import { BAND_LABEL, TRACK_LABEL, type Gate, type GateState, type ReadinessBand, type ReadinessTrack, type TrackKey } from '@/utils/readiness'
import { initialsOf } from '@/utils/initials'
import '@/styles/control-tower.css'

const { Text } = Typography

const BAND_COLOR: Record<ReadinessBand, string> = { ready: 'green', almost: 'gold', not_ready: 'red' }
const GATE_ICON: Record<GateState, ReactNode> = {
  met: <CheckCircleFilled className="ct-gate-icon is-met" />,
  partial: <ClockCircleFilled className="ct-gate-icon is-partial" />,
  missing: <CloseCircleFilled className="ct-gate-icon is-missing" />,
  unknown: <MinusCircleFilled className="ct-gate-icon is-unknown" />,
}
const SPRING = { type: 'spring', stiffness: 380, damping: 32 } as const

type SortKey = 'attention' | 'ready' | 'name'
const money = (value: number | null) => (value === null ? '—' : `R ${value.toLocaleString()}`)

/* ---------- detail panel ---------- */

function GateList({ track }: { track: ReadinessTrack }) {
  const { t } = useLanguage()
  return (
    <ul className="ct-gates">
      {track.gates.map((gate: Gate) => (
        <li key={gate.key} className="ct-gate">
          {GATE_ICON[gate.state]}
          <div>
            <div className="ct-gate-title">
              <Text strong>{t(gate.label)}</Text>
              {gate.critical ? <Tag className="ct-required">{t('Required')}</Tag> : null}
            </div>
            <Text type="secondary" className="ct-gate-detail">{t(gate.detail)}</Text>
          </div>
        </li>
      ))}
    </ul>
  )
}

function TrackCard({ trackKey, track, focused }: { trackKey: TrackKey; track: ReadinessTrack; focused: boolean }) {
  const { t } = useLanguage()
  return (
    <Card className={`ct-card ct-track${focused ? ' is-focused' : ''}`} title={t(TRACK_LABEL[trackKey])} extra={<Tag color={BAND_COLOR[track.band]}>{t(BAND_LABEL[track.band])}</Tag>}>
      <div className="ct-track-head">
        {track.score === null ? <Progress type="circle" size={64} percent={0} format={() => '—'} /> : <Progress type="circle" size={64} percent={track.score} strokeWidth={9} />}
        <Text type="secondary">
          {track.band === 'ready'
            ? t('Every required gate is met.')
            : t('Ready needs every required gate met and a score of 75 or more.')}
        </Text>
      </div>
      <GateList track={track} />
    </Card>
  )
}

function SmeDetail({ sme, lens, onBack }: { sme: ControlTowerSme; lens: TrackKey; onBack?: () => void }) {
  const { t } = useLanguage()
  const { nextSteps } = sme.readiness
  // The tax gate sits in both tracks; under the track being viewed it belongs to that track. That track's steps come first.
  const steps = nextSteps
    .map(step => ({ ...step, track: sme.readiness[lens].gates.some(gate => gate.key === step.gate.key) ? lens : step.track }))
    .sort((a, b) => Number(b.track === lens) - Number(a.track === lens))
  const tiles = [
    { key: 'revenue', label: t('Revenue'), value: money(sme.revenueLatest), hint: sme.revenueChange === null ? undefined : `${sme.revenueChange >= 0 ? '+' : ''}${sme.revenueChange}% ${t('since first record')}` },
    { key: 'compliance', label: t('Compliance'), value: sme.complianceScore === null ? '—' : `${sme.complianceScore}%`, hint: sme.complianceTotal ? `${sme.complianceValid} ${t('of')} ${sme.complianceTotal} ${t('documents valid')}` : t('No documents yet') },
    { key: 'plan', label: t('Growth plan'), value: `${sme.planProgress}%`, hint: `${sme.planCompleted}/${sme.planTotal} ${t('completed')}` },
    { key: 'years', label: t('Years trading'), value: sme.yearsOfTrading === undefined ? '—' : String(sme.yearsOfTrading), hint: sme.stage },
  ]

  return (
    <div className="ct-detail">
      {onBack ? <Button icon={<ArrowLeftOutlined />} onClick={onBack} className="ct-back">{t('All SMEs')}</Button> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card className="ct-card ct-hero" styles={{ body: { padding: 0, height: '100%' } }}>
            <div className="ct-hero-media" style={sme.imageUrl ? { backgroundImage: `url("${sme.imageUrl}")` } : undefined}>
              {sme.imageUrl ? null : <span className="ct-hero-initials">{initialsOf(sme.businessName)}</span>}
              <div className="ct-hero-info">
                <div className="ct-hero-text">
                  <div className="ct-hero-name">{sme.businessName}</div>
                  {sme.ownerName ? <div className="ct-hero-sub">{sme.ownerName}</div> : null}
                </div>
                <Space size={8}>
                  {sme.email ? <Button shape="circle" icon={<MailOutlined />} href={`mailto:${sme.email}`} aria-label={t('Email')} /> : null}
                  {sme.phone ? <Button shape="circle" icon={<PhoneOutlined />} href={`tel:${sme.phone}`} aria-label={t('Call')} /> : null}
                </Space>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={14}>
          <div className="ct-tiles">
            {tiles.map(tile => (
              <div key={tile.key} className="ct-tile">
                <Text type="secondary" className="ct-tile-label">{tile.label}</Text>
                <div className="ct-tile-value">{tile.value}</div>
                {tile.hint ? <Text type="secondary" className="ct-tile-hint">{tile.hint}</Text> : null}
              </div>
            ))}
          </div>
        </Col>
        <Col xs={24} lg={12}><TrackCard trackKey="funding" track={sme.readiness.funding} focused={lens === 'funding'} /></Col>
        <Col xs={24} lg={12}><TrackCard trackKey="market" track={sme.readiness.market} focused={lens === 'market'} /></Col>
        <Col xs={24}>
          <Card className="ct-card" title={t('Next steps')}>
            {steps.length ? (
              <div className="ct-steps">
                {steps.map(step => (
                  <div key={step.gate.key} className="ct-step">
                    <Space size={6} wrap>
                      <Tag color={step.track === 'funding' ? 'purple' : 'blue'}>{t(TRACK_LABEL[step.track])}</Tag>
                      {step.gate.critical ? <Tag color="red">{t('Required')}</Tag> : null}
                    </Space>
                    <Text strong>{t(step.gate.action || step.gate.label)}</Text>
                    <Text type="secondary">{t(step.gate.label)}: {t(step.gate.detail)}</Text>
                  </div>
                ))}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nothing outstanding. This SME meets every gate that has evidence.')} />}
          </Card>
        </Col>
      </Row>
    </div>
  )
}

/* ---------- page ---------- */

export default function SmeControlTowerPage() {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const reduced = useReducedMotion()
  const { user } = useFullIdentity()
  const { activeProgramId } = useActiveProgramId()
  // The URL only decides which SME is open when the page is entered (from the participants table). After that the
  // selection is page state, so choosing another SME never remounts the page or reloads the list and counts.
  const { participantId: routeParticipantId } = useParams<{ participantId?: string }>()
  const [selectedId, setSelectedId] = useState<string | null>(routeParticipantId ?? null)
  const screens = Grid.useBreakpoint()
  const isCompact = !screens.lg

  const [smes, setSmes] = useState<ControlTowerSme[] | null>(null)
  const [lens, setLens] = useState<TrackKey>('funding')
  const [search, setSearch] = useState('')
  const [bandFilter, setBandFilter] = useState<ReadinessBand | 'all'>('all')
  const [blockerFilter, setBlockerFilter] = useState<string | null>(null)
  const [sort, setSort] = useState<SortKey>('attention')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    loadControlTower(user, activeProgramId)
      .then(rows => { if (!cancelled) setSmes(rows) })
      .catch(() => { if (!cancelled) { setSmes([]); message.error(t('The control tower could not be loaded.')) } })
    return () => { cancelled = true }
  }, [user, activeProgramId]) // eslint-disable-line react-hooks/exhaustive-deps

  const loading = smes === null
  const all = useMemo(() => smes || [], [smes])
  const trackOf = (sme: ControlTowerSme) => sme.readiness[lens]

  const counts = useMemo(() => ({
    ready: all.filter(sme => sme.readiness[lens].band === 'ready').length,
    almost: all.filter(sme => sme.readiness[lens].band === 'almost').length,
    not_ready: all.filter(sme => sme.readiness[lens].band === 'not_ready').length,
  }), [all, lens])

  // The gates most SMEs are stuck on, for the lens being viewed.
  const blockers = useMemo(() => {
    const tally = new Map<string, { label: string; count: number }>()
    all.forEach(sme => sme.readiness[lens].gates.forEach(gate => {
      if (gate.state !== 'missing' && gate.state !== 'partial') return
      tally.set(gate.key, { label: gate.label, count: (tally.get(gate.key)?.count || 0) + 1 })
    }))
    return [...tally.entries()].map(([key, value]) => ({ key, ...value })).sort((a, b) => b.count - a.count).slice(0, 5)
  }, [all, lens])

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = all.filter(sme => {
      if (needle && ![sme.businessName, sme.ownerName, sme.sector, sme.city, sme.province].some(value => String(value || '').toLowerCase().includes(needle))) return false
      const track = sme.readiness[lens]
      if (bandFilter !== 'all' && track.band !== bandFilter) return false
      if (blockerFilter && !track.gates.some(gate => gate.key === blockerFilter && (gate.state === 'missing' || gate.state === 'partial'))) return false
      return true
    })
    const score = (sme: ControlTowerSme) => sme.readiness[lens].score ?? -1
    return [...list].sort((a, b) => sort === 'name' ? a.businessName.localeCompare(b.businessName) : sort === 'ready' ? score(b) - score(a) : score(a) - score(b))
  }, [all, search, bandFilter, blockerFilter, sort, lens])

  const selected = all.find(sme => sme.id === selectedId) || (isCompact ? undefined : visible[0])
  const open = (id: string) => setSelectedId(id)
  const toggleBand = (band: ReadinessBand | 'all') => setBandFilter(current => (current === band ? 'all' : band))

  const showList = !isCompact || !selectedId
  const showDetail = !isCompact || Boolean(selectedId)

  return (
    <DashboardPage className="control-tower">
      <Row gutter={[12, 12]} className="dashboard-metrics-row">
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('All SMEs')} value={all.length} clickable active={bandFilter === 'all'} onClick={() => setBandFilter('all')} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} iconClassName="is-delivery" label={t(BAND_LABEL.ready)} value={counts.ready} clickable active={bandFilter === 'ready'} onClick={() => toggleBand('ready')} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ClockCircleOutlined />} label={t(BAND_LABEL.almost)} value={counts.almost} clickable active={bandFilter === 'almost'} onClick={() => toggleBand('almost')} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<WarningOutlined />} iconClassName="is-attention" label={t(BAND_LABEL.not_ready)} value={counts.not_ready} clickable active={bandFilter === 'not_ready'} onClick={() => toggleBand('not_ready')} /></Col>
      </Row>

      <Card className="ct-card ct-blockers">
        <Segmented
          className="ct-lens"
          value={lens}
          onChange={value => { setLens(value as TrackKey); setBandFilter('all'); setBlockerFilter(null) }}
          options={[{ value: 'funding', label: t('Funding readiness') }, { value: 'market', label: t('Market linkage') }]}
        />
        <Text strong>{t('Top blockers')}</Text>
        {loading ? <Skeleton.Input active size="small" block /> : blockers.length ? (
          <div className="ct-blocker-row">
            {blockers.map(blocker => (
              <button key={blocker.key} type="button" className={`ct-blocker${blockerFilter === blocker.key ? ' is-active' : ''}`} onClick={() => setBlockerFilter(current => (current === blocker.key ? null : blocker.key))}>
                {t(blocker.label)} <strong>{blocker.count}</strong>
              </button>
            ))}
          </div>
        ) : <Text type="secondary">{t('No SME is held back by a gate right now.')}</Text>}
      </Card>

      <div className="ct-split">
        {showList ? (
          <Card className="ct-card ct-list-card">
            <Space.Compact block className="ct-list-controls">
              <Input prefix={<SearchOutlined />} placeholder={t('Search SMEs')} value={search} allowClear onChange={event => setSearch(event.target.value)} />
              <Select value={sort} onChange={setSort} style={{ minWidth: 170 }} options={[{ value: 'attention', label: t('Needs attention first') }, { value: 'ready', label: t('Most ready first') }, { value: 'name', label: t('Name') }]} />
            </Space.Compact>
            <div className="ct-list">
              {loading ? Array.from({ length: 7 }, (_, index) => (
                <div key={index} className="ct-row is-skeleton">
                  <Skeleton.Avatar active size={40} />
                  <div className="ct-row-main">
                    <Skeleton.Input active size="small" style={{ width: '55%', minWidth: 0 }} />
                    <Skeleton.Input active size="small" style={{ width: '35%', minWidth: 0 }} />
                  </div>
                  <Skeleton.Button active size="small" style={{ width: 92, minWidth: 0 }} />
                </div>
              )) : visible.length ? visible.map((sme, index) => {
                const track = trackOf(sme)
                return (
                  <motion.button
                    key={sme.id}
                    type="button"
                    className={`ct-row${selected?.id === sme.id ? ' is-selected' : ''}`}
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 10) * 0.03 }}
                    onClick={() => open(sme.id)}
                  >
                    <Avatar size={40} src={sme.imageUrl}>{initialsOf(sme.businessName)}</Avatar>
                    <div className="ct-row-main">
                      <Text strong ellipsis>{sme.businessName}</Text>
                      <Text type="secondary" ellipsis className="ct-row-sub">{[sme.sector, sme.city].filter(Boolean).join(' · ')}</Text>
                    </div>
                    <Tag color={BAND_COLOR[track.band]} className="ct-row-chip">{t(BAND_LABEL[track.band])}{track.score !== null ? ` · ${track.score}%` : ''}</Tag>
                    <RightOutlined className="ct-row-arrow" />
                  </motion.button>
                )
              }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SMEs match these filters')} />}
            </div>
          </Card>
        ) : null}

        {showDetail ? (
          <div className="ct-detail-wrap">
            {loading ? <Card className="ct-card"><Skeleton active avatar paragraph={{ rows: 8 }} /></Card> : selected ? (
              <AnimatePresence mode="wait" initial={false}>
                <motion.div key={selected.id} initial={reduced ? false : { opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={reduced ? undefined : { opacity: 0, x: -16 }} transition={{ duration: 0.2, ease: 'easeOut' }}>
                  <SmeDetail sme={selected} lens={lens} onBack={isCompact ? () => setSelectedId(null) : undefined} />
                </motion.div>
              </AnimatePresence>
            ) : <Card className="ct-card"><Empty description={t('Select an SME to see where it stands.')} /></Card>}
          </div>
        ) : null}
      </div>
    </DashboardPage>
  )
}
