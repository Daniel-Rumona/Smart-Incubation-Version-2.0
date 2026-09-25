import { Empty, Tooltip } from 'antd'
import { EnvironmentOutlined, PhoneOutlined, VideoCameraOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
    buildClusters,
    dayKey,
    formatSpan,
    groupByDay,
    hourWindow,
    minutesOf,
    toDayjs,
    visibleDays,
    type CalendarAppointment,
    type CalendarView,
    type MeetingType,
} from './appointmentSchedule'
import { useLanguage } from '@/providers/LanguageProvider'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const HOUR_HEIGHT = 56
const MONTH_CHIP_HEIGHT = 22
const MONTH_CELL_CHROME = 46
const MIN_MONTH_CHIPS = 1
const MAX_MONTH_CHIPS = 6

const meetingTypeIcon = (value?: MeetingType) => {
    if (value === 'online') return <VideoCameraOutlined />
    if (value === 'in_person') return <EnvironmentOutlined />
    return <PhoneOutlined />
}

type AppointmentCalendarProps<T extends CalendarAppointment> = {
    appointments: T[]
    view: CalendarView
    anchorDate: Dayjs
    selectedDate: Dayjs
    selectedId?: string
    onSelectDate: (date: Dayjs) => void
    onSelectAppointment: (appointment: T) => void
    /** Fired when a day's overflow affordance is used, so the host can surface the full day list. */
    onExpandDay: (date: Dayjs) => void
}

/**
 * Renders the schedule as a month grid, an overlap-aware day/week time grid, or a grouped agenda.
 * Days that hold more appointments than fit are never truncated silently: every view offers a route
 * into the full list for that day.
 */
export function AppointmentCalendar<T extends CalendarAppointment>({
    appointments,
    view,
    anchorDate,
    selectedDate,
    selectedId,
    onSelectDate,
    onSelectAppointment,
    onExpandDay,
}: AppointmentCalendarProps<T>) {
    const byDay = useMemo(() => groupByDay(appointments), [appointments])
    const days = useMemo(() => visibleDays(view, anchorDate), [view, anchorDate])
    const today = dayjs()

    if (view === 'agenda') {
        return <AgendaView appointments={appointments} selectedId={selectedId} onSelectAppointment={onSelectAppointment} />
    }

    if (view === 'month') {
        return (
            <MonthView
                byDay={byDay}
                days={days}
                anchorDate={anchorDate}
                selectedDate={selectedDate}
                selectedId={selectedId}
                today={today}
                onSelectDate={onSelectDate}
                onSelectAppointment={onSelectAppointment}
                onExpandDay={onExpandDay}
            />
        )
    }

    return (
        <TimeGridView
            byDay={byDay}
            days={days}
            selectedDate={selectedDate}
            selectedId={selectedId}
            today={today}
            maxLanes={view === 'day' ? 4 : 2}
            showDayHeader={view === 'week'}
            onSelectDate={onSelectDate}
            onSelectAppointment={onSelectAppointment}
            onExpandDay={onExpandDay}
        />
    )
}

/* ---------------------------------------------------------------- month --- */

type MonthViewProps<T extends CalendarAppointment> = {
    byDay: Map<string, T[]>
    days: Dayjs[]
    anchorDate: Dayjs
    selectedDate: Dayjs
    selectedId?: string
    today: Dayjs
    onSelectDate: (date: Dayjs) => void
    onSelectAppointment: (appointment: T) => void
    onExpandDay: (date: Dayjs) => void
}

