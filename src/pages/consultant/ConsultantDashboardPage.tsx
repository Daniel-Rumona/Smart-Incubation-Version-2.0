import { useState } from 'react'
import { Card, Col, Empty, List, Modal, Progress, Row, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type Highcharts from 'highcharts'
import { CheckCircleOutlined, ClockCircleOutlined, FileSearchOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useMemo } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { UpcomingWeekCard, type InterventionDueItem } from '@/pages/dashboards/operations/UpcomingWeekCard'
import { useThemeMode } from '@/providers/ThemeProvider'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    assignmentParticipant,
    assignmentProgram,
    assignmentTitle,
    deriveConsultantStatus,
    getFeedback,
    isOverdueAssignment,
    progressForAssignment,
    statusColor,
    toDate,
} from './ConsultantWorkspaceUtils'
import '@/styles/consultant.css'

type ConsultantStatus = ReturnType<typeof deriveConsultantStatus>

type DashboardFeedback = {
    rating?: number | null
    comments?: string
    createdAt?: Date | null
}

type DashboardRow = {
    id: string
    title: string
    participant: string
    program: string
    status: ConsultantStatus
    progress: number
    dueDate: Date | null
    raw: AssignedIntervention
    feedback: DashboardFeedback
}

const { Text } = Typography

const buildRow = (assignment: AssignedIntervention): DashboardRow => {
    const status = deriveConsultantStatus(assignment)
    const feedback = getFeedback(assignment)

    return {
        id: assignment.id,
        title: assignmentTitle(assignment),
        participant: assignmentParticipant(assignment),
        program: assignmentProgram(assignment),
        status,
        progress: progressForAssignment(assignment, status),
        dueDate: toDate(assignment.dueDate),
        raw: assignment,
        feedback: {
            rating: feedback.rating,
            comments: feedback.comments,
            createdAt: feedback.createdAt,
        },
    }
}

const isOverdueRow = (row: DashboardRow) => {
    if (row.status === 'Completed') return false
    if (row.dueDate && dayjs(row.dueDate).isBefore(dayjs(), 'day')) return true
    return isOverdueAssignment(row.raw)
}


const deliveryHealthColors = {
    pending: '#F59E0B',
    inProgress: '#2563EB',
    completed: '#16A34A',
    overdue: '#DC2626',
}

