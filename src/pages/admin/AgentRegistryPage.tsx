import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdminKpiTile, AdminShareRing } from '@/components/admin/AdminKpiTile'
import { listAgentRatings, type AgentRatingRecord } from '@/services/agentRatingsService'
import { AgentRatingsSummary } from '@/pages/admin/AgentRatingsSummary'
import {
    App,
    Alert,
    Card,
    Col,
    Row,
    Segmented,
    Spin,
    Button,
    Empty,
    Form,
    Input,
    Modal,
    Select,
    Space,
    Switch,
    Tag,
    Typography,
} from 'antd'
import {
    ApiOutlined,
    DollarOutlined,
    EditOutlined,
    FileWordOutlined,
    InboxOutlined,
    PlusOutlined,
    RobotOutlined,
    SaveOutlined,
    ApartmentOutlined,
    SafetyCertificateOutlined,
    SoundOutlined,
    StarFilled,
    StarOutlined,
} from '@ant-design/icons'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { listWorkspaceCompanies, type WorkspaceCompany } from '@/services/companiesService'
import { getCompanyAgentSettings, saveCompanyAgentSettings } from '@/services/agentOrchestrationService'
import type { AgentId } from '@/types/agentOrchestration'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import {
    AGENT_IMPLEMENTATIONS,
    getAgentImplementation,
} from '@/config/agentImplementations'
import {
    archiveAgent,
    createAgent,
    subscribeAgents,
    updateAgent,
} from '@/services/agentRegistryService'
import type {
    AgentDefinition,
    AgentImplementationKey,
    AgentRegistryInput,
    AgentStatus,
} from '@/types/agentOrchestration'
import '@/styles/agent-registry.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import { ModalActions } from '@/components/shared/ModalActions'

const { TextArea } = Input

const STATUS_OPTIONS: Array<{ value: AgentStatus; label: string }> = [
    { value: 'active', get label() { return tr('Active') } },
    { value: 'inactive', get label() { return tr('Inactive') } },
]

type AgentFormValues = {
    id: string
    name: string
    description: string
    implementationKey: AgentImplementationKey
    capabilities: string[]
    status: AgentStatus
    supportsAssignment: boolean
}

const formatStatus = (status: AgentStatus) =>
    status.charAt(0).toUpperCase() + status.slice(1)

type ManagementView = 'registry' | 'availability' | 'ratings'
const VIEWS: ManagementView[] = ['registry', 'availability', 'ratings']

