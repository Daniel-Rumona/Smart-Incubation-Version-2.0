import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    App,
    Button,
    Card,
    Checkbox,
    Col,
    DatePicker,
    Empty,
    Form,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Radio,
    Row,
    Select,
    Space,
    Steps,
    Switch,
    Table,
    Tag,
    Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    DeleteOutlined,
    EditOutlined,
    PlusOutlined,
    ProjectOutlined,
    RobotOutlined,
    SearchOutlined,
    TeamOutlined,
    ThunderboltOutlined,
} from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    getDocs,
    query,
    serverTimestamp,
    updateDoc,
    where,
} from 'firebase/firestore'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { getFirebaseDb } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    normalizeAgentSupportMode,
    type AgentSupportMode,
} from '@/services/workspaceProgramsService'
import { useRegisterAgentPageContext } from '@/shared/hooks/useRegisterAgentPageContext'
import '@/styles/dashboard.css'
import '@/styles/director.css'
import { useLanguage, tr } from '@/providers/LanguageProvider'

type ProgramStatus = 'Active' | 'Inactive' | 'Upcoming' | 'Completed'
type AssignmentMode = 'sme_choice' | 'force_all'

type OnboardingQuestion = {
    id: string
    question: string
    type: 'text' | 'number' | 'yes_no' | 'long_text' | 'single_select' | 'multi_select'
    required: boolean
    options?: string[]
    maxSelections?: number
}

type ComplianceRequirement = {
    id: string
    name: string
    category: 'identity' | 'legal' | 'financial' | 'operational' | 'other'
    required: boolean
}

type InterventionOption = { id: string; title: string; area?: string }

type ProgramRecord = {
    id: string
    name: string
    description?: string
    type?: string
    status: ProgramStatus
    cohortYear?: string
    startDate?: string
    endDate?: string
    budget: number
    maxCapacity: number
    assignedAdmin?: string
    eligibilityCriteria?: Record<string, unknown>
    onboardingQuestions?: OnboardingQuestion[]
    interventionPolicy?: {
        mode: AssignmentMode
        forcedInterventionIds: string[]
        allowSmeSelection: boolean
    }
    complianceRequirements?: ComplianceRequirement[]
    agentSupportMode: AgentSupportMode
    openToExternalSmes?: boolean
}

type ProgramDetailsForm = {
    name: string
    description: string
    type?: string
    status: ProgramStatus
    cohortYear: string
    startDate?: Dayjs
    endDate?: Dayjs
    budget?: number
    maxCapacity?: number
    assignedAdmin?: string
    openToExternalSmes?: boolean
}

type EligibilityForm = {
    sectors?: string[]
    provinces?: string[]
    minAge?: number
    maxAge?: number
    minYearsOfTrading?: number
}

type EligibilityCriterion = keyof EligibilityForm

const STATUS_OPTIONS: ProgramStatus[] = ['Active', 'Inactive', 'Upcoming', 'Completed']
const PROGRAM_TYPE_OPTIONS = [
    'Pre-incubation',
    'Incubation',
    'Acceleration',
    'Funding readiness',
    'Market access',
    'Enterprise development',
    'Supplier development',
    'Mentorship',
]
const SECTORS = ['Agriculture', 'Technology', 'Manufacturing', 'Tourism', 'Retail', 'Services', 'Other']
const PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Free State']
const WIZARD_STEPS = ['Program details', 'Eligibility', 'Onboarding', 'Interventions', 'Agent support', 'Compliance']
const ELIGIBILITY_OPTIONS: Array<{ value: EligibilityCriterion; label: string }> = [
    { value: 'sectors', get label() { return tr('Eligible sectors') } },
    { value: 'provinces', get label() { return tr('Eligible provinces') } },
    { value: 'minAge', get label() { return tr('Minimum owner age') } },
    { value: 'maxAge', get label() { return tr('Maximum owner age') } },
    { value: 'minYearsOfTrading', get label() { return tr('Minimum years trading') } },
]

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const asDate = (value: unknown) => {
    if (!value) return undefined
    if (typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function') return dayjs(value.toDate()).format('YYYY-MM-DD')
    const parsed = dayjs(value as string)
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : undefined
}
const formatCurrency = (value: number) => new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value || 0)
const statusColor = (status: ProgramStatus) => status === 'Active' ? 'green' : status === 'Upcoming' ? 'blue' : status === 'Completed' ? 'purple' : 'default'

