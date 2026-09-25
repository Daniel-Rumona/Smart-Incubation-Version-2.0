import { useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Input, Popconfirm, Row, Segmented, Select, Table, Tag, Tooltip } from 'antd'
import { AppstoreOutlined, BookOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReadOutlined, SearchOutlined, SendOutlined, TableOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { deleteCourseTemplate, listCourseTemplates, type CourseTemplate } from '@/services/courseTemplatesService'
import { listCourseProgressSummaries, type CourseProgressSummary } from '@/services/courseProgressService'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import '@/styles/survey-builder.css'
import '@/styles/course-lesson.css'
import { useLanguage } from '@/providers/LanguageProvider'

type ViewKey = 'courses' | 'progress'

export default function LmsPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    const [courses, setCourses] = useState<CourseTemplate[]>()
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    const [summaries, setSummaries] = useState<Record<string, CourseProgressSummary>>()
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [mainView, setMainView] = useState<ViewKey>('courses')

    const load = async () => {
        try {
            setCourses(await listCourseTemplates())
        } catch {
            message.error(t('Courses could not be loaded.'))
            setCourses([])
        }
    }

    const loadSummaries = async () => {
        try {
            setSummaries(await listCourseProgressSummaries())
        } catch {
            setSummaries({})
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => {
            void load()
            void loadSummaries()
            if (user) void listWorkspacePrograms(user).then(setPrograms).catch(() => setPrograms([]))
        }, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const rows = courses || []
    const published = rows.filter((row) => row.status === 'published').length
    const drafts = rows.length - published

    const summaryOf = (courseId?: string): CourseProgressSummary => (courseId && summaries?.[courseId]) || { assigned: 0, completed: 0 }
    const totalAssigned = useMemo(() => rows.reduce((sum, row) => sum + summaryOf(row.id).assigned, 0), [rows, summaries]) // eslint-disable-line react-hooks/exhaustive-deps
    const totalCompleted = useMemo(() => rows.reduce((sum, row) => sum + summaryOf(row.id).completed, 0), [rows, summaries]) // eslint-disable-line react-hooks/exhaustive-deps
    const completionRate = totalAssigned ? Math.round((totalCompleted / totalAssigned) * 100) : 0

    const programName = (programId?: string) => programs.find((program) => program.id === programId)?.name || 'Not scoped'

    const visible = useMemo(() => rows.filter((row) => {
        if (mainView === 'courses' && statusFilter !== 'all' && row.status !== statusFilter) return false
        if (!search.trim()) return true
        const term = search.trim().toLowerCase()
        return `${row.title} ${row.category} ${programName(row.programId)}`.toLowerCase().includes(term)
    }), [rows, statusFilter, search, programs, mainView]) // eslint-disable-line react-hooks/exhaustive-deps

    const remove = async (courseId?: string) => {
        if (!courseId) return
        try {
            await deleteCourseTemplate(courseId)
            message.success(t('Course deleted.'))
            await load()
        } catch {
            message.error(t('The course could not be deleted.'))
        }
    }

    return (
        <DashboardPage className="operations-surveys-page operations-lms-page">
            <Row gutter={[8, 8]} className="dashboard-metrics-row">
                {mainView === 'courses' ? (
                    <>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!courses} icon={<ReadOutlined />} label={t('Courses')} value={rows.length} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!courses} icon={<SendOutlined />} label={t('Published')} value={published} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!courses} icon={<EditOutlined />} label={t('Drafts')} value={drafts} />
                        </Col>
                    </>
                ) : (
                    <>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!summaries} icon={<SendOutlined />} label={t('Assigned')} value={totalAssigned} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!summaries} icon={<BookOutlined />} label={t('Completed')} value={totalCompleted} />
                        </Col>
                        <Col xs={12} lg={8}>
                            <DashboardMetricCard loading={!summaries} icon={<TableOutlined />} label={t('Completion rate')} value={`${completionRate}%`} />
                        </Col>
                    </>
                )}
            </Row>

            <FilterBar
                compact
                primary={
                    <>
                        <Input
                            prefix={<SearchOutlined />}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={t('Search title, category or programme')}
                            allowClear
                        />

                        {mainView === 'courses' && (
                            <Select
                                value={statusFilter}
                                onChange={setStatusFilter}
                                options={[
                                    { value: 'all', label: t('All statuses') },
                                    { value: 'published', label: t('Published') },
                                    { value: 'draft', label: t('Draft') },
                                ]}
                            />
                        )}
                    </>
                }
                actions={
                    <>
                        <Segmented
                            block
                            value={mainView}
                            onChange={(value) => setMainView(value as ViewKey)}
                            options={[
                                { label: t('Courses'), value: 'courses', icon: <TableOutlined /> },
                                { label: t('Progress'), value: 'progress', icon: <AppstoreOutlined /> },
                            ]}
                        />

                        {mainView === 'courses' && (
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/operations/lms/builder')}>{t('New course')}</Button>
                        )}
                    </>
                }
            />

            <MotionCard
                loading={!courses}
                className="survey-list-panel"
                title={mainView === 'courses' ? t('Courses') : t('Course progress')}
                extra={<span className="survey-list-count">{`${visible.length} of ${rows.length}`}</span>}
            >
                {mainView === 'courses' ? (
                    <Table
                        size="small"
                        rowKey={(row) => row.id || row.title}
                        dataSource={visible}
                        pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                        scroll={{ x: 760 }}
                        onRow={(row) => ({ onDoubleClick: () => navigate(`/operations/lms/builder/${row.id}`) })}
                        columns={[
                            { title: t('Course'), dataIndex: 'title', render: (value: string) => <strong>{value || t('Untitled course')}</strong> },
                            { title: t('Category'), dataIndex: 'category', width: 150 },
                            { title: t('Programme'), dataIndex: 'programId', width: 180, render: (value?: string) => programName(value) },
                            { title: t('Lessons'), dataIndex: 'lessons', width: 90, render: (lessons: CourseTemplate['lessons']) => lessons?.length || 0 },
                            {
                                title: t('Status'),
                                dataIndex: 'status',
                                width: 110,
                                render: (value: string) => <Tag color={value === 'published' ? 'green' : 'default'}>{value === 'published' ? t('Published') : t('Draft')}</Tag>,
                            },
                            {
                                title: t('Updated'),
                                dataIndex: 'updatedAt',
                                width: 130,
                                render: (value?: string) => (value ? dayjs(value).format('DD MMM YYYY') : '—'),
                            },
                            {
                                title: t('Actions'),
                                width: 90,
                                render: (_, row) => (
                                    <div className="lms-row-actions">
                                        <Tooltip title={t('Edit course')}>
                                            <Button shape="circle" size="small" icon={<EditOutlined />} aria-label={t('Edit course')} onClick={() => navigate(`/operations/lms/builder/${row.id}`)} />
                                        </Tooltip>
                                        <Popconfirm title={t('Delete this course?')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => void remove(row.id)}>
                                            <Tooltip title={t('Delete course')}>
                                                <Button shape="circle" size="small" danger icon={<DeleteOutlined />} aria-label={t('Delete course')} />
                                            </Tooltip>
                                        </Popconfirm>
                                    </div>
                                ),
                            },
                        ]}
                    />
                ) : (
                    <Table
                        size="small"
                        rowKey={(row) => row.id || row.title}
                        loading={!summaries}
                        dataSource={visible}
                        pagination={{ pageSize: 8, size: 'small', hideOnSinglePage: true }}
                        scroll={{ x: 760 }}
                        columns={[
                            { title: t('Course'), dataIndex: 'title', render: (value: string) => <strong>{value || t('Untitled course')}</strong> },
                            { title: t('Programme'), dataIndex: 'programId', width: 180, render: (value?: string) => programName(value) },
                            { title: t('Assigned'), width: 100, align: 'center', render: (_, row) => summaryOf(row.id).assigned },
                            { title: t('Completed'), width: 110, align: 'center', render: (_, row) => summaryOf(row.id).completed },
                            {
                                title: t('Completion'),
                                width: 130,
                                render: (_, row) => {
                                    const { assigned, completed } = summaryOf(row.id)
                                    const rate = assigned ? Math.round((completed / assigned) * 100) : 0
                                    return <Tag color={assigned && completed >= assigned ? 'green' : assigned ? 'orange' : 'default'}>{assigned ? `${rate}%` : t('Not assigned')}</Tag>
                                },
                            },
                        ]}
                    />
                )}
            </MotionCard>
        </DashboardPage>
    )
}
