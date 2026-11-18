import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Checkbox, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Skeleton, Space, Tag, Typography } from 'antd'
import { CalendarOutlined, DeleteOutlined, EditOutlined, SafetyCertificateOutlined, UserAddOutlined, UserOutlined } from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { DetailFields } from '@/components/training/DetailFields'
import { LEARNER_DETAIL_FIELDS, fieldsFor } from '@/config/trainingDetails'
import { usesFirebaseEmulators } from '@/config/firebase'
import { useMyOrganisation } from '@/pages/company/useMyOrganisation'
import { newTeamId, teamOf, type TeamPerson } from '@/pages/company/companyTeam'
import {
    bookOrganisationLearner, cancelOrganisationBooking, inviteOrganisationMember, listMyOrganisationLearners, listOrganisationMembers,
    listTrainingClassesForOrganisation, saveOrganisationTeam,
} from '@/services/trainingOrganisationsService'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel } from '@/utils/trainingFormat'
import { classPhase } from '@/utils/trainingResults'
import type { TrainingClass, TrainingDetails, TrainingLearner, TrainingOrgMember, TrainingTeamMember } from '@/types/training'
import '@/styles/company-portal.css'

/**
 * A client company's team: everyone it sends to training, the director too when it is just them. Add, change or
 * remove people, and book anyone on a class. The director can also give a colleague a sign-in to help.
 */

type PersonValues = { name: string; email: string; phone?: string; jobTitle?: string; isDirector?: boolean }
type BookingValues = { classId: string; idNumber?: string; details?: TrainingDetails }

