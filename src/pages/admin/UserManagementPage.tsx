import { Alert, App, AutoComplete, Avatar, Button, Card, Col, Form, Input, List, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Typography, type TableProps } from 'antd'
import { AppstoreOutlined, BankOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, IdcardOutlined, MailOutlined, PhoneOutlined, ReloadOutlined, SafetyCertificateOutlined, SaveOutlined, SearchOutlined, StopOutlined, TeamOutlined, UserAddOutlined, UserDeleteOutlined, WhatsAppOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { AdminFormSectionHead } from '@/components/admin/AdminFormSectionHead'
import { AdminKpiTile, AdminRoleTag, AdminShareRing } from '@/components/admin/AdminKpiTile'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { FeaturePermissionsField } from '@/components/shared/FeaturePermissionsField'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { USER_ROLES, USER_ROLE_LABELS, type UserRole } from '@/config/roles'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { cleanupOrphanUsers, createManagedUser, deleteManagedUser, listManagedUsers, previewOrphanUsers, updateManagedUser, type OrphanUserRecord } from '@/services/usersService'
import type { ManagedUser } from '@/types/operations'
import { FEATURE_PERMISSION_OPTIONS, getRolePermissions } from '@/config/permissions'
import { useLanguage } from '@/providers/LanguageProvider'
import '@/styles/user-management.css'

type UserForm = Omit<ManagedUser, 'id' | 'status'> & { active: boolean }
/** Roles whose work is tied to programmes (same list as Manage team). */
const PROGRAMME_SCOPED_ROLES: UserRole[] = [USER_ROLES.PROJECT_ADMIN, USER_ROLES.CONSULTANT, USER_ROLES.FUNDER]
/**
 * Roles that always run on their defaults (same list as Manage team): their pages and firestore.rules decide what they
 * see, so a custom feature list would only mislead. Saving one of them clears any list stored earlier.
 */
const FIXED_ACCESS_ROLES: UserRole[] = [USER_ROLES.ADMIN, USER_ROLES.FUNDER]

const initialsOf = (name: string, email: string) =>
    (name || email || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')

const UserAvatar = ({ row, size }: { row: ManagedUser, size?: number }) => (
    <Avatar shape="circle" size={size} src={row.photoUrl || undefined} style={{ flexShrink: 0 }}>{initialsOf(row.name, row.email) || '?'}</Avatar>
)

const StatusPill = ({ status }: { status: ManagedUser['status'] }) => {
    const { t } = useLanguage()
    return <span className={`user-status-pill is-${status}`}><i />{status === 'active' ? t('Active') : t('Inactive')}</span>
}

const WhatsAppToggle = ({ name }: { name: 'phoneIsWhatsApp' | 'alternativePhoneIsWhatsApp' }) => {
    const { t } = useLanguage()
    return (
        <label className="admin-form-modal-whatsapp">
            <WhatsAppOutlined />
            <span className="admin-form-modal-whatsapp-text">{t('This number is on WhatsApp')}</span>
            <Form.Item name={name} valuePropName="checked" noStyle><Switch size="small" /></Form.Item>
        </label>
    )
}

export const UserManagementPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const { activeCompanyCode, isAllCompanies } = useActiveCompanyCode()
    const [form] = Form.useForm<UserForm>()
    const selectedRole = Form.useWatch('role', form)
    const [modalOpen, setModalOpen] = useState(false)
    const watchedCompany = String(Form.useWatch('companyCode', form) || '').trim()
    // Programmes the account is linked to (project admins, consultants, funders): the chosen company's, empty = all.
    const usesProgrammes = !!selectedRole && PROGRAMME_SCOPED_ROLES.includes(selectedRole)
    const [programmeOptions, setProgrammeOptions] = useState<Array<{ value: string, label: string }>>([])
    const [programmesFor, setProgrammesFor] = useState('')
    useEffect(() => {
        if (!modalOpen || !usesProgrammes || !watchedCompany) return
        // Waits for typing in the company code to settle before looking its programmes up.
        const timeout = window.setTimeout(() => {
            void getDocs(query(collection(getFirebaseDb(), 'programs'), where('companyCode', '==', watchedCompany)))
                .then((snapshot) => {
                    const options = snapshot.docs
                        .map((row) => ({ value: row.id, label: String(row.data().name || row.data().programName || row.id) }))
                        .sort((left, right) => left.label.localeCompare(right.label))
                    setProgrammeOptions(options)
                    setProgrammesFor(watchedCompany)
                    // Another company's programmes can't stay linked once the company changes.
                    const valid = new Set(options.map((option) => option.value))
                    const current = (form.getFieldValue('assignedProgramIds') || []) as string[]
                    if (current.some((id) => !valid.has(id))) form.setFieldValue('assignedProgramIds', current.filter((id) => valid.has(id)))
                })
                .catch(() => setProgrammeOptions([]))
        }, 300)
        return () => window.clearTimeout(timeout)
    }, [form, modalOpen, usesProgrammes, watchedCompany])
    const watchedPermissions = Form.useWatch('permissions', form)
    const enabledFeatures = FEATURE_PERMISSION_OPTIONS.filter((option) => watchedPermissions?.includes(option.value)).length
    const [users, setUsers] = useState<ManagedUser[]>([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<ManagedUser>()
    const [cleanupOpen, setCleanupOpen] = useState(false)
    const [scanningOrphans, setScanningOrphans] = useState(false)
    const [cleaningOrphans, setCleaningOrphans] = useState(false)
    const [orphanUsers, setOrphanUsers] = useState<OrphanUserRecord[]>([])
    const [cleanupConfirmation, setCleanupConfirmation] = useState('')
    const roleOptions = useMemo(() => Object.values(USER_ROLES)
        .filter((role) => user?.role === USER_ROLES.SYSTEM_ADMIN || role !== USER_ROLES.SYSTEM_ADMIN)
        .map((value) => ({ value, label: t(USER_ROLE_LABELS[value]) })), [t, user?.role])

    const load = async () => {
        if (!user) return
        try {
            setLoading(true)
            setUsers(await listManagedUsers(user))
        } catch {
            message.error(t('Users could not be loaded.'))
        } finally {
            setLoading(false)
        }
    }
    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    // The company picked in the top bar narrows the list and the counts; the company-code picker still offers every company.
    const companyUsers = useMemo(() => isAllCompanies ? users : users.filter((row) => row.companyCode === activeCompanyCode), [activeCompanyCode, isAllCompanies, users])
    const rows = useMemo(() => companyUsers.filter((row) => `${row.name} ${row.email} ${row.role} ${row.phone || ''} ${row.alternativePhone || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [companyUsers, search])
    const metrics = useMemo(() => ({
        users: companyUsers.length,
        active: companyUsers.filter((row) => row.status === 'active').length,
        inactive: companyUsers.filter((row) => row.status === 'inactive').length,
        companies: new Set(companyUsers.map((row) => row.companyCode).filter(Boolean)).size,
    }), [companyUsers])
    const companyOptions = useMemo(() => [...new Set(users.map((row) => row.companyCode).filter((code): code is string => !!code))]
        .sort()
        .map((value) => ({ value })), [users])
    useRegisterAgentPageContext({ pageKey: 'admin-users', pageName: 'User management', purpose: 'Manage platform accounts and role access.', filters: { search }, metrics: { users: companyUsers.length }, tables: { visibleUsers: rows.length } })

    const openModal = (record?: ManagedUser) => {
        setEditing(record)
        form.setFieldsValue(record ? { ...record, permissions: record.permissions || getRolePermissions(record.role), active: record.status === 'active' } : { active: true, role: USER_ROLES.OPERATIONS, permissions: getRolePermissions(USER_ROLES.OPERATIONS), assignedProgramIds: [] })
        setModalOpen(true)
    }
    const save = async (values: UserForm) => {
        if (!user) return
        const payload = { ...values, status: values.active ? 'active' : 'inactive' } as Omit<ManagedUser, 'id'>
        delete (payload as Partial<UserForm>).active
        // null on update removes a stored list (updatePlatformUser); left out on create, they start on the defaults.
        if (FIXED_ACCESS_ROLES.includes(values.role)) (payload as { permissions?: unknown }).permissions = editing ? null : undefined
        try {
            setLoading(true)
            if (editing) await updateManagedUser(user, editing.id, payload)
            else await createManagedUser(user, payload)
            message.success(editing ? t('User updated.') : t('User record created.'))
            setModalOpen(false)
            form.resetFields()
            await load()
        } catch {
            message.error(t('User could not be saved.'))
            setLoading(false)
        }
    }
    const remove = async (id: string) => {
        if (!user) return
        try {
            await deleteManagedUser(user, id)
            message.success(t('User removed.'))
            await load()
        } catch {
            message.error(t('User could not be removed.'))
        }
    }
    const scanOrphans = async () => {
        if (!user || (user.role !== USER_ROLES.SYSTEM_ADMIN)) return
        try {
            setScanningOrphans(true)
            const result = await previewOrphanUsers(user)
            setOrphanUsers(result.orphans)
            setCleanupConfirmation('')
            setCleanupOpen(true)
        } catch {
            message.error(t('Orphan user records could not be scanned.'))
        } finally {
            setScanningOrphans(false)
        }
    }
    const cleanOrphans = async () => {
        if (!user || cleanupConfirmation !== 'DELETE ORPHAN USERS') return
        try {
            setCleaningOrphans(true)
            const result = await cleanupOrphanUsers(user, cleanupConfirmation)
            message.success(`Removed ${result.count} orphan user profiles and ${result.deletedRecordCount} associated records.`)
            setCleanupOpen(false)
            await load()
        } catch {
            message.error(t('Orphan records could not be cleaned up.'))
        } finally {
            setCleaningOrphans(false)
        }
    }
    const columns: TableProps<ManagedUser>['columns'] = [
        {
            title: t('Name'), dataIndex: 'name', render: (value: string, row) => (
                <Space size={10}>
                    <UserAvatar row={row} />
                    <Typography.Text strong>{value || row.email}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Email'), dataIndex: 'email' },
        { title: t('Role'), dataIndex: 'role', render: (value: UserRole) => <AdminRoleTag role={value} /> },
        {
            title: t('WhatsApp'), key: 'whatsapp', render: (_, row) => {
                const phones = [row.phoneIsWhatsApp && row.phone, row.alternativePhoneIsWhatsApp && row.alternativePhone].filter(Boolean)
                return phones.length ? <Space direction="vertical" size={0}>{phones.map((phone) => <Tag color="green" key={String(phone)}>{t('WhatsApp ·')} {phone}</Tag>)}</Space> : <Tag>{t('Not enabled')}</Tag>
            }
        },
        { title: t('Status'), dataIndex: 'status', render: (value: ManagedUser['status']) => <StatusPill status={value} /> },
        { title: t('Actions'), width: 110, render: (_, row) => <Space><Button shape="circle" icon={<EditOutlined />} onClick={() => openModal(row)} /><Popconfirm title={t('Remove this user record?')} onConfirm={() => void remove(row.id)}><Button shape="circle" danger icon={<DeleteOutlined />} /></Popconfirm></Space> },
    ]

    return (
        <DashboardPage className="user-management-page admin-overview">
            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading && !users.length} icon={<TeamOutlined />} label={t('Users')} value={metrics.users} visual={<AdminShareRing value={metrics.users} total={metrics.users} />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading && !users.length} icon={<CheckCircleOutlined />} label={t('Active users')} value={metrics.active} visual={<AdminShareRing value={metrics.active} total={metrics.users} />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading && !users.length} icon={<StopOutlined />} label={t('Inactive users')} value={metrics.inactive} visual={<AdminShareRing value={metrics.inactive} total={metrics.users} muted />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile loading={loading && !users.length} icon={<BankOutlined />} label={t('Companies')} value={metrics.companies} /></Col>
            </Row>
            <Card className="admin-card user-management-list" bordered={false}>
                <div className="admin-card-head">
                    <div>
                        <h3>{t('All users')}</h3>
                        <span>{t('{count} of {total} shown', undefined, { count: rows.length, total: companyUsers.length })}</span>
                    </div>
                </div>
                <FilterBar primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search users')} allowClear />} actions={<>{user && (user.role === USER_ROLES.SYSTEM_ADMIN) && <Button danger icon={<UserDeleteOutlined />} loading={scanningOrphans} onClick={() => void scanOrphans()}>{t('Clean orphan records')}</Button>}<Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('Refresh')}</Button><Button type="primary" icon={<UserAddOutlined />} onClick={() => openModal()}>{t('Add user')}</Button></>} />
                <ResponsiveDataView rowKey="id" rows={rows} columns={columns} loading={loading} emptyText={t('No users match your search.')} renderCard={(row) => <Space orientation="vertical"><Space size={10}><UserAvatar row={row} size={40} /><Space orientation="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text></Space></Space><Space><AdminRoleTag role={row.role} /><StatusPill status={row.status} /><Button shape="circle" icon={<EditOutlined />} onClick={() => openModal(row)} /></Space></Space>} />
            </Card>
            <ResponsiveModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                width={780}
                centered
                destroyOnHidden={false}
                className="admin-modal admin-form-modal is-plain-header"
                title={editing ? t('Edit user') : t('Add user')}
                footer={(
                    <Button block shape="round" size="large" type="primary" icon={<SaveOutlined />} loading={loading} onClick={() => form.submit()}>{editing ? t('Save changes') : t('Create user')}</Button>
                )}
            >
                <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => void save(values)}>
                    <section className="admin-form-modal-section">
                        <AdminFormSectionHead icon={<IdcardOutlined />} title={t('Profile')} hint={t('Who this account belongs to')} />
                        <Row gutter={12}>
                            <Col xs={24} md={12}><Form.Item name="name" label={t('Name')} rules={[{ required: true }]}><Input size="large" placeholder={t('Full name')} /></Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name="email" label={t('Email')} rules={[{ required: true }, { type: 'email' }]} extra={editing ? t('The sign-in email cannot be changed here.') : undefined}><Input size="large" prefix={<MailOutlined />} placeholder="name@company.com" readOnly={!!editing} /></Form.Item></Col>
                        </Row>
                    </section>
                    <section className="admin-form-modal-section">
                        <AdminFormSectionHead icon={<SafetyCertificateOutlined />} title={t('Role and company')} hint={t('Choosing a role resets feature access to that role’s defaults')} />
                        <Row gutter={12}>
                            <Col xs={24} md={12}><Form.Item name="role" label={t('Role')} rules={[{ required: true }]}><Select size="large" options={roleOptions} onChange={(role: UserRole) => form.setFieldValue('permissions', getRolePermissions(role))} /></Form.Item></Col>
                            <Col xs={24} md={12}><Form.Item name="companyCode" label={t('Company code')}><AutoComplete size="large" options={companyOptions} placeholder={t('Select or enter a company code')} allowClear /></Form.Item></Col>
                        </Row>
                        {usesProgrammes && (
                            <Form.Item
                                name="assignedProgramIds"
                                label={selectedRole === USER_ROLES.FUNDER ? t('Programmes they fund') : t('Programmes')}
                                extra={watchedCompany ? t('Leave empty for all programmes.') : t('Choose a company first to pick its programmes.')}
                            >
                                <Select
                                    size="large"
                                    mode="multiple"
                                    allowClear
                                    disabled={!watchedCompany}
                                    placeholder={t('All programmes')}
                                    options={programmesFor === watchedCompany ? programmeOptions : []}
                                    optionFilterProp="label"
                                    notFoundContent={t('This company has no programmes yet.')}
                                />
                            </Form.Item>
                        )}
                        <label className="admin-form-modal-toggle">
                            <span>
                                <strong>{t('Account active')}</strong>
                                <small>{t('Inactive users cannot sign in')}</small>
                            </span>
                            <Form.Item name="active" valuePropName="checked" noStyle><Switch /></Form.Item>
                        </label>
                    </section>
                    <section className="admin-form-modal-section">
                        <AdminFormSectionHead icon={<PhoneOutlined />} title={t('Contact')} hint={t('Include the country code, e.g. +27')} />
                        <Row gutter={12} align="bottom">
                            <Col xs={24} md={selectedRole === USER_ROLES.INCUBATEE ? 12 : 24}>
                                <Form.Item name="phone" label={t('Primary phone')}><Input size="large" placeholder={t('Include country code, e.g. +263...')} /></Form.Item>
                                <WhatsAppToggle name="phoneIsWhatsApp" />
                            </Col>
                            {selectedRole === USER_ROLES.INCUBATEE && <Col xs={24} md={12}>
                                <Form.Item name="alternativePhone" label={t('Alternative phone')}><Input size="large" placeholder={t('Optional alternative number')} /></Form.Item>
                                <WhatsAppToggle name="alternativePhoneIsWhatsApp" />
                            </Col>}
                        </Row>
                        <p className="admin-form-modal-note"><WhatsAppOutlined /> {t('Only numbers explicitly marked as WhatsApp can identify this user to the AI. Marking a number confirms it belongs to this person; it does not query WhatsApp automatically.')}</p>
                    </section>
                    {selectedRole && FIXED_ACCESS_ROLES.includes(selectedRole) ? (
                        <p className="admin-form-modal-note"><AppstoreOutlined /> {selectedRole === USER_ROLES.FUNDER
                            ? t('Funders always get read-only funder access. What they see is set by the programmes above.')
                            : t('Reception admins always get the reception access for their company.')}</p>
                    ) : (
                        <section className="admin-form-modal-section">
                            <AdminFormSectionHead
                                icon={<AppstoreOutlined />}
                                title={t('permissions.featureAccess')}
                                hint={t('What this user can open and change')}
                                extra={<span className="admin-form-modal-count">{t('{count} of {total} enabled', undefined, { count: enabledFeatures, total: FEATURE_PERMISSION_OPTIONS.length })}</span>}
                            />
                            <Form.Item name="permissions" noStyle><FeaturePermissionsField /></Form.Item>
                        </section>
                    )}
                </Form>
            </ResponsiveModal>
            <Modal
                open={cleanupOpen}
                title={t('Clean orphan user records')}
                onCancel={() => setCleanupOpen(false)}
                width={760}
                footer={<Button block shape="round" size="large" danger type="primary" icon={<UserDeleteOutlined />} loading={cleaningOrphans} disabled={!orphanUsers.length || cleanupConfirmation !== 'DELETE ORPHAN USERS'} onClick={() => void cleanOrphans()}>{t('Delete orphan records')}</Button>}
            >
                <Alert type="warning" showIcon message={`${orphanUsers.length} orphan user record${orphanUsers.length === 1 ? '' : 's'} found`} description={t('These Firestore profiles have neither a matching Firebase Auth UID nor a matching Auth email. Cleanup removes their identity, assignee, participant and profile records. Applications, interventions and reporting history are preserved.')} />
                <List
                    style={{ marginTop: 16, maxHeight: 300, overflow: 'auto' }}
                    bordered
                    locale={{ emptyText: t('No orphan records were found. Nothing will be deleted.') }}
                    dataSource={orphanUsers}
                    renderItem={item => <List.Item><List.Item.Meta title={<Space><Typography.Text strong>{item.name || item.email || item.id}</Typography.Text><Tag>{item.role || t('No role')}</Tag></Space>} description={`${item.email || 'No email'} · ${item.companyCode || 'No company'} · ${item.id}`} /></List.Item>}
                />
                {!!orphanUsers.length && <div style={{ marginTop: 16 }}><Typography.Paragraph>{t('Type')} <Typography.Text code>{t('DELETE ORPHAN USERS')}</Typography.Text> {t('to confirm:')}</Typography.Paragraph><Input value={cleanupConfirmation} onChange={event => setCleanupConfirmation(event.target.value)} placeholder={t('DELETE ORPHAN USERS')} /></div>}
            </Modal>
        </DashboardPage>
    )
}
