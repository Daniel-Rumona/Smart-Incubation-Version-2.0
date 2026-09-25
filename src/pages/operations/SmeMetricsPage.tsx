import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Empty,
  Input,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  BankOutlined,
  BarChartOutlined,
  CalendarOutlined,
  EyeOutlined,
  LineChartOutlined,
  RiseOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import type Highcharts from 'highcharts'
import dayjs, { type Dayjs } from 'dayjs'
import isoWeek from 'dayjs/plugin/isoWeek'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { db } from '@/firebase/config'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import '@/styles/dashboard.css'
import '@/styles/sme-metrics.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

dayjs.extend(isoWeek)
dayjs.extend(quarterOfYear)

const { RangePicker } = DatePicker
const { Text } = Typography

type HistoryCadence = 'monthly' | 'annual'

type FirestoreDate =
  | Date
  | string
  | number
  | {
      toDate?: () => Date
      seconds?: number
      nanoseconds?: number
    }
  | null
  | undefined

type AnyDoc = Record<string, unknown>

type SmeMetricRow = {
  id: string
  businessName: string
  programId?: string
  programName?: string
  sector?: string
  gender?: string
  province?: string
  beeLevel?: string
  createdAt?: FirestoreDate
  acceptedAt?: FirestoreDate
  approvedAt?: FirestoreDate
  onboardedAt?: FirestoreDate
  revenue?: unknown
  annualRevenue?: unknown
  monthlyRevenue?: unknown
  turnover?: unknown
  annualTurnover?: unknown
  employeeCount?: unknown
  employees?: unknown
  numberOfEmployees?: unknown
  staffCount?: unknown
  jobsCreated?: unknown
  revenueHistory?: {
    monthly?: Record<string, unknown>
    annual?: Record<string, unknown>
  }
  headcountHistory?: {
    monthly?: Record<string, unknown>
    annual?: Record<string, unknown>
  }
}

type MetricEntry = {
  period: string
  date: Dayjs
  value: number
}

type SmeMetricSummaryRow = {
  key: string
  businessName: string
  sector: string
  gender: string
  province: string
  beeLevel: string
  programName: string
  revenue: number
  employees: number
  revenueDelta: number
  employeeDelta: number
  previousRevenue: number
  previousEmployees: number
}

const chunkArray = <T,>(items: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

const toDayjs = (value: FirestoreDate): Dayjs | null => {
  if (!value) return null
  if (dayjs.isDayjs(value)) return value.isValid() ? value : null
  if (value instanceof Date) {
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed : null
  }
  if (typeof value === 'number') {
    const parsed = dayjs(value > 1e12 ? value : value * 1000)
    return parsed.isValid() ? parsed : null
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const parsed = dayjs(value.toDate())
    return parsed.isValid() ? parsed : null
  }
  if (typeof value === 'object' && typeof value.seconds === 'number') {
    const parsed = dayjs(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1e6))
    return parsed.isValid() ? parsed : null
  }
  const parsed = dayjs(String(value))
  return parsed.isValid() ? parsed : null
}

const getPreviousRange = ([start, end]: [Dayjs, Dayjs]): [Dayjs, Dayjs] => {
  const days = end.startOf('day').diff(start.startOf('day'), 'day') + 1
  const previousEnd = start.subtract(1, 'day').endOf('day')
  return [previousEnd.subtract(days - 1, 'day').startOf('day'), previousEnd]
}

const inRange = (date: Dayjs, [start, end]: [Dayjs, Dayjs]) =>
  date.isValid() && !date.isBefore(start, 'day') && !date.isAfter(end, 'day')

const periodToDate = (period: string, cadence: HistoryCadence) => {
  const clean = period.trim()
  const parsed = cadence === 'annual' ? dayjs(`${clean}-12-31`) : dayjs(`${clean}-01`)
  return parsed.isValid() ? parsed : null
}

