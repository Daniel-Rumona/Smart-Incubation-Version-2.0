import { Alert, App, AutoComplete, Avatar, Button, Col, Form, Input, List, Modal, Popconfirm, Row, Select, Space, Switch, Tag, Typography, type TableProps } from 'antd'
import { BankOutlined, CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, StopOutlined, TeamOutlined, UserDeleteOutlined } from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { FeaturePermissionsField } from '@/components/shared/FeaturePermissionsField'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { USER_ROLES, type UserRole } from '@/config/roles'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { cleanupOrphanUsers, createManagedUser, deleteManagedUser, listManagedUsers, previewOrphanUsers, updateManagedUser, type OrphanUserRecord } from '@/services/usersService'
import type { ManagedUser } from '@/types/operations'
import { getRolePermissions } from '@/config/permissions'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import '@/styles/user-management.css'

type UserForm = Omit<ManagedUser, 'id' | 'status'> & { active: boolean }
const initialsOf = (name: string, email: string) =>
    (name || email || '?').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')

const UserAvatar = ({ row, size }: { row: ManagedUser, size?: number }) => (
    <Avatar shape="circle" size={size} src={row.photoUrl || undefined} style={{ flexShrink: 0 }}>{initialsOf(row.name, row.email)}</Avatar>
)