const CompanyAvailabilityPanel = ({ agents }: { agents: AgentDefinition[] }) => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const [companies, setCompanies] = useState<WorkspaceCompany[]>([])
    const [companyCode, setCompanyCode] = useState<string>()
    const [enabled, setEnabled] = useState<AgentId[]>([])
    const [savedEnabled, setSavedEnabled] = useState<AgentId[]>([])
    const [loadingCompanies, setLoadingCompanies] = useState(true)
    const [loadingSettings, setLoadingSettings] = useState(false)
    const [settingsError, setSettingsError] = useState(false)
    const [saving, setSaving] = useState(false)
    const [search, setSearch] = useState('')
    const [availabilityFilter, setAvailabilityFilter] = useState('all')

    const eligibleAgents = useMemo(
        () => agents.filter(agent => agent.status === 'active' && agent.supportsAssignment),
        [agents],
    )
    const eligibleIds = useMemo(() => new Set(eligibleAgents.map(agent => agent.id)), [eligibleAgents])
    const visibleAgents = useMemo(() => eligibleAgents.filter(agent => {
        if (availabilityFilter === 'enabled' && !enabled.includes(agent.id)) return false
        if (availabilityFilter === 'disabled' && enabled.includes(agent.id)) return false
        const q = search.trim().toLowerCase()
        return !q || [agent.name, agent.description, agent.provider, ...agent.capabilities]
            .some(value => value.toLowerCase().includes(q))
    }), [eligibleAgents, search, availabilityFilter, enabled])
    const changed = useMemo(() =>
        [...enabled].sort().join('|') !== [...savedEnabled].sort().join('|'),
        [enabled, savedEnabled],
    )
    const selectedCompany = companies.find(company => company.code === companyCode)
    const enabledCount = enabled.filter(id => eligibleIds.has(id)).length

    useEffect(() => {
        if (!user) {
            setLoadingCompanies(false)
            return
        }
        let cancelled = false
        setLoadingCompanies(true)
        void listWorkspaceCompanies(user).then(rows => {
            if (cancelled) return
            setCompanies(rows)
            setCompanyCode(current => current ?? rows[0]?.code)
        }).catch(() => {
            if (!cancelled) message.error(t('Companies could not be loaded.'))
        }).finally(() => {
            if (!cancelled) setLoadingCompanies(false)
        })
        return () => { cancelled = true }
    }, [user, message, t])

    useEffect(() => {
        if (!companyCode) return
        let cancelled = false
        setLoadingSettings(true)
        setSettingsError(false)
        void getCompanyAgentSettings(companyCode, eligibleAgents).then(settings => {
            if (cancelled) return
            const allowed = settings.enabledAgentIds.filter(id => eligibleIds.has(id))
            setEnabled(allowed)
            setSavedEnabled(allowed)
        }).catch(() => {
            if (!cancelled) {
                setSettingsError(true)
                message.error(t('Agent availability could not be loaded.'))
            }
        }).finally(() => {
            if (!cancelled) setLoadingSettings(false)
        })
        return () => { cancelled = true }
    }, [companyCode, eligibleAgents, eligibleIds, message, t])

    const changeCompany = (next: string) => {
        if (next === companyCode) return
        if (!changed) {
            setCompanyCode(next)
            return
        }
        modal.confirm({
            title: t('Discard unsaved changes?'),
            content: t('Changing companies will discard unsaved agent availability changes.'),
            okText: t('Discard changes'),
            okButtonProps: { danger: true },
            onOk: () => setCompanyCode(next),
        })
    }

    const save = async () => {
        if (!user || !companyCode || settingsError || loadingSettings) return
        setSaving(true)
        try {
            await saveCompanyAgentSettings(companyCode, enabled.filter(id => eligibleIds.has(id)), user)
            setSavedEnabled([...enabled])
            message.success(t('Company agent availability saved.'))
        } catch {
            message.error(t('Agent availability could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <section className="agent-availability-embedded">
            <div className="agent-availability-toolbar">
                <div className="agent-availability-company">
                    <span className="agent-availability-label"><ApartmentOutlined /> {t('Company')}</span>
                    <Select
                        showSearch
                        optionFilterProp="label"
                        value={companyCode}
                        onChange={changeCompany}
                        placeholder={t('Select a company')}
                        loading={loadingCompanies}
                        options={companies.map(company => ({ value: company.code, label: company.name }))}
                        className="agent-availability-company-select"
                    />
                </div>
                <div className="agent-availability-overview">
                    <div><strong>{enabledCount}</strong><span>{t('Enabled')}</span></div>
                    <div><strong>{Math.max(eligibleAgents.length - enabledCount, 0)}</strong><span>{t('Unavailable')}</span></div>
                    <div><strong>{eligibleAgents.length ? Math.round(enabledCount / eligibleAgents.length * 100) : 0}%</strong><span>{t('Coverage')}</span></div>
                </div>
            </div>

            <FilterBar
                primary={<>
                    <Input.Search value={search} allowClear onChange={e => setSearch(e.target.value)} placeholder={t('Search agents')} className="agent-registry-search" />
                    <Select value={availabilityFilter} onChange={setAvailabilityFilter} className="agent-registry-filter-select" options={[
                        { value: 'all', label: t('All agents') },
                        { value: 'enabled', label: t('Enabled') },
                        { value: 'disabled', label: t('Unavailable') },
                    ]} />
                </>}
            />

            {!companyCode ? (
                <div className="agent-availability-empty"><Empty description={t('Select a company to configure its agents.')} /></div>
            ) : !eligibleAgents.length ? (
                <div className="agent-availability-empty"><Empty description={t('No active assignable agents are registered.')} /></div>
            ) : (
                <div className="agent-availability-content">
                    <div className="agent-availability-content-head">
                        <div>
                            <Typography.Title level={5}>{selectedCompany?.name ?? t('Company agents')}</Typography.Title>
                            <Typography.Text type="secondary">{t('Enable agents approved for this company. Changes only apply after saving.')}</Typography.Text>
                        </div>
                        <Tag>{visibleAgents.length} {t('agents')}</Tag>
                    </div>
                    {settingsError && <Alert type="error" showIcon message={t('Could not load company settings. Editing is disabled to prevent overwriting existing access.')} />}
                    <Spin spinning={loadingSettings}>
                        <div className="agent-availability-agent-list">
                            {visibleAgents.length ? visibleAgents.map(agent => (
                                <div className="agent-availability-item" key={agent.id}>
                                    <div className="agent-availability-item-icon"><RobotOutlined /></div>
                                    <div className="agent-availability-item-copy">
                                        <div className="agent-availability-item-title"><strong>{agent.name}</strong><Tag color={agent.executionMode === 'external_api' ? 'blue' : 'default'}>{agent.executionMode === 'external_api' ? t('External API') : t('Platform')}</Tag></div>
                                        <Typography.Text type="secondary">{agent.description}</Typography.Text>
                                    </div>
                                    <Switch
                                        checked={enabled.includes(agent.id)}
                                        disabled={loadingSettings || settingsError || saving}
                                        checkedChildren={t('On')}
                                        unCheckedChildren={t('Off')}
                                        aria-label={`${t('Enable')} ${agent.name}`}
                                        onChange={checked => setEnabled(current => checked
                                            ? [...new Set([...current, agent.id])]
                                            : current.filter(id => id !== agent.id))}
                                    />
                                </div>
                            )) : <Empty description={t('No agents match your filters.')} />}
                        </div>
                    </Spin>
                    <div className="agent-availability-savebar">
                        <div>
                            <strong>{changed ? t('Unsaved changes') : t('All changes saved')}</strong>
                            <Typography.Text type="secondary">{enabledCount} {t('of')} {eligibleAgents.length} {t('agents enabled')}</Typography.Text>
                        </div>
                        <Button type="primary" icon={<SaveOutlined />} disabled={!changed || loadingSettings || settingsError} loading={saving} onClick={() => void save()}>{t('Save availability')}</Button>
                    </div>
                </div>
            )}
        </section>
    )
}

const AgentRegistryPage = () => {
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user } = useFullIdentity()
    const [form] = Form.useForm<AgentFormValues>()

    const [agents, setAgents] = useState<AgentDefinition[]>([])
    // The tab lives in the URL (?tab=availability|ratings), so the old availability and ratings links land on it.
    const [searchParams, setSearchParams] = useSearchParams()
    const view: ManagementView = VIEWS.includes(searchParams.get('tab') as ManagementView) ? searchParams.get('tab') as ManagementView : 'registry'
    const changeView = (next: ManagementView) => setSearchParams(next === 'registry' ? {} : { tab: next }, { replace: true })
    const [ratings, setRatings] = useState<AgentRatingRecord[]>([])
    const [ratingsLoading, setRatingsLoading] = useState(true)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState(false)
    const [editing, setEditing] = useState<AgentDefinition | null>(null)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState('all')
    const [executionFilter, setExecutionFilter] = useState('all')

    const metrics = useMemo(() => {
        const active = agents.filter((agent) => agent.status === 'active').length
        const external = agents.filter(
            (agent) => agent.executionMode === 'external_api',
        ).length
        const billable = agents.filter((agent) => agent.billable).length

        return {
            total: agents.length,
            active,
            external,
            billable,
        }
    }, [agents])

    const filteredAgents = useMemo(() => {
        const query = search.trim().toLocaleLowerCase()
        return agents.filter((agent) => {
            if (statusFilter !== 'all' && agent.status !== statusFilter) return false
            if (executionFilter === 'external_api' && agent.executionMode !== 'external_api') return false
            if (executionFilter === 'platform' && agent.executionMode === 'external_api') return false
            if (!query) return true
            return [agent.name, agent.description, agent.provider, ...agent.capabilities]
                .some((value) => value.toLocaleLowerCase().includes(query))
        })
    }, [agents, search, statusFilter, executionFilter])

    // Ratings are shown as averages: overall on the page, per agent on each card and in the Ratings tab.
    const ratingsByAgent = useMemo(() => {
        const totals = new Map<string, { sum: number, count: number }>()
        ratings.forEach((row) => {
            const current = totals.get(row.agentId) || { sum: 0, count: 0 }
            totals.set(row.agentId, { sum: current.sum + row.rating, count: current.count + 1 })
        })
        return new Map([...totals].map(([id, total]) => [id, { average: total.sum / total.count, count: total.count }]))
    }, [ratings])
    const overallRating = ratings.length ? ratings.reduce((sum, row) => sum + row.rating, 0) / ratings.length : 0

    useRegisterAgentPageContext({
        pageKey: 'system-agent-registry',
        pageName: 'Agent registry',
        purpose:
            'Registers and maintains the AI agent implementations available to the platform.',
        metrics,
        currentFilters: { search, status: statusFilter, execution: executionFilter },
        dataSummary: {
            visibleCount: filteredAgents.length,
            view,
            ratings: { count: ratings.length, average: Number(overallRating.toFixed(2)) },
        },
        allowedActions: [
            {
                key: 'create_agent',
                label: t('Add agent'),
                description: t('Register a supported agent implementation.'),
            },
            {
                key: 'update_agent',
                label: t('Update agent'),
                description: t('Update agent metadata and availability status.'),
            },
            {
                key: 'archive_agent',
                label: t('Archive agent'),
                description: t(
                    'Prevent future assignment while retaining historical references.',
                ),
                requiresConfirmation: true,
            },
        ],
    })

    useEffect(() => {
        const unsubscribe = subscribeAgents(
            (rows) => {
                setAgents(rows)
                setLoading(false)
            },
            () => {
                message.error(t('The agent registry could not be loaded.'))
                setLoading(false)
            },
        )

        return unsubscribe
    }, [message, t])

    useEffect(() => {
        if (!user) return
        let cancelled = false
        void listAgentRatings(user)
            .then((rows) => { if (!cancelled) setRatings(rows) })
            .catch(() => { if (!cancelled) message.error(t('Agent ratings could not be loaded.')) })
            .finally(() => { if (!cancelled) setRatingsLoading(false) })
        return () => { cancelled = true }
    }, [message, t, user])

    const openCreate = () => {
        setEditing(null)
        form.resetFields()
        form.setFieldsValue({
            status: 'active',
            supportsAssignment: true,
        })
        setOpen(true)
    }

    const openEdit = (agent: AgentDefinition) => {
        setEditing(agent)
        form.setFieldsValue({
            id: agent.id,
            name: agent.name,
            description: agent.description,
            implementationKey: agent.implementationKey,
            capabilities: agent.capabilities,
            status: agent.status === 'archived' ? 'inactive' : agent.status,
            supportsAssignment: agent.supportsAssignment,
        })
        setOpen(true)
    }

    const applyImplementationDefaults = (
        implementationKey: AgentImplementationKey,
    ) => {
        const implementation = getAgentImplementation(implementationKey)
        if (!implementation) return

        const currentCapabilities = form.getFieldValue('capabilities')

        if (!Array.isArray(currentCapabilities) || !currentCapabilities.length) {
            form.setFieldValue(
                'capabilities',
                implementation.defaultCapabilities,
            )
        }
    }

    const save = async (values: AgentFormValues) => {
        if (!user) {
            message.error(t('You must be signed in to manage agents.'))
            return
        }

        const implementation = getAgentImplementation(values.implementationKey)

        if (!implementation) {
            message.error(t('The selected implementation is not supported.'))
            return
        }

        const payload: AgentRegistryInput = {
            name: values.name,
            description: values.description,
            implementationKey: implementation.key,
            workspacePath: implementation.workspacePath,
            capabilities: values.capabilities,
            provider: implementation.provider,
            executionMode: implementation.executionMode,
            status: values.status,
            supportsAssignment: values.supportsAssignment,
            supportsVoice: implementation.supportsVoice,
            supportsDocuments: implementation.supportsDocuments,
            billable: implementation.billable,
        }

        setSaving(true)

        try {
            if (editing) {
                await updateAgent(editing.id, payload, user)
                message.success(`${values.name} was updated.`)
            } else {
                await createAgent(values.id, payload, user)
                message.success(`${values.name} was registered.`)
            }

            setOpen(false)
            setEditing(null)
            form.resetFields()
        } catch (error) {
            message.error(
                error instanceof Error
                    ? error.message
                    : t('The agent could not be saved.'),
            )
        } finally {
            setSaving(false)
        }
    }

    const confirmArchive = (agent: AgentDefinition) => {
        if (!user) return

        modal.confirm({
            title: `Archive ${agent.name}?`,
            content:
                'The agent will no longer be assignable or available to companies. Historical assignments will retain their agent reference.',
            okText: t('Archive agent'),
            okButtonProps: { danger: true },
            cancelText: t('Cancel'),
            onOk: async () => {
                try {
                    await archiveAgent(agent.id, user)
                    message.success(`${agent.name} was archived.`)
                } catch {
                    message.error(t('The agent could not be archived.'))
                }
            },
        })
    }

    if (loading) {
        return (
            <PageSkeleton
                variant="table"
                label={t('Loading agent registry')}
            />
        )
    }

    const ratingFor = (agentId: string) => ratingsByAgent.get(agentId)
    const clearFilters = () => {
        setSearch('')
        setStatusFilter('all')
        setExecutionFilter('all')
    }

    return (
        <DashboardPage className="agent-registry-page admin-overview">
            <Row gutter={[16, 16]}>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact icon={<RobotOutlined />} label={t('Active agents')} value={metrics.active} visual={<AdminShareRing size={44} value={metrics.active} total={metrics.total} />} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact icon={<ApiOutlined />} label={t('External API')} value={metrics.external} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact icon={<DollarOutlined />} label={t('Billable')} value={metrics.billable} /></Col>
                <Col xs={24} sm={12} xl={6}><AdminKpiTile compact loading={ratingsLoading} icon={<StarOutlined />} label={t('Average rating')} value={ratings.length ? `${overallRating.toFixed(1)} / 5` : '—'} /></Col>
            </Row>

            <div className="agent-management-tabs">
                <Segmented value={view} onChange={(next) => changeView(next as ManagementView)} options={[
                    { value: 'registry', label: t('Agents') },
                    { value: 'availability', label: t('Company access') },
                    { value: 'ratings', label: t('Ratings') },
                ]} />
            </div>

            {view === 'registry' && (
                <>
                    <FilterBar
                        primary={
                            <>
                                <Input.Search
                                    allowClear
                                    value={search}
                                    onChange={(event) => setSearch(event.target.value)}
                                    placeholder={t('Search agents, providers or capabilities')}
                                    className="agent-registry-search"
                                />
                                <Select
                                    value={statusFilter}
                                    onChange={setStatusFilter}
                                    className="agent-registry-filter-select"
                                    aria-label={t('Filter by status')}
                                    options={[
                                        { value: 'all', label: t('All statuses') },
                                        { value: 'active', label: t('Active') },
                                        { value: 'inactive', label: t('Inactive') },
                                        { value: 'archived', label: t('Archived') },
                                    ]}
                                />
                                <Select
                                    value={executionFilter}
                                    onChange={setExecutionFilter}
                                    className="agent-registry-filter-select"
                                    aria-label={t('Filter by execution type')}
                                    options={[
                                        { value: 'all', label: t('All types') },
                                        { value: 'external_api', label: t('External API') },
                                        { value: 'platform', label: t('Platform') },
                                    ]}
                                />
                            </>
                        }
                        actions={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('Add agent')}</Button>}
                    />

                    {!agents.length ? (
                        <Card className="admin-card" bordered={false}>
                            <Empty description={t('No agents have been registered.')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                                <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('Register first agent')}</Button>
                            </Empty>
                        </Card>
                    ) : !filteredAgents.length ? (
                        <Card className="admin-card" bordered={false}>
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No agents match your filters.')}>
                                <Button onClick={clearFilters}>{t('Clear filters')}</Button>
                            </Empty>
                        </Card>
                    ) : (
                        <Row gutter={[16, 16]}>
                            {filteredAgents.map((agent) => {
                                const rating = ratingFor(agent.id)
                                const assignable = agent.status === 'active' && agent.supportsAssignment
                                const implementation = getAgentImplementation(agent.implementationKey)
                                return (
                                    <Col key={agent.id} xs={24} md={12} xl={8}>
                                        <Card className={`admin-card agent-card is-${agent.status}`} bordered={false}>
                                            <div className="agent-card-top">
                                                <span className="admin-kpi-icon"><RobotOutlined /></span>
                                                <div className="agent-card-title">
                                                    <strong>{agent.name}</strong>
                                                    <span>{implementation?.label ?? agent.provider} · {agent.executionMode === 'external_api' ? t('External API') : t('Platform')}</span>
                                                </div>
                                                <span className={`agent-card-status is-${agent.status}`}><i />{formatStatus(agent.status)}</span>
                                            </div>
                                            <Typography.Paragraph className="agent-card-description" ellipsis={{ rows: 2, tooltip: agent.description }}>{agent.description}</Typography.Paragraph>
                                            {agent.capabilities.length > 0 && (
                                                <div className="agent-card-capabilities">
                                                    {agent.capabilities.slice(0, 3).map((capability) => <span key={capability}>{capability}</span>)}
                                                    {agent.capabilities.length > 3 && <span className="is-more">+{agent.capabilities.length - 3}</span>}
                                                </div>
                                            )}
                                            <div className="agent-card-traits">
                                                <span className={assignable ? 'is-on' : ''}><SafetyCertificateOutlined /> {assignable ? t('Assignable') : t('Not assignable')}</span>
                                                {agent.supportsDocuments && <span className="is-on"><FileWordOutlined /> {t('Documents')}</span>}
                                                {agent.supportsVoice && <span className="is-on"><SoundOutlined /> {t('Voice')}</span>}
                                                {agent.billable && <span className="is-on"><DollarOutlined /> {t('Billable')}</span>}
                                            </div>
                                            <div className="agent-card-foot">
                                                <span className="agent-card-rating">
                                                    {rating
                                                        ? <><StarFilled /> <b>{rating.average.toFixed(1)}</b> <small>{t('{count} ratings', undefined, { count: rating.count })}</small></>
                                                        : <small>{t('No ratings yet')}</small>}
                                                </span>
                                                <Space size={6}>
                                                    <Button size="small" shape="round" icon={<EditOutlined />} onClick={() => openEdit(agent)}>{t('Edit')}</Button>
                                                    <Button size="small" shape="round" danger icon={<InboxOutlined />} disabled={agent.status === 'archived'} onClick={() => confirmArchive(agent)} aria-label={t('Archive agent')} />
                                                </Space>
                                            </div>
                                        </Card>
                                    </Col>
                                )
                            })}
                        </Row>
                    )}
                </>
            )}

            {view === 'availability' && <CompanyAvailabilityPanel agents={agents} />}

            {view === 'ratings' && <AgentRatingsSummary ratings={ratings} loading={ratingsLoading} />}

            <Modal
                open={open}
                title={editing ? t('Update agent') : t('Register agent')}
                onCancel={() => {
                    if (saving) return
                    setOpen(false)
                    setEditing(null)
                    form.resetFields()
                }}
                footer={null}
                destroyOnClose
                width={720}
            >
                <Form<AgentFormValues>
                    form={form}
                    layout="vertical"
                    requiredMark={false}
                    onFinish={save}
                >
                    <div className="agent-registry-form-grid">
                        <Form.Item
                            name="id"
                            label={t('Agent key')}
                            tooltip={t(
                                'Stable key used by assignments and company settings. It cannot be changed after creation.',
                            )}
                            rules={[
                                {
                                    required: true,
                                    message: tr('Enter an agent key.'),
                                },
                                {
                                    pattern: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
                                    message: tr(
                                        'Use lowercase letters, numbers, and hyphens only.',
                                    ),
                                },
                            ]}
                        >
                            <Input
                                disabled={Boolean(editing)}
                                placeholder="pitch-coach"
                            />
                        </Form.Item>

                        <Form.Item
                            name="implementationKey"
                            label={t('Implementation')}
                            rules={[
                                {
                                    required: true,
                                    message: tr('Select an implementation.'),
                                },
                            ]}
                        >
                            <Select
                                disabled={Boolean(editing)}
                                placeholder={t('Select supported implementation')}
                                options={AGENT_IMPLEMENTATIONS.map(
                                    (implementation) => ({
                                        value: implementation.key,
                                        label: implementation.label,
                                    }),
                                )}
                                onChange={applyImplementationDefaults}
                            />
                        </Form.Item>

                        <Form.Item
                            className="agent-registry-form-span"
                            name="name"
                            label={t('Agent name')}
                            rules={[
                                {
                                    required: true,
                                    message: tr('Enter the agent name.'),
                                },
                            ]}
                        >
                            <Input placeholder={t('Pitch Preparation Agent')} />
                        </Form.Item>

                        <Form.Item
                            className="agent-registry-form-span"
                            name="description"
                            label={t('Description')}
                            rules={[
                                {
                                    required: true,
                                    message: tr('Enter a description.'),
                                },
                            ]}
                        >
                            <TextArea
                                rows={4}
                                maxLength={700}
                                showCount
                                placeholder={t(
                                    'Explain what the agent does for participants and operations.',
                                )}
                            />
                        </Form.Item>

                        <Form.Item
                            className="agent-registry-form-span"
                            name="capabilities"
                            label={t('Capabilities')}
                            rules={[
                                {
                                    required: true,
                                    type: 'array',
                                    min: 1,
                                    message: tr('Add at least one capability.'),
                                },
                            ]}
                        >
                            <Select
                                mode="tags"
                                tokenSeparators={[',']}
                                placeholder={t(
                                    'Type a capability and press Enter',
                                )}
                            />
                        </Form.Item>

                        <Form.Item
                            name="status"
                            label={t('Registry status')}
                            rules={[{ required: true }]}
                        >
                            <Select options={STATUS_OPTIONS} />
                        </Form.Item>

                        <Form.Item
                            name="supportsAssignment"
                            label={t('Allow intervention assignment')}
                            valuePropName="checked"
                        >
                            <Switch
                                checkedChildren={tr('Allowed')}
                                unCheckedChildren={tr('Blocked')}
                            />
                        </Form.Item>
                    </div>

                    <ModalActions>
                        <Button
                            type="primary"
                            htmlType="submit"
                            loading={saving}
                        >
                            {editing ? t('Save changes') : t('Register agent')}
                        </Button>
                    </ModalActions>
                </Form>
            </Modal>
        </DashboardPage>
    )
}

export default AgentRegistryPage
