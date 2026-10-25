import { useEffect, useMemo, useState } from 'react'
import { Empty, Input, Pagination, Select, Typography } from 'antd'
import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FundOutlined,
  RightOutlined,
  SearchOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { NEON_GREEN, NEON_PURPLE, SummaryModal, type SummaryDetail } from '@/components/shared/SummaryModal'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useLanguage } from '@/providers/LanguageProvider'
import {
  assignmentParticipant,
  assignmentProgram,
  assignmentTitle,
  deriveConsultantStatus,
  isOverdueAssignment,
  progressForAssignment,
  toDate,
} from './ConsultantWorkspaceUtils'
import '@/styles/consultant.css'
import '@/styles/consultant-smes.css'

const { Text } = Typography

const PAGE_SIZE = 12

type SmeRow = {
  key: string
  name: string
  programs: string[]
  sector: string
  /** Engagements still in play: declined and cancelled work is left out of every count. */
  assignments: number
  completed: number
  active: number
  pending: number
  overdue: number
  averageProgress: number
  upcoming: Array<{ title: string; due: Date }>
}

type SortKey = 'attention' | 'progress' | 'name' | 'engagements'

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

const SEGMENTS: Array<{ key: 'completed' | 'active' | 'pending' | 'overdue', label: string }> = [
  { key: 'completed', label: 'Completed' },
  { key: 'active', label: 'In progress' },
  { key: 'pending', label: 'Not started' },
  { key: 'overdue', label: 'Overdue' },
]

