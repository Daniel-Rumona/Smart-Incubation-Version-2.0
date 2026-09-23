import {
    Button,
    App,
    Grid,
    Layout,
    Modal,
    Segmented,
    Select,
    Space,
    Typography,
} from 'antd'
import {
    CompassOutlined,
    GlobalOutlined,
    LogoutOutlined,
    MenuOutlined,
    MoonOutlined,
    ProjectOutlined,
    RobotOutlined,
    AppstoreOutlined,
    ArrowLeftOutlined,
    SunOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useEffect, useMemo, useState } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { appRoutes } from '@/config/routes'
import { hasRolePermission } from '@/config/permissions'
import { useLanguage } from '@/providers/LanguageProvider'
import { useThemeMode } from '@/providers/ThemeProvider'
import { LANGUAGES, type LanguageCode } from '@/config/languages'
import { USER_ROLES, type UserRole } from '@/config/roles'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import type { AppRoute } from '@/types/routes'
import type { FullIdentity, IdentityPermission, WorkspaceAudience } from '@/types/identity'
import { logoutUser } from '@/services/authService'
import { getFirebaseDb, isFirebaseConfigured } from '@/config/firebase'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { AgentFab } from '@/components/agent/AgentFab'
import { GuideMe } from '@/components/guide/GuideMe'
import { PageGuideProvider } from '@/components/guide/PageGuideContext'
import { AgenticHomePage } from '@/pages/agentic/AgenticHomePage'
import { IncubateeNotificationBell } from '@/components/incubatee/IncubateeNotificationBell'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { SystemLayoutTopbarContext, type SystemLayoutPageChrome } from '@/contexts/SystemLayoutTopbarContext'
import { WorkspaceShellProvider } from '@/contexts/WorkspaceShellContext'
import { ALL_PROGRAMS, setActiveProgramId, useActiveProgramId } from '@/hooks/useActiveProgramId'
import { ALL_COMPANIES, setActiveCompanyCode, useActiveCompanyCode } from '@/hooks/useActiveCompanyCode'
import { listWorkspacePrograms, type WorkspaceProgram } from '@/services/workspaceProgramsService'
import { canAccessPlatformOwnerRoute, isPlatformAdmin, listWorkspaceCompanies, type WorkspaceCompany } from '@/services/companiesService'
import '@/styles/system-layout.css'

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
    '/consultant': 'See your assigned work, upcoming activity, and delivery progress at a glance.',
    '/consultant/profile': 'Maintain the professional information clients use to find and engage you.',
    '/consultant/smes': 'See the SMEs you support and the work currently connected to each one.',
    '/consultant/interventions': 'Deliver your assigned interventions and record the outcomes achieved.',
    '/consultant/appointments': 'Manage your schedule, appointments, and meeting outcomes.',
    '/consultant/feedback': 'Review client feedback and identify opportunities to strengthen your service.',
    '/consultant/reports': 'Review your delivery activity, outcomes, and service performance.',
    '/projectadmin': 'See programme performance, delivery activity, and current operational priorities.',
    '/projectadmin/reports': 'Review programme reporting, evidence, and performance summaries.',
    '/projectadmin/esg': 'Track ESG commitments, indicators, and programme scorecard results.',
    '/operations': 'Monitor delivery work, activity queues, and operational priorities.',
    '/operations/programs': 'Create and maintain the programmes available in this workspace.',
    '/operations/tasks': 'Plan, assign, and follow up on operational work across the active programme.',
    '/operations/staff/tasks': 'Plan, assign, and follow up on operational work across the active programme.',
    '/operations/staff/manage': 'Manage staff records, roles, and team capacity.',
    '/operations/participants/applications': 'Review incoming applications and decide who moves into the programme.',
    '/operations/participants/diagnostic-plans': 'Review diagnostic plans and the business priorities they identify.',
    '/operations/participants/all': 'Manage all participating businesses and their programme records.',
    '/operations/participants/metrics': 'Compare participant performance measures and growth trends.',
    '/operations/participants/compliance': 'Review participant compliance, evidence, and outstanding requirements.',
    '/operations/connection-requests': 'Manage SME and consultant connection requests.',
    '/operations/risk-register': 'Record, assess, and follow up on operational and programme risks.',
    '/operations/impact-analysis': 'Analyse the programme outcomes and impact generated across participants.',
    '/operations/interventions/assign': 'Match support interventions to SMEs and assign the right delivery resource.',
    '/operations/interventions/assigned': 'Track intervention delivery and the work currently assigned to your team.',
    '/operations/interventions/monitoring': 'Monitor intervention progress, evidence, and delivery risks.',
    '/operations/interventions/appointments': 'Schedule intervention appointments and capture their outcomes.',
    '/operations/interventions/documents': 'Manage intervention templates, resources, and supporting evidence.',
    '/operations/interventions/setup': 'Configure the intervention catalogue, outcomes, and delivery rules.',
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
}

