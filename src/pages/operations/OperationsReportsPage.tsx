import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, App, Button, Card, Checkbox, Col, DatePicker, Empty, Grid, Row, Segmented, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  BulbOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  CloseOutlined,
  DownloadOutlined,
  FileProtectOutlined,
  FundOutlined,
  PlayCircleOutlined,
  RiseOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { db } from '@/firebase/config'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useThemeMode } from '@/providers/ThemeProvider'
import { ReportExportButton } from '@/components/shared/ReportExportButton'
import { ReportPlayer, type PlayerSlide } from '@/components/reports/ReportPlayer'
import { resolveReportInsights } from '@/services/reportExport/insights'
import type { ReportInsights } from '@/services/reportExport/types'
import { getCompanyName } from '@/services/userProfileService'
import type { ReportExportData } from '@/services/reportExport'
import { loadImpactAnalytics, type ImpactAnalytics } from '@/services/impactAnalyticsService'
import {
  appointmentStatusLabel,
  complianceStatusColor,
  complianceStatusLabel,
  computeReportData,
  isCompletedAssignment,
  isInProgressAssignment,
  percent,
  primaryApplicationDate,
  toDate,
  topEntries,
  type ApplicationDoc,
  type AppointmentDoc,
  type AssignmentDoc,
  type ParticipantDoc,
  type ReportRecords,
} from '@/services/operationsReportData'
import {
  buildAnalyticsTabs,
  deliveryAsAt,
  tableCsv,
  type BreakdownRow,
  type Dimension,
  type TabKey,
  type TableRow,
} from '@/services/operationsReportAnalytics'
import { bucketRange, formatCurrencyZAR, getPreviousRange, revenueInRange, type PerformanceSourceRow } from '@/services/smePerformanceMetrics'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import '@/styles/dashboard.css'
import '@/styles/operations-reports.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { RangePicker } = DatePicker
const { Text } = Typography

const TABS: Array<{ key: TabKey, label: string, question: string, icon: React.ReactNode }> = [
  { key: 'intake', label: 'Intake', question: 'Who is applying, and who gets in?', icon: <AuditOutlined /> },
  { key: 'delivery', label: 'Delivery', question: 'Is the support getting done?', icon: <CheckCircleOutlined /> },
  { key: 'appointments', label: 'Appointments', question: 'Are sessions happening, and are SMEs attending?', icon: <CalendarOutlined /> },
  { key: 'smes', label: 'SMEs', question: 'Who do we support, and are they compliant?', icon: <FileProtectOutlined /> },
  { key: 'growth', label: 'Growth', question: 'Are the SMEs growing?', icon: <RiseOutlined /> },
]

const STATUS_COLOURS: Record<string, string> = {
  Accepted: 'green',
  Completed: 'green',
  Attended: 'green',
  'Up to date': 'green',
  'In progress': 'blue',
  Overdue: 'red',
  Absent: 'red',
  Rejected: 'red',
  'Not captured': 'gold',
}

/** "+3", "−8 pts": the change from the previous period, coloured by whether up is good. */
const change = (current: number | null, previous: number | null, unit: 'count' | 'pts', upIsGood = true) => {
  if (current === null || previous === null) return undefined
  const diff = Math.round(current - previous)
  const direction = diff > 0 ? 'up' as const : diff < 0 ? 'down' as const : 'flat' as const
  const amount = `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${Math.abs(diff)}${unit === 'pts' ? ` ${tr('pts')}` : ''}`
  return {
    text: tr('{amount} on the previous period', undefined, { amount }),
    amount,
    direction,
    tone: diff === 0 ? 'neutral' as const : (diff > 0) === upIsGood ? 'good' as const : 'bad' as const,
  }
}