export default function CompanyTeamPage() {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user, organisation, detailsSettings, provider, reload } = useMyOrganisation()
    const [personForm] = Form.useForm<PersonValues>()
    const [bookingForm] = Form.useForm<BookingValues>()
    const [colleagueForm] = Form.useForm<{ name: string; email: string; jobTitle?: string }>()
    const [learners, setLearners] = useState<TrainingLearner[]>()
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [members, setMembers] = useState<TrainingOrgMember[]>([])
    const [editing, setEditing] = useState<TeamPerson | 'new' | null>(null)
    const [booking, setBooking] = useState<TeamPerson | null>(null)
    const [addingColleague, setAddingColleague] = useState(false)
    const [busy, setBusy] = useState(false)
    const isDirector = user?.orgRole === 'director'

    const load = useCallback(async () => {
        if (!user || !organisation) return
        const [people, rows, team] = await Promise.all([
            listMyOrganisationLearners(user), listTrainingClassesForOrganisation(user), listOrganisationMembers(user).catch(() => []),
        ])
        setLearners(people)
        setClasses(rows)
        setMembers(team)
    }, [user, organisation])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load().catch(() => setLearners([])), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const team = useMemo(() => (organisation && learners ? teamOf(organisation, learners, classes) : []), [organisation, learners, classes])
    const bookable = classes.filter((row) => classPhase(row) !== 'finished').sort((a, b) => a.startDate.localeCompare(b.startDate))
    const directorOnTeam = team.some((person) => person.member.isDirector)

    const saveTeam = async (next: TrainingTeamMember[]) => {
        if (!user) return
        await saveOrganisationTeam(user, next)
        await reload()
    }

    const openEditor = (person: TeamPerson | 'new', asMe = false) => {
        setEditing(person)
        personForm.resetFields()
        if (person !== 'new') personForm.setFieldsValue({ name: person.member.name, email: person.member.email, phone: person.member.phone, jobTitle: person.member.jobTitle, isDirector: person.member.isDirector })
        else if (asMe) personForm.setFieldsValue({ name: String(user?.name || user?.displayName || ''), email: String(user?.email || ''), isDirector: true })
    }

    const savePerson = async () => {
        if (!organisation || !editing) return
        const values = await personForm.validateFields()
        const member: TrainingTeamMember = {
            id: editing === 'new' ? newTeamId() : editing.id.startsWith('booking-') ? newTeamId() : editing.id,
            name: values.name.trim(), email: values.email.trim().toLowerCase(),
            ...(values.phone?.trim() ? { phone: values.phone.trim() } : {}),
            ...(values.jobTitle?.trim() ? { jobTitle: values.jobTitle.trim() } : {}),
            ...(values.isDirector ? { isDirector: true } : {}),
        }
        const others = organisation.team.filter((row) => editing === 'new' || row.id !== editing.id)
        if (others.some((row) => row.email && row.email === member.email)) {
            message.error(t('Someone on your team already has this email address.'))
            return
        }
        setBusy(true)
        try {
            await saveTeam([...others, member])
            message.success(editing === 'new' ? t('{name} is on your team.', undefined, { name: member.name }) : t('Saved.'))
            setEditing(null)
        } catch {
            message.error(t('The team could not be saved.'))
        } finally {
            setBusy(false)
        }
    }

    const removePerson = async (person: TeamPerson) => {
        if (!organisation || !user) return
        setBusy(true)
        try {
            // Bookings the company made and the provider has not acted on yet are withdrawn with them.
            const withdrawable = person.bookings.filter((learner) => learner.bookedBy && !learner.uid && !learner.certificateId)
            await Promise.all(withdrawable.map((learner) => cancelOrganisationBooking(user, learner.id)))
            if (person.listed) await saveTeam(organisation.team.filter((row) => row.id !== person.id))
            message.success(t('{name} is no longer on your team.', undefined, { name: person.member.name }))
            await load()
        } catch {
            message.error(t('{name} could not be removed.', undefined, { name: person.member.name }))
        } finally {
            setBusy(false)
        }
    }

    const book = async () => {
        if (!booking || !organisation || !user) return
        const values = await bookingForm.validateFields()
        setBusy(true)
        try {
            if (!booking.listed) await saveTeam([...organisation.team, { ...booking.member, id: newTeamId() }])
            await bookOrganisationLearner(user, organisation, values.classId, {
                name: booking.member.name, email: booking.member.email, phone: booking.member.phone, idNumber: values.idNumber || '', details: values.details,
            })
            message.success(t('{name} is booked. {provider} sends them a sign-in link before the class.', undefined, { name: booking.member.name, provider }))
            setBooking(null)
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'duplicate_learner' ? t('{name} is already booked on that class.', undefined, { name: booking.member.name }) : t('The booking could not be saved.'))
        } finally {
            setBusy(false)
        }
    }

    const addColleague = async () => {
        if (!organisation) return
        const values = await colleagueForm.validateFields()
        setBusy(true)
        try {
            const { setPasswordLink } = await inviteOrganisationMember({ organisationId: organisation.id, name: values.name, email: values.email, jobTitle: values.jobTitle, orgRole: 'coordinator' })
            message.success(t('{name} can now sign in. A link to set a password was emailed.', undefined, { name: values.name }))
            setAddingColleague(false)
            if (usesFirebaseEmulators && setPasswordLink) modal.info({ title: t('Local testing: no email is sent'), content: <Typography.Paragraph copyable style={{ wordBreak: 'break-all' }}>{setPasswordLink}</Typography.Paragraph> })
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'email_already_exists' ? t('This email already has a Smartinc account. Use another address.') : t('The colleague could not be added.'))
        } finally {
            setBusy(false)
        }
    }

    const statusTag = (person: TeamPerson) => {
        if (person.status === 'certified') return <Tag color="green" icon={<SafetyCertificateOutlined />}>{t('Certified')}</Tag>
        if (person.status === 'in_class') return <Tag color="blue">{t('In a class now')}</Tag>
        if (person.status === 'booked' && person.current) return <Tag color="gold" icon={<CalendarOutlined />}>{t('Booked: {course}, {date}', undefined, { course: person.current.trainingClass.courseTitle, date: classDatesLabel(person.current.trainingClass) })}</Tag>
        return <Tag>{t('Not booked yet')}</Tag>
    }

    if (!organisation || !learners) return <DashboardPage><Skeleton active paragraph={{ rows: 8 }} /></DashboardPage>

    return (
        <DashboardPage className="training-page cp-page">
            <div className="cp-head">
                <div>
                    <Typography.Title level={3} style={{ margin: 0 }}>{t('Team')}</Typography.Title>
                    <Typography.Text type="secondary">{t('Everyone {company} sends to training.', undefined, { company: organisation.name })}</Typography.Text>
                </div>
                <Space wrap>
                    {!directorOnTeam && isDirector && <Button size="large" icon={<UserOutlined />} onClick={() => openEditor('new', true)}>{t('Add me')}</Button>}
                    <Button type="primary" size="large" icon={<UserAddOutlined />} onClick={() => openEditor('new')}>{t('Add a person')}</Button>
                </Space>
            </div>

            {team.length === 0 ? (
                <Card>
                    <Empty description={(
                        <Space orientation="vertical" size={4}>
                            <Typography.Text strong>{t('Your team is empty.')}</Typography.Text>
                            <Typography.Text type="secondary">{t('Add the people to be trained. If you are the one being trained, add yourself.')}</Typography.Text>
                        </Space>
                    )}>
                        <Space wrap>
                            {isDirector && <Button size="large" icon={<UserOutlined />} onClick={() => openEditor('new', true)}>{t('Add me')}</Button>}
                            <Button type="primary" size="large" icon={<UserAddOutlined />} onClick={() => openEditor('new')}>{t('Add a person')}</Button>
                        </Space>
                    </Empty>
                </Card>
            ) : (
                <div className="cp-team">
                    {team.map((person) => (
                        <Card key={person.id} className="cp-person">
                            <div className="cp-person-top">
                                <div className="cp-avatar" aria-hidden="true">{person.member.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</div>
                                <div className="cp-person-name">
                                    <Typography.Text strong>{person.member.name}{person.member.isDirector && <Tag style={{ marginLeft: 8 }}>{t('You')}</Tag>}</Typography.Text>
                                    <Typography.Text type="secondary">{[person.member.jobTitle, person.member.email].filter(Boolean).join(' · ') || t('No email yet')}</Typography.Text>
                                </div>
                            </div>
                            <div className="cp-person-status">{statusTag(person)}</div>
                            <Space wrap className="cp-person-actions">
                                {person.status !== 'certified' && !person.current && (
                                    <Button type="primary" icon={<CalendarOutlined />} disabled={!bookable.length} onClick={() => { bookingForm.resetFields(); setBooking(person) }}>{t('Book on a class')}</Button>
                                )}
                                <Button icon={<EditOutlined />} onClick={() => openEditor(person)}>{t('Edit')}</Button>
                                <Popconfirm title={t('Remove {name} from your team?', undefined, { name: person.member.name })} description={t('A booking the training provider has not acted on yet is withdrawn too.')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => removePerson(person)}>
                                    <Button danger icon={<DeleteOutlined />} disabled={busy}>{t('Remove')}</Button>
                                </Popconfirm>
                            </Space>
                        </Card>
                    ))}
                </div>
            )}

            {isDirector && (
                <Card title={t('People who can sign in for your company')} className="cp-colleagues" extra={<Button onClick={() => { colleagueForm.resetFields(); setAddingColleague(true) }}>{t('Give a colleague access')}</Button>}>
                    <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>{t('A colleague with access can manage the team and book classes for you.')}</Typography.Paragraph>
                    <Space wrap>
                        {members.map((member) => <Tag key={member.uid} color={member.orgRole === 'director' ? 'green' : undefined}>{member.name} · {member.orgRole === 'director' ? t('Director') : t('Coordinator')}</Tag>)}
                    </Space>
                </Card>
            )}

            <Modal open={editing !== null} title={editing === 'new' ? t('Add a person to your team') : t('Edit {name}', undefined, { name: editing ? editing.member.name : '' })} okText={t('Save')} confirmLoading={busy} onOk={() => void savePerson()} onCancel={() => setEditing(null)} destroyOnHidden>
                <Form form={personForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t('Full name')} rules={[{ required: true, whitespace: true, message: t('Enter their name.') }]}><Input size="large" maxLength={120} /></Form.Item>
                    <Form.Item name="email" label={t('Email address')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]} extra={t('Their sign-in link for classes is sent here.')}><Input size="large" maxLength={160} /></Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}><Form.Item name="phone" label={t('Phone (optional)')}><Input size="large" maxLength={40} /></Form.Item></Col>
                        <Col xs={24} sm={12}><Form.Item name="jobTitle" label={t('Job title (optional)')}><Input size="large" maxLength={120} /></Form.Item></Col>
                    </Row>
                    {isDirector && <Form.Item name="isDirector" valuePropName="checked"><Checkbox>{t('This is me')}</Checkbox></Form.Item>}
                </Form>
            </Modal>

            <Modal open={booking !== null} title={t('Book {name} on a class', undefined, { name: booking?.member.name || '' })} okText={t('Book')} confirmLoading={busy} onOk={() => void book()} onCancel={() => setBooking(null)} destroyOnHidden>
                <Form form={bookingForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="classId" label={t('Class')} rules={[{ required: true, message: t('Choose the class.') }]}>
                        <Select size="large" options={bookable.map((row) => ({ value: row.id, label: `${row.courseTitle} · ${classDatesLabel(row)}` }))} />
                    </Form.Item>
                    <Form.Item name="idNumber" label={t('ID or passport number (optional)')}><Input size="large" maxLength={30} /></Form.Item>
                    <DetailFields fields={fieldsFor(LEARNER_DETAIL_FIELDS, detailsSettings.learnerFields)} />
                </Form>
            </Modal>

            <Modal open={addingColleague} title={t('Give a colleague access')} okText={t('Give access')} confirmLoading={busy} onOk={() => void addColleague()} onCancel={() => setAddingColleague(false)} destroyOnHidden>
                <Form form={colleagueForm} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t('Full name')} rules={[{ required: true, whitespace: true, message: t('Enter their name.') }]}><Input size="large" maxLength={120} /></Form.Item>
                    <Form.Item name="email" label={t('Email address')} rules={[{ required: true, type: 'email', message: t('Enter a valid email address.') }]}><Input size="large" maxLength={160} /></Form.Item>
                    <Form.Item name="jobTitle" label={t('Job title (optional)')}><Input size="large" maxLength={120} /></Form.Item>
                </Form>
            </Modal>
        </DashboardPage>
    )
}
