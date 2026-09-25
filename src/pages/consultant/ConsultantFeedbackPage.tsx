import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Empty,
    Input,
    List,
    Progress,
    Rate,
    Row,
    Segmented,
    Select,
    Space,
    Tag,
    Typography,
} from 'antd'
import {
    BulbOutlined,
    DownloadOutlined,
    ExclamationCircleOutlined,
    MessageOutlined,
    RobotOutlined,
    SearchOutlined,
    StarOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useAssignedInterventions } from '@/contexts/AssignedInterventionsContext'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import { assignmentParticipant, assignmentTitle, downloadCsv, getFeedback } from './ConsultantWorkspaceUtils'
import '@/styles/consultant.css'

const { RangePicker } = DatePicker
const { Text, Paragraph, Title } = Typography

type FeedbackSort = 'newest' | 'oldest' | 'highest' | 'lowest'
type AiFeedbackView = 'sentiment' | 'recommendations'
type SentimentLabel = 'Positive' | 'Neutral' | 'Needs attention'

type FeedbackItem = {
    id: string
    participant: string
    title: string
    rating?: number | null
    comments?: string
    createdAt?: Date | null
}

type SentimentResult = {
    label: SentimentLabel
    score: number
    tone: string
    confidence: number
    keySignals: string[]
}

type RadarDimension = 'Communication' | 'Practicality' | 'Relevance' | 'Follow-through' | 'Confidence'

const radarDimensions: RadarDimension[] = ['Communication', 'Practicality', 'Relevance', 'Follow-through', 'Confidence']

const clean = (value: unknown) => String(value ?? '').trim().toLowerCase()

const sentimentColor = (label: SentimentLabel) => {
    if (label === 'Positive') return 'green'
    if (label === 'Needs attention') return 'red'
    return 'gold'
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

const countMatches = (text: string, words: string[]) => words.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0)

const analyseSentiment = (item: FeedbackItem): SentimentResult => {
    const text = clean(item.comments)
    const rating = item.rating ?? 3
    const positiveHits = countMatches(text, [
        'excellent',
        'strong',
        'helpful',
        'practical',
        'clear',
        'relevant',
        'easy',
        'specific',
        'useful',
        'understood',
    ])
    const concernHits = countMatches(text, [
        'but',
        'still need',
        'not clear',
        'fast',
        'more guidance',
        'follow-up',
        'another practical',
        'need help',
        'need more',
    ])

    const score = clamp(Math.round((rating / 5) * 70 + positiveHits * 7 - concernHits * 6), 5, 100)
    const label: SentimentLabel = score >= 72 ? 'Positive' : score >= 48 ? 'Neutral' : 'Needs attention'

    const keySignals = [
        positiveHits > 1 ? 'Strong positive language' : '',
        rating >= 4 ? 'High rating' : '',
        concernHits > 0 ? 'Follow-up need detected' : '',
        rating <= 2 ? 'Low satisfaction risk' : '',
    ].filter(Boolean)

    return {
        label,
        score,
        tone: label === 'Positive' ? 'Satisfied and confident' : label === 'Neutral' ? 'Generally satisfied with improvement areas' : 'Requires follow-up',
        confidence: clamp(60 + Math.abs(score - 50), 65, 94),
        keySignals: keySignals.length ? keySignals : ['Limited signal available'],
    }
}

const dimensionScoresForItem = (item: FeedbackItem): Record<RadarDimension, number> => {
    const text = clean(item.comments)
    const rating = item.rating ?? 3
    const base = rating

    return {
        Communication: clamp(base + countMatches(text, ['clear', 'explanation', 'understood', 'specific']) * 0.25 - countMatches(text, ['not clear', 'fast']) * 0.7, 1, 5),
        Practicality: clamp(base + countMatches(text, ['practical', 'easy', 'template', 'checklist', 'apply']) * 0.25, 1, 5),
        Relevance: clamp(base + countMatches(text, ['relevant', 'specific', 'our business', 'our stage', 'our model']) * 0.25, 1, 5),
        'Follow-through': clamp(base - countMatches(text, ['follow-up', 'still need', 'need help', 'need more', 'another practical']) * 0.35, 1, 5),
        Confidence: clamp(base + countMatches(text, ['now understand', 'can now', 'clear next steps', 'helped us']) * 0.25, 1, 5),
    }
}