function MonthView<T extends CalendarAppointment>({
    byDay, days, anchorDate, selectedDate, selectedId, today, onSelectDate, onSelectAppointment, onExpandDay,
}: MonthViewProps<T>) {
    const { t } = useLanguage()
    const gridRef = useRef<HTMLDivElement>(null)
    const [chipLimit, setChipLimit] = useState(2)
    const weeks = days.length / 7

    // The number of chips a cell can hold depends on how tall the grid actually is, so it is measured
    // rather than hard-coded: tall screens show more before falling back to the overflow affordance.
    useLayoutEffect(() => {
        const element = gridRef.current
        if (!element) return
        const measure = () => {
            const cellHeight = element.clientHeight / weeks
            const fits = Math.floor((cellHeight - MONTH_CELL_CHROME) / MONTH_CHIP_HEIGHT)
            setChipLimit(Math.max(MIN_MONTH_CHIPS, Math.min(MAX_MONTH_CHIPS, fits)))
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(element)
        return () => observer.disconnect()
    }, [weeks])

    return (
        <div className="apt-month">
            <div className="apt-month-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="apt-month-grid" ref={gridRef} style={{ gridTemplateRows: `repeat(${weeks}, minmax(96px, 1fr))` }}>
                {days.map((day) => {
                    const dayRows = byDay.get(dayKey(day)) ?? []
                    // Keep the overflow chip from replacing the only visible appointment.
                    const visible = dayRows.length > chipLimit ? dayRows.slice(0, Math.max(1, chipLimit - 1)) : dayRows
                    const overflow = dayRows.length - visible.length
                    const outsideMonth = day.month() !== anchorDate.month()
                    const classes = [
                        'apt-month-cell',
                        outsideMonth ? 'is-outside' : '',
                        day.isSame(selectedDate, 'day') ? 'is-selected' : '',
                        day.isSame(today, 'day') ? 'is-today' : '',
                        dayRows.length ? 'has-events' : '',
                    ].filter(Boolean).join(' ')

                    return (
                        <div className={classes} key={day.toString()} onClick={() => onSelectDate(day)}>
                            <div className="apt-month-cell-head">
                                <button type="button" className="apt-month-date" onClick={(event) => { event.stopPropagation(); onSelectDate(day) }}>
                                    {day.date()}
                                </button>
                                {dayRows.length > 0 && <span className="apt-month-count">{dayRows.length}</span>}
                            </div>
                            <div className="apt-month-chips">
                                {visible.map((row) => (
                                    <MonthChip
                                        key={row.id}
                                        appointment={row}
                                        selected={row.id === selectedId}
                                        onSelect={() => { onSelectDate(day); onSelectAppointment(row) }}
                                    />
                                ))}
                                {overflow > 0 && (
                                    <button
                                        type="button"
                                        className="apt-month-more"
                                        onClick={(event) => { event.stopPropagation(); onSelectDate(day); onExpandDay(day) }}
                                    >
                                        +{overflow} {t('more')}
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function MonthChip<T extends CalendarAppointment>({ appointment, selected, onSelect }: { appointment: T; selected: boolean; onSelect: () => void }) {
    const start = toDayjs(appointment.startTime)
    return (
        <Tooltip title={`${formatSpan(appointment)} · ${appointment.interventionTitle}${appointment.participantName ? ` · ${appointment.participantName}` : ''}`} mouseEnterDelay={0.35}>
            <button
                type="button"
                className={`apt-chip is-${appointment.status}${selected ? ' is-selected' : ''}`}
                onClick={(event) => { event.stopPropagation(); onSelect() }}
            >
                <span className="apt-chip-dot" />
                {start && <span className="apt-chip-time">{start.format('HH:mm')}</span>}
                <span className="apt-chip-title">{appointment.interventionTitle}</span>
            </button>
        </Tooltip>
    )
}

/* ------------------------------------------------------------ time grid --- */

type TimeGridViewProps<T extends CalendarAppointment> = {
    byDay: Map<string, T[]>
    days: Dayjs[]
    selectedDate: Dayjs
    selectedId?: string
    today: Dayjs
    maxLanes: number
    showDayHeader: boolean
    onSelectDate: (date: Dayjs) => void
    onSelectAppointment: (appointment: T) => void
    onExpandDay: (date: Dayjs) => void
}

function TimeGridView<T extends CalendarAppointment>({
    byDay, days, selectedDate, selectedId, today, maxLanes, showDayHeader, onSelectDate, onSelectAppointment, onExpandDay,
}: TimeGridViewProps<T>) {
    const bodyRef = useRef<HTMLDivElement>(null)
    const visibleAppointments = useMemo(() => days.flatMap((day) => byDay.get(dayKey(day)) ?? []), [byDay, days])
    const { startHour, endHour } = useMemo(() => hourWindow(visibleAppointments), [visibleAppointments])
    const hours = useMemo(() => Array.from({ length: endHour - startHour }, (_, index) => startHour + index), [startHour, endHour])
    const [nowMinutes, setNowMinutes] = useState(() => minutesOf(dayjs()))
    const columns = `72px repeat(${days.length}, minmax(0, 1fr))`

    useEffect(() => {
        const timer = window.setInterval(() => setNowMinutes(minutesOf(dayjs())), 60_000)
        return () => window.clearInterval(timer)
    }, [])

    // Open on the working day rather than at midnight, without hiding earlier bookings.
    useLayoutEffect(() => {
        const body = bodyRef.current
        if (!body) return
        const focusHour = Math.max(startHour, Math.min(8, endHour - 1))
        body.scrollTop = (focusHour - startHour) * HOUR_HEIGHT
    }, [startHour, endHour, days[0]?.valueOf()]) // eslint-disable-line react-hooks/exhaustive-deps

    const nowOffset = (nowMinutes - startHour * 60) / 60 * HOUR_HEIGHT
    const nowVisible = nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60

    return (
        <div className="apt-timegrid">
            {showDayHeader && (
                <div className="apt-timegrid-head" style={{ gridTemplateColumns: columns }}>
                    <span className="apt-timegrid-corner" />
                    {days.map((day) => {
                        const count = (byDay.get(dayKey(day)) ?? []).length
                        return (
                            <button
                                type="button"
                                key={day.toString()}
                                className={`apt-timegrid-day${day.isSame(today, 'day') ? ' is-today' : ''}${day.isSame(selectedDate, 'day') ? ' is-selected' : ''}`}
                                onClick={() => onSelectDate(day)}
                            >
                                <span className="apt-timegrid-day-name">{day.format('ddd')}</span>
                                <span className="apt-timegrid-day-date">{day.date()}</span>
                                {count > 0 && <span className="apt-timegrid-day-count">{count}</span>}
                            </button>
                        )
                    })}
                </div>
            )}
            <div className="apt-timegrid-body" ref={bodyRef}>
                <div className="apt-timegrid-canvas" style={{ gridTemplateColumns: columns, height: hours.length * HOUR_HEIGHT }}>
                    <div className="apt-timegrid-gutter">
                        {hours.map((hour) => (
                            <span key={hour} style={{ height: HOUR_HEIGHT }}>{`${String(hour).padStart(2, '0')}:00`}</span>
                        ))}
                    </div>
                    {days.map((day) => {
                        const dayRows = byDay.get(dayKey(day)) ?? []
                        const clusters = buildClusters(dayRows)
                        const isToday = day.isSame(today, 'day')
                        return (
                            <div className={`apt-timegrid-col${isToday ? ' is-today' : ''}`} key={day.toString()}>
                                {hours.map((hour) => <div className="apt-timegrid-line" key={hour} style={{ height: HOUR_HEIGHT }} />)}
                                {isToday && nowVisible && <div className="apt-timegrid-now" style={{ top: nowOffset }}><span /></div>}
                                {clusters.map((cluster) => {
                                    const crowded = cluster.lanes > maxLanes
                                    const laneCount = crowded ? maxLanes : cluster.lanes
                                    const shown = crowded ? cluster.items.filter((item) => item.lane < maxLanes - 1) : cluster.items
                                    const hidden = cluster.items.length - shown.length
                                    return (
                                        <div key={`${day.toString()}-${cluster.start}`}>
                                            {shown.map(({ appointment, start, end, lane }) => (
                                                <TimeGridEvent
                                                    key={appointment.id}
                                                    appointment={appointment}
                                                    selected={appointment.id === selectedId}
                                                    top={(start - startHour * 60) / 60 * HOUR_HEIGHT}
                                                    height={Math.max((end - start) / 60 * HOUR_HEIGHT, 24)}
                                                    lane={lane}
                                                    lanes={laneCount}
                                                    onSelect={() => { onSelectDate(day); onSelectAppointment(appointment) }}
                                                />
                                            ))}
                                            {hidden > 0 && (
                                                <button
                                                    type="button"
                                                    className="apt-event apt-event-overflow"
                                                    style={{
                                                        top: (cluster.start - startHour * 60) / 60 * HOUR_HEIGHT,
                                                        height: Math.max((cluster.end - cluster.start) / 60 * HOUR_HEIGHT, 24),
                                                        left: `${((laneCount - 1) / laneCount) * 100}%`,
                                                        width: `${(1 / laneCount) * 100}%`,
                                                    }}
                                                    onClick={() => { onSelectDate(day); onExpandDay(day) }}
                                                >
                                                    +{hidden}
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

type TimeGridEventProps<T extends CalendarAppointment> = {
    appointment: T
    selected: boolean
    top: number
    height: number
    lane: number
    lanes: number
    onSelect: () => void
}

function TimeGridEvent<T extends CalendarAppointment>({ appointment, selected, top, height, lane, lanes, onSelect }: TimeGridEventProps<T>) {
    const compact = height < 44
    return (
        <Tooltip title={`${formatSpan(appointment)} · ${appointment.interventionTitle}${appointment.participantName ? ` · ${appointment.participantName}` : ''}`} mouseEnterDelay={0.35}>
            <button
                type="button"
                className={`apt-event is-${appointment.status}${selected ? ' is-selected' : ''}${compact ? ' is-compact' : ''}`}
                style={{ top, height, left: `${(lane / lanes) * 100}%`, width: `${(1 / lanes) * 100}%` }}
                onClick={onSelect}
            >
                <span className="apt-event-title">{appointment.interventionTitle}</span>
                {!compact && <span className="apt-event-meta">{formatSpan(appointment)}{appointment.participantName ? ` · ${appointment.participantName}` : ''}</span>}
            </button>
        </Tooltip>
    )
}

/* --------------------------------------------------------------- agenda --- */

function AgendaView<T extends CalendarAppointment>({ appointments, selectedId, onSelectAppointment }: {
    appointments: T[]
    selectedId?: string
    onSelectAppointment: (appointment: T) => void
}) {
    const { t } = useLanguage()
    const sections = useMemo(() => {
        const byDayMap = groupByDay(appointments)
        return [...byDayMap.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, rows]) => ({ key, date: dayjs(key), rows }))
    }, [appointments])

    if (!sections.length) return <Empty description={t('No appointments match this view')} />

    return (
        <div className="apt-agenda">
            {sections.map(({ key, date, rows }) => (
                <section className={`apt-agenda-section${date.isSame(dayjs(), 'day') ? ' is-today' : ''}`} key={key}>
                    <header className="apt-agenda-header">
                        <div className="apt-agenda-date"><strong>{date.format('DD')}</strong><span>{date.format('MMM')}</span></div>
                        <div className="apt-agenda-heading">
                            <span className="apt-agenda-weekday">{date.format('dddd')}</span>
                            <span className="apt-agenda-count">{rows.length} {t('appointment')}{rows.length === 1 ? '' : 's'}</span>
                        </div>
                    </header>
                    <div className="apt-agenda-rows">
                        {rows.map((row) => (
                            <button
                                type="button"
                                key={row.id}
                                className={`apt-agenda-row is-${row.status}${row.id === selectedId ? ' is-selected' : ''}`}
                                onClick={() => onSelectAppointment(row)}
                            >
                                <span className="apt-agenda-time">{formatSpan(row)}</span>
                                <span className="apt-agenda-body">
                                    <strong>{row.interventionTitle}</strong>
                                    <small>{row.participantName || row.participantEmail || t('SME')}</small>
                                </span>
                                <span className="apt-agenda-type">{meetingTypeIcon(row.meetingType)}</span>
                            </button>
                        ))}
                    </div>
                </section>
            ))}
        </div>
    )
}

export default AppointmentCalendar
