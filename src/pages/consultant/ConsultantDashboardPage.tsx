import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, List, Progress, Row, Segmented, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type Highcharts from 'highcharts'
import { ArrowRightOutlined, CheckCircleOutlined, EditOutlined, EyeOutlined, CalendarOutlined, FolderOpenOutlined, LineChartOutlined, ShopOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { ConsultantMarketplaceCard } from '@/components/consultant/ConsultantMarketplaceCard'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ThemedHighcharts } from '@/components/shared/ThemedHighcharts'
import { UpcomingWeekCard, type InterventionDueItem } from '@/pages/dashboards/operations/UpcomingWeekCard'
import { useThemeMode } from '@/providers/ThemeProvider'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { hasConsultantMarketplaceProfile } from '@/services/companiesService'
import { getConsultantProfile } from '@/services/consultantMarketplaceService'
import { isDiscontinuedRecord } from '@/services/discontinuedSmes'
import { assigneeWaitingOn } from '@/services/interventionHoldUp'
import type { ConsultantMarketplaceProfile } from '@/types/consultantMarketplace'
import { consultantProfileChecks } from './consultantProfileChecks'
import { summariseConsultantWork } from './consultantWorkSummary'
import { ChangeRequestModal, LONG_OVERDUE_DAYS } from '@/components/interventions/ChangeRequestModal'
import {
    assignmentParticipant,
    assignmentProgram,
    assignmentTitle,
    deriveConsultantStatus,
    getFeedback,
    isOverdueAssignment,
    progressForAssignment,
    statusColor,
    toDate,
} from './ConsultantWorkspaceUtils'
import '@/styles/consultant.css'
import { lastMessage, listConnectionRequestsForConsultant, waitsOnConsultant } from '@/services/connectionRequestService'
import type { ConnectionRequest } from '@/types/connectionRequest'

type ConsultantStatus = ReturnType<typeof deriveConsultantStatus>
type Bucket = 'toAccept' | 'inProgress' | 'overdue' | 'completed' | 'declined'

type DashboardRow = {
    id: string
    title: string
    participant: string
    program: string
    status: ConsultantStatus
    bucket: Bucket
    progress: number
    dueDate: Date | null
    createdAt: Date | null
    raw: AssignedIntervention
    feedback: { rating?: number | null; comments?: string; createdAt?: Date | null }
}

const { Text } = Typography

// Each assignment lands in exactly one bucket, so the four metric cards add up to the whole.
const bucketOf = (assignment: AssignedIntervention, status: ConsultantStatus): Bucket => {
    if (status === 'Rejected') return 'declined'
    if (status === 'Completed') return 'completed'
    if (isOverdueAssignment(assignment)) return 'overdue'
    return status === 'Pending' ? 'toAccept' : 'inProgress'
}

const buildRow = (assignment: AssignedIntervention): DashboardRow => {
    const status = deriveConsultantStatus(assignment)
    const feedback = getFeedback(assignment)
    return {
        id: assignment.id,
        title: assignmentTitle(assignment),
        participant: assignmentParticipant(assignment),
        program: assignmentProgram(assignment),
        status,
        bucket: bucketOf(assignment, status),
        progress: progressForAssignment(assignment, status),
        dueDate: toDate(assignment.dueDate),
        createdAt: toDate(assignment.createdAt) || toDate(assignment.implementationDate),
        raw: assignment,
        feedback: { rating: feedback.rating, comments: feedback.comments, createdAt: feedback.createdAt },
    }
}

