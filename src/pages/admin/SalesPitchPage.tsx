import { useState } from 'react'
import { Button, Card, Col, Row, Space, Typography } from 'antd'
import {
  AimOutlined,
  AuditOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DashboardOutlined,
  ExperimentOutlined,
  FileProtectOutlined,
  FlagOutlined,
  FundOutlined,
  PlayCircleFilled,
  QuestionCircleOutlined,
  RiseOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  TeamOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { ReportPlayer, type PlayerSlide } from '@/components/reports/ReportPlayer'
import { useLanguage } from '@/providers/LanguageProvider'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'

// The sales pitch, told as slides: the scientific method the platform builds into everyday programme work.
// The copy is sales material, so it stays in English; only the page around it is translated. Screens are
// 2880×1800 captures of test data (public/pitch), so no real client appears in sales material.
const SLIDES: PlayerSlide[] = [
  {
    kind: 'title',
    eyebrow: 'Sales pitch',
    title: 'Smart Incubation: support you can measure',
    subtitle: 'The method of a good study, built into everyday programme work: a baseline, a plan, tracked delivery, verified outcomes and a comparison.',
    icon: <ExperimentOutlined />,
    accent: '#8b5cf6',
  },
  {
    kind: 'narrative',
    title: 'The method, built in',
    lead: 'Every SME goes through the same steps, and each step leaves data you can analyse.',
    icon: <ExperimentOutlined />,
    accent: '#8b5cf6',
    points: [
      { icon: <AuditOutlined />, text: 'Record and baseline: structured applications and a diagnostic for every SME.', tone: 'info' },
      { icon: <ClockCircleOutlined />, text: 'Track: every intervention, its status and what it is waiting on.', tone: 'info' },
      { icon: <SafetyCertificateOutlined />, text: 'Verify and compare: evidence, independent outcome reports, and before-and-after figures.', tone: 'good' },
    ],
  },
  {
    kind: 'screen',
    title: 'Structured records from day one',
    lead: 'Every applicant is captured in the same fields, so cohorts can be compared and reported on.',
    icon: <SolutionOutlined />,
    accent: '#8b5cf6',
    image: '/pitch/applications.jpg',
    alt: 'Applications review: counts of pending, accepted and rejected applications, a list of SMEs, and one applicant’s details.',
    points: [
      { icon: <AuditOutlined />, text: 'Programme, province, B-BBEE level and gender recorded for each SME.', tone: 'info' },
      { icon: <CheckCircleOutlined />, text: 'Each decision is kept on file with the application.', tone: 'good' },
      { icon: <FundOutlined />, text: 'Filter by status and date, or open the analytics.', tone: 'info' },
    ],
  },
  {
    kind: 'screen',
    title: 'A baseline for every SME',
    lead: 'Before any support, a Diagnostic Growth Plan records where the business stands: an overview and a SWOT.',
    icon: <AimOutlined />,
    accent: '#a78bfa',
    image: '/pitch/diagnostic-plan.jpg',
    alt: 'A Diagnostic Growth Plan for a test SME, showing its business overview and SWOT analysis.',
    points: [
      { icon: <TeamOutlined />, text: 'Operations and the SME both sign off the plan.', tone: 'info' },
      { icon: <AimOutlined />, text: 'Each weakness is linked to an area of support.', tone: 'info' },
      { icon: <CheckCircleOutlined />, text: 'Each SWOT item is tracked to an outcome: resolved, captured or mitigated.', tone: 'good' },
    ],
  },
  {
    kind: 'screen',
    title: 'Delivery measured, not assumed',
    lead: 'Every intervention’s status is tracked, and held-up work is grouped by its cause.',
    icon: <ClockCircleOutlined />,
    accent: '#f59e0b',
    image: '/pitch/monitoring.jpg',
    alt: 'Intervention monitoring: assigned, overdue and progress counts, a status mix chart and a chart of hold-up reasons.',
    points: [
      { icon: <WarningOutlined />, text: 'Hold-ups grouped by cause: facilitator acceptance, delivery or SME acceptance.', tone: 'warn' },
      { icon: <ClockCircleOutlined />, text: 'Overdue work flagged daily in the app, by email and on WhatsApp.', tone: 'warn' },
      { icon: <RobotOutlined />, text: 'Human and AI-agent delivery tracked side by side.', tone: 'info' },
    ],
  },
  {
    kind: 'narrative',
    title: 'Outcomes verified from three sources',
    lead: 'An outcome counts when the evidence, the facilitator and the SME agree.',
    icon: <SafetyCertificateOutlined />,
    accent: '#22d3ee',
    points: [
      { icon: <FileProtectOutlined />, text: 'No intervention reaches 100% until proof of evidence is attached.', tone: 'good' },
      { icon: <TeamOutlined />, text: 'Facilitator and SME report the outcome separately, without seeing each other’s answer.', tone: 'good' },
      { icon: <FlagOutlined />, text: 'Each intervention has a defined outcome and a follow-up date to check it.', tone: 'info' },
    ],
    note: 'Outcomes not fully achieved are checked again after 30 days.',
  },
  {
    kind: 'screen',
    title: 'Readiness scored by explicit rules',
    lead: 'The Control Tower scores each SME for funding and market readiness against stated criteria.',
    icon: <DashboardOutlined />,
    accent: '#38bdf8',
    image: '/pitch/control-tower.jpg',
    alt: 'The SME Control Tower for a test SME: revenue, compliance and growth-plan cards, and funding and market readiness checklists.',
    points: [
      { icon: <CheckCircleOutlined />, text: 'Ready means every required gate is met and the score is 75 or more.', tone: 'good' },
      { icon: <SafetyCertificateOutlined />, text: 'Each gate shows as met, pending or missing, with the reason.', tone: 'info' },
      { icon: <RiseOutlined />, text: 'Revenue, compliance and growth-plan progress on one screen.', tone: 'info' },
    ],
  },
  {
    kind: 'screen',
    title: 'Targets set in advance, checked every period',
    lead: 'Programme KPIs fill in from delivery data and are compared with the targets each programme sets.',
    icon: <FlagOutlined />,
    accent: '#f0808a',
    image: '/pitch/kpis.jpg',
    alt: 'The KPIs page: a summary of KPIs needing attention and cards for each KPI against its target, with trends.',
    points: [
      { icon: <WarningOutlined />, text: 'Met, behind or off track, with the trend against last quarter.', tone: 'warn' },
      { icon: <FundOutlined />, text: 'Automatic, intervention-based and manual KPIs side by side.', tone: 'info' },
      { icon: <FlagOutlined />, text: 'One sentence says which KPIs need attention first.', tone: 'info' },
    ],
  },
  {
    kind: 'screen',
    title: 'Before and after, and a comparison group',
    lead: 'Revenue in the six months before support is compared with the six months after, and supported SMEs with those not yet supported.',
    icon: <BarChartOutlined />,
    accent: '#34d399',
    image: '/pitch/impact.jpg',
    alt: 'Impact analysis: revenue growth, jobs created and outcomes achieved, a before-and-after revenue chart per SME, and a comparison of supported and not-yet-supported SMEs.',
    points: [
      { icon: <RiseOutlined />, text: 'The change for each SME, not just an average.', tone: 'good' },
      { icon: <TeamOutlined />, text: 'Jobs created and outcomes achieved alongside revenue.', tone: 'good' },
      { icon: <QuestionCircleOutlined />, text: 'Labelled as a comparison, not proof of cause.', tone: 'info' },
    ],
  },
  {
    kind: 'narrative',
    title: 'Honest about its own data',
    lead: 'The system keeps track of how sure each figure is, so reports do not overclaim.',
    icon: <QuestionCircleOutlined />,
    accent: '#f59e0b',
    points: [
      { icon: <TeamOutlined />, text: 'A facilitator’s answer is recorded as an observation, not as proof.', tone: 'info' },
      { icon: <AuditOutlined />, text: 'Revenue and headcount are self-reported; evidence and blind checks back them up.', tone: 'warn' },
      { icon: <BarChartOutlined />, text: 'Before-and-after only uses SMEs with figures on both sides.', tone: 'info' },
    ],
  },
  {
    kind: 'closing',
    title: 'See it on your own programme',
    subtitle: 'Run one cohort on Smart Incubation, and every figure in this pitch comes from your own data.',
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
    purpose: 'Present the sales pitch for Smart Incubation, on how it measures and verifies SME support, as a slide player.',
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
            <Typography.Title level={4} style={{ margin: 0 }}>Smart Incubation: support you can measure</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
              {t('How Smart Incubation measures and verifies SME support, in {count} slides on real screens of the system. Plays full screen; use the arrow keys to move and Esc to close.', undefined, { count: SLIDES.length })}
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
    </Row>
    <ReportPlayer open={playerOpen} onClose={() => setPlayerOpen(false)} slides={SLIDES} origin={playerOrigin} />
  </DashboardPage>
}

export default SalesPitchPage
