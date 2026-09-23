import { App, Button, Card, Col, Divider, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Tag, theme, Typography, type TableProps } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, SettingOutlined, StopOutlined, SyncOutlined, ToolOutlined } from '@ant-design/icons'
import { addDoc, collection, deleteDoc, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { ResponsiveDataView } from '@/components/shared/ResponsiveDataView'
import { db } from '@/firebase'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { DELIVERY_STRATEGY_OPTIONS, getCompanyAvailableAgents, isAgentStrategy } from '@/services/agentOrchestrationService'
import { listAgents } from '@/services/agentRegistryService'
import type { AgentDefinition, InterventionDeliveryStrategy } from '@/types/agentOrchestration'

type RecurrenceUnit = 'day' | 'week' | 'month' | 'year'
type RecurrencePreset = 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom'
type ExecutionMode = 'single_session' | 'multi_step'
type EndRule = 'none' | 'after_n_cycles' | 'by_date'
type InterventionDurationTerm = 'short_term' | 'medium_term' | 'long_term'
type InterventionScopeModel = 'company' | 'program_specific' | 'department_specific'

type InterventionRow = {
    id: string
    areaOfSupport?: string
    interventionTitle?: string
    isCompulsory?: 'yes' | 'no'
    isRecurring?: 'yes' | 'no'
    durationTerm?: InterventionDurationTerm
    executionMode?: ExecutionMode
    recurrence?: { preset?: RecurrencePreset; every?: number; unit?: RecurrenceUnit }
    endRule?: EndRule
    maxCycles?: number
    endDate?: string
    steps?: Array<{ id?: string; title?: string; description?: string; weight?: number }>
    scopeType?: string
    programId?: string | null
    departmentId?: string | null
    deliveryStrategy?: InterventionDeliveryStrategy
    agentId?: string | null
    reviewRequired?: boolean
    reviewerType?: 'operations' | 'consultant' | null
    createdAt?: string
    [key: string]: unknown
}

type InterventionFilters = {
    area: string
    title: string
    compulsory: '' | 'yes' | 'no'
    recurring: '' | 'yes' | 'no'
    durationTerm: '' | InterventionDurationTerm
    executionMode: '' | ExecutionMode
}

const RECURRENCE_PRESETS: Array<{ label: string; value: RecurrencePreset; every?: number; unit?: RecurrenceUnit }> = [
    { label: 'Weekly', value: 'weekly', every: 1, unit: 'week' },
    { label: 'Monthly', value: 'monthly', every: 1, unit: 'month' },
    { label: 'Quarterly', value: 'quarterly', every: 3, unit: 'month' },
    { label: 'Yearly', value: 'yearly', every: 1, unit: 'year' },
    { label: 'Custom', value: 'custom' },
]

const RECURRENCE_UNITS: Array<{ label: string; value: RecurrenceUnit }> = [
    { label: 'Day(s)', value: 'day' },
    { label: 'Week(s)', value: 'week' },
    { label: 'Month(s)', value: 'month' },
    { label: 'Year(s)', value: 'year' },
]

const DURATION_TERMS: Array<{ label: string; value: InterventionDurationTerm; color: string }> = [
    { label: 'Short-term', value: 'short_term', color: 'green' },
    { label: 'Medium-term', value: 'medium_term', color: 'gold' },
    { label: 'Long-term', value: 'long_term', color: 'blue' },
]

const emptyFilters: InterventionFilters = {
    area: '',
    title: '',
    compulsory: '',
    recurring: '',
    durationTerm: '',
    executionMode: '',
}

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase()

const durationTermOption = (value?: string) => DURATION_TERMS.find((item) => item.value === value) || DURATION_TERMS[0]

const recurrenceLabel = (recurrence?: InterventionRow['recurrence']) => {
    if (!recurrence) return 'Recurring'
    const every = Math.max(1, Number(recurrence.every || 1))
    const unit = String(recurrence.unit || 'week')
    return `Every ${every} ${every === 1 ? unit : `${unit}s`}`
}

const endRuleLabel = (row: InterventionRow) => {
    if (!row.endRule || row.endRule === 'none') return 'Ongoing'
    if (row.endRule === 'after_n_cycles') return `Ends after ${Number(row.maxCycles || 0)} cycle(s)`
    if (row.endRule === 'by_date') return row.endDate ? `Ends by ${dayjs(row.endDate).format('YYYY-MM-DD')}` : 'Ends by date'
    return 'Ongoing'
}

/** A selectable card used for binary (yes/no) choices. */
const OptionCard = ({ icon, label, selected, onClick }: { icon: ReactNode, label: string, selected?: boolean, onClick: () => void }) => {
    const { token } = theme.useToken()
    return (
        <button
            type="button"
            onClick={onClick}
            style={{
                width: '100%',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 10,
                border: `1px solid ${selected ? token.colorPrimary : token.colorBorder}`,
                background: selected ? token.colorPrimaryBg : token.colorBgContainer,
                cursor: 'pointer',
            }}
        >
            <span style={{ fontSize: 16, color: selected ? token.colorPrimary : token.colorTextSecondary }}>{icon}</span>
            <strong>{label}</strong>
        </button>
    )
}

const YesNoField = ({ value, onChange, yesIcon, noIcon }: {
    value?: 'yes' | 'no'
    onChange?: (value: 'yes' | 'no') => void
    yesIcon: ReactNode
    noIcon: ReactNode
}) => (
    <Row gutter={8}>
        <Col span={12}><OptionCard icon={yesIcon} label="Yes" selected={value === 'yes'} onClick={() => onChange?.('yes')} /></Col>
        <Col span={12}><OptionCard icon={noIcon} label="No" selected={value === 'no'} onClick={() => onChange?.('no')} /></Col>
    </Row>
)

const defaultInterventionValues = {
    isCompulsory: 'no',
    isRecurring: 'no',
    durationTerm: 'short_term',
    executionMode: 'single_session',
    recurrence: { preset: 'weekly', every: 1, unit: 'week' },
    endRule: 'none',
    maxCycles: 4,
    steps: [],
    deliveryStrategy: 'human_only',
    agentId: null,
}

export const InterventionsSetupPage = () => {
    const { message } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { settings, getSetting } = useSystemSettings()
    const interventionScopeModel = getSetting<InterventionScopeModel>('interventionScopeModel', 'company')
    const hasDepartments = !!settings?.hasDepartments
    const [form] = Form.useForm()
    const [interventions, setInterventions] = useState<InterventionRow[]>([])
    const [loading, setLoading] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [editingRecord, setEditingRecord] = useState<InterventionRow>()
    const [filters, setFilters] = useState<InterventionFilters>(emptyFilters)
    const [newAreaText, setNewAreaText] = useState('')
    const [enabledAgents, setEnabledAgents] = useState<AgentDefinition[]>([])
    const [allAgents, setAllAgents] = useState<AgentDefinition[]>([])

    const companyCode = String(user?.companyCode || '')

    useEffect(() => {
        console.log('[InterventionsSetup][LOGGED_IN_USER]', {
            identityLoading,
            hasUser: Boolean(user),
            uid: user?.uid,
            email: user?.email,
            displayName: user?.displayName,
            role: user?.role,
            companyCode: user?.companyCode,
            derivedCompanyCode: companyCode,
            rawUser: user,
        })
    }, [identityLoading, user, companyCode])

    const fetchInterventions = async () => {
        if (!companyCode) return
        try {
            setLoading(true)
            const snapshot = await getDocs(query(collection(db, 'interventions'), where('companyCode', '==', companyCode)))
            setInterventions(snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Record<string, unknown>) })))
        } catch {
            message.error('Interventions could not be loaded.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!identityLoading && companyCode) void fetchInterventions()
    }, [companyCode, identityLoading]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!companyCode) return
        let active = true
        void getCompanyAvailableAgents(companyCode).then((agents) => {
            if (active) setEnabledAgents(agents)
        }).catch(() => {
            if (active) setEnabledAgents([])
        })
        return () => { active = false }
    }, [companyCode])

    useEffect(() => {
        void listAgents().then(setAllAgents)
    }, [])

    const areaOptions = useMemo(() => {
        return Array.from(new Set(interventions.map((item) => String(item.areaOfSupport || '').trim()).filter(Boolean))).sort()
    }, [interventions])

    const rows = useMemo(() => {
        return interventions.filter((item) => {
            const matchesArea = filters.area ? normalize(item.areaOfSupport) === normalize(filters.area) : true
            const matchesTitle = filters.title ? normalize(item.interventionTitle).includes(normalize(filters.title)) : true
            const matchesCompulsory = filters.compulsory ? item.isCompulsory === filters.compulsory : true
            const matchesRecurring = filters.recurring ? item.isRecurring === filters.recurring : true
            const matchesTerm = filters.durationTerm ? String(item.durationTerm || 'short_term') === filters.durationTerm : true
            const matchesExecution = filters.executionMode ? String(item.executionMode || 'single_session') === filters.executionMode : true
            return matchesArea && matchesTitle && matchesCompulsory && matchesRecurring && matchesTerm && matchesExecution
        })
    }, [filters, interventions])

    const metrics = useMemo(() => ({
        total: rows.length,
        compulsory: rows.filter((item) => item.isCompulsory === 'yes').length,
        recurring: rows.filter((item) => item.isRecurring === 'yes').length,
        longTerm: rows.filter((item) => item.durationTerm === 'long_term').length,
    }), [rows])

    useRegisterAgentPageContext({
        pageKey: 'operations-interventions-setup',
        pageName: 'Interventions setup',
        purpose: 'Create and maintain the intervention catalogue used in diagnostic plans and assignments.',
        filters,
        metrics,
        tables: { visibleInterventions: rows.length, totalInterventions: interventions.length },
        selectedRecord: editingRecord?.interventionTitle,
    })

    const openAdd = () => {
        setEditingRecord(undefined)
        setNewAreaText('')
        form.resetFields()
        form.setFieldsValue(defaultInterventionValues)
        setModalOpen(true)
    }

    const openEdit = (record: InterventionRow) => {
        const safe = {
            ...record,
            durationTerm: record.durationTerm || 'short_term',
            executionMode: record.executionMode || 'single_session',
            deliveryStrategy: record.deliveryStrategy || 'human_only',
            agentId: record.agentId || null,
            endRule: record.endRule || 'none',
            steps: Array.isArray(record.steps) ? record.steps : [],
            recurrence: record.isRecurring === 'yes' ? record.recurrence || defaultInterventionValues.recurrence : defaultInterventionValues.recurrence,
        }
        setEditingRecord(record)
        setNewAreaText('')
        form.setFieldsValue(safe)
        setModalOpen(true)
    }

    const resolveScopeFields = (values: Record<string, unknown>) => {
        if (interventionScopeModel === 'program_specific') {
            return { scopeType: 'program', programId: values.programId || null, departmentId: null }
        }
        if (interventionScopeModel === 'department_specific') {
            return { scopeType: 'department', departmentId: values.departmentId || null, programId: null }
        }
        return { scopeType: 'company', programId: null, departmentId: null }
    }

    const normalizeInterventionValues = (values: Record<string, any>) => {
        const cleaned = { ...values }
        cleaned.areaOfSupport = String(cleaned.areaOfSupport || '').trim()
        cleaned.interventionTitle = String(cleaned.interventionTitle || '').trim()
        cleaned.durationTerm = (cleaned.durationTerm || 'short_term') as InterventionDurationTerm
        cleaned.executionMode = (cleaned.executionMode || 'single_session') as ExecutionMode
        cleaned.deliveryStrategy = (cleaned.deliveryStrategy || 'human_only') as InterventionDeliveryStrategy

        if (isAgentStrategy(cleaned.deliveryStrategy)) {
            if (!cleaned.agentId || !enabledAgents.some((agent) => agent.id === cleaned.agentId)) {
                throw new Error('Choose an agent enabled for this company.')
            }
            cleaned.reviewRequired = cleaned.deliveryStrategy !== 'agent_only'
            cleaned.reviewerType = cleaned.deliveryStrategy === 'agent_with_ops_review'
                ? 'operations'
                : cleaned.deliveryStrategy === 'agent_with_consultant_review'
                    ? 'consultant'
                    : null
        } else {
            cleaned.agentId = null
            cleaned.reviewRequired = false
            cleaned.reviewerType = null
        }

        if (interventionScopeModel === 'program_specific' && !cleaned.programId) {
            throw new Error('Program is required for program-specific interventions.')
        }
        if (interventionScopeModel === 'department_specific' && !cleaned.departmentId) {
            throw new Error('Department is required for department-specific interventions.')
        }

        if (cleaned.isRecurring !== 'yes') {
            delete cleaned.recurrence
            delete cleaned.endRule
            delete cleaned.maxCycles
            delete cleaned.endDate
        } else {
            const preset: RecurrencePreset = cleaned?.recurrence?.preset || 'weekly'
            if (preset !== 'custom') {
                const presetConfig = RECURRENCE_PRESETS.find((item) => item.value === preset)
                cleaned.recurrence = { preset, every: presetConfig?.every ?? 1, unit: presetConfig?.unit ?? 'week' }
            } else {
                cleaned.recurrence = {
                    preset,
                    every: Math.max(1, Number(cleaned?.recurrence?.every || 1)),
                    unit: (cleaned?.recurrence?.unit || 'week') as RecurrenceUnit,
                }
            }

            const endRule: EndRule = cleaned.endRule || 'none'
            cleaned.endRule = endRule
            if (endRule === 'after_n_cycles') {
                cleaned.maxCycles = Math.max(1, Number(cleaned.maxCycles || 1))
                delete cleaned.endDate
            } else if (endRule === 'by_date') {
                cleaned.endDate = cleaned.endDate ? dayjs(cleaned.endDate).toISOString() : null
                delete cleaned.maxCycles
            } else {
                delete cleaned.maxCycles
                delete cleaned.endDate
            }
        }

        const steps = Array.isArray(cleaned.steps) ? cleaned.steps : []
        const normalizedSteps = steps
            .filter((step: Record<string, unknown>) => String(step?.title || '').trim())
            .map((step: Record<string, unknown>) => ({
                id: step.id || `step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                title: String(step.title || '').trim(),
                description: step.description ? String(step.description).trim() : '',
                weight: Math.max(1, Number(step.weight || 1)),
            }))

        if (cleaned.executionMode === 'multi_step') {
            if (!normalizedSteps.length) throw new Error('Multi-step interventions must have at least one step.')
            cleaned.steps = normalizedSteps
        } else if (normalizedSteps.length) {
            cleaned.steps = normalizedSteps
        } else {
            delete cleaned.steps
        }

        return cleaned
    }

    const syncRequiredInterventionSnapshots = async (interventionId: string, values: Record<string, any>) => {
        const applicationsSnapshot = await getDocs(collection(db, 'applications'))
        for (const applicationDoc of applicationsSnapshot.docs) {
            const application = applicationDoc.data()
            const required = application.interventions?.required || []
            if (!Array.isArray(required)) continue

            const updatedRequired = required.map((item: unknown) => {
                if (typeof item === 'string' && item === interventionId) {
                    return {
                        id: interventionId,
                        title: values.interventionTitle,
                        area: values.areaOfSupport,
                        areaOfSupport: values.areaOfSupport,
                        isRecurring: values.isRecurring,
                        durationTerm: values.durationTerm,
                        executionMode: values.executionMode,
                        deliveryStrategy: values.deliveryStrategy,
                        agentId: values.agentId || null,
                        reviewRequired: values.reviewRequired || false,
                        reviewerType: values.reviewerType || null,
                    }
                }
                if (typeof item === 'object' && item && 'id' in item && item.id === interventionId) {
                    return {
                        ...item,
                        title: values.interventionTitle,
                        area: values.areaOfSupport,
                        areaOfSupport: values.areaOfSupport,
                        isRecurring: values.isRecurring,
                        durationTerm: values.durationTerm,
                        executionMode: values.executionMode,
                        deliveryStrategy: values.deliveryStrategy,
                        agentId: values.agentId || null,
                        reviewRequired: values.reviewRequired || false,
                        reviewerType: values.reviewerType || null,
                    }
                }
                return item
            })

            if (JSON.stringify(required) !== JSON.stringify(updatedRequired)) {
                await updateDoc(doc(db, 'applications', applicationDoc.id), { 'interventions.required': updatedRequired })
            }
        }
    }

    const handleFinish = async (values: Record<string, any>) => {
        try {
            setLoading(true)
            const cleaned = normalizeInterventionValues(values)
            const payload = {
                ...cleaned,
                ...resolveScopeFields(cleaned),
                companyCode,
                createdAt: editingRecord?.createdAt || new Date().toISOString(),
            }

            if (editingRecord) {
                await updateDoc(doc(db, 'interventions', editingRecord.id), payload)
                await syncRequiredInterventionSnapshots(editingRecord.id, payload)
                message.success('Intervention updated.')
            } else {
                await addDoc(collection(db, 'interventions'), payload)
                message.success('Intervention created.')
            }

            setModalOpen(false)
            await fetchInterventions()
        } catch (error: any) {
            message.error(error?.message || 'Intervention could not be saved.')
        } finally {
            setLoading(false)
        }
    }

    const deleteIntervention = async (interventionId: string) => {
        try {
            setLoading(true)
            await deleteDoc(doc(db, 'interventions', interventionId))

            const applicationsSnapshot = await getDocs(collection(db, 'applications'))
            for (const applicationDoc of applicationsSnapshot.docs) {
                const required = applicationDoc.data().interventions?.required || []
                if (!Array.isArray(required)) continue
                const filtered = required.filter((item: any) => item !== interventionId && item?.id !== interventionId)
                if (filtered.length !== required.length) {
                    await updateDoc(doc(db, 'applications', applicationDoc.id), { 'interventions.required': filtered })
                }
            }

            message.success('Intervention deleted.')
            await fetchInterventions()
        } catch {
            message.error('Intervention could not be deleted.')
        } finally {
            setLoading(false)
        }
    }

    const columns: TableProps<InterventionRow>['columns'] = [
        {
            title: 'Intervention',
            dataIndex: 'interventionTitle',
            render: (value: string, row) => (
                <Space direction="vertical" size={0}>
                    <Typography.Text strong>{value || 'Untitled intervention'}</Typography.Text>
                    <Typography.Text type="secondary">{row.areaOfSupport || 'No support area'}</Typography.Text>
                </Space>
            ),
        },
        {
            title: 'Term',
            dataIndex: 'durationTerm',
            render: (value?: string) => {
                const option = durationTermOption(value)
                return <Tag color={option.color}>{option.label}</Tag>
            },
        },
        {
            title: 'Execution',
            dataIndex: 'executionMode',
            render: (value?: ExecutionMode) => value === 'multi_step' ? <Tag color="purple">Multi-step</Tag> : <Tag>Single session</Tag>,
        },
        {
            title: 'Delivery',
            dataIndex: 'deliveryStrategy',
            render: (value: InterventionDeliveryStrategy | undefined, row) => {
                const strategy = DELIVERY_STRATEGY_OPTIONS.find((option) => option.value === (value || 'human_only'))
                const agent = allAgents.find((item) => item.id === row.agentId)
                return <Space direction="vertical" size={0}><Tag icon={isAgentStrategy(value) ? <RobotOutlined /> : undefined} color={isAgentStrategy(value) ? 'purple' : 'blue'}>{strategy?.label || 'Human delivery'}</Tag>{agent && <Typography.Text type="secondary">{agent.name}</Typography.Text>}</Space>
            },
        },
        {
            title: 'Recurrence',
            render: (_, row) => row.isRecurring === 'yes'
                ? <Space direction="vertical" size={0}><Tag color="blue" icon={<SyncOutlined />}>{recurrenceLabel(row.recurrence)}</Tag><Typography.Text type="secondary">{endRuleLabel(row)}</Typography.Text></Space>
                : <Tag>Not recurring</Tag>,
        },
        {
            title: 'Compulsory',
            dataIndex: 'isCompulsory',
            render: (value?: string) => value === 'yes' ? <Tag color="green">Yes</Tag> : <Tag>No</Tag>,
        },
        {
            title: 'Steps',
            render: (_, row) => <Tag>{Array.isArray(row.steps) ? row.steps.length : 0}</Tag>,
        },
        {
            title: 'Actions',
            render: (_, row) => (
                <Space>
                    <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>Edit</Button>
                    <Popconfirm title="Delete this intervention?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void deleteIntervention(row.id)}>
                        <Button icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                </Space>
            ),
        },
    ]

    return (
        <DashboardPage className="operations-interventions-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ToolOutlined />} label="Interventions" value={metrics.total} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} label="Compulsory" value={metrics.compulsory} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<SyncOutlined />} label="Recurring" value={metrics.recurring} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<SettingOutlined />} label="Long-term" value={metrics.longTerm} /></Col>
            </Row>

            <FilterBar
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={filters.title} onChange={(event) => setFilters((prev) => ({ ...prev, title: event.target.value }))} placeholder="Search interventions" allowClear />
                        <Select allowClear placeholder="Support area" value={filters.area || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, area: value || '' }))} options={areaOptions.map((value) => ({ value, label: value }))} />
                        <Select allowClear placeholder="Term" value={filters.durationTerm || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, durationTerm: value || '' }))} options={DURATION_TERMS.map(({ value, label }) => ({ value, label }))} />
                        <Select allowClear placeholder="Execution" value={filters.executionMode || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, executionMode: value || '' }))} options={[{ value: 'single_session', label: 'Single session' }, { value: 'multi_step', label: 'Multi-step' }]} />
                    </>
                )}
                actions={(
                    <>
                        <Button icon={<ReloadOutlined />} onClick={() => setFilters(emptyFilters)}>Reset</Button>
                        <Button icon={<ReloadOutlined />} onClick={() => void fetchInterventions()}>Refresh</Button>
                        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>Add intervention</Button>
                    </>
                )}
            />

            <Card>
                <ResponsiveDataView
                    rowKey="id"
                    rows={rows}
                    columns={columns}
                    loading={loading}
                    emptyText="No interventions match the selected filters."
                    renderCard={(row) => {
                        const option = durationTermOption(row.durationTerm)
                        return (
                            <Space direction="vertical" size={8}>
                                <Typography.Text strong>{row.interventionTitle || 'Untitled intervention'}</Typography.Text>
                                <Typography.Text type="secondary">{row.areaOfSupport || 'No support area'}</Typography.Text>
                                <Space wrap>
                                    <Tag color={option.color}>{option.label}</Tag>
                                    <Tag>{row.executionMode === 'multi_step' ? 'Multi-step' : 'Single session'}</Tag>
                                    <Tag>{row.isRecurring === 'yes' ? 'Recurring' : 'Not recurring'}</Tag>
                                    <Tag icon={isAgentStrategy(row.deliveryStrategy) ? <RobotOutlined /> : undefined} color={isAgentStrategy(row.deliveryStrategy) ? 'purple' : 'blue'}>{DELIVERY_STRATEGY_OPTIONS.find((item) => item.value === (row.deliveryStrategy || 'human_only'))?.label}</Tag>
                                </Space>
                                <Space>
                                    <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>Edit</Button>
                                    <Popconfirm title="Delete this intervention?" okText="Delete" okButtonProps={{ danger: true }} onConfirm={() => void deleteIntervention(row.id)}>
                                        <Button icon={<DeleteOutlined />} danger />
                                    </Popconfirm>
                                </Space>
                            </Space>
                        )
                    }}
                />
            </Card>

            <Modal open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnClose width={820} title={editingRecord ? 'Edit intervention' : 'Add intervention'}>
                <Form form={form} layout="vertical" onFinish={handleFinish}>
                    <Form.Item name="areaOfSupport" label="Area of support" rules={[{ required: true, message: 'Area of support is required.' }]}>
                        <Select
                            allowClear
                            showSearch
                            placeholder="Select or add an area"
                            options={areaOptions.map((value) => ({ value, label: value }))}
                            dropdownRender={(menu) => (
                                <>
                                    {menu}
                                    <Divider style={{ margin: '8px 0' }} />
                                    <Space.Compact style={{ width: '100%', padding: '0 8px 8px' }}>
                                        <Input value={newAreaText} onChange={(event) => setNewAreaText(event.target.value)} placeholder="New support area" />
                                        <Button
                                            type="primary"
                                            onClick={() => {
                                                const value = newAreaText.trim()
                                                if (!value) return
                                                form.setFieldsValue({ areaOfSupport: value })
                                                setNewAreaText('')
                                            }}
                                        >
                                            Add
                                        </Button>
                                    </Space.Compact>
                                </>
                            )}
                        />
                    </Form.Item>

                    <Form.Item name="interventionTitle" label="Intervention title" rules={[{ required: true, message: 'Intervention title is required.' }]}>
                        <Input placeholder="e.g. Website development" />
                    </Form.Item>

                    {interventionScopeModel === 'program_specific' && (
                        <Form.Item name="programId" label="Program" rules={[{ required: true, message: 'Program is required.' }]}>
                            <Input placeholder="Enter program ID" />
                        </Form.Item>
                    )}

                    {interventionScopeModel === 'department_specific' && hasDepartments && (
                        <Form.Item name="departmentId" label="Department" rules={[{ required: true, message: 'Department is required.' }]}>
                            <Input placeholder="Enter department ID" />
                        </Form.Item>
                    )}

                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <Form.Item name="durationTerm" label="Intervention term" rules={[{ required: true, message: 'Select an intervention term.' }]}>
                                <Select options={DURATION_TERMS.map(({ value, label }) => ({ value, label }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="executionMode" label="Execution mode" rules={[{ required: true, message: 'Select execution mode.' }]}>
                                <Select options={[{ value: 'single_session', label: 'Single session' }, { value: 'multi_step', label: 'Multi-step' }]} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="isCompulsory" label="Compulsory?" rules={[{ required: true }]}>
                                <YesNoField yesIcon={<CheckCircleOutlined />} noIcon={<CloseCircleOutlined />} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="isRecurring" label="Recurring?" rules={[{ required: true }]}>
                                <YesNoField yesIcon={<SyncOutlined />} noIcon={<StopOutlined />} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Card size="small" title={<Space><RobotOutlined /> Delivery orchestration</Space>} style={{ marginBottom: 16 }}>
                        <Form.Item name="deliveryStrategy" label="Who performs this intervention?" rules={[{ required: true }]}>
                            <Select options={DELIVERY_STRATEGY_OPTIONS.map((option) => ({ value: option.value, label: option.label, title: option.description }))} />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate={(previous, current) => previous.deliveryStrategy !== current.deliveryStrategy}>
                            {({ getFieldValue }) => {
                                const strategy = getFieldValue('deliveryStrategy') as InterventionDeliveryStrategy
                                if (!isAgentStrategy(strategy)) return null
                                return (
                                    <>
                                        <Form.Item name="agentId" label="Assigned agent" rules={[{ required: true, message: 'Choose an enabled company agent.' }]}>
                                            <Select
                                                placeholder={enabledAgents.length ? 'Choose an enabled agent' : 'No agents enabled for this company'}
                                                disabled={!enabledAgents.length}
                                                options={enabledAgents.map((agent) => ({ value: agent.id, label: agent.name }))}
                                            />
                                        </Form.Item>
                                        <Typography.Text type="secondary">
                                            {strategy === 'agent_only' && 'The agent owns delivery and operations monitors progress.'}
                                            {strategy === 'agent_with_ops_review' && 'The agent produces the work; operations reviews before completion.'}
                                            {strategy === 'agent_with_consultant_review' && 'The agent produces the work; the assigned consultant reviews it from start to finish.'}
                                        </Typography.Text>
                                    </>
                                )
                            }}
                        </Form.Item>
                    </Card>

                    <Form.Item noStyle shouldUpdate={(previous, current) => previous.isRecurring !== current.isRecurring}>
                        {({ getFieldValue, setFieldsValue }) => {
                            if (getFieldValue('isRecurring') !== 'yes') return null
                            return (
                                <Card size="small" title="Recurrence" style={{ marginBottom: 16 }}>
                                    <Row gutter={12}>
                                        <Col xs={24} md={12}>
                                            <Form.Item name={['recurrence', 'preset']} label="Recurrence pattern" rules={[{ required: true, message: 'Select a recurrence pattern.' }]}>
                                                <Select
                                                    options={RECURRENCE_PRESETS.map(({ value, label }) => ({ value, label }))}
                                                    onChange={(preset: RecurrencePreset) => {
                                                        if (preset === 'custom') {
                                                            setFieldsValue({ recurrence: { preset, every: 3, unit: 'week' } })
                                                            return
                                                        }
                                                        const presetConfig = RECURRENCE_PRESETS.find((item) => item.value === preset)
                                                        setFieldsValue({ recurrence: { preset, every: presetConfig?.every ?? 1, unit: presetConfig?.unit ?? 'week' } })
                                                    }}
                                                />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <Form.Item name="endRule" label="Series end rule">
                                                <Select options={[{ value: 'none', label: 'Ongoing' }, { value: 'after_n_cycles', label: 'End after N cycles' }, { value: 'by_date', label: 'End by date' }]} />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                    <Form.Item noStyle shouldUpdate={(previous, current) => previous?.recurrence?.preset !== current?.recurrence?.preset}>
                                        {({ getFieldValue }) => getFieldValue(['recurrence', 'preset']) === 'custom' ? (
                                            <Row gutter={12}>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name={['recurrence', 'every']} label="Repeat every" rules={[{ required: true, message: 'Enter repeat interval.' }]}>
                                                        <InputNumber min={1} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name={['recurrence', 'unit']} label="Unit" rules={[{ required: true, message: 'Select a unit.' }]}>
                                                        <Select options={RECURRENCE_UNITS} />
                                                    </Form.Item>
                                                </Col>
                                            </Row>
                                        ) : null}
                                    </Form.Item>
                                    <Form.Item noStyle shouldUpdate={(previous, current) => previous.endRule !== current.endRule}>
                                        {({ getFieldValue }) => {
                                            const endRule = getFieldValue('endRule') as EndRule
                                            if (endRule === 'after_n_cycles') {
                                                return <Form.Item name="maxCycles" label="Max cycles" rules={[{ required: true, message: 'Enter max cycles.' }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
                                            }
                                            if (endRule === 'by_date') {
                                                return <Form.Item name="endDate" label="End date" rules={[{ required: true, message: 'Enter end date.' }]}><Input placeholder="YYYY-MM-DD" /></Form.Item>
                                            }
                                            return null
                                        }}
                                    </Form.Item>
                                </Card>
                            )
                        }}
                    </Form.Item>

                    <Form.Item noStyle shouldUpdate={(previous, current) => previous.executionMode !== current.executionMode}>
                        {({ getFieldValue }) => {
                            if (getFieldValue('executionMode') !== 'multi_step') return null
                            return (
                            <Card size="small" title="Steps required" style={{ marginBottom: 16 }}>
                                <Form.List name="steps">
                                    {(fields, { add, remove }) => (
                                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                            {fields.map(({ key, name, ...restField }) => (
                                                <Card key={key} size="small" title={`Step ${name + 1}`} extra={<Button danger icon={<DeleteOutlined />} onClick={() => remove(name)} />}>
                                                    <Row gutter={12}>
                                                        <Col xs={24} md={16}>
                                                            <Form.Item {...restField} name={[name, 'title']} label="Step title" rules={[{ required: true, message: 'Step title is required.' }]}>
                                                                <Input placeholder="e.g. Draft business profile" />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col xs={24} md={8}>
                                                            <Form.Item {...restField} name={[name, 'weight']} label="Weight">
                                                                <InputNumber min={1} style={{ width: '100%' }} />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={24}>
                                                            <Form.Item {...restField} name={[name, 'description']} label="Description">
                                                                <Input.TextArea rows={2} />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>
                                                </Card>
                                            ))}
                                            <Button type="dashed" icon={<PlusOutlined />} block onClick={() => add({ id: `step-${Date.now()}-${Math.random().toString(16).slice(2)}`, weight: 1 })}>Add step</Button>
                                        </Space>
                                    )}
                                </Form.List>
                            </Card>
                            )
                        }}
                    </Form.Item>

                    <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
                        <Button onClick={() => setModalOpen(false)}>Cancel</Button>
                        <Button type="primary" htmlType="submit" loading={loading}>Save intervention</Button>
                    </Space>
                </Form>
            </Modal>
        </DashboardPage>
    )
}

export default InterventionsSetupPage