export const ConsultantDashboardPage = () => {
    const { t } = useLanguage()
    const navigate = useNavigate()
    const { assignments, loading, isMine, refresh } = useAssignedInterventions()
    const { user } = useFullIdentity()
    const { mode } = useThemeMode()
    const freelance = hasConsultantMarketplaceProfile(user)
    const [metricModal, setMetricModal] = useState<{ title: string; rows: DashboardRow[] } | null>(null)
    const [appointments, setAppointments] = useState<Array<Record<string, unknown>>>([])
    const [profile, setProfile] = useState<ConsultantMarketplaceProfile | null>(null)
    const [marketRequests, setMarketRequests] = useState<ConnectionRequest[]>([])
    const [previewOpen, setPreviewOpen] = useState(false)
    const [requesting, setRequesting] = useState<{ id: string; title: string; participant: string } | null>(null)
    const [perfRange, setPerfRange] = useState<'weekly' | 'monthly'>('weekly')
    // Checked with the dataviz palette validator. Dark green and amber sit close for some readers, so each measure also keeps a fixed place in its group, and the legend gives its total.
    const perfColors = mode === 'dark'
        ? { completed: '#16A34A', smes: '#8B5CF6', appointments: '#D97706' }
        : { completed: '#15803D', smes: '#7C3AED', appointments: '#CA8A04' }

    useEffect(() => {
        if (!user?.uid) return
        let active = true
        void getDocs(query(collection(db, 'appointments'), where('assigneeId', '==', user.uid)))
            .then((snapshot) => { if (active) setAppointments(snapshot.docs.map((row) => row.data()).filter((row) => !isDiscontinuedRecord(row as { participantDiscontinuedAt?: unknown }))) })
            .catch(() => { if (active) setAppointments([]) })
        // Freelance consultants are listed in the marketplace, so their listing is part of what needs them.
        if (freelance) void getConsultantProfile(user.uid, { name: user.displayName, email: user.email }).then((next) => { if (active) setProfile(next) }).catch(() => undefined)
        if (freelance) void listConnectionRequestsForConsultant(user.uid).then((rows) => { if (active) setMarketRequests(rows) }).catch(() => undefined)
        return () => { active = false }
    }, [freelance, user?.displayName, user?.email, user?.uid])

    const rows = useMemo(() => assignments.filter(isMine).map(buildRow), [assignments, isMine])
    const work = useMemo(() => summariseConsultantWork(assignments.filter(isMine)), [assignments, isMine])
    const byBucket = (bucket: Bucket) => rows.filter((row) => row.bucket === bucket)
    const toAccept = byBucket('toAccept')
    const inProgress = byBucket('inProgress')
    const overdue = byBucket('overdue')
    const today = dayjs().startOf('day')
    const daysLate = (row: DashboardRow) => (row.dueDate ? Math.max(1, today.diff(dayjs(row.dueDate).startOf('day'), 'day')) : 0)
    const daysLabel = (count: number) => (count === 1 ? t('1 day') : t('{count} days', undefined, { count }))
    const dueLabel = (date: Date) => {
        const days = dayjs(date).startOf('day').diff(today, 'day')
        return days === 0 ? t('Due today') : days === 1 ? t('Due tomorrow') : t('Due {day}', undefined, { day: dayjs(date).format('ddd D MMM') })
    }

    // Headline figures: the last 30 days against the 30 before, with an 8-week sparkline each.
    const now = dayjs()
    const windowStart = now.subtract(30, 'day')
    const previousStart = now.subtract(60, 'day')
    const between = (date: Date | null, from: dayjs.Dayjs, to: dayjs.Dayjs) => !!date && !dayjs(date).isBefore(from) && !dayjs(date).isAfter(to)
    const finishedAt = (row: DashboardRow) => toDate(row.raw.completedAt) || toDate(row.raw.updatedAt)
    const completedIn = (from: dayjs.Dayjs, to: dayjs.Dayjs) => rows.filter((row) => row.bucket === 'completed' && between(finishedAt(row), from, to))
    const heldIn = (from: dayjs.Dayjs, to: dayjs.Dayjs) => appointments.filter((row) => {
        const start = toDate(row.startTime)
        return !!start && dayjs(start).isBefore(now) && between(start, from, to) && String(row.status || '').toLowerCase() !== 'cancelled'
    })
    // An SME counts as reached when you completed work for them or met them in an appointment.
    const smesIn = (from: dayjs.Dayjs, to: dayjs.Dayjs) => new Set([
        ...completedIn(from, to).map((row) => String(row.raw.participantId || row.participant)),
        ...heldIn(from, to).map((row) => String(row.participantId || '')),
    ].filter(Boolean))
    // How much was overdue at a past moment: due before it, and not completed by then.
    const overdueAt = (moment: dayjs.Dayjs) => rows.filter((row) => {
        if (row.bucket === 'declined' || !row.dueDate || !dayjs(row.dueDate).isBefore(moment.startOf('day'))) return false
        const done = row.bucket === 'completed' ? finishedAt(row) : null
        return !done || dayjs(done).isAfter(moment)
    }).length
    const weeksBack = [7, 6, 5, 4, 3, 2, 1, 0].map((index) => ({ from: now.subtract(index + 1, 'week'), to: now.subtract(index, 'week') }))
    // The card shows an arrow and the amount beside the figure; the full sentence is its tooltip.
    const trendFor = (current: number, before: number, better: 'higher' | 'lower' | 'neutral', label: string) => {
        const change = current - before
        if (!change) return { text: t('No change {label}', undefined, { label }), amount: '0', direction: 'flat' as const, tone: 'neutral' as const }
        const tone = better === 'neutral' ? 'neutral' as const : (better === 'higher' ? change > 0 : change < 0) ? 'good' as const : 'bad' as const
        return { text: `${change > 0 ? '+' : '−'}${Math.abs(change)} ${label}`, amount: String(Math.abs(change)), direction: change > 0 ? 'up' as const : 'down' as const, tone }
    }
    const versusLast30 = t('vs previous 30 days')
    // What was open at a past moment: assigned by then and not yet completed. Declined work is left out, as its
    // decline date isn't kept.
    const openAt = (moment: dayjs.Dayjs) => rows.filter((row) => {
        if (row.bucket === 'declined' || !row.createdAt || dayjs(row.createdAt).isAfter(moment)) return false
        const done = row.bucket === 'completed' ? finishedAt(row) : null
        return !done || dayjs(done).isAfter(moment)
    })
    // Open work falling due in the 7 days from a moment (not already late then).
    const dueWithinWeekOf = (moment: dayjs.Dayjs, list: DashboardRow[]) => list.filter((row) => {
        if (!row.dueDate) return false
        const days = dayjs(row.dueDate).startOf('day').diff(moment.startOf('day'), 'day')
        return days >= 0 && days <= 7
    })
    const openNow = rows.filter((row) => row.bucket === 'toAccept' || row.bucket === 'inProgress' || row.bucket === 'overdue')
    const headline = {
        open: openNow,
        dueThisWeek: dueWithinWeekOf(now, openNow.filter((row) => row.bucket !== 'overdue')),
        completed: completedIn(windowStart, now),
    }

    // Performance over time: completed work, appointments held and SMEs reached, per week (12) or month (6).
    // All counts, so one axis is honest. Grouped columns: small weekly counts read as bars, not as curves between
    // points, and each measure keeps the same place in every group as well as its colour.
    const perfBuckets = perfRange === 'weekly'
        ? Array.from({ length: 12 }, (_, index) => { const from = now.subtract(11 - index, 'week').startOf('week'); return { from, to: from.endOf('week'), label: from.format('D MMM') } })
        : Array.from({ length: 6 }, (_, index) => { const from = now.subtract(5 - index, 'month').startOf('month'); return { from, to: from.endOf('month'), label: from.format('MMM') } })
    const perfFrom = perfBuckets[0].from
    const perfSeries = [
        { key: 'completed', name: t('Interventions completed'), color: perfColors.completed, data: perfBuckets.map((bucket) => completedIn(bucket.from, bucket.to).length), total: completedIn(perfFrom, now).length },
        { key: 'appointments', name: t('Appointments held'), color: perfColors.appointments, data: perfBuckets.map((bucket) => heldIn(bucket.from, bucket.to).length), total: heldIn(perfFrom, now).length },
        { key: 'smes', name: t('SMEs reached'), color: perfColors.smes, data: perfBuckets.map((bucket) => smesIn(bucket.from, bucket.to).size), total: smesIn(perfFrom, now).size },
    ]
    const performanceChart: Highcharts.Options = {
        chart: { height: 260, backgroundColor: 'transparent' },
        title: { text: undefined },
        legend: { enabled: false },
        xAxis: { categories: perfBuckets.map((bucket) => bucket.label), tickLength: 0 },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined } },
        tooltip: { shared: true },
        plotOptions: { series: { animation: false }, column: { borderWidth: 0, borderRadius: { radius: 4, scope: 'point', where: 'end' }, pointPadding: 0.08, groupPadding: 0.18, maxPointWidth: 14 } },
        series: perfSeries.map((series) => ({ type: 'column' as const, name: series.name, color: series.color, data: series.data })),
    }

    // Freelance listing: the same checklist the profile page uses.
    const checks = profile ? consultantProfileChecks(profile) : []
    const checksDone = checks.filter((check) => check.done).length
    const profileReady = checks.length > 0 && checks.every((check) => check.done || !check.required)
    const published = profile?.status === 'published'
    const ratings = rows.map((row) => row.feedback.rating).filter((value): value is number => typeof value === 'number')
    const averageRating = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : null

    // What to act on, most urgent first: new work to open, overdue work (with what it's waiting on), then due this week.
    const lateSorted = [...overdue].sort((left, right) => daysLate(right) - daysLate(left))
    const dueSoon = [...inProgress, ...toAccept]
        .filter((row) => row.dueDate && dayjs(row.dueDate).diff(today, 'day') >= 0 && dayjs(row.dueDate).diff(today, 'day') <= 7)
        .sort((left, right) => (left.dueDate?.getTime() || 0) - (right.dueDate?.getTime() || 0))
    // Opens the interventions page on one intervention (it already reads focusInterventionId), where accepting,
    // declining and updating progress happen.
    const openIntervention = (id: string) => navigate('/consultant/interventions', { state: { focusInterventionId: id } })
    type NeedItem = { key: string; interventionId?: string; title: string; detail: string; tag?: { text: string; tone: 'danger' | 'warning' }; action?: { label: string; onClick: () => void } }
    // Late and due work is split by whose move it is: the consultant's own first, then what waits on the SME or a reviewer.
    const waiting = (row: DashboardRow) => assigneeWaitingOn(row.raw)
    const workItem = (row: DashboardRow, tag: NeedItem['tag']): NeedItem => ({
        key: row.id,
        interventionId: row.id,
        title: row.title,
        detail: `${row.participant} · ${t(waiting(row).label)}`,
        tag,
        action: { label: t('Open'), onClick: () => openIntervention(row.id) },
    })
    const lateTag = (row: DashboardRow) => ({ text: t('{days} late', undefined, { days: daysLabel(daysLate(row)) }), tone: 'danger' as const })
    const dueTag = (row: DashboardRow) => ({ text: dueLabel(row.dueDate as Date), tone: 'warning' as const })
    const dueSoonOpen = dueSoon.filter((row) => row.bucket !== 'toAccept')
    const yourNeeds: NeedItem[] = [
        // Marketplace requests waiting on a freelancer's reply come first: an SME is waiting to hear back.
        ...marketRequests.filter(waitsOnConsultant).map((request) => ({
            key: `request-${request.id}`,
            title: request.status === 'pending' ? t('Request from {sme}', undefined, { sme: request.smeName }) : t('{sme} replied', undefined, { sme: request.smeName }),
            detail: [request.areaOfSupport, lastMessage(request)?.text || request.note].filter(Boolean).join(' · '),
            action: { label: t('Reply'), onClick: () => navigate('/consultant/requests', { state: { focusRequestId: request.id } }) },
        })),
        ...(freelance && profile && !published ? [{
            key: 'profile',
            title: profileReady ? t('Publish your profile') : t('Finish your profile'),
            detail: profileReady ? t('Everything is filled in. Publish it so SMEs can find you.') : t('{done} of {total} done. SMEs can’t find you until it’s published.', undefined, { done: checksDone, total: checks.length }),
            action: { label: t('Continue'), onClick: () => navigate('/consultant/profile') },
        }] : []),
        ...toAccept.map((row) => ({
            key: row.id,
            interventionId: row.id,
            title: t('New: {title}', undefined, { title: row.title }),
            detail: (() => {
                if (!row.createdAt) return row.participant
                const age = today.diff(dayjs(row.createdAt).startOf('day'), 'day')
                return age <= 0
                    ? t('{sme} · assigned today', undefined, { sme: row.participant })
                    : t('{sme} · assigned {days} ago', undefined, { sme: row.participant, days: daysLabel(age) })
            })(),
            action: { label: t('Review'), onClick: () => openIntervention(row.id) },
        })),
        ...lateSorted.filter((row) => waiting(row).yourMove && daysLate(row) < LONG_OVERDUE_DAYS).map((row) => workItem(row, lateTag(row))),
        ...dueSoonOpen.filter((row) => waiting(row).yourMove).map((row) => workItem(row, dueTag(row))),
    ]
    // Work this late is more likely stale than in progress: the useful move is asking operations to extend or close it.
    const longNeeds: NeedItem[] = lateSorted
        .filter((row) => waiting(row).yourMove && daysLate(row) >= LONG_OVERDUE_DAYS)
        .map((row) => ({ ...workItem(row, lateTag(row)), action: { label: t('Extend or close'), onClick: () => setRequesting({ id: row.id, title: row.title, participant: row.participant }) } }))
    const othersNeeds: NeedItem[] = [
        ...lateSorted.filter((row) => !waiting(row).yourMove).map((row) => workItem(row, lateTag(row))),
        ...dueSoonOpen.filter((row) => !waiting(row).yourMove).map((row) => workItem(row, dueTag(row))),
    ]
    const needs = [...yourNeeds, ...longNeeds, ...othersNeeds]
    // Up to seven rows across the groups: each group that has items keeps two in view, then the rest fill in order.
    const needGroups = [yourNeeds, longNeeds, othersNeeds]
    const shownCounts = needGroups.map((group) => Math.min(group.length, 2))
    let spareRows = Math.max(0, 7 - shownCounts.reduce((sum, count) => sum + count, 0))
    needGroups.forEach((group, index) => {
        const extra = Math.min(spareRows, group.length - shownCounts[index])
        shownCounts[index] += extra
        spareRows -= extra
    })
    const [yourShown, longShown, othersShown] = needGroups.map((group, index) => group.slice(0, shownCounts[index]))
    const needsHidden = needs.length - shownCounts.reduce((sum, count) => sum + count, 0)
    const listIds = (items: NeedItem[]) => items.flatMap((item) => (item.interventionId ? [item.interventionId] : []))
    const needsIds = listIds(needs)
    const showList = (ids: string[]) => navigate('/consultant/interventions', { state: { needsYouIds: ids } })
    const viewAllNeeds = () => showList(needsIds)
    // What it's waiting on can wrap to a second line: on a phone it's the part that says whose move it is.
    const needRow = (item: NeedItem) => (
        <div key={item.key} className="consultant-needs-row">
            <div className="consultant-needs-text">
                <Text strong ellipsis>{item.title}</Text>
                <Text type="secondary" className="consultant-needs-detail">{item.detail}</Text>
            </div>
            {item.tag && <Tag bordered={false} color={item.tag.tone === 'danger' ? 'red' : 'gold'} className="consultant-needs-tag">{item.tag.text}</Tag>}
            {item.action && <Button size="small" onClick={item.action.onClick}>{item.action.label}</Button>}
        </div>
    )

    // One sentence that says what the cards don't: the single most pressing thing, by name.
    const firstName = (user?.name || user?.displayName || '').trim().split(/\s+/)[0]
    const hour = dayjs().hour()
    const greeting = hour < 12 ? t('Good morning') : hour < 17 ? t('Good afternoon') : t('Good evening')
    // The sentence and, where there's something to do, the one button that does it.
    const focus: { text: string; action?: { label: string; onClick: () => void } } = (() => {
        if (freelance && profile && !published) return {
            text: t('Your profile is still a draft, so SMEs can’t find you yet.'),
            action: { label: profileReady ? t('Publish your profile') : t('Finish your profile'), onClick: () => navigate('/consultant/profile') },
        }
        // The list below names the items; the greeting gives the totals behind it (the same counts Agentic shows)
        // and opens a whole group at once.
        const ids = (items: AssignedIntervention[]) => items.map((item) => item.id)
        const toAcceptIds = ids(work.toAccept)
        const dueIds = ids(work.yourDue)
        const lateIds = ids(work.yourLate)
        // Of the overdue ones only; long-overdue work still to accept is counted under "to accept".
        const longCount = work.yourLate.filter((item) => work.daysLate(item) >= LONG_OVERDUE_DAYS).length
        const parts = [
            toAcceptIds.length && (toAcceptIds.length === 1 ? t('1 to accept') : t('{count} to accept', undefined, { count: toAcceptIds.length })),
            dueIds.length && (dueIds.length === 1 ? t('1 due this week') : t('{count} due this week', undefined, { count: dueIds.length })),
            lateIds.length && (longCount
                ? t('{count} overdue ({long} over 90 days)', undefined, { count: lateIds.length, long: longCount })
                : lateIds.length === 1 ? t('1 overdue') : t('{count} overdue', undefined, { count: lateIds.length })),
        ].filter((part): part is string => !!part)
        const yours = parts.length
            ? t('On your side: {list}.', undefined, { list: parts.length === 1 ? parts[0] : t('{rest} and {last}', undefined, { rest: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] }) })
            : t('Nothing is waiting on you.')
        const othersCount = work.waitingOnOthers.length
        const others = othersCount === 1
            ? t('1 is waiting on an SME or a reviewer.')
            : othersCount ? t('{count} are waiting on SMEs or reviewers.', undefined, { count: othersCount }) : ''
        if (!parts.length && !others) return { text: rows.length ? t('Nothing needs you right now.') : t('No interventions are assigned to you yet.') }
        const action = toAcceptIds.length
            ? { label: t('Review work to accept'), onClick: () => showList(toAcceptIds) }
            : dueIds.length ? { label: t('See this week’s work'), onClick: () => showList(dueIds) }
                : lateIds.length ? { label: t('See your overdue work'), onClick: () => showList(lateIds) } : undefined
        return { text: [yours, others].filter(Boolean).join(' '), action }
    })()

    const dueItems = useMemo<InterventionDueItem[]>(() => rows
        .filter((row) => row.bucket !== 'completed' && row.bucket !== 'declined' && row.dueDate)
        .map((row) => ({ id: row.id, title: row.title, participantName: row.participant, owner: '', dueDate: dayjs(row.dueDate) })), [rows])

    const modalColumns: ColumnsType<DashboardRow> = [
        { title: t('consultant.common.intervention'), dataIndex: 'title', key: 'title', ellipsis: true },
        { title: t('consultant.common.sme'), dataIndex: 'participant', key: 'participant', ellipsis: true },
        {
            title: t('common.status', 'Status'),
            key: 'status',
            width: 140,
            render: (_, row) => <Tag color={row.bucket === 'overdue' ? 'red' : statusColor(row.status)}>{row.bucket === 'overdue' ? t('consultant.status.overdue', 'Overdue') : row.status}</Tag>,
        },
        { title: t('consultant.common.progress'), dataIndex: 'progress', key: 'progress', width: 150, render: (value: number) => <Progress percent={value} size="small" /> },
        { title: t('consultant.common.due'), dataIndex: 'dueDate', key: 'dueDate', width: 120, render: (value: Date | null) => value ? dayjs(value).format('DD MMM YYYY') : t('consultant.common.noDueDate') },
    ]
    const openMetric = (title: string, list: DashboardRow[]) => setMetricModal({ title, rows: list })

    const feedbackRows = rows
        .filter((row) => row.feedback.comments || row.feedback.rating != null)
        .sort((left, right) => (right.feedback.createdAt?.getTime() || 0) - (left.feedback.createdAt?.getTime() || 0))

    const showNeeds = loading || needs.length > 0
    // An empty feedback card says nothing useful, so it waits until there's feedback to show.
    const showFeedback = loading || feedbackRows.length > 0
    const feedbackBelow = showNeeds && showFeedback
    // Sits in the bottom row, or beside the week when there's no Needs you list.
    const feedbackCard = (
        <Card loading={loading} className="dashboard-section-card motion-card" title={t('consultant.dashboard.recentFeedback')} style={{ height: '100%' }}>
            <List
                dataSource={feedbackRows.slice(0, 3)}
                locale={{ emptyText: t('consultant.dashboard.noFeedback') }}
                renderItem={(row) => (
                    <List.Item>
                        <List.Item.Meta
                            title={<Space wrap><Text strong>{row.participant}</Text>{row.feedback.rating != null && <Tag bordered={false}>{row.feedback.rating}/5</Tag>}</Space>}
                            description={row.feedback.comments || row.title}
                        />
                    </List.Item>
                )}
            />
        </Card>
    )

    return (
        <DashboardPage className="consultant-page consultant-dashboard">
            {/* Today's work first (what's open, due soon, late), then the month's output. Trends compare like with like:
                snapshots of the open and due counts back then, and the previous 30 days for completions. */}
            <Row gutter={[16, 16]} className="dashboard-metrics-row consultant-metrics">
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        onClick={() => openMetric(t('Open now'), headline.open)}
                        loading={loading}
                        icon={<FolderOpenOutlined />}
                        label={t('Open now')}
                        value={headline.open.length}
                        hint={t('Accepted or waiting to be accepted, not yet completed')}
                        trend={trendFor(headline.open.length, openAt(windowStart).length, 'neutral', t('vs 30 days ago'))}
                        sparkline={[...weeksBack.slice(0, -1).map((week) => openAt(week.to).length), headline.open.length]}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        onClick={() => openMetric(t('Due this week'), headline.dueThisWeek)}
                        loading={loading}
                        icon={<CalendarOutlined />}
                        iconClassName="is-progress"
                        label={t('Due this week')}
                        value={headline.dueThisWeek.length}
                        hint={t('Open work due in the next 7 days')}
                        trend={trendFor(headline.dueThisWeek.length, dueWithinWeekOf(now.subtract(1, 'week'), openAt(now.subtract(1, 'week'))).length, 'neutral', t('vs a week ago'))}
                        sparkline={[...weeksBack.slice(0, -1).map((week) => dueWithinWeekOf(week.to, openAt(week.to)).length), headline.dueThisWeek.length]}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        onClick={() => openMetric(t('consultant.status.overdue', 'Overdue'), lateSorted)}
                        loading={loading}
                        icon={<WarningOutlined />}
                        iconClassName="is-risk"
                        label={t('consultant.status.overdue', 'Overdue')}
                        value={overdue.length}
                        hint={t('Open work past its due date')}
                        trend={trendFor(overdue.length, overdueAt(windowStart), 'lower', t('vs 30 days ago'))}
                        // Weekly snapshots of how much was overdue, ending with today's count.
                        sparkline={[...weeksBack.slice(0, -1).map((week) => overdueAt(week.to)), overdue.length]}
                    />
                </Col>
                <Col xs={12} lg={6}>
                    <DashboardMetricCard
                        onClick={() => openMetric(t('Completed in the last 30 days'), headline.completed)}
                        loading={loading}
                        icon={<CheckCircleOutlined />}
                        iconClassName="is-success"
                        label={t('Completed (30 days)')}
                        value={headline.completed.length}
                        hint={t('Completed in the last 30 days')}
                        trend={trendFor(headline.completed.length, completedIn(previousStart, windowStart).length, 'higher', versusLast30)}
                        sparkline={weeksBack.map((week) => completedIn(week.from, week.to).length)}
                    />
                </Col>
            </Row>

            <Card loading={loading} className="dashboard-section-card consultant-dashboard-greeting">
                <div className="consultant-dashboard-greeting-body">
                    <div>
                        <Text type="secondary">{dayjs().format('dddd D MMMM')}</Text>
                        <p>{firstName ? `${greeting}, ${firstName}. ` : `${greeting}. `}{focus.text}</p>
                    </div>
                    {focus.action && <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={focus.action.onClick}>{focus.action.label}</Button>}
                </div>
            </Card>

            <Row gutter={[16, 16]}>
                {/* With nothing to list, the greeting already says so; recent feedback moves up beside the week instead. */}
                {showNeeds && <Col xs={24} xl={14}>
                    <Card loading={loading} className="dashboard-section-card motion-card" title={t('Needs you')} extra={needsIds.length > 0 && <Button type="link" size="small" onClick={viewAllNeeds}>{t('View all')}</Button>} style={{ height: '100%' }}>
                        <div className="consultant-needs">
                            {yourShown.map(needRow)}
                            {longShown.length > 0 && (
                                <>
                                    <Text type="secondary" className="consultant-needs-group">{t('Over 90 days late: ask to extend or close')}</Text>
                                    {longShown.map(needRow)}
                                </>
                            )}
                            {othersShown.length > 0 && (
                                <>
                                    <Text type="secondary" className="consultant-needs-group">{t('Waiting on others')}</Text>
                                    {othersShown.map(needRow)}
                                </>
                            )}
                            {needsHidden > 0 && <Button type="link" size="small" className="consultant-needs-more" onClick={viewAllNeeds}>{t('+{count} more on your interventions page', undefined, { count: needsHidden })}</Button>}
                        </div>
                    </Card>
                </Col>}
                <Col xs={24} xl={showNeeds ? 10 : showFeedback ? 12 : 24}>
                    <UpcomingWeekCard interventionDueItems={dueItems} loading={loading} assigneeUid={user?.uid} />
                </Col>
                {!showNeeds && showFeedback && <Col xs={24} xl={12}>{feedbackCard}</Col>}
            </Row>

            <Card
                loading={loading}
                className="dashboard-section-card motion-card consultant-performance"
                title={<Space><LineChartOutlined /> {t('Performance')}</Space>}
                extra={<Segmented size="small" value={perfRange} onChange={(value) => setPerfRange(value as 'weekly' | 'monthly')} options={[{ value: 'weekly', label: t('Weekly') }, { value: 'monthly', label: t('Monthly') }]} />}
                style={{ marginTop: 16 }}
            >
                <div className="consultant-performance-body">
                    {/* The legend carries each line's total for the range, so the numbers are readable without hovering. */}
                    <ul className="consultant-performance-legend">
                        {perfSeries.map((series) => (
                            <li key={series.key}>
                                <span className="consultant-performance-key"><i style={{ background: series.color }} />{series.name}</span>
                                <strong>{series.total.toLocaleString()}</strong>
                            </li>
                        ))}
                        <li className="consultant-performance-range">{perfRange === 'weekly' ? t('Last 12 weeks') : t('Last 6 months')}</li>
                    </ul>
                    <div className="consultant-performance-chart"><ThemedHighcharts options={performanceChart} /></div>
                </div>
            </Card>

            {(freelance || feedbackBelow) && <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                {freelance && (
                    <Col xs={24} xl={feedbackBelow ? 12 : 24}>
                        <Card className="dashboard-section-card motion-card" title={<Space><ShopOutlined /> {t('Marketplace profile')}</Space>} extra={<Tag color={published ? 'green' : 'gold'} style={{ marginInlineEnd: 0 }}>{published ? t('Published') : t('Draft')}</Tag>} style={{ height: '100%' }}>
                            {profile ? (
                                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                                    <div>
                                        <Text type="secondary">{t('Profile {done} of {total} done', undefined, { done: checksDone, total: checks.length })}</Text>
                                        <Progress percent={Math.round((checksDone / Math.max(1, checks.length)) * 100)} showInfo={false} size="small" strokeColor="#15803D" />
                                    </div>
                                    <div className="consultant-dashboard-fact"><Text type="secondary">{t('Accepting new requests')}</Text><Text strong>{profile.acceptingClients ? t('Yes') : t('No')}</Text></div>
                                    <div className="consultant-dashboard-fact"><Text type="secondary">{t('Client rating')}</Text><Text strong>{averageRating === null ? t('No ratings yet') : `${averageRating.toFixed(1)} / 5 · ${ratings.length === 1 ? t('1 rating') : t('{count} ratings', undefined, { count: ratings.length })}`}</Text></div>
                                    <div className="consultant-dashboard-actions">
                                        <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>{t('Preview as SME')}</Button>
                                        <Button icon={<EditOutlined />} onClick={() => navigate('/consultant/profile')}>{t('Edit profile')}</Button>
                                    </div>
                                </Space>
                            ) : <Text type="secondary">{t('Loading your profile')}</Text>}
                        </Card>
                    </Col>
                )}
                {feedbackBelow && <Col xs={24} xl={freelance ? 12 : 24}>{feedbackCard}</Col>}
            </Row>}

            <ChangeRequestModal assignment={requesting} onClose={() => setRequesting(null)} onSent={() => void refresh()} />

            <ResponsiveModal
                open={!!metricModal}
                onClose={() => setMetricModal(null)}
                title={metricModal ? `${metricModal.title} (${metricModal.rows.length})` : ''}
                width={900}
                centered
            >
                <Table
                    columns={modalColumns}
                    dataSource={metricModal?.rows || []}
                    rowKey="id"
                    size="middle"
                    pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'], hideOnSinglePage: true }}
                    locale={{ emptyText: t('consultant.dashboard.noActive') }}
                    scroll={{ x: 720 }}
                />
            </ResponsiveModal>

            {profile && (
                <ResponsiveModal open={previewOpen} onClose={() => setPreviewOpen(false)} title={t('How SMEs see your profile')} width={520} centered className="consultant-profile-preview-modal">
                    <ConsultantMarketplaceCard profile={profile} action={<Button type="primary" block disabled>{t('Choose this consultant')}</Button>} />
                </ResponsiveModal>
            )}
        </DashboardPage>
    )
}

export default ConsultantDashboardPage
