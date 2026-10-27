import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
    Switch,
    Table,
    Tag,
    Tooltip,
    Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    BankOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    FieldNumberOutlined,
    FormOutlined,
    GlobalOutlined,
    LinkOutlined,
    PauseCircleOutlined,
    PlusOutlined,
    ProjectOutlined,
    RightOutlined,
    RobotOutlined,
    SaveOutlined,
    SearchOutlined,
    TeamOutlined,
    ThunderboltOutlined,
    TrophyOutlined,
    UnlockOutlined,
    UnorderedListOutlined,
    UserAddOutlined,
} from '@ant-design/icons'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { buildProgramLink } from '@/services/programLinkService'
import dayjs, { type Dayjs } from 'dayjs'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
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
import DashboardMetricCard from '@/components/shared/DashboardMetricCard'
import DashboardPage from '@/components/shared/DashboardPage'
import { getFirebaseDb } from '@/config/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { COMPLIANCE_DOCUMENT_CATALOGUE, catalogueEntryFor } from '@/config/complianceDocuments'
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
type IntakeMode = 'application' | 'direct'

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
        maxSelections?: number | null
    }
    complianceRequirements?: ComplianceRequirement[]
    agentSupportMode: AgentSupportMode
    openToExternalSmes?: boolean
    intakeMode: IntakeMode
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
    intakeMode: IntakeMode
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

const STATUS_CARDS: Array<{ value: ProgramStatus; icon: ReactNode; hint: string }> = [
    { value: 'Active', icon: <CheckCircleOutlined />, get hint() { return tr('Running now') } },
    { value: 'Upcoming', icon: <ClockCircleOutlined />, get hint() { return tr('Not started') } },
    { value: 'Inactive', icon: <PauseCircleOutlined />, get hint() { return tr('Paused') } },
    { value: 'Completed', icon: <TrophyOutlined />, get hint() { return tr('Finished') } },
]

const AVAILABILITY_CARDS: Array<{ value: boolean; icon: ReactNode; title: string; hint: string }> = [
    { value: false, icon: <BankOutlined />, get title() { return tr('Internal to Company') }, get hint() { return tr('Only SMEs already in this workspace can join.') } },
    { value: true, icon: <GlobalOutlined />, get title() { return tr('External') }, get hint() { return tr('SMEs outside this company can discover and apply.') } },
]
// Incubation runs the full path (applications, growth plans). Training only delivers a predefined list of interventions.
const PROGRAM_TYPE_OPTIONS = ['Incubation', 'Training']
const TYPE_CARDS: Array<{ value: string; icon: ReactNode; hint: string }> = [
    { value: 'Incubation', icon: <ProjectOutlined />, get hint() { return tr('Applications, growth plans and interventions.') } },
    { value: 'Training', icon: <TeamOutlined />, get hint() { return tr('Delivers a set list of interventions only.') } },
]
const isTrainingType = (type?: string) => type === 'Training'
const INTAKE_CARDS: Array<{ value: IntakeMode; icon: ReactNode; title: string; hint: string }> = [
    { value: 'application', icon: <FormOutlined />, get title() { return tr('Application') }, get hint() { return tr('SMEs apply and your team reviews each application.') } },
    { value: 'direct', icon: <UserAddOutlined />, get title() { return tr('No application') }, get hint() { return tr('Add SMEs yourself or send the link. They fill in their details and are accepted straight away.') } },
]
/** Older programmes have no intake mode; they always took applications. */
const normalizeIntakeMode = (value: unknown): IntakeMode => value === 'direct' ? 'direct' : 'application'
/** A programme may have been saved in lowercase ("training"). Show it exactly as the cards spell it ("Training"). Older types are kept as saved. */
const normalizeProgramType = (raw: string) => {
    const value = raw.trim()
    if (!value) return ''
    const key = value.toLowerCase()
    return PROGRAM_TYPE_OPTIONS.find((option) => option.toLowerCase() === key) || value.charAt(0).toUpperCase() + value.slice(1)
}

