import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, AutoComplete, Button, Card, Checkbox, Col, Dropdown, Form, Input, Modal, Radio, Row, Select, Space, Switch, Tag, Timeline, Tooltip, Typography, type TableProps } from 'antd'
import {
    BankOutlined, CalendarOutlined, DownloadOutlined, EditOutlined, FunnelPlotOutlined, ImportOutlined, InboxOutlined, MoreOutlined,
    PlusOutlined, QrcodeOutlined, RollbackOutlined, SearchOutlined, SendOutlined, TeamOutlined, UserAddOutlined,
} from '@ant-design/icons'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { ImportProspectsModal } from '@/components/prospects/ImportProspectsModal'
import { InviteProspectModal } from '@/components/prospects/InviteProspectModal'
import { BookIntoClassModal } from '@/components/prospects/BookIntoClassModal'
import { ProspectFunnel } from '@/components/prospects/ProspectFunnel'
import { SignupLinksDrawer } from '@/components/prospects/SignupLinksDrawer'
import {
    CONSENT_SOURCES,
    CONVERTED_STATUS,
    OWNERSHIP_OPTIONS,
    PROSPECT_SOURCES,
    PROSPECT_STATUSES,
    allowsPeople,
    isClosedStatus,
    statusOption,
    type ProspectModule,
    type ProspectStatus,
} from '@/config/prospects'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import {
    assignProspects,
    findProspectDuplicates,
    listProspectEvents,
    listProspectOwners,
    listProspects,
    saveProspect,
    setProspectArchived,
    setProspectStatus,
} from '@/services/prospectsService'
import { saveTrainingOrganisation } from '@/services/trainingOrganisationsService'
import { listTrainingClasses } from '@/services/trainingService'
import { listProgramsForCompany } from '@/services/workspaceProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import { prospectName, type Prospect, type ProspectDuplicate, type ProspectEvent, type ProspectValues } from '@/types/prospects'
import { downloadText, formatDate, isFollowUpDue, prospectsCsv, todaySa } from '@/utils/prospectFormat'

/**
 * Prospects: businesses and people a company has reached who have not joined yet. The same page serves incubation
 * (SMEs or people who might join a programme) and training (companies or people who might book a class or buy an
 * ESG report); see src/config/prospects.ts for each side's pipeline.
 *
 * Ways in: added by hand, imported from a list or a training class, or self sign-up through an event's QR code.
 * Ways out: invited to a programme with a personal link (incubation) or registered as a client company (training);
 * both are recognised by the server when they happen, so the prospect converts on its own.
 */

type Lookups = { programs: Array<{ id: string, name: string }>, owners: Array<{ uid: string, name: string }>, interests: string[] }
type StatusFilter = ProspectStatus | 'open' | 'all' | 'due'

const EMPTY_VALUES: Partial<ProspectValues> = {
    kind: 'business', ownership: [], source: 'event', consentGiven: false, consentSource: 'verbal', contactAllowed: false,
}

