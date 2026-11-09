import { Alert, App, Button, Card, Checkbox, Col, Collapse, Divider, Descriptions, Empty, Pagination, Segmented, Spin, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Switch, Tag, theme, Typography } from 'antd'
import { ArrowLeftOutlined, SortAscendingOutlined, BulbOutlined, CheckCircleOutlined, CloseCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RobotOutlined, SearchOutlined, SettingOutlined, StopOutlined, SyncOutlined, ToolOutlined } from '@ant-design/icons'
import { addDoc, collection, deleteDoc, deleteField, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { FilterBar } from '@/components/shared/FilterBar'
import { db } from '@/firebase'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { DELIVERY_STRATEGY_OPTIONS, getCompanyAvailableAgents, isAgentStrategy } from '@/services/agentOrchestrationService'
import { useEntitlements } from '@/hooks/useEntitlements'
import { listAgents } from '@/services/agentRegistryService'
import type { AgentDefinition, InterventionDeliveryStrategy } from '@/types/agentOrchestration'
import type { InterventionOutcomeDefinition } from '@/types/interventions'
import { OUTCOME_TYPE_OPTIONS, cleanOutcomeDefinition, suggestOutcomeDefaults } from '@/services/interventionOutcomeConfig'
import { hasOutcomeCheckBack, suggestOutcomeCheckBacks, type OutcomeMigrationSuggestion } from '@/services/interventionOutcomeMigrationService'
import { isAgentApiConfigured } from '@/config/agent'
import { useLanguage, tr } from '@/providers/LanguageProvider'
import { ModalActions } from '@/components/shared/ModalActions'
import '@/styles/operations-compliance.css'
import '@/styles/interventions-setup.css'

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
    outcomeDefinition?: InterventionOutcomeDefinition
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
    { get label() { return tr('Weekly') }, value: 'weekly', every: 1, unit: 'week' },
    { get label() { return tr('Monthly') }, value: 'monthly', every: 1, unit: 'month' },
    { get label() { return tr('Quarterly') }, value: 'quarterly', every: 3, unit: 'month' },
    { get label() { return tr('Yearly') }, value: 'yearly', every: 1, unit: 'year' },
    { get label() { return tr('Custom') }, value: 'custom' },
]

const RECURRENCE_UNITS: Array<{ label: string; value: RecurrenceUnit }> = [
    { get label() { return tr('Day(s)') }, value: 'day' },
    { get label() { return tr('Week(s)') }, value: 'week' },
    { get label() { return tr('Month(s)') }, value: 'month' },
    { get label() { return tr('Year(s)') }, value: 'year' },
]

