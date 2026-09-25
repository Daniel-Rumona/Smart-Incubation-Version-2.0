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
import { useLanguage } from '@/providers/LanguageProvider'

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
    const { t } = useLanguage()
    const start = appointment ? toDayjs(appointment.startTime) : null
    const canComplete = appointment ? ['accepted', 'pending'].includes(appointment.status) : false
    const rescheduleAsk = openRescheduleRequestSummary(appointment?.rescheduleRequest)
    const dropRequested = isInterventionDropRequest(appointment)
    const canReschedule = Boolean(appointment && onReschedule && !dropRequested && (appointment.status === 'declined' || (rescheduleAsk && ['pending', 'accepted'].includes(appointment.status))))

    const actionButtons = [
        dropRequested && appointment && onReviewIntervention
            ? <Button key="review" type="primary" danger icon={<ExportOutlined />} onClick={() => onReviewIntervention(appointment)}>{t('Review intervention')}</Button>
            : null,
        canReschedule && appointment && onReschedule
            ? <Button key="reschedule" type="primary" icon={<RedoOutlined />} onClick={() => onReschedule(appointment)}>{t('Reschedule')}</Button>
            : null,
        canComplete && appointment
            ? <Button key="complete" type="primary" icon={<CheckCircleOutlined />} onClick={() => onComplete(appointment)}>{t('Complete intervention')}</Button>
            : null,
    ].filter(Boolean)

    return (
        <Modal
            open={open && Boolean(appointment)}
            onCancel={onClose}
            width={560}
            title={t('Appointment details')}
            destroyOnHidden
            footer={actionButtons.length ? actionButtons : null}
        >
            {appointment && (
                <div className={`apt-detail is-${appointment.status}`}>
                    <div className="apt-detail-head">
                        <span className="apt-detail-icon">{meetingTypeIcon(appointment.meetingType)}</span>
                        <h3>{appointment.interventionTitle}</h3>
                        <Tag color={statusColor(appointment.status)}>{statusLabel(appointment.status)}</Tag>
                    </div>

                    <dl className="apt-detail-meta">
                        <div><dt><CalendarOutlined />{t('Date')}</dt><dd>{start ? start.format('dddd, DD MMMM YYYY') : t('To be confirmed')}</dd></div>
                        <div><dt><ClockCircleOutlined />{t('Time')}</dt><dd>{formatSpan(appointment)}</dd></div>
                        <div><dt>{meetingTypeIcon(appointment.meetingType)}{t('Format')}</dt><dd>{meetingTypeLabel(appointment.meetingType)}</dd></div>
                        <div><dt><TeamOutlined />{t('Client')}</dt><dd>{appointment.participantName || appointment.participantEmail || t('SME')}</dd></div>
                    </dl>

                    {appointment.meetingLink && (
                        <a className="apt-detail-link" href={appointment.meetingLink} target="_blank" rel="noreferrer">
                            <LinkOutlined />{t('Join meeting')}
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
                            message={t('The SME no longer needs this intervention')}
                            description={onReviewIntervention
                                ? t('Review it on the interventions page and confirm the decline to close it. Any work already recorded is kept.')
                                : t('Operations will review this and confirm the decline.')}
                        />
                    )}
                    {appointment.status === 'declined' && !dropRequested && appointment.declineReason && (
                        <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('Declined by the SME')} description={appointment.declineReason} />
                    )}
                    {rescheduleAsk && (
                        <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={t('The SME asked to reschedule')} description={rescheduleAsk} />
                    )}

                    <p className="apt-detail-note"><InfoCircleOutlined />{statusCopy(appointment.status)}</p>
                </div>
            )}
        </Modal>
    )
}

export default AppointmentDetailModal
