import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button, Card, Empty, Grid, Skeleton, Space, Table, Tag, Typography, theme } from 'antd'
import {
    CalendarOutlined,
    EnvironmentOutlined,
    ExclamationCircleOutlined,
    PhoneOutlined,
    ScheduleOutlined,
    VideoCameraOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs, { type Dayjs } from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'
import { subscribeOperationsTasks, type OperationsTask, type OperationsTaskPriority } from '@/services/operationsTasksService'
import {
    statusColor as appointmentStatusColor,
    statusLabel as appointmentStatusLabel,
    toDayjs,
    type AppointmentStatus,
    type MeetingType,
} from '@/components/interventions/appointmentSchedule'

const { Text } = Typography
const { useBreakpoint } = Grid

export type InterventionDueItem = {
    id: string
    title: string
    participantName: string
    owner: string
    dueDate: Dayjs
}

type Props = {
    /** Interventions not yet completed, keyed by their actual due date. Computed by the dashboard from the same data as the risk register, so it's passed in rather than re-derived here. */
    interventionDueItems: InterventionDueItem[]
    loading?: boolean
    onViewSchedule?: () => void
}

type AppointmentRow = {
    id: string
    companyCode?: string | null
    programId?: string | null
    interventionTitle?: string | null
    participantName?: string | null
    meetingType?: MeetingType
    status?: AppointmentStatus
    startTime?: unknown
    endTime?: unknown
}

type AgendaKind = 'appointment' | 'task' | 'intervention'

type AgendaItem = {
    id: string
    kind: AgendaKind
    day: string
    sortAt: number
    title: string
    subtitle: string
    timeLabel: string
    tagLabel: string
    tagColor: string
    icon: ReactNode
    accent: string
    onClick: () => void
}

const KIND_LABEL: Record<AgendaKind, string> = {
    appointment: 'Appointment',
    task: 'Task',
    intervention: 'Intervention',
}

const TASK_PRIORITY_META: Record<OperationsTaskPriority, { label: string; color: string }> = {
    low: { label: 'Low priority', color: 'green' },
    medium: { label: 'Medium priority', color: 'blue' },
    high: { label: 'High priority', color: 'orange' },
    urgent: { label: 'Urgent', color: 'red' },
}

const meetingIcon = (value?: MeetingType) => {
    if (value === 'online') return <VideoCameraOutlined />
    if (value === 'in_person') return <EnvironmentOutlined />
    return <PhoneOutlined />
}

/**
 * Operations' "what needs my attention this week" card: appointments, task deadlines, and
 * intervention due dates, each bucketed onto the day they actually fall on. Interventions whose
 * due date falls outside the visible week (including ones overdue from an earlier week) simply
 * don't have a matching day tile, so they drop off the calendar on their own.
 */
export const UpcomingWeekCard = ({ interventionDueItems, loading: interventionsLoading = false, onViewSchedule }: Props) => {
    const { token } = theme.useToken()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const [appointments, setAppointments] = useState<AppointmentRow[]>([])
    const [appointmentsLoading, setAppointmentsLoading] = useState(true)
    const [tasks, setTasks] = useState<OperationsTask[]>([])
    const [tasksLoading, setTasksLoading] = useState(true)
    const [selectedDate, setSelectedDate] = useState<Dayjs>(() => dayjs().startOf('day'))
    const autoSelectedRef = useRef(false)

    const weekDays = useMemo(() => {
        const today = dayjs().startOf('day')
        const daysSinceMonday = (today.day() + 6) % 7
        const monday = today.subtract(daysSinceMonday, 'day')
        return Array.from({ length: 5 }, (_, index) => monday.add(index, 'day'))
    }, [])

    useEffect(() => {
        if (!user?.companyCode) { setAppointments([]); setAppointmentsLoading(false); return }
        let active = true
        setAppointmentsLoading(true)
        void getDocs(query(collection(db, 'appointments'), where('companyCode', '==', user.companyCode)))
            .then((snapshot) => {
                if (!active) return
                setAppointments(snapshot.docs.map((row) => ({ id: row.id, ...(row.data() as Omit<AppointmentRow, 'id'>) })))
            })
            .catch(() => { if (active) setAppointments([]) })
            .finally(() => { if (active) setAppointmentsLoading(false) })
        return () => { active = false }
    }, [user?.companyCode])

    useEffect(() => {
        if (!user?.companyCode) { setTasks([]); setTasksLoading(false); return }
        setTasksLoading(true)
        // Roles without task access (e.g. director) just see the agenda without tasks.
        try {
            return subscribeOperationsTasks(user, (rows) => { setTasks(rows); setTasksLoading(false) }, () => { setTasks([]); setTasksLoading(false) })
        } catch {
            setTasks([])
            setTasksLoading(false)
        }
    }, [user])

    const loading = interventionsLoading || appointmentsLoading || tasksLoading

    const agendaItems = useMemo<AgendaItem[]>(() => {
        const items: AgendaItem[] = []

        appointments
            .filter((row) => matchesActiveProgram(user, activeProgramId, row.programId))
            .forEach((row) => {
                const start = toDayjs(row.startTime)
                if (!start?.isValid()) return
                const end = toDayjs(row.endTime)
                const status = row.status || 'pending'

                items.push({
                    id: `appointment-${row.id}`,
                    kind: 'appointment',
                    day: start.format('YYYY-MM-DD'),
                    sortAt: start.valueOf(),
                    title: row.interventionTitle || 'Appointment',
                    subtitle: row.participantName || 'Participant',
                    timeLabel: end?.isValid() && end.isAfter(start) ? `${start.format('HH:mm')} – ${end.format('HH:mm')}` : start.format('HH:mm'),
                    tagLabel: appointmentStatusLabel(status),
                    tagColor: appointmentStatusColor(status),
                    icon: meetingIcon(row.meetingType),
                    accent: token.colorPrimary,
                    onClick: () => (onViewSchedule ? onViewSchedule() : navigate('/operations/interventions/appointments')),
                })
            })

        tasks
            .filter((task) => task.status !== 'done' && task.status !== 'cancelled')
            .filter((task) => matchesActiveProgram(user, activeProgramId, task.programId))
            .forEach((task) => {
                const due = toDayjs(task.dueAt)
                if (!due?.isValid()) return
                const priorityMeta = TASK_PRIORITY_META[task.priority]

                items.push({
                    id: `task-${task.id}`,
                    kind: 'task',
                    day: due.format('YYYY-MM-DD'),
                    sortAt: due.valueOf(),
                    title: task.title,
                    subtitle: task.description || 'Operations task',
                    timeLabel: `Due ${due.format('HH:mm')}`,
                    tagLabel: priorityMeta.label,
                    tagColor: priorityMeta.color,
                    icon: <ScheduleOutlined />,
                    accent: token.colorWarning,
                    onClick: () => navigate('/operations/tasks'),
                })
            })

        const today = dayjs().startOf('day')
        interventionDueItems.forEach((item) => {
            const dueDate = item.dueDate.startOf('day')
            const daysUntil = dueDate.diff(today, 'day')
            const isOverdue = daysUntil < 0
            const isDueToday = daysUntil === 0

            items.push({
                id: `intervention-${item.id}`,
                kind: 'intervention',
                day: dueDate.format('YYYY-MM-DD'),
                sortAt: dueDate.valueOf(),
                title: item.title,
                subtitle: item.participantName,
                timeLabel: isOverdue
                    ? `${Math.abs(daysUntil)} day${Math.abs(daysUntil) === 1 ? '' : 's'} overdue`
                    : isDueToday
                        ? 'Due today'
                        : `Due in ${daysUntil}d`,
                tagLabel: isOverdue ? 'Overdue' : isDueToday ? 'Due today' : 'Due',
                tagColor: isOverdue ? 'red' : isDueToday ? 'gold' : 'blue',
                icon: <ExclamationCircleOutlined />,
                accent: isOverdue ? token.colorError : token.colorWarning,
                onClick: () => navigate('/operations/interventions/assigned'),
            })
        })

        return items
    }, [activeProgramId, appointments, interventionDueItems, navigate, onViewSchedule, tasks, token, user])

    const itemsByDay = useMemo(() => {
        const map = new Map<string, AgendaItem[]>()
        agendaItems.forEach((item) => {
            const bucket = map.get(item.day) || []
            bucket.push(item)
            map.set(item.day, bucket)
        })
        map.forEach((bucket) => bucket.sort((a, b) => a.sortAt - b.sortAt))
        return map
    }, [agendaItems])

    useEffect(() => {
        if (loading || autoSelectedRef.current) return
        autoSelectedRef.current = true

        const today = dayjs().startOf('day')
        const todayInWindow = weekDays.some((day) => day.isSame(today, 'day'))
        if (todayInWindow && (itemsByDay.get(today.format('YYYY-MM-DD'))?.length || 0) > 0) {
            setSelectedDate(today)
            return
        }

        const firstWithItems = weekDays.find((day) => (itemsByDay.get(day.format('YYYY-MM-DD'))?.length || 0) > 0)
        setSelectedDate(firstWithItems || (todayInWindow ? today : weekDays[0]))
    }, [itemsByDay, loading, weekDays])

    const selectedItems = useMemo(
        () => itemsByDay.get(selectedDate.format('YYYY-MM-DD')) || [],
        [itemsByDay, selectedDate],
    )

    const dayStrip = (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${weekDays.length}, minmax(0, 1fr))`,
                gap: isMobile ? 6 : 9,
                width: '100%',
                padding: '2px 0 6px',
            }}
        >
            {weekDays.map((day) => {
                const key = day.format('YYYY-MM-DD')
                const dayItems = itemsByDay.get(key) || []
                const count = dayItems.length
                const hasOverdue = dayItems.some((item) => item.kind === 'intervention' && item.tagColor === 'red')
                const selected = day.isSame(selectedDate, 'day')
                const today = day.isSame(dayjs(), 'day')

                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => setSelectedDate(day)}
                        aria-label={`${day.format('dddd D MMMM')}, ${count} item${count === 1 ? '' : 's'}`}
                        style={{
                            position: 'relative',
                            width: '100%',
                            minWidth: 0,
                            height: count > 0 ? 72 : 60,
                            borderRadius: 13,
                            border: selected ? `1px solid ${token.colorPrimary}` : `1px solid ${token.colorBorderSecondary}`,
                            background: selected ? token.colorPrimary : token.colorBgContainer,
                            color: selected ? token.colorTextLightSolid : token.colorText,
                            boxShadow: selected ? `0 8px 20px ${token.colorPrimaryBgHover}` : '0 4px 12px rgba(0,0,0,.05)',
                            cursor: 'pointer',
                            transition: 'height .18s ease, transform .18s ease, box-shadow .18s ease, border-color .18s ease',
                            transform: selected ? 'translateY(-1px)' : 'translateY(0)',
                            padding: '7px 4px 8px',
                        }}
                    >
                        <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.1 }}>{day.format('D')}</div>
                        <div style={{ marginTop: 3, fontSize: 10, opacity: selected ? 0.85 : 0.62, lineHeight: 1.1 }}>{day.format('ddd')}</div>

                        {today && !selected && (
                            <div
                                style={{
                                    position: 'absolute',
                                    top: 5,
                                    right: 5,
                                    width: 5,
                                    height: 5,
                                    borderRadius: 999,
                                    background: token.colorPrimary,
                                }}
                            />
                        )}

                        {count > 0 && (
                            <div style={{ position: 'absolute', bottom: 7, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span
                                    style={{
                                        width: 6,
                                        height: 6,
                                        borderRadius: 999,
                                        background: hasOverdue ? token.colorError : selected ? token.colorTextLightSolid : token.colorPrimary,
                                    }}
                                />
                                <span style={{ fontSize: 9, fontWeight: 700, opacity: selected ? 0.9 : 0.7 }}>{count}</span>
                            </div>
                        )}
                    </button>
                )
            })}
        </div>
    )

    return (
        <Card
            style={{
                width: '100%',
                maxWidth: '100%',
                minWidth: 0,
                overflow: 'hidden',
                borderRadius: 14,
                border: `1px solid ${token.colorBorderSecondary}`,
                boxShadow: '0 10px 30px rgba(0,0,0,.08)',
            }}
            styles={{
                header: { minHeight: 54, paddingInline: isMobile ? 14 : 18 },
                body: { padding: isMobile ? 14 : 18 },
            }}
            title={(
                <Space size={8}>
                    <CalendarOutlined />
                    <span>Upcoming Week</span>
                </Space>
            )}
            extra={onViewSchedule || navigate ? (
                <Button size="small" onClick={() => (onViewSchedule ? onViewSchedule() : navigate('/operations/interventions/appointments'))}>
                    View schedule
                </Button>
            ) : null}
        >
            {loading ? (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weekDays.length}, minmax(0, 1fr))`, gap: isMobile ? 6 : 9, width: '100%', padding: '2px 0 6px' }}>
                        {weekDays.map((day) => (
                            <Skeleton.Button key={day.format('YYYY-MM-DD')} active block style={{ width: '100%', minWidth: 0, height: 60, borderRadius: 13 }} />
                        ))}
                    </div>
                    <Skeleton active title={false} paragraph={{ rows: 4, width: ['100%', '100%', '100%', '75%'] }} />
                </Space>
            ) : (
                <>
                    {dayStrip}

                    <div style={{ marginTop: 14, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 10 }}>
                        {selectedItems.length === 0 ? (
                            <Empty
                                image={Empty.PRESENTED_IMAGE_SIMPLE}
                                description={`Nothing on ${selectedDate.format('dddd, D MMMM')}.`}
                                style={{ marginBlock: 22 }}
                            />
                        ) : (
                            <Table<AgendaItem>
                                rowKey="id"
                                size="small"
                                dataSource={selectedItems}
                                showHeader={!isMobile}
                                pagination={false}
                                tableLayout="fixed"
                                onRow={(row) => ({ onClick: row.onClick, style: { cursor: 'pointer' } })}
                                columns={[
                                    {
                                        title: 'Item',
                                        key: 'item',
                                        render: (_, row) => (
                                            <div style={{ display: 'grid', gridTemplateColumns: '3px minmax(0, 1fr)', gap: 10, alignItems: 'stretch', paddingBlock: 5 }}>
                                                <div style={{ width: 3, minHeight: 46, borderRadius: 999, background: row.accent }} />

                                                <div style={{ minWidth: 0 }}>
                                                    <Space size={[6, 4]} wrap style={{ marginBottom: 3 }}>
                                                        <Text strong ellipsis={{ tooltip: row.title }} style={{ display: 'inline-block', maxWidth: isMobile ? 180 : 300, verticalAlign: 'middle' }}>
                                                            {row.title}
                                                        </Text>

                                                        <Tag icon={row.icon} style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                                                            {KIND_LABEL[row.kind]}
                                                        </Tag>
                                                    </Space>

                                                    <Text type="secondary" ellipsis={{ tooltip: row.subtitle }} style={{ display: 'block', fontSize: 12, maxWidth: '100%' }}>
                                                        {row.subtitle}
                                                    </Text>
                                                </div>
                                            </div>
                                        ),
                                    },
                                    {
                                        title: 'When',
                                        key: 'time',
                                        width: isMobile ? 92 : 120,
                                        align: 'right' as const,
                                        render: (_, row) => (
                                            <Text type="secondary" style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                                                {row.timeLabel}
                                            </Text>
                                        ),
                                    },
                                    ...(!isMobile ? [{
                                        title: 'Status',
                                        key: 'status',
                                        width: 150,
                                        align: 'right' as const,
                                        render: (_: unknown, row: AgendaItem) => (
                                            <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-end' }}>
                                                <Tag color={row.tagColor} style={{ marginInlineEnd: 0 }}>{row.tagLabel}</Tag>
                                            </div>
                                        ),
                                    }] : []),
                                ]}
                            />
                        )}
                    </div>
                </>
            )}
        </Card>
    )
}

export default UpcomingWeekCard
