import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Input, Popconfirm, Row, Space, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { DeleteOutlined, EditOutlined, FileDoneOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { AssessmentEditorDrawer } from '@/components/training/AssessmentEditorDrawer'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { deleteTrainingAssessment, listTrainingAssessments } from '@/services/trainingAssessmentService'
import { listTrainingClasses } from '@/services/trainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { totalMarksOf } from '@/utils/trainingResults'
import type { TrainingAssessment, TrainingClass } from '@/types/training'

type AssessmentRow = TrainingAssessment & { totalMarks: number, rubricTotal: number, classes: number }

export default function TrainingAssessmentsPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [assessments, setAssessments] = useState<TrainingAssessment[]>()
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [failed, setFailed] = useState(false)
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<TrainingAssessment | 'new' | null>(null)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [assessmentRows, classRows] = await Promise.all([listTrainingAssessments(user), listTrainingClasses(user)])
            setAssessments(assessmentRows)
            setClasses(classRows)
            setFailed(false)
        } catch {
            setFailed(true)
            setAssessments([])
            message.error(t('Assessments could not be loaded.'))
        }
    }, [message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const rows = useMemo<AssessmentRow[]>(() => (assessments || []).map((assessment) => ({
        ...assessment,
        totalMarks: totalMarksOf(assessment.questions),
        rubricTotal: assessment.rubric.reduce((sum, criterion) => sum + criterion.maxMarks, 0),
        classes: classes.filter((trainingClass) => trainingClass.assessmentId === assessment.id || trainingClass.preAssessmentId === assessment.id).length,
    })), [assessments, classes])

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return rows.filter((row) => !needle || row.title.toLowerCase().includes(needle))
    }, [rows, search])

    useRegisterAgentPageContext({
        pageKey: 'training-assessments',
        pageName: 'Training assessments',
        purpose: 'Set up course assessments: the written knowledge questions with their memo (never shown to learners) and the group case assignment rubric.',
        currentFilters: { search },
        metrics: { assessments: rows.length },
        dataSummary: { assessments: rows.map((row) => ({ title: row.title, questions: row.questions.length, totalMarks: row.totalMarks, rubricTotal: row.rubricTotal, classes: row.classes })) },
        allowedActions: [
            { key: 'create_assessment', label: 'New assessment', description: 'Create an assessment, or import its questions, memo and rubric from a Word document.' },
            { key: 'update_assessment', label: 'Edit assessment', description: 'Change questions, memo answers, the case brief or the rubric.' },
            { key: 'delete_assessment', label: 'Delete assessment', description: 'Delete an assessment no class uses.', requiresConfirmation: true },
        ],
    })

    const remove = async (row: AssessmentRow) => {
        if (!user) return
        try {
            await deleteTrainingAssessment(user, row.id)
            message.success(t('Assessment deleted.'))
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'assessment_in_use'
                ? t('A class uses this assessment. Choose another assessment for that class first.')
                : t('The assessment could not be deleted.'))
        }
    }

    const actions = (row: AssessmentRow) => (
        <Space onClick={(event) => event.stopPropagation()}>
            <Tooltip title={t('Edit assessment')}><Button icon={<EditOutlined />} onClick={() => setEditing(row)} aria-label={t('Edit assessment')} /></Tooltip>
            <Popconfirm
                title={t('Delete this assessment?')}
                description={row.classes ? t('A class uses it, so it cannot be deleted.') : t('Its questions and memo are deleted.')}
                okText={t('Delete')}
                okButtonProps={{ danger: true, disabled: row.classes > 0 }}
                onConfirm={() => remove(row)}
            >
                <Tooltip title={t('Delete assessment')}><Button danger icon={<DeleteOutlined />} aria-label={t('Delete assessment')} /></Tooltip>
            </Popconfirm>
        </Space>
    )

    const columns: TableProps<AssessmentRow>['columns'] = [
        { title: t('Assessment'), dataIndex: 'title', render: (value: string) => <Typography.Text strong>{value}</Typography.Text> },
        { title: t('Used as'), key: 'use', render: (_, row) => <Tag color={row.use === 'pre' ? 'blue' : row.use === 'post' ? 'green' : undefined}>{{ pre: t('Pre-assessment'), post: t('Post-assessment'), both: t('Pre and post') }[row.use]}</Tag> },
        { title: t('Questions'), key: 'questions', align: 'center', render: (_, row) => row.questions.length },
        { title: t('Marks'), dataIndex: 'totalMarks', align: 'center' },
        { title: t('Group rubric'), key: 'rubric', align: 'center', render: (_, row) => row.rubric.length ? t('{count} criteria · {total} marks', undefined, { count: row.rubric.length, total: row.rubricTotal }) : '—' },
        { title: t('Used by'), key: 'classes', align: 'center', render: (_, row) => t('{count} class(es)', undefined, { count: row.classes }) },
        { title: '', key: 'actions', align: 'right', render: (_, row) => actions(row) },
    ]

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={12}><DashboardMetricCard loading={!assessments} icon={<FileDoneOutlined />} label={t('Assessments')} value={rows.length} /></Col>
                <Col xs={12} lg={12}><DashboardMetricCard loading={!assessments} icon={<FileDoneOutlined />} label={t('In use')} value={rows.filter((row) => row.classes > 0).length} /></Col>
            </Row>
            <FilterBar
                compact
                primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search assessments')} allowClear />}
                actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>{t('New assessment')}</Button>}
            />
            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={!assessments}
                onRowClick={(row) => setEditing(row)}
                emptyText={failed
                    ? t('Assessments could not be loaded. Refresh the page to try again.')
                    : rows.length ? t('No assessments match your search.') : t('No assessments yet. Create one, or import the assessment and memo from a Word document.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Typography.Text strong>{row.title}</Typography.Text>
                        <Typography.Text type="secondary">
                            {t('{count} questions · {marks} marks', undefined, { count: row.questions.length, marks: row.totalMarks })}
                            {row.rubric.length ? ` · ${t('rubric out of {total}', undefined, { total: row.rubricTotal })}` : ''}
                        </Typography.Text>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text>{t('{count} class(es)', undefined, { count: row.classes })}</Typography.Text>
                            {actions(row)}
                        </Space>
                    </Space>
                )}
            />
            <AssessmentEditorDrawer
                open={editing !== null}
                assessment={editing && editing !== 'new' ? editing : undefined}
                usedByClasses={editing && editing !== 'new' ? rows.find((row) => row.id === editing.id)?.classes ?? 0 : 0}
                onClose={() => setEditing(null)}
                onSaved={() => {
                    setEditing(null)
                    void load()
                }}
            />
        </DashboardPage>
    )
}