const navigationDescription = (route: AppRoute, label: string) => NAVIGATION_DESCRIPTIONS[route.path] || `Review and manage ${label.toLowerCase()} for this workspace.`

/** The 3 highest-value pages per role, surfaced as one-click topbar shortcuts. */
const QUICK_LINK_PATHS: Partial<Record<UserRole, string[]>> = {
    [USER_ROLES.INCUBATEE]: ['/incubatee/interventions', '/incubatee/documents', '/incubatee/compliance'],
    [USER_ROLES.CONSULTANT]: ['/consultant/smes', '/consultant/appointments', '/consultant/reports'],
    [USER_ROLES.PROJECT_ADMIN]: ['/operations/participants/applications', '/operations/risk-register', '/projectadmin/reports'],
    [USER_ROLES.PROJECT_MANAGER]: ['/operations/participants/applications', '/operations/risk-register', '/operations/reports'],
    [USER_ROLES.OPERATIONS]: ['/operations/participants/applications', '/operations/risk-register', '/operations/reports'],
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

        if (!isVisible && !children?.length) return []

        return [{ ...route, children }]
    })
}

export const SystemLayout = () => {
    const location = useLocation()
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.lg

    const { t, language, setLanguage } = useLanguage()
    const { mode, toggleTheme } = useThemeMode()
    const { user, loading: identityLoading } = useFullIdentity()
    const { settings } = useSystemSettings()
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
    const [shellMode, setShellMode] = useState<'agentic' | 'workspace'>(() => (location.search ? 'workspace' : 'agentic'))
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
                    || route.path === '/consultant/appointments'
                if (!currentRoleCanDeliver && isPersonalDeliveryPage) return []
                const isHumanDeliveryPage = route.path === '/operations/interventions/assigned'
                if (hideHumanDelivery && isHumanDeliveryPage) return []
                if (hideHumanDelivery && agentSupportMode === 'fully_agentic' && route.path.startsWith('/operations/interventions/') && !['/operations/interventions/monitoring', '/operations/interventions/assign'].includes(route.path)) return []
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
        const home: QuickLink[] = homeRoute ? [{ path: homeRoute.path, label: 'Home', icon: homeRoute.icon }] : []

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
        const meetsSettingRule = (route: AppRoute) => !route.showInNavWhenAnySetting?.length
            || route.showInNavWhenAnySetting.some((settingKey) => !!settings[settingKey])

        const navRoutes = visibleRoutes.filter((route) => route.showInNav && meetsSettingRule(route))
        const standalone = navRoutes.filter((route) => !route.children?.length)
        const groups = navRoutes
            .filter((route) => route.children?.length)
            .map((route) => ({
                key: route.path,
                label: t(route.labelKey),
                items: (route.children ?? []).filter((child) => child.showInNav && meetsSettingRule(child)),
            }))
            .filter((section) => section.items.length > 0)

        return [
            ...(standalone.length ? [{ key: OVERVIEW_SECTION_KEY, label: t('nav.overview', 'Overview'), items: standalone }] : []),
            ...groups,
        ]
    }, [settings, t, visibleRoutes])

    const showTopbarBackButton = shellMode === 'workspace' && pageChrome.showBackButton
    const isChromelessMobile = isMobile && pageChrome.hideChrome

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

    const projectSelector = showCompanySelector ? companySelector : isSmeWorkspace ? null : (
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

    const modeSwitch = (
        <Segmented
            id="guide-mode-switch"
            className="app-mode-switch"
            value={shellMode}
            onChange={(value) => handleShellModeChange(value as 'agentic' | 'workspace')}
            options={[
                { value: 'agentic', label: 'Agentic', icon: <RobotOutlined /> },
                { value: 'workspace', label: 'Workspace', icon: <AppstoreOutlined /> },
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
                label: link.label,
                icon: link.icon,
            }))}
        />
    )

    const handleLogout = async () => {
        try {
            await logoutUser()
            setNavigationOpen(false)
            navigate('/auth', { replace: true })
        } catch {
            message.error('You could not be logged out. Please try again.')
        }
    }

    if (isFirebaseConfigured && identityLoading) return <LoadingOverlay tip="Loading workspace" />
    if (isFirebaseConfigured && !user) return <Navigate to="/auth" replace />
    if (isFirebaseConfigured && user && !user.emailVerified) return <Navigate to="/email-verification" replace />

    const activeNavigationSection = navigationSections.find((section) => section.key === navigationSection) || navigationSections[0]
    // A single section needs no tab strip; show its cards directly.
    const navigationIsGrouped = navigationSections.length > 1
    const navigationCards = navigationIsGrouped
        ? activeNavigationSection?.items || []
        : navigationSections.flatMap((section) => section.items)
    // Centre a short final row rather than leaving it hanging on the left.
    const navigationOrphans = navigationCards.length % 3
    // Agentic mode has no page to name, so the brand stays primary there.
    const showLocationCrumb = shellMode === 'workspace' && Boolean(currentLocationLabel)

    return (
        <PageGuideProvider>
            <WorkspaceShellProvider value={openWorkspace}>
                <SystemLayoutTopbarContext.Provider value={setPageChrome}>
                    <Layout className="app-shell">
                        <Layout className="app-main">
                            {!isChromelessMobile && (
                            <header
                                id="guide-app-topbar"
                                className="app-topbar-pill"
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
                                            aria-label="Go back"
                                        />
                                    )}

                                    {isMobile ? (
                                        <div className="app-brand-lockup">
                                            <span className="app-brand-copy">
                                                <strong id="guide-app-name" className="app-page-title">{showLocationCrumb ? currentLocationLabel : 'Smart Incubation'}</strong>
                                            </span>
                                        </div>
                                    ) : modeSwitch}
                                </div>

                                {!isMobile && <div className="app-topbar-center">{shellMode === 'workspace' && quickLinksSwitch}</div>}

                                {isMobile ? (
                                    <Space size={4} className="app-topbar-actions">
                                        <GuideMe
                                            mode={shellMode}
                                            role={user?.role}
                                            pageName={shellMode === 'agentic' ? 'Agentic workspace' : selectedKey === '/' ? 'Workspace dashboard' : selectedKey.replace(/^\//, '').replaceAll('/', ' › ')}
                                            hideTrigger
                                            open={guideOpen}
                                            onOpenChange={setGuideOpen}
                                        />

                                        {shellMode === 'workspace' && <AgentFab placement="topbar" />}

                                        {isSmeWorkspace && <IncubateeNotificationBell />}

                                        <Button
                                            type="text"
                                            shape="circle"
                                            icon={<UserOutlined />}
                                            onClick={() => setAccountOpen(true)}
                                            className="app-icon-btn"
                                            aria-label="Account and settings"
                                        />

                                        <Button
                                            type="text"
                                            shape="circle"
                                            icon={<LogoutOutlined />}
                                            onClick={() => void handleLogout()}
                                            className="app-icon-btn app-logout-topbar-btn"
                                            aria-label="Logout"
                                        />
                                    </Space>
                                ) : (
                                    <Space size={8} className="app-topbar-actions">
                                        {shellMode === 'workspace' && <Button icon={<MenuOutlined />} onClick={() => setNavigationOpen(true)} className="app-menu-button">Menu</Button>}

                                        {projectSelector}

                                        <GuideMe
                                            mode={shellMode}
                                            role={user?.role}
                                            pageName={shellMode === 'agentic' ? 'Agentic workspace' : selectedKey === '/' ? 'Workspace dashboard' : selectedKey.replace(/^\//, '').replaceAll('/', ' › ')}
                                        />

                                        {isSmeWorkspace && <IncubateeNotificationBell />}

                                        {shellMode === 'workspace' && <AgentFab placement="topbar" />}

                                        <Button
                                            type="text"
                                            shape="circle"
                                            icon={<UserOutlined />}
                                            onClick={() => setAccountOpen(true)}
                                            className="app-icon-btn"
                                            aria-label="Account and settings"
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
                                {shellMode === 'agentic' ? <AgenticHomePage /> : <Outlet key={location.pathname} />}
                            </Content>

                            {isMobile && !pageChrome.hideChrome && (
                                <nav className="app-bottom-bar" aria-label="Primary">
                                    {modeSwitch}

                                    {shellMode === 'workspace' && (
                                        <Button
                                            icon={<MenuOutlined />}
                                            onClick={() => setNavigationOpen(true)}
                                            className="app-menu-button"
                                        >
                                            Menu
                                        </Button>
                                    )}
                                </nav>
                            )}
                        </Layout>
                    </Layout>

                    <Modal
                        open={accountOpen}
                        title={
                            <div className="app-account-modal-title">
                                <span className="app-account-avatar">
                                    {companyLogoUrl ? <img src={companyLogoUrl} alt="Company logo" /> : <UserOutlined />}
                                </span>
                                <span className="app-account-title-copy">
                                    <strong>{user?.displayName || user?.name || 'Account'}</strong>
                                    {user?.role && <span className="app-account-role">{ROLE_LABELS[user.role] || user.role}</span>}
                                </span>
                            </div>
                        }
                        footer={null}
                        width={360}
                        onCancel={() => setAccountOpen(false)}
                        className="app-account-modal"
                    >
                        {isMobile && projectSelector && (
                            <div className="app-account-section">
                                <div className="app-account-row">
                                    <span className="app-account-row-label"><ProjectOutlined /> Programme</span>
                                    {projectSelector}
                                </div>
                            </div>
                        )}

                        <div className="app-account-section">
                            <div className="app-account-row">
                                <span className="app-account-row-label"><GlobalOutlined /> Language</span>
                                <Segmented
                                    value={language}
                                    onChange={(value) => setLanguage(value as LanguageCode)}
                                    options={Object.entries(LANGUAGES).map(([value, label]) => ({ value, label }))}
                                />
                            </div>

                            <div className="app-account-row">
                                <span className="app-account-row-label">{mode === 'dark' ? <MoonOutlined /> : <SunOutlined />} Appearance</span>
                                <Button
                                    icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
                                    onClick={toggleTheme}
                                >
                                    {mode === 'dark' ? 'Light mode' : 'Dark mode'}
                                </Button>
                            </div>
                        </div>

                        <div className="app-account-actions">
                            {isMobile && (
                                <Button
                                    block
                                    icon={<CompassOutlined />}
                                    onClick={() => { setAccountOpen(false); setGuideOpen(true) }}
                                >
                                    Guide me
                                </Button>
                            )}

                            <Button
                                block
                                danger
                                icon={<LogoutOutlined />}
                                onClick={() => void handleLogout()}
                            >
                                Logout
                            </Button>
                        </div>
                    </Modal>
                    <Modal
                        open={navigationOpen}
                        centered
                        title="Explore your workspace"
                        footer={null}
                        width={1120}
                        destroyOnHidden
                        onCancel={() => setNavigationOpen(false)}
                        className="workspace-navigation-modal"
                    >
                        <div className="workspace-navigation-intro">
                            <Typography.Text type="secondary">Choose an area to continue. Pages are grouped by the work they support.</Typography.Text>
                        </div>
                        {navigationIsGrouped && <Segmented
                            block
                            className="workspace-navigation-sections"
                            value={activeNavigationSection?.key}
                            onChange={(value) => setNavigationSection(String(value))}
                            options={navigationSections.map((section) => ({ value: section.key, label: section.label }))}
                        />}
                        <div className={`workspace-navigation-grid${navigationOrphans ? ` has-orphans-${navigationOrphans}` : ''}`}>
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
                    </Modal>
                </SystemLayoutTopbarContext.Provider>
            </WorkspaceShellProvider>
        </PageGuideProvider>
    )
}
