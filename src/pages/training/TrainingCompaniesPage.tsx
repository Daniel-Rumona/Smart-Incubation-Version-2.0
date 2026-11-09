import { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Checkbox, Col, Drawer, Form, Input, List, Modal, Popconfirm, Row, Space, Table, Tag, Tooltip, Typography, type TableProps } from 'antd'
import { BankOutlined, DeleteOutlined, EditOutlined, FormOutlined, MailOutlined, PlusOutlined, SafetyCertificateOutlined, SearchOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { CompanyDetailsForm } from '@/components/training/CompanyDetailsForm'
import { DetailsSettingsModal } from '@/components/training/DetailsSettingsModal'
import { DEFAULT_DETAILS_SETTINGS, type TrainingDetailsSettings } from '@/config/trainingDetails'
import { getTrainingDetailsSettings, organisationCompleteness } from '@/services/trainingDetailsService'
import { usesFirebaseEmulators } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    deleteTrainingOrganisation,
    inviteOrganisationMember,
    listOrganisationMembers,
    listTrainingOrganisations,
    saveTrainingOrganisation,
} from '@/services/trainingOrganisationsService'
import { listCompanyTrainingLearners, listTrainingClasses } from '@/services/trainingService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { useLanguage } from '@/providers/LanguageProvider'
import { classDatesLabel, organisationsOf, sameOrganisation } from '@/utils/trainingFormat'
import type { TrainingClass, TrainingLearner, TrainingOrgMember, TrainingOrganisation, TrainingOrganisationValues } from '@/types/training'

/**
 * The client companies Keletso trains: each with its people across classes, its certificates and who has access.
 * A company's name on learners links them to it. She gives each company its director; the director adds the rest.
 */

type CompanyRow = {
    key: string
    name: string
    organisation?: TrainingOrganisation
    learners: TrainingLearner[]
    classes: number
    certified: number
    members: TrainingOrgMember[]
}

type FormValues = TrainingOrganisationValues & { giveAccess?: boolean }