const averageDimensionScores = (items: FeedbackItem[]) => {
    if (!items.length) return radarDimensions.map(() => 0)

    const totals = radarDimensions.reduce<Record<RadarDimension, number>>((acc, dimension) => {
        acc[dimension] = 0
        return acc
    }, {} as Record<RadarDimension, number>)

    items.forEach((item) => {
        const scores = dimensionScoresForItem(item)
        radarDimensions.forEach((dimension) => {
            totals[dimension] += scores[dimension]
        })
    })

    return radarDimensions.map((dimension) => Number((totals[dimension] / items.length).toFixed(2)))
}

const buildRecommendations = (items: FeedbackItem[]) => {
    const analysed = items.map((item) => ({ item, sentiment: analyseSentiment(item) }))
    const needsAttention = analysed.filter(({ sentiment }) => sentiment.label === 'Needs attention')
    const neutral = analysed.filter(({ sentiment }) => sentiment.label === 'Neutral')
    const followUps = analysed.filter(({ item }) => clean(item.comments).includes('follow-up') || clean(item.comments).includes('need'))
    const lowRatings = analysed.filter(({ item }) => (item.rating ?? 0) <= 2)

    const recommendations = [
        followUps.length
            ? `Schedule focused follow-up sessions for ${Array.from(new Set(followUps.map(({ item }) => item.participant))).slice(0, 3).join(', ')} to close the support gaps mentioned in feedback.`
            : 'Maintain the current support cadence and continue capturing feedback after every intervention.',
        lowRatings.length
            ? 'Prioritise low-rated feedback within 48 hours and document the corrective action against the intervention record.'
            : 'Use the strongest feedback examples as evidence of intervention impact in programme reporting.',
        neutral.length || needsAttention.length
            ? 'Convert common concerns into facilitator coaching notes, especially around clarity, pacing and practical walkthroughs.'
            : 'Package the highest-rated sessions into repeatable templates for other SMEs.',
    ]

    return recommendations
}

