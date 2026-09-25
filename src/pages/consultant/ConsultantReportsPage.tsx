import { Button, Card, Col, DatePicker, Empty, Progress, Row, Segmented, Space, Typography, theme } from 'antd'
import type Highcharts from 'highcharts'
import { AreaChartOutlined, CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, DownloadOutlined, PieChartOutlined, StarOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ReportExportButton } from '@/components/shared/ReportExportButton'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import type { ReportExportData } from '@/services/reportExport'
import {
    assignmentParticipant,
    assignmentProgram,
    assignmentTitle,
    deriveConsultantStatus,
    downloadCsv,
    getFeedback,
    isOverdueAssignment,
    progressForAssignment,
    toDate,
} from './ConsultantWorkspaceUtils'
import '@/styles/consultant.css'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)

type Period = 'month' | 'quarter' | 'year' | 'custom'

type ReportRow = {
    id: string
    title: string
    participant: string
    program: string
    status: ReturnType<typeof deriveConsultantStatus>
    progress: number
    dueDate: Date | null
    completedAt: Date | null
    rating?: number
    raw: AssignedIntervention
}

const { RangePicker } = DatePicker
const { Text } = Typography

const deliveryHealthColors = {
    pending: '#F59E0B',
    inProgress: '#2563EB',
    completed: '#16A34A',
    overdue: '#DC2626',
    rejected: '#9333EA',
    workload: '#6D5DFB',
}

const rangeFor = (period: Period): [Dayjs, Dayjs] => {
    const now = dayjs()
    if (period === 'month') return [now.startOf('month'), now.endOf('month')]
    if (period === 'quarter') return [now.startOf('quarter'), now.endOf('quarter')]
    return [now.startOf('year'), now.endOf('year')]
}

const dateInRange = (date: Date | null, start: Dayjs, end: Dayjs) => {
    if (!date) return false
    return dayjs(date).isSameOrAfter(start, 'day') && dayjs(date).isSameOrBefore(end, 'day')
}

