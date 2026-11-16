import {
    Avatar,
    Button,
    App,
    Cascader,
    Dropdown,
    Grid,
    Layout,
    Modal,
    Segmented,
    Select,
    Space,
    Tag,
    Typography,
} from 'antd'
import {
    CompassOutlined,
    DownOutlined,
    GlobalOutlined,
    LogoutOutlined,
    MenuOutlined,
    LockOutlined,
    MoonOutlined,
    RobotOutlined,
    ApartmentOutlined,
    AppstoreOutlined,
    ArrowLeftOutlined,
    FolderOpenOutlined,
    ArrowRightOutlined,
    IdcardOutlined,
    SunOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useFitSteps } from '@/hooks/useFitSteps'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { appRoutes } from '@/config/routes'
import { hasRolePermission } from '@/config/permissions'
import { tr, useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { USER_ROLES, type UserRole } from '@/config/roles'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import type { AppRoute } from '@/types/routes'
import type { FullIdentity, IdentityPermission, WorkspaceAudience } from '@/types/identity'
import { logoutUser } from '@/services/authService'
import { profilePathForUser } from '@/services/companiesService'
import { getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import ResponsiveModal from '@/components/shared/ResponsiveModal'
import { AgentFab } from '@/components/agent/AgentFab'
import { GuideMe } from '@/components/guide/GuideMe'
import { PageGuideProvider } from '@/components/guide/PageGuideContext'
import { AgenticHomePage } from '@/pages/agentic/AgenticHomePage'
import { TrainingAgenticHome } from '@/pages/training/TrainingAgenticHome'
import { CLIENT_MODULES, clientHomeModuleFor, enabledClientModuleSettings } from '@/config/clientModules'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { NotificationBell } from '@/components/notifications/NotificationBell'
import FunderLinkRequestsPopup from '@/components/funders/FunderLinkRequestsPopup'
import FunderOrgAccountActions from '@/components/funders/FunderOrgAccountActions'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useEntitlements } from '@/hooks/useEntitlements'
import { SystemLayoutTopbarContext, type SystemLayoutPageChrome } from '@/contexts/SystemLayoutTopbarContext'
import { WorkspaceShellProvider } from '@/contexts/WorkspaceShellContext'
import { ALL_PROGRAMS, setActiveProgramId, useActiveProgramId } from '@/hooks/useActiveProgramId'
import { ALL_COMPANIES, setActiveCompanyCode, useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'
import { setActiveImplementor, useActiveImplementor } from '@/hooks/useActiveImplementor'
import { ALL_IMPLEMENTORS, isOrgFunder, loadDataScope, type ScopeEntry } from '@/services/funderScopeService'
import { isTrainingProgram, listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import { listCoursesForParticipant } from '@/services/courseProgressService'
import { canAccessPlatformOwnerRoute, isPlatformAdmin, listWorkspaceCompanies, type WorkspaceCompany } from '@/services/companiesService'
import { journeyAllows, journeyAllowsAgentic, marketplaceConsultantAllows } from '@/utils/routeAccess'
import { hasOwnInterventionDocuments } from '@/services/interventionDocumentsService'
import { useAssignedInterventions } from '@/contexts/AssignedInterventionsContext'
import { listMyApplications } from '@/services/applicantService'
import { ProgramResumeBanner } from '@/components/applicant/ProgramResumeBanner'
import '@/styles/system-layout.css'
// Page fade-in and skeleton styles; the full LoadingOverlay is only used for this first load now.
import '@/styles/page-loading.css'
import { workspaceDashboardPath } from '@/utils/workspacePath'
import { applySignInPreference, getSignInPreference, type SignInPreference } from '@/services/signInPreference'

const { Content } = Layout
const { useBreakpoint } = Grid


const isPathMatch = (base: string, path: string) => {
    if (base === '/') return path === '/'
    return path === base || path.startsWith(`${base}/`)
}

const findSelectedRouteKey = (routes: AppRoute[], pathname: string): string | undefined => {
    let bestKey: string | undefined
    let bestLength = -1

    const walk = (items: AppRoute[]) => {
        for (const item of items) {
            if (item.children?.length) {
                walk(item.children)
            }

            if (isPathMatch(item.path, pathname)) {
                const length = item.path.length

                if (length > bestLength) {
                    bestLength = length
                    bestKey = item.path
                }
            }
        }
    }

    walk(routes)

    return bestKey
}

const OVERVIEW_SECTION_KEY = '__overview__'
/** sessionStorage key for the Agentic / Workspace choice, so a refresh keeps the tab where it was. */
const SHELL_MODE_STORAGE_KEY = 'smart-incubation:shell-mode'

const NAVIGATION_DESCRIPTIONS: Record<string, string> = {
    '/dashboard': 'See the platform-wide snapshot, priority activity, and key performance signals.',
    '/incubatee': 'Track your business journey, support activity, and next actions in one place.',
    '/incubatee/metrics': 'Review your business performance measures and growth progress.',
    '/incubatee/diagnostic-plan': 'Review your diagnostic findings and the priorities agreed for your business.',
    '/incubatee/interventions': 'Follow the support interventions assigned to your business and their progress.',
    '/incubatee/documents': 'Store and access business documents, evidence, and shared resources.',
    '/incubatee/compliance': 'Keep required business information and compliance evidence up to date.',
    '/consultant': 'Your work today, what’s coming up, and how you’re doing.',
    '/consultant/profile': 'What SMEs see when they look for a consultant.',
    '/consultant/requests': 'SMEs who found you in the marketplace. Reply, send a plan, or decline.',
    '/consultant/smes': 'The SMEs you support and the work for each one.',
    '/consultant/interventions': 'Accept new work, update progress and upload your evidence.',
    '/consultant/feedback': 'What SMEs said about your work.',
    '/consultant/reports': 'Your work, results and ratings over time.',
    '/projectadmin': 'See programme performance, delivery activity, and current operational priorities.',
    '/projectadmin/reports': 'Review programme reporting, evidence, and performance summaries.',
    '/projectadmin/esg': 'Track ESG commitments, indicators, and programme scorecard results.',
    '/operations': 'Monitor delivery work, activity queues, and operational priorities.',
    '/operations/programs': 'Create and maintain your programmes.',
    '/operations/tasks': 'Plan, assign, and follow up on operational work across the active programme.',
    '/shared/staff/tasks': 'Plan, assign, and follow up on operational work across the active programme.',
    '/shared/staff/manage': 'Manage staff records, roles, and team capacity.',
    '/shared/applications': 'Review incoming applications and decide who moves into the programme.',
    '/operations/participants/diagnostic-plans': 'Review diagnostic plans and the business priorities they identify.',
    '/operations/gap-analysis': 'Set up gap analyses, review SME responses and turn the gaps found into diagnostic plan interventions.',
    '/shared/participants': 'Manage all participating businesses and their programme records.',
    '/operations/participants/metrics': 'Compare participant performance measures and growth trends.',
    '/operations/participants/compliance': 'Review participant compliance, evidence, and outstanding requirements.',
    '/operations/connection-requests': 'Manage SME and consultant connection requests.',
    '/operations/risk-register': 'Record, assess, and follow up on operational and programme risks.',
    '/operations/impact-analysis': 'Analyse the programme outcomes and impact generated across participants.',
    '/operations/interventions/assign': 'Match support interventions to SMEs and assign the right delivery resource.',
    '/operations/interventions/assigned': 'Track intervention delivery and the work currently assigned to your team.',
    '/operations/interventions/monitoring': 'Monitor intervention progress, evidence, and delivery risks.',
    '/shared/interventions/appointments': 'Schedule intervention appointments and capture their outcomes.',
    '/shared/interventions/setup': 'Configure the intervention catalogue, outcomes, and delivery rules.',
    '/operations/reports': 'Review operational delivery, programme progress, and performance reports.',
    '/director': 'See the executive overview of delivery, performance, and strategic priorities.',
    '/director/programs': 'Compare programme performance and identify areas needing attention.',
    '/director/portfolio': 'Review the portfolio of businesses, programmes, and their results.',
    '/director/sectors': 'Understand performance across the sectors served by the organisation.',
    '/director/structure': 'Review organisational structure, departments, and branch coverage.',
    '/director/settings': 'Maintain your organisation-wide settings.',
    '/director/reports': 'Access executive reports and performance summaries.',
    '/admin/users': 'Manage user access, roles, and workspace permissions.',
    '/admin/consultant-verification': 'Review consultant verification requests and professional credentials.',
    '/admin/usage': 'Monitor platform usage, adoption, and activity trends.',
    '/admin/email-operations': 'Manage operational email activity and communication history.',
    '/admin/company-change-requests': 'Review and action company settings change requests.',
    '/admin/agent-ratings': 'Review ratings and feedback for AI-assisted support.',
    '/admin/sales-pitch': 'Play the evidence-based sales pitch for Smart Incubation.',
}

const navigationDescription = (route: AppRoute, label: string) => {
    const description = NAVIGATION_DESCRIPTIONS[route.path]
    return description ? tr(description) : tr('Review and manage {label}.', undefined, { label: label.toLowerCase() })
}

/** Everything a Training SME's menu holds: their programme only delivers a set list, so no plans, metrics or tracker. */
const TRAINING_SME_PATHS = new Set(['/incubatee', '/incubatee/roadmap', '/incubatee/lms', '/incubatee/compliance', '/incubatee/appointments'])
const TRAINING_SME_QUICK_LINK_PATHS = ['/incubatee/roadmap', '/incubatee/lms', '/incubatee/appointments', '/incubatee/compliance']

/** A topbar shortcut that opens a small menu of related pages instead of one page. */
/** `label` (English text) overrides the route's own name, so a shortcut can read shorter than its Menu entry. */
type QuickLinkPageSpec = string | { path: string, label: string }
type QuickLinkGroupSpec = { group: string, label?: string, children: QuickLinkPageSpec[] }
const INCUBATEES_QUICK_GROUP: QuickLinkGroupSpec = {
    group: '/operations/participants',
    label: 'Incubatees',
    children: [{ path: '/shared/participants', label: 'All' }, '/shared/applications', '/operations/participants/compliance'],
}
const INTERVENTIONS_QUICK_GROUP: QuickLinkGroupSpec = {
    group: '/operations/interventions',
    children: ['/operations/interventions/assign', '/operations/interventions/monitoring', '/shared/interventions/setup'],
}

/** The 3 highest-value pages per role, surfaced as one-click topbar shortcuts. */
const QUICK_LINK_PATHS: Partial<Record<UserRole, Array<string | QuickLinkGroupSpec>>> = {
    [USER_ROLES.INCUBATEE]: ['/incubatee/interventions', '/incubatee/diagnostic-plan', '/incubatee/compliance'],
    [USER_ROLES.CONSULTANT]: ['/consultant/interventions', '/shared/interventions/appointments', '/consultant/reports'],
    [USER_ROLES.PROJECT_ADMIN]: ['/shared/applications', '/operations/risk-register', '/projectadmin/reports'],
    [USER_ROLES.PROJECT_MANAGER]: ['/shared/applications', '/operations/risk-register', '/operations/reports'],
    [USER_ROLES.OPERATIONS]: [INCUBATEES_QUICK_GROUP, INTERVENTIONS_QUICK_GROUP, '/operations/reports'],
    [USER_ROLES.DIRECTOR]: ['/director/portfolio', '/director/programs', '/director/reports'],
    [USER_ROLES.FUNDER]: ['/funder/portfolio', '/funder/sectors', '/funder/analytics'],
    [USER_ROLES.ADMIN]: ['/shared/applications', '/shared/interventions/appointments', '/shared/participants'],
    [USER_ROLES.SYSTEM_ADMIN]: ['/admin/users', '/admin/usage', '/admin/agent-registry'],
    // A training company's client company: all of its pages (phones show the first three).
    [USER_ROLES.CLIENT_ORG]: ['/company/certificates', '/company/assessments', '/company/documents', '/company/business', '/company/esg'],
}
// Home is Programmes; the profile lives under My profile. Marketplace shows only for independent SMEs (the route's own rules).
const APPLICANT_QUICK_LINK_PATHS = ['/applicant/marketplace', '/applicant/application-tracker', '/applicant/roadmap']

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
    [USER_ROLES.INCUBATEE]: 'SME',
    [USER_ROLES.CONSULTANT]: 'Consultant',
    [USER_ROLES.PROJECT_ADMIN]: 'Project Admin',
    [USER_ROLES.PROJECT_MANAGER]: 'Project Manager',
    [USER_ROLES.OPERATIONS]: 'Operations',
    [USER_ROLES.DIRECTOR]: 'Director',
    [USER_ROLES.ADMIN]: 'Admin',
    [USER_ROLES.SYSTEM_ADMIN]: 'System Admin',
    [USER_ROLES.FUNDER]: 'Funder',
    [USER_ROLES.LEARNER]: 'Learner',
    [USER_ROLES.CLIENT_ORG]: 'Client company',
}

const flattenRoutes = (routes: AppRoute[]): AppRoute[] =>
    routes.flatMap((route) => [route, ...(route.children?.length ? flattenRoutes(route.children) : [])])

/** `children` makes it a dropdown; `path` is then only its key, never a page to open. */
type QuickLink = { path: string, label: string, icon: AppRoute['icon'], children?: QuickLink[] }

const filterRoutesByAudience = (
    routes: AppRoute[],
    audience: WorkspaceAudience,
    role?: UserRole,
    permissions?: IdentityPermission[],
    user?: FullIdentity | null,
): AppRoute[] => {
    return routes.flatMap((route) => {
        const children = route.children
            ? filterRoutesByAudience(route.children, audience, role, permissions, user)
            : undefined
        const isVisible = (!route.audiences || route.audiences.includes(audience))
            && (!role || route.allowedRoles.includes(role))
            && (!route.requiredPermission || (!!role && hasRolePermission(role, route.requiredPermission, permissions)))
            && (!route.platformOwnerOnly || canAccessPlatformOwnerRoute(user))
            && journeyAllows(route, user)
            && marketplaceConsultantAllows(route, user)

        if (!isVisible && !children?.length) return []

        return [{ ...route, children }]
    })
}

export const SystemLayout = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.lg
    // Tablets keep the phone layout but have room for the mode switch and Menu in the top bar instead of a bottom bar.
    const isTablet = isMobile && !!screens.md

    const { t, language, setLanguage } = useLanguage()
    const { mode, toggleTheme } = useThemeMode()
    const { user, loading: identityLoading } = useFullIdentity()
    const { settings, ready: settingsReady } = useSystemSettings()
    const entitlements = useEntitlements()
    const { message } = App.useApp()

    const [navigationOpen, setNavigationOpen] = useState(false)
    // Desktop: the More dropdown beside the page links (the full page menu stays for tablets and phones).
    const [moreOpen, setMoreOpen] = useState(false)
    const [navigationSection, setNavigationSection] = useState('')
    const { activeProgramId } = useActiveProgramId()
    const { activeCompanyCode } = useActiveCompanyCode()
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    const [programsVersion, setProgramsVersion] = useState(0)
    // A funder organisation's member can fund programmes at several implementors: a second dropdown picks one.
    const orgFunder = isOrgFunder(user)
    const { activeImplementor } = useActiveImplementor()
    const [implementors, setImplementors] = useState<ScopeEntry[]>([])
    // An accepted SME whose programmes are all Training gets the small workspace (see TRAINING_SME_PATHS).
    const isTrainingSme = user?.role === 'incubatee' && !user.isApplicant && programs.length > 0 && programs.every(isTrainingProgram)
    // Courses join a Training SME's menu once at least one is set up for them.
    const [hasCourses, setHasCourses] = useState(false)
    useEffect(() => {
        if (!isTrainingSme || !user || !isFirebaseConfigured) return
        let cancelled = false
        listCoursesForParticipant(user)
            .then((rows) => { if (!cancelled) setHasCourses(rows.length > 0) })
            .catch(() => undefined)
        return () => { cancelled = true }
    }, [isTrainingSme, user])
    const [companies, setCompanies] = useState<WorkspaceCompany[]>([])
    const [companyLogoUrl, setCompanyLogoUrl] = useState('')
    /**
     * The shell opens on the agentic home, which covers whatever route the URL names. A URL
     * carrying parameters (`/incubatee?demo=1`, a filtered report link) is a deliberate deep
     * link, so open the page itself instead of hiding it behind the agentic home.
     * The chosen mode is kept for the tab, so a refresh returns to the page that was open
     * rather than dropping back to the agentic home.
     */
    const [requestedShellMode, setShellMode] = useState<'agentic' | 'workspace'>(() => {
        if (location.search) return 'workspace'
        try {
            const saved = window.sessionStorage.getItem(SHELL_MODE_STORAGE_KEY)
            if (saved === 'agentic' || saved === 'workspace') return saved
        } catch { /* storage blocked: fall back to the default */ }
        return 'agentic'
    })
    useEffect(() => {
        try { window.sessionStorage.setItem(SHELL_MODE_STORAGE_KEY, requestedShellMode) } catch { /* storage blocked */ }
    }, [requestedShellMode])
    // Without the agentic support plan feature there is no Agentic home: the workspace is the only mode.
    // ...and programme applicants keep to their programme until they are accepted.
    // Until the company's settings load the plan is unknown, so Agentic waits rather than showing and then vanishing
    // for plans without it.
    // A company whose staff home is a client module (Client modules page) opens it instead of the standard dashboard;
    // its funder opens the module's read-only funder report.
    const clientHome = clientHomeModuleFor(settings, user?.role)
    const clientModule = clientHome ? CLIENT_MODULES[clientHome] : null
    const isClientFunder = Boolean(clientModule) && user?.role === USER_ROLES.FUNDER
    const homePath = clientModule
        ? (isClientFunder ? clientModule.funderHomePath || clientModule.homePath : clientModule.homePath)
        : workspaceDashboardPath(user)
    // The funder of a client-module company has only its report, so no Agentic home.
    // Client company accounts of a training company see only their own company's page: no assistant (it would be
    // given workspace data beyond their company) and no Agentic home.
    const showAssistant = user?.role !== USER_ROLES.CLIENT_ORG
    const agenticAllowed = settingsReady && entitlements.has('agenticSupport') && journeyAllowsAgentic(user) && !isClientFunder && showAssistant
    const agenticPending = !settingsReady && requestedShellMode === 'agentic'
    const shellMode: 'agentic' | 'workspace' = agenticAllowed ? requestedShellMode : 'workspace'
    // Awareness training companies get an Agentic home about their classes, for their staff and their learners.
    const trainingAgenticHome = settings[CLIENT_MODULES.awarenessTraining.setting] === true
        && (user?.role === USER_ROLES.LEARNER || (clientHome === 'awarenessTraining' && !isClientFunder))

    useEffect(() => {
        if (!clientHome || !user || location.pathname !== workspaceDashboardPath(user)) return
        navigate(homePath, { replace: true })
    }, [clientHome, homePath, location.pathname, navigate, user])
    // Phones split the shell in two: identity on top, the controls people tap on the bottom bar,
    // and everything set-and-forget behind the account panel.
    const [accountOpen, setAccountOpen] = useState(false)
    const [rememberChoice, setRememberChoice] = useState<SignInPreference>(getSignInPreference)
    const [guideOpen, setGuideOpen] = useState(false)
    const [pageChrome, setPageChrome] = useState<SystemLayoutPageChrome>({
        showBackButton: false,
        hideSidebar: false,
        hideChrome: false,
    })
    const showCompanySelector = isPlatformAdmin(user)
    const isSmeWorkspace = user?.role === 'incubatee'

    // Independent SMEs only see the documents library once they have something in it.
    const checkDocuments = user?.role === 'incubatee' && user.isApplicant && user.smeJourney === 'independent'
    const [hasOwnDocuments, setHasOwnDocuments] = useState(false)
    useEffect(() => {
        if (!checkDocuments || !user || !isFirebaseConfigured) return
        let cancelled = false
        hasOwnInterventionDocuments(user)
            .then((found) => { if (!cancelled) setHasOwnDocuments(found) })
            .catch(() => undefined)
        return () => { cancelled = true }
    }, [checkDocuments, user])

    // Independent SMEs (no programme) only see the application tracker once they've applied to one.
    const [hasApplications, setHasApplications] = useState(false)
    useEffect(() => {
        if (!checkDocuments || !user || !isFirebaseConfigured) return
        let cancelled = false
        listMyApplications(user.uid)
            .then((rows) => { if (!cancelled) setHasApplications(rows.length > 0) })
            .catch(() => undefined)
        return () => { cancelled = true }
    }, [checkDocuments, user])
    const meetsApplicationsRule = (route: AppRoute) => (!route.showInNavWhenHasApplications || !checkDocuments || hasApplications)
        // And Programmes stays out of their menu until they ask to see programmes.
        && (!route.programmesOptIn || !checkDocuments || !!user?.showProgrammes)

    useEffect(() => {
        const refreshPrograms = () => setProgramsVersion((version) => version + 1)
        window.addEventListener('workspace-programs-changed', refreshPrograms)
        return () => window.removeEventListener('workspace-programs-changed', refreshPrograms)
    }, [])

    useEffect(() => {
        let cancelled = false

        const loadPrograms = async () => {
            if (!isFirebaseConfigured || showCompanySelector) {
                setPrograms([])
                return
            }

            try {
                const rows = await listWorkspacePrograms(user)
                if (cancelled) return
                setPrograms(rows)

                // The single-programme tag must represent the actual scope used by pages.
                if (rows.length === 1 && activeProgramId !== rows[0].id) {
                    setActiveProgramId(rows[0].id)
                } else if (activeProgramId !== ALL_PROGRAMS && !rows.some((program) => program.id === activeProgramId)) {
                    setActiveProgramId(ALL_PROGRAMS)
                }
            } catch {
                if (!cancelled) setPrograms([])
            }
        }

        void loadPrograms()

        return () => {
            cancelled = true
        }
    }, [activeProgramId, programsVersion, showCompanySelector, user])

    useEffect(() => {
        if (!orgFunder) return
        let cancelled = false
        loadDataScope(user)
            .then((scope) => {
                if (cancelled) return
                setImplementors(scope)
                // A choice that no longer applies (a link ended) falls back to every implementor.
                if (activeImplementor !== ALL_IMPLEMENTORS && !scope.some((entry) => entry.companyCode === activeImplementor)) setActiveImplementor(ALL_IMPLEMENTORS)
            })
            .catch(() => { if (!cancelled) setImplementors([]) })
        return () => { cancelled = true }
    }, [activeImplementor, orgFunder, user])

    useEffect(() => {
        let cancelled = false

        const loadCompanies = async () => {
            if (!isFirebaseConfigured || !showCompanySelector) {
                setCompanies([])
                return
            }

            try {
                const rows = await listWorkspaceCompanies(user)
                if (cancelled) return
                setCompanies(rows)

                if (activeCompanyCode !== ALL_COMPANIES && !rows.some((company) => company.code === activeCompanyCode)) {
                    setActiveCompanyCode(ALL_COMPANIES)
                }
            } catch {
                if (!cancelled) setCompanies([])
            }
        }

        void loadCompanies()

        return () => {
            cancelled = true
        }
    }, [activeCompanyCode, showCompanySelector, user])

    useEffect(() => {
        let cancelled = false

        const loadCompanyLogo = async () => {
            const companyCode = String(user?.companyCode || '').trim()
            if (!isFirebaseConfigured || !companyCode) {
                setCompanyLogoUrl('')
                return
            }

            try {
                const snapshot = await getDoc(doc(getFirebaseDb(), 'companies', companyCode))
                if (cancelled) return
                const logoUrl = String(snapshot.exists() ? snapshot.data()?.logoUrl || '' : '').trim()
                setCompanyLogoUrl(logoUrl)
            } catch {
                if (!cancelled) setCompanyLogoUrl('')
            }
        }

        void loadCompanyLogo()

        return () => {
            cancelled = true
        }
    }, [user?.companyCode])

    const audience = useMemo<WorkspaceAudience>(() => {
        if (user?.role === 'incubatee') return user.isApplicant ? 'applicant' : 'incubatee'
        if (user?.role === 'operations' || user?.role === 'projectadmin' || user?.role === 'consultant' || user?.role === 'admin') return 'operations'
        if (user?.role === 'learner') return 'learner'
        if (user?.role === 'clientorg') return 'clientorg'
        return 'platform'
    }, [user])

    const selectedProgram = useMemo(
        () => programs.find((program) => program.id === activeProgramId),
        [activeProgramId, programs],
    )
    const agentSupportMode = selectedProgram?.agentSupportMode || 'simultaneous'
    const hideHumanDelivery = Boolean(selectedProgram && agentSupportMode !== 'simultaneous')
    const interventionDeliveryRoles = Array.isArray(settings.interventionDeliveryRoles)
        ? settings.interventionDeliveryRoles.map((role) => String(role).toLowerCase())
        : ['consultant', 'projectadmin', 'operations']
    const currentRoleCanDeliver = !user?.role || interventionDeliveryRoles.includes(user.role)
    // Operations staff mostly assign rather than deliver, so "Assigned to me" only joins their menu once
    // something is actually assigned to them. Hidden while loading, so it never shows and then vanishes.
    // The page itself stays reachable by its address.
    const { assignments: companyAssignments, isMine } = useAssignedInterventions()
    const hasOwnAssignments = useMemo(() => companyAssignments.some(isMine), [companyAssignments, isMine])
    const visibleRoutes = useMemo(() => {
        const routes = filterRoutesByAudience(appRoutes, audience, user?.role, user?.permissions, user)
        const clientModuleSettings = enabledClientModuleSettings(settings)

        const applyAgentDeliveryAccess = (items: typeof routes): typeof routes =>
            items.flatMap((route) => {
                const isPersonalDeliveryPage = route.path === '/operations/interventions/assigned'
                    || route.path === '/consultant/interventions'
                    || route.path === '/consultant/allocated'
                    || (route.path === '/shared/interventions/appointments' && user?.role === USER_ROLES.CONSULTANT)
                if (!currentRoleCanDeliver && isPersonalDeliveryPage) return []
                const isHumanDeliveryPage = route.path === '/operations/interventions/assigned'
                if (hideHumanDelivery && isHumanDeliveryPage) return []
                if (hideHumanDelivery && agentSupportMode === 'fully_agentic' && route.path === '/shared/interventions/appointments' && user?.role !== USER_ROLES.CONSULTANT) return []
                if (hideHumanDelivery && agentSupportMode === 'fully_agentic' && route.path.startsWith('/operations/interventions/') &&!['/operations/interventions/monitoring', '/operations/interventions/assign'].includes(route.path)) return []
                if (route.trainingSmesOnly && !isTrainingSme) return []
                // Client modules exist only for the company they are switched on for.
                if (route.requiredSetting && settings[route.requiredSetting] !== true) return []
                const children = route.children ? applyAgentDeliveryAccess(route.children as typeof routes) : undefined
                // Training SMEs: other pages stay reachable from links (the dashboard's tiles) but leave the menu.
                const trainingHides = isTrainingSme && (!TRAINING_SME_PATHS.has(route.path) || (route.path === '/incubatee/lms' && !hasCourses))
                // A company whose home is a client module keeps only that module and the pages it still uses.
                const clientHides = Boolean(clientModule)
                    && !(route.requiredSetting && clientModuleSettings.has(route.requiredSetting))
                    && !clientModule?.keepPaths.includes(route.path)
                const nothingAssignedHides = route.path === '/operations/interventions/assigned' && !hasOwnAssignments
                return [{ ...route, children, ...(trainingHides || clientHides || nothingAssignedHides ? { showInNav: false } : {}) }]
            })

        return applyAgentDeliveryAccess(routes)
    }, [agentSupportMode, audience, clientModule, currentRoleCanDeliver, hasCourses, hasOwnAssignments, hideHumanDelivery, isTrainingSme, settings, user])
    const selectedKey = useMemo(() => {
        return findSelectedRouteKey(visibleRoutes, location.pathname) || '/'
    }, [location.pathname, visibleRoutes])
    const baseQuickLinks = useMemo(() => {
        const byPath = new Map(flattenRoutes(visibleRoutes).map((route) => [route.path, route]))
        const homeRoute = byPath.get(homePath)
        // With Agentic in the plan, Agentic is where people land, so the role's home page is named for what it is.
        const home: QuickLink[] = homeRoute ? [{ path: homeRoute.path, label: agenticAllowed ? t('Dashboard') : t('Home'), icon: homeRoute.icon }] : []

        const candidatePaths = clientModule
            ? clientModule.quickLinkPaths
            : isTrainingSme
            ? TRAINING_SME_QUICK_LINK_PATHS.filter((path) => path !== '/incubatee/lms' || hasCourses)
            : user?.role === 'incubatee' && user.isApplicant
                ? APPLICANT_QUICK_LINK_PATHS
                : (user?.role && QUICK_LINK_PATHS[user.role]) || []
        const toLink = (spec: QuickLinkPageSpec): QuickLink | null => {
            const path = typeof spec === 'string' ? spec : spec.path
            const route = byPath.get(path)
            if (!route || path === homePath || !meetsApplicationsRule(route)) return null
            return { path: route.path, label: typeof spec === 'string' ? t(route.labelKey) : t(spec.label), icon: route.icon }
        }
        const rest = candidatePaths
            .map((entry): QuickLink | null => {
                if (typeof entry === 'string') return toLink(entry)
                // Only the pages this person can open; a single survivor is just a plain shortcut.
                const children = entry.children.map(toLink).filter((link): link is QuickLink => Boolean(link))
                const groupRoute = byPath.get(entry.group)
                if (!groupRoute || children.length === 0) return null
                if (children.length === 1) return children[0]
                return { path: entry.group, label: entry.label ? t(entry.label) : t(groupRoute.labelKey), icon: groupRoute.icon, children }
            })
            .filter((link): link is QuickLink => Boolean(link))
            // A client module's top bar may hold all its links; the phone tab bar keeps to three (the rest stay in the Menu).
            .slice(0, clientModule && !isMobile ? clientModule.quickLinkPaths.length : user?.role === USER_ROLES.CLIENT_ORG && !isMobile ? 5 : 3)

        return [...home, ...rest]
    }, [t, user, visibleRoutes, hasApplications, checkDocuments, isTrainingSme, hasCourses, homePath, clientModule, isMobile, agenticAllowed]) // eslint-disable-line react-hooks/exhaustive-deps
    /** Section › Page trail for the topbar, so orientation survives the navigation modal closing. */
    const currentLocationLabel = useMemo(() => {
        const trail: string[] = []
        const walk = (items: AppRoute[], ancestors: string[]): boolean => {
            for (const item of items) {
                const labels = [...ancestors, t(item.labelKey)]
                if (item.path === selectedKey) {
                    trail.push(...labels)
                    return true
                }
                if (item.children?.length && walk(item.children, labels)) return true
            }
            return false
        }
        walk(visibleRoutes, [])
        return trail.join(' › ')
    }, [selectedKey, t, visibleRoutes])

    /**
     * Sections become tabs, so only real groups earn one. Standalone top-level pages are collected
     * into a single leading section instead of each getting a tab that opens onto one lonely card.
     */
    const menuSections = useMemo(() => {
        const meetsSettingRule = (route: AppRoute) => (!route.showInNavWhenAnySetting?.length
            || route.showInNavWhenAnySetting.some((settingKey) => !!settings[settingKey]))
            && Object.entries(route.showInNavWhenSettingEquals || {}).every(([settingKey, value]) => settings[settingKey] === value)
            && (!route.showInNavWhenHasDocuments || hasOwnDocuments)
            && meetsApplicationsRule(route)

        // Pages already one tap away (the desktop quick-link switch, the phone tab bar) are left out of the
        // Menu. Tablets have neither, so they keep every page there.
        const pinned = new Set(isTablet ? [] : baseQuickLinks.flatMap((link) => link.children ? link.children.map((child) => child.path) : [link.path]))
        const isListed = (route: AppRoute) => route.showInNav && meetsSettingRule(route) && !pinned.has(route.path)

        const navRoutes = visibleRoutes.filter((route) => isListed(route) || (route.children?.length && route.showInNav && meetsSettingRule(route)))
        const standalone = navRoutes.filter((route) => !route.children?.length && isListed(route))
        const groups = navRoutes
            .filter((route) => route.children?.length)
            .map((route) => ({
                key: route.path,
                label: t(route.labelKey),
                items: (route.children ?? []).filter(isListed),
            }))
            .filter((section) => section.items.length > 0)

        return [
            ...(standalone.length ? [{ key: OVERVIEW_SECTION_KEY, label: t('nav.overview', 'Overview'), items: standalone }] : []),
            ...groups,
        ]
    }, [hasOwnDocuments, hasApplications, isTablet, baseQuickLinks, settings, t, visibleRoutes]) // eslint-disable-line react-hooks/exhaustive-deps
    // A Menu holding a single page (a Training SME's Compliance, say) is one tap too many: that page joins the
    // quick links instead and the Menu goes. Tablets have no quick links, so they keep their Menu.
    const loneMenuRoute = useMemo(() => {
        const items = menuSections.flatMap((section) => section.items)
        return !isTablet && items.length === 1 ? items[0] : null
    }, [isTablet, menuSections])
    const quickLinkRoutes = useMemo<QuickLink[]>(() => loneMenuRoute
        ? [...baseQuickLinks, { path: loneMenuRoute.path, label: t(loneMenuRoute.labelKey), icon: loneMenuRoute.icon }]
        : baseQuickLinks, [baseQuickLinks, loneMenuRoute, t])
    const navigationSections = useMemo(() => (loneMenuRoute ? [] : menuSections), [loneMenuRoute, menuSections])
    // With every page already in the top bar there's nothing left to open, so the Menu button goes too.
    const hasMenuItems = navigationSections.some((section) => section.items.length > 0)

    const showTopbarBackButton = shellMode === 'workspace' && pageChrome.showBackButton
    const isChromelessMobile = isMobile && pageChrome.hideChrome
    // Phones: the bottom bar only holds Menu now, and only in Workspace.
    const hasPhoneBottomBar = isMobile && !isTablet && !pageChrome.hideChrome && shellMode === 'workspace'

    const companySelector = (
        <Select
            value={activeCompanyCode}
            onChange={setActiveCompanyCode}
            id="guide-scope-selector"
            className="app-project-select app-company-select"
            popupMatchSelectWidth={false}
            showSearch
            optionFilterProp="label"
            prefix={<ApartmentOutlined className="app-scope-icon" />}
            options={[{ code: ALL_COMPANIES, name: t('All companies') }, ...companies].map((company) => ({
                value: company.code,
                label: company.name,
            }))}
        />
    )

    // For a funder organisation with an implementor chosen, only that implementor's programmes.
    const visiblePrograms = orgFunder && activeImplementor !== ALL_IMPLEMENTORS
        ? programs.filter((program) => program.companyCode === activeImplementor)
        : programs

    // A single programme has nothing to choose between, so show it as a plain tag instead of a dropdown with "All programmes".
    const singleProgramTag = visiblePrograms.length === 1
        ? <Tag className="app-project-tag" title={visiblePrograms[0].name} icon={<FolderOpenOutlined className="app-scope-icon" />}><span className="app-scope-name">{visiblePrograms[0].name}</span></Tag>
        : null

    // A funder organisation working across several implementors gets one implementor-and-programme picker (below).
    const pickImplementor = orgFunder && implementors.length > 1

    // Learners, client companies and the funders of a training company have no programmes to pick between.
    const hasNoProgrammes = user?.role === USER_ROLES.LEARNER || user?.role === USER_ROLES.CLIENT_ORG || isClientFunder
    const programmeSelector = showCompanySelector ? companySelector : isSmeWorkspace || hasNoProgrammes ? null : singleProgramTag ?? (
        <Select
            value={activeProgramId}
            onChange={setActiveProgramId}
            id="guide-scope-selector"
            className="app-project-select"
            popupMatchSelectWidth={false}
            prefix={<FolderOpenOutlined className="app-scope-icon" />}
            options={[{ id: ALL_PROGRAMS, name: t('shell.allPrograms') }, ...visiblePrograms].map((project) => ({
                value: project.id,
                label: project.name,
            }))}
        />
    )
    // A funder organisation picks an implementor and a programme from one control: implementors first, then that
    // implementor's programmes. Two dropdowns side by side pushed the page names out of the top bar.
    const implementorValue = implementors.some((entry) => entry.companyCode === activeImplementor) ? activeImplementor : ALL_IMPLEMENTORS
    const programmesOf = (companyCode: string) => (companyCode === ALL_IMPLEMENTORS ? programs : programs.filter((program) => program.companyCode === companyCode))
    const scopeOptions = [{ value: ALL_IMPLEMENTORS, label: t('All implementors') }, ...implementors.map((entry) => ({ value: entry.companyCode, label: entry.companyName || entry.companyCode }))]
        .map((option) => ({
            ...option,
            children: [{ value: ALL_PROGRAMS, label: t('shell.allPrograms') }, ...programmesOf(option.value).map((program) => ({ value: program.id, label: program.name }))],
        }))
    const programmeValue = programmesOf(implementorValue).some((program) => program.id === activeProgramId) ? activeProgramId : ALL_PROGRAMS
    const chooseScope = (path: Array<string | number>) => {
        const [implementor = ALL_IMPLEMENTORS, programme = ALL_PROGRAMS] = path.map(String)
        setActiveImplementor(implementor)
        setActiveProgramId(programme)
    }
    const scopeSelector = pickImplementor && programmeSelector ? (
        <Cascader
            className="app-project-select app-scope-cascader"
            value={[implementorValue, programmeValue]}
            options={scopeOptions}
            onChange={(path) => path && chooseScope(path)}
            changeOnSelect
            allowClear={false}
            expandTrigger="hover"
            aria-label={t('Implementor and programme')}
            prefix={<ApartmentOutlined className="app-scope-icon" />}
            displayRender={(labels) => labels.join(' · ')}
        />
    ) : null
    const projectSelector = scopeSelector ?? programmeSelector

    // Your uploaded profile photo on the account button, or the person icon when there is none.
    const profilePhoto = user?.profileImageUrl || null
    const accountIcon = profilePhoto ? <Avatar src={profilePhoto} size={30} className="app-topbar-avatar" alt="" /> : <UserOutlined />

    const handleTopbarBack = () => {
        const historyState = window.history.state as { idx?: number } | null

        if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
            navigate(-1)
            return
        }

        navigate('/', { replace: true })
    }

    const handleShellModeChange = (value: 'agentic' | 'workspace') => {
        setShellMode(value)
        // The current URL already names a page, so reveal it with its query string intact.
        // Resetting to the role dashboard here is what used to drop parameters such as ?demo=1.
        if (value === 'workspace' && location.pathname === '/') navigate(homePath)
    }

    const modeSwitch = !agenticAllowed ? null : (
        <Segmented
            id="guide-mode-switch"
            className="app-mode-switch"
            value={shellMode}
            onChange={(value) => handleShellModeChange(value as 'agentic' | 'workspace')}
            options={[
                { value: 'agentic', label: <span className="app-topbar-text">{t('Agentic')}</span>, title: t('Agentic'), icon: <RobotOutlined /> },
                { value: 'workspace', label: <span className="app-topbar-text">{t('Workspace')}</span>, title: t('Workspace'), icon: <AppstoreOutlined /> },
            ]}
        />
    )

    const openWorkspace = (path: string) => {
        setShellMode('workspace')
        setNavigationOpen(false)
        navigate(path)
    }

    const isQuickLinkActive = (link: QuickLink) => link.children
        ? link.children.some((child) => child.path === selectedKey)
        : link.path === selectedKey
    const quickLinkMenu = (link: QuickLink) => ({
        selectable: true,
        selectedKeys: [selectedKey],
        items: (link.children ?? []).map((child) => ({ key: child.path, label: child.label, icon: child.icon })),
        onClick: ({ key }: { key: string }) => openWorkspace(key),
    })
    // Desktop navigation: plain text links that stay text. Agentic comes first and is where people land; then the
    // role's dashboard and shortcuts; then More for every other page. Being in Agentic is just being on its link,
    // so there is no separate Agentic / Workspace switch.
    const textNavLink = (key: string, label: ReactNode, active: boolean, onClick?: () => void, extra?: ReactNode) => (
        <button key={key} type="button" className={`app-textnav-link${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>
            {label}{extra}
        </button>
    )
    // More: every page that isn't a link in the bar, as a dropdown with a line of description each (the same
    // descriptions the page menu uses), grouped under their sections' names when there is more than one section.
    const moreItems = navigationSections.flatMap((section) => section.items)
    const moreMenu = (
        <div className={`app-more-menu${moreItems.length > 5 ? ' is-wide' : ''}`} role="menu">
            {navigationSections.filter((section) => section.items.length).map((section) => (
                <div key={section.key} className="app-more-section">
                    {navigationSections.length > 1 && <div className="app-more-heading">{section.label}</div>}
                    <div className="app-more-items">
                        {section.items.map((route) => {
                            const label = t(route.labelKey)
                            const isCurrent = shellMode === 'workspace' && route.path === selectedKey
                            return (
                                <button
                                    key={route.path}
                                    type="button"
                                    role="menuitem"
                                    className={`app-more-item${isCurrent ? ' is-current' : ''}`}
                                    onClick={() => { setMoreOpen(false); openWorkspace(route.path) }}
                                >
                                    <span className="app-more-icon">{route.icon || <AppstoreOutlined />}</span>
                                    <span className="app-more-copy"><strong>{label}</strong><span>{navigationDescription(route, label)}</span></span>
                                </button>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )

    const textNav = (
        <nav className="app-textnav" aria-label={t('Main navigation')}>
            {agenticAllowed && textNavLink('agentic', t('Agentic'), shellMode === 'agentic', () => handleShellModeChange('agentic'))}
            {/* Agentic is its own space; a thin rule sets it apart from the pages that follow. */}
            {agenticAllowed && quickLinkRoutes.length > 0 && <span className="app-textnav-divider" aria-hidden="true" />}
            {quickLinkRoutes.map((link) => {
                const active = shellMode === 'workspace' && isQuickLinkActive(link)
                return link.children ? (
                    <Dropdown key={link.path} menu={quickLinkMenu(link)} trigger={['hover', 'click']} placement="bottomLeft">
                        {textNavLink(link.path, link.label, active, undefined, <DownOutlined className="app-quicklink-caret" />)}
                    </Dropdown>
                ) : textNavLink(link.path, link.label, active, () => openWorkspace(link.path))
            })}
            {hasMenuItems && (
                <Dropdown
                    open={moreOpen}
                    onOpenChange={setMoreOpen}
                    trigger={['click']}
                    placement="bottomLeft"
                    popupRender={() => moreMenu}
                >
                    {textNavLink('more', t('More'), moreOpen || navigationSections.some((section) => section.items.some((route) => route.path === selectedKey && shellMode === 'workspace')), undefined, <DownOutlined className="app-quicklink-caret" />)}
                </Dropdown>
            )}
        </nav>
    )

    // The bar never wraps, and labels run longer in some languages. When it overflows, things give way in
    // steps so the bell and account button stay on screen. Page names go last, because they are how people find
    // their way: first the programme narrows, then it shows only its icon (its name stays as a tooltip), then the
    // links tighten their spacing. Tablets still use the mode switch and icon shortcuts, which keep their steps.
    const topbarRef = useRef<HTMLElement>(null)
    useFitSteps(topbarRef, isTablet ? [
        'modes',
        'modes modesall',
        'modes modesall narrow',
        'modes modesall narrow scope',
        'modes modesall narrow scope links',
        'modes modesall narrow scope links all',
    ] : ['narrow', 'narrow scope', 'narrow scope tight'])

    const handleLogout = async () => {
        try {
            await logoutUser()
            // The next sign-in opens on the agentic home again, not the last session's mode.
            try { window.sessionStorage.removeItem(SHELL_MODE_STORAGE_KEY) } catch { /* storage blocked */ }
            setNavigationOpen(false)
            navigate('/auth', { replace: true })
        } catch {
            message.error(t('You could not be logged out. Please try again.'))
        }
    }

    if (isFirebaseConfigured && identityLoading) return <LoadingOverlay tip={t('Loading workspace')} />
    if (isFirebaseConfigured && !user) return <Navigate to="/auth" replace />
    if (isFirebaseConfigured && user && !user.emailVerified) return <Navigate to="/email-verification" replace />

    const activeNavigationSection = navigationSections.find((section) => section.key === navigationSection) || navigationSections[0]
    // A single section needs no tab strip; show its cards directly.
    const navigationIsGrouped = navigationSections.length > 1
    const navigationCards = navigationIsGrouped
        ? activeNavigationSection?.items || []
        : navigationSections.flatMap((section) => section.items)
    // One stacked list: reads top to bottom, never leaves an odd card alone on the last row, and keeps
    // the same width whichever section is open. Long sections scroll inside the modal.
    const navigationColumns = 1
    const navigationWidth = 600
    const navigationOrphans = 0
    // Agentic mode has no page to name, so the brand stays primary there.
    const showLocationCrumb = shellMode === 'workspace' && Boolean(currentLocationLabel)

    return (
        <PageGuideProvider>
            <WorkspaceShellProvider value={openWorkspace}>
                <SystemLayoutTopbarContext.Provider value={setPageChrome}>
                    <Layout className="app-shell">
                        <Layout className={`app-main${isMobile && !isTablet && !hasPhoneBottomBar ? ' has-no-bottom-bar' : ''}`}>
                            {!isChromelessMobile && (
                            <header
                                ref={topbarRef}
                                id="guide-app-topbar"
                                className={`app-topbar-pill${isMobile && !isTablet && projectSelector ? ' has-phone-scope' : ''}${!isMobile ? ' has-textnav' : ''}`}
                                style={{
                                    left: isMobile ? 10 : 12,
                                }}
                            >
                                <div className="app-topbar-left">
                                    {shellMode === 'workspace' && showTopbarBackButton && (
                                        <Button
                                            type="text"
                                            shape="circle"
                                            icon={<ArrowLeftOutlined />}
                                            onClick={handleTopbarBack}
                                            className="app-icon-btn"
                                            aria-label={t('Go back')}
                                        />
                                    )}

                                    {isTablet ? (
                                        <div className="app-topbar-tablet-nav">
                                            {modeSwitch}

                                            {shellMode === 'workspace' && hasMenuItems && (
                                                <Button
                                                    icon={<MenuOutlined />}
                                                    onClick={() => setNavigationOpen(true)}
                                                    className="app-menu-button"
                                                    aria-label={t('Menu')}
                                                />
                                            )}
                                        </div>
                                    ) : isMobile && shellMode === 'agentic' ? (
                                        // Phones have no mode switch: this is the way out of Agentic.
                                        <Button
                                            className="app-goto-workspace"
                                            onClick={() => handleShellModeChange('workspace')}
                                        >
                                            {t('Go to Workspace')}
                                            <ArrowRightOutlined />
                                        </Button>
                                    ) : isMobile && !projectSelector ? (
                                        // Phones with a programme or implementor picker give it the room instead of naming the page.
                                        <div className="app-brand-lockup">
                                            <span className="app-brand-copy">
                                                <strong id="guide-app-name" className="app-page-title app-page-tag" title={showLocationCrumb ? currentLocationLabel : undefined}>{showLocationCrumb ? currentLocationLabel : t('Smart Incubation')}</strong>
                                            </span>
                                        </div>
                                    ) : isMobile ? null : textNav}
                                </div>

                                {isTablet && <div className="app-topbar-center">{projectSelector}</div>}

                                {/* Phones: the programme sits in the top bar too, between the page name and the actions. */}
                                {isMobile && !isTablet && projectSelector && <div className="app-topbar-center app-topbar-scope">{projectSelector}</div>}

                                {isMobile ? (
                                    <Space size={6} className="app-topbar-actions is-mobile-pills">
                                        <GuideMe
                                            mode={shellMode}
                                            role={user?.role}
                                            pageName={shellMode === 'agentic' ? 'Agentic workspace' : selectedKey === '/' ? 'Workspace dashboard' : selectedKey.replace(/^\//, '').replaceAll('/', ' › ')}
                                            hideTrigger
                                            open={guideOpen}
                                            onOpenChange={setGuideOpen}
                                        />

                                        {shellMode === 'workspace' && showAssistant && <AgentFab placement="topbar" />}

                                        <NotificationBell />

                                        {/* Log out lives in the account panel on phones too. */}
                                        <Button
                                            type="text"
                                            icon={accountIcon}
                                            onClick={() => setAccountOpen(true)}
                                            className="app-icon-btn"
                                            aria-label={t('Account and settings')}
                                        />
                                    </Space>
                                ) : (
                                    <Space size={8} className="app-topbar-actions">
                                        {projectSelector}

                                        <GuideMe
                                            mode={shellMode}
                                            role={user?.role}
                                            pageName={shellMode === 'agentic' ? 'Agentic workspace' : selectedKey === '/' ? 'Workspace dashboard' : selectedKey.replace(/^\//, '').replaceAll('/', ' › ')}
                                        />

                                        <NotificationBell />

                                        {shellMode === 'workspace' && showAssistant && <AgentFab placement="topbar" />}

                                        <Button
                                            type="text"
                                            shape="circle"
                                            icon={accountIcon}
                                            onClick={() => setAccountOpen(true)}
                                            className="app-icon-btn"
                                            aria-label={t('Account and settings')}
                                        />
                                    </Space>
                                )}
                            </header>
                            )}

                            <Content
                                id="guide-page-content"
                                className={`app-content ${shellMode === 'agentic' ? 'is-agentic' : ''} ${isChromelessMobile ? 'is-chromeless' : ''}`}
                                style={{
                                    marginLeft: 0,
                                }}
                            >
                                <ProgramResumeBanner />
                                {/* Funder organisations: programme link requests waiting, once per sign-in. */}
                                <FunderLinkRequestsPopup user={user} />
                                {agenticPending ? <PageSkeleton /> : shellMode === 'agentic' ? (trainingAgenticHome ? <TrainingAgenticHome /> : <AgenticHomePage />) : <Outlet key={location.pathname} />}
                            </Content>

                            {hasPhoneBottomBar && (() => {
                                // Tab bar: Home + the role's shortcuts + Menu. The current tab grows into a
                                // labelled pill; Menu is current when the open page isn't one of the tabs.
                                const onShortcut = quickLinkRoutes.some(isQuickLinkActive)
                                return (
                                    <nav className="app-bottom-bar app-tab-bar" aria-label={t('Primary')}>
                                        {quickLinkRoutes.map((link) => {
                                            const active = isQuickLinkActive(link)
                                            if (link.children) return (
                                                <Dropdown key={link.path} menu={quickLinkMenu(link)} trigger={['click']} placement="top">
                                                    <button
                                                        type="button"
                                                        className={`app-tab${active ? ' is-active' : ''}`}
                                                        aria-current={active ? 'page' : undefined}
                                                        aria-label={link.label}
                                                        aria-haspopup="menu"
                                                    >
                                                        <span className="app-tab-icon">{link.icon || <AppstoreOutlined />}</span>
                                                        <span className="app-tab-label">{link.label}</span>
                                                    </button>
                                                </Dropdown>
                                            )
                                            return (
                                                <button
                                                    key={link.path}
                                                    type="button"
                                                    className={`app-tab${active ? ' is-active' : ''}`}
                                                    aria-current={active ? 'page' : undefined}
                                                    aria-label={link.label}
                                                    onClick={() => openWorkspace(link.path)}
                                                >
                                                    <span className="app-tab-icon">{link.icon || <AppstoreOutlined />}</span>
                                                    <span className="app-tab-label">{link.label}</span>
                                                </button>
                                            )
                                        })}
                                        {hasMenuItems ? (
                                            <button
                                                type="button"
                                                className={`app-tab${!onShortcut ? ' is-active' : ''}`}
                                                aria-label={t('Menu')}
                                                onClick={() => setNavigationOpen(true)}
                                            >
                                                <span className="app-tab-icon"><MenuOutlined /></span>
                                                <span className="app-tab-label">{t('Menu')}</span>
                                            </button>
                                        ) : agenticAllowed && (
                                            // No Menu (every page is a tab), and Menu holds the phone's way back to Agentic: offer it here.
                                            <button
                                                type="button"
                                                className="app-tab"
                                                aria-label={t('Agentic')}
                                                onClick={() => handleShellModeChange('agentic')}
                                            >
                                                <span className="app-tab-icon"><RobotOutlined /></span>
                                                <span className="app-tab-label">{t('Agentic')}</span>
                                            </button>
                                        )}
                                    </nav>
                                )
                            })()}
                        </Layout>
                    </Layout>

                    <Modal
                        open={accountOpen}
                        title={
                            <div className="app-account-modal-title">
                                <span className="app-account-avatar">
                                    {user?.profileImageUrl
                                        ? <img src={user.profileImageUrl} alt={t('Profile')} />
                                        : companyLogoUrl ? <img className="is-logo" src={companyLogoUrl} alt={t('Company logo')} /> : <UserOutlined />}
                                </span>
                                <span className="app-account-title-copy">
                                    <strong>{user?.displayName || user?.name || t('Account')}</strong>
                                    {user?.role && <span className="app-account-role">{ROLE_LABELS[user.role] ? t(ROLE_LABELS[user.role]!) : user.role}</span>}
                                </span>
                            </div>
                        }
                        footer={null}
                        width={420}
                        onCancel={() => setAccountOpen(false)}
                        className="app-account-modal"
                    >
                        <div className="app-account-section">
                            <div className="app-account-row">
                                <span className="app-account-row-label"><GlobalOutlined /> {t('Language')}</span>
                                <Segmented
                                    value={language}
                                    onChange={(value) => setLanguage(value as LanguageCode)}
                                    options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))}
                                />
                            </div>

                            <div className="app-account-row">
                                <span className="app-account-row-label">{mode === 'dark' ? <MoonOutlined /> : <SunOutlined />} {t('Appearance')}</span>
                                {/* Same compact control as Language, showing the current choice rather than the other one. */}
                                <Segmented
                                    value={mode}
                                    onChange={(value) => { if (value !== mode) toggleTheme() }}
                                    options={[
                                        { value: 'light', label: t('common.lightMode', 'Light'), icon: <SunOutlined /> },
                                        { value: 'dark', label: t('common.darkMode', 'Dark'), icon: <MoonOutlined /> },
                                    ]}
                                />
                            </div>

                            {/* How this device remembers the sign-in (the same choice as on the sign-in form). */}
                            <div className="app-account-row">
                                <span className="app-account-row-label"><LockOutlined /> {t('On this device')}</span>
                                <Select<SignInPreference>
                                    value={rememberChoice}
                                    popupMatchSelectWidth={false}
                                    aria-label={t('On this device')}
                                    onChange={(value) => { setRememberChoice(value); void applySignInPreference(value) }}
                                    options={[
                                        { value: 'ask', label: t('Ask me each time') },
                                        { value: 'keep', label: t('Keep me signed in') },
                                        { value: 'session', label: t("Don't remember me") },
                                    ]}
                                />
                            </div>
                        </div>

                        <div className="app-account-actions">
                            {isMobile && (
                                <Button
                                    block
                                    icon={<CompassOutlined />}
                                    onClick={() => { setAccountOpen(false); setGuideOpen(true) }}
                                >
                                    {t('Guide me')}
                                </Button>
                            )}

                            {/* Funder organisations: the programmes they fund and inviting a colleague. */}
                            <FunderOrgAccountActions user={user} onOpen={() => setAccountOpen(false)} />

                            <Button block icon={<IdcardOutlined />} onClick={() => { setAccountOpen(false); navigate(profilePathForUser(user)) }}>{t('My profile')}</Button>

                            <Button
                                block
                                danger
                                icon={<LogoutOutlined />}
                                onClick={() => void handleLogout()}
                            >
                                {t('Logout')}
                            </Button>
                        </div>
                    </Modal>
                    {/* Centred modal on desktop, bottom sheet on phones (thumb reach, full width). */}
                    <ResponsiveModal
                        open={navigationOpen}
                        centered
                        title={t('Explore your workspace')}
                        width={navigationWidth}
                        onClose={() => setNavigationOpen(false)}
                        className="workspace-navigation-modal"
                    >
                        <div className="workspace-navigation-intro">
                            <Typography.Text type="secondary">{t('Choose an area to continue. Pages are grouped by the work they support.')}</Typography.Text>
                        </div>
                        {navigationIsGrouped && <Segmented
                            block
                            className="workspace-navigation-sections"
                            value={activeNavigationSection?.key}
                            onChange={(value) => setNavigationSection(String(value))}
                            options={navigationSections.map((section) => ({ value: section.key, label: section.label }))}
                        />}
                        <div
                            className={`workspace-navigation-grid${navigationOrphans ? ` has-orphans-${navigationOrphans}` : ''}`}
                            style={{ '--nav-tracks': navigationColumns * 2 } as React.CSSProperties}
                        >
                            {isMobile && !isTablet && agenticAllowed && (
                                <button
                                    type="button"
                                    className="workspace-navigation-card is-compact is-agentic"
                                    onClick={() => { setNavigationOpen(false); handleShellModeChange('agentic') }}
                                >
                                    <span className="workspace-navigation-icon"><RobotOutlined /></span>
                                    <span className="workspace-navigation-copy"><strong>{t('Agentic')}</strong><span>{t('Ask your agent for priorities, progress and next steps.')}</span></span>
                                </button>
                            )}
                            {navigationCards.map((route) => {
                                const label = t(route.labelKey)
                                const description = navigationDescription(route, label)
                                const isCurrent = route.path === selectedKey
                                const isCompact = description.length <= 72
                                return <button key={route.path} type="button" className={`workspace-navigation-card${isCurrent ? ' is-current' : ''}${isCompact ? ' is-compact' : ''}`} onClick={() => openWorkspace(route.path)}>
                                    <span className="workspace-navigation-icon">{route.icon || <AppstoreOutlined />}</span>
                                    <span className="workspace-navigation-copy"><strong>{label}</strong><span>{description}</span></span>
                                </button>
                            })}
                        </div>
                    </ResponsiveModal>
                </SystemLayoutTopbarContext.Provider>
            </WorkspaceShellProvider>
        </PageGuideProvider>
    )
}
