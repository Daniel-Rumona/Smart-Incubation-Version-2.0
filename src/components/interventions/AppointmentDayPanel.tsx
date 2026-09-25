import { Badge, Button, Empty, Segmented, Typography } from 'antd'
import { EnvironmentOutlined, PhoneOutlined, PlusOutlined, VideoCameraOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useMemo, useState } from 'react'
import {
    formatSpan,
    periodOf,
    toDayjs,
    STATUS_SHORT_LABEL,
    type AppointmentStatus,
    type CalendarAppointment,
    type MeetingType,
} from './appointmentSchedule'
import { useLanguage } from '@/providers/LanguageProvider'

/** Above this many appointments the day needs filtering rather than just scrolling. */
const FILTER_THRESHOLD = 5
const PERIOD_ORDER = ['Morning', 'Afternoon', 'Evening'] as const

const meetingTypeIcon = (value?: MeetingType) => {
    if (value === 'online') return <VideoCameraOutlined />
    if (value === 'in_person') return <EnvironmentOutlined />
    return <PhoneOutlined />
}

type AppointmentDayPanelProps<T extends CalendarAppointment> = {
    date: Dayjs
    appointments: T[]
    selected?: T
    onSelect: (appointment: T) => void
    onCreate: () => void
}

/**
 * The always-present right rail. It carries the full list for the selected day — no matter how long —
 * so the calendar grids never have to be the only route to an appointment, and the page layout stays
 * fixed instead of shifting when a busy day is opened.
 */
export function AppointmentDayPanel<T extends CalendarAppointment>({
    date, appointments, selected, onSelect, onCreate,
}: AppointmentDayPanelProps<T>) {
    const { t } = useLanguage()
    const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'all'>('all')

    const counts = useMemo(() => appointments.reduce((totals, appointment) => {
        totals[appointment.status] = (totals[appointment.status] ?? 0) + 1
        return totals
    }, {} as Partial<Record<AppointmentStatus, number>>), [appointments])

    const filtered = useMemo(
        () => (statusFilter === 'all' ? appointments : appointments.filter((appointment) => appointment.status === statusFilter)),
        [appointments, statusFilter],
    )

    // Long days read far better broken into parts of the day than as one flat scroll.
    const groups = useMemo(() => PERIOD_ORDER
        .map((period) => ({ period, rows: filtered.filter((row) => { const start = toDayjs(row.startTime); return start ? periodOf(start) === period : false }) }))
        .filter((group) => group.rows.length > 0), [filtered])

    const showFilters = appointments.length > FILTER_THRESHOLD
    const filterOptions = useMemo(() => ([
        { value: 'all' as const, label: `All ${appointments.length}` },
        ...(['pending', 'accepted', 'completed'] as const)
            .filter((status) => counts[status])
            .map((status) => ({ value: status, label: `${STATUS_SHORT_LABEL[status]} ${counts[status]}` })),
    ]), [appointments.length, counts])

    return (
        <aside className="apt-panel">
            <header className="apt-panel-head">
                <div>
                    <Typography.Text type="secondary">{date.isSame(dayjs(), 'day') ? t('Today') : date.format('dddd')}</Typography.Text>
                    <Typography.Title level={4}>{date.format('DD MMMM YYYY')}</Typography.Title>
                </div>
                <Badge count={appointments.length} showZero color="#6d5dfb" overflowCount={99} />
            </header>

            {showFilters && (
                <Segmented
                    className="apt-panel-filter"
                    size="small"
                    block
                    value={statusFilter}
                    onChange={(value) => setStatusFilter(value as AppointmentStatus | 'all')}
                    options={filterOptions}
                />
            )}

            <div className="apt-panel-list">
                {groups.length === 0 && (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={appointments.length ? t('Nothing matches this filter') : t('No appointments on this day')}
                    >
                        {!appointments.length && <Button size="small" type="primary" icon={<PlusOutlined />} onClick={onCreate}>{t('Schedule one')}</Button>}
                    </Empty>
                )}
                {groups.map(({ period, rows }) => (
                    <section className="apt-panel-group" key={period}>
                        <h4 className="apt-panel-group-title">{period}<span>{rows.length}</span></h4>
                        {rows.map((row) => (
                            <button
                                type="button"
                                key={row.id}
                                className={`apt-panel-item is-${row.status}${selected?.id === row.id ? ' is-selected' : ''}`}
                                onClick={() => onSelect(row)}
                            >
                                <span className="apt-panel-item-rail" />
                                <span className="apt-panel-item-body">
                                    <span className="apt-panel-item-top">
                                        <strong>{formatSpan(row)}</strong>
                                        <span className="apt-panel-item-type">{meetingTypeIcon(row.meetingType)}</span>
                                    </span>
                                    <span className="apt-panel-item-title">{row.interventionTitle}</span>
                                    <small>{row.participantName || row.participantEmail || t('SME')}</small>
                                </span>
                            </button>
                        ))}
                    </section>
                ))}
            </div>

        </aside>
    )
}

export default AppointmentDayPanel