const DURATION_TERMS: Array<{ label: string; value: InterventionDurationTerm; color: string }> = [
    { get label() { return tr('Short-term') }, value: 'short_term', color: 'green' },
    { get label() { return tr('Medium-term') }, value: 'medium_term', color: 'gold' },
    { get label() { return tr('Long-term') }, value: 'long_term', color: 'blue' },
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
        <Col span={12}><OptionCard icon={yesIcon} label={tr('Yes')} selected={value === 'yes'} onClick={() => onChange?.('yes')} /></Col>
        <Col span={12}><OptionCard icon={noIcon} label={tr('No')} selected={value === 'no'} onClick={() => onChange?.('no')} /></Col>
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
    const { t } = useLanguage()
    const { message, modal } = App.useApp()
    const { user, loading: identityLoading } = useFullIdentity()
    const { settings, getSetting } = useSystemSettings()
    const agenticAllowed = useEntitlements().has('agenticSupport')
    const interventionScopeModel = getSetting<InterventionScopeModel>('interventionScopeModel', 'company')
    const hasDepartments = !!settings?.hasDepartments
    const [form] = Form.useForm()
    const [interventions, setInterventions] = useState<InterventionRow[]>([])
    const [loading, setLoading] = useState(false)
    const [selectedId, setSelectedId] = useState<string>()
    const [detailOpen, setDetailOpen] = useState(false)
    const [section, setSection] = useState('overview')
    const [sort, setSort] = useState('name')
    const [pageState, setPageState] = useState({ key: '', page: 1 })
    const baseline = useRef('')
    const [modalOpen, setModalOpen] = useState(false)
    const [editingRecord, setEditingRecord] = useState<InterventionRow>()
    const [filters, setFilters] = useState<InterventionFilters>(emptyFilters)
    const [newAreaText, setNewAreaText] = useState('')
    const [enabledAgents, setEnabledAgents] = useState<AgentDefinition[]>([])
    const [allAgents, setAllAgents] = useState<AgentDefinition[]>([])
    const [migrationOpen, setMigrationOpen] = useState(false)
    const [migrationSelected, setMigrationSelected] = useState<string[]>([])
    const [migrationSuggestions, setMigrationSuggestions] = useState<OutcomeMigrationSuggestion[]>([])
    const [migrationIncluded, setMigrationIncluded] = useState<string[]>([])
    const [migrationWarnings, setMigrationWarnings] = useState<string[]>([])
    const [migrationProgress, setMigrationProgress] = useState<number | null>(null)
    const [migrationSaving, setMigrationSaving] = useState(false)
    const [draftingOutcome, setDraftingOutcome] = useState(false)

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
            message.error(t('Interventions could not be loaded.'))
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
        }).sort((a, b) => sort === 'area' ? String(a.areaOfSupport || '').localeCompare(String(b.areaOfSupport || '')) || String(a.interventionTitle || '').localeCompare(String(b.interventionTitle || '')) : String(a.interventionTitle || '').localeCompare(String(b.interventionTitle || '')))
    }, [filters, interventions, sort])

    const selected = rows.find((row) => row.id === selectedId) || rows[0]
    const pageKey = JSON.stringify([filters, sort, selected?.id])
    const selectedPage = Math.floor(Math.max(0, rows.findIndex((row) => row.id === selected?.id)) / 12) + 1
    const page = Math.min(pageState.key === pageKey ? pageState.page : selectedPage, Math.max(1, Math.ceil(rows.length / 12)))
    const changeView = (action: () => void) => {
        if (loading || draftingOutcome) return
        if (modalOpen && JSON.stringify(form.getFieldsValue(true)) !== baseline.current) {
            modal.confirm({ title: t('Discard unsaved changes?'), content: t('Your intervention edits have not been saved.'), okText: t('Discard changes'), cancelText: t('Keep editing'), onOk: action })
        } else action()
    }
    useEffect(() => {
        if (!modalOpen) return
        const warn = (event: BeforeUnloadEvent) => {
            if (JSON.stringify(form.getFieldsValue(true)) !== baseline.current) { event.preventDefault(); event.returnValue = '' }
        }
        window.addEventListener('beforeunload', warn)
        return () => window.removeEventListener('beforeunload', warn)
    }, [modalOpen, form])

    const metrics = useMemo(() => ({
        total: rows.length,
        compulsory: rows.filter((item) => item.isCompulsory === 'yes').length,
        recurring: rows.filter((item) => item.isRecurring === 'yes').length,
        longTerm: rows.filter((item) => item.durationTerm === 'long_term').length,
    }), [rows])

    /** Interventions set up before outcome tracking, with no follow-up to check the change stuck. */
    const withoutCheckBack = useMemo(() => interventions.filter((item) => !hasOutcomeCheckBack(item.outcomeDefinition)), [interventions])

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
        baseline.current = JSON.stringify(form.getFieldsValue(true))
        setDetailOpen(true)
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
        form.resetFields()
        form.setFieldsValue(safe)
        baseline.current = JSON.stringify(form.getFieldsValue(true))
        setDetailOpen(true)
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

        if (isAgentStrategy(cleaned.deliveryStrategy) && !agenticAllowed) {
            throw new Error('Agent delivery is not included in your organisation\u2019s plan.')
        }

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

        const outcomeDefinition = cleanOutcomeDefinition(cleaned.outcomeDefinition)
        if (outcomeDefinition) cleaned.outcomeDefinition = outcomeDefinition
        else delete cleaned.outcomeDefinition

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
        const applicationsSnapshot = await getDocs(companyCode ? query(collection(db, 'applications'), where('companyCode', '==', companyCode)) : collection(db, 'applications'))
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
                        outcomeDefinition: values.outcomeDefinition || null,
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
                        outcomeDefinition: values.outcomeDefinition || null,
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
                await updateDoc(doc(db, 'interventions', editingRecord.id), { ...payload, ...(cleaned.outcomeDefinition ? {} : { outcomeDefinition: deleteField() }) })
                await syncRequiredInterventionSnapshots(editingRecord.id, payload)
                message.success(t('Intervention updated.'))
            } else {
                const created = await addDoc(collection(db, 'interventions'), payload)
                setSelectedId(created.id)
                message.success(t('Intervention created.'))
            }

            setModalOpen(false)
            await fetchInterventions()
        } catch (error: any) {
            message.error(error?.message || t('Intervention could not be saved.'))
        } finally {
            setLoading(false)
        }
    }

    const deleteIntervention = async (interventionId: string) => {
        try {
            setLoading(true)
            await deleteDoc(doc(db, 'interventions', interventionId))

            const applicationsSnapshot = await getDocs(companyCode ? query(collection(db, 'applications'), where('companyCode', '==', companyCode)) : collection(db, 'applications'))
            for (const applicationDoc of applicationsSnapshot.docs) {
                const required = applicationDoc.data().interventions?.required || []
                if (!Array.isArray(required)) continue
                const filtered = required.filter((item: any) => item !== interventionId && item?.id !== interventionId)
                if (filtered.length !== required.length) {
                    await updateDoc(doc(db, 'applications', applicationDoc.id), { 'interventions.required': filtered })
                }
            }

            message.success(t('Intervention deleted.'))
            await fetchInterventions()
        } catch {
            message.error(t('Intervention could not be deleted.'))
        } finally {
            setLoading(false)
        }
    }

    const openMigration = () => {
        setMigrationSelected(withoutCheckBack.map((item) => item.id))
        setMigrationSuggestions([])
        setMigrationIncluded([])
        setMigrationWarnings([])
        setMigrationProgress(null)
        setMigrationOpen(true)
    }

    const generateMigration = async () => {
        const selected = withoutCheckBack.filter((item) => migrationSelected.includes(item.id))
        if (!selected.length) return
        try {
            setMigrationProgress(0)
            const result = await suggestOutcomeCheckBacks(selected, setMigrationProgress)
            setMigrationSuggestions(result.suggestions)
            setMigrationIncluded(result.suggestions.map((item) => item.id))
            setMigrationWarnings(result.warnings)
        } catch (error: any) {
            message.error(error?.message || t('Outcome suggestions could not be generated.'))
        } finally {
            setMigrationProgress(null)
        }
    }

    const updateSuggestion = (id: string, patch: Partial<InterventionOutcomeDefinition>) => {
        setMigrationSuggestions((current) => current.map((item) => item.id === id ? { ...item, definition: { ...item.definition, ...patch } } : item))
    }

    /** Saves the reviewed check-backs, then refreshes the snapshots applications already hold of these interventions. */
    const applyMigration = async () => {
        const chosen = migrationSuggestions
            .filter((item) => migrationIncluded.includes(item.id))
            .map((item) => ({ id: item.id, definition: cleanOutcomeDefinition(item.definition) }))
            .filter((item): item is { id: string; definition: InterventionOutcomeDefinition } => Boolean(item.definition))
        if (!chosen.length) return
        try {
            setMigrationSaving(true)
            for (const item of chosen) {
                await updateDoc(doc(db, 'interventions', item.id), { outcomeDefinition: item.definition })
            }

            const definitions = new Map(chosen.map((item) => [item.id, item.definition]))
            const applicationsSnapshot = await getDocs(query(collection(db, 'applications'), where('companyCode', '==', companyCode)))
            for (const applicationDoc of applicationsSnapshot.docs) {
                const required = applicationDoc.data().interventions?.required
                if (!Array.isArray(required)) continue
                let changed = false
                const updatedRequired = required.map((entry: any) => {
                    const definition = entry && typeof entry === 'object' ? definitions.get(entry.id) : undefined
                    if (!definition) return entry
                    changed = true
                    return { ...entry, outcomeDefinition: definition }
                })
                if (changed) await updateDoc(doc(db, 'applications', applicationDoc.id), { 'interventions.required': updatedRequired })
            }

            message.success(t('Check-backs added to {count} intervention(s).', undefined, { count: chosen.length }))
            setMigrationOpen(false)
            await fetchInterventions()
        } catch (error: any) {
            message.error(error?.message || t('Check-backs could not be saved.'))
        } finally {
            setMigrationSaving(false)
        }
    }

    const draftOutcomeWithAi = async () => {
        const values = form.getFieldsValue(true)
        if (!String(values.interventionTitle || '').trim()) {
            message.info(t('Add the intervention title first.'))
            return
        }
        try {
            setDraftingOutcome(true)
            const { suggestions } = await suggestOutcomeCheckBacks([{ ...values, id: editingRecord?.id || 'draft', outcomeDefinition: cleanOutcomeDefinition(values.outcomeDefinition) }])
            if (!suggestions[0]) throw new Error(t('No suggestion was produced. Try again.'))
            form.setFieldsValue({ outcomeDefinition: suggestions[0].definition })
        } catch (error: any) {
            message.error(error?.message || t('Outcome suggestions could not be generated.'))
        } finally {
            setDraftingOutcome(false)
        }
    }

    return (
        <DashboardPage className="operations-interventions-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ToolOutlined />} label={t('Interventions')} value={metrics.total} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<CheckCircleOutlined />} label={t('Compulsory')} value={metrics.compulsory} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<SyncOutlined />} label={t('Recurring')} value={metrics.recurring} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<SettingOutlined />} label={t('Long-term')} value={metrics.longTerm} /></Col>
            </Row>

            <FilterBar
                advancedDisplay="dropdown"
                onReset={() => setFilters(emptyFilters)}
                primary={(
                    <>
                        <Input prefix={<SearchOutlined />} value={filters.title} onChange={(event) => setFilters((prev) => ({ ...prev, title: event.target.value }))} placeholder={t('Search interventions')} allowClear />
                        <Select allowClear placeholder={t('Support area')} value={filters.area || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, area: value || '' }))} options={areaOptions.map((value) => ({ value, label: value }))} />
                    </>
                )}
                advanced={<>
                        <Select allowClear placeholder={t('Term')} value={filters.durationTerm || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, durationTerm: value || '' }))} options={DURATION_TERMS.map(({ value, label }) => ({ value, label }))} />
                        <Select allowClear placeholder={t('Execution')} value={filters.executionMode || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, executionMode: value || '' }))} options={[{ value: 'single_session', label: t('Single session') }, { value: 'multi_step', label: t('Multi-step') }]} />
                    <Select allowClear placeholder={t('Compulsory')} value={filters.compulsory || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, compulsory: value || '' }))} options={[{ value: 'yes', label: t('Compulsory') }, { value: 'no', label: t('Optional') }]} />
                    <Select allowClear placeholder={t('Recurrence')} value={filters.recurring || undefined} onChange={(value) => setFilters((prev) => ({ ...prev, recurring: value || '' }))} options={[{ value: 'yes', label: t('Recurring') }, { value: 'no', label: t('Not recurring') }]} />
                </>}
                actions={(
                    <>
                        <Button icon={<ReloadOutlined />} onClick={() => void fetchInterventions()}>{t('Refresh')}</Button>
                        {isAgentApiConfigured && withoutCheckBack.length > 0 && (
                            <Button icon={<RobotOutlined />} onClick={openMigration}>{t('Add check-backs with AI ({count})', undefined, { count: withoutCheckBack.length })}</Button>
                        )}
                        <Button type="primary" icon={<PlusOutlined />} onClick={() => changeView(openAdd)}>{t('Add intervention')}</Button>
                    </>
                )}
            />

            <div className={`compliance-workspace intervention-setup-workspace${detailOpen ? ' compliance-workspace--detail' : ''}`}>
                <Card className="operations-compliance-card compliance-participants">
                    <Select className="compliance-list-sort" aria-label={t('Sort interventions')} prefix={<SortAscendingOutlined />} value={sort} onChange={setSort} options={[{ value: 'name', label: t('Name A–Z') }, { value: 'area', label: t('Support area') }]} />
                    <Spin spinning={loading}><nav className="compliance-participant-list" aria-label={t('Interventions')}>
                        {rows.slice((page - 1) * 12, page * 12).map((row) => <button key={row.id} type="button" className={`compliance-participant${selected?.id === row.id ? ' compliance-participant--selected' : ''}`} aria-current={selected?.id === row.id ? 'true' : undefined} onClick={() => changeView(() => { setSelectedId(row.id); setModalOpen(false); setDetailOpen(true); setSection('overview') })}>
                            <ToolOutlined />
                            <div className="compliance-participant-main"><div className="compliance-participant-name" title={row.interventionTitle}>{row.interventionTitle || t('Untitled intervention')}</div><div className="compliance-participant-meta">{row.areaOfSupport || t('No support area')}</div><div className="compliance-participant-meta">{DELIVERY_STRATEGY_OPTIONS.find((item) => item.value === (row.deliveryStrategy || 'human_only'))?.label}</div></div>
                            <Tag color={durationTermOption(row.durationTerm).color}>{durationTermOption(row.durationTerm).label}</Tag>
                        </button>)}
                        {!loading && !rows.length && <Empty description={t('No interventions match the selected filters.')} />}
                    </nav></Spin>
                    {rows.length > 12 && <div className="compliance-list-pagination"><Pagination size="small" current={page} pageSize={12} total={rows.length} showSizeChanger={false} onChange={(next) => setPageState({ key: pageKey, page: next })} /></div>}
                </Card>
                <Card className="operations-compliance-card compliance-detail">
                    <Button className="compliance-back" icon={<ArrowLeftOutlined />} onClick={() => changeView(() => { setModalOpen(false); setDetailOpen(false) })}>{t('Back to interventions')}</Button>
                    {modalOpen ? <>
                    <Typography.Title level={4}>{t(editingRecord ? 'Edit intervention' : 'Add intervention')}</Typography.Title>
                <Form form={form} disabled={loading} layout="vertical" onFinish={handleFinish}>
                    <Form.Item name="areaOfSupport" label={t('Area of support')} rules={[{ required: true, message: tr('Area of support is required.') }]}>
                        <Select
                            allowClear
                            showSearch
                            placeholder={t('Select or add an area')}
                            options={areaOptions.map((value) => ({ value, label: value }))}
                            dropdownRender={(menu) => (
                                <>
                                    {menu}
                                    <Divider style={{ margin: '8px 0' }} />
                                    <Space.Compact style={{ width: '100%', padding: '0 8px 8px' }}>
                                        <Input value={newAreaText} onChange={(event) => setNewAreaText(event.target.value)} placeholder={t('New support area')} />
                                        <Button
                                            type="primary"
                                            onClick={() => {
                                                const value = newAreaText.trim()
                                                if (!value) return
                                                form.setFieldsValue({ areaOfSupport: value })
                                                setNewAreaText('')
                                            }}
                                        >
                                            {t('Add')}
                                        </Button>
                                    </Space.Compact>
                                </>
                            )}
                        />
                    </Form.Item>

                    <Form.Item name="interventionTitle" label={t('Intervention title')} rules={[{ required: true, message: tr('Intervention title is required.') }]}>
                        <Input placeholder={t('e.g. Website development')} />
                    </Form.Item>

                    {interventionScopeModel === 'program_specific' && (
                        <Form.Item name="programId" label={t('Program')} rules={[{ required: true, message: tr('Program is required.') }]}>
                            <Input placeholder={t('Enter program ID')} />
                        </Form.Item>
                    )}

                    {interventionScopeModel === 'department_specific' && hasDepartments && (
                        <Form.Item name="departmentId" label={t('Department')} rules={[{ required: true, message: tr('Department is required.') }]}>
                            <Input placeholder={t('Enter department ID')} />
                        </Form.Item>
                    )}

                    <Row gutter={12}>
                        <Col xs={24} md={12}>
                            <Form.Item name="durationTerm" label={t('Intervention term')} rules={[{ required: true, message: tr('Select an intervention term.') }]}>
                                <Select options={DURATION_TERMS.map(({ value, label }) => ({ value, label }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="executionMode" label={t('Execution mode')} rules={[{ required: true, message: tr('Select execution mode.') }]}>
                                <Select options={[{ value: 'single_session', label: t('Single session') }, { value: 'multi_step', label: t('Multi-step') }]} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="isCompulsory" label={t('Compulsory?')} rules={[{ required: true }]}>
                                <YesNoField yesIcon={<CheckCircleOutlined />} noIcon={<CloseCircleOutlined />} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item name="isRecurring" label={t('Recurring?')} rules={[{ required: true }]}>
                                <YesNoField yesIcon={<SyncOutlined />} noIcon={<StopOutlined />} />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Card size="small" title={<Space><RobotOutlined /> {t('Delivery orchestration')}</Space>} style={{ marginBottom: 16 }}>
                        <Form.Item name="deliveryStrategy" label={t('Who performs this intervention?')} rules={[{ required: true }]}>
                            <Select options={DELIVERY_STRATEGY_OPTIONS.filter((option) => agenticAllowed || !isAgentStrategy(option.value)).map((option) => ({ value: option.value, label: option.label, title: option.description }))} />
                        </Form.Item>
                        <Form.Item noStyle shouldUpdate={(previous, current) => previous.deliveryStrategy !== current.deliveryStrategy}>
                            {({ getFieldValue }) => {
                                const strategy = getFieldValue('deliveryStrategy') as InterventionDeliveryStrategy
                                if (!isAgentStrategy(strategy)) return null
                                return (
                                    <>
                                        <Form.Item name="agentId" label={t('Assigned agent')} rules={[{ required: true, message: tr('Choose an enabled company agent.') }]}>
                                            <Select
                                                placeholder={enabledAgents.length ? t('Choose an enabled agent') : t('No agents enabled for this company')}
                                                disabled={!enabledAgents.length}
                                                options={enabledAgents.map((agent) => ({ value: agent.id, label: agent.name }))}
                                            />
                                        </Form.Item>
                                        <Typography.Text type="secondary">
                                            {strategy === 'agent_only' && t('The agent owns delivery and operations monitors progress.')}
                                            {strategy === 'agent_with_ops_review' && t('The agent produces the work; operations reviews before completion.')}
                                            {strategy === 'agent_with_consultant_review' && t('The agent produces the work; the assigned consultant reviews it from start to finish.')}
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
                                <Card size="small" title={t('Recurrence')} style={{ marginBottom: 16 }}>
                                    <Row gutter={12}>
                                        <Col xs={24} md={12}>
                                            <Form.Item name={['recurrence', 'preset']} label={t('Recurrence pattern')} rules={[{ required: true, message: tr('Select a recurrence pattern.') }]}>
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
                                            <Form.Item name="endRule" label={t('Series end rule')}>
                                                <Select options={[{ value: 'none', label: t('Ongoing') }, { value: 'after_n_cycles', label: t('End after N cycles') }, { value: 'by_date', label: t('End by date') }]} />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                    <Form.Item noStyle shouldUpdate={(previous, current) => previous?.recurrence?.preset !== current?.recurrence?.preset}>
                                        {({ getFieldValue }) => getFieldValue(['recurrence', 'preset']) === 'custom' ? (
                                            <Row gutter={12}>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name={['recurrence', 'every']} label={t('Repeat every')} rules={[{ required: true, message: tr('Enter repeat interval.') }]}>
                                                        <InputNumber min={1} style={{ width: '100%' }} />
                                                    </Form.Item>
                                                </Col>
                                                <Col xs={24} md={12}>
                                                    <Form.Item name={['recurrence', 'unit']} label={t('Unit')} rules={[{ required: true, message: tr('Select a unit.') }]}>
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
                                                return <Form.Item name="maxCycles" label={t('Max cycles')} rules={[{ required: true, message: tr('Enter max cycles.') }]}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item>
                                            }
                                            if (endRule === 'by_date') {
                                                return <Form.Item name="endDate" label={t('End date')} rules={[{ required: true, message: tr('Enter end date.') }]}><Input placeholder={t('YYYY-MM-DD')} /></Form.Item>
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
                            <Card size="small" title={t('Steps required')} style={{ marginBottom: 16 }}>
                                <Form.List name="steps">
                                    {(fields, { add, remove }) => (
                                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                            {fields.map(({ key, name, ...restField }) => (
                                                <Card key={key} size="small" title={`Step ${name + 1}`} extra={<Button danger icon={<DeleteOutlined />} onClick={() => remove(name)} />}>
                                                    <Row gutter={12}>
                                                        <Col xs={24} md={16}>
                                                            <Form.Item {...restField} name={[name, 'title']} label={t('Step title')} rules={[{ required: true, message: tr('Step title is required.') }]}>
                                                                <Input placeholder={t('e.g. Draft business profile')} />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col xs={24} md={8}>
                                                            <Form.Item {...restField} name={[name, 'weight']} label={t('Weight')}>
                                                                <InputNumber min={1} style={{ width: '100%' }} />
                                                            </Form.Item>
                                                        </Col>
                                                        <Col span={24}>
                                                            <Form.Item {...restField} name={[name, 'description']} label={t('Description')}>
                                                                <Input.TextArea rows={2} />
                                                            </Form.Item>
                                                        </Col>
                                                    </Row>
                                                </Card>
                                            ))}
                                            <Button type="dashed" icon={<PlusOutlined />} block onClick={() => add({ id: `step-${Date.now()}-${Math.random().toString(16).slice(2)}`, weight: 1 })}>{t('Add step')}</Button>
                                        </Space>
                                    )}
                                </Form.List>
                            </Card>
                            )
                        }}
                    </Form.Item>

                    <Collapse
                        ghost
                        style={{ marginBottom: 16 }}
                        defaultActiveKey={editingRecord?.outcomeDefinition ? ['outcome'] : []}
                        items={[{
                            key: 'outcome',
                            label: <Typography.Text strong>{t('Outcome & deliverable (optional)')}</Typography.Text>,
                            forceRender: true,
                            children: (
                                <>
                                    <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
                                        <Typography.Text type="secondary">{t('What should be different once this is delivered, and what tangible output will the SME have? Facilitators will see the deliverable name when uploading evidence.')}</Typography.Text>
                                        <Space wrap>
                                        <Button
                                            icon={<BulbOutlined />}
                                            onClick={() => {
                                                const suggestion = suggestOutcomeDefaults(form.getFieldValue('interventionTitle'), form.getFieldValue('areaOfSupport'))
                                                if (!suggestion) {
                                                    message.info(t('No suggestion for this intervention yet. Fill in the fields below.'))
                                                    return
                                                }
                                                const current = form.getFieldValue('outcomeDefinition') || {}
                                                form.setFieldsValue({
                                                    outcomeDefinition: {
                                                        ...current,
                                                        outcomeType: current.outcomeType || suggestion.outcomeType,
                                                        deliverableName: current.deliverableName || suggestion.deliverableName,
                                                        intendedOutcome: current.intendedOutcome || suggestion.intendedOutcome,
                                                        followUpDays: current.followUpDays || suggestion.followUpDays,
                                                    },
                                                })
                                            }}
                                        >
                                            {t('Suggest defaults')}
                                        </Button>
                                        {isAgentApiConfigured && (
                                            <Button icon={<RobotOutlined />} loading={draftingOutcome} onClick={() => void draftOutcomeWithAi()}>
                                                {t('Draft with AI')}
                                            </Button>
                                        )}
                                        </Space>
                                    </Space>
                                    <Row gutter={12}>
                                        <Col xs={24} md={12}>
                                            <Form.Item name={['outcomeDefinition', 'deliverableName']} label={t('Deliverable name')} extra={t('e.g. Cash Flow Forecast. Shown instead of "POE".')}>
                                                <Input placeholder={t('e.g. Cash Flow Forecast')} />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <Form.Item name={['outcomeDefinition', 'outcomeType']} label={t('Kind of change')}>
                                                <Select allowClear placeholder={t('Select')} options={OUTCOME_TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))} />
                                            </Form.Item>
                                        </Col>
                                        <Col span={24}>
                                            <Form.Item name={['outcomeDefinition', 'intendedOutcome']} label={t('Intended outcome')}>
                                                <Input.TextArea rows={2} placeholder={t('e.g. The SME actively maintains a forward-looking cash-flow forecast.')} />
                                            </Form.Item>
                                        </Col>
                                        <Col span={24}>
                                            <Form.Item name={['outcomeDefinition', 'deliverableDescription']} label={t('Deliverable description')}>
                                                <Input.TextArea rows={2} />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <Form.Item name={['outcomeDefinition', 'deliverableRequired']} label={t('Deliverable required?')} valuePropName="checked">
                                                <Switch />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <Form.Item name={['outcomeDefinition', 'followUpDays']} label={t('Follow-up after (days)')} extra={t('Counted from confirmed completion. Facilitators are prompted to check the change has stuck.')}>
                                                <InputNumber min={1} style={{ width: '100%' }} />
                                            </Form.Item>
                                        </Col>
                                    </Row>
                                </>
                            ),
                        }]}
                    />

                    <ModalActions>
                        <Button onClick={() => changeView(() => setModalOpen(false))}>{t('Cancel')}</Button>
                        <Button type="primary" htmlType="submit" loading={loading}>{t('Save intervention')}</Button>
                    </ModalActions>
                </Form>
                    </> : selected ? <>
                        <div className="compliance-detail-header"><div><Typography.Title level={4}>{selected.interventionTitle || t('Untitled intervention')}</Typography.Title><Typography.Text type="secondary">{selected.areaOfSupport}</Typography.Text></div><Space><Button icon={<EditOutlined />} onClick={() => openEdit(selected)}>{t('Edit')}</Button><Popconfirm title={t('Delete this intervention?')} okText={t('Delete')} okButtonProps={{ danger: true }} onConfirm={() => void deleteIntervention(selected.id)}><Button danger icon={<DeleteOutlined />} aria-label={t('Delete intervention')} /></Popconfirm></Space></div>
                        <Segmented block value={section} onChange={setSection} options={[{ value: 'overview', label: t('Overview') }, { value: 'delivery', label: t('Delivery') }, { value: 'schedule', label: t('Schedule & steps') }, { value: 'outcomes', label: t('Outcomes') }]} />
                        <div className="intervention-setup-section">
                        {section === 'overview' && <Descriptions bordered column={1} size="small" items={[
                            { key: 'area', label: t('Support area'), children: selected.areaOfSupport || t('Not set') },
                            { key: 'term', label: t('Term'), children: durationTermOption(selected.durationTerm).label },
                            { key: 'required', label: t('Compulsory'), children: t(selected.isCompulsory === 'yes' ? 'Yes' : 'No') },
                            { key: 'execution', label: t('Execution'), children: t(selected.executionMode === 'multi_step' ? 'Multi-step' : 'Single session') },
                        ]} />}
                        {section === 'delivery' && <Descriptions bordered column={1} size="small" items={[
                            { key: 'delivery', label: t('Delivery strategy'), children: DELIVERY_STRATEGY_OPTIONS.find((item) => item.value === (selected.deliveryStrategy || 'human_only'))?.label },
                            ...(isAgentStrategy(selected.deliveryStrategy) ? [{ key: 'agent', label: t('Assigned agent'), children: allAgents.find((item) => item.id === selected.agentId)?.name || t('Not assigned') }] : []),
                            { key: 'review', label: t('Review required'), children: t(selected.reviewRequired ? 'Yes' : 'No') },
                            ...(selected.reviewRequired ? [{ key: 'reviewer', label: t('Reviewer'), children: selected.reviewerType ? t(selected.reviewerType === 'operations' ? 'Operations' : 'Consultant') : t('Not set') }] : []),
                        ]} />}
                        {section === 'schedule' && <div className="intervention-schedule">
                            <div className="intervention-schedule-summary"><SyncOutlined /><div><Typography.Text strong>{selected.isRecurring === 'yes' ? recurrenceLabel(selected.recurrence) : t('One-time intervention')}</Typography.Text>{selected.isRecurring === 'yes' && <Typography.Text type="secondary">{endRuleLabel(selected)}</Typography.Text>}</div><Tag>{selected.steps?.length || 0} {t('steps')}</Tag></div>
                            {selected.steps?.length ? <ol className="intervention-step-list">{selected.steps.map((step, index) => <li className="intervention-step-card" key={step.id || index}>
                                <span className="intervention-step-number" aria-hidden="true">{index + 1}</span>
                                <div className="intervention-step-content"><div className="intervention-step-heading"><Typography.Text strong>{step.title || t('Step')}</Typography.Text><span className="intervention-step-weight">{t('Weight')}: {step.weight ?? 0}</span></div>
                                {step.description && <Typography.Paragraph type="secondary">{step.description}</Typography.Paragraph>}</div>
                            </li>)}</ol> : <Empty description={t('No steps configured')} />}
                        </div>}
                        {section === 'outcomes' && <Descriptions bordered column={1} size="small" items={[
                            { key: 'outcome', label: t('Intended outcome'), children: selected.outcomeDefinition?.intendedOutcome || t('Not set') },
                            { key: 'type', label: t('Outcome type'), children: OUTCOME_TYPE_OPTIONS.find((item) => item.value === selected.outcomeDefinition?.outcomeType)?.label || t('Not set') },
                            { key: 'deliverable', label: t('Deliverable'), children: selected.outcomeDefinition?.deliverableName || t('Not set') },
                            { key: 'description', label: t('Description'), children: selected.outcomeDefinition?.deliverableDescription || t('Not set') },
                            { key: 'required', label: t('Deliverable required'), children: t(selected.outcomeDefinition?.deliverableRequired ? 'Yes' : 'No') },
                            { key: 'followup', label: t('Check-back'), children: hasOutcomeCheckBack(selected.outcomeDefinition) ? t('After {days} days', undefined, { days: Number(selected.outcomeDefinition?.followUpDays) }) : t('Not set') },
                        ]} />}
                        </div>
                    </> : <Empty description={t('Select an intervention')} />}
                </Card>
            </div>

            <Modal
                open={migrationOpen}
                onCancel={() => setMigrationOpen(false)}
                width={860}
                destroyOnClose
                title={t('Add outcome check-backs with AI')}
                footer={migrationSuggestions.length ? (
                    <Space>
                        <Button onClick={() => setMigrationSuggestions([])} disabled={migrationSaving}>{t('Back')}</Button>
                        <Button type="primary" loading={migrationSaving} disabled={!migrationIncluded.length} onClick={() => void applyMigration()}>
                            {t('Save {count} check-back(s)', undefined, { count: migrationIncluded.length })}
                        </Button>
                    </Space>
                ) : (
                    <Button block type="primary" icon={<RobotOutlined />} loading={migrationProgress !== null} disabled={!migrationSelected.length} onClick={() => void generateMigration()}>
                        {migrationProgress !== null
                            ? t('Drafting {done} of {total}', undefined, { done: migrationProgress, total: migrationSelected.length })
                            : t('Draft check-backs')}
                    </Button>
                )}
            >
                {!migrationSuggestions.length ? (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Typography.Text type="secondary">
                            {t('These interventions have no follow-up, so facilitators are never prompted to check the change stuck. The AI drafts an intended outcome, deliverable and follow-up window for each; you review them before anything is saved.')}
                        </Typography.Text>
                        {withoutCheckBack.length ? (
                            <>
                                {withoutCheckBack.length > 1 && <Checkbox
                                    checked={migrationSelected.length === withoutCheckBack.length}
                                    indeterminate={migrationSelected.length > 0 && migrationSelected.length < withoutCheckBack.length}
                                    onChange={(event) => setMigrationSelected(event.target.checked ? withoutCheckBack.map((item) => item.id) : [])}
                                >
                                    {t('Select all ({count})', undefined, { count: withoutCheckBack.length })}
                                </Checkbox>}
                                <Checkbox.Group value={migrationSelected} onChange={(values) => setMigrationSelected(values as string[])} style={{ width: '100%' }}>
                                    <Space direction="vertical" size={6} style={{ width: '100%', maxHeight: 360, overflowY: 'auto' }}>
                                        {withoutCheckBack.map((item) => (
                                            <Checkbox key={item.id} value={item.id}>
                                                <Typography.Text strong>{item.interventionTitle || t('Untitled intervention')}</Typography.Text>
                                                <Typography.Text type="secondary"> · {item.areaOfSupport || t('No support area')}</Typography.Text>
                                            </Checkbox>
                                        ))}
                                    </Space>
                                </Checkbox.Group>
                            </>
                        ) : <Empty description={t('Every intervention already has a check-back.')} />}
                    </Space>
                ) : (
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        {migrationWarnings.length > 0 && <Alert type="warning" showIcon message={migrationWarnings.join(' · ')} />}
                        <Typography.Text type="secondary">{t('Edit anything that is off, untick what you do not want, then save. Assignments already in progress keep their original setup.')}</Typography.Text>
                        {migrationSuggestions.map((suggestion) => {
                            const source = interventions.find((item) => item.id === suggestion.id)
                            const included = migrationIncluded.includes(suggestion.id)
                            const definition = suggestion.definition
                            return (
                                <Card
                                    key={suggestion.id}
                                    size="small"
                                    style={{ opacity: included ? 1 : 0.55 }}
                                    title={(
                                        <Checkbox
                                            checked={included}
                                            onChange={(event) => setMigrationIncluded((current) => event.target.checked ? [...current, suggestion.id] : current.filter((id) => id !== suggestion.id))}
                                        >
                                            {source?.interventionTitle || t('Untitled intervention')}
                                        </Checkbox>
                                    )}
                                    extra={<Typography.Text type="secondary">{source?.areaOfSupport}</Typography.Text>}
                                >
                                    <Row gutter={12}>
                                        <Col xs={24} md={12}>
                                            <Typography.Text type="secondary">{t('Deliverable name')}</Typography.Text>
                                            <Input value={definition.deliverableName} disabled={!included} onChange={(event) => updateSuggestion(suggestion.id, { deliverableName: event.target.value })} />
                                        </Col>
                                        <Col xs={24} md={12}>
                                            <Typography.Text type="secondary">{t('Kind of change')}</Typography.Text>
                                            <Select allowClear style={{ width: '100%' }} value={definition.outcomeType} disabled={!included} onChange={(value) => updateSuggestion(suggestion.id, { outcomeType: value })} options={OUTCOME_TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))} />
                                        </Col>
                                        <Col span={24} style={{ marginTop: 8 }}>
                                            <Typography.Text type="secondary">{t('Intended outcome')}</Typography.Text>
                                            <Input.TextArea rows={2} value={definition.intendedOutcome} disabled={!included} onChange={(event) => updateSuggestion(suggestion.id, { intendedOutcome: event.target.value })} />
                                        </Col>
                                        <Col xs={24} md={12} style={{ marginTop: 8 }}>
                                            <Typography.Text type="secondary">{t('Follow-up after (days)')}</Typography.Text>
                                            <InputNumber min={1} style={{ width: '100%' }} value={definition.followUpDays} disabled={!included} onChange={(value) => updateSuggestion(suggestion.id, { followUpDays: Number(value) || undefined })} />
                                        </Col>
                                        <Col xs={24} md={12} style={{ marginTop: 8 }}>
                                            <Typography.Text type="secondary">{t('Deliverable required?')}</Typography.Text>
                                            <div><Switch checked={Boolean(definition.deliverableRequired)} disabled={!included} onChange={(checked) => updateSuggestion(suggestion.id, { deliverableRequired: checked })} /></div>
                                        </Col>
                                    </Row>
                                    {suggestion.rationale && <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0' }}><BulbOutlined /> {suggestion.rationale}</Typography.Paragraph>}
                                </Card>
                            )
                        })}
                    </Space>
                )}
            </Modal>
        </DashboardPage>
    )
}

export default InterventionsSetupPage
