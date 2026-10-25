import {
    Button,
    App,
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
    GlobalOutlined,
    LogoutOutlined,
    MenuOutlined,
    MoonOutlined,
    RobotOutlined,
    AppstoreOutlined,
    ArrowLeftOutlined,
    ArrowRightOutlined,
    IdcardOutlined,
    SunOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { NotificationBell } from '@/components/notifications/NotificationBell'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { useEntitlements } from '@/hooks/useEntitlements'
import { SystemLayoutTopbarContext, type SystemLayoutPageChrome } from '@/contexts/SystemLayoutTopbarContext'
import { WorkspaceShellProvider } from '@/contexts/WorkspaceShellContext'
import { ALL_PROGRAMS, setActiveProgramId, useActiveProgramId } from '@/hooks/useActiveProgramId'
import { ALL_COMPANIES, setActiveCompanyCode, useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import { canAccessPlatformOwnerRoute, isPlatformAdmin, listWorkspaceCompanies, type WorkspaceCompany } from '@/services/companiesService'
import { journeyAllows, journeyAllowsAgentic, marketplaceConsultantAllows } from '@/utils/routeAccess'
import { hasOwnInterventionDocuments } from '@/services/interventionDocumentsService'
import { ProgramResumeBanner } from '@/components/applicant/ProgramResumeBanner'
import '@/styles/system-layout.css'
// Page fade-in and skeleton styles; the full LoadingOverlay is only used for this first load now.
import '@/styles/page-loading.css'

const { Content } = Layout
const { useBreakpoint } = Grid

const workspaceDashboardPath = (user?: { role?: UserRole, isApplicant?: boolean } | null) => {
    if (user?.role === 'incubatee') return user.isApplicant ? '/applicant/application-tracker' : '/incubatee'
    if (user?.role === 'consultant') return '/consultant'
    if (user?.role === 'projectadmin') return '/projectadmin'
    if (user?.role === 'director') return '/director'
    if (user?.role === 'operations' || user?.role === 'projectmanager') return '/operations'
    return '/dashboard'
}

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
    '/consultant/smes': 'The SMEs you support and the work for each one.',
    '/consultant/interventions': 'Accept new work, update progress and upload your evidence.',
    '/consultant/feedback': 'What SMEs said about your work.',
    '/consultant/reports': 'Your work, results and ratings over time.',
    '/projectadmin': 'See programme performance, delivery activity, and current operational priorities.',
    '/projectadmin/reports': 'Review programme reporting, evidence, and performance summaries.',
    '/projectadmin/esg': 'Track ESG commitments, indicators, and programme scorecard results.',
    '/operations': 'Monitor delivery work, activity queues, and operational priorities.',
    '/operations/programs': 'Create and maintain the programmes available in this workspace.',
    '/operations/tasks': 'Plan, assign, and follow up on operational work across the active programme.',
    '/shared/staff/tasks': 'Plan, assign, and follow up on operational work across the active programme.',
    '/shared/staff/manage': 'Manage staff records, roles, and team capacity.',
    '/shared/applications': 'Review incoming applications and decide who moves into the programme.',
    '/operations/participants/diagnostic-plans': 'Review diagnostic plans and the business priorities they identify.',
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
    '/director/settings': 'Maintain the organisation-wide settings that shape this workspace.',
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
    return description ? tr(description) : tr('Review and manage {label} for this workspace.', undefined, { label: label.toLowerCase() })
}

/** The 3 highest-value pages per role, surfaced as one-click topbar shortcuts. */
const QUICK_LINK_PATHS: Partial<Record<UserRole, string[]>> = {
    [USER_ROLES.INCUBATEE]: ['/incubatee/interventions', '/incubatee/diagnostic-plan', '/incubatee/compliance'],
    [USER_ROLES.CONSULTANT]: ['/consultant/interventions', '/shared/interventions/appointments', '/consultant/reports'],
    [USER_ROLES.PROJECT_ADMIN]: ['/shared/applications', '/operations/risk-register', '/projectadmin/reports'],
    [USER_ROLES.PROJECT_MANAGER]: ['/shared/applications', '/operations/risk-register', '/operations/reports'],
    [USER_ROLES.OPERATIONS]: ['/shared/applications', '/operations/risk-register', '/operations/reports'],
    [USER_ROLES.DIRECTOR]: ['/director/portfolio', '/director/programs', '/director/reports'],
    [USER_ROLES.ADMIN]: ['/admin/users', '/admin/usage', '/admin/email-operations'],
    [USER_ROLES.SYSTEM_ADMIN]: ['/admin/users', '/admin/usage', '/admin/agent-registry'],
}
const APPLICANT_QUICK_LINK_PATHS = ['/applicant/profile', '/applicant/programs', '/applicant/application-tracker', '/applicant/roadmap']

const ROLE_LABELS: Partial<Record<UserRole, string>> = {
    [USER_ROLES.INCUBATEE]: 'SME',
    [USER_ROLES.CONSULTANT]: 'Consultant',
    [USER_ROLES.PROJECT_ADMIN]: 'Project Admin',
    [USER_ROLES.PROJECT_MANAGER]: 'Project Manager',
    [USER_ROLES.OPERATIONS]: 'Operations',
    [USER_ROLES.DIRECTOR]: 'Director',
    [USER_ROLES.ADMIN]: 'Admin',
    [USER_ROLES.SYSTEM_ADMIN]: 'System Admin',
}

const flattenRoutes = (routes: AppRoute[]): AppRoute[] =>
    routes.flatMap((route) => [route, ...(route.children?.length ? flattenRoutes(route.children) : [])])

type QuickLink = { path: string, label: string, icon: AppRoute['icon'] }

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
    const { settings } = useSystemSettings()
    const entitlements = useEntitlements()
    const { message } = App.useApp()

    const [navigationOpen, setNavigationOpen] = useState(false)
    const [navigationSection, setNavigationSection] = useState('')
    const { activeProgramId } = useActiveProgramId()
    const { activeCompanyCode } = useActiveCompanyCode()
    const [programs, setPrograms] = useState<WorkspaceProgram[]>([])
    const [programsVersion, setProgramsVersion] = useState(0)
    const [companies, setCompanies] = useState<WorkspaceCompany[]>([])
    const [companyLogoUrl, setCompanyLogoUrl] = useState('')
    /**
     * The shell opens on the agentic home, which covers whatever route the URL names. A URL
     * carrying parameters (`/incubatee?demo=1`, a filtered report link) is a deliberate deep
     * link, so open the page itself instead of hiding it behind the agentic home.
     */
    const [requestedShellMode, setShellMode] = useState<'agentic' | 'workspace'>(() => (location.search ? 'workspace' : 'agentic'))
    // Without the agentic support plan feature there is no Agentic home: the workspace is the only mode.
    // ...and programme applicants keep to their programme until they are accepted.
    const agenticAllowed = entitlements.has('agenticSupport') && journeyAllowsAgentic(user)
    const shellMode: 'agentic' | 'workspace' = agenticAllowed ? requestedShellMode : 'workspace'
    // Phones split the shell in two: identity on top, the controls people tap on the bottom bar,
    // and everything set-and-forget behind the account panel.
    const [accountOpen, setAccountOpen] = useState(false)
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

                if (activeProgramId !== ALL_PROGRAMS && !rows.some((program) => program.id === activeProgramId)) {
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
        if (user?.role === 'operations' || user?.role === 'projectadmin' || user?.role === 'consultant') return 'operations'
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
    const visibleRoutes = useMemo(() => {
        const routes = filterRoutesByAudience(appRoutes, audience, user?.role, user?.permissions, user)

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
                const children = route.children ? applyAgentDeliveryAccess(route.children as typeof routes) : undefined
                return [{ ...route, children }]
            })

        return applyAgentDeliveryAccess(routes)
    }, [agentSupportMode, audience, currentRoleCanDeliver, hideHumanDelivery, user])
    const selectedKey = useMemo(() => {
        return findSelectedRouteKey(visibleRoutes, location.pathname) || '/'
    }, [location.pathname, visibleRoutes])
    const quickLinkRoutes = useMemo(() => {
        const byPath = new Map(flattenRoutes(visibleRoutes).map((route) => [route.path, route]))
        const homePath = workspaceDashboardPath(user)
        const homeRoute = byPath.get(homePath)
        const home: QuickLink[] = homeRoute ? [{ path: homeRoute.path, label: t('Home'), icon: homeRoute.icon }] : []

        const candidatePaths = user?.role === 'incubatee' && user.isApplicant
            ? APPLICANT_QUICK_LINK_PATHS
            : (user?.role && QUICK_LINK_PATHS[user.role]) || []
        const rest = candidatePaths
            .filter((path) => path !== homePath)
            .map((path) => byPath.get(path))
            .filter((route): route is AppRoute => Boolean(route))
            .slice(0, 3)
            .map((route) => ({ path: route.path, label: t(route.labelKey), icon: route.icon }))

        return [...home, ...rest]
    }, [t, user, visibleRoutes])
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
    const navigationSections = useMemo(() => {
        const meetsSettingRule = (route: AppRoute) => (!route.showInNavWhenAnySetting?.length
            || route.showInNavWhenAnySetting.some((settingKey) => !!settings[settingKey]))
            && (!route.showInNavWhenHasDocuments || hasOwnDocuments)

        // Pages already one tap away (the desktop quick-link switch, the phone tab bar) are left out of the
        // Menu. Tablets have neither, so they keep every page there.
        const pinned = new Set(isTablet ? [] : quickLinkRoutes.map((link) => link.path))
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
    }, [hasOwnDocuments, isTablet, quickLinkRoutes, settings, t, visibleRoutes])

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
            showSearch
            optionFilterProp="label"
            options={[{ code: ALL_COMPANIES, name: 'All companies' }, ...companies].map((company) => ({
                value: company.code,
                label: company.name,
            }))}
        />
    )

    // A single programme has nothing to choose between, so show it as a plain tag instead of a dropdown with "All programmes".
    const singleProgramTag = programs.length === 1
        ? <Tag className="app-project-tag" title={programs[0].name}>{programs[0].name}</Tag>
        : null

    const projectSelector = showCompanySelector ? companySelector : isSmeWorkspace ? null : singleProgramTag ?? (
        <Select
            value={activeProgramId}
            onChange={setActiveProgramId}
            id="guide-scope-selector"
            className="app-project-select"
            options={[{ id: ALL_PROGRAMS, name: t('shell.allPrograms') }, ...programs].map((project) => ({
                value: project.id,
                label: project.name,
            }))}
        />
    )

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
        if (value === 'workspace' && location.pathname === '/') navigate(workspaceDashboardPath(user))
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

    const quickLinksValue = quickLinkRoutes.some((link) => link.path === selectedKey) ? selectedKey : ''
    const quickLinksSwitch = quickLinkRoutes.length > 0 && (
        <Segmented
            className="app-quicklinks-switch"
            value={quickLinksValue}
            onChange={(value) => openWorkspace(String(value))}
            options={quickLinkRoutes.map((link) => ({
                value: link.path,
                label: <span className="app-topbar-text">{link.label}</span>,
                title: link.label,
                icon: link.icon,
            }))}
        />
    )

    // The bar never wraps, and labels run longer in some languages. When it overflows, labels give way in
    // steps (other shortcuts, then the other mode, then the current shortcut) so the bell and account
    // button stay on screen.
    const topbarRef = useRef<HTMLElement>(null)
    useFitSteps(topbarRef, ['links', 'links modes', 'links modes all'])

    const handleLogout = async () => {
        try {
            await logoutUser()
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
                                className={`app-topbar-pill${isMobile && !isTablet && projectSelector ? ' has-phone-scope' : ''}`}
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

                                            {shellMode === 'workspace' && (
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
                                    ) : isMobile ? (
                                        <div className="app-brand-lockup">
                                            <span className="app-brand-copy">
                                                <strong id="guide-app-name" className="app-page-title app-page-tag" title={showLocationCrumb ? currentLocationLabel : undefined}>{showLocationCrumb ? currentLocationLabel : t('Smart Incubation')}</strong>
                                            </span>
                                        </div>
                                    ) : modeSwitch}
                                </div>

                                {!isMobile && <div className="app-topbar-center">{shellMode === 'workspace' && quickLinksSwitch}</div>}

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

                                        {shellMode === 'workspace' && <AgentFab placement="topbar" />}

                                        <NotificationBell />

                                        {/* Log out lives in the account panel on phones too. */}
                                        <Button
                                            type="text"
                                            icon={<UserOutlined />}
                                            onClick={() => setAccountOpen(true)}
                                            className="app-icon-btn"
                                            aria-label={t('Account and settings')}
                                        />
                                    </Space>
                                ) : (
                                    <Space size={8} className="app-topbar-actions">
                                        {shellMode === 'workspace' && <Button icon={<MenuOutlined />} onClick={() => setNavigationOpen(true)} className="app-menu-button">{t('Menu')}</Button>}

                                        {projectSelector}

                                        <GuideMe
                                            mode={shellMode}
                                            role={user?.role}
                                            pageName={shellMode === 'agentic' ? 'Agentic workspace' : selectedKey === '/' ? 'Workspace dashboard' : selectedKey.replace(/^\//, '').replaceAll('/', ' › ')}
                                        />

                                        <NotificationBell />

                                        {shellMode === 'workspace' && <AgentFab placement="topbar" />}

                                        <Button
                                            type="text"
                                            shape="circle"
                                            icon={<UserOutlined />}
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
                                {shellMode === 'agentic' ? <AgenticHomePage /> : <Outlet key={location.pathname} />}
                            </Content>

                            {hasPhoneBottomBar && (() => {
                                // Tab bar: Home + the role's shortcuts + Menu. The current tab grows into a
                                // labelled pill; Menu is current when the open page isn't one of the tabs.
                                const onShortcut = quickLinkRoutes.some((link) => link.path === selectedKey)
                                return (
                                    <nav className="app-bottom-bar app-tab-bar" aria-label={t('Primary')}>
                                        {quickLinkRoutes.map((link) => {
                                            const active = link.path === selectedKey
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
                                        <button
                                            type="button"
                                            className={`app-tab${!onShortcut ? ' is-active' : ''}`}
                                            aria-label={t('Menu')}
                                            onClick={() => setNavigationOpen(true)}
                                        >
                                            <span className="app-tab-icon"><MenuOutlined /></span>
                                            <span className="app-tab-label">{t('Menu')}</span>
                                        </button>
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
