import { useMemo, useState } from 'react'
import { Alert, Button, Card, Empty, Segmented, Tag, Typography } from 'antd'
import { LeftOutlined, RightOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageLoadingBar } from '@/components/shared/PageSkeleton'
import { AppointmentCalendar } from '@/components/interventions/AppointmentCalendar'
import { CALENDAR_VIEWS, navigationUnit, rangeLabel, statusColor, statusLabel, type CalendarAppointment, type CalendarView } from '@/components/interventions/appointmentSchedule'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { useFunderData } from '@/pages/funder/useFunderData'
import '@/styles/admin-dashboard.css'
import '@/styles/funder.css'

type Row = CalendarAppointment & { programName: string }

const toDay = (value: unknown): Dayjs | null => {
  if (!value) return null
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') return dayjs((value as { toDate: () => Date }).toDate())
  const parsed = dayjs(value as string)
  return parsed.isValid() ? parsed : null
}

/** Read-only calendar of the funded programmes' meetings: no booking, no meeting links, no contact details. */
export const FunderCalendarPage = () => {
  const { t } = useLanguage()
  const { data, loading, error } = useFunderData()
  const [view, setView] = useState<CalendarView>('month')
  const [anchorDate, setAnchorDate] = useState(dayjs())
  const [selectedDate, setSelectedDate] = useState(dayjs())

  const rows = useMemo<Row[]>(() => (data?.appointments || []).map((row) => ({ ...row, meetingLink: null, location: null, participantEmail: null })), [data])
  const dayRows = useMemo(() => rows
    .filter((row) => toDay(row.startTime)?.isSame(selectedDate, 'day'))
    .sort((left, right) => (toDay(left.startTime)?.valueOf() || 0) - (toDay(right.startTime)?.valueOf() || 0)), [rows, selectedDate])
  const upcoming = rows.filter((row) => toDay(row.startTime)?.isAfter(dayjs()) && !['cancelled', 'declined'].includes(row.status)).length

  useRegisterAgentPageContext({
    pageKey: 'funder-calendar',
    pageName: 'Funder calendar',
    purpose: 'Read-only calendar of meetings in the programmes this funder supports.',
    metrics: { appointments: rows.length, upcoming },
  })

  const move = (direction: -1 | 1) => {
    const next = anchorDate.add(direction, navigationUnit(view))
    setAnchorDate(next)
    if (view === 'day') setSelectedDate(next)
  }
  const selectDate = (date: Dayjs) => {
    setSelectedDate(date)
    if (!date.isSame(anchorDate, navigationUnit(view)) || view === 'day') setAnchorDate(date)
  }

  return (
    <DashboardPage className="funder-page funder-calendar-page admin-overview">
      <PageLoadingBar active={loading} label={t('Loading appointments')} />
      {error && <Alert type="error" showIcon message={t('Your programme results could not be loaded.')} style={{ marginBottom: 16 }} />}
      <div className="funder-calendar-layout">
        <Card className="admin-card funder-calendar-card" bordered={false}>
          <div className="apt-toolbar">
            <div className="apt-toolbar-title">
              <Typography.Title level={3}>{rangeLabel(view, anchorDate)}</Typography.Title>
              <Typography.Text type="secondary">{t('{count} upcoming meetings', undefined, { count: upcoming })}</Typography.Text>
            </div>
            <div className="apt-toolbar-controls">
              <Button shape="circle" aria-label={t('Previous range')} icon={<LeftOutlined />} onClick={() => move(-1)} />
              <Segmented value={view} onChange={(value) => { setView(value as CalendarView); if (value === 'day') setAnchorDate(selectedDate) }} options={CALENDAR_VIEWS} />
              <Button shape="circle" aria-label={t('Next range')} icon={<RightOutlined />} onClick={() => move(1)} />
              <Button onClick={() => { setAnchorDate(dayjs()); setSelectedDate(dayjs()) }}>{t('Today')}</Button>
            </div>
          </div>
          <div className="apt-calendar-body">
            <AppointmentCalendar
              appointments={rows}
              view={view}
              anchorDate={anchorDate}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onSelectAppointment={(row) => selectDate(toDay(row.startTime) || selectedDate)}
              onExpandDay={(date) => setSelectedDate(date)}
            />
          </div>
        </Card>
        <Card className="admin-card" bordered={false}>
          <div className="admin-card-head"><div><h3>{selectedDate.format('dddd, D MMMM')}</h3><span>{t('{count} meetings', undefined, { count: dayRows.length })}</span></div></div>
          {dayRows.length ? (
            <ol className="funder-day-list">
              {dayRows.map((row) => (
                <li key={row.id}>
                  <time>{toDay(row.startTime)?.format('HH:mm')}</time>
                  <div>
                    <strong>{row.participantName}</strong>
                    <span>{[row.interventionTitle, row.programName].filter(Boolean).join(' · ')}</span>
                  </div>
                  <Tag color={statusColor(row.status)} bordered={false}>{t(statusLabel(row.status))}</Tag>
                </li>
              ))}
            </ol>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No meetings on this day.')} />}
        </Card>
      </div>
    </DashboardPage>
  )
}

export default FunderCalendarPage