export default function ProspectsPage({ module }: { module: ProspectModule }) {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<ProspectValues>()
    const kind = Form.useWatch('kind', form)
    const [prospects, setProspects] = useState<Prospect[]>()
    const [lookups, setLookups] = useState<Lookups>({ programs: [], owners: [], interests: [] })
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('open')
    const [sourceFilter, setSourceFilter] = useState<string>('all')
    const [ownerFilter, setOwnerFilter] = useState<string>('all')
    const [showArchived, setShowArchived] = useState(false)
    const [selected, setSelected] = useState<Set<string>>(new Set())
    const [editing, setEditing] = useState<{ prospect?: Prospect } | null>(null)
    const [events, setEvents] = useState<ProspectEvent[]>([])
    const [duplicates, setDuplicates] = useState<ProspectDuplicate[] | null>(null)
    const [closing, setClosing] = useState<{ prospect: Prospect, to: ProspectStatus, reason: string } | null>(null)
    const [inviting, setInviting] = useState<Prospect | null>(null)
    const [booking, setBooking] = useState<Prospect | null>(null)
    const [importing, setImporting] = useState(false)
    const [linksOpen, setLinksOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [refreshKey, setRefreshKey] = useState(0)
    const statuses = PROSPECT_STATUSES[module]
    const converted = CONVERTED_STATUS[module]
    const today = todaySa()

    const load = useCallback(async () => {
        if (!user) return
        try {
            const [rows, owners, programs, classes] = await Promise.all([
                listProspects(user, module),
                listProspectOwners(user).catch(() => []),
                module === 'incubation' ? listProgramsForCompany(String(user.companyCode || '')).catch(() => []) : Promise.resolve([]),
                module === 'training' ? listTrainingClasses(user).catch(() => []) : Promise.resolve([]),
            ])
            const courses = Array.from(new Set(classes.map((row) => row.courseTitle).filter(Boolean)))
            setProspects(rows)
            setLookups({ owners, programs: programs.map((row) => ({ id: row.id, name: row.name })), interests: [...courses, 'ESG report', 'Carbon footprint', 'In-house training for staff'] })
            setRefreshKey((key) => key + 1)
        } catch {
            setProspects([])
            message.error(t('Prospects could not be loaded.'))
        }
    }, [message, module, t, user])

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [load])

    const active = useMemo(() => (prospects || []).filter((row) => !row.archivedAt), [prospects])
    const visible = useMemo(() => (prospects || []).filter((row) => {
        if (Boolean(row.archivedAt) !== showArchived) return false
        if (statusFilter === 'open' && (isClosedStatus(row.status) || row.status === converted)) return false
        if (statusFilter === 'due' && !isFollowUpDue(row, today)) return false
        if (!['open', 'all', 'due'].includes(statusFilter) && row.status !== statusFilter) return false
        if (sourceFilter !== 'all' && row.source !== sourceFilter) return false
        if (ownerFilter === 'none' ? Boolean(row.ownerUid) : ownerFilter !== 'all' && row.ownerUid !== ownerFilter) return false
        const needle = search.trim().toLowerCase()
        return !needle || [row.businessName, row.contactName, row.email, row.phone, row.sector, row.sourceDetail].some((value) => value.toLowerCase().includes(needle))
    }), [converted, ownerFilter, prospects, search, showArchived, sourceFilter, statusFilter, today])
    const selectedRows = visible.filter((row) => selected.has(row.id))

    const counts = useMemo(() => ({
        total: active.length,
        open: active.filter((row) => !isClosedStatus(row.status) && row.status !== converted).length,
        joined: active.filter((row) => row.status === converted).length,
        due: active.filter((row) => isFollowUpDue(row, today)).length,
    }), [active, converted, today])

    useRegisterAgentPageContext({
        pageKey: module === 'training' ? 'training-prospects' : 'operations-prospects',
        pageName: 'Prospects',
        purpose: module === 'training'
            ? 'Companies and people the training company has reached who might book a class or buy an ESG report: where they came from, who follows up, and how far each has got.'
            : 'Businesses (SMEs) the incubator has reached who might join a programme: where they came from, who follows up, and how far each has got.',
        metrics: { prospects: counts.total, open: counts.open, [module === 'training' ? 'clients' : 'joined']: counts.joined, followUpsDue: counts.due },
        dataSummary: {
            byStatus: Object.fromEntries(statuses.map((option) => [option.label, active.filter((row) => row.status === option.key).length])),
            bySource: Object.fromEntries(PROSPECT_SOURCES.map((option) => [option.label, active.filter((row) => row.source === option.key).length])),
            followUpsDue: active.filter((row) => isFollowUpDue(row, today)).slice(0, 20).map((row) => ({ name: prospectName(row), due: row.nextFollowUpAt, owner: row.ownerName || null })),
            prospects: active.slice(0, 40).map((row) => ({ name: prospectName(row), status: statusOption(module, row.status).label, source: row.source, owner: row.ownerName || null, fit: row.programName || row.interest || null })),
        },
    })

    const startEdit = async (prospect?: Prospect) => {
        setEditing({ prospect })
        setDuplicates(null)
        setEvents([])
        form.resetFields()
        form.setFieldsValue(prospect ? {
            kind: prospect.kind, businessName: prospect.businessName, contactName: prospect.contactName, phone: prospect.phone, email: prospect.email,
            registrationNumber: prospect.registrationNumber, sector: prospect.sector, province: prospect.province, ownership: prospect.ownership,
            source: prospect.source, sourceDetail: prospect.sourceDetail, programId: prospect.programId, interest: prospect.interest,
            ownerUid: prospect.ownerUid, notes: prospect.notes, nextFollowUpAt: prospect.nextFollowUpAt,
            consentGiven: prospect.consent.given, consentSource: prospect.consent.source,
            contactAllowed: prospect.consent.contactAllowed, consentNote: prospect.consent.note,
        } : { ...EMPTY_VALUES, ownerUid: user?.uid })
        if (prospect && user) setEvents(await listProspectEvents(user, prospect).catch(() => []))
    }

    const save = async (confirmedDuplicates = false) => {
        if (!user || !editing) return
        const values = await form.validateFields()
        setSaving(true)
        try {
            if (!confirmedDuplicates) {
                const found = await findProspectDuplicates(user, module, values, editing.prospect?.id).catch(() => [])
                if (found.length) {
                    setDuplicates(found)
                    return
                }
            }
            await saveProspect(user, module, values, lookups, editing.prospect)
            message.success(editing.prospect ? t('Prospect saved.') : t('Prospect added.'))
            setEditing(null)
            await load()
        } catch (error) {
            const code = error instanceof Error ? error.message : ''
            message.error(code === 'consent_required'
                ? t('Record their consent before adding them.')
                : t('The prospect could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const moveTo = async (prospect: Prospect, status: ProspectStatus, note?: string) => {
        if (!user) return
        // Closing (not interested, lost) asks why first: the reasons show where leads are lost.
        if (isClosedStatus(status) && note === undefined) {
            setClosing({ prospect, to: status, reason: '' })
            return
        }
        try {
            await setProspectStatus(user, prospect, status, note)
            message.success(t('{name}: {status}', undefined, { name: prospectName(prospect), status: t(statusOption(module, status).label) }))
            await load()
        } catch {
            message.error(t('The status could not be changed.'))
        }
    }

    const archive = async (prospect: Prospect, archived: boolean) => {
        if (!user) return
        try {
            await setProspectArchived(user, prospect, archived)
            message.success(archived ? t('{name} archived. You can restore it from the archive.', undefined, { name: prospectName(prospect) }) : t('{name} restored.', undefined, { name: prospectName(prospect) }))
            await load()
        } catch {
            message.error(t('The prospect could not be updated.'))
        }
    }

    /** Training: registers the company as a client; the server then marks the prospect "Client". */
    const makeClient = async (prospect: Prospect) => {
        if (!user) return
        try {
            await saveTrainingOrganisation(user, { name: prospect.businessName, contactName: prospect.contactName, contactEmail: prospect.email, phone: prospect.phone })
            message.success(t('{name} is now registered as a client company.', undefined, { name: prospect.businessName }))
            window.setTimeout(() => void load(), 2500)
        } catch (error) {
            message.error(error instanceof Error && error.message === 'duplicate_organisation'
                ? t('A client company with this name is already registered.')
                : t('The client company could not be registered.'))
        }
    }

    const assign = async (ownerUid: string | null) => {
        if (!user || !selectedRows.length) return
        const owner = lookups.owners.find((row) => row.uid === ownerUid) || null
        try {
            await assignProspects(user, selectedRows, owner)
            message.success(t('{count} prospects assigned.', undefined, { count: selectedRows.length }))
            setSelected(new Set())
            await load()
        } catch {
            message.error(t('The prospects could not be assigned.'))
        }
    }

    const exportRows = (rows: Prospect[]) => downloadText(`prospects-${module}-${today}.csv`, prospectsCsv(rows, module))

    const toggle = (id: string, checked: boolean) => setSelected((current) => {
        const next = new Set(current)
        if (checked) next.add(id)
        else next.delete(id)
        return next
    })

    const statusSelect = (row: Prospect) => (
        <Select
            size="small"
            value={row.status}
            disabled={Boolean(row.archivedAt)}
            style={{ minWidth: 150 }}
            onClick={(event) => event.stopPropagation()}
            onChange={(value) => void moveTo(row, value)}
            options={statuses.map((option) => ({ value: option.key, label: <Tag color={option.color} style={{ marginInlineEnd: 0 }}>{t(option.label)}</Tag> }))}
        />
    )

    const sourceLabel = (row: Prospect) => [t(PROSPECT_SOURCES.find((option) => option.key === row.source)?.label || 'Other'), row.sourceDetail].filter(Boolean).join(' · ')

    const followUpCell = (row: Prospect) => {
        if (!row.nextFollowUpAt) return '—'
        return isFollowUpDue(row, today)
            ? <Tag color="red" icon={<CalendarOutlined />}>{row.nextFollowUpAt < today ? t('Overdue: {date}', undefined, { date: formatDate(row.nextFollowUpAt) }) : t('Today')}</Tag>
            : formatDate(row.nextFollowUpAt)
    }

    const actions = (row: Prospect) => {
        const items = [
            { key: 'edit', icon: <EditOutlined />, label: t('Edit'), onClick: () => void startEdit(row) },
            ...(module === 'incubation' && !row.archivedAt && row.status !== converted
                ? [{ key: 'invite', icon: <SendOutlined />, label: t('Invite to a programme'), onClick: () => setInviting(row) }] : []),
            ...(module === 'training' && !row.archivedAt
                ? [{ key: 'book', icon: <CalendarOutlined />, label: t('Book into a class'), onClick: () => setBooking(row) }] : []),
            ...(module === 'training' && !row.archivedAt && row.kind === 'business' && !row.organisationId
                ? [{ key: 'client', icon: <BankOutlined />, label: t('Register as client company'), onClick: () => void makeClient(row) }] : []),
            row.archivedAt
                ? { key: 'restore', icon: <RollbackOutlined />, label: t('Restore'), onClick: () => void archive(row, false) }
                : { key: 'archive', icon: <InboxOutlined />, label: t('Archive'), onClick: () => void archive(row, true) },
        ]
        return (
            <Space onClick={(event) => event.stopPropagation()}>
                {module === 'training' && !row.archivedAt && (
                    <Tooltip title={t('Book into a class')}><Button icon={<CalendarOutlined />} onClick={() => setBooking(row)} aria-label={t('Book into a class')} /></Tooltip>
                )}
                {module === 'incubation' && !row.archivedAt && row.status !== converted && (
                    <Tooltip title={t('Invite to a programme')}><Button icon={<SendOutlined />} onClick={() => setInviting(row)} aria-label={t('Invite to a programme')} /></Tooltip>
                )}
                <Dropdown menu={{ items }} trigger={['click']}><Button icon={<MoreOutlined />} aria-label={t('More')} /></Dropdown>
            </Space>
        )
    }

    const allVisibleSelected = visible.length > 0 && visible.every((row) => selected.has(row.id))
    const columns: TableProps<Prospect>['columns'] = [
        {
            title: <Checkbox checked={allVisibleSelected} indeterminate={!allVisibleSelected && selectedRows.length > 0} onChange={(event) => setSelected(event.target.checked ? new Set(visible.map((row) => row.id)) : new Set())} aria-label={t('Select all')} />,
            key: 'select',
            width: 44,
            render: (_, row) => <Checkbox checked={selected.has(row.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => toggle(row.id, event.target.checked)} aria-label={t('Select {name}', undefined, { name: prospectName(row) })} />,
        },
        {
            title: t('Prospect'),
            key: 'name',
            render: (_, row) => (
                <Space orientation="vertical" size={0}>
                    <Typography.Text strong>{prospectName(row)}</Typography.Text>
                    <Typography.Text type="secondary">{(row.kind === 'person' ? [t('Person'), row.phone || row.email] : [row.contactName, row.phone || row.email]).filter(Boolean).join(' · ') || t('No contact details yet')}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Came from'), key: 'source', render: (_, row) => sourceLabel(row) },
        { title: module === 'training' ? t('Interested in') : t('Programme'), key: 'fit', render: (_, row) => (row.bookedClassLabel ? <Space orientation="vertical" size={0}><span>{row.interest || '—'}</span><Typography.Text type="secondary">{t('Booked: {label}', undefined, { label: row.bookedClassLabel })}</Typography.Text></Space> : row.programName || row.interest || '—') },
        { title: t('Follows up'), key: 'owner', render: (_, row) => row.ownerName || '—' },
        { title: t('Next follow-up'), key: 'followUp', render: (_, row) => followUpCell(row) },
        { title: t('Status'), key: 'status', render: (_, row) => statusSelect(row) },
        { title: '', key: 'actions', align: 'right', render: (_, row) => actions(row) },
    ]

    const duplicateLabel = (duplicate: ProspectDuplicate) => {
        const what = duplicate.kind === 'participant' ? t('a participant') : duplicate.kind === 'client' ? t('a client company') : duplicate.archived ? t('an archived prospect') : t('a prospect')
        const on = duplicate.matchedOn.map((key) => ({ phone: t('phone'), email: t('email'), registration: t('registration number'), name: t('name') })[key]).join(', ')
        return t('{name} is already {what} (same {on}).', undefined, { name: duplicate.name, what, on })
    }

    return (
        <DashboardPage className={module === 'training' ? 'training-page' : undefined}>
            <Row gutter={[14, 14]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={!prospects} icon={<TeamOutlined />} label={t('Prospects')} value={counts.total} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!prospects} icon={<FunnelPlotOutlined />} label={t('Still open')} value={counts.open} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!prospects} icon={<UserAddOutlined />} label={module === 'training' ? t('Became clients') : t('Joined')} value={counts.joined} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={!prospects} icon={<CalendarOutlined />} label={t('Follow-ups due')} value={counts.due} /></Col>
            </Row>
            <FilterBar
                primary={<Input prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('Search name, contact, sector or event')} allowClear />}
                advanced={(
                    <>
                        <Select
                            value={statusFilter}
                            onChange={setStatusFilter}
                            style={{ minWidth: 170 }}
                            options={[
                                { value: 'open', label: t('Still open') },
                                { value: 'due', label: t('Follow-up due') },
                                { value: 'all', label: t('All statuses') },
                                ...statuses.map((option) => ({ value: option.key, label: t(option.label) })),
                            ]}
                        />
                        <Select value={sourceFilter} onChange={setSourceFilter} style={{ minWidth: 160 }} options={[{ value: 'all', label: t('All sources') }, ...PROSPECT_SOURCES.map((option) => ({ value: option.key, label: t(option.label) }))]} />
                        <Select value={ownerFilter} onChange={setOwnerFilter} style={{ minWidth: 160 }} options={[{ value: 'all', label: t('Everyone') }, { value: 'none', label: t('Nobody yet') }, ...lookups.owners.map((row) => ({ value: row.uid, label: row.name }))]} />
                        <Space><Switch size="small" checked={showArchived} onChange={setShowArchived} /><Typography.Text>{t('Archive')}</Typography.Text></Space>
                    </>
                )}
                actions={(
                    <>
                        <Button icon={<QrcodeOutlined />} onClick={() => setLinksOpen(true)}>{t('Sign-up links')}</Button>
                        <Button icon={<ImportOutlined />} onClick={() => setImporting(true)}>{t('Import')}</Button>
                        <Button icon={<DownloadOutlined />} disabled={!visible.length} onClick={() => exportRows(visible)}>{t('Export')}</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => void startEdit()}>{t('Add prospect')}</Button>
                    </>
                )}
            />
            {selectedRows.length > 0 && (
                <Card size="small" style={{ marginBottom: 12 }}>
                    <Space wrap>
                        <Typography.Text strong>{t('{count} selected', undefined, { count: selectedRows.length })}</Typography.Text>
                        <Select
                            placeholder={t('Assign to…')}
                            style={{ minWidth: 200 }}
                            onChange={(value: string) => void assign(value === 'none' ? null : value)}
                            options={[...lookups.owners.map((row) => ({ value: row.uid, label: row.name })), { value: 'none', label: t('Nobody') }]}
                        />
                        <Button icon={<DownloadOutlined />} onClick={() => exportRows(selectedRows)}>{t('Export selected')}</Button>
                        <Button type="link" onClick={() => setSelected(new Set())}>{t('Clear selection')}</Button>
                    </Space>
                </Card>
            )}
            <ResponsiveDataView
                rowKey="id"
                rows={visible}
                columns={columns}
                loading={!prospects}
                onRowClick={(row) => void startEdit(row)}
                emptyText={showArchived
                    ? t('Nothing in the archive.')
                    : active.length ? t('No prospects match these filters.') : module === 'training'
                        ? t('No prospects yet. Add the companies and people who might book a class or an ESG report.')
                        : t('No prospects yet. Add the businesses you meet who might join a programme.')}
                renderCard={(row) => (
                    <Space orientation="vertical" style={{ width: '100%' }}>
                        <Typography.Text strong>{prospectName(row)}</Typography.Text>
                        <Typography.Text type="secondary">{[sourceLabel(row), row.programName || row.interest, row.ownerName].filter(Boolean).join(' · ')}</Typography.Text>
                        {row.nextFollowUpAt && <span>{followUpCell(row)}</span>}
                        <Space wrap>{statusSelect(row)}{actions(row)}</Space>
                    </Space>
                )}
            />

            <Card title={t('Reach beyond the enrolled cohort')} style={{ marginTop: 16 }} extra={<Typography.Text type="secondary">{t('Each funder sees only the numbers for what it funds, never names.')}</Typography.Text>}>
                <ProspectFunnel module={module} refreshKey={refreshKey} />
            </Card>

            <Modal
                open={editing !== null}
                title={editing?.prospect ? prospectName(editing.prospect) : t('Add prospect')}
                okText={duplicates ? t('Save anyway') : t('Save')}
                confirmLoading={saving}
                onOk={() => void save(Boolean(duplicates))}
                onCancel={() => setEditing(null)}
                width={720}
                destroyOnHidden
            >
                {duplicates && (
                    <Alert
                        type="warning"
                        showIcon
                        style={{ marginBottom: 16 }}
                        title={t('This may already be on record')}
                        description={<ul style={{ margin: 0, paddingInlineStart: 18 }}>{duplicates.slice(0, 5).map((duplicate) => <li key={`${duplicate.kind}-${duplicate.id}`}>{duplicateLabel(duplicate)}</li>)}</ul>}
                    />
                )}
                <Form form={form} layout="vertical" requiredMark={false} onValuesChange={() => duplicates && setDuplicates(null)}>
                    <Form.Item name="kind" hidden={!allowsPeople(module)}>
                        <Radio.Group optionType="button" options={[{ value: 'business', label: module === 'training' ? t('A company') : t('A business') }, { value: 'person', label: t('A person') }]} />
                    </Form.Item>
                    <Row gutter={12}>
                        {kind !== 'person' && (
                            <Col xs={24} sm={12}>
                                <Form.Item name="businessName" label={module === 'training' ? t('Company name') : t('Business name')} rules={[{ required: true, whitespace: true, message: t('Enter the name.') }]}>
                                    <Input maxLength={160} />
                                </Form.Item>
                            </Col>
                        )}
                        <Col xs={24} sm={12}>
                            <Form.Item name="contactName" label={kind === 'person' ? t('Name') : t('Contact person')} rules={kind === 'person' ? [{ required: true, whitespace: true, message: t('Enter their name.') }] : []}>
                                <Input maxLength={120} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}><Form.Item name="phone" label={t('Phone (WhatsApp)')}><Input maxLength={40} /></Form.Item></Col>
                        <Col xs={24} sm={12}><Form.Item name="email" label={t('Email')} rules={[{ type: 'email', message: t('Enter a valid email address.') }]}><Input maxLength={160} /></Form.Item></Col>
                    </Row>
                    <Row gutter={12}>
                        <Col xs={24} sm={8}><Form.Item name="sector" label={t('Sector')}><Input maxLength={80} /></Form.Item></Col>
                        <Col xs={24} sm={8}><Form.Item name="province" label={t('Province')}><Input maxLength={60} /></Form.Item></Col>
                        {kind !== 'person' && <Col xs={24} sm={8}><Form.Item name="registrationNumber" label={t('Registration number')}><Input maxLength={40} /></Form.Item></Col>}
                    </Row>
                    {kind !== 'person' && (
                        <Form.Item name="ownership" label={t('Ownership (optional)')}>
                            <Checkbox.Group options={OWNERSHIP_OPTIONS.map((option) => ({ value: option.key, label: t(option.label) }))} />
                        </Form.Item>
                    )}
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            <Form.Item name="source" label={t('Where you met them')}>
                                <Select options={PROSPECT_SOURCES.map((option) => ({ value: option.key, label: t(option.label) }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                            <Form.Item name="sourceDetail" label={t('Which one')} extra={t('e.g. the event, class or person who referred them')}>
                                <Input maxLength={160} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            {module === 'incubation' ? (
                                <Form.Item name="programId" label={t('Programme they might fit')}>
                                    <Select allowClear options={lookups.programs.map((row) => ({ value: row.id, label: row.name }))} placeholder={t('Not decided yet')} />
                                </Form.Item>
                            ) : (
                                <Form.Item name="interest" label={t('Interested in')}>
                                    <AutoComplete options={lookups.interests.map((value) => ({ value }))} placeholder={t('A course, class or service')} filterOption={(input, option) => String(option?.value || '').toLowerCase().includes(input.toLowerCase())} />
                                </Form.Item>
                            )}
                        </Col>
                        <Col xs={24} sm={6}>
                            <Form.Item name="ownerUid" label={t('Who follows up')}>
                                <Select allowClear options={lookups.owners.map((row) => ({ value: row.uid, label: row.name }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={6}>
                            <Form.Item name="nextFollowUpAt" label={t('Next follow-up')}>
                                <Input type="date" min={editing?.prospect ? undefined : today} />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="notes" label={t('Notes')}><Input.TextArea rows={3} maxLength={4000} /></Form.Item>

                    <Typography.Title level={5}>{t('Consent')}</Typography.Title>
                    <Form.Item
                        name="consentGiven"
                        valuePropName="checked"
                        rules={[{ validator: (_, value) => (value ? Promise.resolve() : Promise.reject(new Error(t('They must agree before you add them.')))) }]}
                        extra={t('Only keep people on record who agreed to it. Prospects that never join are anonymised after 12 months.')}
                    >
                        <Checkbox disabled={Boolean(editing?.prospect?.consent.given)}>{t('They agreed that we keep their details to follow up')}</Checkbox>
                    </Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            <Form.Item name="consentSource" label={t('How they agreed')}>
                                <Select options={CONSENT_SOURCES.map((option) => ({ value: option.key, label: t(option.label) }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                            <Form.Item name="contactAllowed" valuePropName="checked" label={t('Messages from the system')}>
                                <Checkbox>{t('They agreed to receive WhatsApp or email from us')}</Checkbox>
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="consentNote" label={t('Consent note (optional)')}><Input maxLength={300} /></Form.Item>
                </Form>

                {editing?.prospect && events.length > 0 && (
                    <>
                        <Typography.Title level={5}>{t('History')}</Typography.Title>
                        <Timeline
                            items={events.map((event) => ({
                                key: event.id,
                                content: (
                                    <Typography.Text>
                                        {event.from && event.from !== event.to
                                            ? t('{from} → {to}', undefined, { from: t(statusOption(module, event.from).label), to: t(statusOption(module, event.to).label) })
                                            : event.from ? t(statusOption(module, event.to).label) : t('Added')}
                                        {event.note && <Typography.Text type="secondary">{` · ${event.note}`}</Typography.Text>}
                                        <Typography.Text type="secondary">{` · ${event.byName} · ${formatDate(event.at)}`}</Typography.Text>
                                    </Typography.Text>
                                ),
                            }))}
                        />
                    </>
                )}
            </Modal>

            <Modal
                open={closing !== null}
                title={closing ? t('Why is {name} {status}?', undefined, { name: prospectName(closing.prospect), status: t(statusOption(module, closing.to).label).toLowerCase() }) : ''}
                okText={t('Save')}
                onOk={() => { if (closing) { void moveTo(closing.prospect, closing.to, closing.reason.trim()); setClosing(null) } }}
                onCancel={() => setClosing(null)}
                destroyOnHidden
            >
                <Space orientation="vertical" style={{ width: '100%' }}>
                    <Select
                        style={{ width: '100%' }}
                        placeholder={t('Choose a reason')}
                        value={closing?.reason || undefined}
                        onChange={(value: string) => setClosing((current) => current && { ...current, reason: value })}
                        options={['Not the right time', 'Too expensive', 'Not eligible', 'Chose another provider', 'No response', 'Business closed'].map((value) => ({ value, label: t(value) }))}
                    />
                    <Input placeholder={t('…or write your own')} maxLength={200} onChange={(event) => setClosing((current) => current && { ...current, reason: event.target.value })} />
                </Space>
            </Modal>

            {inviting && (
                <InviteProspectModal prospect={inviting} programs={lookups.programs} onClose={() => setInviting(null)} onInvited={() => void load()} />
            )}
            {booking && (
                <BookIntoClassModal prospect={booking} onClose={() => setBooking(null)} onBooked={() => { setBooking(null); window.setTimeout(() => void load(), 1500) }} />
            )}
            {importing && (
                <ImportProspectsModal module={module} existing={prospects || []} owners={lookups.owners} onClose={() => setImporting(false)} onImported={() => { setImporting(false); void load() }} />
            )}
            <SignupLinksDrawer module={module} open={linksOpen} onClose={() => { setLinksOpen(false); void load() }} programs={lookups.programs} owners={lookups.owners} />
        </DashboardPage>
    )
}
