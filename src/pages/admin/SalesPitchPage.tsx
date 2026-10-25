import { useState } from 'react'
import { Button, Card, Col, Row, Space, Typography } from 'antd'
import {
  AimOutlined,
  AuditOutlined,
  ExperimentOutlined,
  FallOutlined,
  FileProtectOutlined,
  FlagOutlined,
  FundOutlined,
  PlayCircleFilled,
  QuestionCircleOutlined,
  RiseOutlined,
  SafetyCertificateOutlined,
  SyncOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { ReportPlayer, type PlayerSlide } from '@/components/reports/ReportPlayer'
import { useLanguage } from '@/providers/LanguageProvider'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'

// The evidence-based sales pitch, told as slides. The copy is a sales document that quotes its sources,
// so it stays in English; only the page around it is translated.
const SOURCES = [
  { label: 'Ngcobo (2024), small business sustainability in eThekwini, UKZN', url: 'https://researchspace.ukzn.ac.za/items/b09188b4-2c4b-451d-a832-0e0b049a9458/full' },
  { label: 'McKenzie & Woodruff (2012), business training evaluations, IZA DP 6895', url: 'https://www.iza.org/publications/dp/6895' },
  { label: 'Bruhn, Karlan & Schoar, consulting for SMEs in Mexico, IPA', url: 'https://poverty-action.org/study/boosting-firms-productivity-mexico-with-consulting-services' },
  { label: 'Bloom et al., Does Management Matter? Evidence from India, LSE CEP', url: 'https://cep.lse.ac.uk/_NEW/PUBLICATIONS/abstract.asp?index=3751' },
  { label: 'Global Accelerator Learning Initiative, GALI insights', url: 'https://www.galidata.org/insights' },
]

const SLIDES: PlayerSlide[] = [
  {
    kind: 'title',
    eyebrow: 'Sales pitch',
    title: 'Smart Incubation: the evidence-based case',
    subtitle: 'Software for the support model that randomised trials show works: diagnose, tailor, follow through, measure.',
    icon: <ExperimentOutlined />,
    accent: '#8b5cf6',
  },
  {
    kind: 'focus',
    title: 'The problem',
    lead: 'About half of South African small businesses close within 24 months, and most support programmes cannot prove they changed that.',
    icon: <FallOutlined />,
    accent: '#f0808a',
    figure: { value: '70–80%', label: 'of survivors fail within five years (widely quoted, weakly sourced)' },
  },
  {
    kind: 'narrative',
    title: 'Why the evidence is mixed',
    lead: 'Generic support often shows little effect, and weak measurement hides the effects that are there.',
    icon: <QuestionCircleOutlined />,
    accent: '#f59e0b',
    points: [
      { icon: <WarningOutlined />, text: 'Few business-training trials find significant gains in profits or sales.', meta: 'McKenzie & Woodruff, 2012', tone: 'warn' },
      { icon: <AuditOutlined />, text: 'Studies are underpowered, stop within a year and lose firms to drop-out.', meta: 'Same review', tone: 'warn' },
      { icon: <FundOutlined />, text: 'Funders pay for support they cannot verify.', tone: 'risk' },
    ],
  },
  {
    kind: 'focus',
    title: 'Tailored support works',
    lead: 'In a randomised trial of 432 Mexican SMEs, firms offered a year of personalised consulting grew far more than the control group over five years.',
    icon: <RiseOutlined />,
    accent: '#34d399',
    barsTitle: 'Five-year gain against the control group',
    bars: [
      { label: 'Employees', value: 57, total: 100, color: '#34d399', note: '+57%' },
      { label: 'Total wage bill', value: 72, total: 100, color: '#22d3ee', note: '+72%' },
    ],
  },
  {
    kind: 'focus',
    title: 'Structure beats going it alone',
    lead: 'Across GALI programmes, accelerated ventures outgrew the applicants they turned away within a year. Indian plants given management consulting raised productivity by 11%.',
    icon: <TeamOutlined />,
    accent: '#38bdf8',
    barsTitle: 'One-year growth, accelerated vs rejected',
    bars: [
      { label: 'Revenue, accelerated', value: 50, total: 60, color: '#38bdf8', note: '50%' },
      { label: 'Revenue, rejected', value: 30, total: 60, color: '#64748b', note: '30%' },
      { label: 'Jobs, accelerated', value: 47, total: 60, color: '#38bdf8', note: '47%' },
      { label: 'Jobs, rejected', value: 30, total: 60, color: '#64748b', note: '30%' },
    ],
  },
  {
    kind: 'narrative',
    title: 'The method',
    lead: 'Every SME runs the same loop: select, diagnose, prescribe, deliver, verify.',
    icon: <SyncOutlined />,
    accent: '#8b5cf6',
    points: [
      { icon: <AimOutlined />, text: 'A diagnostic and SWOT become a support plan both sides sign.', meta: 'Closes the information gap behind poor practice', tone: 'info' },
      { icon: <TeamOutlined />, text: 'Verified facilitators deliver interventions matched to the plan’s gaps.', meta: 'The tailoring that worked in Mexico', tone: 'info' },
      { icon: <WarningOutlined />, text: 'Every stall names who it is waiting on; a daily digest flags overdue work.', meta: 'In the app, by email and on WhatsApp', tone: 'good' },
    ],
  },
  {
    kind: 'narrative',
    title: 'Outcomes are verified, not claimed',
    lead: 'A completed intervention needs evidence, and its outcome is checked from two sides.',
    icon: <SafetyCertificateOutlined />,
    accent: '#22d3ee',
    points: [
      { icon: <FileProtectOutlined />, text: 'No intervention reaches 100% until proof of evidence is attached.', tone: 'good' },
      { icon: <TeamOutlined />, text: 'Facilitator and SME report the outcome separately, without seeing each other’s answer.', tone: 'good' },
      { icon: <RiseOutlined />, text: 'Revenue and headcount are compared before and after each firm’s first completed intervention.', tone: 'info' },
    ],
    note: 'Outcomes not fully achieved are checked again after 30 days.',
  },
  {
    kind: 'narrative',
    title: 'Test it: a 12-month pilot',
    lead: 'Run one cohort on the platform against a comparison cohort, and judge it on your own data.',
    icon: <ExperimentOutlined />,
    accent: '#34d399',
    points: [
      { icon: <RiseOutlined />, text: 'Measured: revenue and headcount at 6 and 12 months, on-time rate, evidence rate, reporting hours.', tone: 'info' },
      { icon: <FlagOutlined />, text: 'Success: better delivery and growth than the comparison cohort, and reports in hours, not weeks.', tone: 'good' },
      { icon: <WarningOutlined />, text: 'Failure: no difference. We would report that too.', tone: 'warn' },
    ],
  },
  {
    kind: 'narrative',
    title: 'What we do not claim',
    icon: <QuestionCircleOutlined />,
    accent: '#f59e0b',
    points: [
      { icon: <ExperimentOutlined />, text: 'The trials tested consulting, not software. The pilot is how we find out what the platform adds.', tone: 'warn' },
      { icon: <AuditOutlined />, text: 'Revenue and headcount are self-reported. Evidence and two-sided checks reduce the risk; they do not remove it.', tone: 'warn' },
      { icon: <FundOutlined />, text: 'Before-and-after is not a control group. A comparison cohort is still needed.', tone: 'warn' },
    ],
  },
  {
    kind: 'closing',
    title: 'Run one cohort for 12 months',
    subtitle: 'We set up the programme, its KPI targets and a comparison group with you, and share the 6-month results in full.',
    icon: <FlagOutlined />,
    accent: '#8b5cf6',
  },
]

const SalesPitchPage = () => {
  const { t } = useLanguage()
  const [playerOpen, setPlayerOpen] = useState(false)
  const [playerOrigin, setPlayerOrigin] = useState<{ x: number; y: number } | null>(null)

  useRegisterAgentPageContext({
    pageKey: 'admin-sales-pitch', pageName: 'Sales pitch',
    purpose: 'Present the evidence-based sales pitch for Smart Incubation as a slide player.',
    metrics: { slides: SLIDES.length },
  })

  const startPlayer = (event: { currentTarget: EventTarget | null }) => {
    const rect = event.currentTarget instanceof Element ? event.currentTarget.getBoundingClientRect() : null
    setPlayerOrigin(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null)
    setPlayerOpen(true)
  }

  return <DashboardPage>
    <Row gutter={[14, 14]}>
      <Col xs={24} lg={15}>
        <Card>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Title level={4} style={{ margin: 0 }}>Smart Incubation: the evidence-based case</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t('A {count}-slide pitch built on randomised trials of SME support, with a pilot design and its limits stated. Plays full screen; use the arrow keys to move and Esc to close.', undefined, { count: SLIDES.length })}
            </Typography.Paragraph>
            <div><Button type="primary" size="large" icon={<PlayCircleFilled />} onClick={startPlayer}>{t('Play pitch')}</Button></div>
          </Space>
        </Card>
      </Col>
      <Col xs={24} lg={9}>
        <Card title={t('Slides')}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {SLIDES.map((slide) => <li key={slide.title}><Typography.Text>{slide.title}</Typography.Text></li>)}
          </ol>
        </Card>
      </Col>
      <Col xs={24}>
        <Card title={t('Sources')}>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {SOURCES.map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer">{source.label}</a></li>)}
          </ul>
        </Card>
      </Col>
    </Row>
    <ReportPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} slides={SLIDES} origin={playerOrigin} />
  </DashboardPage>
}

export default SalesPitchPage
