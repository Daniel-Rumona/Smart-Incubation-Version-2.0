import { Button, Card, Col, Progress, Row, Segmented, Space, Table, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, CheckCircleOutlined, EnvironmentOutlined, RiseOutlined } from '@ant-design/icons'
import type Highcharts from 'highcharts'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { CHART_COLORS } from '@/config/chartPalette'
import { useLanguage, tr } from '@/providers/LanguageProvider'

const { Paragraph, Text, Title } = Typography
type Pillar = 'overall' | 'environmental' | 'social' | 'governance'
type SmeScore = { key: string, name: string, programme: string, location: string, e: number, s: number, g: number, actions: number, evidence: number }

const smeScores: SmeScore[] = [
    { key: 'green-basket', name: 'Green Basket Foods', programme: 'Growth Accelerator', location: 'Harare', e: 86, s: 84, g: 76, actions: 8, evidence: 91 },
    { key: 'mbare-crafts', name: 'Mbare Craft Works', programme: 'Market Access', location: 'Harare', e: 68, s: 79, g: 66, actions: 6, evidence: 72 },
    { key: 'matobo-logistics', name: 'Matobo Logistics', programme: 'Productivity Plus', location: 'Bulawayo', e: 74, s: 63, g: 81, actions: 7, evidence: 78 },
    { key: 'savanna-textiles', name: 'Savanna Textiles', programme: 'Growth Accelerator', location: 'Mutare', e: 79, s: 71, g: 69, actions: 5, evidence: 64 },
    { key: 'sunrise-health', name: 'Sunrise Health Supplies', programme: 'Market Access', location: 'Gweru', e: 62, s: 76, g: 73, actions: 4, evidence: 59 },
]

const overall = (row: SmeScore) => Math.round(row.e * .3 + row.s * .4 + row.g * .3)
const scoreColor = (score: number) => score >= 80 ? CHART_COLORS.success : score >= 70 ? CHART_COLORS.primary : CHART_COLORS.amber

export default function ProjectAdminEsgPerformancePage() {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const [pillar, setPillar] = useState<Pillar>('overall')
    const [selectedKey, setSelectedKey] = useState(smeScores[0].key)
    const selected = smeScores.find((row) => row.key === selectedKey) || smeScores[0]
    const ranking = useMemo(() => [...smeScores].sort((left, right) => overall(right) - overall(left)), [])
    const chart: Highcharts.Options = {
        chart: { type: 'bar', height: 340 }, title: { text: undefined }, xAxis: { categories: ranking.map((row) => row.name) }, yAxis: { min: 0, max: 100, title: { text: tr('Score') } }, legend: { enabled: false }, plotOptions: { series: { dataLabels: { enabled: true, format: '{point.y}' } } },
        series: [{ type: 'bar', name: pillar === 'overall' ? 'Overall ESG' : pillarLabel(pillar), color: scoreColor(pillarScore(ranking[0], pillar)), data: ranking.map((row) => ({ y: pillarScore(row, pillar), color: scoreColor(pillarScore(row, pillar)) })) }],
    }

    return <DashboardPage>
        <DashboardHeader title={t('Individual ESG performance')} subtitle={tr('See how each SME contributes to programme ESG outcomes and how the score is calculated.')} actions={<Space><Tag color="blue">{t('Portfolio view')}</Tag><Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/projectadmin/esg')}>{t('Back to ESG')}</Button></Space>} />
        <Card className="dashboard-section-card" style={{ marginBottom: 16 }}>
            <Segmented block value={pillar} onChange={(value) => setPillar(value as Pillar)} options={[{ label: t('Overall ESG'), value: 'overall' }, { label: t('Environmental'), value: 'environmental' }, { label: t('Social'), value: 'social' }, { label: t('Governance'), value: 'governance' }]} />
        </Card>
        <Row gutter={[16, 16]}>
            <Col xs={24} lg={14}><Card className="dashboard-section-card" title={t('SME contribution ranking')}><ThemedHighcharts options={chart} /></Card></Col>
            <Col xs={24} lg={10}><Card className="dashboard-section-card" title={t('How the score is calculated')}><Space direction="vertical" size={12}><Text>{t('Each SME score combines verified actions and evidence:')}</Text><ScoreWeight label={t('Environmental')} weight="30%" color={CHART_COLORS.success} /><ScoreWeight label={t('Social')} weight="40%" color={CHART_COLORS.primary} /><ScoreWeight label={t('Governance')} weight="30%" color={CHART_COLORS.violet} /><Paragraph type="secondary" style={{ marginBottom: 0 }}>{t('Evidence coverage affects confidence in the score. Completed interventions, uploaded proof, beneficiary outcomes, and governance checks contribute to each pillar.')}</Paragraph></Space></Card></Col>
        </Row>
        <Card className="dashboard-section-card" title={t('SME contribution details')} style={{ marginTop: 16 }}>
            <Table rowKey="key" dataSource={ranking} pagination={false} onRow={(record) => ({ onClick: () => setSelectedKey(record.key), style: { cursor: 'pointer' } })} columns={[{ title: t('SME'), render: (_: unknown, row: SmeScore) => <Space direction="vertical" size={0}><Text strong>{row.name}</Text><Text type="secondary">{row.programme}</Text></Space> }, { title: t('Location'), render: (_: unknown, row: SmeScore) => <Space><EnvironmentOutlined />{row.location}</Space> }, { title: t('ESG score'), render: (_: unknown, row: SmeScore) => <Tag color={scoreColor(overall(row))}>{overall(row)}/100</Tag> }, { title: 'E', dataIndex: 'e' }, { title: 'S', dataIndex: 's' }, { title: 'G', dataIndex: 'g' }, { title: t('Actions'), dataIndex: 'actions' }, { title: t('Evidence'), render: (_: unknown, row: SmeScore) => `${row.evidence}%` }]} />
        </Card>
        <Card className="dashboard-section-card" title={`Selected SME · ${selected.name}`} style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]} align="middle"><Col xs={24} md={8}><Progress type="circle" percent={overall(selected)} strokeColor={scoreColor(overall(selected))} /></Col><Col xs={24} md={16}><Space direction="vertical" size={10}><Title level={4} style={{ margin: 0 }}>{selected.name}</Title><Text type="secondary">{selected.programme} · {selected.location}</Text><Space wrap><Tag icon={<CheckCircleOutlined />} color="green">{selected.actions} {t('actions completed')}</Tag><Tag icon={<RiseOutlined />} color="blue">{selected.evidence}{t('% evidence coverage')}</Tag></Space><Text>{t('Contribution:')} {selected.s} {t('social,')} {selected.e} {t('environmental, and')} {selected.g} {t('governance points, weighted to an overall ESG score of')} {overall(selected)}.</Text></Space></Col></Row>
        </Card>
    </DashboardPage>
}

function pillarLabel(pillar: Pillar) { return pillar === 'environmental' ? 'Environmental' : pillar === 'social' ? 'Social' : 'Governance' }
function pillarScore(row: SmeScore, pillar: Pillar) { return pillar === 'overall' ? overall(row) : pillar === 'environmental' ? row.e : pillar === 'social' ? row.s : row.g }
function ScoreWeight({ label, weight, color }: { label: string, weight: string, color: string }) { return <Space style={{ width: '100%', justifyContent: 'space-between' }}><Space><span style={{ width: 10, height: 10, borderRadius: '50%', background: color }} /><Text>{label}</Text></Space><Text strong>{weight}</Text></Space> }