export default function TrainingCompaniesPage() {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [form] = Form.useForm<FormValues>()
    const [organisations, setOrganisations] = useState<TrainingOrganisation[]>()
    const [learners, setLearners] = useState<TrainingLearner[]>([])
    const [classes, setClasses] = useState<TrainingClass[]>([])
    const [members, setMembers] = useState<TrainingOrgMember[]>([])
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<{ organisation?: TrainingOrganisation, name?: string } | null>(null)
    const [openKey, setOpenKey] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const [inviting, setInviting] = useState<string | null>(null)
    const [detailsSettings, setDetailsSettings] = useState<TrainingDetailsSettings>(DEFAULT_DETAILS_SETTINGS)
    const [choosingDetails, setChoosingDetails] = useState(false)

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [organisationRows, learnerRows, classRows, memberRows] = await Promise.all([
                listTrainingOrganisations(user),
                listCompanyTrainingLearners(user),
                listTrainingClasses(user),
                listOrganisationMembers(user).catch(() => []),
            ])
            setOrganisations(organisationRows)
            setDetailsSettings(await getTrainingDetailsSettings(user))
            setLearners(learnerRows)
            setClasses(classRows)
            setMembers(memberRows)
        } catch {
            setOrganisations([])
            message.error(t('Companies could not be loaded.'))
        }
    }, [message, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    // Registered companies first, then names on learners that have no company record yet.
    const rows = useMemo<CompanyRow[]>(() => {
        const build = (name: string, organisation?: TrainingOrganisation): CompanyRow => {
            const own = learners.filter((learner) => (organisation && learner.organisationId === organisation.id) || sameOrganisation(learner.organisation, name))
            return {
                key: organisation?.id || `name:${name.toLowerCase()}`,
                name,
                organisation,
                learners: own,
                classes: new Set(own.map((learner) => learner.classId)).size,
                certified: own.filter((learner) => learner.certificateId).length,
                members: organisation ? members.filter((member) => member.organisationId === organisation.id) : [],
            }
        }
        const registered = (organisations || []).map((organisation) => build(organisation.name, organisation))
        const unregistered = organisationsOf(learners)
            .filter((name) => !(organisations || []).some((organisation) => sameOrganisation(organisation.name, name)))
            .map((name) => build(name))
        return [...registered, ...unregistered]
    }, [learners, members, organisations])

    const visible = rows.filter((row) => !search.trim() || row.name.toLowerCase().includes(search.trim().toLowerCase()))
    const open = rows.find((row) => row.key === openKey)
    const classById = useMemo(() => new Map(classes.map((row) => [row.id, row])), [classes])

    useRegisterAgentPageContext({
        pageKey: 'training-companies',
        pageName: 'Companies',
        purpose: 'The client companies the facilitator trains: their people across classes, certificates, and who at each company can sign in (a director the facilitator gives access to, and coordinators the director adds).',
        metrics: { companies: rows.length, registered: (organisations || []).length, peopleTrained: learners.length },
        dataSummary: { companies: rows.map((row) => ({ name: row.name, registered: Boolean(row.organisation), learners: row.learners.length, classes: row.classes, certified: row.certified, hasDirector: row.members.some((member) => member.orgRole === 'director') })) },
    })

    const showLink = (name: string, link: string | null) => {
        if (!usesFirebaseEmulators || !link) return
        modal.info({ title: t('Local testing: no email is sent'), width: 640, content: <Space orientation="vertical"><Typography.Text strong>{name}</Typography.Text><Typography.Paragraph copyable style={{ wordBreak: 'break-all' }}>{link}</Typography.Paragraph></Space> })
    }

    const giveDirectorAccess = async (organisation: TrainingOrganisation, name: string, email: string) => {
        setInviting(organisation.id)
        try {
            const { setPasswordLink } = await inviteOrganisationMember({ organisationId: organisation.id, name, email, orgRole: 'director' })
            message.success(t('{name} can now sign in for {company}. A link to set a password was emailed.', undefined, { name, company: organisation.name }))
            showLink(name, setPasswordLink)
            await load()
        } catch (error) {
            const code = error instanceof Error ? error.message : ''
            message.error(code === 'email_already_exists'
                ? t('This email already has a Smartinc account. Use another address for the director.')
                : t('Access could not be given.'))
        } finally {
            setInviting(null)
        }
    }

    const startEdit = (row?: CompanyRow) => {
        setEditing({ organisation: row?.organisation, name: row?.name })
        form.setFieldsValue({
            name: row?.organisation?.name || row?.name || '',
            contactName: row?.organisation?.contactName || '',
            contactEmail: row?.organisation?.contactEmail || '',
            phone: row?.organisation?.phone || '',
            giveAccess: !row?.organisation,
        })
    }

    const save = async () => {
        if (!user || !editing) return
        const { giveAccess, ...values } = await form.validateFields()
        setSaving(true)
        try {
            const { id, linked } = await saveTrainingOrganisation(user, values, editing.organisation)
            message.success(linked
                ? t('{company} saved. {count} learner(s) linked to it.', undefined, { company: values.name, count: linked })
                : t('{company} saved.', undefined, { company: values.name }))
            setEditing(null)
            if (giveAccess && !editing.organisation && values.contactEmail) {
                await giveDirectorAccess({ id, companyCode: String(user.companyCode), name: values.name.trim(), contactName: values.contactName, contactEmail: values.contactEmail, details: {}, documents: {} }, values.contactName || values.name, values.contactEmail)
            } else {
                await load()
            }
        } catch (error) {
            message.error(error instanceof Error && error.message === 'duplicate_organisation'
                ? t('A company with this name is already registered.')
                : t('The company could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const remove = async (organisation: TrainingOrganisation) => {
        if (!user) return
        try {
            await deleteTrainingOrganisation(user, organisation)
            message.success(t('{company} removed.', undefined, { company: organisation.name }))
            await load()
        } catch (error) {
            message.error(error instanceof Error && error.message === 'organisation_in_use'
                ? t('This company has learners or accounts, so it cannot be removed.')
                : t('The company could not be removed.'))
        }
    }

    const accessCell = (row: CompanyRow) => {
        if (!row.organisation) return <Button size="small" icon={<PlusOutlined />} onClick={(event) => { event.stopPropagation(); startEdit(row) }}>{t('Register')}</Button>
        const director = row.members.find((member) => member.orgRole === 'director')
        if (director) {
            const others = row.members.length - 1
            return (
                <Space orientation="vertical" size={0}>
                    <Typography.Text>{director.name}</Typography.Text>
                    <Typography.Text type="secondary">{others ? t('Director · {count} more', undefined, { count: others }) : t('Director')}</Typography.Text>
                </Space>
            )
        }
        const organisation = row.organisation
        return organisation.contactEmail
            ? (
                <Button size="small" icon={<UserAddOutlined />} loading={inviting === organisation.id} onClick={(event) => { event.stopPropagation(); void giveDirectorAccess(organisation, organisation.contactName || organisation.name, organisation.contactEmail) }}>
                    {t('Give director access')}
                </Button>
            )
            : <Typography.Text type="secondary">{t('Add a contact email first')}</Typography.Text>
    }

    const detailsCell = (row: CompanyRow) => {
        if (!row.organisation) return '—'
        const done = organisationCompleteness(row.organisation, detailsSettings)
        if (done.complete) return <Tag color="green">{t('Complete')}</Tag>
        return row.organisation.detailsSubmittedAt || done.fields || done.documents
            ? <Tag color="gold">{t('{done} of {asked}', undefined, { done: done.fields + done.documents, asked: done.fieldsAsked + done.documentsAsked })}</Tag>
            : <Tag>{t('Not sent yet')}</Tag>
    }

    const actions = (row: CompanyRow) => row.organisation && (
        <Space onClick={(event) => event.stopPropagation()}>
            <Tooltip title={t('Edit company')}><Button icon={<EditOutlined />} onClick={() => startEdit(row)} aria-label={t('Edit company')} /></Tooltip>
            <Popconfirm title={t('Remove {company}?', undefined, { company: row.name })} description={t('Only a company with no learners or accounts can be removed.')} okText={t('Remove')} okButtonProps={{ danger: true }} onConfirm={() => remove(row.organisation as TrainingOrganisation)}>
                <Tooltip title={t('Remove company')}><Button danger icon={<DeleteOutlined />} aria-label={t('Remove company')} /></Tooltip>
            </Popconfirm>
        </Space>
    )

    const columns: TableProps<CompanyRow>['columns'] = [
        {
            title: t('Company'),
            key: 'name',
            render: (_, row) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{row.name}</Typography.Text>
                    {row.organisation
                        ? <Typography.Text type="secondary">{[row.organisation.contactName, row.organisation.contactEmail].filter(Boolean).join(' · ') || t('No contact yet')}</Typography.Text>
                        : <Tag>{t('Not registered yet')}</Tag>}
                </Space>
            ),
        },
        { title: t('People trained'), key: 'learners', align: 'center', render: (_, row) => row.learners.length },
        { title: t('Classes'), dataIndex: 'classes', align: 'center' },
        { title: t('Certificates'), dataIndex: 'certified', align: 'center' },
        { title: t('Details'), key: 'details', render: (_, row) => detailsCell(row) },
        { title: t('Company access'), key: 'access', render: (_, row) => accessCell(row) },
        { title: '', key: 'actions', align: 'right', render: (_, row) => actions(row) },
    ]

    const attendanceOf = (learner: TrainingLearner) => {
        const trainingClass = classById.get(learner.classId)
        const present = Object.values(learner.attendance).filter((mark) => mark.present).length
        return trainingClass ? `${present}/${trainingClass.dayCount}` : '—'
    }

    return (
        <DashboardPage className="training-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!organisations} icon={<BankOutlined />} label={t('Companies')} value={rows.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!organisations} icon={<BankOutlined />} label={t('Registered')} value={(organisations || []).length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!organisations} icon={<TeamOutlined />} label={t('People trained')} value={learners.length} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!organisations} icon={<UserAddOutlined />} label={t('Companies with access')} mobileTitle={t('With access')} value={new Set(members.map((member) => member.organisationId)).size} /></Col>
            </Row>
            <FilterBar
                compact
                primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search company')} allowClear />}
                actions={(
                    <>
                        <Button icon={<FormOutlined />} onClick={() => setChoosingDetails(true)}>{t('Details to ask for')}</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => startEdit()}>{t('Add company')}</Button>
                    </>
                )}
            />
            <ResponsiveDataView
                rowKey="key"
                rows={visible}
                columns={columns}
                loading={!organisations}
                onRowClick={(row) => setOpenKey(row.key)}
                emptyText={rows.length ? t('No companies match this search.') : t('No companies yet. Add the companies whose people you train.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                            <Typography.Text strong>{row.name}</Typography.Text>
                            {!row.organisation && <Tag>{t('Not registered yet')}</Tag>}
                        </Space>
                        <Typography.Text type="secondary">{t('{learners} people · {classes} classes · {certified} certificates', undefined, { learners: row.learners.length, classes: row.classes, certified: row.certified })}</Typography.Text>
                        <Space wrap>{accessCell(row)}{actions(row)}</Space>
                    </Space>
                )}
            />

            <Modal
                open={editing !== null}
                title={editing?.organisation ? t('Edit company') : t('Add company')}
                okText={t('Save')}
                confirmLoading={saving}
                onOk={() => void save()}
                onCancel={() => setEditing(null)}
                destroyOnHidden
            >
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label={t('Company name')} rules={[{ required: true, whitespace: true, message: t('Enter the company name.') }]} extra={t('Learners with this company name are linked to it.')}>
                        <Input maxLength={160} />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}><Form.Item name="contactName" label={t('Director or contact person')}><Input maxLength={120} /></Form.Item></Col>
                        <Col xs={24} sm={12}><Form.Item name="phone" label={t('Phone')}><Input maxLength={40} /></Form.Item></Col>
                    </Row>
                    <Form.Item name="contactEmail" label={t('Their email address')} rules={[{ type: 'email', message: t('Enter a valid email address.') }]}>
                        <Input maxLength={160} />
                    </Form.Item>
                    {!editing?.organisation && (
                        <Form.Item name="giveAccess" valuePropName="checked" extra={t('They can then see their people\'s classes, attendance and certificates, book people into classes and add colleagues.')}>
                            <Checkbox>{t('Give this person director access now')}</Checkbox>
                        </Form.Item>
                    )}
                </Form>
            </Modal>

            <Drawer open={Boolean(open)} onClose={() => setOpenKey(null)} title={open?.name} size="large">
                {open && (
                    <Space orientation="vertical" size={18} style={{ width: '100%' }}>
                        {open.organisation ? (
                            <section>
                                <Typography.Title level={5}>{t('Company access')}</Typography.Title>
                                <List
                                    size="small"
                                    dataSource={open.members}
                                    locale={{ emptyText: t('Nobody at this company can sign in yet.') }}
                                    renderItem={(member) => (
                                        <List.Item extra={<Tag color={member.orgRole === 'director' ? 'green' : undefined}>{member.orgRole === 'director' ? t('Director') : t('Coordinator')}</Tag>}>
                                            <List.Item.Meta title={member.name} description={[member.jobTitle, member.email].filter(Boolean).join(' · ')} />
                                        </List.Item>
                                    )}
                                />
                                {!open.members.some((member) => member.orgRole === 'director') && open.organisation.contactEmail && (
                                    <Button icon={<MailOutlined />} loading={inviting === open.organisation.id} onClick={() => void giveDirectorAccess(open.organisation as TrainingOrganisation, open.organisation?.contactName || open.name, open.organisation?.contactEmail || '')}>
                                        {t('Give {name} director access', undefined, { name: open.organisation.contactName || open.organisation.contactEmail })}
                                    </Button>
                                )}
                                <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                                    {t('You give each company its director. The director adds coordinators from their side.')}
                                </Typography.Paragraph>
                            </section>
                        ) : (
                            <Button type="primary" icon={<PlusOutlined />} onClick={() => startEdit(open)}>{t('Register this company')}</Button>
                        )}
                        {open.organisation && (
                            <section>
                                <Typography.Title level={5}>{t('Business details')}</Typography.Title>
                                <Typography.Paragraph type="secondary">
                                    {open.organisation.detailsSubmittedAt ? t('Sent by the company. You can correct them here.') : t('The company\'s director fills these in after you give them access. You can also fill them in here.')}
                                </Typography.Paragraph>
                                <CompanyDetailsForm organisation={open.organisation} settings={detailsSettings} onSaved={() => void load()} />
                            </section>
                        )}
                        <section>
                            <Typography.Title level={5}>{t('People trained')}</Typography.Title>
                            <Table
                                rowKey="id"
                                size="small"
                                dataSource={open.learners}
                                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                                scroll={{ x: 'max-content' }}
                                onRow={(learner) => ({ onClick: () => navigate(`/training/classes/${learner.classId}`), style: { cursor: 'pointer' } })}
                                columns={[
                                    { title: t('Name'), dataIndex: 'name' },
                                    { title: t('Class'), key: 'class', render: (_, learner) => { const trainingClass = classById.get(learner.classId); return trainingClass ? `${trainingClass.courseTitle} · ${classDatesLabel(trainingClass)}` : '—' } },
                                    { title: t('Attendance'), key: 'attendance', align: 'center', render: (_, learner) => attendanceOf(learner) },
                                    { title: t('Certificate'), key: 'certificate', render: (_, learner) => learner.certificateId ? <Tag icon={<SafetyCertificateOutlined />} color="green">{t('Issued')}</Tag> : '—' },
                                    { title: t('Booked by'), key: 'bookedBy', render: (_, learner) => learner.bookedBy ? t('The company') : t('You') },
                                ]}
                            />
                        </section>
                    </Space>
                )}
            </Drawer>
            {choosingDetails && <DetailsSettingsModal open settings={detailsSettings} onClose={() => setChoosingDetails(false)} onSaved={() => { setChoosingDetails(false); void load() }} />}
        </DashboardPage>
    )
}
