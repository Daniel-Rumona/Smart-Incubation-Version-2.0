import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, App, Button, Card, Col, Form, Input, List, Modal, Popconfirm, Row, Select, Space, Tag, Typography, type TableProps } from 'antd'
import { CalendarOutlined, SafetyCertificateOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { CompanyDetailsForm } from '@/components/training/CompanyDetailsForm'
import { DetailFields } from '@/components/training/DetailFields'
import { MySurveysCard } from '@/components/training/MySurveysCard'
import { DEFAULT_DETAILS_SETTINGS, LEARNER_DETAIL_FIELDS, fieldsFor, type TrainingDetailsSettings } from '@/config/trainingDetails'
import { PhaseTag } from '@/components/training/TrainingTags'
import { usesFirebaseEmulators } from '@/config/firebase'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { certificateVerifyUrl, getCertificateVerification } from '@/services/trainingCertificatesService'
import {
    bookOrganisationLearner,
    cancelOrganisationBooking,
    getMyOrganisation,
    inviteOrganisationMember,
    listMyOrganisationLearners,
    listOrganisationMembers,
    listTrainingClassesForOrganisation,
} from '@/services/trainingOrganisationsService'
import { getTrainingDetailsSettings, organisationCompleteness } from '@/services/trainingDetailsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel, classHoursLabel, classLocationLabel } from '@/utils/trainingFormat'
import { classPhase } from '@/utils/trainingResults'
import type { CertificateVerification, TrainingClass, TrainingDetails, TrainingLearner, TrainingLearnerValues, TrainingOrgMember, TrainingOrganisation } from '@/types/training'

/**
 * A client company's own page (role clientorg): its people's training with the training company, booking people into
 * classes and, for the director, adding colleagues. Only the company's own people are ever shown.
 */

type BookingValues = Omit<TrainingLearnerValues, 'organisation'> & { classId: string, details?: TrainingDetails }
type MemberValues = { name: string, email: string, jobTitle?: string }

export default function CompanyTrainingPage() {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const { settings } = useSystemSettings()
    const [bookingForm] = Form.useForm<BookingValues>()
    const [memberForm] = Form.useForm<MemberValues>()
    const [organisation, setOrganisation] = useState<TrainingOrganisation | null>()
    const [learners, setLearners] = useState<TrainingLearner[]>([])
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [members, setMembers] = useState<TrainingOrgMember[]>([])
    const [detailsSettings, setDetailsSettings] = useState<TrainingDetailsSettings>(DEFAULT_DETAILS_SETTINGS)
    const navigate = useNavigate()
    const [certificates, setCertificates] = useState<Record<string, CertificateVerification | null>>({})
    const [failed, setFailed] = useState(false)
    const [booking, setBooking] = useState(false)
    const [addingMember, setAddingMember] = useState(false)
    const [busy, setBusy] = useState(false)
    const isDirector = user?.orgRole === 'director'
    const provider = String(settings.companyName || settings.name || '').trim() || t('your training provider')

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [own, people, classRows, team] = await Promise.all([
                getMyOrganisation(user),
                listMyOrganisationLearners(user),
                listTrainingClassesForOrganisation(user),
                listOrganisationMembers(user).catch(() => []),
            ])
            setDetailsSettings(await getTrainingDetailsSettings(user))
            setOrganisation(own)
            setLearners(people)
            setClasses(classRows)
            setMembers(team)
            setFailed(false)
            const ids = people.flatMap((learner) => (learner.certificateId ? [learner.certificateId] : []))
            const found = await Promise.all(ids.map((id) => getCertificateVerification(id).catch(() => null)))
            setCertificates(Object.fromEntries(ids.map((id, index) => [id, found[index]])))
        } catch {
            setFailed(true)
            setOrganisation(null)
        }
    }, [user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const classById = useMemo(() => new Map(classes.map((row) => [row.id, row])), [classes])
    const bookable = classes.filter((row) => classPhase(row) !== 'finished')
    const validCertificates = learners.filter((learner) => learner.certificateId && certificates[learner.certificateId]?.status === 'valid')
    const upcoming = learners.filter((learner) => { const trainingClass = classById.get(learner.classId); return trainingClass && classPhase(trainingClass) !== 'finished' })

    const showLink = (name: string, link: string | null) => {
        if (!usesFirebaseEmulators || !link) return
        modal.info({ title: t('Local testing: no email is sent'), width: 640, content: <Space orientation="vertical"><Typography.Text strong>{name}</Typography.Text><Typography.Paragraph copyable style={{ wordBreak: 'break-all' }}>{link}</Typography.Paragraph></Space> })
    }

    const book = async (another: boolean) => {
        if (!user || !organisation) return
        const { classId, ...values } = await bookingForm.validateFields()
        setBusy(true)
        try {
            await bookOrganisationLearner(user, organisation, classId, values)
            message.success(t('{name} is booked. {provider} sends them a sign-in link before the class.', undefined, { name: values.name, provider }))
            bookingForm.resetFields(['name', 'email', 'idNumber', 'phone', 'details'])
            if (!another) setBooking(false)
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'duplicate_learner'
                ? t('This person is already booked into that class.')
                : t('The booking could not be saved.'))
        } finally {
            setBusy(false)
        }
    }

    const cancelBooking = async (learner: TrainingLearner) => {
        if (!user) return
        try {
            await cancelOrganisationBooking(user, learner.id)
            message.success(t('Booking for {name} withdrawn.', undefined, { name: learner.name }))
            await load()
        } catch {
            message.error(t('The booking could not be withdrawn.'))
        }
    }

    const addMember = async () => {
        if (!organisation) return
        const values = await memberForm.validateFields()
        setBusy(true)
        try {
            const { setPasswordLink } = await inviteOrganisationMember({ organisationId: organisation.id, name: values.name, email: values.email, jobTitle: values.jobTitle, orgRole: 'coordinator' })
            message.success(t('{name} can now sign in. A link to set a password was emailed.', undefined, { name: values.name }))
            memberForm.resetFields()
            setAddingMember(false)
            showLink(values.name, setPasswordLink)
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'email_already_exists'
                ? t('This email already has a Smartinc account. Use another address.')
                : t('The colleague could not be added.'))
        } finally {
            setBusy(false)
        }
    }

    const classCell = (learner: TrainingLearner) => {
        const trainingClass = classById.get(learner.classId)
        if (!trainingClass) return '—'
        return (
            <Space orientation="vertical" size={0}>
                <Typography.Text>{trainingClass.courseTitle}</Typography.Text>
                <Typography.Text type="secondary">{[classDatesLabel(trainingClass), classHoursLabel(trainingClass, t)].filter(Boolean).join(' · ')}</Typography.Text>
            </Space>
        )
    }
    const attendanceCell = (learner: TrainingLearner) => {
        const trainingClass = classById.get(learner.classId)
        if (!trainingClass || classPhase(trainingClass) === 'upcoming') return '—'
        return `${Object.values(learner.attendance).filter((mark) => mark.present).length}/${trainingClass.dayCount}`
    }
    const certificateCell = (learner: TrainingLearner) => {
        const certificate = learner.certificateId ? certificates[learner.certificateId] : undefined
        if (!learner.certificateId || !certificate) return '—'
        return certificate.status === 'valid'
            ? <a href={certificateVerifyUrl(learner.certificateId)} target="_blank" rel="noopener noreferrer"><Tag icon={<SafetyCertificateOutlined />} color="green">{certificate.certificateNumber}</Tag></a>
            : <Tag>{t('Cancelled')}</Tag>
    }
    const statusCell = (learner: TrainingLearner) => {
        const trainingClass = classById.get(learner.classId)
        if (learner.bookedBy && !learner.uid) {
            return (
                <Space size={4} wrap>
                    <Tag color="gold">{t('Booked')}</Tag>
                    <Popconfirm title={t('Withdraw the booking for {name}?', undefined, { name: learner.name })} okText={t('Withdraw')} onConfirm={() => cancelBooking(learner)}>
                        <Button size="small" type="link">{t('Withdraw')}</Button>
                    </Popconfirm>
                </Space>
            )
        }
        return trainingClass ? <PhaseTag phase={classPhase(trainingClass)} trainingClass={trainingClass} /> : '—'
    }

    const columns: TableProps<TrainingLearner>['columns'] = [
        { title: t('Name'), dataIndex: 'name', render: (value: string, learner) => <Space orientation="vertical" size={0}><Typography.Text strong>{value}</Typography.Text>{learner.email && <Typography.Text type="secondary">{learner.email}</Typography.Text>}</Space> },
        { title: t('Class'), key: 'class', render: (_, learner) => classCell(learner) },
        { title: t('Status'), key: 'status', render: (_, learner) => statusCell(learner) },
        { title: t('Days attended'), key: 'attendance', align: 'center', render: (_, learner) => attendanceCell(learner) },
        { title: t('Certificate'), key: 'certificate', render: (_, learner) => certificateCell(learner) },
    ]

    if (organisation === null && !failed) {
        return <DashboardPage><Alert type="warning" showIcon message={t('Your company is no longer registered with {provider}. Please contact them.', undefined, { provider })} /></DashboardPage>
    }

    // After the invite, the company's details come first (as in the rest of Smartinc's onboarding).
    const asksDetails = detailsSettings.companyFields.length + detailsSettings.companyDocuments.length > 0
    if (organisation && asksDetails && !organisation.detailsSubmittedAt) {
        return (
            <DashboardPage className="training-page">
                <DashboardHeader title={organisation.name} subtitle={t('Training with {provider}', undefined, { provider })} />
                <Card title={t('Tell {provider} about {company}', undefined, { provider, company: organisation.name })}>
                    <Typography.Paragraph type="secondary">
                        {t('{provider} asks every company it trains for these details and documents. You can save and finish later; your training page opens once they are sent.', undefined, { provider })}
                    </Typography.Paragraph>
                    <CompanyDetailsForm organisation={organisation} settings={detailsSettings} firstTime onSaved={() => void load()} />
                </Card>
            </DashboardPage>
        )
    }
    const completeness = organisation ? organisationCompleteness(organisation, detailsSettings) : null

    return (
        <DashboardPage className="training-page">
            <DashboardHeader
                title={organisation?.name || user?.organisationName || t('Our training')}
                subtitle={t('Training with {provider}', undefined, { provider })}
                actions={bookable.length > 0 && <Button type="primary" icon={<UserAddOutlined />} onClick={() => setBooking(true)}>{t('Book people into a class')}</Button>}
            />
            <div style={{ marginBottom: 14 }}><MySurveysCard basePath="/company/surveys" /></div>
            {failed && <Alert type="error" showIcon style={{ marginBottom: 12 }} message={t('Your company\'s training could not be loaded. Refresh the page to try again.')} />}
            {completeness && asksDetails && !completeness.complete && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={t('Some of your company\'s details or documents are still missing.')}
                    action={<Button size="small" onClick={() => navigate(completeness.fields < completeness.fieldsAsked ? '/company/business' : '/company/documents')}>{t('Complete them')}</Button>}
                />
            )}

            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={8}><DashboardMetricCard loading={organisation === undefined} icon={<TeamOutlined />} label={t('People trained or booked')} mobileTitle={t('People')} value={learners.length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={organisation === undefined} icon={<CalendarOutlined />} label={t('In upcoming or ongoing classes')} mobileTitle={t('Upcoming')} value={upcoming.length} /></Col>
                <Col xs={12} lg={8}><DashboardMetricCard loading={organisation === undefined} icon={<SafetyCertificateOutlined />} label={t('Certificates')} value={validCertificates.length} /></Col>
            </Row>

            <Card title={t('Our people')} style={{ marginBottom: 16 }}>
                <ResponsiveDataView
                    rowKey="id"
                    rows={learners}
                    columns={columns}
                    loading={organisation === undefined}
                    emptyText={t('Nobody from your company is booked yet. Book your people into one of the classes below.')}
                    renderCard={(learner) => (
                        <Space orientation="vertical" style={{ width: '100%' }}>
                            <Space style={{ justifyContent: 'space-between', width: '100%' }}><Typography.Text strong>{learner.name}</Typography.Text>{statusCell(learner)}</Space>
                            {classCell(learner)}
                            <Space wrap><Typography.Text type="secondary">{t('Days attended')}: {attendanceCell(learner)}</Typography.Text>{certificateCell(learner)}</Space>
                        </Space>
                    )}
                />
            </Card>

            <Row gutter={[14, 14]}>
                <Col xs={24} lg={isDirector ? 14 : 24}>
                    <Card title={t('Classes you can book')}>
                        <List
                            dataSource={bookable}
                            loading={organisation === undefined}
                            locale={{ emptyText: t('{provider} has no upcoming classes yet.', undefined, { provider }) }}
                            renderItem={(trainingClass) => (
                                <List.Item extra={<PhaseTag phase={classPhase(trainingClass)} trainingClass={trainingClass} />}>
                                    <List.Item.Meta
                                        title={trainingClass.courseTitle}
                                        description={[classDatesLabel(trainingClass), classHoursLabel(trainingClass, t), classLocationLabel(trainingClass, t)].filter(Boolean).join(' · ')}
                                    />
                                </List.Item>
                            )}
                        />
                    </Card>
                </Col>
                {isDirector && (
                    <Col xs={24} lg={10}>
                        <Card title={t('Team')} extra={<Button icon={<UserAddOutlined />} onClick={() => setAddingMember(true)}>{t('Add a colleague')}</Button>}>
                            <List
                                size="small"
                                dataSource={members}
                                renderItem={(member) => (
                                    <List.Item extra={<Tag color={member.orgRole === 'director' ? 'green' : undefined}>{member.orgRole === 'director' ? t('Director') : t('Coordinator')}</Tag>}>
                                        <List.Item.Meta title={member.name} description={[member.jobTitle, member.email].filter(Boolean).join(' · ')} />
                                    </List.Item>
                                )}
                            />
                            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
                                {t('Coordinators see the same page and can book people. Only you can add colleagues.')}
                            </Typography.Paragraph>
                        </Card>
                    </Col>
                )}
            </Row>


            <Modal
                open={booking}
                title={t('Book someone into a class')}
                onCancel={() => setBooking(false)}
                destroyOnHidden
                footer={(
                    <Space>
                        <Button onClick={() => setBooking(false)}>{t('Close')}</Button>
                        <Button loading={busy} onClick={() => void book(true)}>{t('Book and add another')}</Button>
                        <Button type="primary" loading={busy} onClick={() => void book(false)}>{t('Book')}</Button>
                    </Space>
                )}
            >
                <Form form={bookingForm} layout="vertical" requiredMark={false} preserve>
                    <Form.Item name="classId" label={t('Class')} rules={[{ required: true, message: t('Choose the class.') }]}>
                        <Select options={bookable.map((row) => ({ value: row.id, label: `${row.courseTitle} · ${classDatesLabel(row)}` }))} />
                    </Form.Item>
                    <Form.Item name="name" label={t('Full name')} rules={[{ required: true, whitespace: true, message: t('Enter their name.') }]}><Input maxLength={120} /></Form.Item>
                    <Form.Item name="email" label={t('Email address')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]} extra={t('Their sign-in link is sent here.')}><Input maxLength={160} /></Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}><Form.Item name="idNumber" label={t('ID or passport number')}><Input maxLength={30} /></Form.Item></Col>
                        <Col xs={24} sm={12}><Form.Item name="phone" label={t('Phone')}><Input maxLength={40} /></Form.Item></Col>
                    </Row>
                    <DetailFields fields={fieldsFor(LEARNER_DETAIL_FIELDS, detailsSettings.learnerFields)} />
                </Form>
            </Modal>

            <Modal open={addingMember} title={t('Add a colleague')} okText={t('Give access')} confirmLoading={busy} onOk={() => void addMember()} onCancel={() => setAddingMember(false)} destroyOnHidden>
                <Typography.Paragraph type="secondary">{t('They can see your people\'s training and book people into classes.')}</Typography.Paragraph>
                <Form form={memberForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t('Full name')} rules={[{ required: true, whitespace: true, message: t('Enter their name.') }]}><Input maxLength={120} /></Form.Item>
                    <Form.Item name="email" label={t('Email address')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]}><Input maxLength={160} /></Form.Item>
                    <Form.Item name="jobTitle" label={t('Job title (optional)')}><Input maxLength={120} placeholder={t('e.g. HR Manager')} /></Form.Item>
                </Form>
            </Modal>
        </DashboardPage>
    )
}
