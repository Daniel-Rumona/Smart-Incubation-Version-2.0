import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { App, Card, Col, DatePicker, Empty, Progress, Row, Space, Tag, Typography, theme } from 'antd'
import {
  AreaChartOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  DollarOutlined,
  FallOutlined,
  FundOutlined,
  MinusOutlined,
  RiseOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import VariablePie from 'highcharts/modules/variable-pie'
import { collection, getDocs, query, where, type Query } from 'firebase/firestore'
import DashboardPage from '@/components/shared/DashboardPage'
import { NEON_GREEN, NEON_PURPLE, SummaryModal, type SummaryDetail } from '@/components/shared/SummaryModal'
import { FilterBar } from '@/components/shared/FilterBar'
import { ReportExportButton } from '@/components/shared/ReportExportButton'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { getFirebaseDb } from '@/config/firebase'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage, tr, tEnglish } from '@/providers/LanguageProvider'
import { listDirectorPortfolio } from '@/services/directorPortfolioService'
import type { ReportExportData } from '@/services/reportExport'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import type { DirectorPortfolioSme } from '@/types/director'
import '@/styles/dashboard.css'
import '@/styles/director.css'

dayjs.extend(quarterOfYear)

const registerHighchartsModule = (module: unknown) => {
  const fn = typeof module === 'function'
    ? module
    : typeof (module as { default?: unknown })?.default === 'function'
      ? (module as { default: unknown }).default
      : null
  if (fn) (fn as (highcharts: typeof Highcharts) => void)(Highcharts)
}
registerHighchartsModule(HighchartsMore)
registerHighchartsModule(VariablePie)

const { RangePicker } = DatePicker
const { Text } = Typography

type AnyDoc = Record<string, unknown> & { id: string }

const ATTENTION_STATUSES = ['missing', 'pending', 'rejected', 'invalid', 'expired', 'queried']

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0, notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard' }).format(value || 0)

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.round((numerator / denominator) * 100) : 0)
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))
const norm = (value: unknown) => String(value ?? '').trim().toLowerCase()

const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return dayjs((value as { toDate: () => Date }).toDate())
  }
  if (typeof value === 'object' && value && 'seconds' in value && typeof (value as { seconds: unknown }).seconds === 'number') {
    return dayjs((value as { seconds: number }).seconds * 1000)
  }
  const parsed = dayjs(value as string | number | Date)
  return parsed.isValid() ? parsed : null
}

const isCompleted = (row: AnyDoc) =>
  norm(row.status) === 'completed'
  || norm(row.completionStatus) === 'completed'
  || (norm(row.assigneeCompletionStatus) === 'done' && norm(row.participantCompletionStatus) === 'confirmed')
  || Number(row.progress) >= 100

const completedAt = (row: AnyDoc) => toDay(row.completedAt) || toDay(row.completionConfirmedAt) || toDay(row.participantConfirmedAt)

const scoreBand = (score: number) => {
  if (score >= 80) return { label: tr('Healthy'), color: CHART_COLORS.success }
  if (score >= 60) return { label: tr('Watch'), color: CHART_COLORS.amber }
  return { label: tr('At risk'), color: CHART_COLORS.danger }
}

const safeDocs = async (source: Query): Promise<AnyDoc[]> => {
  try {
    const snapshot = await getDocs(source)
    return snapshot.docs.map((row) => ({ id: row.id, ...(row.data() as Record<string, unknown>) }))
  } catch (error) {
    console.warn('[director reports] optional data unavailable', error)
    return []
  }
}

const buildBuckets = (start: Dayjs, end: Dayjs) => {
  const days = end.diff(start, 'day') + 1
  const unit = days > 120 ? 'month' : 'week'
  const buckets: Array<{ label: string; from: Dayjs; to: Dayjs }> = []
  let cursor = start.startOf(unit)
  while (!cursor.isAfter(end, 'day')) {
    buckets.push({ label: unit === 'month' ? cursor.format('MMM YY') : cursor.format('DD MMM'), from: cursor, to: cursor.endOf(unit) })
    cursor = cursor.add(1, unit)
  }
  return buckets
}

type GroupRow = {
  name: string
  smes: number
  avgProgress: number
  compliance: number
  revenue: number
  employees: number
  growing: number
  flat: number
  declining: number
  docs: number
  docsOk: number
}

const signed = (value: number, suffix = '') => `${value > 0 ? '+' : ''}${value}${suffix}`
const pctChange = (current: number, baseline: number) => (baseline > 0 ? Math.round(((current - baseline) / baseline) * 100) : 0)

