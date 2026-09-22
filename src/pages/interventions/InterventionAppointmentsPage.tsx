import { App, Button, Card, Col, DatePicker, Form, Input, Modal, Progress, Row, Segmented, Select, Space, Tooltip, Typography, Upload } from 'antd'
import { CheckCircleOutlined, EditOutlined, LeftOutlined, PlusOutlined, RightOutlined, SaveOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'
import { addDoc, arrayUnion, collection, doc, getDocs, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { AppointmentCalendar } from '@/components/interventions/AppointmentCalendar'
import AppointmentDayPanel from '@/components/interventions/AppointmentDayPanel'
import AppointmentDetailModal from '@/components/interventions/AppointmentDetailModal'
import {
    CALENDAR_VIEWS,
    MEETING_TYPE_OPTIONS,
    dayKey,
    navigationUnit,
    rangeLabel,
    toDate,
    toDayjs,
    type AppointmentStatus,
    type CalendarView,
    type MeetingType,
} from '@/components/interventions/appointmentSchedule'
import { db } from '@/firebase'
import { useAssignedInterventions, type AssignedIntervention } from '@/contexts/AssignedInterventionsContext'
import { useActiveProgramId } from '@/hooks/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { sendAdminEmail } from '@/services/emailOperationsService'
import { matchesActiveProgram } from '@/services/workspaceProgramsService'

type AppointmentRow = {
    id: string
    companyCode?: string | null
    assignedInterventionId: string
    interventionTitle: string
    participantId?: string | null
    participantName?: string | null
    participantEmail?: string | null
    programId?: string | null
    programName?: string | null
    assigneeId?: string | null
    assigneeEmail?: string | null
    meetingType: MeetingType
    meetingLink?: string | null
    location?: string | null
    startTime?: unknown
    endTime?: unknown
    status: AppointmentStatus
    attendance?: Record<string, 'present' | 'absent'>
    discussionSummary?: string
    progressUpdated?: boolean
    [key: string]: unknown
}

type AppointmentForm = {
    assignedInterventionId: string
    meetingType: MeetingType
    meetingLink?: string
    location?: string
    timeRange: [Dayjs, Dayjs]
}

type OutcomeForm = {
    attendanceStatus: 'present' | 'absent'
    discussionSummary: string
    hoursAdded?: number
    unitsAdded?: number
    progressAfter?: number
}

const { RangePicker } = DatePicker

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const LEGEND: Array<{ status: AppointmentStatus; label: string }> = [
    { status: 'pending', label: 'Awaiting acceptance' },
    { status: 'accepted', label: 'Confirmed' },
    { status: 'completed', label: 'Completed' },
    { status: 'cancelled', label: 'Cancelled or declined' },
]

const clampProgress = (value: number) => Math.max(0, Math.min(100, Math.round(value)))
const safeNumber = (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
}

const AppointmentGuide = ({ text, onComplete }: { text: string; onComplete: () => void }) => {
    const [visible, setVisible] = useState('')
    const onCompleteRef = useRef(onComplete)
    useEffect(() => { onCompleteRef.current = onComplete }, [onComplete])
    useEffect(() => {
        let index = 0
        let completeTimer: number | undefined
        const timer = window.setInterval(() => { index += 1; setVisible(text.slice(0, index)); if (index >= text.length) { window.clearInterval(timer); completeTimer = window.setTimeout(() => onCompleteRef.current(), 650) } }, 22)
        return () => { window.clearInterval(timer); if (completeTimer) window.clearTimeout(completeTimer) }
    }, [text])
    return <div className="appointment-modal-guide"><Typography.Text strong>Thuso · appointment guide</Typography.Text><Typography.Paragraph type="secondary">{visible}<span className="appointment-typing-cursor" aria-hidden="true" /></Typography.Paragraph></div>
}

const OUTCOME_PROMPTS = [
    'First, did the SME attend this appointment?',
    'Now capture the key outcome from the conversation.',
    'Let’s record the progress this appointment contributed to. These values work together, so you can update any that apply.',
    'Finally, attach supporting evidence if you have it. Then I can complete the appointment.',
]

const progressFromOutcome = (assignment: AssignedIntervention | undefined, values: OutcomeForm) => {
    const explicit = safeNumber(values.progressAfter)
    if (explicit != null) return clampProgress(explicit)

    const targetType = normalize(assignment?.targetType)
    const targetValue = safeNumber(assignment?.targetValue)
    if (targetType !== 'number' || !targetValue) return clampProgress(Number(assignment?.progress || 0))

    const currentActual = safeNumber(assignment?.targetActual) || 0
    const units = normalize(assignment?.targetMetric).includes('hour')
        ? safeNumber(values.hoursAdded) || 0
        : safeNumber(values.unitsAdded) || 0

    return clampProgress(((currentActual + units) / targetValue) * 100)
}

const targetActualFromOutcome = (assignment: AssignedIntervention | undefined, values: OutcomeForm) => {
    if (normalize(assignment?.targetType) !== 'number') return safeNumber(assignment?.targetActual)
    const currentActual = safeNumber(assignment?.targetActual) || 0
    const units = normalize(assignment?.targetMetric).includes('hour')
        ? safeNumber(values.hoursAdded) || 0
        : safeNumber(values.unitsAdded) || 0
    return currentActual + units
}

export const InterventionAppointmentsPage = () => {
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { assignments, loading: assignmentsLoading, refresh: refreshAssignments, isMine } = useAssignedInterventions()
    const [searchParams, setSearchParams] = useSearchParams()
    const [form] = Form.useForm<AppointmentForm>()
    const [outcomeForm] = Form.useForm<OutcomeForm>()
    const [appointments, setAppointments] = useState<AppointmentRow[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState('')
    const [createOpen, setCreateOpen] = useState(false)
    const [selected, setSelected] = useState<AppointmentRow>()
    const [outcomeOpen, setOutcomeOpen] = useState(false)
    const [detailOpen, setDetailOpen] = useState(false)
    const [evidenceFiles, setEvidenceFiles] = useState<string[]>([])
    const [anchorDate, setAnchorDate] = useState(dayjs())
    const [calendarView, setCalendarView] = useState<CalendarView>('month')
    const [selectedDate, setSelectedDate] = useState(dayjs())
    const [createGuideComplete, setCreateGuideComplete] = useState(false)
    const [outcomeGuideComplete, setOutcomeGuideComplete] = useState(false)
    const [outcomeStep, setOutcomeStep] = useState(0)

    const assignableInterventions = useMemo(() => assignments
        .filter(isMine)
        .filter((assignment) => matchesActiveProgram(user, activeProgramId, String(assignment.programId || '')))
        .filter((assignment) => !['completed', 'cancelled', 'declined'].includes(normalize(assignment.status))),
        [activeProgramId, assignments, isMine, user])

    const interventionById = useMemo(() => new Map(assignments.map((assignment) => [assignment.id, assignment])), [assignments])

    const loadAppointments = async () => {
        if (!user?.companyCode) return
        try {
            setLoading(true)
            const snapshot = await getDocs(query(collection(db, 'appointments'), where('companyCode', '==', user.companyCode)))
            const appointmentRows: AppointmentRow[] = snapshot.docs.map((row) => ({
                ...(row.data() as AppointmentRow),
                id: row.id,
            }))
            setAppointments(appointmentRows
                .filter((appointment) => {
                    const assignment = interventionById.get(appointment.assignedInterventionId)
                    if (!assignment) return false
                    if (!isMine(assignment)) return false
                    return matchesActiveProgram(user, activeProgramId, String(appointment.programId || assignment.programId || ''))
                }))
        } catch {
            message.error('Appointments could not be loaded.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        void loadAppointments()
    }, [user?.companyCode, activeProgramId, assignments.length]) // eslint-disable-line react-hooks/exhaustive-deps

    const rows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return appointments
            .filter((appointment) => {
                if (!needle) return true
                return `${appointment.interventionTitle} ${appointment.participantName} ${appointment.participantEmail} ${appointment.programName}`.toLowerCase().includes(needle)
            })
            .sort((left, right) => (toDate(left.startTime)?.getTime() ?? 0) - (toDate(right.startTime)?.getTime() ?? 0))
    }, [appointments, search])

    const metrics = useMemo(() => ({
        total: appointments.length,
        pending: appointments.filter((appointment) => appointment.status === 'pending').length,
        accepted: appointments.filter((appointment) => appointment.status === 'accepted').length,
        completed: appointments.filter((appointment) => appointment.status === 'completed').length,
    }), [appointments])

    // Sample week used only while a workspace has no appointments yet, so the calendar still reads as
    // a calendar. Memoised because dayjs() would otherwise produce new times on every render.
    const demoAppointments = useMemo<AppointmentRow[]>(() => {
        const at = (dayOffset: number, hour: number, minute = 0) => dayjs().add(dayOffset, 'day').hour(hour).minute(minute).second(0)
        const make = (id: string, interventionTitle: string, participantName: string, meetingType: MeetingType, status: AppointmentStatus, dayOffset: number, hour: number, minute = 0, durationMinutes = 60): AppointmentRow => ({
            id, assignedInterventionId: '', interventionTitle, participantName, meetingType, status,
            startTime: at(dayOffset, hour, minute).toISOString(),
            endTime: at(dayOffset, hour, minute).add(durationMinutes, 'minute').toISOString(),
        })
        return [
            make('demo-1', 'Growth strategy review', 'Moyo Foods', 'online', 'accepted', 0, 9),
            make('demo-2', 'Finance check-in', 'Kuhle Designs', 'in_person', 'pending', 0, 11),
            make('demo-3', 'Team sync call', 'Ubuntu Crafts', 'telephonic', 'completed', 0, 13),
            make('demo-4', 'SME check-in', 'Ndlovu Traders', 'online', 'accepted', 0, 15),
            make('demo-5', 'Planning session', 'Bright Start', 'in_person', 'pending', 0, 16, 30),
            make('demo-6', 'Marketing roadmap', 'Riverstone Bakery', 'online', 'accepted', 1, 10),
            make('demo-7', 'Operations review', 'Mahlangu Logistics', 'in_person', 'pending', 2, 14),
            make('demo-8', 'Funding readiness', 'Kopano Farms', 'telephonic', 'accepted', -1, 9, 30),
            make('demo-9', 'People planning', 'Future Tech', 'online', 'completed', -1, 13),
            make('demo-10', 'Pitch practice', 'Kaya Studio', 'online', 'accepted', 4, 11),
            make('demo-11', 'Compliance check', 'Sunrise Retail', 'in_person', 'pending', 6, 9),
            make('demo-12', 'Digital tools session', 'Sunrise Retail', 'online', 'accepted', 6, 9, 30),
            make('demo-13', 'Follow-up review', 'Sunrise Retail', 'telephonic', 'pending', 6, 10),
            make('demo-14', 'Board prep', 'Sunrise Retail', 'online', 'accepted', 6, 10, 30),
            make('demo-15', 'Export readiness', 'Sunrise Retail', 'in_person', 'pending', 6, 14),
            make('demo-16', 'Cash flow clinic', 'Sunrise Retail', 'telephonic', 'completed', 6, 16),
        ]
    }, [])

    const calendarRows = rows.length ? rows : demoAppointments
    const isDemoData = rows.length === 0

    // One pre-bucketed lookup keeps the panel from rescanning the whole list on every render.
    const selectedDayAppointments = useMemo(() => {
        const key = dayKey(selectedDate)
        return calendarRows.filter((row) => {
            const start = toDayjs(row.startTime)
            return start ? dayKey(start) === key : false
        })
    }, [calendarRows, selectedDate])

    const heading = rangeLabel(calendarView, anchorDate)
    const visibleCount = calendarView === 'agenda' ? calendarRows.length : selectedDayAppointments.length

    const moveCalendar = (direction: -1 | 1) => {
        const next = anchorDate.add(direction, navigationUnit(calendarView))
        setAnchorDate(next)
        // Day view has a single day on screen, so the selection follows the navigation.
        if (calendarView === 'day') setSelectedDate(next)
        else if (!next.isSame(selectedDate, calendarView === 'week' ? 'week' : 'month')) setSelectedDate(next.startOf(calendarView === 'week' ? 'week' : 'month'))
    }

    const goToToday = () => {
        const now = dayjs()
        setAnchorDate(now)
        setSelectedDate(now)
    }

    const handleSelectDate = (date: Dayjs) => {
        setSelectedDate(date)
        // Clicking a trailing/leading month cell should page the grid to that month.
        if (!date.isSame(anchorDate, navigationUnit(calendarView))) setAnchorDate(date)
        if (calendarView === 'day') setAnchorDate(date)
    }

    const handleChangeView = (next: CalendarView) => {
        setCalendarView(next)
        if (next === 'day') setAnchorDate(selectedDate)
    }

    useRegisterAgentPageContext({
        pageKey: 'operations-intervention-appointments',
        pageName: 'Intervention appointments',
        purpose: 'Schedule intervention appointments, capture attendance and discussion outcomes, and convert completed meetings into intervention progress updates.',
        filters: { search, activeProgramId, calendarView, selectedDate: selectedDate.format('YYYY-MM-DD') },
        metrics,
        tables: { visibleAppointments: rows.length },
        selectedRecord: selected?.interventionTitle,
    })

    const openCreate = () => {
        form.resetFields()
        form.setFieldsValue({ timeRange: [selectedDate.hour(9).minute(0), selectedDate.hour(10).minute(0)] })
        setCreateGuideComplete(false)
        setCreateOpen(true)
    }

    useEffect(() => {
        if (searchParams.get('create') !== '1') return
        openCreate()
        const next = new URLSearchParams(searchParams)
        next.delete('create')
        setSearchParams(next, { replace: true })
    }, [searchParams, setSearchParams]) // openCreate is intentionally stable for this form reset.

    const saveAppointment = async (values: AppointmentForm) => {
        if (!user) return
        const assignment = interventionById.get(values.assignedInterventionId)
        if (!assignment) return

        try {
            setSaving(true)
            const appointmentRef = await addDoc(collection(db, 'appointments'), {
                companyCode: user.companyCode || null,
                assignedInterventionId: assignment.id,
                interventionId: assignment.interventionId,
                interventionTitle: assignment.interventionTitle || 'Intervention',
                participantId: assignment.participantId || null,
                participantName: assignment.businessName || null,
                participantEmail: assignment.beneficiaryEmail || assignment.email || null,
                programId: assignment.programId || null,
                programName: assignment.programName || null,
                assigneeId: assignment.assigneeId || user.uid,
                assigneeEmail: assignment.assigneeEmail || user.email,
                meetingType: values.meetingType,
                meetingLink: values.meetingLink || null,
                location: values.location || null,
                startTime: Timestamp.fromDate(values.timeRange[0].toDate()),
                endTime: Timestamp.fromDate(values.timeRange[1].toDate()),
                status: 'pending',
                requiresSmeAcceptance: true,
                acceptanceBundle: 'intervention_and_appointment',
                attendance: {},
                createdByUid: user.uid,
                createdByEmail: user.email,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            })
            await addDoc(collection(db, 'notifications'), {
                companyCode: user.companyCode || null,
                type: 'appointment_scheduled',
                appointmentId: appointmentRef.id,
                assignedInterventionId: assignment.id,
                participantId: assignment.participantId || null,
                recipientRoles: ['incubatee', 'operations', 'consultant'],
                message: `${assignment.interventionTitle || 'Intervention'} appointment has been scheduled and is awaiting SME acceptance.`,
                createdAt: serverTimestamp(),
                readBy: {},
            })
            message.success('Appointment scheduled.')
            setCreateOpen(false)
            setSelectedDate(values.timeRange[0])
            setAnchorDate(values.timeRange[0])
            await loadAppointments()
        } catch {
            message.error('Appointment could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    const openDetail = (appointment: AppointmentRow) => {
        setSelected(appointment)
        setDetailOpen(true)
    }

    const openOutcome = (appointment: AppointmentRow) => {
        setDetailOpen(false)
        setSelected(appointment)
        setOutcomeGuideComplete(false)
        setOutcomeStep(0)
        setOutcomeOpen(true)
        setEvidenceFiles([])
        const assignment = interventionById.get(appointment.assignedInterventionId)
        outcomeForm.setFieldsValue({
            attendanceStatus: 'present',
            progressAfter: Number(assignment?.progress || 0),
            hoursAdded: undefined,
            unitsAdded: undefined,
            discussionSummary: appointment.discussionSummary || '',
        })
    }

    const advanceOutcome = async (fields: Array<keyof OutcomeForm>) => {
        try {
            await outcomeForm.validateFields(fields)
            setOutcomeGuideComplete(false)
            setOutcomeStep((step) => step + 1)
        } catch {
            // Ant Design renders the field-level validation message.
        }
    }

    const completeAppointment = async (values: OutcomeForm) => {
        if (!selected || !user) return
        const assignment = interventionById.get(selected.assignedInterventionId)
        const progressBefore = Number(assignment?.progress || 0)
        const progressAfter = progressFromOutcome(assignment, values)
        const targetActualAfter = targetActualFromOutcome(assignment, values)
        const hoursAdded = safeNumber(values.hoursAdded) || 0
        const unitsAdded = safeNumber(values.unitsAdded) || 0
        const timeSpentBefore = safeNumber(assignment?.timeSpent) || 0

        try {
            setSaving(true)
            await updateDoc(doc(db, 'appointments', selected.id), {
                status: 'completed',
                attendance: {
                    ...(selected.attendance || {}),
                    [selected.participantEmail || selected.participantId || 'participant']: values.attendanceStatus,
                },
                discussionSummary: values.discussionSummary,
                evidenceFiles,
                progressUpdated: true,
                completedAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
            })

            if (assignment) {
                await updateDoc(doc(db, 'assignedInterventions', assignment.id), {
                    progress: progressAfter,
                    targetActual: targetActualAfter ?? null,
                    timeSpent: timeSpentBefore + hoursAdded,
                    notes: values.discussionSummary,
                    status: progressAfter >= 100 ? 'awaiting_confirmation' : 'in-progress',
                    assigneeStatus: 'accepted',
                    assigneeCompletionStatus: progressAfter >= 100 ? 'done' : 'pending',
                    updatedAt: serverTimestamp(),
                    progressSteps: arrayUnion({
                        createdAt: Timestamp.now(),
                        actorUid: user.uid,
                        actorRole: user.role,
                        source: 'appointment',
                        appointmentId: selected.id,
                        attendanceStatus: values.attendanceStatus,
                        hoursAdded,
                        unitsAdded,
                        progressBefore,
                        progressAfter,
                        targetActualAfter: targetActualAfter ?? null,
                        discussionSummary: values.discussionSummary,
                        evidenceFiles,
                    }),
                })
            }

            await addDoc(collection(db, 'notifications'), {
                companyCode: user.companyCode || null,
                type: 'appointment_completed_progress_update',
                appointmentId: selected.id,
                assignedInterventionId: selected.assignedInterventionId,
                participantId: selected.participantId || null,
                recipientRoles: ['operations', 'consultant', 'incubatee'],
                message: `Appointment completed. Attendance was marked ${values.attendanceStatus} and intervention progress was updated to ${progressAfter}%.`,
                createdAt: serverTimestamp(),
                readBy: {},
            })

            if (user.email) {
                try {
                    await sendAdminEmail({
                        to: user.email,
                        subject: 'Appointment completed: provide meeting outcome',
                        message: `Your appointment for ${selected.interventionTitle} was completed. Attendance, discussion notes, and evidence were captured and used to update intervention progress.`,
                    })
                } catch {
                    await addDoc(collection(db, 'notifications'), {
                        companyCode: user.companyCode || null,
                        type: 'appointment_email_failed',
                        appointmentId: selected.id,
                        recipientRoles: ['operations'],
                        message: `Email notification could not be sent for completed appointment ${selected.interventionTitle}.`,
                        createdAt: serverTimestamp(),
                        readBy: {},
                    })
                }
            }

            message.success('Appointment completed and progress updated.')
            setOutcomeOpen(false)
            setSelected(undefined)
            await Promise.all([loadAppointments(), refreshAssignments()])
        } catch {
            message.error('Appointment outcome could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <DashboardPage className="operations-appointments-page">
            {(loading || saving || assignmentsLoading) && <LoadingOverlay tip={saving ? 'Saving appointment' : 'Loading appointments'} />}

            <div className="apt-workspace">
                <Card className="apt-calendar-card" styles={{ body: { padding: 0 } }}>
                    <div className="apt-toolbar">
                        <div className="apt-toolbar-title">
                            <Typography.Title level={3}>{heading}</Typography.Title>
                            <Typography.Text type="secondary">
                                {calendarView === 'agenda'
                                    ? `${visibleCount} appointment${visibleCount === 1 ? '' : 's'} in view`
                                    : `${selectedDate.format('ddd DD MMM')} · ${visibleCount} appointment${visibleCount === 1 ? '' : 's'}`}
                                {metrics.pending > 0 && ` · ${metrics.pending} awaiting acceptance`}
                            </Typography.Text>
                        </div>
                        <div className="apt-toolbar-controls">
                            <Button shape="circle" aria-label="Previous range" icon={<LeftOutlined />} onClick={() => moveCalendar(-1)} />
                            <Segmented value={calendarView} onChange={(value) => handleChangeView(value as CalendarView)} options={CALENDAR_VIEWS} />
                            <Button shape="circle" aria-label="Next range" icon={<RightOutlined />} onClick={() => moveCalendar(1)} />
                            <Button onClick={goToToday}>Today</Button>
                            <Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" allowClear />
                            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>New</Button>
                        </div>
                    </div>

                    <div className="apt-legend">
                        {LEGEND.map((entry) => <span key={entry.status} className={`apt-legend-item is-${entry.status}`}><i />{entry.label}</span>)}
                        {isDemoData && <Tooltip title="No appointments exist for this program yet, so a sample week is shown."><span className="apt-legend-sample">Sample data</span></Tooltip>}
                    </div>

                    <div className="apt-calendar-body">
                        <AppointmentCalendar
                            appointments={calendarRows}
                            view={calendarView}
                            anchorDate={anchorDate}
                            selectedDate={selectedDate}
                            selectedId={selected?.id}
                            onSelectDate={handleSelectDate}
                            onSelectAppointment={openDetail}
                            onExpandDay={(date) => { setSelectedDate(date); setSelected(undefined) }}
                        />
                    </div>
                </Card>

                <Card className="apt-panel-card" styles={{ body: { padding: 0 } }}>
                    <AppointmentDayPanel
                        date={selectedDate}
                        appointments={selectedDayAppointments}
                        selected={selectedDayAppointments.find((row) => row.id === selected?.id)}
                        onSelect={openDetail}
                        onCreate={openCreate}
                    />
                </Card>
            </div>

            <AppointmentDetailModal
                open={detailOpen}
                appointment={selected}
                onClose={() => setDetailOpen(false)}
                onComplete={openOutcome}
            />

            <Modal open={createOpen} title="New appointment" onCancel={() => setCreateOpen(false)} footer={null} width={820} destroyOnHidden>
                <AppointmentGuide text="Let’s schedule a useful conversation. Choose the intervention, how you’ll meet, and a time that works for everyone." onComplete={() => setCreateGuideComplete(true)} />
                {createGuideComplete && <Form className="appointment-modal-reveal" form={form} layout="vertical" onFinish={saveAppointment}>
                    <Form.Item name="assignedInterventionId" label="Assigned intervention" rules={[{ required: true, message: 'Choose an intervention.' }]}>
                        <Select showSearch optionFilterProp="label" options={assignableInterventions.map((assignment) => ({ value: assignment.id, label: `${assignment.interventionTitle || 'Intervention'} - ${assignment.businessName || 'SME'}` }))} />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} md={12}><Form.Item name="meetingType" label="Meeting type" rules={[{ required: true }]}><Select options={MEETING_TYPE_OPTIONS} /></Form.Item></Col>
                        <Col xs={24} md={12}><Form.Item name="timeRange" label="Date and time" rules={[{ required: true }]}><RangePicker showTime format="DD MMM YYYY HH:mm" style={{ width: '100%' }} /></Form.Item></Col>
                    </Row>
                    <Form.Item noStyle dependencies={['meetingType']}>
                        {({ getFieldValue }) => {
                            const type = getFieldValue('meetingType')
                            if (type === 'online') return <Form.Item name="meetingLink" label="Meeting link" rules={[{ required: true }]}><Input placeholder="Paste Zoom, Google Meet, Teams, or any online meeting link" /></Form.Item>
                            if (type === 'in_person') return <Form.Item name="location" label="Location" rules={[{ required: true }]}><Input.TextArea rows={3} /></Form.Item>
                            return null
                        }}
                    </Form.Item>
                    <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                        <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>Save appointment</Button>
                    </Space>
                </Form>}
            </Modal>

            <Modal open={outcomeOpen} title="Complete appointment" onCancel={() => setOutcomeOpen(false)} footer={null} width={820} destroyOnHidden>
                {selected && (
                    <>
                        <AppointmentGuide key={outcomeStep} text={OUTCOME_PROMPTS[outcomeStep] ?? OUTCOME_PROMPTS[0]} onComplete={() => setOutcomeGuideComplete(true)} />
                        {outcomeGuideComplete && <Form className="appointment-modal-reveal" form={outcomeForm} layout="vertical" onFinish={completeAppointment}>
                            <div className="appointment-outcome-context">
                                <Typography.Text strong>{selected.interventionTitle}</Typography.Text>
                                <Typography.Text type="secondary">{selected.participantName || selected.participantEmail || 'SME'}</Typography.Text>
                            </div>
                            {outcomeStep === 0 && <>
                                <Form.Item name="attendanceStatus" label="Attendance" rules={[{ required: true, message: 'Choose an attendance status.' }]}>
                                    <Select options={[{ value: 'present', label: 'Present' }, { value: 'absent', label: 'Absent' }]} />
                                </Form.Item>
                                <Button type="primary" block icon={<RightOutlined />} onClick={() => void advanceOutcome(['attendanceStatus'])}>Continue</Button>
                            </>}
                            {outcomeStep === 1 && <>
                                <Form.Item name="discussionSummary" label="What was discussed?" rules={[{ required: true, message: 'Add discussion notes.' }]}>
                                    <Input.TextArea rows={6} autoFocus />
                                </Form.Item>
                                <Button type="primary" block icon={<RightOutlined />} onClick={() => void advanceOutcome(['discussionSummary'])}>Continue</Button>
                            </>}
                            {outcomeStep === 2 && <>
                                <Row gutter={12}>
                                    <Col xs={24} md={8}><Form.Item name="hoursAdded" label="Hours added"><Input type="number" min={0} autoFocus /></Form.Item></Col>
                                    <Col xs={24} md={8}><Form.Item name="unitsAdded" label="Units completed"><Input type="number" min={0} /></Form.Item></Col>
                                    <Col xs={24} md={8}><Form.Item name="progressAfter" label="Progress after (%)"><Input type="number" min={0} max={100} /></Form.Item></Col>
                                </Row>
                                <Button type="primary" block icon={<RightOutlined />} onClick={() => { setOutcomeGuideComplete(false); setOutcomeStep(3) }}>Continue</Button>
                            </>}
                            {outcomeStep === 3 && <>
                                <Form.Item label="Images or evidence">
                                    <Upload beforeUpload={() => false} multiple onChange={({ fileList }) => setEvidenceFiles(fileList.map((file) => file.name))}>
                                        <Button icon={<EditOutlined />}>Choose files</Button>
                                    </Upload>
                                </Form.Item>
                                <Progress percent={progressFromOutcome(interventionById.get(selected.assignedInterventionId), outcomeForm.getFieldsValue())} />
                                <Space className="appointment-outcome-actions">
                                    <Button onClick={() => setOutcomeOpen(false)}>Cancel</Button>
                                    <Button type="primary" htmlType="submit" icon={<CheckCircleOutlined />} loading={saving}>Complete appointment</Button>
                                </Space>
                            </>}
                        </Form>}
                    </>
                )}
            </Modal>
        </DashboardPage>
    )
}

export default InterventionAppointmentsPage