export const ConsultantFeedbackPage = () => {
    const { t } = useLanguage()
    const { assignments, loading, isMine } = useAssignedInterventions()
    const [search, setSearch] = useState('')
    const [sort, setSort] = useState<FeedbackSort>('newest')
    const [range, setRange] = useState<[Dayjs | null, Dayjs | null]>([null, null])
    const [aiView, setAiView] = useState<AiFeedbackView>('sentiment')

    const feedback = useMemo<FeedbackItem[]>(() => {
        return assignments
            .filter(isMine)
            .map((assignment) => ({
                id: assignment.id,
                participant: assignmentParticipant(assignment),
                title: assignmentTitle(assignment),
                ...getFeedback(assignment),
            }))
            .filter((item) => item.comments || item.rating != null)
    }, [assignments, isMine])

    const filtered = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return feedback
            .filter((item) => !needle || `${item.participant} ${item.title} ${item.comments}`.toLowerCase().includes(needle))
            .filter((item) => {
                if (!range[0] || !range[1]) return true
                if (!item.createdAt) return false
                const createdAt = dayjs(item.createdAt)
                return createdAt.isAfter(range[0].startOf('day')) && createdAt.isBefore(range[1].endOf('day'))
            })
            .sort((a, b) => {
                if (sort === 'highest') return (b.rating ?? -1) - (a.rating ?? -1)
                if (sort === 'lowest') return (a.rating ?? 99) - (b.rating ?? 99)
                const aTime = a.createdAt?.getTime() || 0
                const bTime = b.createdAt?.getTime() || 0
                return sort === 'oldest' ? aTime - bTime : bTime - aTime
            })
    }, [feedback, range, search, sort])

    const rated = filtered.filter((item) => item.rating != null)
    const average = rated.length ? rated.reduce((sum, item) => sum + (item.rating || 0), 0) / rated.length : 0
    const lowRatings = rated.filter((item) => (item.rating || 0) <= 2).length

    const sentimentRows = useMemo(() => filtered.map((item) => ({ ...item, sentiment: analyseSentiment(item) })), [filtered])
    const sentimentCounts = useMemo(() => ({
        positive: sentimentRows.filter((item) => item.sentiment.label === 'Positive').length,
        neutral: sentimentRows.filter((item) => item.sentiment.label === 'Neutral').length,
        attention: sentimentRows.filter((item) => item.sentiment.label === 'Needs attention').length,
    }), [sentimentRows])

    const positiveRate = sentimentRows.length ? Math.round((sentimentCounts.positive / sentimentRows.length) * 100) : 0
    const recommendations = useMemo(() => buildRecommendations(filtered), [filtered])

    const chartOptions: Highcharts.Options = {
        chart: { polar: true, type: 'line', height: 320 },
        title: { text: undefined },
        pane: { size: '82%' },
        xAxis: {
            categories: radarDimensions,
            tickmarkPlacement: 'on',
            lineWidth: 0,
        },
        yAxis: {
            gridLineInterpolation: 'polygon',
            min: 0,
            max: 5,
            tickInterval: 1,
            title: { text: undefined },
        },
        tooltip: {
            shared: true,
            pointFormat: '<span>{series.name}: <b>{point.y:.1f}/5</b><br/>',
        },
        legend: { align: 'center', verticalAlign: 'bottom' },
        series: [
            {
                type: 'line',
                name: tr('Feedback quality profile'),
                data: averageDimensionScores(rated),
                pointPlacement: 'on',
            },
        ],
        credits: { enabled: false },
    }

    const exportFeedback = () => {
        downloadCsv(`consultant-feedback-${dayjs().format('YYYYMMDD-HHmm')}.csv`, filtered.map((item) => {
            const sentiment = analyseSentiment(item)
            return {
                [t('consultant.common.sme')]: item.participant,
                [t('consultant.common.intervention')]: item.title,
                [t('consultant.feedback.rating')]: item.rating ?? '',
                [t('consultant.feedback.comment')]: item.comments,
                Sentiment: sentiment.label,
                SentimentScore: sentiment.score,
                CreatedAt: item.createdAt ? dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') : '',
            }
        }))
    }

    return (
        <DashboardPage className="consultant-page">
            <Row gutter={[16, 16]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<MessageOutlined />} label={t('consultant.feedback.title')} value={filtered.length} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<StarOutlined />} label={t('consultant.feedback.average')} value={average ? average.toFixed(2) : '-'} hint="/5" />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard loading={loading} icon={<RobotOutlined />} label={t('Positive sentiment')} value={`${positiveRate}%`} hint={`${sentimentCounts.positive} positive`} />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={loading}
                        icon={<ExclamationCircleOutlined />}
                        iconClassName="is-risk"
                        label={t('consultant.feedback.lowRatings')}
                        value={lowRatings}
                        hint={t('consultant.feedback.lowRatingsHint')}
                    />
                </Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <Input
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('consultant.feedback.search')}
                            allowClear
                        />
                        <Select
                            value={sort}
                            onChange={setSort}
                            options={[
                                { value: 'newest', label: t('consultant.feedback.newest') },
                                { value: 'oldest', label: t('consultant.feedback.oldest') },
                                { value: 'highest', label: t('consultant.feedback.highest') },
                                { value: 'lowest', label: t('consultant.feedback.lowest') },
                            ]}
                        />
                        <RangePicker value={range} onChange={(value) => setRange(value as [Dayjs | null, Dayjs | null])} />
                    </>
                }
                actions={
                    <Button icon={<DownloadOutlined />} disabled={!filtered.length} onClick={exportFeedback}>
                        {t('consultant.feedback.exportCsv')}
                    </Button>
                }
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={10}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('Feedback quality radar')}>
                        {rated.length ? <ThemedHighcharts options={chartOptions} /> : <Empty description={t('consultant.feedback.noRated')} />}
                    </Card>
                </Col>

                <Col xs={24} xl={14}>
                    <Card
                        className="dashboard-section-card motion-card"
                        title={<Space><RobotOutlined /> {t('AI feedback intelligence')}</Space>}
                        extra={
                            <Segmented
                                value={aiView}
                                onChange={(value) => setAiView(value as AiFeedbackView)}
                                options={[
                                    { value: 'sentiment', label: t('Sentiment') },
                                    { value: 'recommendations', label: t('Recommendations') },
                                ]}
                            />
                        }
                    >
                        {!filtered.length ? (
                            <Empty description={t('consultant.feedback.empty')} />
                        ) : aiView === 'sentiment' ? (
                            <Space direction="vertical" size={14} style={{ width: '100%' }}>
                                <Row gutter={[12, 12]}>
                                    <Col xs={24} md={8}>
                                        <Card size="small">
                                            <Text type="secondary">{t('Positive')}</Text>
                                            <Title level={4} style={{ margin: '4px 0 0' }}>{sentimentCounts.positive}</Title>
                                        </Card>
                                    </Col>
                                    <Col xs={24} md={8}>
                                        <Card size="small">
                                            <Text type="secondary">{t('Neutral')}</Text>
                                            <Title level={4} style={{ margin: '4px 0 0' }}>{sentimentCounts.neutral}</Title>
                                        </Card>
                                    </Col>
                                    <Col xs={24} md={8}>
                                        <Card size="small">
                                            <Text type="secondary">{t('Needs attention')}</Text>
                                            <Title level={4} style={{ margin: '4px 0 0' }}>{sentimentCounts.attention}</Title>
                                        </Card>
                                    </Col>
                                </Row>

                                <List
                                    dataSource={sentimentRows.slice(0, 5)}
                                    renderItem={(item) => (
                                        <List.Item className="consultant-feedback-item">
                                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                                <Space wrap>
                                                    <Text strong>{item.participant}</Text>
                                                    <Tag>{item.title}</Tag>
                                                    <Tag color={sentimentColor(item.sentiment.label)}>{item.sentiment.label}</Tag>
                                                    <Text type="secondary">{t('Confidence')} {item.sentiment.confidence}%</Text>
                                                </Space>
                                                <Progress percent={item.sentiment.score} showInfo size="small" />
                                                <Text type="secondary">{item.sentiment.tone}</Text>
                                                <Space wrap>
                                                    {item.sentiment.keySignals.map((signal) => <Tag key={`${item.id}-${signal}`}>{signal}</Tag>)}
                                                </Space>
                                            </Space>
                                        </List.Item>
                                    )}
                                />
                            </Space>
                        ) : (
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                <Alert
                                    type={sentimentCounts.attention || lowRatings ? 'warning' : 'success'}
                                    showIcon
                                    message={sentimentCounts.attention || lowRatings ? t('AI detected follow-up opportunities') : t('Feedback trend is healthy')}
                                    description={t('Recommendations are generated from rating patterns, sentiment cues, repeated concerns and SME comments in the current filtered view.')}
                                />
                                <List
                                    dataSource={recommendations}
                                    renderItem={(recommendation, index) => (
                                        <List.Item>
                                            <Space align="start">
                                                <BulbOutlined style={{ marginTop: 4 }} />
                                                <Space direction="vertical" size={2}>
                                                    <Text strong>{t('Recommendation')} {index + 1}</Text>
                                                    <Text>{recommendation}</Text>
                                                </Space>
                                            </Space>
                                        </List.Item>
                                    )}
                                />
                            </Space>
                        )}
                    </Card>
                </Col>

                <Col span={24}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('consultant.feedback.comments')}>
                        <List
                            className="consultant-centered-pagination"
                            dataSource={filtered}
                            pagination={{ pageSize: 6, showSizeChanger: false, align: 'center' }}
                            locale={{ emptyText: t('consultant.feedback.empty') }}
                            renderItem={(item) => {
                                const sentiment = analyseSentiment(item)
                                return (
                                    <List.Item className="consultant-feedback-item">
                                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                                            <Space wrap>
                                                <Text strong>{item.participant}</Text>
                                                <Tag>{item.title}</Tag>
                                                <Rate disabled value={item.rating || 0} />
                                                <Tag color={sentimentColor(sentiment.label)}>{sentiment.label}</Tag>
                                            </Space>
                                            <Paragraph style={{ margin: 0 }}>{item.comments || t('consultant.feedback.noComment')}</Paragraph>
                                            <Text type="secondary">
                                                {item.createdAt ? dayjs(item.createdAt).format('DD MMM YYYY, HH:mm') : t('consultant.feedback.noDate')}
                                            </Text>
                                        </Space>
                                    </List.Item>
                                )
                            }}
                        />
                    </Card>
                </Col>
            </Row>
        </DashboardPage>
    )
}

export default ConsultantFeedbackPage
