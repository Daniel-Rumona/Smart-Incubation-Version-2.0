import { useEffect, useState } from 'react'
import { Alert, App, Button, Col, Collapse, Empty, Grid, List, Popconfirm, Progress, Row, Space, Table, Tag, Typography } from 'antd'
import { CheckCircleOutlined, DownloadOutlined, FileSearchOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { confirmIncubateeGrowthPlan, loadIncubateeWorkspace } from '@/services/incubateeWorkspaceService'
import type { IncubateeWorkspace } from '@/types/incubatee'
import type { LivePlanItem } from '@/utils/liveDiagnosticPlan'
import { PlanProjectionPreview } from '@/components/interventions/PlanProjectionPreview'
import '@/styles/incubatee.css'
import { buildLivePlanItems, livePlanProgress } from '@/utils/liveDiagnosticPlan'
import { useLanguage } from '@/providers/LanguageProvider'

const { Title, Text } = Typography
const { useBreakpoint } = Grid

const statusTagColor = (status: LivePlanItem['status']) =>
    status === 'Completed' ? 'green' : status === 'In progress' ? 'blue' : status === 'Awaiting action' ? 'orange' : 'default'

export default function IncubateeDiagnosticPlanPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const screens = useBreakpoint()
    const isMobile = !screens.md

    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()
    const [saving, setSaving] = useState(false)

    const load = async () => {
        if (!user) return
        try { setWorkspace(await loadIncubateeWorkspace(user)) }
        catch { message.error(t('Your diagnostic plan could not be loaded.')); setWorkspace(null) }
    }
    useEffect(() => { void load() }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const confirm = async () => {
        if (!user || !workspace) return
        setSaving(true)
        try {
            await confirmIncubateeGrowthPlan(workspace, user)
            message.success(t('Diagnostic plan confirmed successfully.'))
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'missing-signature' ? t('Please set up your signature on the Welcome page before confirming.') : t('The diagnostic plan could not be confirmed.'))
        } finally { setSaving(false) }
    }

    // `undefined` is still loading; the panels carry their own skeletons while it is.
    const loading = workspace === undefined
    if (!loading && !workspace) return <DashboardPage><Empty description={t('No accepted programme or diagnostic plan was found.')} /></DashboardPage>
    if (!loading && !workspace.growthPlanAvailable) return <DashboardPage><Alert type="info" showIcon message={t('Your diagnostic plan is not ready yet.')} description={t('Operations must complete and confirm the plan before it becomes available here.')} /></DashboardPage>

    const assignmentRecords = (workspace?.assignedInterventions || []).filter(item => !item.id.startsWith('unassigned-')).map(item => ({ ...item.raw, interventionId: item.interventionId, interventionTitle: item.title, progress: item.progress, status: item.status }))
    // `LivePlanItem` is the util's own documented return shape; the generic inference
    // above loses it (unions in an empty-history branch collapse to `never[]`).
    const liveInterventions = buildLivePlanItems(workspace?.requiredInterventions || [], assignmentRecords) as unknown as LivePlanItem[]
    const overallProgress = livePlanProgress(liveInterventions)

    // Operations confirmation is a precondition of this page even being reachable,
    // so the only open question left is the SME's own confirmation.
    const confirmedCount = (workspace?.operationsPlanConfirmation ? 1 : 0) + (workspace?.growthPlanConfirmed ? 1 : 0)
    const confirmationPercent = Math.round((confirmedCount / 2) * 100)

    const downloadPlan = () => {
        if (!workspace) return
        const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
        const rows = liveInterventions.map((item, index) => `<tr><td>${index + 1}</td><td>${escape(item.title)}</td><td>${escape(item.areaOfSupport || 'General support')}</td><td>${escape(item.status)}</td><td>${item.progress}%</td><td>${item.completedSteps}/${item.totalSteps} completed${item.history.length ? `<br>${item.history.map(entry => `${escape(entry.title)}: ${escape(entry.status)} (${entry.progress}%)`).join('<br>')}` : ''}</td></tr>`).join('')
        const signature = (label: string, confirmation?: IncubateeWorkspace['operationsPlanConfirmation']) => `<td><strong>${label}</strong>${confirmation?.signatureURL ? `<img src="${escape(confirmation.signatureURL)}" />` : '<p>Pending signature</p>'}<p>${escape(confirmation?.name || confirmation?.email || '')}</p><p>${escape(confirmation?.confirmedAt ? new Date(confirmation.confirmedAt).toLocaleString() : '')}</p></td>`
        const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#1f2937;margin:32px}h1{color:#111827}table{width:100%;border-collapse:collapse;margin:16px 0 28px}th,td{border:1px solid #d9d9d9;padding:10px;text-align:left}th{background:#f8fafc}img{display:block;max-width:190px;height:70px;object-fit:contain;margin:12px 0}.summary{padding:16px;background:#f8fafc;border-left:5px solid #6d5dfb}</style></head><body><h1>${escape(workspace.businessName)} Diagnostic Growth Plan</h1><p>${escape(workspace.programName || '')}</p><div class="summary"><strong>Live overall progress: ${overallProgress}%</strong><br>Downloaded ${new Date().toLocaleString()}</div><h2>Intervention delivery status</h2><table><tr><th>#</th><th>Intervention</th><th>Area of support</th><th>Live status</th><th>Progress</th><th>Step history</th></tr>${rows}</table><h2>Confirmations</h2><table><tr>${signature('Operations', workspace.operationsPlanConfirmation)}${signature('SME', workspace.participantPlanConfirmation)}</tr></table></body></html>`
        const url = URL.createObjectURL(new Blob([html], { type: 'application/msword;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = `${workspace.businessName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-live-diagnostic-plan.doc`; link.click(); URL.revokeObjectURL(url)
    }

    return <DashboardPage className="incubatee-page diagnostic-plan-page">
        <Title level={isMobile ? 4 : 3} className="diagnostic-plan-title">
            <FileSearchOutlined />
            {t('Diagnostic Plan')}
        </Title>

        {!loading && workspace && (
            <Text type="secondary" className="diagnostic-plan-subtitle">
                {workspace.businessName}{workspace.programName ? ` · ${workspace.programName}` : ''}
            </Text>
        )}

        {!isMobile && !loading && !workspace?.growthPlanConfirmed && (
            <Alert
                style={{ marginBottom: 12 }}
                type="info"
                showIcon
                message={t('Review your plan')}
                description={t('This is the live diagnostic plan operations has prepared for you. Review each intervention below, then confirm when ready.')}
            />
        )}

        {/* Confirmation progress: one combined card on mobile, side-by-side on desktop. */}
        {isMobile ? (
            <MotionCard loading={loading} skeletonRows={3} className="diagnostic-plan-section">
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    <Text strong style={{ fontSize: 13 }}>{t('Plan status')}</Text>

                    <div style={{ width: '100%' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('Progress')}</Text>
                        <Progress percent={overallProgress} size={['100%', 10]} status={overallProgress === 100 ? 'success' : 'active'} />
                    </div>

                    <div style={{ width: '100%' }}>
                        <Text type="secondary" style={{ fontSize: 12 }}>{t('Confirmations')}</Text>
                        <Progress percent={confirmationPercent} size={['100%', 10]} status={confirmationPercent === 100 ? 'success' : 'active'} format={() => `${confirmedCount}/2`} />
                    </div>
                </Space>
            </MotionCard>
        ) : (
            <Row gutter={[12, 12]} style={{ marginBottom: 4 }}>
                <Col span={12}>
                    <MotionCard loading={loading} skeletonRows={3} className="diagnostic-plan-section">
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Text strong style={{ fontSize: 14 }}>{t('Plan progress')}</Text>
                            <Progress percent={overallProgress} size={['100%', 14]} status={overallProgress === 100 ? 'success' : 'active'} />
                            <Text type="secondary">{liveInterventions.length} {t('intervention')}{liveInterventions.length === 1 ? '' : 's'}</Text>
                        </Space>
                    </MotionCard>
                </Col>

                <Col span={12}>
                    <MotionCard loading={loading} skeletonRows={3} className="diagnostic-plan-section">
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Text strong style={{ fontSize: 14 }}>{t('Confirmations')}</Text>
                            <Progress percent={confirmationPercent} size={['100%', 14]} status={confirmationPercent === 100 ? 'success' : 'active'} />
                            <Text type="secondary">{confirmedCount}/2 confirmed</Text>
                        </Space>
                    </MotionCard>
                </Col>
            </Row>
        )}

        <div className="diagnostic-plan-interventions-head">
            <Text strong style={{ fontSize: isMobile ? 14 : 16 }}>{t('Your interventions')}</Text>

            <Space wrap size={8}>
                <PlanProjectionPreview interventions={liveInterventions} />
                <Button size="small" icon={<DownloadOutlined />} onClick={downloadPlan}>{t('Download')}</Button>
            </Space>
        </div>

        {!liveInterventions.length ? (
            <Empty description={t('No interventions were added to this plan.')} />
        ) : (
            <Collapse accordion bordered={false} className="diagnostic-plan-collapse" style={{ background: 'transparent' }}>
                {liveInterventions.map((item, index) => {
                    const key = item.id || String(index)

                    const header = isMobile ? (
                        <Space direction="vertical" size={6} style={{ width: '100%' }}>
                            <Text strong style={{ fontSize: 15 }}>{item.title}</Text>

                            <Space wrap size={6}>
                                <Tag color={statusTagColor(item.status)}>{item.status}</Tag>
                                {item.totalSteps > 1 && <Tag color="purple">{item.completedSteps}/{item.totalSteps} {t('steps')}</Tag>}
                            </Space>
                        </Space>
                    ) : (
                        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Space wrap>
                                <Text strong>{item.title}</Text>
                                <Tag color={statusTagColor(item.status)}>{item.status}</Tag>
                                {item.totalSteps > 1 && <Tag color="purple">{item.completedSteps} {t('of')} {item.totalSteps} {t('steps completed')}</Tag>}
                            </Space>

                            <Text type="secondary" style={{ fontSize: 12 }}>{item.progress}{t('% complete')}</Text>
                        </Space>
                    )

                    return (
                        <Collapse.Panel key={key} header={header}>
                            <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                <Text type="secondary">{item.areaOfSupport || t('General support')}</Text>

                                <Progress percent={item.progress} size="small" />

                                {item.totalSteps > 1 && (
                                    <Text>{item.remainingSteps ? `${item.remainingSteps} step${item.remainingSteps === 1 ? '' : 's'} remaining` : t('All steps covered')}</Text>
                                )}

                                {!item.history.length ? (
                                    <Alert type="info" showIcon message={t('No steps recorded yet')} description={t('This intervention has not started.')} />
                                ) : isMobile ? (
                                    <List
                                        dataSource={item.history}
                                        split={false}
                                        renderItem={(entry, historyIndex) => (
                                            <List.Item style={{ padding: '6px 0' }}>
                                                <div className="diagnostic-step-card">
                                                    <Text type="secondary" style={{ fontSize: 12 }}>{t('Step')} {historyIndex + 1}</Text>
                                                    <Text>{entry.title}</Text>
                                                    <Space size={6}>
                                                        <Tag color={entry.status === 'Completed' ? 'green' : 'blue'}>{entry.status}</Tag>
                                                        <Text type="secondary">{entry.progress}%</Text>
                                                    </Space>
                                                </div>
                                            </List.Item>
                                        )}
                                    />
                                ) : (
                                    <Table
                                        size="small"
                                        pagination={false}
                                        rowKey="id"
                                        columns={[
                                            { title: t('Step'), dataIndex: 'title', key: 'title' },
                                            { title: t('Status'), dataIndex: 'status', key: 'status', render: (value: string) => <Tag color={value === 'Completed' ? 'green' : 'blue'}>{value}</Tag> },
                                            { title: t('Progress'), dataIndex: 'progress', key: 'progress', render: (value: number) => `${value}%` },
                                        ]}
                                        dataSource={item.history}
                                    />
                                )}
                            </Space>
                        </Collapse.Panel>
                    )
                })}
            </Collapse>
        )}

        {workspace?.growthPlanConfirmed ? (
            <div style={{ textAlign: 'center', marginTop: 4 }}>
                <CheckCircleOutlined style={{ fontSize: isMobile ? 34 : 44, color: '#52c41a' }} />
                <Title level={isMobile ? 4 : 3} style={{ marginTop: 8, marginBottom: 0, color: '#52c41a' }}>
                    {t('Diagnostic Plan Confirmed')}
                </Title>
                <Text type="secondary">
                    {t('You confirmed this plan')}{workspace.participantPlanConfirmation?.confirmedAt ? ` on ${new Date(workspace.participantPlanConfirmation.confirmedAt).toLocaleDateString()}` : ''}.
                </Text>
            </div>
        ) : (
            <MotionCard loading={loading} skeletonRows={3} className="diagnostic-plan-section" title={t('Confirmations')}>
                <div className="diagnostic-signature-grid">
                    <div className="diagnostic-signature-card">
                        <Typography.Text strong>{t('Operations approval')}</Typography.Text>
                        {workspace?.operationsPlanConfirmation?.signatureURL
                            ? <img src={workspace.operationsPlanConfirmation.signatureURL} alt={t('Operations signature')} />
                            : <Tag color="green" icon={<SafetyCertificateOutlined />}>{t('Confirmed')}</Tag>}
                    </div>

                    <div className="diagnostic-signature-card">
                        <Typography.Text strong>{t('Your confirmation')}</Typography.Text>
                        <Tag color="orange">{t('Not confirmed yet')}</Tag>
                    </div>
                </div>

                <div className="diagnostic-plan-confirm-action">
                    <Popconfirm title={t('Confirm this diagnostic plan?')} description={t('This applies your saved signature and acknowledges the listed interventions.')} onConfirm={() => void confirm()} okText={t('Confirm plan')}>
                        <Button block type="primary" loading={saving} disabled={!user?.signatureURL}>{t('Confirm diagnostic plan')}</Button>
                    </Popconfirm>
                </div>

                {!user?.signatureURL && <Alert style={{ marginTop: 12 }} type="error" showIcon message={t('A saved signature is required before confirmation.')} />}
            </MotionCard>
        )}
    </DashboardPage>
}