const download = (fileName: string, contents: string) => {
  const url = URL.createObjectURL(new Blob(['﻿', contents],{ type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  URL.revokeObjectURL(url)
}

export const OperationsReportsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const screens = Grid.useBreakpoint()
  const [tab, setTab] = useState<TabKey>('intake')
  const [dimensionKey, setDimensionKey] = useState<string>()
  const [filter, setFilter] = useState<string>()
  const [compare, setCompare] = useState(true)
  const [[start, end], setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('year'), dayjs()])
  const [records, setRecords] = useState<ReportRecords>({ applications: [], participants: [], assignments: [], appointments: [] })
  const [impact, setImpact] = useState<ImpactAnalytics | null>(null)
  const [loading, setLoading] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [playerOrigin, setPlayerOrigin] = useState<{ x: number; y: number } | null>(null)
  const { mode: playerMode } = useThemeMode()
  const [playerInsights, setPlayerInsights] = useState<{ insights: ReportInsights, aiGenerated: boolean } | null>(null)
  const [companyName, setCompanyName] = useState('')

  const rangePresets = useMemo(() => {
    const now = dayjs()
    return [
      { label: t('This month'), value: [now.startOf('month'), now.endOf('month')] as [Dayjs, Dayjs] },
      { label: t('This quarter'), value: [now.startOf('quarter'), now.endOf('quarter')] as [Dayjs, Dayjs] },
      { label: t('Year to date'), value: [now.startOf('year'), now] as [Dayjs, Dayjs] },
      { label: t('All time'), value: [now.subtract(10, 'year').startOf('year'), now.endOf('day')] as [Dayjs, Dayjs] },
    ]
  }, [t])

  useEffect(() => {
    let mounted = true
    const loadReports = async () => {
      setLoading(true)
      try {
        const constraints = user?.companyCode ? [where('companyCode', '==', user.companyCode)] : []
        const [applicationsSnap, participantsSnap, assignmentsSnap, appointmentsSnap] = await Promise.all([
          getDocs(query(collection(db, 'applications'), ...constraints)),
          getDocs(collection(db, 'participants')),
          getDocs(query(collection(db, 'assignedInterventions'), ...constraints)),
          getDocs(query(collection(db, 'appointments'), ...constraints)),
        ])
        if (!mounted) return
        setRecords({
          applications: applicationsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ApplicationDoc, 'id'>) })),
          participants: participantsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<ParticipantDoc, 'id'>) })),
          assignments: assignmentsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AssignmentDoc, 'id'>) })),
          appointments: appointmentsSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() as Omit<AppointmentDoc, 'id'>) })),
        })
      } catch (error) {
        console.error(error)
        message.error(t('Failed to load report data'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    loadReports()
    return () => {
      mounted = false
    }
  }, [message, user?.companyCode, t])

  // Growth is Impact analysis's figure (since joining), so it follows the programme, not the period.
  useEffect(() => {
    if (!user?.companyCode) return
    let mounted = true
    loadImpactAnalytics(user, { activeProgramId, isAllPrograms })
      .then((result) => { if (mounted) setImpact(result) })
      .catch((error) => console.error(error))
    return () => {
      mounted = false
    }
  }, [activeProgramId, isAllPrograms, user])

  const scope = useMemo(() => ({ user, activeProgramId, isAllPrograms }), [activeProgramId, isAllPrograms, user])
  const previousRange = useMemo<[Dayjs, Dayjs]>(() => getPreviousRange([start, end]), [start, end])
  const reportData = useMemo(() => computeReportData(records, scope, start, end), [end, records, scope, start])
  const previousData = useMemo(() => computeReportData(records, scope, previousRange[0], previousRange[1]), [previousRange, records, scope])
  const delivery = useMemo(() => deliveryAsAt(records, scope, end.endOf('day')), [end, records, scope])
  const previousDelivery = useMemo(() => deliveryAsAt(records, scope, previousRange[1].endOf('day')), [previousRange, records, scope])

  const earliestApplicationDate = useMemo(
    () => records.applications
      .filter((application) => matchesActiveProgram(user, activeProgramId, String(application.programId || '')))
      .reduce<Dayjs | null>((earliest, application) => {
        const date = primaryApplicationDate(application)
        if (!date) return earliest
        const value = dayjs(date)
        return !earliest || value.isBefore(earliest) ? value : earliest
      }, null),
    [activeProgramId, records.applications, user],
  )

  const revenueTrend = useMemo(() => {
    const rows: PerformanceSourceRow[] = reportData.scopedParticipants
    const total = (range: [Dayjs, Dayjs]) => bucketRange(range).map((bucket) => rows.reduce((sum, row) => sum + revenueInRange(row, bucket.range), 0))
    const current = total([start, end])
    const previous = total(previousRange)
    return { labels: bucketRange([start, end]).map((bucket) => bucket.label), current, previous: current.map((_, index) => previous[index] ?? 0) }
  }, [end, previousRange, reportData.scopedParticipants, start])

  const programmeNames = useMemo(() => {
    const names = new Map<string, string>()
    records.applications.forEach((application) => {
      if (application.programId && application.programName) names.set(String(application.programId), String(application.programName))
    })
    return names
  }, [records.applications])

  const tabs = useMemo(() => buildAnalyticsTabs({
    records, scope, range: [start, end], previousRange, current: reportData, previous: previousData, delivery, previousDelivery, impact, revenueTrend,
  }, programmeNames), [delivery, end, impact, previousData, previousDelivery, previousRange, programmeNames, records, reportData, revenueTrend, scope, start])

  const summary = useMemo(() => {
    const attendance = (data: typeof reportData) => {
      const attended = data.attendanceRows.filter((row) => row.attendance === 'Present').length
      const absent = data.attendanceRows.filter((row) => row.attendance === 'Absent').length
      return { attended, absent, held: attended + absent, rate: attended + absent ? percent(attended, attended + absent) : null }
    }
    const now = attendance(reportData)
    const before = attendance(previousData)
    return {
      submitted: reportData.scopedApplications.length,
      accepted: reportData.scopedAccepted.length,
      previousAccepted: previousData.scopedAccepted.length,
      participants: reportData.scopedParticipants.length || reportData.scopedAccepted.length,
      acceptanceRate: percent(reportData.scopedAccepted.length, reportData.scopedApplications.length),
      assigned: reportData.scopedAssignments.length,
      overdue: reportData.overdueAssignments.length,
      complianceRisk: reportData.complianceAttention.length,
      appointments: reportData.scopedAppointments.length,
      notCaptured: reportData.attendanceRows.filter((row) => row.attendance === 'Not captured').length,
      attended: now.attended,
      absent: now.absent,
      held: now.held,
      attendanceRate: now.rate,
      previousAttendanceRate: before.rate,
    }
  }, [previousData, reportData])

  const complianceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    reportData.complianceDocuments.forEach((document) => {
      const status = complianceStatusLabel(String(document.status || 'pending'))
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return topEntries(counts, 6)
  }, [reportData.complianceDocuments])

  const active = tabs[tab]
  const dimension: Dimension = active.dimensions.find((item) => item.key === dimensionKey) || active.dimensions[0]
  const openTab = (key: TabKey) => {
    setTab(key)
    setDimensionKey(undefined)
    setFilter(undefined)
  }

  const formatValue = (value: number, unit: Dimension['unit']) => unit === 'percent' ? `${value}%` : unit === 'growth' ? `${value > 0 ? '+' : ''}${value}%` : String(value)
  // Growth and SME make-up are as they stand, not per period, so they have no previous-period bars.
  const showPrevious = compare && dimension.rows.some((row) => row.previous !== null)
  const showPreviousTrend = compare && tab !== 'smes'

  const breakdownOptions = useMemo<Highcharts.Options>(() => {
    const rows = dimension.rows
    const label = (row: BreakdownRow) => tr(row.label)
    return {
      chart: { type: 'bar', height: Math.max(180, rows.length * (showPrevious ? 44 : 34) + 50) },
      title: { text: undefined },
      xAxis: { categories: rows.map(label), labels: { style: { fontSize: '12px' } } },
      yAxis: { min: dimension.unit === 'growth' ? undefined : 0, max: dimension.unit === 'percent' ? 100 : undefined, allowDecimals: false, title: { text: undefined }, labels: { format: dimension.unit === 'count' ? '{value}' : '{value}%' } },
      legend: { enabled: showPrevious },
      tooltip: {
        shared: true,
        formatter() {
          const row = rows[Number(this.index ?? this.points?.[0]?.index ?? 0)]
          if (!row) return ''
          const lines = [`<b>${label(row)}</b>`, `${tr('This period')}: ${formatValue(row.value, dimension.unit)}${row.detail ? ` (${tr(row.detail)})` : ''}`]
          if (showPrevious && row.previous !== null) lines.push(`${tr('Previous period')}: ${formatValue(row.previous, dimension.unit)}`)
          return lines.join('<br/>')
        },
      },
      plotOptions: {
        bar: { borderRadius: 4, groupPadding: 0.12, cursor: 'pointer', dataLabels: { enabled: true, formatter() { return formatValue(Number(this.y), dimension.unit) } } },
        series: { point: { events: { click() { setFilter((current) => current === rows[this.index]?.label ? undefined : rows[this.index]?.label) } } } },
      },
      series: [
        ...(showPrevious ? [{ type: 'bar' as const, name: tr('Previous period'), color: 'rgba(124, 58, 237, .28)', data: rows.map((row) => row.previous ?? 0), dataLabels: { enabled: false } }] : []),
        {
          type: 'bar' as const,
          name: tr('This period'),
          data: rows.map((row) => ({ y: row.value, color: filter && filter !== row.label ? 'rgba(124, 58, 237, .45)' : CHART_COLORS.violet })),
        },
      ],
    }
  }, [dimension, filter, showPrevious])

  const trendOptions = useMemo<Highcharts.Options>(() => {
    const trend = active.trend
    const currency = trend.unit === 'currency'
    return {
      chart: { type: 'column', height: 260 },
      title: { text: undefined },
      xAxis: { categories: trend.labels },
      yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, labels: currency ? { formatter() { return formatCurrencyZAR(Number(this.value)) } } : undefined },
      legend: { enabled: showPreviousTrend },
      tooltip: { shared: true, valuePrefix: currency ? 'R ' : undefined },
      plotOptions: { column: { borderRadius: 4, groupPadding: 0.1 } },
      series: [
        ...(showPreviousTrend ? [{ type: 'column' as const, name: tr('Previous period'), color: 'rgba(37, 99, 235, .25)', data: trend.previous }] : []),
        { type: 'column' as const, name: tr(trend.series), color: CHART_COLORS.primary, data: trend.current },
      ],
    }
  }, [active.trend, showPreviousTrend])

  const tableRows = useMemo(() => (filter ? active.table.rows.filter((row) => row.matches.includes(filter)) : active.table.rows), [active.table.rows, filter])
  const statusCell = (value: string) => <Tag color={STATUS_COLOURS[value] || (value.endsWith('to follow up') ? 'gold' : 'default')}>{t(value)}</Tag>
  const columns: ColumnsType<TableRow> = active.table.columns.map((column) => ({
    key: column.key,
    title: t(column.label),
    render: (_, row) => (column.status ? statusCell(row.cells[column.key]) : row.cells[column.key]),
    sorter: (a, b) => (a.cells[column.key] || '').localeCompare(b.cells[column.key] || '', undefined, { numeric: true }),
  }))

  const subline = (() => {
    if (tab === 'intake') return t('{submitted} applications · {accepted} accepted', undefined, { submitted: summary.submitted, accepted: summary.accepted })
    if (tab === 'delivery') return delivery.rate === null
      ? t('No required interventions yet')
      : t('{completed} of {required} required interventions completed ({rate}%)', undefined, { completed: delivery.completed, required: delivery.required, rate: delivery.rate })
    if (tab === 'appointments') return t('{held} sessions held · {rate}% attended', undefined, { held: summary.held, rate: summary.attendanceRate ?? 0 })
    if (tab === 'smes') return t('{count} SMEs in the programmes', undefined, { count: summary.participants })
    return t('Same figures as Impact analysis · {growing} of {total} SMEs growing', undefined, { growing: impact?.growingSmes ?? 0, total: impact?.smesWithRevenue ?? 0 })
  })()

  const followUp = (() => {
    const { kind, count, path } = active.followUp
    if (kind === 'impact') return { text: t('Outcomes, check-backs and before/after revenue are on Impact analysis.'), link: t('Open Impact analysis'), path }
    if (!count) return null
    if (kind === 'decisions') return { text: t('{count} applications are waiting for a decision.', undefined, { count }), link: t('Open Applications'), path }
    if (kind === 'overdue') return { text: t('{count} interventions are overdue.', undefined, { count }), link: t('Open Monitoring'), path }
    if (kind === 'attendance') return { text: t('{count} sessions still need attendance captured.', undefined, { count }), link: t('Open Appointments'), path }
    return { text: t('{count} compliance documents need follow-up.', undefined, { count }), link: t('Open Compliance'), path }
  })()

  const buildExportData = (): ReportExportData => {
    const rate = (value: number | null) => (value === null ? '—' : `${value}%`)
    return {
      role: user?.role || 'operations',
      title: 'Operations Report',
      periodLabel: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}`,
      organisation: user?.companyCode || undefined,
      preparedBy: user?.name || user?.displayName || user?.email || 'Operations',
      kpis: [
        { label: 'Applications submitted', value: summary.submitted, note: `${rate(summary.acceptanceRate)} accepted` },
        { label: 'Active participants', value: summary.participants },
        { label: 'Interventions assigned', value: summary.assigned },
        { label: 'Required interventions completed', value: delivery.completed, note: `${rate(delivery.rate)} of ${delivery.required} required`, tone: delivery.rate === null ? 'watch' : delivery.rate >= 70 ? 'good' : delivery.rate < 40 ? 'risk' : 'watch' },
        { label: 'Overdue interventions', value: summary.overdue, tone: summary.overdue ? 'risk' : 'good' },
        { label: 'Compliance items needing follow-up', value: summary.complianceRisk, tone: summary.complianceRisk ? 'watch' : 'good' },
        { label: 'Appointments scheduled', value: summary.appointments },
        { label: 'Attendance rate', value: rate(summary.attendanceRate), note: `${summary.attended} present, ${summary.absent} absent, ${summary.notCaptured} not captured`, tone: summary.attendanceRate === null ? 'watch' : summary.attendanceRate >= 80 ? 'good' : summary.attendanceRate < 60 ? 'risk' : 'watch' },
        ...(impact?.revenueGrowth !== null && impact?.revenueGrowth !== undefined
          ? [{ label: 'Revenue growth since joining', value: `${impact.revenueGrowth > 0 ? '+' : ''}${impact.revenueGrowth}%`, note: `${impact.growingSmes} of ${impact.smesWithRevenue} SMEs growing, ${impact.netJobs >= 0 ? '+' : ''}${impact.netJobs} jobs` }]
          : []),
      ],
      tables: [
        {
          key: 'demand',
          title: 'Intervention demand and delivery',
          columns: [{ key: 'title', label: 'Intervention' }, { key: 'area', label: 'Area of support' }, { key: 'requested', label: 'Requested' }, { key: 'assigned', label: 'Assigned' }, { key: 'completed', label: 'Completed' }, { key: 'gap', label: 'Gap' }, { key: 'completionRate', label: 'Completion %' }],
          rows: reportData.supportRows.map((row) => ({ ...row })),
        },
        {
          key: 'attention',
          title: 'Items needing attention',
          columns: [{ key: 'intervention', label: 'Intervention' }, { key: 'participant', label: 'SME' }, { key: 'owner', label: 'Owner' }, { key: 'issue', label: 'Issue' }, { key: 'dueDate', label: 'Due' }, { key: 'severity', label: 'Severity' }],
          rows: reportData.attentionRows.map((row) => ({ ...row })),
        },
        {
          key: 'owners',
          title: 'Delivery owner health',
          columns: [{ key: 'name', label: 'Delivery owner' }, { key: 'actorType', label: 'Type' }, { key: 'assigned', label: 'Assigned' }, { key: 'inProgress', label: 'In progress' }, { key: 'completed', label: 'Completed' }, { key: 'facilitatorHeld', label: 'Held by owner' }, { key: 'health', label: 'Health' }],
          rows: reportData.facilitatorRows.map((row) => ({ ...row })),
        },
        {
          key: 'attendance',
          title: 'Appointments and attendance',
          columns: [{ key: 'appointment', label: 'Appointment' }, { key: 'participant', label: 'SME' }, { key: 'program', label: 'Programme' }, { key: 'date', label: 'Date' }, { key: 'meetingType', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'attendance', label: 'Attendance' }],
          rows: reportData.attendanceRows.map((row) => ({ ...row, status: appointmentStatusLabel(row.status) })),
        },
        {
          key: 'compliance',
          title: 'Compliance documents by status',
          columns: [{ key: 'status', label: 'Status' }, { key: 'documents', label: 'Documents' }],
          rows: complianceCounts.map(([status, documents]) => ({ status, documents })),
        },
      ],
    }
  }

  const startPlayer = (event?: { currentTarget: Element }) => {
    // The player ripples open from the button that started it.
    const rect = event?.currentTarget.getBoundingClientRect()
    setPlayerOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
    // ReportPlayer takes the browser fullscreen itself.
    setPlayerInsights(null)
    setPlayerOpen(true)
    if (user?.companyCode) void getCompanyName(user.companyCode).then(setCompanyName)
    void resolveReportInsights(buildExportData(), 'executive').then(setPlayerInsights)
  }

  const playerSlides = useMemo<PlayerSlide[]>(() => {
    const monthLabel = start.isSame(end, 'month') ? start.format('MMMM YYYY') : `${start.format('DD MMM YYYY')} – ${end.format('DD MMM YYYY')}`
    const held = summary.held
    const awaiting = Math.max(summary.appointments - held, 0)
    const documents = reportData.complianceDocuments.length
    const inGoodStanding = Math.max(documents - summary.complianceRisk, 0)
    const complianceRate = percent(inGoodStanding, documents)
    // Same status colours as the consultant report, per theme. Each split runs risk → neutral → good so red and green never touch.
    const tone = playerMode === 'dark'
      ? { good: '#16A34A', warn: '#B48C08', risk: '#DC2626', info: '#3B82F6', neutral: '#94A3B8' }
      : { good: '#15803D', warn: '#CA8A04', risk: '#DC2626', info: '#2563EB', neutral: '#64748B' }
    const statusTone = (status: string) => {
      const color = complianceStatusColor(status)
      return color === 'error' ? 'risk' : color === 'warning' ? 'warn' : color === 'success' ? 'good' : 'info'
    }
    const toneOrder = ['risk', 'warn', 'info', 'good'] as const
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
    // Below this many items a percentage overstates what we know, so no large figure is shown.
    const enough = (count: number) => count >= 5
    const insights = playerInsights?.insights

    // Each assignment counted once, the same way as the Delivery table on the page.
    const split = { overdue: 0, notStarted: 0, inProgress: 0, completed: 0 }
    reportData.scopedAssignments.forEach((assignment) => {
      const dueDate = toDate(assignment.dueDate)
      if (isCompletedAssignment(assignment)) split.completed += 1
      else if (dueDate && dayjs(dueDate).isBefore(dayjs(), 'day')) split.overdue += 1
      else if (isInProgressAssignment(assignment)) split.inProgress += 1
      else split.notStarted += 1
    })

    const slides: PlayerSlide[] = [
      {
        kind: 'title',
        eyebrow: 'Operations report',
        title: monthLabel,
        subtitle: `${companyName ? `${companyName} · ` : ''}Intervention delivery, appointments, compliance and SME growth for the period.`,
        icon: <FundOutlined />,
        accent: '#8b5cf6',
      },
      // Each data slide says every number once: the lead carries the main counts, the large figure is a
      // rate the lead doesn't state, and the bar adds the split.
      {
        kind: 'focus',
        title: 'Intervention delivery',
        lead: delivery.required
          ? `${delivery.completed} of ${plural(delivery.required, 'required intervention')} completed${summary.overdue ? `, and ${summary.overdue} ${summary.overdue === 1 ? 'is' : 'are'} overdue` : ', with nothing overdue'}.`
          : 'No interventions are required yet.',
        icon: <RiseOutlined />,
        accent: '#38bdf8',
        figure: enough(delivery.required) && delivery.rate !== null ? { value: `${delivery.rate}%`, label: 'of required' } : undefined,
        breakdownTitle: 'Where this period’s work stands',
        breakdown: [
          { label: 'Overdue', value: split.overdue, total: summary.assigned, color: tone.risk, note: split.overdue === summary.overdue ? '' : undefined },
          { label: 'Not started', value: split.notStarted, total: summary.assigned, color: tone.neutral },
          { label: 'In progress', value: split.inProgress, total: summary.assigned, color: tone.info },
          { label: 'Completed', value: split.completed, total: summary.assigned, color: tone.good },
        ],
      },
      {
        kind: 'focus',
        title: 'Appointments and attendance',
        lead: summary.appointments
          ? `${plural(summary.appointments, 'appointment')} planned, ${held} held so far.${held && !enough(held) ? ` ${summary.attended} of ${held} attended.` : ''}`
          : 'No appointments were scheduled in this period.',
        icon: <CalendarOutlined />,
        accent: '#22d3ee',
        figure: enough(held) && summary.attendanceRate !== null ? { value: `${summary.attendanceRate}%`, label: 'attendance' } : undefined,
        breakdownTitle: 'Appointment outcomes',
        breakdown: [
          { label: 'Absent', value: summary.absent, total: summary.appointments, color: tone.risk },
          { label: 'Upcoming or awaiting attendance', value: awaiting, total: summary.appointments, color: tone.neutral },
          { label: 'Attended', value: summary.attended, total: summary.appointments, color: tone.good, note: held && !enough(held) ? '' : undefined },
        ],
      },
      {
        kind: 'focus',
        title: 'Compliance',
        lead: documents
          ? `${inGoodStanding} of ${plural(documents, 'compliance document')} ${inGoodStanding === 1 ? 'is' : 'are'} in good standing, and ${summary.complianceRisk} ${summary.complianceRisk === 1 ? 'needs' : 'need'} follow-up.`
          : 'No compliance documents were on record for this period.',
        icon: <FileProtectOutlined />,
        accent: '#f59e0b',
        figure: enough(documents) ? { value: `${complianceRate}%`, label: 'compliant' } : undefined,
        breakdownTitle: 'Documents by status',
        breakdown: [...complianceCounts]
          .sort(([left], [right]) => toneOrder.indexOf(statusTone(left)) - toneOrder.indexOf(statusTone(right)))
          .map(([status, count]) => ({ label: status, value: count, total: documents, color: tone[statusTone(status)] })),
      },
      {
        kind: 'focus',
        title: 'Applications and participants',
        lead: `${plural(summary.submitted, 'application')} submitted and ${summary.accepted} accepted. ${plural(summary.participants, 'SME')} ${summary.participants === 1 ? 'is' : 'are'} active in the programme.`,
        icon: <AuditOutlined />,
        accent: '#a78bfa',
        figure: enough(summary.submitted) ? { value: `${summary.acceptanceRate}%`, label: 'accepted' } : undefined,
      },
    ]

    if (impact && impact.smesWithRevenue) {
      const steady = Math.max(impact.smesWithRevenue - impact.growingSmes, 0)
      slides.push({
        kind: 'focus',
        title: 'SME growth',
        lead: `Revenue across ${plural(impact.smesWithRevenue, 'SME')} has changed by ${impact.revenueGrowth === null ? 'an unknown amount' : `${impact.revenueGrowth > 0 ? '+' : ''}${impact.revenueGrowth}%`} since they joined, with ${impact.netJobs >= 0 ? '+' : ''}${impact.netJobs} jobs.`,
        icon: <FundOutlined />,
        accent: '#34d399',
        breakdownTitle: 'SMEs by revenue direction',
        breakdown: [
          { label: 'Not growing', value: steady, total: impact.smesWithRevenue, color: tone.neutral },
          { label: 'Growing', value: impact.growingSmes, total: impact.smesWithRevenue, color: tone.good },
        ],
      })
    }

    slides.push(
      {
        kind: 'narrative',
        title: 'What the figures say',
        icon: <BulbOutlined />,
        accent: '#fbbf24',
        loading: !insights,
        paragraph: insights?.executiveSummary,
        points: insights?.highlights.slice(0, 3).map((text) => ({ icon: <CheckCircleOutlined />, text, tone: 'good' as const })),
        note: insights ? (playerInsights?.aiGenerated ? 'Commentary written by AI from the report figures.' : 'Commentary compiled from the report figures.') : undefined,
      },
      // Risks and actions answer different questions, so each gets its own slide that fits a phone.
      {
        kind: 'narrative',
        title: 'Watch points',
        lead: insights?.outlook,
        icon: <WarningOutlined />,
        accent: '#f0808a',
        loading: !insights,
        points: insights?.risks.slice(0, 3).map((text) => ({ icon: <WarningOutlined />, text, tone: 'warn' as const })),
      },
      {
        kind: 'narrative',
        title: 'Next steps',
        icon: <BulbOutlined />,
        accent: '#60a5fa',
        loading: !insights,
        points: insights?.actionPlan.slice(0, 3).map((item) => ({ icon: <BulbOutlined />, text: item.action, meta: [item.owner, item.due].filter(Boolean).join(' · '), tone: 'info' as const })),
      },
      {
        kind: 'closing',
        title: 'End of report',
        subtitle: 'Use “Export report” for the full document with data tables.',
        icon: <CheckCircleOutlined />,
        accent: '#8b5cf6',
      },
    )
    return slides
  }, [companyName, complianceCounts, delivery, end, impact, playerInsights, playerMode, reportData, start, summary])

  const growth = impact?.revenueGrowth ?? null
  const cards: Array<{ key: TabKey, label: string, value: string | number, hint: string, trend?: ReturnType<typeof change>, icon: React.ReactNode, iconClassName: string }> = [
    {
      key: 'intake',
      label: t('Intake'),
      value: `${summary.accepted} / ${summary.submitted}`,
      hint: t('accepted'),
      trend: compare ? change(summary.accepted, summary.previousAccepted, 'count') : undefined,
      icon: <AuditOutlined />,
      iconClassName: 'is-applications',
    },
    {
      key: 'delivery',
      label: t('Delivery'),
      value: delivery.rate === null ? '—' : `${delivery.rate}%`,
      hint: t('of required'),
      trend: compare ? change(delivery.rate, previousDelivery.rate, 'pts') : undefined,
      icon: <CheckCircleOutlined />,
      iconClassName: 'is-delivery',
    },
    {
      key: 'appointments',
      label: t('Attendance'),
      value: summary.attendanceRate === null ? '—' : `${summary.attendanceRate}%`,
      hint: t('{attended} of {held} held', undefined, { attended: summary.attended, held: summary.held }),
      trend: compare ? change(summary.attendanceRate, summary.previousAttendanceRate, 'pts') : undefined,
      icon: <CalendarOutlined />,
      iconClassName: 'is-participants',
    },
    {
      key: 'growth',
      label: t('Growth'),
      value: growth === null ? '—' : `${growth > 0 ? '+' : ''}${growth}%`,
      hint: impact ? t('revenue since joining · {jobs} jobs', undefined, { jobs: `${impact.netJobs >= 0 ? '+' : ''}${impact.netJobs}` }) : t('revenue since joining'),
      icon: <RiseOutlined />,
      iconClassName: 'is-growth',
    },
  ]

  const periodIsEmpty = !loading && !reportData.scopedApplications.length && !!earliestApplicationDate && earliestApplicationDate.isBefore(start)
  const phone = !screens.md

  return (
    <DashboardPage className="operations-reports-page">
      <FilterBar
        primary={
          <>
            <RangePicker
              value={[start, end]}
              allowClear={false}
              presets={rangePresets}
              onChange={(value) => {
                if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
              }}
            />
            <Checkbox checked={compare} onChange={(event) => setCompare(event.target.checked)}>{t('Compare to previous period')}</Checkbox>
          </>
        }
        actions={(
          <>
            <Button icon={<PlayCircleOutlined />} onClick={(event) => startPlayer(event)} disabled={loading}>{t('Play report')}</Button>
            <ReportExportButton buildData={buildExportData} disabled={loading} />
          </>
        )}
      />

      {periodIsEmpty && (
        <Alert
          type="info"
          showIcon
          className="operations-reports-empty-alert"
          message={t('Nothing was recorded in this period. Records go back to {date}.', undefined, { date: earliestApplicationDate.format('D MMM YYYY') })}
          action={<Button size="small" onClick={() => setRange([earliestApplicationDate.startOf('day'), dayjs()])}>{t('Show all')}</Button>}
        />
      )}

      <Row gutter={[16, 16]} className="dashboard-metrics-row operations-reports-metrics">
        {cards.map((card) => (
          <Col xs={12} lg={6} key={card.key}>
            <DashboardMetricCard
              loading={loading || (card.key === 'growth' && !impact)}
              icon={card.icon}
              iconClassName={card.iconClassName}
              label={card.label}
              value={card.value}
              hint={card.hint}
              trend={card.trend}
              clickable
              active={tab === card.key}
              onClick={() => openTab(card.key)}
            />
          </Col>
        ))}
      </Row>

      <Segmented<TabKey>
        className="operations-reports-tabs"
        block={phone}
        value={tab}
        onChange={openTab}
        options={TABS.map((item) => ({ value: item.key, label: phone ? t(item.label) : <span>{item.icon} {t(item.label)}</span> }))}
      />

      <Card loading={loading} className="dashboard-section-card operations-analytics-panel">
        <div className="operations-analytics-head">
          <div>
            <h3>{t(TABS.find((item) => item.key === tab)?.question || '')}</h3>
            <Text type="secondary">{subline}</Text>
          </div>
          {active.dimensions.length > 1 && (
            <div className="operations-analytics-by">
              <Text type="secondary">{t('Break down by')}</Text>
              <Segmented
                size="small"
                value={dimension.key}
                onChange={(value) => { setDimensionKey(String(value)); setFilter(undefined) }}
                options={active.dimensions.map((item) => ({ value: item.key, label: t(item.label) }))}
              />
            </div>
          )}
        </div>
        <Row gutter={[24, 16]}>
          <Col xs={24} xl={14}>
            <div className="operations-analytics-label">{t(dimension.label)}{dimension.unit === 'percent' && tab === 'delivery' ? ` · ${t('completed of required')}` : ''}</div>
            {dimension.rows.length
              ? <ThemedHighcharts options={breakdownOptions} />
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nothing to break down in this period.')} />}
          </Col>
          <Col xs={24} xl={10}>
            <div className="operations-analytics-label">{t('Over the period')}</div>
            {active.trend.current.some(Boolean) || active.trend.previous.some(Boolean)
              ? <ThemedHighcharts options={trendOptions} />
              : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('Nothing recorded over this period.')} />}
          </Col>
        </Row>
      </Card>

      <Card
        loading={loading}
        className="dashboard-section-card operations-analytics-table"
        title={t(active.table.title)}
        extra={(
          <div className="operations-analytics-table-actions">
            {filter && <Tag closable closeIcon={<CloseOutlined />} onClose={() => setFilter(undefined)}>{t(filter)}</Tag>}
            <Button
              size="small"
              icon={<DownloadOutlined />}
              disabled={!tableRows.length}
              onClick={() => download(`${active.table.title.toLowerCase().replace(/\s+/g, '-')}-${start.format('YYYYMMDD')}-${end.format('YYYYMMDD')}.csv`, tableCsv(active.table.columns, tableRows))}
            >
              CSV
            </Button>
          </div>
        )}
      >
        {phone ? (
          <div className="operations-analytics-cards">
            {tableRows.slice(0, 30).map((row) => (
              <div className="operations-analytics-row-card" key={row.key}>
                <strong>{row.cells[active.table.columns[0].key]}</strong>
                {active.table.columns.slice(1).map((column) => (
                  <div key={column.key}>
                    <Text type="secondary">{t(column.label)}</Text>
                    <span>{column.status ? statusCell(row.cells[column.key]) : row.cells[column.key]}</span>
                  </div>
                ))}
              </div>
            ))}
            {!tableRows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No rows in this period.')} />}
            {tableRows.length > 30 && <Text type="secondary">{t('Showing 30 of {count}. Download the CSV for all of them.', undefined, { count: tableRows.length })}</Text>}
          </div>
        ) : (
          <Table<TableRow>
            rowKey="key"
            size="middle"
            dataSource={tableRows}
            columns={columns}
            pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
            locale={{ emptyText: t('No rows in this period.') }}
            scroll={{ x: 720 }}
          />
        )}
        {followUp && (
          <div className="operations-analytics-followup">
            <span>{followUp.text}</span>
            <Link to={followUp.path}>{followUp.link} →</Link>
          </div>
        )}
      </Card>

      <ReportPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} slides={playerSlides} origin={playerOrigin} />
    </DashboardPage>
  )
}

export default OperationsReportsPage
