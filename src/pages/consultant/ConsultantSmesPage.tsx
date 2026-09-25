import { useEffect, useMemo, useState } from 'react'
import { Avatar, Card, Col, Empty, Input, Pagination, Progress, Row, Select, Space, Tag, Typography, theme } from 'antd'
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FundOutlined,
  SearchOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
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

const { Text } = Typography

const PAGE_SIZE = 6
const STATUS_COLORS = { completed: '#16A34A', active: '#2563EB', pending: '#F59E0B', overdue: '#E07A7A' }

type SmeRow = {
  key: string
  name: string
  programs: string[]
  sector: string
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

const StatusBar = ({ row }: { row: SmeRow }) => {
  const segments = [
    { key: 'completed', value: row.completed, color: STATUS_COLORS.completed },
    { key: 'active', value: row.active, color: STATUS_COLORS.active },
    { key: 'pending', value: row.pending, color: STATUS_COLORS.pending },
    { key: 'overdue', value: row.overdue, color: STATUS_COLORS.overdue },
  ].filter((segment) => segment.value > 0)
  return (
    <div style={{ display: 'flex', height: 8, borderRadius: 999, overflow: 'hidden', gap: 2 }}>
      {segments.map((segment) => <div key={segment.key} style={{ flex: segment.value, background: segment.color }} title={`${segment.key}: ${segment.value}`} />)}
    </div>
  )
}

const SmeCard = ({ row, onClick }: { row: SmeRow; onClick: () => void }) => {
  const { token } = theme.useToken()
  const { t } = useLanguage()
  const accent = row.overdue > 0 ? STATUS_COLORS.overdue : row.averageProgress >= 75 ? STATUS_COLORS.completed : STATUS_COLORS.active
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        padding: 16,
        borderRadius: 16,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgContainer,
        boxShadow: token.boxShadowTertiary,
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar size={44} shape="circle" style={{ flexShrink: 0, background: accent, color: '#fff', fontWeight: 600 }}>{initialsOf(row.name)}</Avatar>
        <div style={{ minWidth: 0, flex: 1 }}>
          <Text strong ellipsis style={{ display: 'block', fontSize: 15 }}>{row.name}</Text>
          <Space size={4} wrap style={{ marginTop: 2 }}>
            {row.sector && <Tag bordered={false} style={{ margin: 0 }}>{row.sector}</Tag>}
            {row.programs.slice(0, 1).map((program) => <Tag key={program} bordered={false} style={{ margin: 0 }}>{program}</Tag>)}
          </Space>
        </div>
        <Progress type="circle" size={52} percent={row.averageProgress} strokeColor={accent} format={(value) => `${value}%`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: t('Engagements'), value: row.assignments },
          { label: t('Active'), value: row.active },
          { label: t('Overdue'), value: row.overdue, color: row.overdue ? STATUS_COLORS.overdue : undefined },
        ].map((stat) => (
          <div key={stat.label} style={{ padding: '8px 10px', borderRadius: 10, background: token.colorFillQuaternary }}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{stat.label}</Text>
            <Text strong style={{ fontSize: 16, color: stat.color }}>{stat.value}</Text>
          </div>
        ))}
      </div>

      <div>
        <StatusBar row={row} />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 6 }}>
          {row.completed} {t('completed')} · {row.pending} {t('pending')}
        </Text>
      </div>
    </button>
  )
}

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
      const key = name.trim().toLowerCase()
      const current = groups.get(key) || { name, programs: new Set<string>(), sector: '', list: [] }
      const sector = String((assignment as unknown as Record<string, unknown>).sector || '').trim()
      if (sector && !current.sector) current.sector = sector
      const program = assignmentProgram(assignment)
      if (program) current.programs.add(program)
      current.list.push(assignment)
      groups.set(key, current)
    })

    return Array.from(groups.entries()).map(([key, group]) => {
      const items = group.list
      const statuses = items.map((assignment) => ({ assignment, status: deriveConsultantStatus(assignment), progress: progressForAssignment(assignment) }))
      const overdue = statuses.filter(({ assignment, status }) => status !== 'Completed' && isOverdueAssignment(assignment))
      return {
        key,
        name: group.name,
        programs: [...group.programs],
        sector: group.sector,
        assignments: items.length,
        completed: statuses.filter(({ status }) => status === 'Completed').length,
        active: statuses.filter(({ status, assignment }) => status === 'In progress' && !isOverdueAssignment(assignment)).length,
        pending: statuses.filter(({ status, assignment }) => status === 'Pending' && !isOverdueAssignment(assignment)).length,
        overdue: overdue.length,
        averageProgress: Math.round(statuses.reduce((sum, item) => sum + item.progress, 0) / Math.max(items.length, 1)),
        upcoming: statuses
          .filter(({ status }) => status !== 'Completed')
          .map(({ assignment }) => ({ title: assignmentTitle(assignment), due: toDate(assignment.dueDate) }))
          .filter((item): item is { title: string; due: Date } => !!item.due)
          .sort((left, right) => left.due.getTime() - right.due.getTime()),
      }
    })
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

  const pagedRows = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page])

  const totals = useMemo(() => {
    const engagements = rows.reduce((sum, row) => sum + row.assignments, 0)
    return {
      smes: rows.length,
      engagements,
      active: rows.reduce((sum, row) => sum + row.active, 0),
      overdue: rows.reduce((sum, row) => sum + row.overdue, 0),
      progress: engagements ? Math.round(rows.reduce((sum, row) => sum + row.averageProgress * row.assignments, 0) / engagements) : 0,
    }
  }, [rows])

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
          delta: { text: `${progressDiff > 0 ? '+' : ''}${progressDiff} pts`, positive: progressDiff >= 0 },
          note: `${t('Compared to')} ${totals.progress}% ${t('across all your SMEs')}`,
        },
        {
          icon: <CheckCircleOutlined />,
          label: t('Completed'),
          value: `${row.completed}/${row.assignments}`,
          note: `${completionRate}% ${t('of engagements delivered')}`,
        },
      ],
      right: [
        { icon: <ClockCircleOutlined />, label: t('In progress'), value: String(row.active), note: `${row.pending} ${t('waiting to start')}` },
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

  return (
    <DashboardPage className="consultant-page">
      <Row gutter={[12, 12]} className="dashboard-metrics-row">
        <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('My SMEs')} value={totals.smes} /></Col>
        <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<CalendarOutlined />} label={t('Engagements')} value={totals.engagements} hint={`${totals.active} ${t('active')}`} /></Col>
        <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<FundOutlined />} label={t('Avg progress')} value={`${totals.progress}%`} /></Col>
        {(loading || totals.overdue > 0) && <Col xs={12} lg={{ flex: 1 }}><DashboardMetricCard loading={loading} icon={<WarningOutlined />} iconClassName="is-risk" label={t('Overdue')} value={totals.overdue} /></Col>}
      </Row>

      <FilterBar
        primary={(
          <>
            <Input prefix={<SearchOutlined />} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder={t('Search SMEs')} allowClear />
            <Select value={sector} onChange={(value) => { setSector(value); setPage(1) }} options={sectors.map((value) => ({ value, label: value === 'All' ? t('All sectors') : value }))} />
            <Select
              value={sortKey}
              onChange={setSortKey}
              options={[
                { value: 'attention', label: t('Sort: Needs attention') },
                { value: 'progress', label: t('Sort: Progress') },
                { value: 'engagements', label: t('Sort: Engagements') },
                { value: 'name', label: t('Sort: Name') },
              ]}
            />
          </>
        )}
      />

      <Card loading={loading} className="dashboard-section-card motion-card" extra={<Text type="secondary">{t('Click an SME for the full picture')}</Text>}>
        {filtered.length ? (
          <>
            <Row gutter={[14, 18]} className="consultant-sme-grid">
              {pagedRows.map((row) => (
                <Col xs={24} md={12} xl={8} key={row.key}>
                  <SmeCard row={row} onClick={() => openDetail(row)} />
                </Col>
              ))}
            </Row>
            {filtered.length > PAGE_SIZE && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
                <Pagination current={page} pageSize={PAGE_SIZE} total={filtered.length} showSizeChanger={false} onChange={setPage} />
              </div>
            )}
          </>
        ) : <Empty description={t('SMEs will appear here once work is assigned to you.')} />}
      </Card>

      <SummaryModal detail={detail} onClose={() => setDetail(null)} />
    </DashboardPage>
  )
}