export const UserManagementPage = () => {
    const { message } = App.useApp()
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<UserForm>()
    const selectedRole = Form.useWatch('role', form)
    const [users, setUsers] = useState<ManagedUser[]>([])
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<ManagedUser>()
    const [modalOpen, setModalOpen] = useState(false)
    const [cleanupOpen, setCleanupOpen] = useState(false)
    const [scanningOrphans, setScanningOrphans] = useState(false)
    const [cleaningOrphans, setCleaningOrphans] = useState(false)
    const [orphanUsers, setOrphanUsers] = useState<OrphanUserRecord[]>([])
    const [cleanupConfirmation, setCleanupConfirmation] = useState('')
    const roleOptions = useMemo(() => Object.values(USER_ROLES)
        .filter((role) => user?.role === USER_ROLES.SYSTEM_ADMIN || role !== USER_ROLES.SYSTEM_ADMIN)
        .map((value) => ({ value, label: value })), [user?.role])

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

    const rows = useMemo(() => users.filter((row) => `${row.name} ${row.email} ${row.role} ${row.phone || ''} ${row.alternativePhone || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [search, users])
    const metrics = useMemo(() => ({
        users: users.length,
        active: users.filter((row) => row.status === 'active').length,
        inactive: users.filter((row) => row.status === 'inactive').length,
        companies: new Set(users.map((row) => row.companyCode).filter(Boolean)).size,
    }), [users])
    const companyOptions = useMemo(() => [...new Set(users.map((row) => row.companyCode).filter((code): code is string => !!code))]
        .sort()
        .map((value) => ({ value })), [users])
    useRegisterAgentPageContext({ pageKey: 'admin-users', pageName: 'User management', purpose: 'Manage platform accounts and role access.', filters: { search }, metrics: { users: users.length }, tables: { visibleUsers: rows.length } })

    const openModal = (record?: ManagedUser) => {
        setEditing(record)
        form.setFieldsValue(record ? { ...record, permissions: record.permissions || getRolePermissions(record.role), active: record.status === 'active' } : { active: true, role: USER_ROLES.OPERATIONS, permissions: getRolePermissions(USER_ROLES.OPERATIONS) })
        setModalOpen(true)
    }
    const save = async (values: UserForm) => {
        if (!user) return
        const payload = { ...values, status: values.active ? 'active' : 'inactive' } as Omit<ManagedUser, 'id'>
        delete (payload as Partial<UserForm>).active
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
        if (!user || (user.role !== USER_ROLES.SYSTEM_ADMIN && user.role !== USER_ROLES.ADMIN)) return
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
        { title: t('Role'), dataIndex: 'role', render: (value: UserRole) => <Tag color="purple">{value}</Tag> },
        {
            title: t('WhatsApp'), key: 'whatsapp', render: (_, row) => {
                const phones = [row.phoneIsWhatsApp && row.phone, row.alternativePhoneIsWhatsApp && row.alternativePhone].filter(Boolean)
                return phones.length ? <Space direction="vertical" size={0}>{phones.map((phone) => <Tag color="green" key={String(phone)}>{t('WhatsApp ·')} {phone}</Tag>)}</Space> : <Tag>{t('Not enabled')}</Tag>
            }
        },
        { title: t('Status'), dataIndex: 'status', render: (value: string) => <Tag color={value === 'active' ? 'green' : 'red'}>{value}</Tag> },
        { title: t('Actions'), width: 110, render: (_, row) => <Space><Button shape="circle" icon={<EditOutlined />} onClick={() => openModal(row)} /><Popconfirm title={t('Remove this user record?')} onConfirm={() => void remove(row.id)}><Button shape="circle" danger icon={<DeleteOutlined />} /></Popconfirm></Space> },
    ]

    return (
        <DashboardPage className="user-management-page">
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard icon={<TeamOutlined />} label={t('Users')} value={metrics.users} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard icon={<CheckCircleOutlined />} label={t('Active users')} value={metrics.active} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard icon={<StopOutlined />} label={t('Inactive users')} value={metrics.inactive} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard icon={<BankOutlined />} label={t('Companies')} value={metrics.companies} /></Col>
            </Row>
            <FilterBar primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search users')} allowClear />} actions={<>{user && (user.role === USER_ROLES.SYSTEM_ADMIN || user.role === USER_ROLES.ADMIN) && <Button danger icon={<UserDeleteOutlined />} loading={scanningOrphans} onClick={() => void scanOrphans()}>{t('Clean orphan records')}</Button>}<Button icon={<ReloadOutlined />} onClick={() => void load()}>{t('Refresh')}</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>{t('Add user')}</Button></>} />
            <ResponsiveDataView rowKey="id" rows={rows} columns={columns} loading={loading} emptyText={t('No users match your search.')} renderCard={(row) => <Space orientation="vertical"><Space size={10}><UserAvatar row={row} size={40} /><Space orientation="vertical" size={0}><Typography.Text strong>{row.name}</Typography.Text><Typography.Text type="secondary">{row.email}</Typography.Text></Space></Space><Space><Tag color="purple">{row.role}</Tag><Tag color={row.status === 'active' ? 'green' : 'red'}>{row.status}</Tag><Button shape="circle" icon={<EditOutlined />} onClick={() => openModal(row)} /></Space></Space>} />
            <Modal open={modalOpen} title={editing ? t('Edit user') : t('Add user')} footer={null} onCancel={() => setModalOpen(false)} width={720} className="user-management-modal">
                <Form form={form} layout="vertical" onFinish={(values) => void save(values)}>
                    <Row gutter={12}>
                        <Col xs={24} md={12}><Form.Item name="name" label={t('Name')} rules={[{ required: true }]}><Input /></Form.Item></Col>
                        <Col xs={24} md={12}><Form.Item name="email" label={t('Email')} rules={[{ required: true }, { type: 'email' }]}><Input /></Form.Item></Col>
                        <Col xs={24} md={12}><Form.Item name="role" label={t('Role')} rules={[{ required: true }]}><Select options={roleOptions} onChange={(role: UserRole) => form.setFieldValue('permissions', getRolePermissions(role))} /></Form.Item></Col>
                        <Col xs={24} md={12}><Form.Item name="companyCode" label={t('Company code')}><AutoComplete options={companyOptions} placeholder={t('Select or enter a company code')} allowClear /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                        <Col xs={24} md={16}><Form.Item name="phone" label={t('Primary phone')}><Input placeholder={t('Include country code, e.g. +263...')} /></Form.Item></Col>
                        <Col xs={24} md={8}><Form.Item name="phoneIsWhatsApp" label={t('WhatsApp number')} valuePropName="checked"><Switch checkedChildren={tr('Yes')} unCheckedChildren={tr('No')} /></Form.Item></Col>
                    </Row>
                    {selectedRole === USER_ROLES.INCUBATEE && <Row gutter={12}>
                        <Col xs={24} md={16}><Form.Item name="alternativePhone" label={t('Alternative phone')}><Input placeholder={t('Optional alternative number')} /></Form.Item></Col>
                        <Col xs={24} md={8}><Form.Item name="alternativePhoneIsWhatsApp" label={t('WhatsApp number')} valuePropName="checked"><Switch checkedChildren={tr('Yes')} unCheckedChildren={tr('No')} /></Form.Item></Col>
                    </Row>}
                    <Typography.Paragraph type="secondary">{t('Only numbers explicitly marked as WhatsApp can identify this user to the AI. Marking a number confirms it belongs to this person; it does not query WhatsApp automatically.')}</Typography.Paragraph>
                    <Form.Item name="permissions" label={t('permissions.featureAccess')}><FeaturePermissionsField /></Form.Item>
                    <Form.Item name="active" label={t('Active')} valuePropName="checked"><Switch /></Form.Item>
                    <Button block type="primary" htmlType="submit">{t('Save user')}</Button>
                </Form>
            </Modal>
            <Modal
                open={cleanupOpen}
                title={t('Clean orphan user records')}
                onCancel={() => setCleanupOpen(false)}
                width={760}
                footer={<Space><Button onClick={() => setCleanupOpen(false)}>{t('Cancel')}</Button><Button danger type="primary" icon={<UserDeleteOutlined />} loading={cleaningOrphans} disabled={!orphanUsers.length || cleanupConfirmation !== 'DELETE ORPHAN USERS'} onClick={() => void cleanOrphans()}>{t('Delete orphan records')}</Button></Space>}
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
