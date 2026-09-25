import { App, Col, Input, Rate, Row, Select, Space, Tag, Typography, type TableProps } from 'antd'
import { MessageOutlined, RobotOutlined, SearchOutlined, StarOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listAgentRatings, type AgentRatingCategory, type AgentRatingRecord } from '@/services/agentRatingsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'

const formatDate = (value?: Date) => value ? value.toLocaleString() : 'Date unavailable'

const AgentRatingsPage = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [ratings, setRatings] = useState<AgentRatingRecord[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')
    const [category, setCategory] = useState<AgentRatingCategory | 'all'>('all')

    useEffect(() => {
        if (!user) return
        let active = true
        void listAgentRatings(user).then(rows => { if (active) setRatings(rows) }).catch(() => {
            if (active) message.error(t('Agent ratings could not be loaded.'))
        }).finally(() => { if (active) setLoading(false) })
        return () => { active = false }
    }, [message, user, t])

    const rows = useMemo(() => ratings.filter(row => {
        const matchesCategory = category === 'all' || row.category === category
        const needle = search.trim().toLowerCase()
        return matchesCategory && (!needle || `${row.agentName} ${row.companyCode} ${row.context} ${row.channel}`.toLowerCase().includes(needle))
    }), [category, ratings, search])
    const average = ratings.length ? ratings.reduce((total, row) => total + row.rating, 0) / ratings.length : 0
    const categoryCount = (value: AgentRatingCategory) => ratings.filter(row => row.category === value).length

    useRegisterAgentPageContext({
        pageKey: 'admin-agent-ratings', pageName: 'Agent ratings',
        purpose: 'Review feedback for intervention agents, system assistants, and the WhatsApp bot.',
        currentFilters: { search, category }, metrics: { ratings: ratings.length, average },
    })

    const columns: TableProps<AgentRatingRecord>['columns'] = [
        { title: t('Agent'), dataIndex: 'agentName', render: (value, row) => <Space direction="vertical" size={0}><Typography.Text strong>{value}</Typography.Text><Typography.Text type="secondary">{row.context || row.agentId}</Typography.Text></Space> },
        { title: t('Type'), dataIndex: 'category', render: (value: AgentRatingCategory) => <Tag color={value === 'WhatsApp bot' ? 'green' : value === 'Intervention agent' ? 'purple' : 'blue'}>{value}</Tag> },
        { title: t('Company'), dataIndex: 'companyCode', render: value => value || '—' },
        { title: t('Channel'), dataIndex: 'channel', render: value => <Tag>{value}</Tag> },
        { title: t('Rating'), dataIndex: 'rating', render: value => <Space><Rate disabled value={value} style={{ fontSize: 14 }} /><Typography.Text>{value}/5</Typography.Text></Space> },
        { title: t('Received'), dataIndex: 'createdAt', render: formatDate },
    ]

    return <DashboardPage>
        <Row gutter={[14, 14]} className="dashboard-metrics-row">
            <Col xs={12} lg={6}><DashboardMetricCard icon={<StarOutlined />} label={t('Average rating')} value={average ? average.toFixed(1) : '—'} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<RobotOutlined />} label={t('Intervention agent')} value={categoryCount('Intervention agent')} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<RobotOutlined />} label={t('System agent')} value={categoryCount('System agent')} /></Col>
            <Col xs={12} lg={6}><DashboardMetricCard icon={<MessageOutlined />} label={t('WhatsApp bot')} value={categoryCount('WhatsApp bot')} /></Col>
        </Row>
        <FilterBar title={t('Feedback records')} primary={<Space wrap><Input prefix={<SearchOutlined />} value={search} onChange={event => setSearch(event.target.value)} placeholder={t('Search agent, company or context')} allowClear /><Select value={category} onChange={setCategory} options={[{ value: 'all', label: t('All agent types') }, ...(['Intervention agent', 'System agent', 'WhatsApp bot'] as AgentRatingCategory[]).map(value => ({ value, label: value }))]} /></Space>} />
        <ResponsiveDataView rowKey="id" rows={rows} columns={columns} loading={loading} emptyText={t('No agent ratings match these filters.')} renderCard={row => <Space direction="vertical"><Typography.Text strong>{row.agentName}</Typography.Text><Space><Tag>{row.category}</Tag><Rate disabled value={row.rating} style={{ fontSize: 13 }} /></Space><Typography.Text type="secondary">{row.companyCode || t('No company')} · {formatDate(row.createdAt)}</Typography.Text></Space>} />
    </DashboardPage>
}

export default AgentRatingsPage
