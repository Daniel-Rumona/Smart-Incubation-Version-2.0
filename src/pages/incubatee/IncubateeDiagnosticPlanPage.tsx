import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Card, Empty, Progress, Tag, Typography } from 'antd'
import {
    ArrowRightOutlined,
    CheckCircleFilled,
    CheckCircleOutlined,
    ClockCircleOutlined,
    CloseCircleOutlined,
    DownloadOutlined,
    DownOutlined,
    EditOutlined,
    ExclamationCircleFilled,
    FileSearchOutlined,
    LineChartOutlined,
    HourglassOutlined,
    UpOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import SignDocumentModal from '@/components/shared/SignDocumentModal'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { confirmIncubateeGrowthPlan, loadIncubateeWorkspace } from '@/services/incubateeWorkspaceService'
import type { IncubateeWorkspace } from '@/types/incubatee'
import type { LivePlanItem, LivePlanStatus } from '@/utils/liveDiagnosticPlan'
import { PlanProjectionPreview } from '@/components/interventions/PlanProjectionPreview'
import '@/styles/incubatee.css'
import '@/styles/incubatee-plan.css'
import { buildLivePlanItems, livePlanProgress, planStatusColor, stepStateColor } from '@/utils/liveDiagnosticPlan'
import PlanOutcomeChips from '@/components/interventions/PlanOutcomeChips'
import SwotOutcomeCard from '@/components/interventions/SwotOutcomeCard'
import { useLanguage } from '@/providers/LanguageProvider'

const { Text } = Typography

/** Row icon and tone per live status; the tone class colours the icon tile. */
const STATUS_ICON: Record<LivePlanStatus, ReactNode> = {
    'Completed': <CheckCircleOutlined />,
    'In progress': <LineChartOutlined />,
    'Awaiting confirmation': <ExclamationCircleFilled />,
    'Not started': <ClockCircleOutlined />,
    'Not assigned': <UserOutlined />,
    'Declined': <CloseCircleOutlined />,
}

const toneOf = (status: LivePlanStatus) => status.toLowerCase().replace(/\s+/g, '-')

const formatDate = (value?: string) => (value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export default function IncubateeDiagnosticPlanPage() {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    // `undefined` is still loading; `null` means the load failed.
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [signing, setSigning] = useState(false)
    const [openKey, setOpenKey] = useState<string | null>(null)

    const load = async () => {
        if (!user) return
        try {
            setWorkspace(await loadIncubateeWorkspace(user))
        } catch (error) {
            console.error('Could not load the diagnostic plan.', error)
            setWorkspace(null)
        }
    }
    useEffect(() => {
        // load() only sets state after its await, which this rule cannot see.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load()
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    // Signing happens in SignDocumentModal, which writes the signature out while this saves.
    const confirm = async () => {
        if (!user || !workspace) throw new Error('not-ready')
        await confirmIncubateeGrowthPlan(workspace, user)
    }
    const signError = (error: unknown) => (error instanceof Error && error.message === 'missing-signature'
        ? t('Please set up your signature on the Welcome page before confirming.')
        : t('The diagnostic plan could not be confirmed.'))

    if (workspace === undefined) return <PageSkeleton variant="dashboard" label={t('Loading your diagnostic plan')} />

    if (workspace === null) {
        return (
            <DashboardPage className="incubatee-page incubatee-plan-page">
                <Alert type="error" showIcon message={t('Your diagnostic plan could not be loaded.')} action={<Button onClick={() => { setWorkspace(undefined); void load() }}>{t('Try again')}</Button>} />
            </DashboardPage>
        )
    }

    if (!workspace.growthPlanAvailable) {
        // Where the SME is on the way to a plan: the programme accepted them, operations is
        // building and approving the plan, and confirming it is the SME's step once it lands.
        const journey = [
            { key: 'accepted', title: t('Accepted into the programme'), state: 'done' },
            { key: 'preparing', title: t('Operations prepares your plan'), text: t('They match interventions to what your diagnostic found.'), state: 'current' },
            { key: 'confirm', title: t('You review and confirm it'), text: t('Check back here once it is ready.'), state: 'next' },
        ]
        return (
            <DashboardPage className="incubatee-page incubatee-plan-page is-pending">
                <section className="plan-pending">
                    <span className="plan-pending-icon" aria-hidden="true"><FileSearchOutlined /></span>
                    <Text strong className="plan-pending-title">{t('Your diagnostic plan is being prepared')}</Text>
                    <Text type="secondary">{t('It will appear here once operations has completed and approved it.')}</Text>
                    <ol className="plan-pending-steps">
                        {journey.map(step => (
                            <li key={step.key} className={`plan-pending-step is-${step.state}`}>
                                <span className="plan-pending-dot" aria-hidden="true">{step.state === 'done' ? <CheckCircleFilled /> : step.state === 'current' ? <HourglassOutlined /> : <ClockCircleOutlined />}</span>
                                <span className="plan-pending-step-text">
                                    <Text strong={step.state === 'current'}>{step.title}</Text>
                                    {step.text && <Text type="secondary" className="plan-pending-step-meta">{step.text}</Text>}
                                </span>
                            </li>
                        ))}
                    </ol>
                </section>
            </DashboardPage>
        )
    }

    const assignmentRecords = workspace.assignedInterventions.filter(item => !item.id.startsWith('unassigned-')).map(item => ({ ...item.raw, interventionId: item.interventionId, interventionTitle: item.title, progress: item.progress }))
    // `LivePlanItem` is the util's own documented return shape; the generic inference
    // above loses it (unions in an empty-history branch collapse to `never[]`).
    const liveInterventions = buildLivePlanItems(workspace.requiredInterventions, assignmentRecords) as unknown as LivePlanItem[]
    const overallProgress = livePlanProgress(liveInterventions)
    const countOf = (...statuses: LivePlanStatus[]) => liveInterventions.filter(item => statuses.includes(item.status)).length
    const awaitingYou = liveInterventions.filter(item => item.status === 'Awaiting confirmation')
    const hasSignature = Boolean(user?.signatureURL)

    const downloadPlan = () => {
        const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
        const rows = liveInterventions.map((item, index) => `<tr><td>${index + 1}</td><td>${escape(item.title)}</td><td>${escape(item.areaOfSupport || 'General support')}</td><td>${escape(item.status)}</td><td>${item.progress}%</td><td>${item.completedSteps}/${item.totalSteps} completed${item.stepRows.length > 1 ? `<br>${item.stepRows.map(entry => `${escape(entry.title)}: ${escape(entry.label)} (${entry.progress}%, ${entry.share}% of the intervention)`).join('<br>')}` : ''}${item.outcome ? `<br><em>${[item.outcome.deliverableName ? `${escape(item.outcome.deliverableName)}: ${item.outcome.deliverableReceived ? 'received' : 'not uploaded yet'}` : '', item.outcome.result ? `Outcome ${item.outcome.result.replace('_', ' ')}` : '', item.outcome.followUp && item.outcome.followUp.state !== 'done' ? `Follow-up ${item.outcome.followUp.state === 'overdue' ? 'overdue' : 'due'} ${item.outcome.followUp.dueAt.toLocaleDateString('en-GB')}` : ''].filter(Boolean).join(' · ')}</em>` : ''}</td></tr>`).join('')
        const signature = (label: string, confirmation?: IncubateeWorkspace['operationsPlanConfirmation']) => `<td><strong>${label}</strong>${confirmation?.signatureURL ? `<img src="${escape(confirmation.signatureURL)}" />` : '<p>Pending signature</p>'}<p>${escape(confirmation?.name || confirmation?.email || '')}</p><p>${escape(confirmation?.confirmedAt ? new Date(confirmation.confirmedAt).toLocaleString() : '')}</p></td>`
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#1f2937;margin:32px}h1{color:#111827}table{width:100%;border-collapse:collapse;margin:16px 0 28px}th,td{border:1px solid #d9d9d9;padding:10px;text-align:left}th{background:#f8fafc}img{display:block;max-width:190px;height:70px;object-fit:contain;margin:12px 0}.summary{padding:16px;background:#f8fafc;border-left:5px solid #6d5dfb}</style></head><body><h1>${escape(workspace.businessName)} Diagnostic Growth Plan</h1><p>${escape(workspace.programName || '')}</p><div class="summary"><strong>Live overall progress: ${overallProgress}%</strong><br>Downloaded ${new Date().toLocaleString()}</div><h2>Intervention delivery status</h2><table><tr><th>#</th><th>Intervention</th><th>Area of support</th><th>Live status</th><th>Progress</th><th>Step history</th></tr>${rows}</table><h2>Confirmations</h2><table><tr>${signature('Operations', workspace.operationsPlanConfirmation)}${signature('SME', workspace.participantPlanConfirmation)}</tr></table></body></html>`
        const url = URL.createObjectURL(new Blob([html], { type: 'application/msword;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = `${workspace.businessName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-live-diagnostic-plan.doc`; link.click(); URL.revokeObjectURL(url)
    }

    const nextStep = (() => {
        if (!workspace.growthPlanConfirmed) {
            if (!hasSignature) {
                return {
                    tone: 'signature', icon: <EditOutlined />, title: t('Set up your signature first'),
                    text: t('Your plan is signed off with your saved signature. Add it on the Welcome page, then come back to confirm.'),
                    button: <Button type="primary" size="large" onClick={() => navigate('/welcome')}>{t('Set up signature')}</Button>,
                }
            }
            return {
                tone: 'confirm', icon: <EditOutlined />, title: t('Confirm your diagnostic plan'),
                text: t('Operations has approved it. Review the interventions below, then sign it off with your saved signature.'),
                button: <Button type="primary" size="large" onClick={() => setSigning(true)}>{t('Confirm plan')}</Button>,
            }
        }
        if (awaitingYou.length) {
            return {
                tone: 'awaiting', icon: <ExclamationCircleFilled />,
                title: awaitingYou.length === 1
                    ? t('Confirm "{title}" is complete', undefined, { title: awaitingYou[0].title })
                    : t('{count} interventions are waiting for your confirmation', undefined, { count: awaitingYou.length }),
                text: t('Your facilitator marked the work as done. Confirm it on the interventions page.'),
                button: <Button type="primary" size="large" onClick={() => navigate('/incubatee/interventions')}>{t('Go to interventions')}</Button>,
            }
        }
        return null
    })()

    const tiles = [
        { key: 'completed', label: t('Completed'), value: countOf('Completed'), icon: <CheckCircleOutlined /> },
        { key: 'active', label: t('In progress'), value: countOf('In progress'), icon: <LineChartOutlined /> },
        { key: 'needs', label: t('Needs you'), value: awaitingYou.length, icon: <ExclamationCircleFilled /> },
        { key: 'waiting', label: t('Not started'), value: countOf('Not started', 'Not assigned'), icon: <ClockCircleOutlined /> },
    ]

    const rowMeta = (item: LivePlanItem) => {
        const area = item.areaOfSupport || t('General support')
        if (item.status === 'Not assigned') return `${area} · ${t('Waiting for a facilitator')}`
        if (item.status === 'Declined') return `${area} · ${t('Not counted in your plan progress')}`
        if (item.totalSteps > 1) return `${area} · ${t('{done} of {total} steps', undefined, { done: item.completedSteps, total: item.totalSteps })}`
        return `${area} · ${item.progress}%`
    }

    const signOff = (label: string, confirmation: IncubateeWorkspace['operationsPlanConfirmation'], confirmed: boolean) => (
        <div className={`plan-signoff-card${confirmed ? ' is-confirmed' : ''}`}>
            <span className="plan-signoff-icon" aria-hidden="true">{confirmed ? <CheckCircleFilled /> : <EditOutlined />}</span>
            <div className="plan-signoff-text">
                <Text strong>{label}</Text>
                <Text type="secondary" className="plan-signoff-meta">
                    {confirmed
                        ? [confirmation?.name || confirmation?.email, formatDate(confirmation?.confirmedAt)].filter(Boolean).join(' · ') || t('Confirmed')
                        : t('Not confirmed yet')}
                </Text>
            </div>
            {confirmation?.signatureURL && <img src={confirmation.signatureURL} alt={t('{name} signature', undefined, { name: label })} className="plan-signoff-signature" />}
        </div>
    )

    return <DashboardPage className="incubatee-page incubatee-plan-page">
        <section className="plan-summary">
            {/* The shared metric card has no ring, so the plan score borrows its card styles. */}
            <Card className="dashboard-metric-card plan-score-card" bordered>
                <div className="dashboard-metric-row">
                    <Progress
                        type="circle"
                        percent={overallProgress}
                        size={44}
                        strokeWidth={10}
                        strokeColor="#6d5dfb"
                        format={(percent) => <span className="plan-score-value">{percent}%</span>}
                    />
                    <div className="dashboard-metric-copy">
                        <Text strong>{t('Plan progress')}</Text>
                        <Text type="secondary" className="dashboard-metric-label">
                            {t('{count} interventions', undefined, { count: liveInterventions.length })}
                        </Text>
                    </div>
                </div>
            </Card>
            {tiles.map(tile => <DashboardMetricCard key={tile.key} icon={tile.icon} label={tile.label} value={tile.value} />)}
        </section>

        {nextStep && (
            <section className={`plan-next is-${nextStep.tone}`}>
                <span className="plan-next-eyebrow"><ArrowRightOutlined /> {t('Next step')}</span>
                <div className="plan-next-body">
                    <span className="plan-next-icon" aria-hidden="true">{nextStep.icon}</span>
                    <div className="plan-next-text">
                        <Text strong className="plan-next-title">{nextStep.title}</Text>
                        <Text type="secondary">{nextStep.text}</Text>
                    </div>
                    <div className="plan-next-actions">{nextStep.button}</div>
                </div>
            </section>
        )}

        <section className="plan-section">
            <div className="plan-section-head">
                <h3>{t('Your interventions')}</h3>
                <div className="plan-section-actions">
                    <PlanProjectionPreview interventions={liveInterventions} />
                    <Button size="small" icon={<DownloadOutlined />} onClick={downloadPlan}>{t('Download')}</Button>
                </div>
            </div>

            {!liveInterventions.length ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No interventions were added to this plan.')} />
            ) : (
                <ul className="plan-list">
                    {liveInterventions.map((item, index) => {
                        const key = item.id || item.interventionId || String(index)
                        const open = openKey === key
                        const showBar = item.status !== 'Not assigned' && item.status !== 'Declined' && item.status !== 'Completed'
                        return (
                            <li key={key} className={`plan-row is-${toneOf(item.status)}${open ? ' is-open' : ''}`}>
                                <button type="button" className="plan-row-head" aria-expanded={open} onClick={() => setOpenKey(open ? null : key)}>
                                    <span className="plan-row-icon" aria-hidden="true">{STATUS_ICON[item.status]}</span>
                                    <span className="plan-row-main">
                                        <span className="plan-row-title">
                                            <Text strong>{item.title}</Text>
                                            <Tag color={planStatusColor(item.status)}>{t(item.status)}</Tag>
                                        </span>
                                        <Text type="secondary" className="plan-row-meta">{rowMeta(item)}</Text>
                                        {showBar && <Progress className="plan-row-progress" percent={item.progress} size="small" strokeColor="#6d5dfb" />}
                                    </span>
                                    <span className="plan-row-chevron" aria-hidden="true">{open ? <UpOutlined /> : <DownOutlined />}</span>
                                </button>

                                {open && (
                                    <div className="plan-row-detail">
                                        {item.stepRows.length > 0 && item.status !== 'Not assigned' && (
                                            <ul className="plan-steps">
                                                {item.stepRows.map(step => (
                                                    <li key={step.key} className="plan-step">
                                                        <Tag color={stepStateColor(step.state)} className="plan-step-state">{t(step.label)}</Tag>
                                                        <span className="plan-step-title">
                                                            {step.title}
                                                            {step.replaced > 0 && <Text type="secondary"> · {t('reassigned')}</Text>}
                                                        </span>
                                                        <Text type="secondary" className="plan-step-meta">
                                                            {item.totalSteps > 1
                                                                ? t('{progress}% · {share}% of this intervention', undefined, { progress: step.progress, share: step.share })
                                                                : `${step.progress}%`}
                                                        </Text>
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                        {item.status === 'Not assigned' && <Text type="secondary">{t('A facilitator has not been assigned to this intervention yet.')}</Text>}
                                        {item.status === 'Declined' && <Text type="secondary">{t('This intervention was declined, so it is not counted in your plan progress.')}</Text>}
                                        <PlanOutcomeChips outcome={item.outcome} showIntended />
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>

        <section className="plan-section">
            <div className="plan-section-head"><h3>{t('Sign-off')}</h3></div>
            <div className="plan-signoff">
                {signOff(t('Operations'), workspace.operationsPlanConfirmation, true)}
                {signOff(t('You'), workspace.participantPlanConfirmation, workspace.growthPlanConfirmed)}
            </div>
        </section>

        <SwotOutcomeCard items={workspace.swotItems} planItems={liveInterventions} />

        <SignDocumentModal
            open={signing}
            onClose={() => setSigning(false)}
            title={t('Sign your diagnostic plan')}
            description={t('This applies your saved signature and accepts the interventions on the plan.')}
            signLabel={t('Sign and confirm')}
            onSign={confirm}
            onSigned={() => void load()}
            signedText={t('Diagnostic plan confirmed')}
            errorText={signError}
        />
    </DashboardPage>
}
