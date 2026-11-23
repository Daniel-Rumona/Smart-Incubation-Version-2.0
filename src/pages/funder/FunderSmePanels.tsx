import { useEffect, useMemo, useState } from 'react'
import { Alert, Avatar, Button, Card, Empty, Input, Pagination, Progress, Select, Skeleton, Space, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, RiseOutlined, SearchOutlined, SortAscendingOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type Highcharts from 'highcharts'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useLanguage } from '@/providers/LanguageProvider'
import { isBehind } from '@/services/funderService'
import { loadSmeDetail, type SmeDetail as SmeDetailData, type SmeSupportItem } from '@/services/funderSmeDetailService'
import { formatCurrencyZAR } from '@/services/smePerformanceMetrics'
import type { DirectorPortfolioSme } from '@/types/director'
import '@/styles/operations-compliance.css'
import '@/styles/funder.css'

const PAGE_SIZE = 12
const RISK_COLOR: Record<string, string> = { Low: 'green', Medium: 'gold', High: 'red' }
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || '?'
const change = (figures?: { start: number; latest: number } | null) =>
  figures && figures.start > 0 ? Math.round(((figures.latest - figures.start) / figures.start) * 100) : null
/** Only a real web address is tried as a picture; anything else shows the initials. */
const pictureOf = (url?: string) => (url && /^https?:\/\//i.test(url) ? url : undefined)

type Sort = 'name' | 'behind' | 'growth'

/**
 * SMEs as two panels, laid out like the Applications page: the list on the left (search, sort, pages of 12), the
 * chosen SME's figures on the right. Below desktop width the list fills the page and the details open in its place,
 * with a way back. Processed figures only: no contact details.
 */
export default function FunderSmePanels({ smes, loading, showImplementor, showProgramme }: {
  smes: DirectorPortfolioSme[]
  loading: boolean
  /** Name each SME's implementor in the list (when SMEs of several are shown). */
  showImplementor: boolean
  /** Name each SME's programme in the list (when SMEs of several programmes are shown). */
  showProgramme: boolean
}) {
  const { t } = useLanguage()
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<Sort>('name')
  const [page, setPage] = useState(1)
  const [chosenId, setChosenId] = useState<string>()
  const [detailOpen, setDetailOpen] = useState(false)

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase()
    const growth = (row: DirectorPortfolioSme) => change(row.growth?.revenue) ?? -Infinity
    return smes
      .filter((row) => !term || `${row.name} ${row.sector} ${row.programName || ''} ${row.companyName || ''}`.toLowerCase().includes(term))
      .sort((left, right) => {
        if (sort === 'behind') return (right.execution.overdue - left.execution.overdue) || left.name.localeCompare(right.name)
        if (sort === 'growth') return (growth(right) - growth(left)) || left.name.localeCompare(right.name)
        return left.name.localeCompare(right.name)
      })
  }, [search, smes, sort])
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const chosen = rows.find((row) => row.id === chosenId) || rows[0]

  if (loading) return <Skeleton active />
  if (!smes.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SMEs here yet.')} />

  return (
    <div className={`compliance-workspace funder-sme-workspace${detailOpen && chosen ? ' compliance-workspace--detail' : ''}`}>
      <Card className="compliance-participants">
        <Space orientation="vertical" size={8} style={{ width: '100%' }}>
          <Input allowClear prefix={<SearchOutlined />} placeholder={t('Search SMEs')} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} />
          <Select
            className="compliance-list-sort"
            aria-label={t('Sort SMEs')}
            prefix={<span className="compliance-sort-prefix">{t('Sort by')}</span>}
            variant="borderless"
            value={sort}
            onChange={(value) => { setSort(value); setPage(1) }}
            options={[
              { value: 'name', label: <Space size={8}><SortAscendingOutlined />{t('Name A–Z')}</Space> },
              { value: 'behind', label: <Space size={8}><WarningOutlined />{t('Most overdue first')}</Space> },
              { value: 'growth', label: <Space size={8}><RiseOutlined />{t('Highest revenue growth')}</Space> },
            ]}
          />
        </Space>
        <nav className="compliance-participant-list funder-sme-list" aria-label={t('SMEs')}>
          {pageRows.map((row) => (
            <button
              type="button"
              key={row.id}
              className={`compliance-participant${row.id === chosen?.id ? ' compliance-participant--selected' : ''}`}
              aria-current={row.id === chosen?.id ? 'true' : undefined}
              onClick={() => { setChosenId(row.id); setDetailOpen(true) }}
            >
              <Avatar className="compliance-participant-avatar funder-sme-avatar" src={pictureOf(row.photoUrl)} size={36}>{initials(row.name)}</Avatar>
              <div className="compliance-participant-main">
                <div className="compliance-participant-name" title={row.name}>{row.name}</div>
                <div className="compliance-participant-meta" title={row.sector}>{row.sector}</div>
                {(showProgramme || showImplementor) && (
                  <div className="compliance-participant-meta">{[showProgramme ? row.programName : '', showImplementor ? row.companyName : ''].filter(Boolean).join(' · ')}</div>
                )}
              </div>
              <div className="compliance-participant-side">
                <Tag color={RISK_COLOR[row.risk] || 'default'}>{t('{risk} risk', undefined, { risk: t(row.risk) })}</Tag>
                {isBehind(row) && <Tag color="red">{t('Behind')}</Tag>}
              </div>
            </button>
          ))}
          {!rows.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No SME matches that search.')} />}
        </nav>
        {rows.length > PAGE_SIZE && (
          <div className="compliance-list-pagination">
            <Pagination size="small" current={currentPage} total={rows.length} pageSize={PAGE_SIZE} showSizeChanger={false} showLessItems onChange={setPage} />
          </div>
        )}
      </Card>
      <Card className="compliance-detail">
        <Button className="compliance-back" icon={<ArrowLeftOutlined />} onClick={() => setDetailOpen(false)}>{t('Back to SMEs')}</Button>
        {chosen && <SmeDetail sme={chosen} />}
      </Card>
    </div>
  )
}