const SECTORS = ['Agriculture', 'Technology', 'Manufacturing', 'Tourism', 'Retail', 'Services', 'Other']
const PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Limpopo', 'Mpumalanga', 'Northern Cape', 'North West', 'Free State']
// Moving on slides the next section in from the right, moving back slides it in from the left.
const SECTION_SLIDE = {
    enter: (direction: number) => ({ opacity: 0, x: direction * 36 }),
    center: { opacity: 1, x: 0 },
    exit: (direction: number) => ({ opacity: 0, x: direction * -36 }),
}
const SECTION_FADE = { enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }
const WIZARD_STEPS = ['Program details', 'Eligibility', 'Onboarding', 'Interventions', 'Agent support', 'Compliance']
const ELIGIBILITY_OPTIONS: Array<{ value: EligibilityCriterion; label: string }> = [
    { value: 'sectors', get label() { return tr('Eligible sectors') } },
    { value: 'provinces', get label() { return tr('Eligible provinces') } },
    { value: 'minAge', get label() { return tr('Minimum owner age') } },
    { value: 'maxAge', get label() { return tr('Maximum owner age') } },
    { value: 'minYearsOfTrading', get label() { return tr('Minimum years trading') } },
]
const ELIGIBILITY_ICONS: Record<EligibilityCriterion, ReactNode> = {
    sectors: <ProjectOutlined />,
    provinces: <GlobalOutlined />,
    minAge: <TeamOutlined />,
    maxAge: <TrophyOutlined />,
    minYearsOfTrading: <ClockCircleOutlined />,
}

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
    const { getSetting } = useSystemSettings()
    // A company whose team registers SMEs has no self-application, so there is no link to share.
    const programLinksEnabled = getSetting<string>('smeOnboardingModel', 'self_application') !== 'consultants_register_smes'
    const { user } = useFullIdentity()
    const [detailsForm] = Form.useForm<ProgramDetailsForm>()
    const [eligibilityForm] = Form.useForm<EligibilityForm>()
    const [programs, setPrograms] = useState<ProgramRecord[]>([])
    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [admins, setAdmins] = useState<Array<{ value: string; label: string; id: string }>>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<ProgramRecord>()
    const [step, setStep] = useState(0)
    // Editing a programme starts on a list of sections; the person opens only the one they want to change.
    const [picking, setPicking] = useState(false)
    // 1 = heading forward (next section, or opening one from the edit list), -1 = heading back.
    const [direction, setDirection] = useState<1 | -1>(1)
    const reduceMotion = useReducedMotion()
    const [detailsDraft, setDetailsDraft] = useState<ProgramDetailsForm>()
    const [eligibilityDraft, setEligibilityDraft] = useState<EligibilityForm>({})
    const [questions, setQuestions] = useState<OnboardingQuestion[]>([])
    const [selectedEligibilityCriteria, setSelectedEligibilityCriteria] = useState<EligibilityCriterion[]>([])
    const [requirements, setRequirements] = useState<ComplianceRequirement[]>([])
    const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('sme_choice')
    // When SMEs choose their own interventions, optionally cap how many they may pick.
    const [limitSelections, setLimitSelections] = useState(false)
    const [maxSelections, setMaxSelections] = useState<number | null>(3)
    const [selectedInterventions, setSelectedInterventions] = useState<string[]>([])
    // The intervention picked in the dropdown, waiting for the + button.
    const [pendingIntervention, setPendingIntervention] = useState<string>()
    const [interventionArea, setInterventionArea] = useState<string>()
    const [supportMode, setSupportMode] = useState<AgentSupportMode>('simultaneous')
    const [programSearch, setProgramSearch] = useState('')
    const [programStatus, setProgramStatus] = useState<ProgramStatus>()
    const [activityRange, setActivityRange] = useState<[Dayjs, Dayjs] | null>(null)

    const companyCode = String(user?.companyCode || '').trim()
    // Training and no-application programmes always assign a set list: SMEs never fill in an application to choose from.
    const training = isTrainingType(detailsDraft?.type)
    const setListOnly = training || normalizeIntakeMode(detailsDraft?.intakeMode) === 'direct'
    const effectiveMode: AssignmentMode = setListOnly ? 'force_all' : assignmentMode

    const interventionAreas = useMemo(() => Array.from(new Set(interventions.map((item) => item.area?.trim()).filter((area): area is string => !!area))).sort(), [interventions])
    // The dropdown offers only what is not on the list yet, narrowed by the area filter.
    const addableInterventions = useMemo(() => interventions
        .filter((item) => !selectedInterventions.includes(item.id) && (!interventionArea || item.area === interventionArea))
        .sort((a, b) => a.title.localeCompare(b.title)), [interventionArea, interventions, selectedInterventions])
    const addPendingIntervention = () => {
        if (!pendingIntervention) return
        setSelectedInterventions((current) => current.includes(pendingIntervention) ? current : [...current, pendingIntervention])
        setPendingIntervention(undefined)
    }

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
                    type: normalizeProgramType(String(data.type || '')),
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
                        maxSelections: Number(policy.maxSelections) > 0 ? Number(policy.maxSelections) : null,
                    },
                    complianceRequirements: Array.isArray(data.complianceRequirements) ? data.complianceRequirements as ComplianceRequirement[] : [],
                    agentSupportMode: normalizeAgentSupportMode(data),
                    openToExternalSmes: data.openToExternalSmes === true,
                    intakeMode: normalizeIntakeMode(data.intakeMode),
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
                return email ? [{ value: email, label: String(data.name || data.displayName || email), id: record.id }] : []
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
    const filteredPrograms = useMemo(() => {
        const search = programSearch.trim().toLowerCase()
        return programs.filter((program) => {
            const matchesSearch = !search || `${program.name} ${program.description || ''} ${program.type || ''} ${program.cohortYear || ''}`.toLowerCase().includes(search)
            const matchesStatus = !programStatus || program.status === programStatus
            if (!activityRange) return matchesSearch && matchesStatus
            const [rangeStart, rangeEnd] = activityRange
            const start = program.startDate ? dayjs(program.startDate) : null
            const end = program.endDate ? dayjs(program.endDate) : start
            const matchesActivity = !start || !end || (start.isBefore(rangeEnd, 'day') || start.isSame(rangeEnd, 'day')) && (end.isAfter(rangeStart, 'day') || end.isSame(rangeStart, 'day'))
            return matchesSearch && matchesStatus && matchesActivity
        })
    }, [activityRange, programSearch, programStatus, programs])

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
        setPicking(false)
        setDetailsDraft(undefined)
        setEligibilityDraft({})
        setQuestions([])
        setSelectedEligibilityCriteria([])
        setRequirements([])
        setAssignmentMode('sme_choice')
        setLimitSelections(false)
        setMaxSelections(3)
        setSelectedInterventions([])
        setPendingIntervention(undefined)
        setInterventionArea(undefined)
        setSupportMode('simultaneous')
    }

    const openCreate = () => {
        resetWizard()
        const defaults = { type: 'Incubation', intakeMode: 'application' as const, status: 'Active' as const, cohortYear: String(dayjs().year()), openToExternalSmes: false }
        detailsForm.setFieldsValue(defaults)
        setDetailsDraft(defaults as ProgramDetailsForm)
        setModalOpen(true)
    }

    /** The stored project admin may be an email (current) or a user id (older programmes). Returns the option value to show. */
    const matchAdmin = (stored?: string) => {
        const key = String(stored || '').trim().toLowerCase()
        if (!key) return undefined
        const match = admins.find((admin) => admin.value.toLowerCase() === key || admin.id.toLowerCase() === key)
        return match ? match.value : String(stored)
    }

    // A stored admin who is no longer in the company still needs a readable option instead of a raw id.
    const adminOptions = useMemo(() => {
        const stored = matchAdmin(editing?.assignedAdmin)
        if (!stored || admins.some((admin) => admin.value === stored)) return admins
        return [...admins, { value: stored, label: stored.includes('@') ? stored : t('Former project admin'), id: stored }]
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [admins, editing, t])

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
            assignedAdmin: matchAdmin(program.assignedAdmin),
            openToExternalSmes: program.openToExternalSmes === true,
            intakeMode: program.intakeMode,
        }
        detailsForm.setFieldsValue(details)
        setDetailsDraft(details)
        const eligibility = (program.eligibilityCriteria || {}) as EligibilityForm
        eligibilityForm.setFieldsValue(eligibility)
        setEligibilityDraft(eligibility)
        setSelectedEligibilityCriteria(ELIGIBILITY_OPTIONS.map((option) => option.value).filter((key) => program.eligibilityCriteria?.[key] != null))
        setQuestions(program.onboardingQuestions || [])
        setRequirements(program.complianceRequirements || [])
        setAssignmentMode(program.interventionPolicy?.mode || 'sme_choice')
        const savedLimit = Number(program.interventionPolicy?.maxSelections)
        setLimitSelections(savedLimit > 0)
        setMaxSelections(savedLimit > 0 ? savedLimit : 3)
        setSelectedInterventions(program.interventionPolicy?.forcedInterventionIds || [])
        setSupportMode(program.agentSupportMode)
        setPicking(true)
        setModalOpen(true)
    }

    /** Validates the section on screen. Returns the values it captured, or null after showing why it cannot continue. */
    const validateSection = async (index: number): Promise<{ details?: ProgramDetailsForm; eligibility?: EligibilityForm } | null> => {
        if (index === 0) return { details: await detailsForm.validateFields() }
        if (index === 1) return { eligibility: await eligibilityForm.validateFields() }
        if (index === 2) {
            const invalidQuestion = questions.find((question) => !question.question.trim())
            const invalidOptions = questions.find((question) => (question.type === 'single_select' || question.type === 'multi_select') && (question.options?.filter((option) => option.trim()).length || 0) < 2)
            if (invalidQuestion) { message.error(t('Every onboarding question needs question text.')); return null }
            if (invalidOptions) { message.error(t('Dropdown questions need at least two answer options.')); return null }
        }
        if (index === 3 && effectiveMode === 'sme_choice' && limitSelections && !(Number(maxSelections) >= 1)) {
            message.error(t('Enter the most interventions an SME can choose.'))
            return null
        }
        if (index === 3 && effectiveMode === 'force_all' && !selectedInterventions.length) {
            message.error(t(setListOnly ? 'Select the interventions this programme delivers.' : 'Select at least one required intervention.'))
            return null
        }
        return {}
    }

    const next = async () => {
        const captured = await validateSection(step)
        if (!captured) return
        if (captured.details) setDetailsDraft(captured.details)
        if (captured.eligibility) setEligibilityDraft(captured.eligibility)
        setDirection(1)
        setStep((current) => Math.min(WIZARD_STEPS.length - 1, current + 1))
    }

    /** Back to the section list without losing what was typed; Save changes in any section saves everything pending. */
    const leaveSection = () => {
        if (step === 0) setDetailsDraft(detailsForm.getFieldsValue() as ProgramDetailsForm)
        if (step === 1) setEligibilityDraft(eligibilityForm.getFieldsValue() as EligibilityForm)
        setDirection(-1)
        setPicking(true)
    }

    /** Editing: save just the open section. The other sections keep the values they were loaded with. */
    const saveSection = async () => {
        try {
            const captured = await validateSection(step)
            if (!captured) return
            await saveProgram(captured)
        } catch (error) {
            if (error && typeof error === 'object' && 'errorFields' in error) return
            throw error
        }
    }

    const back = () => {
        if (step === 1 && detailsDraft) detailsForm.setFieldsValue(detailsDraft)
        if (step === 2) eligibilityForm.setFieldsValue(eligibilityDraft)
        setDirection(-1)
        setStep((current) => Math.max(0, current - 1))
    }

    const saveProgram = async (captured?: { details?: ProgramDetailsForm; eligibility?: EligibilityForm }) => {
        try {
            const values = captured?.details ?? detailsDraft
            if (!values?.name || !values.description || !values.status || !values.cohortYear) {
                setStep(0)
                message.error(t('Program details are incomplete. Please review the first step.'))
                return
            }
            // Use the type being saved, which may have just changed on the details section.
            const savingSetList = isTrainingType(values.type) || normalizeIntakeMode(values.intakeMode) === 'direct'
            const mode: AssignmentMode = savingSetList ? 'force_all' : assignmentMode
            if (savingSetList && !selectedInterventions.length) {
                setDetailsDraft(values)
                setDirection(1)
                setPicking(false)
                setStep(3)
                message.error(t('Select the interventions this programme delivers.'))
                return
            }
            const eligibilityValues = captured?.eligibility ?? eligibilityDraft
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
                intakeMode: normalizeIntakeMode(values.intakeMode),
                companyCode,
                eligibilityCriteria,
                onboardingQuestions: savedQuestions,
                interventionPolicy: {
                    mode,
                    sourceScope: 'company',
                    forcedInterventionIds: mode === 'force_all' ? selectedInterventions : [],
                    forcedInterventions: mode === 'force_all' ? forcedInterventions : [],
                    allowSmeSelection: mode === 'sme_choice',
                    maxSelections: mode === 'sme_choice' && limitSelections && Number(maxSelections) >= 1 ? Number(maxSelections) : null,
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

    const sectionSummaries = [
        editing ? `${editing.name} · ${editing.status} · ${t(normalizeIntakeMode(detailsDraft?.intakeMode) === 'direct' ? 'No application' : 'Application')}` : '',
        selectedEligibilityCriteria.length ? `${selectedEligibilityCriteria.length} ${t('criteria set')}` : t('No restrictions'),
        questions.length ? `${questions.length} ${t(questions.length === 1 ? 'question' : 'questions')}` : t('No extra questions'),
        effectiveMode === 'force_all' ? `${t(setListOnly ? 'Set list' : 'Required for all')} (${selectedInterventions.length})` : limitSelections ? `${t('SMEs choose, up to')} ${maxSelections}` : t('SMEs choose their interventions'),
        (SUPPORT_OPTIONS.find((option) => option.value === supportMode) || SUPPORT_OPTIONS[0]).short,
        requirements.length ? `${requirements.length} ${t(requirements.length === 1 ? 'document' : 'documents')}` : t('All compliance documents'),
    ]

    const copyProgramLink = async (program: ProgramRecord) => {
        try {
            await navigator.clipboard.writeText(buildProgramLink(program.id))
            message.success(t('Programme link copied. SMEs who open it register straight into this programme.'))
        } catch {
            message.info(buildProgramLink(program.id))
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
                    <Typography.Text type="secondary">{program.cohortYear || t('No cohort')} · {program.type ? t(program.type) : t('General')} · {t(program.intakeMode === 'direct' ? 'No application' : 'Application')}</Typography.Text>
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
            width: 160,
            render: (_, program) => <Space>{(programLinksEnabled || program.intakeMode === 'direct') && <Tooltip title={t('Copy the link SMEs use to join this programme')}><Button type="text" icon={<LinkOutlined />} aria-label={`Copy link for ${program.name}`} onClick={() => void copyProgramLink(program)} /></Tooltip>}<Button type="text" icon={<EditOutlined />} aria-label={`Edit ${program.name}`} onClick={() => openEdit(program)} /><Popconfirm title={t('Delete this program?')} description={t('This cannot be undone.')} onConfirm={() => void remove(program)}><Button danger className="program-delete-button" icon={<DeleteOutlined />} aria-label={`Delete ${program.name}`} /></Popconfirm></Space>,
        },
    ]

    return (
        <DashboardPage className="director-page director-programs-page program-manager-page">
            <Row gutter={[12, 12]} className="dashboard-metrics-row">
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<ProjectOutlined />} label={t('Programs')} value={metrics.total} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Active')} value={metrics.active} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<TeamOutlined />} label={t('Total capacity')} value={metrics.capacity} /></Col>
                <Col xs={12} lg={6}><DashboardMetricCard loading={loading} icon={<RobotOutlined />} label={t('Fully agentic')} value={metrics.agentic} /></Col>
            </Row>

            <Card className="filter-bar program-filter-bar">
                <div className="filter-bar-primary">
                    <div className="filter-bar-controls">
                        <Input allowClear prefix={<SearchOutlined />} value={programSearch} onChange={(event) => setProgramSearch(event.target.value)} placeholder={t('Search programs')} />
                        <Select allowClear value={programStatus} onChange={setProgramStatus} placeholder={t('All statuses')} options={STATUS_OPTIONS.map((value) => ({ value, label: value }))} />
                        <DatePicker.RangePicker value={activityRange} onChange={(range) => setActivityRange(range as [Dayjs, Dayjs] | null)} format="DD MMM YYYY" />
                    </div>
                    <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t('Add program')}</Button>
                </div>
            </Card>

            <Card loading={loading} className="dashboard-section-card motion-card">
                {programs.length ? <Table rowKey="id" columns={columns} dataSource={filteredPrograms} scroll={{ x: 1080 }} pagination={{ pageSize: 8 }} locale={{ emptyText: t('No programs match these filters.') }} /> : <Empty description={t('No programs yet')}><Button type="primary" onClick={openCreate}>{t('Create your first program')}</Button></Empty>}
            </Card>

            <Modal
                open={modalOpen}
                title={editing ? (picking ? `${t('Edit')} ${editing.name}` : `${t('Edit')} ${editing.name} · ${t(WIZARD_STEPS[step])}`) : t('Create program')}
                width={editing && picking ? 640 : 1080}
                className="program-modal"
                centered
                footer={null}
                destroyOnHidden
                onCancel={() => { setModalOpen(false); resetWizard() }}
            >
                <div className="program-view-stage">
                <AnimatePresence mode="wait" initial={false} custom={direction}>
                <motion.div
                    key={editing && picking ? 'sections' : `section-${step}`}
                    custom={direction}
                    variants={reduceMotion ? SECTION_FADE : SECTION_SLIDE}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: reduceMotion ? 0.12 : 0.24, ease: [0.22, 1, 0.36, 1] }}
                >
                {editing && picking && (
                    <div className="program-section-picker" role="list">
                        <Typography.Text type="secondary">{t('Choose the part of this programme you want to change.')}</Typography.Text>
                        {WIZARD_STEPS.map((title, index) => (
                            <button key={title} type="button" role="listitem" className="program-section-option" onClick={() => { setDirection(1); setStep(index); setPicking(false) }}>
                                <span className="program-section-option-copy"><strong>{t(title)}</strong><small>{sectionSummaries[index]}</small></span>
                                <RightOutlined />
                            </button>
                        ))}
                    </div>
                )}

                {!(editing && picking) && <div className="program-wizard-body">
                    {step === 0 && (
                        <Form form={detailsForm} layout="vertical" onValuesChange={(changed: Partial<ProgramDetailsForm>) => {
                            // A new Training programme usually has no application; the team can still change it.
                            if (!editing && changed.type) detailsForm.setFieldValue('intakeMode', isTrainingType(changed.type) ? 'direct' : 'application')
                        }}>
                            <Form.Item name="name" label={t('Program name')} rules={[{ required: true, message: tr('Enter a program name.') }]}><Input placeholder={t('e.g. Growth Accelerator 2026')} /></Form.Item>
                            <Form.Item name="type" label={t('Program type')} rules={[{ required: true, message: tr('Choose a program type.') }]}>
                                <Radio.Group className="program-choice-grid is-compact program-radio-cards">
                                    {TYPE_CARDS.map((option) => (
                                        <Radio.Button value={option.value} key={option.value}>
                                            <span className="program-status-icon">{option.icon}</span>
                                            <span className="program-status-copy"><strong>{t(option.value)}</strong><small>{option.hint}</small></span>
                                        </Radio.Button>
                                    ))}
                                </Radio.Group>
                            </Form.Item>
                            {editing?.type && !PROGRAM_TYPE_OPTIONS.includes(editing.type) && <Typography.Paragraph type="secondary">{t('Saved as')} “{editing.type}”. {t('Choose Incubation or Training to update it.')}</Typography.Paragraph>}
                            <Form.Item name="intakeMode" label={t('How do SMEs join?')} rules={[{ required: true }]}>
                                <Radio.Group className="program-choice-grid is-compact program-radio-cards">
                                    {INTAKE_CARDS.map((option) => (
                                        <Radio.Button value={option.value} key={option.value}>
                                            <span className="program-status-icon">{option.icon}</span>
                                            <span className="program-status-copy"><strong>{option.title}</strong><small>{option.hint}</small></span>
                                        </Radio.Button>
                                    ))}
                                </Radio.Group>
                            </Form.Item>
                            <Form.Item name="status" label={t('Status')} rules={[{ required: true }]}>
                                <Radio.Group className="program-status-grid program-radio-cards">
                                    {STATUS_CARDS.map((option) => (
                                        <Radio.Button value={option.value} key={option.value}>
                                            <span className="program-status-icon">{option.icon}</span>
                                            <span className="program-status-copy"><strong>{option.value}</strong><small>{option.hint}</small></span>
                                        </Radio.Button>
                                    ))}
                                </Radio.Group>
                            </Form.Item>
                            <Form.Item name="description" label={t('Description')} rules={[{ required: true, message: tr('Describe the program.') }]}><Input.TextArea rows={2} /></Form.Item>
                            <Row gutter={16}>
                                <Col xs={24} md={12}><Form.Item name="cohortYear" label={t('Cohort year')} rules={[{ required: true }]}><Input /></Form.Item></Col>
                                <Col xs={24} md={12}><Form.Item name="assignedAdmin" label={t('Project admin')}><Select allowClear showSearch optionFilterProp="label" options={adminOptions} placeholder={t('Select an admin')} /></Form.Item></Col>
                            </Row>
                            <Row gutter={16}>
                                <Col xs={24} md={6}><Form.Item name="startDate" label={t('Start date')}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                                <Col xs={24} md={6}><Form.Item name="endDate" label={t('End date')} dependencies={['startDate']} rules={[({ getFieldValue }) => ({ validator(_, value) { const start = getFieldValue('startDate'); return !value || !start || value.isAfter(start, 'day') || value.isSame(start, 'day') ? Promise.resolve() : Promise.reject(new Error('End date must be after start date.')) } })]}><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
                                <Col xs={24} md={6}><Form.Item name="budget" label={t('Budget (ZAR)')}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item></Col>
                                <Col xs={24} md={6}><Form.Item name="maxCapacity" label={t('Maximum capacity')}><InputNumber min={1} style={{ width: '100%' }} /></Form.Item></Col>
                            </Row>
                            <Form.Item name="openToExternalSmes" label={t('Who can join this program?')}>
                                <Radio.Group className="program-choice-grid is-compact program-radio-cards">
                                    {AVAILABILITY_CARDS.map((option) => (
                                        <Radio.Button value={option.value} key={option.title}>
                                            <span className="program-status-icon">{option.icon}</span>
                                            <span className="program-status-copy"><strong>{option.title}</strong><small>{option.hint}</small></span>
                                        </Radio.Button>
                                    ))}
                                </Radio.Group>
                            </Form.Item>
                        </Form>
                    )}

                    {step === 1 && (
                        <Form form={eligibilityForm} layout="vertical">
                            <Typography.Text strong>{t('Eligibility criteria')}</Typography.Text>
                            <div className="program-eligibility-grid">
                                {ELIGIBILITY_OPTIONS.map(({ value, label }) => {
                                    const selected = selectedEligibilityCriteria.includes(value)
                                    return <button type="button" key={value} className={`program-eligibility-card${selected ? ' is-selected' : ''}`} aria-pressed={selected} onClick={() => setSelectedEligibilityCriteria((current) => {
                                        if (current.includes(value)) {
                                            eligibilityForm.setFieldValue(value, undefined)
                                            return current.filter((item) => item !== value)
                                        }
                                        return [...current, value]
                                    })}>{ELIGIBILITY_ICONS[value]}<span>{label}</span></button>
                                })}
                            </div>
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
                        <section className="program-assignment-stage">
                            <Typography.Title level={4}>{t(training ? 'Training interventions' : setListOnly ? 'Programme interventions' : 'Intervention assignment')}</Typography.Title>
                            {setListOnly && <Typography.Paragraph type="secondary">{t(training
                                ? 'Training programmes deliver a set list of interventions. Every participant receives all of them.'
                                : 'SMEs join this programme without an application, so it delivers a set list. Every participant receives all of them, and their growth plan is confirmed automatically.')}</Typography.Paragraph>}
                            {!setListOnly && <div className={`program-assignment-slot${assignmentMode === 'force_all' ? ' is-expanded' : ''}`}>
                                <Radio.Group value={assignmentMode} onChange={(event) => setAssignmentMode(event.target.value)} className="program-choice-grid program-radio-cards">
                                    <Radio.Button value="sme_choice"><strong>{t('SME chooses')}</strong><span>{t('Participants choose relevant interventions from the catalogue.')}</span></Radio.Button>
                                    <Radio.Button value="force_all"><strong>{t('Program assigns')}</strong><span>{t('Every selected intervention is included in each diagnostic plan.')}</span></Radio.Button>
                                </Radio.Group>

                                {assignmentMode === 'sme_choice' && (
                                    <div className="program-limit-block">
                                        <Typography.Text strong>{t('Limit how many interventions an SME can choose?')}</Typography.Text>
                                        <Radio.Group value={limitSelections ? 'yes' : 'no'} onChange={(event) => setLimitSelections(event.target.value === 'yes')} className="program-choice-grid is-compact program-radio-cards">
                                            <Radio.Button value="no"><span className="program-status-icon"><UnlockOutlined /></span><span className="program-status-copy"><strong>{t('No')}</strong><small>{t('SMEs can pick as many as they need')}</small></span></Radio.Button>
                                            <Radio.Button value="yes"><span className="program-status-icon"><FieldNumberOutlined /></span><span className="program-status-copy"><strong>{t('Yes')}</strong><small>{t('Set a maximum for each SME')}</small></span></Radio.Button>
                                        </Radio.Group>
                                        {limitSelections && (
                                            <div className="program-limit-input">
                                                <Typography.Text>{t('Maximum interventions per SME')}</Typography.Text>
                                                <InputNumber min={1} max={100} precision={0} value={maxSelections} onChange={(value) => setMaxSelections(value)} />
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>}
                            {effectiveMode === 'force_all' && (
                                <div className={`program-intervention-browser${setListOnly ? '' : ' program-field-gap'}`}>
                                    <Typography.Title level={5}>{t(setListOnly ? 'Find interventions to deliver' : 'Find required interventions')}</Typography.Title>
                                    <div className="program-intervention-picker">
                                        <Select allowClear value={interventionArea} onChange={setInterventionArea} className="program-intervention-area" placeholder={t('All areas of support')} options={interventionAreas.map((area) => ({ value: area, label: area }))} />
                                        <Select
                                            showSearch
                                            allowClear
                                            optionFilterProp="label"
                                            value={pendingIntervention}
                                            onChange={setPendingIntervention}
                                            className="program-intervention-select"
                                            placeholder={addableInterventions.length ? t('Choose an intervention') : t('No more interventions to add')}
                                            notFoundContent={t('No interventions match')}
                                            options={addableInterventions.map((item) => ({ value: item.id, label: item.area ? `${item.title} · ${item.area}` : item.title }))}
                                        />
                                        <Tooltip title={t('Add intervention')}>
                                            <Button type="primary" shape="circle" icon={<PlusOutlined />} disabled={!pendingIntervention} aria-label={t('Add intervention')} onClick={addPendingIntervention} />
                                        </Tooltip>
                                    </div>
                                    <Typography.Text strong className="program-intervention-list-label">{t(setListOnly ? 'Interventions delivered' : 'Required interventions')} ({selectedInterventions.length})</Typography.Text>
                                    {selectedInterventions.length ? (
                                        <ol className="program-intervention-list">
                                            {selectedInterventions.map((id) => {
                                                const item = interventions.find((intervention) => intervention.id === id)
                                                return (
                                                    <li key={id}>
                                                        <span className="program-intervention-list-copy">
                                                            <strong>{item?.title || t('Intervention no longer in the catalogue')}</strong>
                                                            {item?.area && <small>{item.area}</small>}
                                                        </span>
                                                        <Button danger type="text" icon={<DeleteOutlined />} aria-label={`${t('Remove')} ${item?.title || id}`} onClick={() => setSelectedInterventions((current) => current.filter((value) => value !== id))} />
                                                    </li>
                                                )
                                            })}
                                        </ol>
                                    ) : <Typography.Paragraph type="secondary" className="program-intervention-empty">{t('No interventions added yet. Choose one above and press +.')}</Typography.Paragraph>}
                                </div>
                            )}
                        </section>
                    )}

                    {step === 4 && (
                        <section>
                            <Typography.Title level={4}>{t('How should agents support this program?')}</Typography.Title>
                            <Typography.Paragraph type="secondary">{t('This choice controls who delivers interventions and which intervention pages appear in the workspace.')}</Typography.Paragraph>
                            <Radio.Group value={supportMode} onChange={(event) => setSupportMode(event.target.value)} className="agent-support-grid program-radio-cards">
                                {SUPPORT_OPTIONS.map((option) => <Radio.Button value={option.value} key={option.value} className={supportMode === option.value ? 'is-selected' : ''}><span className="agent-support-icon">{option.icon}</span><strong>{option.title}</strong><span>{option.description}</span><small>{option.access}</small></Radio.Button>)}
                            </Radio.Group>
                        </section>
                    )}

                    {step === 5 && (
                        <section>
                            <div className="program-wizard-heading"><div><Typography.Title level={4}>{t('Compliance requirements')}</Typography.Title><Typography.Text type="secondary">{t('Choose which documents participants in this programme must provide. Leave everything unticked to ask for all of them.')}</Typography.Text></div></div>
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                {COMPLIANCE_DOCUMENT_CATALOGUE.map((entry) => {
                                    const selected = requirements.find((item) => catalogueEntryFor(item.name)?.key === entry.key)
                                    return (
                                        <Card size="small" key={entry.key} className={`program-config-card program-document-option${selected ? ' is-selected' : ''}`}>
                                            <Row gutter={12} align="middle" wrap={false}>
                                                <Col flex="auto">
                                                    <Checkbox
                                                        checked={Boolean(selected)}
                                                        onChange={(event) => setRequirements((current) => event.target.checked
                                                            ? [...current, { id: entry.key, name: entry.name, category: entry.category, required: true }]
                                                            : current.filter((item) => catalogueEntryFor(item.name)?.key !== entry.key))}
                                                    >
                                                        <Typography.Text strong>{t(entry.name)}</Typography.Text>
                                                    </Checkbox>
                                                    <Tag className="program-document-category">{t(entry.category[0].toUpperCase() + entry.category.slice(1))}</Tag>
                                                </Col>
                                                <Col flex="none">
                                                    <Switch
                                                        size="small"
                                                        disabled={!selected}
                                                        checked={selected ? selected.required : true}
                                                        checkedChildren={t('Required')}
                                                        unCheckedChildren={t('Optional')}
                                                        onChange={(required) => setRequirements((current) => current.map((item) => catalogueEntryFor(item.name)?.key === entry.key ? { ...item, required } : item))}
                                                    />
                                                </Col>
                                            </Row>
                                        </Card>
                                    )
                                })}
                                {/* Documents typed in before the catalogue existed: kept, but can only be removed. */}
                                {requirements.filter((item) => !catalogueEntryFor(item.name)).map((requirement) => (
                                    <Card size="small" key={requirement.id} className="program-config-card">
                                        <Row gutter={12} align="middle" wrap={false}>
                                            <Col flex="auto"><Typography.Text>{requirement.name || t('Untitled document')}</Typography.Text> <Tag>{t('Custom')}</Tag></Col>
                                            <Col flex="none"><Button danger className="program-delete-button" icon={<DeleteOutlined />} aria-label={`Delete ${requirement.name || 'document'}`} onClick={() => setRequirements((current) => current.filter((item) => item.id !== requirement.id))} /></Col>
                                        </Row>
                                    </Card>
                                ))}
                            </Space>
                        </section>
                    )}
                </div>}
                </motion.div>
                </AnimatePresence>
                </div>

                {editing && !picking && (
                    <div className="program-wizard-footer">
                        <Button icon={<UnorderedListOutlined />} disabled={saving} onClick={() => leaveSection()}>{t('Back to sections')}</Button>
                        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void saveSection()}>{t('Save changes')}</Button>
                    </div>
                )}

                {!editing && (
                    <div className="program-wizard-footer">
                        <Button icon={<ArrowLeftOutlined />} disabled={step === 0} onClick={back}>{t('Back')}</Button>
                        {step < WIZARD_STEPS.length - 1 ? <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={() => void next()}>{t('Next')}</Button> : <Button type="primary" icon={<CheckOutlined />} loading={saving} onClick={() => void saveProgram()}>{t('Create program')}</Button>}
                    </div>
                )}
            </Modal>
        </DashboardPage>
    )
}

export default ProgramsPage
