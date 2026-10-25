import { Button, Switch, TimePicker, Typography } from 'antd'
import { CopyOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useLanguage } from '@/providers/LanguageProvider'
import type { WorkWindow } from '@/services/companyWorkSettingsService'
import '@/styles/week-hours.css'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
// Monday first, the way people plan a working week.
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const WEEKDAYS = [1, 2, 3, 4, 5]
const DEFAULT_WINDOW = { startTime: '08:00', endTime: '17:00' }

/** One opening window per day: a switch for open or closed, and the hours when open. */
export const WeekHoursEditor = ({ value, onChange, disabled }: { value: WorkWindow[]; onChange: (next: WorkWindow[]) => void; disabled?: boolean }) => {
    const { t } = useLanguage()
    const windowFor = (day: number) => value.find((window) => window.dayOfWeek === day)
    const sorted = (windows: WorkWindow[]) => [...windows].sort((left, right) => ORDER.indexOf(left.dayOfWeek) - ORDER.indexOf(right.dayOfWeek))
    const setDay = (day: number, window: Omit<WorkWindow, 'dayOfWeek'> | null) =>
        onChange(sorted([...value.filter((item) => item.dayOfWeek !== day), ...(window ? [{ dayOfWeek: day, ...window }] : [])]))
    const monday = windowFor(1)
    const copyMonday = () => monday && onChange(sorted([...value.filter((item) => !WEEKDAYS.includes(item.dayOfWeek)), ...WEEKDAYS.map((day) => ({ dayOfWeek: day, startTime: monday.startTime, endTime: monday.endTime }))]))

    return (
        <div className="week-hours">
            {ORDER.map((day) => {
                const window = windowFor(day)
                return (
                    <div key={day} className={`week-hours-row${window ? '' : ' is-closed'}`}>
                        <Switch size="small" checked={!!window} disabled={disabled} onChange={(open) => setDay(day, open ? { ...DEFAULT_WINDOW, ...(monday && day !== 1 ? { startTime: monday.startTime, endTime: monday.endTime } : {}) } : null)} aria-label={t(DAYS[day])} />
                        <span className="week-hours-day">{t(DAYS[day])}</span>
                        {window ? (
                            <TimePicker.RangePicker
                                size="small"
                                format="HH:mm"
                                minuteStep={15}
                                allowClear={false}
                                disabled={disabled}
                                value={[dayjs(window.startTime, 'HH:mm'), dayjs(window.endTime, 'HH:mm')]}
                                onChange={(range) => { if (range?.[0] && range?.[1] && range[0].isBefore(range[1])) setDay(day, { startTime: range[0].format('HH:mm'), endTime: range[1].format('HH:mm') }) }}
                                aria-label={t('Hours on {day}', undefined, { day: t(DAYS[day]) })}
                            />
                        ) : <Typography.Text type="secondary">{t('Closed')}</Typography.Text>}
                    </div>
                )
            })}
            {monday && !disabled && <Button size="small" icon={<CopyOutlined />} onClick={copyMonday} className="week-hours-copy">{t('Copy Monday to weekdays')}</Button>}
        </div>
    )
}

export default WeekHoursEditor
