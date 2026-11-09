import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Input, Popconfirm, Row, Select, Space, Tooltip, Typography, type TableProps } from 'antd'
import { BankOutlined, CalendarOutlined, DeleteOutlined, EditOutlined, PlusOutlined, SearchOutlined, TeamOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { TrainingClassFormModal } from '@/components/training/TrainingClassFormModal'
import { PhaseTag } from '@/components/training/TrainingTags'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listTrainingAssessments } from '@/services/trainingAssessmentService'
import { deleteTrainingClass, listCompanyTrainingLearners, listTrainingClasses } from '@/services/trainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel, classHoursLabel, classLocationLabel } from '@/utils/trainingFormat'
import { classPhase } from '@/utils/trainingResults'
import type { TrainingAssessment, TrainingClass, TrainingClassPhase, TrainingLearner } from '@/types/training'

type ClassRow = TrainingClass & { phase: TrainingClassPhase, learners: number, organisations: number }

export default function TrainingClassesPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    const [classes, setClasses] = useState<TrainingClass[]>()
    const [learners, setLearners] = useState<TrainingLearner[]>([])
    const [assessments, setAssessments] = useState<TrainingAssessment[]>([])
    const [failed, setFailed] = useState(false)
    const [search, setSearch] = useState('')
    const [phaseFilter, setPhaseFilter] = useState<'all' | TrainingClassPhase>('all')
    const [editing, setEditing] = useState<TrainingClass | 'new' | null>(null)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [classRows, learnerRows, assessmentRows] = await Promise.all([
                listTrainingClasses(user),
                listCompanyTrainingLearners(user),
                listTrainingAssessments(user),
            ])
            setClasses(classRows)
            setLearners(learnerRows)
            setAssessments(assessmentRows)
            setFailed(false)
        } catch {
            setFailed(true)
            setClasses([])
            message.error(t('Training classes could not be loaded.'))
        }
    }, [message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const rows = useMemo<ClassRow[]>(() => (classes || []).map((trainingClass) => {
        const own = learners.filter((learner) => learner.classId === trainingClass.id)
        return {
            ...trainingClass,
            phase: classPhase(trainingClass),
            learners: own.length,
            organisations: new Set(own.map((learner) => learner.organisation.toLowerCase()).filter(Boolean)).size,
        }
    }), [classes, learners])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rows.filter((row) =>
            (phaseFilter === 'all' || row.phase === phaseFilter)
            && (!needle || `${row.courseTitle} ${classLocationLabel(row, t)}`.toLowerCase().includes(needle)))
    }, [phaseFilter, rows, search, t])

    const upcoming = rows.filter((row) => row.phase !== 'finished').length
    const organisations = new Set(learners.map((learner) => learner.organisation.toLowerCase()).filter(Boolean)).size

    useRegisterAgentPageContext({
        pageKey: 'training-classes',
        pageName: 'Training classes',
        purpose: 'List the training classes (in person, online or both), with learners and client organisations per class. Open a class to run its register, assessments, group assignment and results.',
        currentFilters: { search, phase: phaseFilter },
        metrics: { classes: rows.length, upcomingOrRunning: upcoming, learners: learners.length, organisations },
        dataSummary: { visibleClasses: visible.map((row) => ({ course: row.courseTitle, dates: classDatesLabel(row), hours: classHoursLabel(row, t), where: classLocationLabel(row, t), learners: row.learners, phase: row.phase })) },
        allowedActions: [
            { key: 'create_class', label: 'New class', description: 'Create a training class with its course, venue, dates, assessment and pass rule.' },
            { key: 'update_class', label: 'Edit class', description: 'Change a class\'s details or pass rule.' },
            { key: 'delete_class', label: 'Delete class', description: 'Delete a class that has no learners.', requiresConfirmation: true },
        ],
    })

    const remove = async (row: ClassRow) => {
        if (!user) return
        try {
            await deleteTrainingClass(user, row.id)
            message.success(t('Class deleted.'))
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'class_has_learners'
                ? t('Remove the learners before deleting this class.')
                : t('The class could not be deleted.'))
        }
    }

    const actions = (row: ClassRow) => (
        <Space onClick={(event) => event.stopPropagation()}>
            <Tooltip title={t('Edit class')}><Button icon={<EditOutlined />} onClick={() => setEditing(row)} aria-label={t('Edit class')} /></Tooltip>
            <Popconfirm
                title={t('Delete this class?')}
                description={row.learners ? t('Remove the learners first.') : t('This cannot be undone.')}
                okText={t('Delete')}
                okButtonProps={{ danger: true, disabled: row.learners > 0 }}
                onConfirm={() => remove(row)}
            >
                <Tooltip title={t('Delete class')}><Button danger icon={<DeleteOutlined />} aria-label={t('Delete class')} /></Tooltip>
            </Popconfirm>
        </Space>
    )

    const columns: TableProps<ClassRow>['columns'] = [
        {
            title: t('Class'),
            dataIndex: 'courseTitle',
            render: (value: string, row) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{value}</Typography.Text>
                    <Typography.Text type="secondary">{classLocationLabel(row, t)}</Typography.Text>
                </Space>
            ),
        },
        {
            title: t('Dates'),
            key: 'dates',
            render: (_, row) => (
                <Space orientation="vertical" size={0}>
                    <span>{classDatesLabel(row)}</span>
                    <Typography.Text type="secondary">{[row.dayCount === 1 ? t('1 day') : t('{count} days', undefined, { count: row.dayCount }), classHoursLabel(row, t)].filter(Boolean).join(' · ')}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Learners'), dataIndex: 'learners', align: 'center' },
        { title: t('Organisations'), dataIndex: 'organisations', align: 'center' },
        { title: t('Status'), dataIndex: 'phase', render: (phase: TrainingClassPhase, row) => <PhaseTag phase={phase} trainingClass={row} /> },
        { title: '', key: 'actions', align: 'right', render: (_, row) => actions(row) },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!classes} icon={<CalendarOutlined />} label={t('Classes')} value={rows.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!classes} icon={<CalendarOutlined />} label={t('Upcoming or ongoing')} mobileTitle={t('Upcoming')} value={upcoming} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!classes} icon={<TeamOutlined />} label={t('Learners')} value={learners.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!classes} icon={<BankOutlined />} label={t('Client organisations')} mobileTitle={t('Organisations')} value={organisations} /></Col>
            </Row>

            <FilterBar
                compact
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search course or venue')} allowClear />
                        <Select
                            value={phaseFilter}
                            onChange={setPhaseFilter}
                            options={[
                                { value: 'all', label: t('All classes') },
                                { value: 'upcoming', label: t('Upcoming') },
                                { value: 'running', label: t('Ongoing') },
                                { value: 'finished', label: t('Finished') },
                            ]}
                        />
                    </>
                )}
                actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>{t('New class')}</Button>}
            />

            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={!classes}
                onRowClick={(row) => navigate(`/training/classes/${row.id}`)}
                emptyText={failed
                    ? t('Training classes could not be loaded. Refresh the page to try again.')
                    : rows.length ? t('No classes match these filters.') : t('No classes yet. Create the first class to add learners.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{row.courseTitle}</Typography.Text>
                            <PhaseTag phase={row.phase} trainingClass={row} />
                        </Space>
                        <Typography.Text type="secondary">{[classDatesLabel(row), classHoursLabel(row, t), classLocationLabel(row, t)].filter(Boolean).join(' · ')}</Typography.Text>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text>{t('{learners} learners from {organisations} organisations', undefined, { learners: row.learners, organisations: row.organisations })}</Typography.Text>
                            {actions(row)}
                        </Space>
                    </Space>
                )}
            />

            <TrainingClassFormModal
                open={editing !== null}
                trainingClass={editing && editing !== 'new' ? editing : undefined}
                template={classes?.[0]}
                assessments={assessments}
                onCancel={() => setEditing(null)}
                onSaved={(classId) => {
                    const wasNew = editing === 'new'
                    setEditing(null)
                    if (wasNew) navigate(`/training/classes/${classId}`)
                    else void load()
                }}
            />
        </DashboardPage>
    )
}