export const ConsultantDashboardPage = () => {
    const { t } = useLanguage()
    const { assignments, loading, isMine } = useAssignedInterventions()
    const { user } = useFullIdentity()
    const { mode } = useThemeMode()
    const dark = mode === 'dark'
    const [metricModal, setMetricModal] = useState<{ title: string; rows: DashboardRow[] } | null>(null)

    const rows = useMemo(() => {
        return assignments.filter(isMine).map(buildRow)
    }, [assignments, isMine])

    const pending = rows.filter((row) => row.status === 'Pending')
    const active = rows.filter((row) => row.status === 'In progress')
    const completed = rows.filter((row) => row.status === 'Completed')
    const overdue = rows.filter(isOverdueRow)
    const feedbackRows = rows.filter((row) => row.feedback.comments || row.feedback.rating != null)

    const dueItems = useMemo<InterventionDueItem[]>(() => rows
        .filter((row) => row.status !== 'Completed' && row.dueDate)
        .map((row) => ({ id: row.id, title: row.title, participantName: row.participant, owner: '', dueDate: dayjs(row.dueDate) })), [rows])

    const deliveryHealthData = [
        { name: t('consultant.status.pending', 'Pending'), y: pending.length, color: deliveryHealthColors.pending },
        { name: t('consultant.status.inprogress', 'In progress'), y: active.length, color: deliveryHealthColors.inProgress },
        { name: t('consultant.status.completed', 'Completed'), y: completed.length, color: deliveryHealthColors.completed },
        { name: t('consultant.status.overdue', 'Overdue'), y: overdue.length, color: deliveryHealthColors.overdue },
    ].filter((item) => item.y > 0)

    const statusOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 260, backgroundColor: 'transparent' },
        legend: { itemStyle: { color: dark ? '#e5e7eb' : '#374151' } },
        title: { text: undefined },
        colors: deliveryHealthData.map((item) => item.color),
        tooltip: {
            pointFormat: `<b>{point.y}</b> ${t('consultant.common.assignments', 'assignments')}`,
        },
        plotOptions: {
            pie: {
                innerSize: '55%',
                borderWidth: 0,
                borderColor: 'transparent',
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}',
                    color: dark ? '#e5e7eb' : '#374151',
                    style: { textOutline: 'none', fontWeight: '600', color: dark ? '#e5e7eb' : '#374151' },
                    connectorWidth: 1,
                    distance: 28,
                },
                states: {
                    hover: { enabled: true, brightness: 0.04 },
                },
            },
        },
        series: [{
            type: 'pie',
            name: t('consultant.common.assignments', 'Assignments'),
            data: deliveryHealthData.map((item) => ({
                name: item.name,
                y: item.y,
                color: item.color,
            })),
        }],
    }

    const modalColumns: ColumnsType<DashboardRow> = [
        { title: t('consultant.common.intervention'), dataIndex: 'title', key: 'title', ellipsis: true },
        { title: t('consultant.common.sme'), dataIndex: 'participant', key: 'participant', ellipsis: true },
        {
            title: t('common.status', 'Status'),
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: (value: ConsultantStatus, row) => (
                <Tag color={isOverdueRow(row) && value !== 'Completed' ? 'red' : statusColor(value)}>
                    {isOverdueRow(row) && value !== 'Completed' ? t('consultant.status.overdue', 'Overdue') : value}
                </Tag>
            ),
        },
        { title: t('consultant.common.progress'), dataIndex: 'progress', key: 'progress', width: 150, render: (value: number) => <Progress percent={value} size="small" /> },
        { title: t('consultant.common.due'), dataIndex: 'dueDate', key: 'dueDate', width: 120, render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : t('consultant.common.noDueDate') },
    ]

    const statusRows = [
        { key: 'pending', label: t('consultant.status.pending', 'Pending'), count: pending.length, color: deliveryHealthColors.pending },
        { key: 'inProgress', label: t('consultant.status.inprogress', 'In progress'), count: active.length, color: deliveryHealthColors.inProgress },
        { key: 'completed', label: t('consultant.status.completed', 'Completed'), count: completed.length, color: deliveryHealthColors.completed },
        { key: 'overdue', label: t('consultant.status.overdue', 'Overdue'), count: overdue.length, color: deliveryHealthColors.overdue },
    ]

    return (
        <DashboardPage className="consultant-page">
            <Row gutter={[16, 16]} className="dashboard-metrics-row consultant-metrics">
                <Col xs={12} lg={6}><DashboardMetricCard onClick={() => setMetricModal({ title: t('consultant.metrics.assigned'), rows })} loading={loading} icon={<FileSearchOutlined />} label={t('consultant.metrics.assigned')} value={rows.length} hint={t('consultant.dashboard.assignedHint')} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard onClick={() => setMetricModal({ title: t('consultant.metrics.inProgress'), rows: active })} loading={loading} icon={<ClockCircleOutlined />} iconClassName="is-progress" label={t('consultant.metrics.inProgress')} value={active.length} hint={t('consultant.dashboard.pendingHint', `${pending.length} waiting for acceptance`).replace('{count}', String(pending.length))} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard onClick={() => setMetricModal({ title: t('consultant.metrics.completed'), rows: completed })} loading={loading} icon={<CheckCircleOutlined />} iconClassName="is-success" label={t('consultant.metrics.completed')} value={completed.length} hint={t('consultant.dashboard.completionHint', '{rate}% completion rate').replace('{rate}', String(rows.length ? Math.round((completed.length / rows.length) * 100) : 0))} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard onClick={() => setMetricModal({ title: t('consultant.metrics.attention'), rows: overdue })} loading={loading} icon={<WarningOutlined />} iconClassName="is-risk" label={t('consultant.metrics.attention')} value={overdue.length} hint={t('consultant.dashboard.overdueHint')} /></Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={15}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('consultant.dashboard.deliveryQueue', 'Delivery status')} style={{ height: '100%' }}>
                        {rows.length ? (
                            <Space direction="vertical" size={18} style={{ width: '100%' }}>
                                {statusRows.map((item) => (
                                    <div key={item.key}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <Space size={8}><span style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, display: 'inline-block' }} /><Text strong>{item.label}</Text></Space>
                                            <Text type="secondary">{item.count} {t('consultant.common.assignments', 'assignments')}</Text>
                                        </div>
                                        <Progress percent={rows.length ? Math.round((item.count / rows.length) * 100) : 0} strokeColor={item.color} />
                                    </div>
                                ))}
                            </Space>
                        ) : <Empty description={t('consultant.dashboard.noAssignments')} />}
                    </Card>
                </Col>
                <Col xs={24} xl={9}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('consultant.dashboard.deliveryHealth')}>
                        {rows.length ? <ThemedHighcharts options={statusOptions} /> : <Empty description={t('consultant.dashboard.noAssignments')} />}
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={10}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('consultant.dashboard.recentFeedback')} style={{ height: '100%' }}>
                        <List
                            dataSource={feedbackRows.slice(0, 5)}
                            locale={{ emptyText: t('consultant.dashboard.noFeedback') }}
                            renderItem={(row) => (
                                <List.Item>
                                    <List.Item.Meta
                                        title={<Space wrap><Text strong>{row.participant}</Text><Tag>{row.feedback.rating ?? t('consultant.feedback.unrated')}/5</Tag></Space>}
                                        description={row.feedback.comments || row.title}
                                    />
                                </List.Item>
                            )}
                        />
                    </Card>
                </Col>
                <Col xs={24} lg={14}>
                    <UpcomingWeekCard interventionDueItems={dueItems} loading={loading} assigneeUid={user?.uid} />
                </Col>
            </Row>

            <Modal
                open={!!metricModal}
                title={metricModal ? `${metricModal.title} (${metricModal.rows.length})` : ''}
                footer={null}
                width={900}
                destroyOnClose
                onCancel={() => setMetricModal(null)}
            >
                <Table
                    columns={modalColumns}
                    dataSource={metricModal?.rows || []}
                    rowKey="id"
                    size="middle"
                    pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'], hideOnSinglePage: true }}
                    locale={{ emptyText: t('consultant.dashboard.noActive') }}
                    scroll={{ x: 720 }}
                />
            </Modal>
        </DashboardPage>
    )
}

export default ConsultantDashboardPage