export const ConsultantReportsPage = () => {
    const { t } = useLanguage()
    const { assignments, loading, isMine } = useAssignedInterventions()
    const { user } = useFullIdentity()
    const { mode } = useThemeMode()
    const dark = mode === 'dark'
    const labelColor = dark ? '#e5e7eb' : '#374151'
    const [period, setPeriod] = useState<Period>('year')
    const [[start, end], setRange] = useState<[Dayjs, Dayjs]>(rangeFor('year'))
    const { token } = theme.useToken()
    const [appointments, setAppointments] = useState<Array<Record<string, unknown>>>([])

    useEffect(() => {
        if (!user?.uid) return
        let active = true
        void getDocs(query(collection(db, 'appointments'), where('assigneeId', '==', user.uid)))
            .then((snapshot) => { if (active) setAppointments(snapshot.docs.map((row) => row.data())) })
            .catch(() => { if (active) setAppointments([]) })
        return () => { active = false }
    }, [user?.uid])

    const liveRows = useMemo<ReportRow[]>(() => assignments.filter(isMine).map((assignment) => {
        const status = deriveConsultantStatus(assignment)
        return {
            id: assignment.id,
            title: assignmentTitle(assignment),
            participant: assignmentParticipant(assignment),
            program: assignmentProgram(assignment),
            status,
            progress: progressForAssignment(assignment, status),
            dueDate: toDate(assignment.dueDate),
            completedAt: toDate(assignment.completedAt) || toDate(assignment.updatedAt),
            rating: getFeedback(assignment).rating,
            raw: assignment,
        }
    }), [assignments, isMine])

    const allRows = liveRows

    const scopedRows = allRows.filter((row) => {
        const date = row.completedAt || row.dueDate || toDate(row.raw.createdAt)
        return dateInRange(date, start, end)
    })

    const completed = scopedRows.filter((row) => row.status === 'Completed')
    const active = scopedRows.filter((row) => row.status === 'In progress')
    const overdue = scopedRows.filter((row) => isOverdueAssignment(row.raw))
    const pending = scopedRows.filter((row) => row.status === 'Pending' && !isOverdueAssignment(row.raw))
    const rejected = scopedRows.filter((row) => row.status === 'Rejected')
    const rated = scopedRows.filter((row) => row.rating != null)
    const avgRating = rated.length ? rated.reduce((sum, row) => sum + (row.rating || 0), 0) / rated.length : 0
    const completionRate = scopedRows.length ? Math.round((completed.length / scopedRows.length) * 100) : 0

    // Turnaround: assigned -> completed, using real completion timestamps only.
    const finished = scopedRows
        .filter((row) => row.status === 'Completed')
        .map((row) => ({ row, finishedAt: toDate(row.raw.completedAt), createdAt: toDate(row.raw.createdAt) || toDate(row.raw.implementationDate) }))
        .filter((item): item is { row: ReportRow; finishedAt: Date; createdAt: Date } => !!item.finishedAt && !!item.createdAt)
    const turnaroundDays = finished.map((item) => Math.max(0, dayjs(item.finishedAt).diff(dayjs(item.createdAt), 'day')))
    const avgTurnaround = turnaroundDays.length ? Math.round(turnaroundDays.reduce((sum, value) => sum + value, 0) / turnaroundDays.length) : null
    const onTime = finished.filter((item) => !item.row.dueDate || !dayjs(item.finishedAt).isAfter(item.row.dueDate, 'day'))
    const onTimeRate = finished.length ? Math.round((onTime.length / finished.length) * 100) : 0

    // Attendance across their own appointments that were held in the period.
    const attendance = (() => {
        const now = dayjs()
        let present = 0
        let absent = 0
        appointments.forEach((row) => {
            const startTime = toDate(row.startTime)
            if (!startTime || dayjs(startTime).isAfter(now) || !dateInRange(startTime, start, end)) return
            const values = Object.values((row.attendance as Record<string, unknown>) || {}).map((value) => String(value).toLowerCase())
            if (values.includes('present')) present += 1
            else if (values.includes('absent')) absent += 1
        })
        const held = present + absent
        return { present, absent, held, rate: held ? Math.round((present / held) * 100) : 0 }
    })()

    const overdueItems = scopedRows
        .filter((row) => row.status !== 'Completed' && isOverdueAssignment(row.raw))
        .map((row) => ({ row, daysLate: row.dueDate ? Math.max(1, dayjs().diff(dayjs(row.dueDate), 'day')) : 0 }))
        .sort((left, right) => right.daysLate - left.daysLate)

    const attendanceGauge: Highcharts.Options = {
        chart: { type: 'pie', height: 170, margin: [0, 0, 0, 0], backgroundColor: 'transparent' },
        title: { text: undefined },
        tooltip: { enabled: false },
        plotOptions: { pie: { startAngle: -90, endAngle: 90, center: ['50%', '85%'], size: '170%', innerSize: '72%', borderWidth: 0, dataLabels: { enabled: false }, states: { hover: { enabled: false } } } },
        series: [{
            type: 'pie',
            name: 'Attendance',
            data: [
                { name: 'Present', y: attendance.rate, color: attendance.rate >= 80 ? deliveryHealthColors.completed : attendance.rate >= 60 ? deliveryHealthColors.pending : deliveryHealthColors.overdue },
                { name: 'Remaining', y: Math.max(0, 100 - attendance.rate), color: token.colorFillSecondary },
            ].filter((point) => point.y > 0),
        }],
    }

    const statusChartData = [
        { name: t('consultant.status.pending', 'Pending'), y: pending.length, color: deliveryHealthColors.pending },
        { name: t('consultant.status.inProgress', 'In progress'), y: active.filter((row) => !isOverdueAssignment(row.raw)).length, color: deliveryHealthColors.inProgress },
        { name: t('consultant.status.completed', 'Completed'), y: completed.length, color: deliveryHealthColors.completed },
        { name: t('consultant.status.overdue', 'Overdue'), y: overdue.length, color: deliveryHealthColors.overdue },
        { name: t('consultant.status.rejected', 'Rejected'), y: rejected.length, color: deliveryHealthColors.rejected },
    ].filter((item) => item.y > 0)

    const statusChart: Highcharts.Options = {
        chart: { type: 'pie', height: 300, backgroundColor: 'transparent' },
        title: { text: undefined },
        legend: { itemStyle: { color: labelColor } },
        colors: statusChartData.map((item) => item.color),
        tooltip: { pointFormat: `<b>{point.y}</b> ${t('consultant.common.assignments')}` },
        plotOptions: {
            pie: {
                innerSize: '58%',
                borderWidth: 0,
                borderColor: 'transparent',
                dataLabels: {
                    enabled: true,
                    format: '{point.name}: {point.y}',
                    color: labelColor,
                    style: { textOutline: 'none', fontWeight: '600', color: labelColor },
                },
            },
        },
        series: [{ type: 'pie', name: t('consultant.common.assignments'), data: statusChartData }],
    }

    // Assigned (spline) vs completed (bars) across the selected period, by week for short ranges and by month otherwise.
    const trendChart: Highcharts.Options = (() => {
        const chartEnd = end.isAfter(dayjs()) ? dayjs() : end
        const unit = chartEnd.diff(start, 'day') > 60 ? 'month' : 'week'
        const buckets: Array<{ label: string; from: Dayjs; to: Dayjs }> = []
        let cursor = start.startOf(unit)
        while (!cursor.isAfter(chartEnd, 'day')) {
            buckets.push({ label: unit === 'month' ? cursor.format('MMM YY') : cursor.format('DD MMM'), from: cursor, to: cursor.endOf(unit) })
            cursor = cursor.add(1, unit)
        }
        const inBucket = (date: Date | null, bucket: { from: Dayjs; to: Dayjs }) => !!date && !dayjs(date).isBefore(bucket.from) && !dayjs(date).isAfter(bucket.to)
        const assigned = buckets.map((bucket) => allRows.filter((row) => inBucket(toDate(row.raw.createdAt) || toDate(row.raw.implementationDate), bucket)).length)
        const done = buckets.map((bucket) => allRows.filter((row) => row.status === 'Completed' && inBucket(row.completedAt, bucket)).length)
        return {
            chart: { height: 300, backgroundColor: 'transparent' },
            title: { text: undefined },
            xAxis: { categories: buckets.map((bucket) => bucket.label) },
            yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
            tooltip: { shared: true },
            legend: { itemStyle: { color: labelColor } },
            plotOptions: {
                column: { borderRadius: 4, borderWidth: 0, dataLabels: { enabled: true, color: labelColor, style: { textOutline: 'none', fontWeight: '600', color: labelColor } } },
                spline: { lineWidth: 3, marker: { enabled: true, radius: 4 } },
            },
            series: [
                { type: 'column', name: t('consultant.status.completed', 'Completed'), color: deliveryHealthColors.completed, data: done },
                { type: 'spline', name: t('consultant.metrics.assigned', 'Assigned'), color: deliveryHealthColors.workload, data: assigned, zIndex: 5 },
            ],
        }
    })()

    const updatePeriod = (value: Period) => {
        setPeriod(value)
        if (value !== 'custom') setRange(rangeFor(value))
    }

    const exportReport = () => {
        downloadCsv(`consultant-report-${start.format('YYYYMMDD')}-${end.format('YYYYMMDD')}.csv`, scopedRows.map((row) => ({
            [t('consultant.common.sme')]: row.participant,
            [t('consultant.common.program')]: row.program,
            [t('consultant.common.intervention')]: row.title,
            [t('common.status')]: isOverdueAssignment(row.raw) && row.status !== 'Completed' ? 'Overdue' : row.status,
            [t('consultant.common.progress')]: row.progress,
            DueDate: row.dueDate ? dayjs(row.dueDate).format('YYYY-MM-DD') : '',
            CompletedAt: row.completedAt ? dayjs(row.completedAt).format('YYYY-MM-DD') : '',
            [t('consultant.feedback.rating')]: row.rating ?? '',
        })))
    }

    const buildExportData = (): ReportExportData => {
        const rate = (value: number) => `${value}%`
        const isLate = (row: ReportRow) => isOverdueAssignment(row.raw) && row.status !== 'Completed'
        const byProgramme = new Map<string, { assigned: number, completed: number, overdue: number }>()
        scopedRows.forEach((row) => {
            const name = row.program || 'Unassigned'
            const entry = byProgramme.get(name) || { assigned: 0, completed: 0, overdue: 0 }
            entry.assigned += 1
            if (row.status === 'Completed') entry.completed += 1
            if (isLate(row)) entry.overdue += 1
            byProgramme.set(name, entry)
        })
        return {
            role: user?.role || 'consultant',
            title: 'Consultant Report',
            periodLabel: `${start.format('DD MMM YYYY')} to ${end.format('DD MMM YYYY')}`,
            organisation: user?.companyCode || undefined,
            preparedBy: user?.name || user?.displayName || user?.email || 'Consultant',
            kpis: [
                { label: 'Assignments', value: scopedRows.length },
                { label: 'Completed', value: completed.length, note: `${rate(completionRate)} completion rate`, tone: completionRate >= 70 ? 'good' : completionRate < 40 && scopedRows.length ? 'risk' : 'watch' },
                { label: 'In progress', value: active.length },
                { label: 'Pending', value: pending.length },
                { label: 'Overdue', value: overdue.length, tone: overdue.length ? 'risk' : 'good' },
                { label: 'Declined', value: rejected.length, tone: rejected.length ? 'watch' : 'good' },
                { label: 'Average turnaround', value: avgTurnaround !== null ? `${avgTurnaround} days` : 'No completions yet', note: finished.length ? `${onTimeRate}% delivered on or before the due date` : undefined, tone: avgTurnaround !== null ? (avgTurnaround <= 14 ? 'good' : avgTurnaround > 30 ? 'risk' : 'watch') : undefined },
                { label: 'Appointment attendance', value: attendance.held ? rate(attendance.rate) : 'No appointments held', note: attendance.held ? `${attendance.present} present, ${attendance.absent} absent of ${attendance.held} held` : undefined, tone: attendance.held ? (attendance.rate >= 80 ? 'good' : attendance.rate < 60 ? 'risk' : 'watch') : undefined },
                { label: 'Average client rating', value: rated.length ? `${avgRating.toFixed(1)} / 5` : 'Not rated', note: `${rated.length} rated assignment${rated.length === 1 ? '' : 's'}`, tone: rated.length ? (avgRating >= 4 ? 'good' : avgRating < 3 ? 'risk' : 'watch') : undefined },
            ],
            tables: [
                {
                    key: 'assignments',
                    title: 'Assignment detail',
                    columns: [{ key: 'participant', label: 'SME' }, { key: 'program', label: 'Programme' }, { key: 'title', label: 'Intervention' }, { key: 'status', label: 'Status' }, { key: 'progress', label: 'Progress %' }, { key: 'due', label: 'Due' }, { key: 'rating', label: 'Rating' }],
                    rows: scopedRows.map((row) => ({
                        participant: row.participant,
                        program: row.program || 'Unassigned',
                        title: row.title,
                        status: isLate(row) ? 'Overdue' : row.status,
                        progress: row.progress,
                        due: row.dueDate ? dayjs(row.dueDate).format('DD MMM YYYY') : '-',
                        rating: row.rating ? `${row.rating}/5` : '-',
                    })),
                },
                {
                    key: 'programmes',
                    title: 'Workload by programme',
                    columns: [{ key: 'programme', label: 'Programme' }, { key: 'assigned', label: 'Assigned' }, { key: 'completed', label: 'Completed' }, { key: 'overdue', label: 'Overdue' }],
                    rows: [...byProgramme.entries()].sort((left, right) => right[1].assigned - left[1].assigned).map(([programme, entry]) => ({ programme, ...entry })),
                },
            ],
        }
    }

    return (
        <DashboardPage className="consultant-page">
            <Row gutter={[16, 16]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={loading}
                        icon={<PieChartOutlined />}
                        label={t('consultant.common.assignments')}
                        value={scopedRows.length}
                        hint={`${start.format('DD MMM')} to ${end.format('DD MMM YYYY')}`}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={loading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="is-success"
                        label={t('consultant.metrics.completed')}
                        value={completed.length}
                        hint={t('consultant.dashboard.completionHint', '{rate}% completion rate').replace('{rate}', String(completionRate))}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={loading}
                        icon={<WarningOutlined />}
                        iconClassName="is-risk"
                        label={t('consultant.status.overdue')}
                        value={overdue.length}
                        hint={t('consultant.reports.activeHint', '{count} in progress').replace('{count}', String(active.length))}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        loading={loading}
                        icon={<StarOutlined />}
                        label={t('consultant.reports.avgRating')}
                        value={avgRating ? avgRating.toFixed(2) : '-'}
                        hint={t('consultant.reports.ratedHint', '{count} rated').replace('{count}', String(rated.length))}
                    />
                </Col>
            </Row>

            <FilterBar
                primary={
                    <>
                        <Segmented<Period>
                            value={period}
                            onChange={updatePeriod}
                            options={[
                                { label: t('consultant.reports.thisMonth'), value: 'month' },
                                { label: t('consultant.reports.thisQuarter'), value: 'quarter' },
                                { label: t('consultant.reports.thisYear'), value: 'year' },
                                { label: t('consultant.reports.custom'), value: 'custom' },
                            ]}
                        />
                        {period === 'custom' && (
                            <RangePicker
                                value={[start, end]}
                                allowClear={false}
                                onChange={(value) => {
                                    if (value?.[0] && value?.[1]) setRange([value[0], value[1]])
                                }}
                            />
                        )}
                    </>
                }
                actions={
                    <>
                        <Button icon={<DownloadOutlined />} disabled={!scopedRows.length} onClick={exportReport}>
                            {t('consultant.reports.downloadCsv')}
                        </Button>
                        <ReportExportButton buildData={buildExportData} disabled={loading || !scopedRows.length} />
                    </>
                }
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={9}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('consultant.reports.statusMix')} style={{ height: '100%' }}>
                        {scopedRows.length ? <ThemedHighcharts options={statusChart} /> : <Empty description={t('consultant.reports.empty')} />}
                    </Card>
                </Col>
                <Col xs={24} xl={15}>
                    <Card
                        loading={loading}
                        className="dashboard-section-card motion-card"
                        title={<Space><AreaChartOutlined /> {t('Assigned vs completed')}</Space>}
                        extra={<Text type="secondary">{start.format('DD MMM YYYY')} – {end.format('DD MMM YYYY')}</Text>}
                        style={{ height: '100%' }}
                    >
                        {allRows.length ? <ThemedHighcharts options={trendChart} /> : <Empty description={t('consultant.reports.empty')} />}
                    </Card>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                <Col xs={24} lg={12}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><ClockCircleOutlined /> {t('Turnaround time')}</Space>} style={{ height: '100%' }}>
                        <Space direction="vertical" size={18} style={{ width: '100%' }}>
                            {avgTurnaround !== null ? (
                                <div>
                                    <span style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>{avgTurnaround}</span>
                                    <Text type="secondary" style={{ marginLeft: 8 }}>{t('days on average')}</Text>
                                    <Text type="secondary" style={{ display: 'block', marginTop: 4 }}>{t('From the day an intervention is assigned to the day it is completed.')}</Text>
                                </div>
                            ) : <Text type="secondary">{t('No completed interventions in this period.')}</Text>}
                            {avgTurnaround !== null && (
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                        <Text>{t('Delivered on time')}</Text>
                                        <Text type="secondary" style={{ fontSize: 12 }}>{onTime.length}/{finished.length}</Text>
                                    </div>
                                    <Progress percent={onTimeRate} strokeColor={onTimeRate >= 75 ? deliveryHealthColors.completed : onTimeRate >= 50 ? deliveryHealthColors.pending : deliveryHealthColors.overdue} />
                                </div>
                            )}
                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                    <Text>{t('Overdue items')}</Text>
                                    <Text strong style={{ color: overdueItems.length ? deliveryHealthColors.overdue : undefined }}>{overdueItems.length}</Text>
                                </div>
                                <Progress
                                    percent={scopedRows.length ? Math.round((overdueItems.length / scopedRows.length) * 100) : 0}
                                    strokeColor={deliveryHealthColors.overdue}
                                    format={() => `${overdueItems.length}/${scopedRows.length}`}
                                />
                            </div>
                        </Space>
                    </Card>
                </Col>
                <Col xs={24} lg={12}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={<Space><CalendarOutlined /> {t('Appointment attendance')}</Space>} style={{ height: '100%' }}>
                        {attendance.held ? (
                            <>
                                <div style={{ position: 'relative' }}>
                                    <ThemedHighcharts options={attendanceGauge} />
                                    <div style={{ position: 'absolute', left: 0, right: 0, top: '58%', textAlign: 'center', pointerEvents: 'none' }}>
                                        <Text strong style={{ fontSize: 30, display: 'block', lineHeight: 1 }}>{attendance.rate}%</Text>
                                    </div>
                                </div>
                                <Text type="secondary" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
                                    {attendance.present} {t('present')} · {attendance.absent} {t('absent')} {t('of')} {attendance.held} {t('held')}
                                </Text>
                            </>
                        ) : <Empty description={t('No appointments have been held in this period.')} />}
                    </Card>
                </Col>
            </Row>
        </DashboardPage>
    )
}

export default ConsultantReportsPage
