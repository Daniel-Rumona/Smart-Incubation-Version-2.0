import { useId, useState, type ReactNode } from 'react'
import { Empty, Progress, Segmented, Space, Tag, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, FileProtectOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import PlanOutcomeChips from '@/components/interventions/PlanOutcomeChips'
import { useLanguage } from '@/providers/LanguageProvider'
import { livePlanProgress, planStatusColor, stepStateColor, type LivePlanItem } from '@/utils/liveDiagnosticPlan'
import { evaluateSwot, summariseSwot, type SwotItem, type SwotOutcome } from '@/utils/swotOutcomes'
import '@/styles/participant-drawer.css'

const { Text } = Typography
const SPRING = { type: 'spring', stiffness: 380, damping: 32 } as const

/* ---------- Financial trend chart ---------- */

export type TrendRow = { period: string; value: number }

const W = 600
const H = 190
const PAD = { top: 16, right: 16, bottom: 26, left: 16 }

function TrendChart({ rows, prefix = '', color }: { rows: TrendRow[]; prefix?: string; color: string }) {
  const reduced = useReducedMotion()
  const gradientId = useId()
  const [hover, setHover] = useState<number | null>(null)
  if (!rows.length) return null

  const values = rows.map(row => row.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const x = (index: number) => PAD.left + (rows.length === 1 ? (W - PAD.left - PAD.right) / 2 : (index / (rows.length - 1)) * (W - PAD.left - PAD.right))
  const y = (value: number) => PAD.top + (1 - (value - min) / span) * (H - PAD.top - PAD.bottom)
  // Spline: each segment is a cubic curve with horizontal handles at the midpoint, so it flows smoothly
  // through every point without overshooting between them.
  const line = rows.map((row, index) => {
    const px = x(index)
    const py = y(row.value)
    if (!index) return `M${px.toFixed(1)},${py.toFixed(1)}`
    const mid = (x(index - 1) + px) / 2
    return `C${mid.toFixed(1)},${y(rows[index - 1].value).toFixed(1)} ${mid.toFixed(1)},${py.toFixed(1)} ${px.toFixed(1)},${py.toFixed(1)}`
  }).join(' ')
  const area = `${line} L${x(rows.length - 1).toFixed(1)},${H - PAD.bottom} L${x(0).toFixed(1)},${H - PAD.bottom} Z`
  const active = hover ?? rows.length - 1
  const format = (value: number) => `${prefix}${value.toLocaleString()}`

  return (
    <div className="pd-chart">
      <div className="pd-chart-readout">
        <span className="pd-chart-value">{format(rows[active].value)}</span>
        <Text type="secondary">{rows[active].period}</Text>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        className="pd-chart-svg"
        onMouseLeave={() => setHover(null)}
        onMouseMove={event => {
          const box = event.currentTarget.getBoundingClientRect()
          const position = ((event.clientX - box.left) / box.width) * W
          const index = Math.round(((position - PAD.left) / (W - PAD.left - PAD.right)) * (rows.length - 1))
          setHover(Math.max(0, Math.min(rows.length - 1, index)))
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity=".32" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path d={area} fill={`url(#${gradientId})`} initial={reduced ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.2 }} />
        <motion.path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={reduced ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
        />
        <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={H - PAD.bottom} stroke={color} strokeOpacity=".25" strokeDasharray="4 4" />
        <circle cx={x(active)} cy={y(rows[active].value)} r={5} fill={color} stroke="var(--ant-color-bg-container, #fff)" strokeWidth={2} />
        <text x={PAD.left} y={H - 6} className="pd-chart-axis">{rows[0].period}</text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="pd-chart-axis">{rows[rows.length - 1].period}</text>
      </svg>
    </div>
  )
}

/** Percentage change from the first to the last point, as a small up/down badge. */
function Change({ rows }: { rows: TrendRow[] }) {
  if (rows.length < 2 || !rows[0].value) return null
  const change = ((rows[rows.length - 1].value - rows[0].value) / Math.abs(rows[0].value)) * 100
  const up = change >= 0
  return <Tag color={up ? 'green' : 'red'} icon={up ? <ArrowUpOutlined /> : <ArrowDownOutlined />}>{Math.abs(Math.round(change))}%</Tag>
}

export function TrendCard({ title, monthly, annual, prefix, color, empty }: { title: string; monthly: TrendRow[]; annual: TrendRow[]; prefix?: string; color: string; empty: string }) {
  const { t } = useLanguage()
  const [range, setRange] = useState<'monthly' | 'annual'>('monthly')
  const rows = range === 'monthly' ? monthly : annual
  return (
    <div className="pd-panel">
      <div className="pd-panel-head">
        <Space size={8}>
          <Text strong>{title}</Text>
          <Change rows={rows} />
        </Space>
        <Segmented size="small" value={range} onChange={value => setRange(value as typeof range)} options={[{ value: 'monthly', label: t('Monthly') }, { value: 'annual', label: t('Annual') }]} />
      </div>
      {rows.length ? <TrendChart key={range} rows={rows} prefix={prefix} color={color} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={empty} />}
    </div>
  )
}

/* ---------- Interventions ---------- */

export function InterventionsPanel({ items }: { items: LivePlanItem[] }) {
  const { t } = useLanguage()
  const reduced = useReducedMotion()
  const overall = livePlanProgress(items)
  const completed = items.filter(item => item.status === 'Completed').length
  const inProgress = items.filter(item => item.status === 'In progress' || item.status === 'Awaiting confirmation').length

  return (
    <div className="pd-stack">
      <div className="pd-panel pd-summary">
        <Progress type="circle" size={72} percent={overall} strokeWidth={9} />
        <div>
          <Text strong>{t('Plan progress')}</Text>
          <div className="pd-summary-line">
            <Tag color="green">{completed} {t('completed')}</Tag>
            <Tag color="blue">{inProgress} {t('in progress')}</Tag>
            <Tag>{items.length - completed - inProgress} {t('not started')}</Tag>
          </div>
        </div>
      </div>

      {items.length ? (
        <div className="pd-stack">
          {items.map((item, index) => (
            <motion.div
              key={item.interventionId || item.title}
              className="pd-item"
              initial={reduced ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 8) * 0.04 }}
            >
              <div className="pd-item-head">
                <div className="pd-item-title">
                  <Text strong>{item.title}</Text>
                  {item.areaOfSupport ? <Tag>{item.areaOfSupport}</Tag> : null}
                </div>
                <Tag color={planStatusColor(item.status)}>{t(item.status)}</Tag>
              </div>
              <Progress percent={item.progress} size="small" status={item.status === 'Completed' ? 'success' : 'active'} />
              {item.stepRows.length > 1 ? (
                <div className="pd-steps">
                  {item.stepRows.map(step => (
                    <Tooltip key={step.key} title={`${step.label} · ${step.share}%`}>
                      <Tag color={stepStateColor(step.state)}>{step.title}</Tag>
                    </Tooltip>
                  ))}
                </div>
              ) : null}
              <PlanOutcomeChips outcome={item.outcome} />
            </motion.div>
          ))}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No required interventions found for this SME.')} />}

    </div>
  )
}

/* ---------- Compliance ---------- */

type ComplianceDoc = { type?: unknown; status?: unknown; currentStatus?: unknown }

const docTone = (status: string) => {
  const value = status.toLowerCase()
  if (['valid', 'approved'].includes(value)) return 'green'
  if (['expired', 'rejected', 'invalid', 'missing'].includes(value)) return 'red'
  return 'gold'
}

export function ComplianceOverview({ score, status, risk, riskColor, docs }: { score?: number; status?: ReactNode; risk?: ReactNode; riskColor: string; docs: ComplianceDoc[] }) {
  const { t } = useLanguage()
  const reduced = useReducedMotion()
  const ringColor = typeof score !== 'number' ? undefined : score >= 80 ? '#52c41a' : score >= 60 ? '#1677ff' : score >= 40 ? '#faad14' : '#ff4d4f'
  return (
    <div className="pd-compliance">
      <div className="pd-panel pd-summary pd-summary-vertical">
        {typeof score === 'number'
          ? <Progress type="circle" size={88} percent={score} strokeColor={ringColor} strokeWidth={9} />
          : <Progress type="circle" size={88} percent={0} format={() => '—'} />}
        <div>
          <Text strong>{t('Compliance Score')}</Text>
          <div className="pd-summary-line">
            {status ? <Tag>{status}</Tag> : null}
            {risk ? <Tag color={riskColor}>{risk} {t('risk')}</Tag> : null}
            <Tag icon={<FileProtectOutlined />}>{docs.length} {t('documents')}</Tag>
          </div>
        </div>
      </div>
      {docs.length ? (
        <div className="pd-doc-grid is-three">
          {docs.map((docItem, index) => {
            const status = String(docItem.currentStatus || docItem.status || 'unknown')
            return (
              <motion.div
                key={`${String(docItem.type || 'doc')}-${index}`}
                className="pd-doc"
                initial={reduced ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ ...SPRING, delay: reduced ? 0 : Math.min(index, 10) * 0.03 }}
              >
                <span className={`pd-dot is-${docTone(status)}`} />
                <div>
                  <Text strong>{String(docItem.type || 'Document')}</Text>
                  <div><Text type="secondary" style={{ textTransform: 'capitalize' }}>{status}</Text></div>
                </div>
              </motion.div>
            )
          })}
        </div>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No compliance documents yet')} />}
    </div>
  )
}

/* ---------- SWOT tab ---------- */

type Quadrant = 'strengths' | 'weaknesses' | 'opportunities' | 'threats'

const QUADRANTS: Array<{ key: Quadrant; label: string; tone: string; achieved: string }> = [
  { key: 'strengths', label: 'Strengths', tone: 'green', achieved: 'strengthened' },
  { key: 'weaknesses', label: 'Weaknesses', tone: 'orange', achieved: 'resolved' },
  { key: 'opportunities', label: 'Opportunities', tone: 'blue', achieved: 'captured' },
  { key: 'threats', label: 'Threats', tone: 'red', achieved: 'mitigated' },
]

const OUTCOME_TONE: Record<SwotOutcome['tone'], string> = { good: 'green', warn: 'gold', bad: 'red', neutral: 'default' }

const evidenceText = (outcome: SwotOutcome) => outcome.evidence.length
  ? outcome.evidence.map(row => `${row.title}: ${row.status}${row.result ? ` · ${row.result.replace('_', ' ')}` : ''}${row.note ? ` (${row.note})` : ''}`).join('\n')
  : 'No intervention in this area of support.'

/**
 * The SME's SWOT as four colour-coded panels. Points that are linked to an area of support also show what the
 * interventions in that area have achieved (resolved, mitigated, strengthened, captured, or where they stand).
 */
export function SwotTab({ swot, items, planItems }: { swot?: Partial<Record<Quadrant, unknown>>; items: SwotItem[]; planItems: LivePlanItem[] }) {
  const { t } = useLanguage()
  const outcomes = new Map(evaluateSwot(items, planItems).map(outcome => [`${outcome.item.quadrant}|${outcome.item.text}`, outcome]))
  const summary = summariseSwot([...outcomes.values()])
  const linked = QUADRANTS.filter(quadrant => summary[quadrant.key].total)

  return (
    <div className="pd-stack">
      {linked.length ? (
        <div className="pd-panel pd-swot-summary">
          {linked.map(quadrant => (
            <Text key={quadrant.key} type="secondary">
              <Text strong>{summary[quadrant.key].achieved}/{summary[quadrant.key].total}</Text> {t(quadrant.label).toLowerCase()} {t(quadrant.achieved)}
            </Text>
          ))}
        </div>
      ) : null}
      <div className="pd-swot">
        {QUADRANTS.map(quadrant => {
          const list = Array.isArray(swot?.[quadrant.key]) ? (swot?.[quadrant.key] as string[]) : []
          return (
            <div key={quadrant.key} className={`pd-swot-cell is-${quadrant.tone}`}>
              <Text strong>{t(quadrant.label)}</Text>
              {list.length ? (
                <ul>
                  {list.map(entry => {
                    const outcome = outcomes.get(`${quadrant.key}|${entry}`)
                    return (
                      <li key={entry}>
                        <span>{entry}</span>
                        {outcome ? (
                          <div className="pd-swot-outcome">
                            <Tag>{outcome.item.areaOfSupport}</Tag>
                            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{evidenceText(outcome)}</span>}>
                              <Tag color={OUTCOME_TONE[outcome.tone]}>{t(outcome.label)}</Tag>
                            </Tooltip>
                          </div>
                        ) : null}
                      </li>
                    )
                  })}
                </ul>
              ) : <div><Text type="secondary">—</Text></div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