const toMetricNumber = (...values: unknown[]): number => {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue
    if (typeof value === 'object') {
        const nested: number = toMetricNumber(
        (value as AnyDoc).value,
        (value as AnyDoc).total,
        (value as AnyDoc).count,
        (value as AnyDoc).headcount,
        (value as AnyDoc).staffCount,
        (value as AnyDoc).numberOfEmployees,
      )
      if (nested > 0) return nested
    }
    const parsed = Number(String(value).replace(/[^0-9.-]+/g, ''))
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const getSmeAnchorDate = (row: SmeMetricRow) => {
  const candidates = [row.onboardedAt, row.acceptedAt, row.approvedAt, row.createdAt]
  for (const candidate of candidates) {
    const parsed = toDayjs(candidate)
    if (parsed) return parsed
  }
  return null
}

const getRevenueFallback = (row: SmeMetricRow) =>
  toMetricNumber(row.revenue, row.annualRevenue, row.turnover, row.annualTurnover, row.monthlyRevenue)

const getEmployeeFallback = (row: SmeMetricRow) =>
  toMetricNumber(row.employeeCount, row.employees, row.numberOfEmployees, row.staffCount, row.jobsCreated)

const historyEntries = (history: SmeMetricRow['revenueHistory'] | SmeMetricRow['headcountHistory']) => {
  const entries: MetricEntry[] = []
  Object.entries(history?.monthly || {}).forEach(([period, raw]) => {
    const date = periodToDate(period, 'monthly')
    const value = toMetricNumber(raw)
    if (date && value > 0) entries.push({ period, date, value })
  })
  Object.entries(history?.annual || {}).forEach(([period, raw]) => {
    const date = periodToDate(period, 'annual')
    const value = toMetricNumber(raw)
    if (date && value > 0) entries.push({ period, date, value })
  })
  return entries.sort((a, b) => a.date.valueOf() - b.date.valueOf() || a.period.localeCompare(b.period))
}

const revenueInRange = (row: SmeMetricRow, range: [Dayjs, Dayjs]) => {
  const entries = historyEntries(row.revenueHistory)
  const ranged = entries.filter(entry => inRange(entry.date, range))
  if (ranged.length) return ranged.reduce((sum, entry) => sum + entry.value, 0)
  const anchor = getSmeAnchorDate(row)
  return !anchor || !anchor.isAfter(range[1], 'day') ? getRevenueFallback(row) : 0
}

const employeesInRange = (row: SmeMetricRow, range: [Dayjs, Dayjs]) => {
  const entries = historyEntries(row.headcountHistory).filter(entry => inRange(entry.date, range))
  if (entries.length) return entries[entries.length - 1].value
  const anchor = getSmeAnchorDate(row)
  return !anchor || !anchor.isAfter(range[1], 'day') ? getEmployeeFallback(row) : 0
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    maximumFractionDigits: 0,
    notation: Math.abs(value) >= 1000000 ? 'compact' : 'standard',
  }).format(value)

const formatNumber = (value: number) => new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(value)

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.round((numerator / denominator) * 100) : 0)

type RangePresetKey = 'month' | 'quarter' | 'ytd'

const rangePresetOptions: Array<{ label: string; value: RangePresetKey; icon: ReactNode }> = [
  { get label() { return tr('This month') }, value: 'month', icon: <CalendarOutlined /> },
  { get label() { return tr('This quarter') }, value: 'quarter', icon: <CalendarOutlined /> },
  { get label() { return tr('Year to date') }, value: 'ytd', icon: <CalendarOutlined /> },
]

const rangeForPresetKey = (key: RangePresetKey): [Dayjs, Dayjs] => {
  const now = dayjs()
  if (key === 'month') return [now.startOf('month'), now.endOf('month')]
  if (key === 'quarter') return [now.startOf('quarter'), now.endOf('quarter')]
  return [now.startOf('year'), now]
}

type AnalyticsView = 'trend' | 'sectors'

