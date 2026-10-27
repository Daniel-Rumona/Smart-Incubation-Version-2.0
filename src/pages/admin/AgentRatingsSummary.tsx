import { useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Input, Rate, Row, Select, Space, Tag, Typography, type TableProps } from 'antd'
import { DownOutlined, MessageOutlined, RobotOutlined, SearchOutlined, StarFilled, TableOutlined, UpOutlined } from '@ant-design/icons'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useLanguage } from '@/providers/LanguageProvider'
import type { AgentRatingCategory, AgentRatingRecord } from '@/services/agentRatingsService'

const CATEGORIES: AgentRatingCategory[] = ['Intervention agent', 'System agent', 'WhatsApp bot']
/** Agents listed before "Show all", so the card stays a sensible height however many agents there are. */
const TOP_AGENTS = 6
const formatDate = (value?: Date) => (value ? value.toLocaleString() : 'Date unavailable')
const averageOf = (rows: AgentRatingRecord[]) => (rows.length ? rows.reduce((total, row) => total + row.rating, 0) / rows.length : 0)

/** Ratings at a glance: the overall average, how scores spread, and each agent's average. Every rating sits behind a button. */
export const AgentRatingsSummary = ({ ratings, loading }: { ratings: AgentRatingRecord[], loading: boolean }) => {
  const { t } = useLanguage()
  const [allOpen, setAllOpen] = useState(false)
  const [showAllAgents, setShowAllAgents] = useState(false)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<AgentRatingCategory | 'all'>('all')

  const average = averageOf(ratings)
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: ratings.filter((row) => Math.round(row.rating) === stars).length }))
  const maxCount = Math.max(1, ...distribution.map((row) => row.count))
  const byAgent = useMemo(() => {
    const groups = new Map<string, AgentRatingRecord[]>()
    ratings.forEach((row) => groups.set(row.agentId, [...(groups.get(row.agentId) || []), row]))
    return [...groups.values()]
      .map((rows) => ({ agentId: rows[0].agentId, name: rows[0].agentName, category: rows[0].category, average: averageOf(rows), count: rows.length }))
      .sort((left, right) => right.count - left.count || right.average - left.average)
  }, [ratings])

  const rows = useMemo(() => ratings.filter((row) => {
    const needle = search.trim().toLowerCase()
    return (category === 'all' || row.category === category)
      && (!needle || `${row.agentName} ${row.companyCode} ${row.context} ${row.channel}`.toLowerCase().includes(needle))
  }), [category, ratings, search])

  const columns: TableProps<AgentRatingRecord>['columns'] = [
    { title: t('Agent'), dataIndex: 'agentName', render: (value, row) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{row.context || row.agentId}</Typography.Text></Space> },
    { title: t('Type'), dataIndex: 'category', render: (value: AgentRatingCategory) => <span className="admin-role-tag">{t(value)}</span> },
    { title: t('Company'), dataIndex: 'companyCode', render: (value) => value || '—' },
    { title: t('Channel'), dataIndex: 'channel', render: (value) => <Tag>{value}</Tag> },
    { title: t('Rating'), dataIndex: 'rating', render: (value) => <Space><Rate disabled value={value} style={{ fontSize: 13 }} /><Typography.Text>{value}/5</Typography.Text></Space> },
    { title: t('Received'), dataIndex: 'createdAt', render: formatDate },
  ]

  if (!loading && !ratings.length) {
    return <Card className="admin-card" bordered={false}><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No one has rated an agent yet.')} /></Card>
  }

  return (
    <>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={9}>
          <Card className="admin-card agent-ratings-overall" bordered={false} loading={loading}>
            <div className="admin-card-head"><div><h3>{t('Average rating')}</h3><span>{t('{count} ratings from users', undefined, { count: ratings.length })}</span></div></div>
            <div className="agent-ratings-score">
              <strong>{average.toFixed(1)}</strong>
              <div><Rate disabled allowHalf value={Math.round(average * 2) / 2} /><span className="agent-ratings-score-caption">{t('out of 5')}</span></div>
            </div>
            <ul className="agent-ratings-spread">
              {distribution.map((row) => (
                <li key={row.stars}>
                  <span>{row.stars}★</span>
                  <span className="agent-ratings-track"><b style={{ width: `${(row.count / maxCount) * 100}%` }} /></span>
                  <em>{row.count}</em>
                </li>
              ))}
            </ul>
            <Button block shape="round" icon={<TableOutlined />} onClick={() => setAllOpen(true)}>{t('View all ratings')}</Button>
          </Card>
        </Col>
        <Col xs={24} lg={15}>
          <Row gutter={[16, 16]}>
            {CATEGORIES.map((value) => {
              const group = ratings.filter((row) => row.category === value)
              return (
                <Col key={value} xs={24} sm={8}>
                  <Card className="admin-card agent-ratings-category" bordered={false} loading={loading}>
                    <span className="admin-kpi-icon">{value === 'WhatsApp bot' ? <MessageOutlined /> : <RobotOutlined />}</span>
                    <span className="agent-ratings-category-name">{t(value)}</span>
                    <strong>{group.length ? averageOf(group).toFixed(1) : '—'}</strong>
                    <small>{t('{count} ratings', undefined, { count: group.length })}</small>
                  </Card>
                </Col>
              )
            })}
            <Col span={24}>
              <Card className="admin-card" bordered={false} loading={loading}>
                <div className="admin-card-head"><div><h3>{t('By agent')}</h3><span>{t('Average rating per agent, most rated first')}</span></div></div>
                <ul className="agent-ratings-agents">
                  {(showAllAgents ? byAgent : byAgent.slice(0, TOP_AGENTS)).map((row) => (
                    <li key={row.agentId}>
                      <div className="agent-ratings-agent-name">
                        <strong>{row.name}</strong>
                        <span>{t(row.category)} · {t('{count} ratings', undefined, { count: row.count })}</span>
                      </div>
                      <span className="agent-ratings-track" aria-hidden="true"><b style={{ width: `${(row.average / 5) * 100}%` }} /></span>
                      <span className="agent-ratings-agent-score" aria-label={t('{rating} out of 5', undefined, { rating: row.average.toFixed(1) })}><StarFilled /> {row.average.toFixed(1)}</span>
                    </li>
                  ))}
                </ul>
                {byAgent.length > TOP_AGENTS && (
                  <Button type="link" className="agent-ratings-more" icon={showAllAgents ? <UpOutlined /> : <DownOutlined />} onClick={() => setShowAllAgents((current) => !current)}>
                    {showAllAgents ? t('Show fewer') : t('Show all {count} agents', undefined, { count: byAgent.length })}
                  </Button>
                )}
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>

      <ResponsiveModal open={allOpen} onClose={() => setAllOpen(false)} title={t('All ratings')} width={1040} centered>
        <Space wrap className="agent-ratings-filters">
          <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search agent, company or context')} allowClear />
          <Select value={category} onChange={setCategory} style={{ minWidth: 180 }} options={[{ value: 'all', label: t('All agent types') }, ...CATEGORIES.map((value) => ({ value, label: t(value) }))]} />
        </Space>
        <ResponsiveDataView
          rowKey="id"
          rows={rows}
          columns={columns}
          emptyText={t('No agent ratings match these filters.')}
          renderCard={(row) => <Space direction="vertical"><Typography.Text strong>{row.agentName}</Typography.Text><Space><span className="admin-role-tag">{t(row.category)}</span><Rate disabled value={row.rating} style={{ fontSize: 13 }} /></Space><Typography.Text type="secondary">{row.companyCode || t('No company')} · {formatDate(row.createdAt)}</Typography.Text></Space>}
        />
      </ResponsiveModal>
    </>
  )
}

export default AgentRatingsSummary