const SUPPORT_OPTIONS: Array<{
    value: AgentSupportMode
    icon: React.ReactNode
    title: string
    short: string
    description: string
    access: string
}> = [
        {
            value: 'simultaneous',
            icon: <TeamOutlined />,
            get title() { return tr('Simultaneous agentic support') },
            short: 'Human + agent',
            get description() { return tr('Consultants and agents deliver interventions together throughout the programme.') },
            access: 'Assign and Assigned to me remain available. Agent activity is also visible.',
        },
        {
            value: 'post_diagnostic',
            icon: <ThunderboltOutlined />,
            get title() { return tr('Post-diagnostic agent support') },
            short: 'Agent after DP',
            get description() { return tr('Agents take over intervention delivery after the diagnostic plan has been completed and confirmed.') },
            access: 'Human assignment pages are removed after the diagnostic-plan handoff; monitoring remains available.',
        },
        {
            value: 'fully_agentic',
            icon: <RobotOutlined />,
            get title() { return tr('Fully agentic support') },
            short: 'Agents only',
            get description() { return tr('Agents deliver the programme without consultants.') },
            access: 'Consultant assignment pages are hidden. The workspace exposes agent-work monitoring only.',
        },
    ]

export const ProgramsPage = () => {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [detailsForm] = Form.useForm<ProgramDetailsForm>()
    const [eligibilityForm] = Form.useForm<EligibilityForm>()
    const [programs, setPrograms] = useState<ProgramRecord[]>([])
    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [admins, setAdmins] = useState<Array<{ value: string; label: string }>>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<ProgramRecord>()
    const [step, setStep] = useState(0)
    const [detailsDraft, setDetailsDraft] = useState<ProgramDetailsForm>()
    const [eligibilityDraft, setEligibilityDraft] = useState<EligibilityForm>({})
    const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
    const [selectedEligibilityCriteria, setSelectedEligibilityCriteria] = useState<EligibilityCriterion[]>([])
    const [requirements, setRequirements] = useState<ComplianceRequirement[]>([])
    const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('sme_choice')
    const [selectedInterventions, setSelectedInterventions] = useState<string[]>([])
    const [interventionSearch, setInterventionSearch] = useState('')
    const [interventionArea, setInterventionArea] = useState<string>()
    const [supportMode, setSupportMode] = useState<AgentSupportMode>('simultaneous')

    const companyCode = String(user?.companyCode || '').trim()

    const interventionAreas = useMemo(() => Array.from(new Set(interventions.map((item) => item.area?.trim()).filter((area): area is string => !!area))).sort(), [interventions])
    const filteredInterventions = useMemo(() => {
        const search = interventionSearch.trim().toLowerCase()
        return interventions.filter((item) => {
            const matchesArea = !interventionArea || item.area === interventionArea
            const matchesSearch = !search || `${item.title} ${item.area || ''}`.toLowerCase().includes(search)
            return matchesArea && matchesSearch
        })
    }, [interventionArea, interventionSearch, interventions])
    const visibleInterventionOptions = useMemo(() => {
        const visibleIds = new Set(filteredInterventions.map((item) => item.id))
        return interventions.filter((item) => visibleIds.has(item.id) || selectedInterventions.includes(item.id))
    }, [filteredInterventions, interventions, selectedInterventions])

    const load = useCallback(async () => {
        if (!companyCode) return
        setLoading(true)
        try {
            const db = getFirebaseDb()
            const [programSnap, interventionSnap, usersSnap] = await Promise.all([
                getDocs(query(collection(db, 'programs'), where('companyCode', '==', companyCode))),
                getDocs(query(collection(db, 'interventions'), where('companyCode', '==', companyCode))),
                getDocs(query(collection(db, 'users'), where('companyCode', '==', companyCode))),
            ])
            setPrograms(programSnap.docs.map<ProgramRecord>((record) => {
                const data = record.data() as Record<string, unknown>
                const policy = (data.interventionPolicy || {}) as Record<string, unknown>
                return {
                    id: record.id,
                    name: String(data.name || 'Untitled program'),
                    description: String(data.description || ''),
                    type: String(data.type || ''),
                    status: (STATUS_OPTIONS.includes(data.status as ProgramStatus) ? data.status : 'Active') as ProgramStatus,
                    cohortYear: String(data.cohortYear || ''),
                    startDate: asDate(data.startDate),
                    endDate: asDate(data.endDate),
                    budget: Number(data.budget || 0),
                    maxCapacity: Number(data.maxCapacity || 0),
                    assignedAdmin: String(data.assignedAdmin || ''),
                    eligibilityCriteria: (data.eligibilityCriteria || {}) as Record<string, unknown>,
                    onboardingQuestions: Array.isArray(data.onboardingQuestions) ? data.onboardingQuestions as OnboardingQuestion[] : [],
                    interventionPolicy: {
                        mode: policy.mode === 'force_all' ? 'force_all' as const : 'sme_choice' as const,
                        forcedInterventionIds: Array.isArray(policy.forcedInterventionIds) ? policy.forcedInterventionIds.map(String) : [],
                        allowSmeSelection: policy.allowSmeSelection !== false,
                    },
                    complianceRequirements: Array.isArray(data.complianceRequirements) ? data.complianceRequirements as ComplianceRequirement[] : [],
                    agentSupportMode: normalizeAgentSupportMode(data),
                    openToExternalSmes: data.openToExternalSmes === true,
                }
            }).sort((a, b) => a.name.localeCompare(b.name)))
            setInterventions(interventionSnap.docs.map((record) => {
                const data = record.data()
                return {
                    id: record.id,
                    title: String(data.interventionTitle || record.id),
                    area: String(data.areaOfSupport || ''),
                }
            }))
            setAdmins(usersSnap.docs.flatMap((record) => {
                const data = record.data()
                const role = String(data.role || '').toLowerCase()
                if (!['projectadmin', 'projectmanager', 'operations'].includes(role)) return []
                const email = String(data.email || '').trim()
                return email ? [{ value: email, label: String(data.name || data.displayName || email) }] : []
            }))
        } catch (error) {
            console.error(error)
            message.error(t('Programs could not be loaded.'))
        } finally {
            setLoading(false)
        }
    }, [companyCode, message, t])

    useEffect(() => {
        // Data loading intentionally owns the page-level loading state.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        void load()
    }, [load])

    const metrics = useMemo(() => ({
        total: programs.length,
        active: programs.filter((program) => program.status === 'Active').length,
        capacity: programs.reduce((sum, program) => sum + program.maxCapacity, 0),
        agentic: programs.filter((program) => program.agentSupportMode === 'fully_agentic').length,
    }), [programs])

    useRegisterAgentPageContext({
        pageKey: 'operations-programs',
        pageName: 'Programs',
        purpose: 'Create programs and configure eligibility, onboarding, interventions, compliance, and agent delivery.',
        metrics,
        dataSummary: { programs: programs.length, agentSupportModes: SUPPORT_OPTIONS.map((option) => option.value) },
    })

    const resetWizard = () => {
        detailsForm.resetFields()
        eligibilityForm.resetFields()
        setEditing(undefined)
        setStep(0)
        setDetailsDraft(undefined)
        setEligibilityDraft({})
        setQuestions([])
        setSelectedEligibilityCriteria([])
        setRequirements([])
        setAssignmentMode('sme_choice')
        setSelectedInterventions([])
        setInterventionSearch('')
        setInterventionArea(undefined)
        setSupportMode('simultaneous')
    }

    const openCreate = () => {
        resetWizard()
        const defaults = { status: 'Active' as const, cohortYear: String(dayjs().year()) }
        detailsForm.setFieldsValue(defaults)
        setDetailsDraft(defaults as ProgramDetailsForm)
        setModalOpen(true)
    }

    const openEdit = (program: ProgramRecord) => {
        resetWizard()
        setEditing(program)
        const details: ProgramDetailsForm = {
            name: program.name,
            description: program.description || '',
            type: program.type,
            status: program.status,
            cohortYear: program.cohortYear || '',
            startDate: program.startDate ? dayjs(program.startDate) : undefined,
            endDate: program.endDate ? dayjs(program.endDate) : undefined,
            budget: program.budget,
            maxCapacity: program.maxCapacity,
            assignedAdmin: program.assignedAdmin || undefined,
            openToExternalSmes: program.openToExternalSmes,
        }
        detailsForm.setFieldsValue(details)
        setDetailsDraft(details)
        const eligibility = program.eligibilityCriteria as EligibilityForm
        eligibilityForm.setFieldsValue(eligibility)
        setEligibilityDraft(eligibility)
        setSelectedEligibilityCriteria(ELIGIBILITY_OPTIONS.map((option) => option.value).filter((key) => program.eligibilityCriteria?.[key] != null))
        setQuestions(program.onboardingQuestions || [])
        setRequirements(program.complianceRequirements || [])
        setAssignmentMode(program.interventionPolicy?.mode || 'sme_choice')
        setSelectedInterventions(program.interventionPolicy?.forcedInterventionIds || [])
        setSupportMode(program.agentSupportMode)
        setModalOpen(true)
    }

    const next = async () => {
        if (step === 0) setDetailsDraft(await detailsForm.validateFields())
        if (step === 1) setEligibilityDraft(await eligibilityForm.validateFields())
        if (step === 2) {
            const invalidQuestion = questions.find((question) => !question.question.trim())
            const invalidOptions = questions.find((question) => (question.type === 'single_select' || question.type === 'multi_select') && (question.options?.filter((option) => option.trim()).length || 0) < 2)
            if (invalidQuestion) return message.error(t('Every onboarding question needs question text.'))
            if (invalidOptions) return message.error(t('Dropdown questions need at least two answer options.'))
        }
        if (step === 3 && assignmentMode === 'force_all' && !selectedInterventions.length) {
            return message.error(t('Select at least one required intervention.'))
        }
        setStep((current) => Math.min(WIZARD_STEPS.length - 1, current + 1))
    }

    const back = () => {
        if (step === 1 && detailsDraft) detailsForm.setFieldsValue(detailsDraft)
        if (step === 2) eligibilityForm.setFieldsValue(eligibilityDraft)
        setStep((current) => Math.max(0, current - 1))
    }

    const saveProgram = async () => {
        try {
            const values = detailsDraft
            if (!values?.name || !values.description || !values.status || !values.cohortYear) {
                setStep(0)
                message.error(t('Program details are incomplete. Please review the first step.'))
                return
            }
            const eligibilityValues = eligibilityDraft
            const eligibilityCriteria = Object.fromEntries(
                selectedEligibilityCriteria
                    .filter((key) => eligibilityValues[key] != null)
                    .map((key) => [key, eligibilityValues[key]]),
            )
            setSaving(true)
            const savedQuestions = questions.map((question) => ({
                id: question.id,
                question: question.question.trim(),
                type: question.type,
                required: question.required,
                ...((question.type === 'single_select' || question.type === 'multi_select') ? { options: (question.options || []).map((option) => option.trim()).filter(Boolean) } : {}),
                ...(question.type === 'multi_select' && question.maxSelections ? { maxSelections: question.maxSelections } : {}),
            }))
            const invalidRequirement = requirements.find((requirement) => !requirement.name.trim())
            if (invalidRequirement) {
                message.error(t('Every compliance requirement needs a document name.'))
                return
            }
            const savedRequirements = requirements.map((requirement) => ({
                id: requirement.id,
                name: requirement.name.trim(),
                category: requirement.category,
                required: requirement.required,
            }))
            const forcedInterventions = selectedInterventions.flatMap((id) => {
                const intervention = interventions.find((item) => item.id === id)
                return intervention ? [{ id: intervention.id, title: intervention.title, area: intervention.area || '' }] : []
            })
            const payload = {
                name: values.name.trim(),
                description: values.description.trim(),
                type: values.type || null,
                status: values.status,
                cohortYear: values.cohortYear.trim(),
                assignedAdmin: values.assignedAdmin || null,
                startDate: values.startDate ? values.startDate.startOf('day').toDate() : null,
                endDate: values.endDate ? values.endDate.endOf('day').toDate() : null,
                budget: Number(values.budget || 0),
                maxCapacity: Number(values.maxCapacity || 0),
                openToExternalSmes: values.openToExternalSmes === true,
                companyCode,
                eligibilityCriteria,
                onboardingQuestions: savedQuestions,
                interventionPolicy: {
                    mode: assignmentMode,
                    sourceScope: 'company',
                    forcedInterventionIds: assignmentMode === 'force_all' ? selectedInterventions : [],
                    forcedInterventions: assignmentMode === 'force_all' ? forcedInterventions : [],
                    allowSmeSelection: assignmentMode === 'sme_choice',
                },
                complianceRequirements: savedRequirements,
                agentSupportMode: supportMode,
                updatedAt: serverTimestamp(),
            }
            if (editing) {
                await updateDoc(doc(getFirebaseDb(), 'programs', editing.id), payload)
                message.success(t('Program updated.'))
            } else {
                await addDoc(collection(getFirebaseDb(), 'programs'), { ...payload, createdAt: serverTimestamp() })
                message.success(t('Program created.'))
            }
            setModalOpen(false)
            resetWizard()
            await load()
            window.dispatchEvent(new Event('workspace-programs-changed'))
        } catch (error) {
            if (error && typeof error === 'object' && 'errorFields' in error) return
            console.error(error)
            message.error(t('The program could not be saved.'))
        } finally {
            setSaving(false)
        }
    }

    const toggleStatus = async (program: ProgramRecord, active: boolean) => {
        try {
            await updateDoc(doc(getFirebaseDb(), 'programs', program.id), { status: active ? 'Active' : 'Inactive', updatedAt: serverTimestamp() })
            setPrograms((current) => current.map((row) => row.id === program.id ? { ...row, status: active ? 'Active' : 'Inactive' } : row))
            window.dispatchEvent(new Event('workspace-programs-changed'))
        } catch {
            message.error(t('Program status could not be changed.'))
        }
    }

    const remove = async (program: ProgramRecord) => {
        try {
            await deleteDoc(doc(getFirebaseDb(), 'programs', program.id))
            setPrograms((current) => current.filter((row) => row.id !== program.id))
            window.dispatchEvent(new Event('workspace-programs-changed'))
            message.success(t('Program deleted.'))
        } catch {
            message.error(t('Program could not be deleted.'))
        }
    }

    const columns: ColumnsType<ProgramRecord> = [
        {
            title: t('Program'),
            key: 'name',
            render: (_, program) => (
                <Space direction="vertical" size={0}>
                    <Space size={6}>
                        <Typography.Text strong>{program.name}</Typography.Text>
                        {program.openToExternalSmes && <Tag color="cyan">{t('External SMEs')}</Tag>}
                    </Space>
                    <Typography.Text type="secondary">{program.cohortYear || t('No cohort')} · {program.type || t('General')}</Typography.Text>
                </Space>
            ),
        },
        { title: t('Status'), dataIndex: 'status', width: 110, render: (value: ProgramStatus) => <Tag color={statusColor(value)}>{value}</Tag> },
        { title: t('Dates'), width: 180, render: (_, program) => `${program.startDate || '—'} → ${program.endDate || '—'}` },
        { title: t('Capacity'), dataIndex: 'maxCapacity', width: 100, align: 'right' },
        { title: t('Budget'), dataIndex: 'budget', width: 150, align: 'right', render: (value: number) => formatCurrency(value) },
        {
            title: t('Agent support'),
            dataIndex: 'agentSupportMode',
            width: 170,
            render: (value: AgentSupportMode) => {
                const option = SUPPORT_OPTIONS.find((item) => item.value === value) || SUPPORT_OPTIONS[0]
                return <Tag icon={option.icon} color={value === 'fully_agentic' ? 'purple' : value === 'post_diagnostic' ? 'blue' : 'cyan'}>{option.short}</Tag>
            },
        },
        { title: t('Active'), width: 80, render: (_, program) => <Switch checked={program.status === 'Active'} onChange={(checked) => void toggleStatus(program, checked)} /> },
        {
            title: t('Actions'),
            width: 120,
            render: (_, program) => <Space><Button type="text" icon={<EditOutlined />} aria-label={`Edit ${program.name}`} onClick={() => openEdit(program)} /><Popconfirm title={t('Delete this program?')} description={t('This cannot be undone.')} onConfirm={() => void remove(program)}><Button danger className="program-delete-button" icon={<DeleteOutlined />} aria-label={`Delete ${program.name}`} /></Popconfirm></Space>,
        },
    ]

    return (
        <DashboardPage className="director-page director-programs-page program-manager-page">
            {loading && <LoadingOverlay tip={t('Loading programs')} />}
            <DashboardHeader
                title={t('Programs')}
                subtitle={tr('Create the full programme journey and choose when people, agents, or both deliver interventions.')}
                actions={<Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('New program')}</Button>}
            />

            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard icon={<ProjectOutlined />} label={t('Programs')} value={metrics.total} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard icon={<TeamOutlined />} label={t('Active')} value={metrics.active} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard icon={<TeamOutlined />} label={t('Total capacity')} value={metrics.capacity} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard icon={<RobotOutlined />} label={t('Fully agentic')} value={metrics.agentic} /></Col>
            </Row>

            <Card className="dashboard-section-card motion-card">
                {programs.length ? <Table rowKey="id" columns={columns} dataSource={programs} scroll={{ x: 1080 }} pagination={{ pageSize: 8 }} /> : <Empty description={t('No programs yet')}><Button type="primary" onClick={openCreate}>{t('Create your first program')}</Button></Empty>}
            </Card>

            <Modal
                open={modalOpen}
                title={editing ? `Edit ${editing.name}` : t('Create program')}
                width={1080}
                centered
                footer={null}
                destroyOnHidden
                onCancel={() => { setModalOpen(false); resetWizard() }}
            >
                <Steps current={step} items={WIZARD_STEPS.map((title) => ({ title }))} className="program-wizard-steps" responsive />

                <div className="program-wizard-body">
                    {step === 0 && (
                        <Form form={detailsForm} layout="vertical">
                            <Row gutter={16}>
                                <Col xs={24} md={16}><Form.Item name="name" label={t('Program name')} rules={[{ required: true, message: tr('Enter a program name.') }]}><Input placeholder={t('e.g. Growth Accelerator 2026')} /></Form.Item></Col>
                                <Col xs={24} md={8}><Form.Item name="status" label={t('Status')} rules={[{ required: true }]}><Select options={STATUS_OPTIONS.map((value) => ({ value, label: value }))} /></Form.Item></Col>
                            </Row>
                            <Form.Item name="description" label={t('Description')} rules={[{ required: true, message: tr('Describe the program.') }]}><Input.TextArea rows={3} /></Form.Item>
                            <Row gutter={16}>
                                <Col xs={24} md={8}><Form.Item name="type" label={t('Program type')}><Select allowClear showSearch placeholder={t('Select program type')} options={PROGRAM_TYPE_OPTIONS.map((value) => ({ value, label: value }))} /></Form.Item></Col>
                                <Col xs={24} md={8}><Form.Item name="cohortYear" label={t('Cohort year')} rules={[{ required: true }]}><Input /></Form.Item></Col>
                                <Col xs={24} md={8}><Form.Item name="assignedAdmin" label={t('Project admin')}><Select allowClear showSearch options={admins} placeholder={t('Select an admin')} /></Form.Item></Col>
                            </Row>
                            <Row gutter={16}>
                                <Col xs={24} md={6}><Form.Item name="startDate" label={t('Start date')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                                <Col xs={24} md={6}><Form.Item name="endDate" label={t('End date')} dependencies={['startDate']} rules={[({ getFieldValue }) => ({ validator(_, value) { const start = getFieldValue('startDate'); return !value || !start || value.isAfter(start, 'day') || value.isSame(start, 'day') ? Promise.resolve() : Promise.reject(new Error('End date must be after start date.')) } })]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                                <Col xs={24} md={6}><Form.Item name="budget" label={t('Budget (ZAR)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                                <Col xs={24} md={6}><Form.Item name="maxCapacity" label={t('Maximum capacity')}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
                            </Row>
                            <Form.Item name="openToExternalSmes" label={t('Open to external SMEs')} valuePropName="checked" tooltip={t('Lets SMEs outside this company discover and apply to this program during onboarding.')}>
                                <Switch />
                            </Form.Item>
                        </Form>
                    )}

                    {step === 1 && (
                        <Form form={eligibilityForm} layout="vertical">
                            <Typography.Title level={4}>{t('Who can join?')}</Typography.Title>
                            <Typography.Paragraph type="secondary">{t('Choose only the criteria this programme should use.')}</Typography.Paragraph>
                            <Form.Item label={t('Eligibility criteria')}>
                                <Select
                                    mode="multiple"
                                    value={selectedEligibilityCriteria}
                                    placeholder={t('Select criteria')}
                                    options={ELIGIBILITY_OPTIONS}
                                    onChange={(criteria: EligibilityCriterion[]) => {
                                        selectedEligibilityCriteria.filter((key) => !criteria.includes(key)).forEach((key) => eligibilityForm.setFieldValue(key, undefined))
                                        setSelectedEligibilityCriteria(criteria)
                                    }}
                                />
                            </Form.Item>
                            {selectedEligibilityCriteria.includes('sectors') && <Form.Item name="sectors" label={t('Eligible sectors')} rules={[{ required: true, message: tr('Select at least one sector.') }]}><Select mode="multiple" options={SECTORS.map((value) => ({ value, label: value }))} /></Form.Item>}
                            {selectedEligibilityCriteria.includes('provinces') && <Form.Item name="provinces" label={t('Eligible provinces')} rules={[{ required: true, message: tr('Select at least one province.') }]}><Select mode="multiple" options={PROVINCES.map((value) => ({ value, label: value }))} /></Form.Item>}
                            <Row gutter={16}>
                                {selectedEligibilityCriteria.includes('minAge') && <Col xs={24} md={8}><Form.Item name="minAge" label={t('Minimum owner age')} rules={[{ required: true }]}><InputNumber min={18} max={100} style={{ width: '100%' }} /></Form.Item></Col>}
                                {selectedEligibilityCriteria.includes('maxAge') && <Col xs={24} md={8}><Form.Item name="maxAge" label={t('Maximum owner age')} rules={[{ required: true }]}><InputNumber min={18} max={100} style={{ width: '100%' }} /></Form.Item></Col>}
                                {selectedEligibilityCriteria.includes('minYearsOfTrading') && <Col xs={24} md={8}><Form.Item name="minYearsOfTrading" label={t('Minimum years trading')} rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>}
                            </Row>
                        </Form>
                    )}

                    {step === 2 && (
                        <section>
                            <div className="program-wizard-heading"><div><Typography.Title level={4}>{t('Onboarding questions')}</Typography.Title><Typography.Text type="secondary">{t('Collect programme-specific information during onboarding.')}</Typography.Text></div><Button icon={<PlusOutlined />} onClick={() => setQuestions((current) => [...current, { id: makeId(), question: '', type: 'text', required: false }])}>{t('Add question')}</Button></div>
                            {!questions.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No custom questions')} />}
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {questions.map((question, index) => (
                                    <Card size="small" key={question.id} className="program-config-card">
                                        <Row gutter={[12, 12]} align="middle">
                                            <Col xs={24} md={12}><Input value={question.question} placeholder={`Question ${index + 1}`} onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, question: event.target.value } : item))} /></Col>
                                            <Col xs={16} md={7}>
                                                <Select
                                                    value={question.type}
                                                    style={{ width: '100%' }}
                                                    options={[{ value: 'text', label: t('Short text') }, { value: 'long_text', label: t('Long text') }, { value: 'number', label: t('Number') }, { value: 'yes_no', label: t('Yes / No') }, { value: 'single_select', label: t('Dropdown · one answer') }, { value: 'multi_select', label: t('Dropdown · multiple answers') }]}
                                                    onChange={(type: OnboardingQuestion['type']) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, type, options: type === 'single_select' || type === 'multi_select' ? item.options || [] : undefined, maxSelections: type === 'multi_select' ? item.maxSelections : undefined } : item))}
                                                />
                                            </Col>
                                            <Col xs={5} md={3}><Checkbox checked={question.required} onChange={(event) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, required: event.target.checked } : item))}>{t('Required')}</Checkbox></Col>
                                            <Col xs={3} md={2}><Button danger className="program-delete-button" icon={<DeleteOutlined />} aria-label={`Delete question ${index + 1}`} onClick={() => setQuestions((current) => current.filter((item) => item.id !== question.id))} /></Col>
                                            {(question.type === 'single_select' || question.type === 'multi_select') && (
                                                <Col span={24}>
                                                    <Row gutter={12}>
                                                        <Col xs={24} md={question.type === 'multi_select' ? 18 : 24}>
                                                            <Typography.Text strong>{t('Answer options')}</Typography.Text>
                                                            <Select mode="tags" value={question.options || []} tokenSeparators={[',']} placeholder={t('Type an option and press Enter')} style={{ width: '100%', marginTop: 6 }} onChange={(options) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, options } : item))} />
                                                        </Col>
                                                        {question.type === 'multi_select' && <Col xs={24} md={6}><Typography.Text strong>{t('Maximum answers')}</Typography.Text><InputNumber min={2} max={Math.max(2, question.options?.length || 2)} value={question.maxSelections} placeholder={t('No limit')} style={{ width: '100%', marginTop: 6 }} onChange={(value) => setQuestions((current) => current.map((item) => item.id === question.id ? { ...item, maxSelections: value || undefined } : item))} /></Col>}
                                                    </Row>
                                                </Col>
                                            )}
                                        </Row>
                                    </Card>
                                ))}
                            </Space>
                        </section>
                    )}

                    {step === 3 && (
                        <section>
                            <Typography.Title level={4}>{t('Intervention assignment')}</Typography.Title>
                            <Radio.Group value={assignmentMode} onChange={(event) => setAssignmentMode(event.target.value)} className="program-choice-grid">
                                <Radio.Button value="sme_choice"><strong>{t('SME chooses')}</strong><span>{t('Participants choose relevant interventions from the catalogue.')}</span></Radio.Button>
                                <Radio.Button value="force_all"><strong>{t('Program assigns')}</strong><span>{t('Every selected intervention is included in each diagnostic plan.')}</span></Radio.Button>
                            </Radio.Group>
                            {assignmentMode === 'force_all' && (
                                <div className="program-field-gap program-intervention-browser">
                                    <Typography.Title level={5}>{t('Find required interventions')}</Typography.Title>
                                    <Row gutter={[12, 12]}>
                                        <Col xs={24} md={15}>
                                            <Input prefix={<SearchOutlined />} value={interventionSearch} onChange={(event) => setInterventionSearch(event.target.value)} allowClear placeholder={t('Search intervention title or area')} />
                                        </Col>
                                        <Col xs={24} md={9}>
                                            <Select allowClear value={interventionArea} onChange={setInterventionArea} style={{ width: '100%' }} placeholder={t('Filter by Area of Support')} options={interventionAreas.map((area) => ({ value: area, label: area }))} />
                                        </Col>
                                    </Row>
                                    <Typography.Text type="secondary" className="program-intervention-count">{t('Showing')} {filteredInterventions.length} {t('of')} {interventions.length} {t('interventions')}</Typography.Text>
                                    <Typography.Text strong>{t('Required interventions')}</Typography.Text>
                                    <Select
                                        mode="multiple"
                                        showSearch
                                        optionFilterProp="label"
                                        maxTagCount="responsive"
                                        value={selectedInterventions}
                                        onChange={setSelectedInterventions}
                                        style={{ width: '100%', marginTop: 8 }}
                                        placeholder={filteredInterventions.length ? t('Select interventions') : t('No interventions match these filters')}
                                        options={visibleInterventionOptions.map((item) => ({ value: item.id, label: item.area ? `${item.title} · ${item.area}` : item.title }))}
                                    />
                                </div>
                            )}
                        </section>
                    )}

                    {step === 4 && (
                        <section>
                            <Typography.Title level={4}>{t('How should agents support this program?')}</Typography.Title>
                            <Typography.Paragraph type="secondary">{t('This choice controls who delivers interventions and which intervention pages appear in the workspace.')}</Typography.Paragraph>
                            <Radio.Group value={supportMode} onChange={(event) => setSupportMode(event.target.value)} className="agent-support-grid">
                                {SUPPORT_OPTIONS.map((option) => <Radio.Button value={option.value} key={option.value} className={supportMode === option.value ? 'is-selected' : ''}><span className="agent-support-icon">{option.icon}</span><strong>{option.title}</strong><span>{option.description}</span><small>{option.access}</small></Radio.Button>)}
                            </Radio.Group>
                        </section>
                    )}

                    {step === 5 && (
                        <section>
                            <div className="program-wizard-heading"><div><Typography.Title level={4}>{t('Compliance requirements')}</Typography.Title><Typography.Text type="secondary">{t('Documents participants must provide for this programme.')}</Typography.Text></div><Button icon={<PlusOutlined />} onClick={() => setRequirements((current) => [...current, { id: makeId(), name: '', category: 'other', required: true }])}>{t('Add document')}</Button></div>
                            {!requirements.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('No programme-specific documents')} />}
                            <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {requirements.map((requirement) => <Card size="small" key={requirement.id} className="program-config-card"><Row gutter={12} align="middle"><Col xs={24} md={12}><Input value={requirement.name} placeholder={t('Document name')} onChange={(event) => setRequirements((current) => current.map((item) => item.id === requirement.id ? { ...item, name: event.target.value } : item))} /></Col><Col xs={12} md={6}><Select value={requirement.category} style={{ width: '100%' }} options={['identity', 'legal', 'financial', 'operational', 'other'].map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }))} onChange={(category) => setRequirements((current) => current.map((item) => item.id === requirement.id ? { ...item, category } : item))} /></Col><Col xs={8} md={4}><Checkbox checked={requirement.required} onChange={(event) => setRequirements((current) => current.map((item) => item.id === requirement.id ? { ...item, required: event.target.checked } : item))}>{t('Required')}</Checkbox></Col><Col xs={4} md={2}><Button danger className="program-delete-button" icon={<DeleteOutlined />} aria-label={`Delete ${requirement.name || 'document'}`} onClick={() => setRequirements((current) => current.filter((item) => item.id !== requirement.id))} /></Col></Row></Card>)}
                            </Space>
                        </section>
                    )}
                </div>

                <div className="program-wizard-footer">
                    <Button disabled={step === 0} onClick={back}>{t('Back')}</Button>
                    {step < WIZARD_STEPS.length - 1 ? <Button type="primary" onClick={() => void next()}>{t('Next')}</Button> : <Button type="primary" loading={saving} onClick={() => void saveProgram()}>{editing ? t('Save changes') : t('Create program')}</Button>}
                </div>
            </Modal>
        </DashboardPage>
    )
}

export default ProgramsPage
