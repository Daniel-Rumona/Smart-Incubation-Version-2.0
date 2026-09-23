import { useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Empty, Row, Select, Tag } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, ReadOutlined, RightOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { FilterBar } from '@/components/shared/FilterBar'
import { MotionCard } from '@/components/shared/MotionCard'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { listCoursesForParticipant, type CourseToTake } from '@/services/courseProgressService'
import '@/styles/survey-response.css'

const STATUS_TONE: Record<CourseToTake['status'], string> = {
    'not started': 'gold',
    'in progress': 'blue',
    completed: 'green',
}

export default function IncubateeCoursesPage() {
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()

    const [courses, setCourses] = useState<CourseToTake[]>()
    const [statusFilter, setStatusFilter] = useState('open')

    useEffect(() => {
        if (!user) return
        const timeout = window.setTimeout(() => {
            void listCoursesForParticipant(user)
                .then(setCourses)
                .catch(() => {
                    message.error('Your courses could not be loaded.')
                    setCourses([])
                })
        }, 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => courses || [], [courses])
    // One count per status, so the three add up to the list rather than overlapping.
    const notStarted = rows.filter((row) => row.status === 'not started').length
    const inProgress = rows.filter((row) => row.status === 'in progress').length
    const completed = rows.filter((row) => row.status === 'completed').length

    const visible = useMemo(() => rows.filter((row) => {
        if (statusFilter === 'all') return true
        if (statusFilter === 'open') return row.status !== 'completed'
        return row.status === statusFilter
    }), [rows, statusFilter])

    return (
        <DashboardPage className="incubatee-page incubatee-surveys-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={8}>
                    <DashboardMetricCard loading={!courses} icon={<ReadOutlined />} label="Not started" value={notStarted} />
                </Col>
                <Col xs={12} lg={8}>
                    <DashboardMetricCard loading={!courses} icon={<ClockCircleOutlined />} label="In progress" value={inProgress} />
                </Col>
                <Col xs={12} lg={8}>
                    <DashboardMetricCard loading={!courses} icon={<CheckCircleOutlined />} label="Completed" value={completed} />
                </Col>
            </Row>

            <FilterBar
                compact
                primary={
                    <Select
                        value={statusFilter}
                        onChange={setStatusFilter}
                        options={[
                            { value: 'open', label: 'Still to do' },
                            { value: 'in progress', label: 'Started' },
                            { value: 'completed', label: 'Completed' },
                            { value: 'all', label: 'All courses' },
                        ]}
                    />
                }
            />

            <MotionCard loading={!courses} className="survey-answer-panel" title="Your courses">
                {visible.length ? (
                    <ul className="survey-answer-list">
                        {visible.map((row) => (
                            <li className="survey-answer-row" key={row.courseId}>
                                <span className={`survey-answer-icon is-${row.status === 'completed' ? 'submitted' : row.status.replace(' ', '-')}`}>
                                    {row.status === 'completed' ? <CheckCircleOutlined /> : <ReadOutlined />}
                                </span>

                                <span className="survey-answer-copy">
                                    <strong>{row.title}</strong>
                                    <span>
                                        {[
                                            row.category,
                                            `${row.lessonCount} lesson${row.lessonCount === 1 ? '' : 's'}`,
                                            row.completedAt ? `Completed ${dayjs(row.completedAt).format('DD MMM')}` : row.updatedAt ? `Saved ${dayjs(row.updatedAt).format('DD MMM')}` : '',
                                        ].filter(Boolean).join(' · ')}
                                    </span>
                                </span>

                                <Tag color={STATUS_TONE[row.status]} className="survey-answer-status">
                                    {row.status === 'not started' ? 'Not started' : row.status === 'in progress' ? 'In progress' : 'Completed'}
                                </Tag>

                                <Button
                                    type={row.status === 'completed' ? 'default' : 'primary'}
                                    size="small"
                                    icon={<RightOutlined />}
                                    iconPosition="end"
                                    onClick={() => navigate(`/incubatee/lms/${row.courseId}`)}
                                >
                                    {row.status === 'not started' ? 'Start' : row.status === 'in progress' ? 'Continue' : 'Review'}
                                </Button>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing to take right now." />
                )}
            </MotionCard>
        </DashboardPage>
    )
}