const uniqueOptions = (rows: SmeMetricRow[], key: 'sector' | 'gender' | 'province' | 'beeLevel') =>
  Array.from(new Set(rows.map(row => String(row[key] || '').trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b))
    .map(value => ({ value, label: value }))

const delta = (current: number, previous: number) => {
  const difference = current - previous
  if (previous === 0) return { label: current > 0 ? '+100%' : '0%', positive: difference >= 0, difference }
  const percentage = Number(((difference / previous) * 100).toFixed(1))
  return { label: `${percentage > 0 ? '+' : ''}${percentage}%`, positive: difference >= 0, difference }
}

const bucketRange = (range: [Dayjs, Dayjs]) => {
  const [start, end] = range
  const days = end.diff(start, 'day') + 1
  const buckets: Array<{ key: string; label: string; range: [Dayjs, Dayjs] }> = []

  if (days <= 45) {
    let cursor = start.startOf('day')
    while (!cursor.isAfter(end, 'day')) {
      buckets.push({ key: cursor.format('YYYY-MM-DD'), label: cursor.format('DD MMM'), range: [cursor.startOf('day'), cursor.endOf('day')] })
      cursor = cursor.add(1, 'day')
    }
    return buckets
  }

  let cursor = start.startOf('month')
  while (!cursor.isAfter(end, 'month')) {
    buckets.push({
      key: cursor.format('YYYY-MM'),
      label: cursor.format('MMM YYYY'),
      range: [cursor.startOf('month'), cursor.endOf('month')],
    })
    cursor = cursor.add(1, 'month')
  }
  return buckets
}

export const SmeMetricsPage = () => {
  const { t } = useLanguage()
  const { message } = App.useApp()
  const { user } = useFullIdentity()
  const { activeProgramId, isAllPrograms } = useActiveProgramId()
  const [[start, end], setRange] = useState<[Dayjs, Dayjs]>(rangeForPresetKey('ytd'))
  const [rows, setRows] = useState<SmeMetricRow[]>([])
  const [search, setSearch] = useState('')
  const [sector, setSector] = useState('All')
  const [gender, setGender] = useState('All')
  const [province, setProvince] = useState('All')
  const [beeLevel, setBeeLevel] = useState('All')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [analyticsView, setAnalyticsView] = useState<AnalyticsView>('trend')
  const [[analyticsStart, analyticsEnd], setAnalyticsRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs().endOf('month')])

  const datePickerPresets = useMemo(
    () => rangePresetOptions.map(({ label, value }) => ({ label, value: rangeForPresetKey(value) })),
    [],
  )

  useEffect(() => {
    let mounted = true

    const loadRows = async () => {
      setLoading(true)
      try {
        const constraints = user?.companyCode ? [where('companyCode', '==', user.companyCode)] : []
        if (!isAllPrograms && activeProgramId) constraints.push(where('programId', '==', activeProgramId))

        const [participantsSnap, programsSnap] = await Promise.all([
          getDocs(query(collection(db, 'participants'), ...constraints)),
          getDocs(collection(db, 'programs')),
        ])

        const participants: AnyDoc[] = participantsSnap.docs
          .map(docSnap => ({ id: docSnap.id, ...(docSnap.data() as AnyDoc) } as AnyDoc))
          .filter(row => {
            const status = String(row.status || '').trim().toLowerCase()
            return !['inactive', 'exited', 'removed'].includes(status) && matchesActiveProgram(user, activeProgramId, String(row.programId || ''))
          })

        const businessProfileIds = Array.from(new Set(participants.map(row => String(row.businessProfileId || row.id || '').trim()).filter(Boolean)))
        const applicationIds = Array.from(new Set(participants.map(row => String(row.applicationId || '').trim()).filter(Boolean)))
        const businessProfiles = new Map<string, AnyDoc>()
        const applications = new Map<string, AnyDoc>()
        for (const chunk of chunkArray(businessProfileIds, 10)) {
          const profileSnap = await getDocs(query(collection(db, 'businessProfiles'), where(documentId(), 'in', chunk)))
          profileSnap.docs.forEach(docSnap => businessProfiles.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as AnyDoc) }))
        }
        for (const chunk of chunkArray(applicationIds, 10)) {
          const applicationSnap = await getDocs(query(collection(db, 'applications'), where(documentId(), 'in', chunk)))
          applicationSnap.docs.forEach(docSnap => applications.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() as AnyDoc) }))
        }

        const programNames = new Map(programsSnap.docs.map(docSnap => {
          const data = docSnap.data() as AnyDoc
          return [docSnap.id, String(data.name || data.programName || data.title || docSnap.id)]
        }))

        if (!mounted) return
        setRows(participants.map(participant => {
          const businessProfile = businessProfiles.get(String(participant.businessProfileId || participant.id || '').trim()) || {}
          const application = applications.get(String(participant.applicationId || '').trim()) || {}
          const merged = { ...application, ...businessProfile, ...participant } as AnyDoc
          const programId = String(merged.programId || businessProfile.programId || '').trim()

          return {
            id: String(participant.id),
            businessName: String(merged.businessName || merged.companyName || 'Unnamed SME'),
            programId,
            programName: String(programNames.get(programId) || merged.programName || programId || 'Unassigned'),
            sector: String(merged.sector || 'Unspecified'),
            gender: String(merged.gender || 'Unspecified'),
            province: String(merged.businessAddressProvince || merged.province || 'Unspecified'),
            beeLevel: String(merged.beeLevel || 'Unspecified'),
            createdAt: merged.createdAt as FirestoreDate,
            acceptedAt: merged.acceptedAt as FirestoreDate,
            approvedAt: merged.approvedAt as FirestoreDate,
            onboardedAt: merged.onboardedAt as FirestoreDate,
            revenue: merged.revenue,
            annualRevenue: merged.annualRevenue,
            monthlyRevenue: merged.monthlyRevenue,
            turnover: merged.turnover,
            annualTurnover: merged.annualTurnover,
            employeeCount: merged.employeeCount,
            employees: merged.employees,
            numberOfEmployees: merged.numberOfEmployees,
            staffCount: merged.staffCount,
            jobsCreated: merged.jobsCreated,
            revenueHistory: merged.revenueHistory as SmeMetricRow['revenueHistory'],
            headcountHistory: merged.headcountHistory as SmeMetricRow['headcountHistory'],
          }
        }))
      } catch (error) {
        console.error(error)
        message.error(t('Failed to load SME metrics'))
        if (mounted) setRows([])
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void loadRows()
    return () => {
      mounted = false
    }
  }, [activeProgramId, isAllPrograms, message, user, t])

  const previousRange = useMemo(() => getPreviousRange([start, end]), [end, start])
  const filteredRows = useMemo(() => {
    const searchTerm = search.trim().toLowerCase()

    return rows.filter(row => {
      const matchesSearch = !searchTerm || [
        row.businessName,
        row.programName,
        row.sector,
        row.gender,
        row.province,
        row.beeLevel,
      ].some(value => String(value || '').toLowerCase().includes(searchTerm))

      return matchesSearch
        && (sector === 'All' || row.sector === sector)
        && (gender === 'All' || row.gender === gender)
        && (province === 'All' || row.province === province)
        && (beeLevel === 'All' || row.beeLevel === beeLevel)
    })
  }, [beeLevel, gender, province, rows, search, sector])

  const computed = useMemo(() => {
    const summaryRows: SmeMetricSummaryRow[] = filteredRows.map(row => {
      const revenue = revenueInRange(row, [start, end])
      const employees = employeesInRange(row, [start, end])
      const previousRevenue = revenueInRange(row, previousRange)
      const previousEmployees = employeesInRange(row, previousRange)

      return {
        key: row.id,
        businessName: row.businessName,
        sector: row.sector || 'Unspecified',
        gender: row.gender || 'Unspecified',
        province: row.province || 'Unspecified',
        beeLevel: row.beeLevel || 'Unspecified',
        programName: row.programName || 'Unassigned',
        revenue,
        employees,
        revenueDelta: revenue - previousRevenue,
        employeeDelta: employees - previousEmployees,
        previousRevenue,
        previousEmployees,
      }
    })

    const revenue = summaryRows.reduce((sum, row) => sum + row.revenue, 0)
    const employees = summaryRows.reduce((sum, row) => sum + row.employees, 0)
    const previousRevenue = filteredRows.reduce((sum, row) => sum + revenueInRange(row, previousRange), 0)
    const previousEmployees = filteredRows.reduce((sum, row) => sum + employeesInRange(row, previousRange), 0)

    return {
      summaryRows,
      revenue,
      employees,
      previousRevenue,
      previousEmployees,
    }
  }, [end, filteredRows, previousRange, start])

  const analyticsRangeLabel = `${analyticsStart.format('DD MMM YYYY')} to ${analyticsEnd.format('DD MMM YYYY')}`
  const analyticsComputed = useMemo(() => {
    const buckets = bucketRange([analyticsStart, analyticsEnd]).map(bucket => ({
      ...bucket,
      revenue: filteredRows.reduce((sum, row) => sum + revenueInRange(row, bucket.range), 0),
      employees: filteredRows.reduce((sum, row) => sum + employeesInRange(row, bucket.range), 0),
    }))

    const sectorMap = new Map<string, { revenue: number; employees: number; smes: number }>()
    filteredRows.forEach(row => {
      const key = row.sector || 'Unspecified'
      const revenue = revenueInRange(row, [analyticsStart, analyticsEnd])
      const employees = employeesInRange(row, [analyticsStart, analyticsEnd])
      const current = sectorMap.get(key) || { revenue: 0, employees: 0, smes: 0 }
      current.revenue += revenue
      current.employees += employees
      current.smes += 1
      sectorMap.set(key, current)
    })

    return {
      buckets,
      sectors: Array.from(sectorMap.entries()).sort((a, b) => b[1].revenue - a[1].revenue),
    }
  }, [analyticsEnd, analyticsStart, filteredRows])

  const revenueDelta = delta(computed.revenue, computed.previousRevenue)
  const employeeDelta = delta(computed.employees, computed.previousEmployees)
  const rangeLabel = `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}`
  const selectedSummary = computed.summaryRows.find(row => row.key === selectedKey) || null
  const selectedSme = selectedSummary ? filteredRows.find(row => row.id === selectedSummary.key) || null : null
  const selectedRevenueDelta = selectedSummary ? delta(selectedSummary.revenue, selectedSummary.previousRevenue) : null
  const selectedEmployeeDelta = selectedSummary ? delta(selectedSummary.employees, selectedSummary.previousEmployees) : null
  const selectedBuckets = useMemo(() => {
    if (!selectedSme) return []
    return bucketRange([start, end]).map(bucket => ({
      ...bucket,
      revenue: revenueInRange(selectedSme, bucket.range),
      employees: employeesInRange(selectedSme, bucket.range),
    }))
  }, [end, selectedSme, start])

  useRegisterAgentPageContext({
    pageKey: 'operations-sme-metrics',
    pageName: 'SME Metrics',
    purpose: 'Shows collective SME revenue and employee totals for a selected period, with deltas against the previous equivalent period.',
    currentFilters: { activeProgramId: isAllPrograms ? 'all' : activeProgramId, search, sector, gender, province, beeLevel, from: start.format('YYYY-MM-DD'), to: end.format('YYYY-MM-DD') },
    metrics: {
      smes: filteredRows.length,
      revenue: computed.revenue,
      revenueDelta: revenueDelta.label,
      employees: computed.employees,
      employeeDelta: employeeDelta.label,
    },
    dataSummary: { visibleSmes: computed.summaryRows.length },
  })

  const impactOptions = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'column', height: 340 },
    title: { text: tr('Revenue and Employees') },
    subtitle: { text: analyticsRangeLabel },
    xAxis: { categories: analyticsComputed.buckets.map(bucket => bucket.label) },
    yAxis: [
      { title: { text: tr('Employees') }, min: 0 },
      { title: { text: tr('Revenue') }, min: 0, opposite: true },
    ],
    tooltip: { shared: true },
    series: [
      { type: 'column', name: tr('Employees'), data: analyticsComputed.buckets.map(bucket => bucket.employees), yAxis: 0 },
      { type: 'spline', name: tr('Revenue'), data: analyticsComputed.buckets.map(bucket => bucket.revenue), yAxis: 1 },
    ],
  }), [analyticsComputed.buckets, analyticsRangeLabel])

  const topSectors = useMemo(() => analyticsComputed.sectors.slice(0, 8), [analyticsComputed.sectors])
  const maxSectorRevenue = useMemo(() => Math.max(1, ...topSectors.map(([, values]) => values.revenue)), [topSectors])

  const selectedImpactOptions = useMemo<Highcharts.Options>(() => ({
    chart: { type: 'column', height: 300 },
    title: { text: selectedSummary ? selectedSummary.businessName : 'SME impact' },
    subtitle: { text: rangeLabel },
    xAxis: { categories: selectedBuckets.map(bucket => bucket.label) },
    yAxis: [
      { title: { text: tr('Employees') }, min: 0 },
      { title: { text: tr('Revenue') }, min: 0, opposite: true },
    ],
    tooltip: { shared: true },
    series: [
      { type: 'column', name: tr('Employees'), data: selectedBuckets.map(bucket => bucket.employees), yAxis: 0 },
      { type: 'spline', name: tr('Revenue'), data: selectedBuckets.map(bucket => bucket.revenue), yAxis: 1 },
    ],
  }), [rangeLabel, selectedBuckets, selectedSummary])

  const columns: ColumnsType<SmeMetricSummaryRow> = [
    {
      title: t('SME'),
      dataIndex: 'businessName',
      key: 'businessName',
      render: (value: string, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {[row.sector, row.gender, row.province, isAllPrograms ? row.programName : null].filter(Boolean).join(' · ')}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: t('Revenue'),
      dataIndex: 'revenue',
      key: 'revenue',
      width: 230,
      align: 'right',
      render: (value: number, row) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Typography.Text strong>{formatCurrency(value)}</Typography.Text>
          <Tag color={row.revenueDelta >= 0 ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>{row.revenueDelta >= 0 ? '+' : ''}{formatCurrency(row.revenueDelta)}</Tag>
        </Space>
      ),
    },
    {
      title: t('Employees'),
      dataIndex: 'employees',
      key: 'employees',
      width: 190,
      align: 'right',
      render: (value: number, row) => (
        <Space direction="vertical" size={0} style={{ alignItems: 'flex-end' }}>
          <Typography.Text strong>{formatNumber(value)}</Typography.Text>
          <Tag color={row.employeeDelta >= 0 ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>{row.employeeDelta >= 0 ? '+' : ''}{formatNumber(row.employeeDelta)}</Tag>
        </Space>
      ),
    },
    {
      title: '',
      key: 'drilldown',
      width: 48,
      align: 'center',
      render: () => <EyeOutlined style={{ color: 'rgba(0, 0, 0, 0.35)' }} />,
    },
  ]

  return (
    <DashboardPage className="sme-metrics-page">
      <Row gutter={[12, 12]} className="dashboard-metrics-row">
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('SMEs')} value={filteredRows.length} hint={rangeLabel} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<BankOutlined />} label={t('Revenue')} value={formatCurrency(computed.revenue)} hint={`${revenueDelta.label} from previous period`} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<RiseOutlined />} label={t('Employees')} value={formatNumber(computed.employees)} hint={`${employeeDelta.label} from previous period`} /></Col>
        <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<LineChartOutlined />} label={t('Revenue / SME')} value={formatCurrency(filteredRows.length ? computed.revenue / filteredRows.length : 0)} hint={t('Average in selected scope')} /></Col>
      </Row>

      <FilterBar
        primary={
          <>
            <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search SME name')} allowClear />
            <Select value={sector} onChange={setSector} options={[{ value: 'All', label: t('All sectors') }, ...uniqueOptions(rows, 'sector')]} />
            <Select value={gender} onChange={setGender} options={[{ value: 'All', label: t('All genders') }, ...uniqueOptions(rows, 'gender')]} />
            <RangePicker
              value={[start, end]}
              allowClear={false}
              presets={datePickerPresets}
              onChange={(value) => {
                if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
              }}
            />
          </>
        }
        advanced={
          <>
            <Select value={province} onChange={setProvince} options={[{ value: 'All', label: t('All provinces') }, ...uniqueOptions(rows, 'province')]} />
            <Select value={beeLevel} onChange={setBeeLevel} options={[{ value: 'All', label: t('All B-BBEE levels') }, ...uniqueOptions(rows, 'beeLevel')]} />
          </>
        }
        actions={
          <Button icon={<BarChartOutlined />} onClick={() => setAnalyticsOpen(true)}>{t('Analytics')}</Button>
        }
      />

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card
            className="dashboard-section-card motion-card"
            title={<Space><BarChartOutlined /> {t('SME Metric Breakdown')}</Space>}
            extra={<Text type="secondary">{rangeLabel}</Text>}
          >
            <Alert
              showIcon
              type={computed.revenue > 0 || computed.employees > 0 ? 'info' : 'warning'}
              message={t('Delta compares against the previous equivalent period.')}
              style={{ marginBottom: 16 }}
            />
            <Table
              rowKey="key"
              columns={columns}
              dataSource={computed.summaryRows}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              locale={{ emptyText: t('No SMEs match this metric scope.') }}
              onRow={(row) => ({
                onClick: () => setSelectedKey(row.key),
              })}
              rowClassName="sme-metrics-clickable-row"
            />
          </Card>
        </Col>
      </Row>

      <Modal
        open={analyticsOpen}
        onCancel={() => setAnalyticsOpen(false)}
        footer={null}
        title={<Space><BarChartOutlined /> {t('SME Analytics')}</Space>}
        width={960}
        destroyOnClose
      >
        <div style={{ display: 'flex', gap: 10, width: '100%', marginBottom: 16 }}>
          <Segmented<AnalyticsView>
            style={{ flex: 1 }}
            value={analyticsView}
            onChange={setAnalyticsView}
            options={[
              { label: t('Revenue & Employees'), value: 'trend', icon: <LineChartOutlined /> },
              { label: t('Sector Contribution'), value: 'sectors', icon: <BarChartOutlined /> },
            ]}
          />
          <RangePicker
            style={{ flex: 1 }}
            value={[analyticsStart, analyticsEnd]}
            allowClear={false}
            presets={datePickerPresets}
            onChange={(value) => {
              if (value?.[0] && value?.[1]) setAnalyticsRange([value[0], value[1]])
            }}
          />
        </div>
        {analyticsView === 'trend' ? (
          <Card loading={loading} className="dashboard-section-card motion-card">
            {analyticsComputed.buckets.some(bucket => bucket.revenue > 0 || bucket.employees > 0)
              ? <ThemedHighcharts options={impactOptions} />
              : <Empty description={t('No revenue or employee metrics found for this period')} />}
          </Card>
        ) : (
          <Card loading={loading} className="dashboard-section-card motion-card" title={t('Sector Contribution')}>
            {topSectors.length ? (
              <Space direction="vertical" size={14} style={{ width: '100%' }}>
                {topSectors.map(([sectorName, values]) => (
                  <div key={sectorName}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <Text>{sectorName}</Text>
                      <Text strong>{formatCurrency(values.revenue)}</Text>
                    </div>
                    <Progress percent={percent(values.revenue, maxSectorRevenue)} showInfo={false} />
                  </div>
                ))}
              </Space>
            ) : <Empty description={t('No sector metrics found')} />}
          </Card>
        )}
      </Modal>

      <Modal
        open={!!selectedSummary}
        title={selectedSummary?.businessName || t('SME metrics')}
        footer={null}
        onCancel={() => setSelectedKey(null)}
        width={920}
      >
        {selectedSummary && (
          <Space direction="vertical" size={16} className="sme-metrics-drilldown">
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<BankOutlined />} label={t('Revenue')} value={formatCurrency(selectedSummary.revenue)} hint={`${selectedRevenueDelta?.label} from previous`} />
              </Col>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<BankOutlined />} label={t('Previous revenue')} value={formatCurrency(selectedSummary.previousRevenue)} />
              </Col>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<RiseOutlined />} label={t('Employees')} value={formatNumber(selectedSummary.employees)} hint={`${selectedEmployeeDelta?.label} from previous`} />
              </Col>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<RiseOutlined />} label={t('Previous employees')} value={formatNumber(selectedSummary.previousEmployees)} />
              </Col>
            </Row>
            <Descriptions bordered size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label={t('Programme')}>{selectedSummary.programName}</Descriptions.Item>
              <Descriptions.Item label={t('Sector')}>{selectedSummary.sector}</Descriptions.Item>
              <Descriptions.Item label={t('Gender')}>{selectedSummary.gender}</Descriptions.Item>
              <Descriptions.Item label={t('Province')}>{selectedSummary.province}</Descriptions.Item>
              <Descriptions.Item label={t('B-BBEE')}>{selectedSummary.beeLevel}</Descriptions.Item>
              <Descriptions.Item label={t('Period')}>{rangeLabel}</Descriptions.Item>
            </Descriptions>
            <Card className="dashboard-section-card">
              {selectedBuckets.some(bucket => bucket.revenue > 0 || bucket.employees > 0)
                ? <ThemedHighcharts options={selectedImpactOptions} />
                : <Empty description={t('No individual metric history found for this period')} />}
            </Card>
          </Space>
        )}
      </Modal>
    </DashboardPage>
  )
}

export default SmeMetricsPage