export default function ConsultantSmesPage() {
  const { t } = useLanguage()
  const { assignments, isMine, loading, refresh } = useAssignedInterventions()
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('All')
  const [sortKey, setSortKey] = useState<SortKey>('attention')
  const [page, setPage] = useState(1)
  const [detail, setDetail] = useState<SummaryDetail | null>(null)

  useEffect(() => { void refresh() }, [refresh])

  const rows = useMemo<SmeRow[]>(() => {
    const groups = new Map<string, { name: string; programs: Set<string>; sector: string; list: AssignedIntervention[] }>()
    assignments.filter(isMine).forEach((assignment) => {
      const name = assignmentParticipant(assignment)
      // The participant id keeps two businesses with the same name apart; the name is only a fallback.
      const key = String(assignment.participantId || '').trim() || `name:${name.trim().toLowerCase()}`
      const current = groups.get(key) || { name, programs: new Set<string>(), sector: '', list: [] }
      const sector = String((assignment as unknown as Record<string, unknown>).sector || '').trim()
      if (sector && !current.sector) current.sector = sector
      const program = assignmentProgram(assignment)
      if (program) current.programs.add(program)
      current.list.push(assignment)
      groups.set(key, current)
    })

    return Array.from(groups.entries()).map(([key, group]) => {
      const statuses = group.list
        .map((assignment) => ({ assignment, status: deriveConsultantStatus(assignment) }))
        .filter(({ status }) => status !== 'Rejected')
        .map((item) => ({ ...item, progress: progressForAssignment(item.assignment, item.status), overdue: isOverdueAssignment(item.assignment) }))
      return {
        key,
        name: group.name,
        programs: [...group.programs],
        sector: group.sector,
        assignments: statuses.length,
        completed: statuses.filter(({ status }) => status === 'Completed').length,
        active: statuses.filter(({ status, overdue }) => status === 'In progress' && !overdue).length,
        pending: statuses.filter(({ status, overdue }) => status === 'Pending' && !overdue).length,
        overdue: statuses.filter(({ overdue }) => overdue).length,
        averageProgress: Math.round(statuses.reduce((sum, item) => sum + item.progress, 0) / Math.max(statuses.length, 1)),
        upcoming: statuses
          .filter(({ status }) => status !== 'Completed')
          .map(({ assignment }) => ({ title: assignmentTitle(assignment), due: toDate(assignment.dueDate) }))
          .filter((item): item is { title: string; due: Date } => !!item.due)
          .sort((left, right) => left.due.getTime() - right.due.getTime()),
      }
    }).filter((row) => row.assignments > 0)
  }, [assignments, isMine])

  const sectors = useMemo(() => ['All', ...Array.from(new Set(rows.map((row) => row.sector).filter(Boolean))).sort()], [rows])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matches = rows.filter((row) => (!term || row.name.toLowerCase().includes(term)) && (sector === 'All' || row.sector === sector))
    const sorters: Record<SortKey, (left: SmeRow, right: SmeRow) => number> = {
      attention: (left, right) => right.overdue - left.overdue || left.averageProgress - right.averageProgress,
      progress: (left, right) => right.averageProgress - left.averageProgress,
      name: (left, right) => left.name.localeCompare(right.name),
      engagements: (left, right) => right.assignments - left.assignments,
    }
    return [...matches].sort(sorters[sortKey])
  }, [rows, search, sector, sortKey])

  // A refresh can shrink the list under the current page; fall back to the last page that exists.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pagedRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const totals = useMemo(() => {
    const engagements = rows.reduce((sum, row) => sum + row.assignments, 0)
    return {
      smes: rows.length,
      active: rows.reduce((sum, row) => sum + row.active + row.overdue, 0),
      overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
      progress: engagements ? Math.round(rows.reduce((sum, row) => sum + row.averageProgress * row.assignments, 0) / engagements) : 0,
    }
  }, [rows])

  const atRisk = useMemo(() => rows.filter((row) => row.overdue > 0).sort((left, right) => right.overdue - left.overdue), [rows])

  const openDetail = (row: SmeRow) => {
    const completionRate = row.assignments ? Math.round((row.completed / row.assignments) * 100) : 0
    const progressDiff = row.averageProgress - totals.progress
    const next = row.upcoming.slice(0, 3)
    setDetail({
      title: row.name,
      subtitle: [row.sector, ...row.programs].filter(Boolean).join(' · ') || t('Not specified'),
      center: { value: String(row.assignments), label: row.assignments === 1 ? t('Engagement') : t('Engagements') },
      outer: { value: row.averageProgress, color: NEON_PURPLE, label: t('Overall progress') },
      inner: { value: completionRate, color: NEON_GREEN, label: t('Completion') },
      left: [
        {
          icon: <FundOutlined />,
          label: t('Overall progress'),
          value: `${row.averageProgress}%`,
          delta: { text: t('{sign}{points} pts', undefined, { sign: progressDiff > 0 ? '+' : '', points: progressDiff }), positive: progressDiff >= 0 },
          note: t('Compared to {percent}% across all your SMEs', undefined, { percent: totals.progress }),
        },
        {
          icon: <CheckCircleOutlined />,
          label: t('Completed'),
          value: `${row.completed}/${row.assignments}`,
          note: t('{percent}% of engagements delivered', undefined, { percent: completionRate }),
        },
      ],
      right: [
        { icon: <ClockCircleOutlined />, label: t('In progress'), value: String(row.active), note: t('{count} waiting to start', undefined, { count: row.pending }) },
        {
          icon: <WarningOutlined />,
          label: t('Overdue'),
          value: String(row.overdue),
          note: row.overdue ? t('Needs your attention') : t('Nothing overdue'),
        },
      ],
      leftBottom: [],
      rightBottomTitle: t('Next due'),
      rightBottom: next.length
        ? next.map((item) => ({ label: item.title, value: dayjs(item.due).format('DD MMM') }))
        : [{ label: t('Nothing scheduled'), value: '—' }],
    })
  }

  const rowMeta = (row: SmeRow) => {
    const parts = [
      row.assignments === 1 ? t('1 engagement') : t('{count} engagements', undefined, { count: row.assignments }),
      `${row.averageProgress}%`,
    ]
    if (!row.overdue && row.upcoming[0]) parts.push(t('next due {date}', undefined, { date: dayjs(row.upcoming[0].due).format('D MMM') }))
    return parts.join(' · ')
  }

  if (loading && !assignments.length) return <PageSkeleton variant="table" label={t('Loading your SMEs')} />

  return (
    <DashboardPage className="consultant-page consultant-smes-page">
      <section className="smes-summary">
        <DashboardMetricCard icon={<TeamOutlined />} label={t('My SMEs')} value={totals.smes} />
        <DashboardMetricCard icon={<CalendarOutlined />} label={t('Active engagements')} value={totals.active} />
        <DashboardMetricCard icon={<FundOutlined />} label={t('Avg progress')} value={`${totals.progress}%`} />
        <DashboardMetricCard icon={<WarningOutlined />} iconClassName={totals.overdue ? 'is-risk' : undefined} label={t('Overdue')} value={totals.overdue} />
      </section>

      {atRisk.length > 0 && (
        <section className="smes-attention">
          <span className="smes-attention-eyebrow"><ArrowRightOutlined /> {t('Needs your attention')}</span>
          <div className="smes-attention-body">
            <Text strong className="smes-attention-title">
              {atRisk.length === 1 ? t('1 SME has overdue work') : t('{count} SMEs have overdue work', undefined, { count: atRisk.length })}
            </Text>
            <div className="smes-attention-list">
              {atRisk.slice(0, 4).map((row) => (
                <button key={row.key} type="button" className="smes-attention-pill" onClick={() => openDetail(row)}>
                  {row.name} · {row.overdue === 1 ? t('1 overdue') : t('{count} overdue', undefined, { count: row.overdue })}
                </button>
              ))}
              {atRisk.length > 4 && <Text type="secondary">{t('and {count} more', undefined, { count: atRisk.length - 4 })}</Text>}
            </div>
          </div>
        </section>
      )}

      {rows.length > 0 && (
        <FilterBar
          primary={(
            <>
              <Input prefix={<SearchOutlined />} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t('Search SMEs')} allowClear />
              <Select value={sector} onChange={(value) => { setSector(value); setPage(1) }} options={sectors.map((value) => ({ value, label: value === 'All' ? t('All sectors') : value }))} />
              <Select
                value={sortKey}
                onChange={(value) => { setSortKey(value); setPage(1) }}
                options={[
                  { value: 'attention', label: t('Needs attention first') },
                  { value: 'progress', label: t('Most progress first') },
                  { value: 'engagements', label: t('Most engagements first') },
                  { value: 'name', label: t('Name, A to Z') },
                ]}
              />
            </>
          )}
        />
      )}

      {!rows.length ? (
        <section className="smes-empty">
          <TeamOutlined className="smes-empty-icon" />
          <Text strong>{t('No SMEs yet')}</Text>
          <Text type="secondary">{t('SMEs will appear here once work is assigned to you.')}</Text>
        </section>
      ) : !filtered.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SMEs match your search or filters.')} />
      ) : (
        <>
          <ul className="smes-list">
            {pagedRows.map((row) => (
              <li key={row.key}>
                <button type="button" className={`smes-row${row.overdue ? ' is-risk' : ''}`} onClick={() => openDetail(row)}>
                  <span className="smes-avatar" aria-hidden="true">{initialsOf(row.name)}</span>
                  <span className="smes-row-main">
                    <Text strong className="smes-row-name">{row.name}</Text>
                    <Text type="secondary" className="smes-row-sub">{[row.sector, row.programs[0]].filter(Boolean).join(' · ') || t('Not specified')}</Text>
                  </span>
                  <span className="smes-row-progress">
                    <span className="smes-bar" role="img" aria-label={SEGMENTS.map((segment) => `${t(segment.label)}: ${row[segment.key]}`).join(', ')}>
                      {SEGMENTS.filter((segment) => row[segment.key] > 0).map((segment) => (
                        <span key={segment.key} className={`smes-bar-segment is-${segment.key}`} style={{ flex: row[segment.key] }} />
                      ))}
                    </span>
                    <Text type="secondary" className="smes-row-meta">
                      {rowMeta(row)}
                      {row.overdue > 0 && <span className="smes-row-overdue"> · {row.overdue === 1 ? t('1 overdue') : t('{count} overdue', undefined, { count: row.overdue })}</span>}
                    </Text>
                  </span>
                  <RightOutlined className="smes-row-chevron" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > PAGE_SIZE && (
            <div className="smes-pagination">
              <Pagination current={currentPage} pageSize={PAGE_SIZE} total={filtered.length} showSizeChanger={false} onChange={setPage} />
            </div>
          )}
        </>
      )}

      <SummaryModal detail={detail} onClose={() => setDetail(null)} />
    </DashboardPage>
  )
}