const SUPPORT_TAG: Record<SmeSupportItem['state'], { color: string; label: string }> = {
  overdue: { color: 'red', label: 'Overdue' },
  due: { color: 'gold', label: 'Due soon' },
  open: { color: 'blue', label: 'In progress' },
  done: { color: 'green', label: 'Done' },
}
const SUPPORT_SHOWN = 8

function SmeDetail({ sme }: { sme: DirectorPortfolioSme }) {
  const { t } = useLanguage()
  const [detail, setDetail] = useState<SmeDetailData | null>(null)
  const [detailFor, setDetailFor] = useState<string>()
  const [allSupport, setAllSupport] = useState(false)
  const loadingDetail = detailFor !== sme.id

  // The support plan, meetings and ownership load when an SME is chosen.
  useEffect(() => {
    let active = true
    loadSmeDetail(sme)
      .then((next) => { if (active) { setDetail(next); setDetailFor(sme.id); setAllSupport(false) } })
      .catch(() => { if (active) { setDetail(null); setDetailFor(sme.id) } })
    return () => { active = false }
  }, [sme])

  const revenueChange = change(sme.growth?.revenue)
  const jobsChange = sme.growth?.jobs ? sme.growth.jobs.latest - sme.growth.jobs.start : null
  const delivery = sme.execution.required ? Math.min(100, Math.round((sme.execution.completed / sme.execution.required) * 100)) : null

  // Stopped sending monthly figures: 60+ days since the last report, or none at all 60+ days after joining.
  const reportGapDays = sme.lastReport ? dayjs().diff(dayjs(sme.lastReport), 'day') : null
  const reportGapMonths = reportGapDays !== null && reportGapDays >= 60 ? Math.floor(reportGapDays / 30) : null
  const neverReported = !sme.lastReport && !!sme.joinedAt && dayjs().diff(dayjs(sme.joinedAt), 'day') >= 60

  // Why the SME carries its risk, in a line: what is late, and which way the numbers are going.
  const reasons = [
    sme.execution.overdue ? t('{count} interventions overdue', undefined, { count: sme.execution.overdue }) : '',
    sme.execution.unresponsive ? t('{count} plans not signed for over a week', undefined, { count: sme.execution.unresponsive }) : '',
    revenueChange !== null && revenueChange < 0 ? t('revenue down {change}% since joining', undefined, { change: Math.abs(revenueChange) }) : '',
    jobsChange !== null && jobsChange < 0 ? t('{count} fewer jobs since joining', undefined, { count: Math.abs(jobsChange) }) : '',
    // Same 60-day line as the director's risk reasons (components/director/SmeRiskReasons).
    reportGapMonths !== null ? t('no monthly report for {count} months', undefined, { count: reportGapMonths }) : '',
    neverReported ? t('no monthly report since joining') : '',
  ].filter(Boolean)

  const trend = useMemo<Highcharts.Options>(() => ({
    chart: { height: 240, spacing: [12, 4, 4, 4] },
    title: { text: undefined },
    legend: { align: 'right', verticalAlign: 'top', itemDistance: 14, symbolRadius: 6 },
    xAxis: { categories: sme.trend.map((point) => point.month), lineWidth: 0, tickLength: 0 },
    yAxis: [
      { title: { text: undefined }, min: 0, gridLineDashStyle: 'Dash', labels: { formatter() { return `R${Math.round(Number(this.value) / 1000)}k` } } },
      { title: { text: undefined }, min: 0, allowDecimals: false, opposite: true, gridLineWidth: 0 },
    ],
    tooltip: { shared: true },
    plotOptions: { areaspline: { lineWidth: 2, marker: { radius: 3 }, fillOpacity: 0.12 }, column: { borderRadius: 3, pointPadding: 0.25 } },
    series: [
      { type: 'column', name: t('Employees'), yAxis: 1, color: 'rgba(22, 163, 74, .45)', data: sme.trend.map((point) => point.employees) },
      { type: 'areaspline', name: t('Revenue'), color: '#6d5dfb', data: sme.trend.map((point) => point.revenue), tooltip: { valuePrefix: 'R ' } },
    ],
  }), [sme.trend, t])

  const support = detail?.support || []
  const shownSupport = allSupport ? support : support.slice(0, SUPPORT_SHOWN)
  const ownership = detail?.ownership
  // Each recorded group's share; 51% or more counts the SME as owned by that group (as the Impact page counts it).
  const shares = ownership?.known
    ? ([
      ['Black', ownership.percents.black, ownership.black],
      ['Black women', ownership.percents.blackWomen, ownership.blackWomen],
      ['Women', ownership.percents.female, ownership.female],
      ['Youth', ownership.percents.youth, ownership.youth],
    ] as Array<[string, number | null, boolean]>).filter(([, percent]) => percent !== null)
    : []

  return (
    <div className="sme-detail">
      <div className="compliance-detail-header">
        <Space size={12} align="center" className="compliance-detail-identity">
          <Avatar className="funder-sme-avatar" src={pictureOf(sme.photoUrl)} size={56}>{initials(sme.name)}</Avatar>
          <div>
            <Typography.Title level={4} style={{ margin: 0 }}>{sme.name}</Typography.Title>
            <Typography.Text type="secondary">{[sme.sector, sme.programName, sme.companyName].filter(Boolean).join(' · ')}</Typography.Text>
          </div>
        </Space>
        <Space size={6} wrap>
          <Tag>{t(sme.stage)}</Tag>
          <Tag color={RISK_COLOR[sme.risk] || 'default'}>{t('{risk} risk', undefined, { risk: t(sme.risk) })}</Tag>
        </Space>
      </div>
      {reasons.length > 0 && <Alert type={sme.risk === 'High' ? 'error' : 'warning'} showIcon className="sme-detail-reasons" message={reasons.join(' · ')} />}

      <div className="sme-detail-figures">
        <div><span>{t('Revenue')}</span><b>{formatCurrencyZAR(sme.metrics.revenue)}</b><small>{revenueChange === null ? t('Needs two reports') : t('{change}% since joining', undefined, { change: `${revenueChange > 0 ? '+' : ''}${revenueChange}` })}</small></div>
        <div><span>{t('Employees')}</span><b>{sme.metrics.employees.toLocaleString()}</b><small>{jobsChange === null ? t('Needs two reports') : t('{change} since joining', undefined, { change: `${jobsChange > 0 ? '+' : ''}${jobsChange}` })}</small></div>
        <div><span>{t('Customers')}</span><b>{sme.metrics.customers ? sme.metrics.customers.toLocaleString() : '—'}</b><small>{t('Latest report')}</small></div>
        <div><span>{t('Support done')}</span><b>{delivery === null ? '—' : `${delivery}%`}</b><small>{sme.execution.required ? t('{completed} of {required} required', undefined, { completed: sme.execution.completed, required: sme.execution.required }) : t('Nothing required yet')}</small></div>
        <div><span>{t('Overdue')}</span><b>{sme.execution.overdue}</b><small>{t('{count} due within 14 days', undefined, { count: sme.execution.upcoming })}</small></div>
        <div><span>{t('Meetings held')}</span><b>{loadingDetail ? '…' : (detail?.meetingsHeld ?? 0)}</b><small>{loadingDetail ? ' ' : t('{hours} hours', undefined, { hours: detail?.meetingHours ?? 0 })}</small></div>
      </div>
      {delivery !== null && <Progress percent={delivery} showInfo={false} strokeColor="#6d5dfb" className="sme-detail-progress" />}

      <div className="sme-detail-section">
        <h4>{t('Revenue and jobs by month')}</h4>
        {sme.trend.some((point) => point.revenue > 0 || point.employees > 0) ? <ThemedHighcharts options={trend} /> : <Typography.Text type="secondary">{t('No monthly reports yet.')}</Typography.Text>}
      </div>

      <div className="sme-detail-section">
        <h4>{t('Support plan')}{support.length > 0 && <span className="sme-detail-count">{support.length}</span>}</h4>
        {loadingDetail ? <Skeleton active paragraph={{ rows: 3 }} title={false} /> : support.length ? (
          <>
            <ul className="sme-detail-support">
              {shownSupport.map((item) => (
                <li key={item.id}>
                  <div>
                    <b>{item.title}</b>
                    <small>{[item.area ? t(item.area) : '', item.state === 'done' && item.completed
                      ? t('Done {date}', undefined, { date: item.completed.format('D MMM YYYY') })
                      : item.due ? t('Due {date}', undefined, { date: item.due.format('D MMM YYYY') }) : ''].filter(Boolean).join(' · ')}</small>
                  </div>
                  <Tag color={SUPPORT_TAG[item.state].color}>{t(SUPPORT_TAG[item.state].label)}</Tag>
                </li>
              ))}
            </ul>
            {support.length > SUPPORT_SHOWN && (
              <Button type="link" size="small" className="sme-detail-more" onClick={() => setAllSupport((value) => !value)}>
                {allSupport ? t('Show fewer') : t('Show all {count}', undefined, { count: support.length })}
              </Button>
            )}
          </>
        ) : <Typography.Text type="secondary">{t('No interventions assigned yet.')}</Typography.Text>}
      </div>

      <div className="sme-detail-section">
        <h4>{t('Meetings')}</h4>
        {loadingDetail ? <Skeleton active paragraph={{ rows: 2 }} title={false} /> : (
          <div className="sme-detail-meetings">
            <div>
              <span>{t('Next meeting')}</span>
              <b>{detail?.nextMeeting?.at ? detail.nextMeeting.at.format('D MMM YYYY, HH:mm') : t('None booked')}</b>
              {detail?.nextMeeting && <small>{detail.nextMeeting.title}</small>}
            </div>
            <div>
              <span>{t('Recently held')}</span>
              {detail?.recentMeetings.length
                ? detail.recentMeetings.map((meeting) => <small key={meeting.id}>{meeting.at ? meeting.at.format('D MMM') : '—'} · {meeting.title}</small>)
                : <b>{t('None yet')}</b>}
            </div>
          </div>
        )}
      </div>

      <div className="sme-detail-section">
        <h4>{t('Profile')}</h4>
        <dl className="sme-detail-profile">
          <dt>{t('Joined')}</dt><dd>{sme.joinedAt ? dayjs(sme.joinedAt).format('D MMM YYYY') : '—'}</dd>
          <dt>{t('Last monthly report')}</dt><dd>{sme.lastReport ? dayjs(sme.lastReport).format('D MMM YYYY') : t('No reports yet')}</dd>
          <dt>{t('Stage')}</dt><dd>{t(sme.stage)}</dd>
          <dt>{t('Province')}</dt><dd>{detail?.province || '—'}</dd>
          <dt>{t('B-BBEE level')}</dt><dd>{detail?.beeLevel || '—'}</dd>
          <dt>{t('Ownership')}</dt>
          <dd>
            {loadingDetail ? '…' : shares.length ? (
              <span className="sme-detail-ownership">
                {shares.map(([group, percent, majority]) => (
                  <Tag key={group} color={majority ? 'purple' : undefined}>{t(group)} {Math.round(percent as number)}%</Tag>
                ))}
              </span>
            ) : t('Not recorded')}
          </dd>
        </dl>
      </div>
    </div>
  )
}
