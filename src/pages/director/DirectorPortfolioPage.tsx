import { useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Grid,
  Input,
  Modal,
  Pagination,
  Progress,
  Row,
  Select,
  Space,
  Tag,
  Table,
  App,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type Highcharts from 'highcharts'
import {
  CheckCircleOutlined,
  DollarOutlined,
  EyeOutlined,
  FundOutlined,
  RiseOutlined,
  SearchOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listDirectorPortfolio } from '@/services/directorPortfolioService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import type { DirectorPortfolioSme, DirectorRisk, DirectorStage } from '@/types/director'
import '@/styles/director.css'

const { useBreakpoint } = Grid
const DESKTOP_PAGE_SIZE = 8
const MOBILE_PAGE_SIZE = 5

const percent = (numerator: number, denominator: number) => (denominator > 0 ? Math.round((numerator / denominator) * 100) : 0)

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value || 0)

const riskColor = (risk: DirectorRisk) => {
  if (risk === 'High') return 'red'
  if (risk === 'Medium') return 'orange'
  return 'green'
}

const statusColor = (status: DirectorPortfolioSme['status']) => {
  if (status === 'Warning') return 'orange'
  if (status === 'Paused') return 'default'
  return 'green'
}

const stageColor = (stage: DirectorStage) => {
  if (stage === 'Seed') return 'purple'
  if (stage === 'Startup') return 'blue'
  if (stage === 'Early Growth') return 'geekblue'
  if (stage === 'Growth') return 'green'
  return 'gold'
}

const makeInitials = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('')

const SmeAvatar = ({ sme, size }: { sme: DirectorPortfolioSme, size?: number }) => (
  <Avatar shape="circle" size={size} src={sme.photoUrl || undefined} style={{ flexShrink: 0 }}>
    {makeInitials(sme.name)}
  </Avatar>
)