const SectionTitle = ({ icon, children }: { icon: ReactNode; children: ReactNode }) => <Space>{icon}{children}</Space>

const FactorRow = ({ label, detail, value }: { label: string; detail: string; value: number }) => {
  const band = scoreBand(value)
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
        <Text>{label}</Text>
        <Text type="secondary" style={{ fontSize: 12 }}>{detail}</Text>
      </div>
      <Progress percent={value} strokeColor={band.color} format={(percentValue) => <span style={{ fontWeight: 600 }}>{percentValue}%</span>} />
    </div>
  )
}

export const DirectorReportsPage = () => {
  const { message } = App.useApp()
  const { token } = theme.useToken()
  const { t } = useLanguage()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const [[start, end], setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()])
  const [loading, setLoading] = useState(false)
  const [portfolio, setPortfolio] = useState<DirectorPortfolioSme[]>([])
  const [complianceDocs, setComplianceDocs] = useState<AnyDoc[]>([])
  const [assignments, setAssignments] = useState<AnyDoc[]>([])
  const [appointments, setAppointments] = useState<AnyDoc[]>([])
  const [tasks, setTasks] = useState<AnyDoc[]>([])
  const [detail, setDetail] = useState<SummaryDetail | null>(null)

  const rangePresets = useMemo(() => {
    const now = dayjs()
    return [
      { label: t('This month'), value: [now.startOf('month'), now.endOf('month')] as [Dayjs, Dayjs] },
      { label: t('This quarter'), value: [now.startOf('quarter'), now.endOf('quarter')] as [Dayjs, Dayjs] },
      { label: t('Year to date'), value: [now.startOf('year'), now] as [Dayjs, Dayjs] },
    ]
  }, [t])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!user) return
      setLoading(true)
      try {
        const db = getFirebaseDb()
        const constraints = user.companyCode ? [where('companyCode', '==', user.companyCode)] : []
        const [portfolioRows, compliance, assigned, appts, taskRows] = await Promise.all([
          listDirectorPortfolio(user, activeProgramId),
          safeDocs(query(collection(db, 'complianceDocuments'), ...constraints)),
          safeDocs(query(collection(db, 'assignedInterventions'), ...constraints)),
          safeDocs(query(collection(db, 'appointments'), ...constraints)),
          safeDocs(query(collection(db, 'operationsTasks'), ...constraints)),
        ])
        if (!mounted) return
        setPortfolio(portfolioRows)
        setComplianceDocs(compliance)
        setAssignments(assigned)
        setAppointments(appts)
        setTasks(taskRows)
      } catch (error) {
        console.error(error)
        message.error(t('director.reports.loadError', 'Director report data could not be loaded.'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => { mounted = false }
  }, [activeProgramId, message, t, user])

  const inRange = (date: Dayjs | null) => !!date && !date.isBefore(start, 'day') && !date.isAfter(end, 'day')

  const smeIds = useMemo(() => new Set(portfolio.map((sme) => sme.id)), [portfolio])

  const scopedAssignments = useMemo(
    () => assignments.filter((row) => smeIds.has(String(row.participantId || row.smeId || row.smmeId || ''))),
    [assignments, smeIds],
  )

  const scopedAppointments = useMemo(
    () => appointments.filter((row) => matchesActiveProgram(user, activeProgramId, String(row.programId || ''))),
    [activeProgramId, appointments, user],
  )

  // ---------- Portfolio overview: grouped by programme (all programmes) or by sector (single programme) ----------
  const groups = useMemo<GroupRow[]>(() => {
    const keyOf = (sme: DirectorPortfolioSme) => (isAllPrograms ? sme.programName || 'Unassigned' : sme.sector || 'Unspecified')
    const bySme = new Map(portfolio.map((sme) => [sme.id, sme]))
    const map = new Map<string, GroupRow & { progressSum: number; docs: number; docsOk: number }>()
    portfolio.forEach((sme) => {
      const key = keyOf(sme)
      const row = map.get(key) || { name: key, smes: 0, avgProgress: 0, compliance: 0, revenue: 0, employees: 0, growing: 0, flat: 0, declining: 0, progressSum: 0, docs: 0, docsOk: 0 }
      row.smes += 1
      row.progressSum += sme.progress
      row.revenue += sme.metrics.revenue
      row.employees += sme.metrics.employees
      if (sme.metrics.growthRate > 0) row.growing += 1
      else if (sme.metrics.growthRate < 0) row.declining += 1
      else row.flat += 1
      map.set(key, row)
    })
    complianceDocs.forEach((doc) => {
      const sme = bySme.get(String(doc.participantId || ''))
      if (!sme) return
      const row = map.get(keyOf(sme))
      if (!row) return
      row.docs += 1
      if (!ATTENTION_STATUSES.includes(norm(doc.verificationStatus || doc.currentStatus || doc.status || 'pending'))) row.docsOk += 1
    })
    return Array.from(map.values())
      .map((row) => ({ ...row, avgProgress: Math.round(row.progressSum / row.smes), compliance: percent(row.docsOk, row.docs) }))
      .sort((left, right) => right.smes - left.smes || left.name.localeCompare(right.name))
  }, [complianceDocs, isAllPrograms, portfolio])

  const overviewSummary = useMemo(() => {
    return {
      smes: portfolio.length,
      revenue: portfolio.reduce((sum, sme) => sum + sme.metrics.revenue, 0),
      employees: portfolio.reduce((sum, sme) => sum + sme.metrics.employees, 0),
    }
  }, [portfolio])

  // ---------- Portfolio risk: variable-width pie (angle = SMEs, width = revenue exposure) ----------
  const riskOptions = useMemo(() => {
    const bands = [
      { name: 'Low', color: CHART_COLORS.success },
      { name: 'Medium', color: CHART_COLORS.amber },
      { name: 'High', color: CHART_COLORS.danger },
    ]
    const data = bands
      .map((band) => {
        const smes = portfolio.filter((sme) => sme.risk === band.name)
        return { name: band.name, color: band.color, y: smes.length, z: Math.max(smes.reduce((sum, sme) => sum + sme.metrics.revenue, 0), 1), custom: { revenue: smes.reduce((sum, sme) => sum + sme.metrics.revenue, 0) } }
      })
      .filter((point) => point.y > 0)
    return {
      chart: { type: 'variablepie', height: 320 },
      title: { text: undefined },
      subtitle: { text: tr('Slice angle = SMEs · slice width = revenue exposure'), style: { fontSize: '11px' } },
      tooltip: {
        formatter() {
          const point = (this as unknown as { point: { name: string; y: number; percentage: number; custom: { revenue: number } } }).point
          return `<b>${point.name} risk</b><br/>${point.y} SMEs (${Math.round(point.percentage)}%)<br/>Revenue: <b>${formatCurrency(point.custom.revenue)}</b>`
        },
      },
      plotOptions: {
        variablepie: {
          innerSize: '35%',
          minPointSize: 30,
          zMin: 0,
          borderRadius: 4,
          dataLabels: { enabled: true, format: '{point.name}: {point.y}', style: { textOutline: 'none' } },
        },
      },
      series: [{ type: 'variablepie', name: tr('Risk'), data }],
    } as unknown as Highcharts.Options
  }, [portfolio])

  // ---------- Interventions: assigned vs completed over time ----------
  const interventionOptions = useMemo<Highcharts.Options>(() => {
    const buckets = buildBuckets(start, end)
    const assigned = buckets.map((bucket) => scopedAssignments.filter((row) => {
      const created = toDay(row.createdAt) || toDay(row.implementationDate)
      return !!created && !created.isBefore(bucket.from) && !created.isAfter(bucket.to)
    }).length)
    const done = buckets.map((bucket) => scopedAssignments.filter((row) => {
      if (!isCompleted(row)) return false
      const finished = completedAt(row)
      return !!finished && !finished.isBefore(bucket.from) && !finished.isAfter(bucket.to)
    }).length)
    return {
      chart: { type: 'areaspline', height: 320 },
      title: { text: undefined },
      xAxis: { categories: buckets.map((bucket) => bucket.label), tickmarkPlacement: 'on' },
      yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
      tooltip: { shared: true },
      plotOptions: { areaspline: { fillOpacity: 0.25, lineWidth: 2, marker: { enabled: false } } },
      series: [
        { type: 'areaspline', name: tr('Assigned'), color: CHART_COLORS.slate, data: assigned },
        { type: 'areaspline', name: tr('Completed'), color: CHART_COLORS.success, data: done },
      ],
    }
  }, [end, scopedAssignments, start])

  // ---------- Attendance health ----------
  const attendance = useMemo(() => {
    const now = dayjs()
    let present = 0
    let absent = 0
    let upcoming = 0
    scopedAppointments.forEach((row) => {
      const startTime = toDay(row.startTime)
      if (!startTime || !inRange(startTime)) return
      if (startTime.isAfter(now)) { upcoming += 1; return }
      const values = Object.values((row.attendance as Record<string, unknown>) || {}).map(norm)
      if (values.includes('present')) present += 1
      else if (values.includes('absent')) absent += 1
    })
    const held = present + absent
    return { present, absent, upcoming, held, score: percent(present, held) }
  }, [scopedAppointments, start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  const attendanceGaugeOptions = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'pie', height: 190, margin: [0, 0, 0, 0] },
    title: { text: undefined },
    tooltip: { enabled: false },
    plotOptions: {
      pie: { startAngle: -90, endAngle: 90, center: ['50%', '85%'], size: '170%', innerSize: '72%', borderWidth: 0, dataLabels: { enabled: false }, states: { hover: { enabled: false } } },
    },
    series: [{
      type: 'pie',
      name: tr('Attendance'),
      data: [
        { name: 'Present', y: attendance.score, color: scoreBand(attendance.score).color },
        { name: 'Remaining', y: Math.max(0, 100 - attendance.score), color: token.colorFillSecondary },
      ].filter((point) => point.y > 0),
    }],
  }), [attendance.score, token.colorFillSecondary])

  // ---------- Operations health ----------
  const operations = useMemo(() => {
    const today = dayjs().startOf('day')
    const inWindow = scopedAssignments.filter((row) => inRange(completedAt(row) || toDay(row.dueDate) || toDay(row.createdAt)))
    const finished = inWindow.filter((row) => isCompleted(row) && completedAt(row))
    const onTime = finished.filter((row) => {
      const due = toDay(row.dueDate)
      return !due || !completedAt(row)!.isAfter(due, 'day')
    })
    const turnaroundDays = finished
      .map((row) => {
        const created = toDay(row.createdAt) || toDay(row.implementationDate)
        return created ? Math.max(0, completedAt(row)!.diff(created, 'day')) : null
      })
      .filter((value): value is number => value !== null)
    const avgTurnaround = turnaroundDays.length ? Math.round(turnaroundDays.reduce((sum, value) => sum + value, 0) / turnaroundDays.length) : null

    const open = inWindow.filter((row) => !isCompleted(row))
    const overdue = open.filter((row) => {
      const due = toDay(row.dueDate)
      return !!due && due.isBefore(today, 'day')
    })
    const accepted = inWindow.filter((row) => norm(row.participantStatus) === 'accepted')

    const dueTasks = tasks.filter((row) => !row.archived && norm(row.status) !== 'cancelled' && inRange(toDay(row.dueAt)))
    const doneTasks = dueTasks.filter((row) => norm(row.status) === 'done')

    const factors: Array<{ key: string; label: string; detail: string; value: number }> = []
    if (finished.length) factors.push({ key: 'ontime', label: t('On-time delivery'), detail: `${onTime.length} of ${finished.length} completed by due date`, value: percent(onTime.length, finished.length) })
    if (avgTurnaround !== null) factors.push({ key: 'turnaround', label: t('Turnaround time'), detail: `avg ${avgTurnaround} days to complete (target ≤ 14)`, value: clamp(100 - Math.max(0, avgTurnaround - 14) * (100 / 46)) })
    if (inWindow.length) {
      factors.push({ key: 'backlog', label: t('Backlog health'), detail: `${overdue.length} of ${open.length} open items overdue`, value: open.length ? clamp(100 - percent(overdue.length, open.length)) : 100 })
      factors.push({ key: 'responsive', label: t('SME responsiveness'), detail: `${accepted.length} of ${inWindow.length} accepted by SMEs`, value: percent(accepted.length, inWindow.length) })
    }
    if (dueTasks.length) factors.push({ key: 'tasks', label: t('Task delivery'), detail: `${doneTasks.length} of ${dueTasks.length} tasks done`, value: percent(doneTasks.length, dueTasks.length) })

    const score = factors.length ? clamp(factors.reduce((sum, factor) => sum + factor.value, 0) / factors.length) : 0
    return { factors, score }
  }, [scopedAssignments, tasks, start, end]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- Growth outlook: portfolio-wide movers ----------
  const growth = useMemo(() => {
    const summarize = (rows: DirectorPortfolioSme[]) => ({
      count: rows.length,
      share: percent(rows.length, portfolio.length),
      avgRate: rows.length ? Math.round(rows.reduce((sum, sme) => sum + sme.metrics.growthRate, 0) / rows.length) : 0,
    })
    return {
      growing: summarize(portfolio.filter((sme) => sme.metrics.growthRate > 0)),
      flat: summarize(portfolio.filter((sme) => sme.metrics.growthRate === 0)),
      declining: summarize(portfolio.filter((sme) => sme.metrics.growthRate < 0)),
    }
  }, [portfolio])

  const portfolioStats = useMemo(() => {
    const docs = groups.reduce((sum, group) => sum + group.docs, 0)
    const docsOk = groups.reduce((sum, group) => sum + group.docsOk, 0)
    return {
      avgProgress: portfolio.length ? Math.round(portfolio.reduce((sum, sme) => sum + sme.progress, 0) / portfolio.length) : 0,
      compliance: percent(docsOk, docs),
      avgGroupRevenue: groups.length ? overviewSummary.revenue / groups.length : 0,
      avgGrowth: portfolio.length ? Math.round(portfolio.reduce((sum, sme) => sum + sme.metrics.growthRate, 0) / portfolio.length) : 0,
    }
  }, [groups, overviewSummary.revenue, portfolio])

  const openGroupDetail = (group: GroupRow) => {
    const progressDiff = group.avgProgress - portfolioStats.avgProgress
    const complianceDiff = group.compliance - portfolioStats.compliance
    const revenueDiff = pctChange(group.revenue, portfolioStats.avgGroupRevenue)
    setDetail({
      title: group.name,
      subtitle: isAllPrograms ? t('Programme summary') : t('Sector summary'),
      center: { value: String(group.smes), label: `SME${group.smes === 1 ? '' : 's'}` },
      outer: { value: group.avgProgress, color: NEON_PURPLE, label: t('Avg progress') },
      inner: { value: group.compliance, color: NEON_GREEN, label: t('Compliance score') },
      left: [
        { icon: <CheckCircleOutlined />, label: t('Progress'), value: `${group.avgProgress}%`, delta: { text: `${signed(progressDiff)} pts`, positive: progressDiff >= 0 }, note: `Compared to ${portfolioStats.avgProgress}% portfolio average` },
        group.docs
          ? { icon: <BarChartOutlined />, label: t('Compliance'), value: `${group.compliance}%`, delta: { text: `${signed(complianceDiff)} pts`, positive: complianceDiff >= 0 }, note: `Compared to ${portfolioStats.compliance}% portfolio average` }
          : { icon: <BarChartOutlined />, label: t('Compliance'), value: 'N/A', note: 'No compliance documents uploaded yet' },
      ],
      right: [
        { icon: <DollarOutlined />, label: t('Revenue'), value: formatCurrency(group.revenue), delta: { text: `${Math.abs(revenueDiff)}%`, positive: revenueDiff >= 0 }, note: `Compared to ${formatCurrency(portfolioStats.avgGroupRevenue)} average` },
        { icon: <TeamOutlined />, label: t('Employees'), value: group.employees.toLocaleString(), note: `${group.smes ? (group.employees / group.smes).toFixed(1) : 0} per SME` },
      ],
      leftBottom: [
        { icon: <DollarOutlined />, label: t('Revenue per SME'), value: formatCurrency(group.smes ? group.revenue / group.smes : 0) },
        { icon: <TeamOutlined />, label: t('Total employees'), value: group.employees.toLocaleString() },
      ],
      rightBottom: [
        { label: t('Growing SMEs'), value: String(group.growing) },
        { label: t('Declining SMEs'), value: String(group.declining) },
      ],
    })
  }

  const openGrowthDetail = (key: 'growing' | 'flat' | 'declining') => {
    const rows = portfolio.filter((sme) => (key === 'growing' ? sme.metrics.growthRate > 0 : key === 'declining' ? sme.metrics.growthRate < 0 : sme.metrics.growthRate === 0))
    const label = key === 'growing' ? 'Growing' : key === 'declining' ? 'Declining' : 'Holding steady'
    const revenue = rows.reduce((sum, sme) => sum + sme.metrics.revenue, 0)
    const employees = rows.reduce((sum, sme) => sum + sme.metrics.employees, 0)
    const avgGrowth = rows.length ? Math.round(rows.reduce((sum, sme) => sum + sme.metrics.growthRate, 0) / rows.length) : 0
    const avgProgress = rows.length ? Math.round(rows.reduce((sum, sme) => sum + sme.progress, 0) / rows.length) : 0
    const movers = [...rows].sort((left, right) => (key === 'declining' ? left.metrics.growthRate - right.metrics.growthRate : right.metrics.growthRate - left.metrics.growthRate)).slice(0, 3)
    setDetail({
      title: `${label} SMEs`,
      subtitle: t('Growth outlook'),
      center: { value: String(rows.length), label: `SME${rows.length === 1 ? '' : 's'}` },
      outer: { value: percent(rows.length, portfolio.length), color: NEON_PURPLE, label: t('Share of portfolio') },
      inner: { value: avgProgress, color: NEON_GREEN, label: t('Avg progress') },
      left: [
        { icon: <RiseOutlined />, label: t('Avg growth'), value: signed(avgGrowth, '%'), delta: { text: `${signed(avgGrowth - portfolioStats.avgGrowth)} pts`, positive: avgGrowth - portfolioStats.avgGrowth >= 0 }, note: `Compared to ${signed(portfolioStats.avgGrowth, '%')} portfolio average` },
        { icon: <CheckCircleOutlined />, label: t('Avg progress'), value: `${avgProgress}%`, note: `Compared to ${portfolioStats.avgProgress}% portfolio average` },
      ],
      right: [
        { icon: <DollarOutlined />, label: t('Revenue'), value: formatCurrency(revenue), note: `${percent(revenue, overviewSummary.revenue)}% of portfolio revenue` },
        { icon: <TeamOutlined />, label: t('Employees'), value: employees.toLocaleString(), note: `${percent(employees, overviewSummary.employees)}% of portfolio employees` },
      ],
      leftBottom: [
        { icon: <TeamOutlined />, label: t('SMEs in this group'), value: String(rows.length) },
      ],
      rightBottom: movers.map((sme) => ({ label: sme.name, value: signed(sme.metrics.growthRate, '%') })),
    })
  }

  const buildExportData = (): ReportExportData => {
    const scoreTone = (score: number) => (score >= 80 ? 'good' as const : score >= 60 ? 'watch' as const : 'risk' as const)
    const watchlist = [...portfolio].sort((left, right) => left.metrics.growthRate - right.metrics.growthRate).slice(0, 15)
    return {
      role: user?.role || 'director',
      title: 'Director Report',
      periodLabel: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}`,
      organisation: [user?.companyCode, isAllPrograms ? 'All programmes' : 'Selected programme'].filter(Boolean).join(' - '),
      preparedBy: user?.name || user?.displayName || user?.email || 'Director',
      kpis: [
        { label: 'SMEs in portfolio', value: overviewSummary.smes },
        { label: 'Portfolio revenue', value: formatCurrency(overviewSummary.revenue), note: `${formatCurrency(portfolioStats.avgGroupRevenue)} average per group` },
        { label: 'Employees supported', value: overviewSummary.employees.toLocaleString() },
        { label: 'Average progress', value: `${portfolioStats.avgProgress}%`, tone: scoreTone(portfolioStats.avgProgress) },
        { label: 'Compliance', value: `${portfolioStats.compliance}%`, tone: scoreTone(portfolioStats.compliance) },
        { label: 'Average growth rate', value: `${portfolioStats.avgGrowth}%`, tone: portfolioStats.avgGrowth > 0 ? 'good' : portfolioStats.avgGrowth < 0 ? 'risk' : 'watch' },
        { label: 'SMEs growing / declining', value: `${growth.growing.count} / ${growth.declining.count}`, note: `${growth.flat.count} flat`, tone: growth.declining.count > growth.growing.count ? 'risk' : 'good' },
        { label: 'Attendance health', value: `${attendance.score}%`, note: `${attendance.present} present, ${attendance.absent} absent, ${attendance.upcoming} upcoming`, tone: scoreTone(attendance.score) },
        { label: 'Operations health', value: `${operations.score}%`, tone: scoreTone(operations.score) },
      ],
      tables: [
        {
          key: 'groups',
          title: isAllPrograms ? 'Programme overview' : 'Sector overview',
          columns: [{ key: 'name', label: isAllPrograms ? 'Programme' : 'Sector' }, { key: 'smes', label: 'SMEs' }, { key: 'avgProgress', label: 'Avg progress %' }, { key: 'compliance', label: 'Compliance %' }, { key: 'revenue', label: 'Revenue' }, { key: 'employees', label: 'Employees' }, { key: 'growing', label: 'Growing' }, { key: 'declining', label: 'Declining' }],
          rows: groups.map((group) => ({ name: group.name, smes: group.smes, avgProgress: group.avgProgress, compliance: group.compliance, revenue: formatCurrency(group.revenue), employees: group.employees, growing: group.growing, declining: group.declining })),
        },
        {
          key: 'operations',
          title: 'Operations health factors',
          columns: [{ key: 'factor', label: 'Factor' }, { key: 'detail', label: 'Detail' }, { key: 'score', label: 'Score %' }],
          rows: operations.factors.map((factor) => ({ factor: factor.label, detail: factor.detail, score: factor.value })),
        },
        {
          key: 'growth',
          title: 'Growth outlook',
          columns: [{ key: 'band', label: 'Trend' }, { key: 'count', label: 'SMEs' }, { key: 'share', label: 'Share of portfolio %' }, { key: 'rate', label: 'Avg growth rate %' }],
          rows: [
            { band: 'Growing', count: growth.growing.count, share: growth.growing.share, rate: growth.growing.avgRate },
            { band: 'Flat', count: growth.flat.count, share: growth.flat.share, rate: growth.flat.avgRate },
            { band: 'Declining', count: growth.declining.count, share: growth.declining.share, rate: growth.declining.avgRate },
          ],
        },
        {
          key: 'watchlist',
          title: 'SMEs to watch (lowest growth)',
          columns: [{ key: 'name', label: 'SME' }, { key: 'sector', label: 'Sector' }, { key: 'programme', label: 'Programme' }, { key: 'progress', label: 'Progress %' }, { key: 'growth', label: 'Growth %' }, { key: 'revenue', label: 'Revenue' }],
          rows: watchlist.map((sme) => ({ name: sme.name, sector: sme.sector || 'Unspecified', programme: sme.programName || 'Unassigned', progress: sme.progress, growth: sme.metrics.growthRate, revenue: formatCurrency(sme.metrics.revenue) })),
        },
      ],
    }
  }

  useRegisterAgentPageContext({
    pageKey: 'director-reports',
    pageName: tEnglish('director.reports.title', 'Director Reports'),
    purpose: 'Executive reporting: programme overview, portfolio risk, intervention completions, attendance and operations health.',
    currentFilters: { activeProgramId, from: start.format('YYYY-MM-DD'), to: end.format('YYYY-MM-DD') },
    metrics: { smes: overviewSummary.smes, revenue: overviewSummary.revenue, attendanceScore: attendance.score, operationsScore: operations.score },
    dataSummary: { scope: isAllPrograms ? 'all programs' : 'selected program', groups: groups.length },
  })

  const attendanceBand = scoreBand(attendance.score)
  const operationsBand = scoreBand(operations.score)
  const hasPortfolio = portfolio.length > 0

  return (
    <DashboardPage className="director-page director-reports-page">
      <FilterBar
        primary={(
          <RangePicker
            value={[start, end]}
            allowClear={false}
            presets={rangePresets}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
            }}
          />
        )}
        actions={<ReportExportButton buildData={buildExportData} disabled={loading} />}
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={10}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<SectionTitle icon={<RiseOutlined />}>{t('Growth Outlook')}</SectionTitle>} extra={<Text type="secondary">{t('Click for details')}</Text>} style={{ height: '100%' }}>
            {hasPortfolio ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {([
                  { key: 'growing', label: t('Growing'), hint: t('Revenue trending up'), icon: <RiseOutlined />, motion: 'growth-motion-up', color: CHART_COLORS.success, data: growth.growing },
                  { key: 'flat', label: t('Holding steady'), hint: t('No revenue movement'), icon: <MinusOutlined />, motion: 'growth-motion-flat', color: CHART_COLORS.slate, data: growth.flat },
                  { key: 'declining', label: t('Declining'), hint: t('Revenue trending down'), icon: <FallOutlined />, motion: 'growth-motion-down', color: CHART_COLORS.danger, data: growth.declining },
                ] as const).map((item) => (
                  <button key={item.key} type="button" className="director-click-row" onClick={() => openGrowthDetail(item.key)}>
                    <span className={item.motion} style={{ width: 52, height: 52, borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: item.color, background: `${item.color}1f`, flexShrink: 0 }}>{item.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <Text strong>{item.label}</Text>
                        <span><strong style={{ fontSize: 22 }}>{item.data.count}</strong> <Text type="secondary">{t('SME')}{item.data.count === 1 ? '' : 's'}</Text></span>
                      </div>
                      <Progress percent={item.data.share} showInfo={false} strokeColor={item.color} size="small" />
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{item.hint}</Text>
                        <Text style={{ fontSize: 12, color: item.color }} strong>{item.data.share}%{item.key !== 'flat' && item.data.count ? ` · avg ${signed(item.data.avgRate, '%')}` : ''}</Text>
                      </div>
                    </div>
                  </button>
                ))}
              </Space>
            ) : <Empty description={t('No portfolio records found.')} />}
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<SectionTitle icon={<FundOutlined />}>{isAllPrograms ? t('Programme Progress') : t('Sector Progress')}</SectionTitle>} extra={<Text type="secondary">{t('Click a bar for details')}</Text>} style={{ height: '100%' }}>
            {hasPortfolio ? (
              <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, paddingRight: 4 }}>
                {groups.map((group) => (
                  <button key={group.name} type="button" className="director-click-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }} onClick={() => openGroupDetail(group)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <Text strong ellipsis style={{ maxWidth: '60%' }}>{group.name} <Text type="secondary" style={{ fontWeight: 400 }}>({group.smes} {t('SME')}{group.smes === 1 ? '' : 's'})</Text></Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{formatCurrency(group.revenue)} · {group.employees.toLocaleString()} {t('staff')}</Text>
                    </div>
                    <Progress percent={group.avgProgress} strokeColor={NEON_PURPLE} size="small" format={(value) => `${value}% progress`} />
                    {group.docs > 0 && <Progress percent={group.compliance} strokeColor={CHART_COLORS.teal} size="small" format={(value) => `${value}% compliance`} />}
                  </button>
                ))}
              </div>
            ) : <Empty description={t('No portfolio records found.')} />}
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<SectionTitle icon={<AreaChartOutlined />}>{t('Interventions: assigned vs completed')}</SectionTitle>} extra={<Text type="secondary">{start.format('DD MMM YYYY')} – {end.format('DD MMM YYYY')}</Text>}>
            {scopedAssignments.length ? <ThemedHighcharts options={interventionOptions} /> : <Empty description={t('No interventions in this scope.')} />}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<SectionTitle icon={<WarningOutlined />}>{t('Portfolio Risk')}</SectionTitle>} style={{ height: '100%' }}>
            {hasPortfolio ? <ThemedHighcharts options={riskOptions} /> : <Empty description={t('No portfolio records found.')} />}
          </Card>
        </Col>

        <Col xs={24} xl={9}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<SectionTitle icon={<CalendarOutlined />}>{t('Attendance Health')}</SectionTitle>} style={{ height: '100%' }}>
            {attendance.held ? (
              <>
                <div style={{ position: 'relative' }}>
                  <ThemedHighcharts options={attendanceGaugeOptions} />
                  <div style={{ position: 'absolute', left: 0, right: 0, top: '62%', textAlign: 'center', pointerEvents: 'none' }}>
                    <Text strong style={{ fontSize: 32, display: 'block', lineHeight: 1 }}>{attendance.score}%</Text>
                    <Tag color={attendanceBand.color} style={{ marginTop: 6, marginInlineEnd: 0 }}>{attendanceBand.label}</Tag>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12 }}>
                  {[
                    { label: t('Present'), value: attendance.present, color: CHART_COLORS.success },
                    { label: t('Absent'), value: attendance.absent, color: CHART_COLORS.danger },
                    { label: t('Upcoming'), value: attendance.upcoming, color: CHART_COLORS.primary },
                  ].map((stat) => (
                    <div key={stat.label} style={{ textAlign: 'center', padding: '8px 4px', borderRadius: 10, background: token.colorFillQuaternary }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</div>
                      <Text type="secondary" style={{ fontSize: 12 }}>{stat.label}</Text>
                    </div>
                  ))}
                </div>
              </>
            ) : <Empty description={t('No appointments have been held in this period.')} />}
          </Card>
        </Col>

        <Col xs={24} xl={15}>
          <Card loading={loading} className="dashboard-section-card motion-card" title={<SectionTitle icon={<ThunderboltOutlined />}>{t('Operations Health')}</SectionTitle>} extra={<Text type="secondary">{t('Average of the factors below')}</Text>} style={{ height: '100%' }}>
            {operations.factors.length ? (
              <Row gutter={[24, 16]} align="middle">
                <Col xs={24} md={8} style={{ textAlign: 'center' }}>
                  <Progress type="circle" size={150} percent={operations.score} strokeColor={operationsBand.color} format={(value) => <span style={{ fontWeight: 700, fontSize: 30 }}>{value}</span>} />
                  <div style={{ marginTop: 10 }}><Tag color={operationsBand.color} style={{ marginInlineEnd: 0 }}>{operationsBand.label}</Tag></div>
                </Col>
                <Col xs={24} md={16}>
                  <Space direction="vertical" size={12} style={{ width: '100%' }}>
                    {operations.factors.map((factor) => <FactorRow key={factor.key} label={factor.label} detail={factor.detail} value={factor.value} />)}
                  </Space>
                </Col>
              </Row>
            ) : <Empty description={t('No delivery activity in this period.')} />}
          </Card>
        </Col>

      </Row>

      <SummaryModal detail={detail} onClose={() => setDetail(null)} />
    </DashboardPage>
  )
}

export default DirectorReportsPage

