import { Alert, Button, Modal, Tag } from 'antd'
import { CalendarOutlined, CheckCircleOutlined, ClockCircleOutlined, ExportOutlined, RedoOutlined, EnvironmentOutlined, InfoCircleOutlined, LinkOutlined, PhoneOutlined, TeamOutlined, VideoCameraOutlined } from '@ant-design/icons'
import {
    formatSpan,
    isInterventionDropRequest,
    meetingTypeLabel,
    openRescheduleRequestSummary,
    statusColor,
    statusLabel,
    toDayjs,
    type AppointmentStatus,
    type CalendarAppointment,
    type MeetingType,
} from './appointmentSchedule'

const meetingTypeIcon = (value?: MeetingType) => {
    if (value === 'online') return <VideoCameraOutlined />
    if (value === 'in_person') return <EnvironmentOutlined />
    return <PhoneOutlined />
}

const statusCopy = (status: AppointmentStatus) => {
    if (status === 'completed') return 'This appointment is complete. Its outcome has already been recorded against the intervention.'
    if (status === 'cancelled') return 'This appointment was cancelled, so there is no intervention outcome to capture.'
    if (status === 'declined') return 'The participant declined this appointment. Reschedule it before capturing an intervention outcome.'
    if (status === 'pending') return 'This appointment is awaiting confirmation. You can still record the outcome once the meeting takes place.'
    return 'This appointment is confirmed and ready for its intervention outcome after the meeting.'
}

type AppointmentDetailModalProps<T extends CalendarAppointment> = {
    open: boolean
    appointment?: T
    onClose: () => void
    onComplete: (appointment: T) => void
    /** Offered for declined appointments and open reschedule requests. */
    onReschedule?: (appointment: T) => void
    /** Offered when the SME no longer needs the intervention; omit for roles that cannot assign interventions. */
    onReviewIntervention?: (appointment: T) => void
}

/**
 * Appointment details live in a modal rather than beside the day list: the right rail is only wide
 * enough for one job, and reading a meeting's details is a deliberate act, not ambient context.
 */
export function AppointmentDetailModal<T extends CalendarAppointment>({ open, appointment, onClose, onComplete, onReschedule, onReviewIntervention }: AppointmentDetailModalProps<T>) {
    const start = appointment ? toDayjs(appointment.startTime) : null
    const canComplete = appointment ? ['accepted', 'pending'].includes(appointment.status) : false
    const rescheduleAsk = openRescheduleRequestSummary(appointment?.rescheduleRequest)
    const dropRequested = isInterventionDropRequest(appointment)
    const canReschedule = Boolean(appointment && onReschedule && !dropRequested && (appointment.status === 'declined' || (rescheduleAsk && ['pending', 'accepted'].includes(appointment.status))))

    return (
        <Modal
            open={open && Boolean(appointment)}
            onCancel={onClose}
            width={560}
            title="Appointment details"
            destroyOnHidden
            footer={[
                <Button key="close" onClick={onClose}>Close</Button>,
                dropRequested && appointment && onReviewIntervention
                    ? <Button key="review" type="primary" danger icon={<ExportOutlined />} onClick={() => onReviewIntervention(appointment)}>Review intervention</Button>
                    : null,
                canReschedule && appointment && onReschedule
                    ? <Button key="reschedule" type="primary" icon={<RedoOutlined />} onClick={() => onReschedule(appointment)}>Reschedule</Button>
                    : null,
                canComplete && appointment
                    ? <Button key="complete" type="primary" icon={<CheckCircleOutlined />} onClick={() => onComplete(appointment)}>Complete intervention</Button>
                    : null,
            ]}
        >
            {appointment && (
                <div className={`apt-detail is-${appointment.status}`}>
                    <div className="apt-detail-head">
                        <span className="apt-detail-icon">{meetingTypeIcon(appointment.meetingType)}</span>
                        <h3>{appointment.interventionTitle}</h3>
                        <Tag color={statusColor(appointment.status)}>{statusLabel(appointment.status)}</Tag>
                    </div>

                    <dl className="apt-detail-meta">
                        <div><dt><CalendarOutlined />Date</dt><dd>{start ? start.format('dddd, DD MMMM YYYY') : 'To be confirmed'}</dd></div>
                        <div><dt><ClockCircleOutlined />Time</dt><dd>{formatSpan(appointment)}</dd></div>
                        <div><dt>{meetingTypeIcon(appointment.meetingType)}Format</dt><dd>{meetingTypeLabel(appointment.meetingType)}</dd></div>
                        <div><dt><TeamOutlined />Client</dt><dd>{appointment.participantName || appointment.participantEmail || 'SME'}</dd></div>
                    </dl>

                    {appointment.meetingLink && (
                        <a className="apt-detail-link" href={appointment.meetingLink} target="_blank" rel="noreferrer">
                            <LinkOutlined />Join meeting
                        </a>
                    )}
                    {appointment.location && (
                        <p className="apt-detail-location"><EnvironmentOutlined />{appointment.location}</p>
                    )}

                    {dropRequested && (
                        <Alert
                            type="error"
                            showIcon
                            style={{ marginBottom: 12 }}
                            message="The SME no longer needs this intervention"
                            description={onReviewIntervention
                                ? 'Review it on the interventions page and confirm the decline to close it. Any work already recorded is kept.'
                                : 'Operations will review this and confirm the decline.'}
                        />
                    )}
                    {appointment.status === 'declined' && !dropRequested && appointment.declineReason && (
                        <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Declined by the SME" description={appointment.declineReason} />
                    )}
                    {rescheduleAsk && (
                        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message="The SME asked to reschedule" description={rescheduleAsk} />
                    )}

                    <p className="apt-detail-note"><InfoCircleOutlined />{statusCopy(appointment.status)}</p>
                </div>
            )}
        </Modal>
    )
}

export default AppointmentDetailModal