export const DirectorPortfolioPage = () => {
  const { message } = App.useApp()
  const screens = useBreakpoint()
  const isMobile = !screens.md
  const { user } = useFullIdentity()
  const { activeProgramId } = useActiveProgramId()

  const [queryText, setQueryText] = useState('')
  const [sector, setSector] = useState<string | undefined>(undefined)
  const [risk, setRisk] = useState<DirectorRisk | undefined>(undefined)
  const [stage, setStage] = useState<DirectorStage | undefined>(undefined)
  const [rows, setRows] = useState<DirectorPortfolioSme[]>([])
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<DirectorPortfolioSme | null>(null)
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!user) return
      setLoading(true)
      try {
        const data = await listDirectorPortfolio(user, activeProgramId)
        if (mounted) setRows(data)
      } catch (error) {
        console.error(error)
        message.error('Portfolio data could not be loaded.')
        if (mounted) setRows([])
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => {
      mounted = false
    }
  }, [activeProgramId, message, user])

  const sectors = useMemo(() => Array.from(new Set(rows.map(item => item.sector))).sort(), [rows])

  const filtered = useMemo(() => {
    const text = queryText.trim().toLowerCase()
    return rows.filter(sme => {
      const matchText =
        !text ||
        sme.name.toLowerCase().includes(text) ||
        sme.sector.toLowerCase().includes(text) ||
        String(sme.programName || '').toLowerCase().includes(text)

      return matchText && (!sector || sme.sector === sector) && (!risk || sme.risk === risk) && (!stage || sme.stage === stage)
    })
  }, [queryText, rows, sector, risk, stage])

  const kpis = useMemo(() => {
    const total = filtered.length
    const highRisk = filtered.filter(item => item.risk === 'High').length
    const avgProgress = total === 0 ? 0 : Math.round(filtered.reduce((sum, item) => sum + item.progress, 0) / total)
    const totalValue = filtered.reduce((sum, item) => sum + item.metrics.revenue, 0)
    const totalRequired = filtered.reduce((sum, item) => sum + item.execution.required, 0)
    const totalCompleted = filtered.reduce((sum, item) => sum + item.execution.completed, 0)

    return { total, highRisk, avgProgress, totalValue, totalRequired, totalCompleted }
  }, [filtered])

  useRegisterAgentPageContext({
    pageKey: 'director-portfolio',
    pageName: 'Director Portfolio',
    purpose: 'Track SME performance, risk and progress with director-level drilldowns.',
    currentFilters: { queryText, sector, risk, stage },
    metrics: kpis,
    dataSummary: { visibleSmes: filtered.length },
  })

  const openPerformance = (sme: DirectorPortfolioSme) => {
    setSelected(sme)
    setOpen(true)
  }

  const revenueEmployeesChart = useMemo<Highcharts.Options | null>(() => {
    if (!selected?.trend.length) return null
    const trend = selected.trend
    return {
      chart: { type: 'column', height: 300 },
      title: { text: 'Growth Trend' },
      xAxis: { categories: trend.map(item => item.month) },
      yAxis: [{ title: { text: 'Revenue (ZAR)' } }, { title: { text: 'Employees' }, opposite: true, allowDecimals: false }],
      tooltip: { shared: true },
      plotOptions: { column: { borderRadius: 6 } },
      series: [
        { name: 'Revenue', type: 'column', data: trend.map(item => item.revenue), yAxis: 0 },
        { name: 'Employees', type: 'line', data: trend.map(item => item.employees), yAxis: 1 },
      ],
    }
  }, [selected])

  const pageSize = isMobile ? MOBILE_PAGE_SIZE : DESKTOP_PAGE_SIZE
  const pagedRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize])

  const columns: ColumnsType<DirectorPortfolioSme> = [
    {
      title: 'SME',
      key: 'name',
      render: (_, row) => (
        <Space>
          <SmeAvatar sme={row} />
          <div className="director-sme-cell">
            <strong>{row.name}</strong>
            <div className="director-sme-subtext">{row.sector}</div>
          </div>
        </Space>
      ),
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    { title: 'Stage', dataIndex: 'stage', key: 'stage', width: 140, render: value => <Tag color={stageColor(value)}>{value}</Tag> },
    { title: 'Risk', dataIndex: 'risk', key: 'risk', width: 110, render: value => <Tag color={riskColor(value)}>{value}</Tag> },
    {
      title: 'Progress',
      dataIndex: 'progress',
      key: 'progress',
      width: 190,
      render: (value: number, row) => (
        <Progress percent={value} size="small" status={row.risk === 'High' ? 'exception' : value >= 80 ? 'success' : 'active'} />
      ),
      sorter: (a, b) => a.progress - b.progress,
    },
    { title: 'Revenue', key: 'revenue', width: 160, render: (_, row) => <span>{formatCurrency(row.metrics.revenue)}</span>, sorter: (a, b) => a.metrics.revenue - b.metrics.revenue },
    { title: 'Employees', key: 'employees', width: 120, align: 'right', render: (_, row) => row.metrics.employees, sorter: (a, b) => a.metrics.employees - b.metrics.employees },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 130, render: value => <Tag color={statusColor(value)}>{value}</Tag> },
    {
      title: '',
      key: 'action',
      width: 180,
      align: 'right',
      render: (_, row) => (
        <Button icon={<EyeOutlined />} type="primary" onClick={() => openPerformance(row)}>
          View Performance
        </Button>
      ),
    },
  ]

  const renderPortfolioCard = (row: DirectorPortfolioSme) => (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
        <Space align="start">
          <SmeAvatar sme={row} />
          <div>
            <strong>{row.name}</strong>
            <div style={{ fontSize: 12, opacity: 0.75 }}>{row.sector}</div>
          </div>
        </Space>
        <Tag color={riskColor(row.risk)}>{row.risk}</Tag>
      </Space>
      <Space wrap>
        <Tag color={stageColor(row.stage)}>{row.stage}</Tag>
        <Tag color={statusColor(row.status)}>{row.status}</Tag>
        {row.programName && <Tag>{row.programName}</Tag>}
      </Space>
      <Progress percent={row.progress} size="small" status={row.risk === 'High' ? 'exception' : row.progress >= 80 ? 'success' : 'active'} />
      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
        <span className="director-muted">Revenue</span>
        <strong>{formatCurrency(row.metrics.revenue)}</strong>
      </Space>
      <Button block icon={<EyeOutlined />} type="primary" onClick={() => openPerformance(row)}>
        View Performance
      </Button>
    </Space>
  )

  return (
    <div className="director-page director-portfolio-page">
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <DashboardMetricCard loading={loading} icon={<TeamOutlined />} iconClassName="is-users" label="Portfolio SMEs" value={kpis.total} />
        </Col>

        <Col xs={12} md={6}>
          <DashboardMetricCard loading={loading} icon={<WarningOutlined />} iconClassName="is-attention" label="High Risk" value={kpis.highRisk} />
        </Col>

        <Col xs={12} md={6}>
          <DashboardMetricCard loading={loading} icon={<RiseOutlined />} iconClassName="is-delivery" label="Avg Progress" value={`${kpis.avgProgress}%`} />
        </Col>

        <Col xs={12} md={6}>
          <DashboardMetricCard loading={loading} icon={<DollarOutlined />} iconClassName="is-participants" label="Portfolio Revenue" value={formatCurrency(kpis.totalValue)} />
        </Col>
      </Row>

      <FilterBar
        primary={
          <>
            <Input
              allowClear
              prefix={<SearchOutlined />}
              placeholder="Search SME or sector..."
              value={queryText}
              onChange={event => {
                setQueryText(event.target.value)
                setPage(1)
              }}
            />
            <Select
              allowClear
              placeholder="Sector"
              value={sector}
              onChange={value => {
                setSector(value)
                setPage(1)
              }}
              options={sectors.map(item => ({ value: item, label: item }))}
            />
            <Select
              allowClear
              placeholder="Risk"
              value={risk}
              onChange={value => {
                setRisk(value)
                setPage(1)
              }}
              options={[
                { value: 'Low', label: 'Low' },
                { value: 'Medium', label: 'Medium' },
                { value: 'High', label: 'High' },
              ]}
            />
            <Select
              allowClear
              placeholder="Stage"
              value={stage}
              onChange={value => {
                setStage(value)
                setPage(1)
              }}
              options={[
                { value: 'Seed', label: 'Seed' },
                { value: 'Startup', label: 'Startup' },
                { value: 'Early Growth', label: 'Early Growth' },
                { value: 'Growth', label: 'Growth' },
                { value: 'Mature', label: 'Mature' },
              ]}
            />
          </>
        }
      />

      <Card className="director-card-lg director-section-gap">
        {filtered.length ? (
          <>
            {isMobile ? (
              <div className="director-mobile-records">
                {pagedRows.map(row => (
                  <Card key={row.id} className="responsive-list-card">
                    {renderPortfolioCard(row)}
                  </Card>
                ))}
              </div>
            ) : (
              <Table
                rowKey="id"
                columns={columns}
                dataSource={filtered}
                pagination={{ pageSize: DESKTOP_PAGE_SIZE, position: ['bottomCenter'], showSizeChanger: false }}
                scroll={{ x: 1060 }}
              />
            )}
            {isMobile && (
              <Pagination
                align="center"
                current={page}
                pageSize={MOBILE_PAGE_SIZE}
                total={filtered.length}
                showSizeChanger={false}
                hideOnSinglePage
                onChange={setPage}
                className="director-pagination"
              />
            )}
          </>
        ) : (
          <Empty description="No SMEs match the current portfolio filters." />
        )}
      </Card>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        width={isMobile ? '100%' : 980}
        style={isMobile ? { top: 0, paddingBottom: 0 } : undefined}
        title={selected ? (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.25 }}>{selected.name}</div>
            <div style={{ fontSize: 12, fontWeight: 400, opacity: 0.7, marginTop: 2 }}>
              {[selected.sector, selected.programName].filter(Boolean).join(' · ')}
            </div>
          </div>
        ) : 'SME Performance'}
      >
        {selected && (
          <>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<DollarOutlined />} iconClassName="is-participants" label="Revenue" value={formatCurrency(selected.metrics.revenue)} />
              </Col>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<TeamOutlined />} iconClassName="is-users" label="Employees" value={selected.metrics.employees} />
              </Col>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<ThunderboltOutlined />} iconClassName="is-delivery" label="Growth Rate" value={`${selected.metrics.growthRate}%`} />
              </Col>
              <Col xs={12} md={6}>
                <DashboardMetricCard icon={<CheckCircleOutlined />} iconClassName="is-participants" label="Progress" value={`${selected.progress}%`} />
              </Col>
            </Row>

            <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
              <Col xs={24} md={14}>
                <Card style={{ borderRadius: 16 }}>
                  {revenueEmployeesChart ? <ThemedHighcharts options={revenueEmployeesChart} /> : <Empty description="No revenue history recorded for this SME yet." />}
                </Card>
              </Col>

              <Col xs={24} md={10}>
                <Card style={{ borderRadius: 16 }}>
                  <div style={{ fontWeight: 600, marginBottom: 12 }}>Execution (Required vs Completed)</div>
                  <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    {[
                      { name: `Completed (${selected.execution.completed}/${selected.execution.required})`, value: percent(selected.execution.completed, selected.execution.required), color: '#16a34a' },
                      { name: `Remaining (${Math.max(selected.execution.required - selected.execution.completed, 0)})`, value: percent(Math.max(selected.execution.required - selected.execution.completed, 0), selected.execution.required), color: '#f59e0b' },
                    ].filter(item => item.value > 0).map(item => (
                      <div key={item.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                          <span>{item.name}</span>
                          <strong>{item.value}%</strong>
                        </div>
                        <Progress percent={item.value} showInfo={false} strokeColor={item.color} />
                      </div>
                    ))}
                  </Space>
                  <Divider style={{ margin: '10px 0' }} />
                  <Row gutter={[10, 10]}>
                    <Col span={12}>
                      <DashboardMetricCard icon={<WarningOutlined />} iconClassName="is-attention" label="Overdue" value={selected.execution.overdue} hint="Past due, not completed" />
                    </Col>
                    <Col span={12}>
                      <DashboardMetricCard icon={<FundOutlined />} iconClassName="is-users" label="Unresponsive" value={selected.execution.unresponsive} hint="Pending SME acceptance 7+ days" />
                    </Col>
                    <Col span={12}>
                      <DashboardMetricCard icon={<RiseOutlined />} iconClassName="is-participants" label="Upcoming" value={selected.execution.upcoming} hint="Due within 14 days" />
                    </Col>
                    <Col span={12}>
                      <DashboardMetricCard icon={<CheckCircleOutlined />} iconClassName="is-delivery" label="Required" value={selected.execution.required} hint={`${selected.execution.completed} completed`} />
                    </Col>
                  </Row>
                </Card>
              </Col>
            </Row>
          </>
        )}
      </Modal>
    </div>
  )
}

export default DirectorPortfolioPage
