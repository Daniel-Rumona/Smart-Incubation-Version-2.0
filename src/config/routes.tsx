import {
    ApartmentOutlined,
    AuditOutlined,
    AudioOutlined,
    BarChartOutlined,
    CalendarOutlined,
    CompassOutlined,
    DashboardOutlined,
    FileSearchOutlined,
    FolderOpenOutlined,
    FileWordOutlined,
    FormOutlined,
    HeatMapOutlined,
    IdcardOutlined,
    ExclamationCircleOutlined,
    FundProjectionScreenOutlined,
    MailOutlined,
    MessageOutlined,
    StarOutlined,
    PieChartOutlined,
    ProfileOutlined,
    ProjectOutlined,
    RobotOutlined,
    SafetyCertificateOutlined,
    SettingOutlined,
    ShopOutlined,
    TeamOutlined,
    UserOutlined,
    UserSwitchOutlined,
} from '@ant-design/icons'
import type { ComponentType } from 'react'
import AuthPage from '@/pages/auth/AuthPage'
import EmailVerificationPage from '@/pages/auth/EmailVerificationPage'
import { WelcomePage } from '@/pages/welcome/WelcomePage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import LandingPage from '@/pages/landing/LandingPage'
import { ComingSoonPage } from '@/pages/system/ComingSoonPage'
import { ApplicantProfilePage } from '@/pages/applicant/ApplicantProfilePage'
import { ApplicationTrackerPage } from '@/pages/applicant/ApplicationTrackerPage'
import { ProgramsDiscoveryPage } from '@/pages/applicant/ProgramsDiscoveryPage'
import { UsageAnalyticsPage } from '@/pages/admin/UsageAnalyticsPage'
import { UserManagementPage } from '@/pages/admin/UserManagementPage'
import { EmailOperationsPage } from '@/pages/admin/EmailOperationsPage'
import { SystemSettingsChangeRequestsPage } from '@/pages/admin/SystemSettingsChangeRequestsPage'
import AgentAvailabilityPage from '@/pages/admin/AgentAvailabilityPage'
import AgentRegistryPage from '@/pages/admin/AgentRegistryPage'
import AgentRatingsPage from '@/pages/admin/AgentRatingsPage'
import ConsultantVerificationPage from '@/pages/admin/ConsultantVerificationPage'
import DirectorDashboardPage from '@/pages/director/DirectorDashboardPage'
import { DirectorPortfolioPage } from '@/pages/director/DirectorPortfolioPage'
import { DirectorSectorsPage } from '@/pages/director/DirectorSectorsPage'
import { DirectorProgramsPage } from '@/pages/director/DirectorProgramsPage'
import { DirectorStructurePage } from '@/pages/director/DirectorStructurePage'
import { DirectorReportsPage } from '@/pages/director/DirectorReportsPage'
import { ApplicationsReviewPage } from '@/pages/operations/ApplicationsReviewPage'
import OperationsDashboardPage from '@/pages/dashboards/operations/OperationsDashboardPage'
import { CompliancePage } from '@/pages/operations/CompliancePage'
import ParticipantsPage from '@/pages/operations/ParticipantsPage'
import SmeMetricsPage from '@/pages/operations/SmeMetricsPage'
import { ParticipantOnboardingPage } from '@/pages/operations/ParticipantOnboardingPage'
import { OperationsStaffPage } from '@/pages/operations/OperationsStaffPage'
import { DiagnosticPlansPage } from '@/pages/operations/DiagnosticPlansPage'
import RiskRegisterPage from '@/pages/operations/RiskRegisterPage'
import ImpactAnalysisPage from '@/pages/operations/ImpactAnalysisPage'
import OperationsReportsPage from '@/pages/operations/OperationsReportsPage'
import ProgramsPage from '@/pages/operations/ProgramsPage'
import SurveysPage from '@/pages/operations/surveys/SurveysPage'
import IncubateeSurveysPage from '@/pages/incubatee/surveys/IncubateeSurveysPage'
import SurveyResponsePage from '@/pages/incubatee/surveys/SurveyResponsePage'
import SurveyBuilderPage from '@/pages/operations/surveys/SurveyBuilderPage'
import ConsultantConnectionRequestsPage from '@/pages/operations/ConsultantConnectionRequestsPage'
import { OperationsTasksPage } from '@/pages/operations/OperationsTasksPage'
import ProjectAdminDashboardPage from '@/pages/projectadmin/ProjectAdminDashboardPage'
import ProjectAdminReportsPage from '@/pages/projectadmin/ProjectAdminReportsPage'
import ProjectAdminEsgPage from '@/pages/projectadmin/ProjectAdminEsgPage'
import ProjectAdminEsgPerformancePage from '@/pages/projectadmin/ProjectAdminEsgPerformancePage'
import { IncubateeDashboardPage } from '@/pages/incubatee/IncubateeDashboardPage'
import { IncubateeInterventionsPage } from '@/pages/incubatee/IncubateeInterventionsPage'
import IncubateeDiagnosticPlanPage from '@/pages/incubatee/IncubateeDiagnosticPlanPage'
import IncubateeCompliancePage from '@/pages/incubatee/IncubateeCompliancePage'
import IncubateeMetricsPage from '@/pages/incubatee/IncubateeMetricsPage'
import IncubateeRoadmapPage from '@/pages/incubatee/IncubateeRoadmapPage'
import AgentWorkspacePage from '@/pages/incubatee/AgentWorkspacePage'
import PitchCoachPage from '@/pages/incubatee/PitchCoachPage'
import ConsultantDashboardPage from '@/pages/consultant/ConsultantDashboardPage'
import ConsultantFeedbackPage from '@/pages/consultant/ConsultantFeedbackPage'
import ConsultantReportsPage from '@/pages/consultant/ConsultantReportsPage'
import ConsultantProfilePage from '@/pages/consultant/ConsultantProfilePage'
import ConsultantSmesPage from '@/pages/consultant/ConsultantSmesPage'
import SmeOnboardingPage from '@/pages/applicant/SmeOnboardingPage'
import ProviderMarketplacePage from '@/pages/applicant/ProviderMarketplacePage'
import { AllocatedInterventions } from '@/pages/interventions/AllocatedInterventionsPage'
import { InterventionsAssignemnts } from '@/pages/interventions/InterventionsAssignmentsPage'
import { InterventionAppointmentsPage } from '@/pages/interventions/InterventionAppointmentsPage'
import InterventionsSetupPage from '@/pages/interventions/InterventionsSetupPage'
import InterventionsMonitoringPage from '@/pages/interventions/InterventionsMonitoringPage'
import InterventionDocumentsPage from '@/pages/interventions/InterventionDocumentsPage'
import { CompanySettingsPage } from '@/pages/settings/CompanySettingsPage'
import { USER_ROLES } from '@/config/roles'
import type { AppRoute } from '@/types/routes'
import ProgramApplicationPage from '@/pages/applications/ProgramApplicationPage'

export type PublicRoute = {
    path: string
    labelKey: string
    element: ComponentType
}

export const publicRoutes: PublicRoute[] = [
    { path: '/', labelKey: 'nav.landing', element: LandingPage },
    { path: '/auth', labelKey: 'nav.auth', element: AuthPage },
    { path: '/email-verification', labelKey: 'nav.emailVerification', element: EmailVerificationPage },
    { path: '/welcome', labelKey: 'nav.welcome', element: WelcomePage },
]

const allRoles = Object.values(USER_ROLES)
const dashboardRoles = allRoles.filter(role => role !== USER_ROLES.DIRECTOR)
const operationsRoles = [
    USER_ROLES.SYSTEM_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.DIRECTOR,
    USER_ROLES.PROJECT_ADMIN,
    USER_ROLES.PROJECT_MANAGER,
    USER_ROLES.OPERATIONS,
]
const operationsDashboardRoles = [
    USER_ROLES.SYSTEM_ADMIN,
    USER_ROLES.ADMIN,
    USER_ROLES.DIRECTOR,
    USER_ROLES.PROJECT_MANAGER,
    USER_ROLES.OPERATIONS,
]
const projectAdminRoles = [USER_ROLES.PROJECT_ADMIN]
const incubateeRoles = [USER_ROLES.INCUBATEE]
const adminRoles = [USER_ROLES.SYSTEM_ADMIN, USER_ROLES.ADMIN]
const directorRoles = [USER_ROLES.DIRECTOR]
const applicationReviewRoles = [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS]
const complianceRoles = [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS]
const interventionWorkspaceRoles = [
    USER_ROLES.PROJECT_ADMIN,
    USER_ROLES.PROJECT_MANAGER,
    USER_ROLES.OPERATIONS,
]
const consultantRoles = [USER_ROLES.CONSULTANT]
const placeholder = <ComingSoonPage />

export const appRoutes: AppRoute[] = [
    {
        path: '/dashboard',
        labelKey: 'nav.dashboard',
        icon: <DashboardOutlined />,
        element: <DashboardPage />,
        allowedRoles: dashboardRoles,
        audiences: ['platform'],
        showInNav: true,
        agentEnabled: true,
        agentActions: ['explain_dashboard'],
    },
    {
        path: '/applicant/onboarding',
        labelKey: 'nav.onboarding',
        icon: <CompassOutlined />,
        element: <SmeOnboardingPage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'],
        showInNav: false
    },
    {
        path: '/applicant/profile',
        labelKey: 'nav.profile',
        icon: <ProfileOutlined />,
        element: <ApplicantProfilePage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'],
        showInNav: true
    },
    {
        path: '/applicant/programs',
        labelKey: 'nav.programs',
        icon: <ProjectOutlined />,
        element: <ProgramsDiscoveryPage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'],
        showInNav: true
    },
    {
        path: '/applicant/marketplace',
        labelKey: 'nav.marketplace',
        icon: <ShopOutlined />,
        element: <ProviderMarketplacePage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'],
        platformOwnerOnly: true,
        showInNav: true
    },
    {
        path: '/applicant/programs/:programId/apply',
        labelKey: 'applicant.application.title',
        icon: <FormOutlined />,
        element: <ProgramApplicationPage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'],
        showInNav: false
    },

    {
        path: '/applicant/application-tracker',
        labelKey: 'nav.applicationTracker',
        icon: <AuditOutlined />,
        element: <ApplicationTrackerPage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'], showInNav: true
    },
    {
        path: '/applicant/roadmap',
        labelKey: 'nav.roadmap',
        icon: <HeatMapOutlined />,
        element: <IncubateeRoadmapPage />,
        allowedRoles: incubateeRoles,
        audiences: ['applicant'],
        showInNav: true
    },
    { path: '/incubatee', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <IncubateeDashboardPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/metrics', labelKey: 'nav.metrics', icon: <BarChartOutlined />, element: <IncubateeMetricsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/diagnostic-plan', labelKey: 'nav.myDiagnosticPlan', icon: <FileSearchOutlined />, element: <IncubateeDiagnosticPlanPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/business-plan', labelKey: 'nav.businessPlan', icon: <FileWordOutlined />, element: <AgentWorkspacePage agentId="business-plan" />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false, agentEnabled: true, agentActions: ['explain_business_plan'] },
    { path: '/incubatee/strategic-plan', labelKey: 'nav.strategicPlan', icon: <FileWordOutlined />, element: <AgentWorkspacePage agentId="strategic-plan" />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false, agentEnabled: true, agentActions: ['explain_strategic_plan'] },
    { path: '/incubatee/pitch-coach', labelKey: 'nav.pitchCoach', icon: <AudioOutlined />, element: <PitchCoachPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false, agentEnabled: true, agentActions: ['create_pitch_project', 'score_pitch_transcript'] },
    { path: '/incubatee/interventions', labelKey: 'nav.interventions', icon: <FormOutlined />, element: <IncubateeInterventionsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/documents', labelKey: 'nav.documentLibrary', icon: <FolderOpenOutlined />, element: <InterventionDocumentsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/tracker', labelKey: 'nav.interventions', icon: <FormOutlined />, element: <IncubateeInterventionsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/surveys', labelKey: 'nav.surveys', icon: <FormOutlined />, element: <IncubateeSurveysPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/surveys/:id', labelKey: 'nav.surveys', icon: <FormOutlined />, element: <SurveyResponsePage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/compliance', labelKey: 'nav.compliance', icon: <SafetyCertificateOutlined />, element: <IncubateeCompliancePage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/consultant', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <ConsultantDashboardPage />, allowedRoles: consultantRoles, audiences: ['operations'], showInNav: true },
    { path: '/consultant/profile', labelKey: 'nav.consultantProfile', icon: <UserOutlined />, element: <ConsultantProfilePage />, allowedRoles: consultantRoles, audiences: ['operations'], showInNav: true },
    { path: '/consultant/smes', labelKey: 'nav.mySmes', icon: <TeamOutlined />, element: <ConsultantSmesPage />, allowedRoles: consultantRoles, audiences: ['operations'], showInNav: true },
    { path: '/consultant/interventions', labelKey: 'nav.assignedInterventions', icon: <FormOutlined />, element: <AllocatedInterventions />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/consultant/allocated', labelKey: 'nav.assignedInterventions', icon: <FormOutlined />, element: <AllocatedInterventions />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: false },
    { path: '/consultant/appointments', labelKey: 'nav.appointments', icon: <CalendarOutlined />, element: <InterventionAppointmentsPage />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/consultant/feedback', labelKey: 'nav.feedback', icon: <MessageOutlined />, element: <ConsultantFeedbackPage />, allowedRoles: consultantRoles, audiences: ['operations'], showInNav: true },
    { path: '/consultant/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <ConsultantReportsPage />, allowedRoles: consultantRoles, audiences: ['operations'], showInNav: true },
    { path: '/projectadmin', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <ProjectAdminDashboardPage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_dashboard', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <ProjectAdminReportsPage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin/esg', labelKey: 'nav.esgScorecard', icon: <FundProjectionScreenOutlined />, element: <ProjectAdminEsgPage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin/esg/performance', labelKey: 'nav.esgPerformance', icon: <TeamOutlined />, element: <ProjectAdminEsgPerformancePage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: false },
    { path: '/operations', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <OperationsDashboardPage />, allowedRoles: operationsDashboardRoles, audiences: ['operations'], showInNav: true },
    { path: '/operations/programs', labelKey: 'nav.programs', icon: <ProjectOutlined />, element: <ProgramsPage />, allowedRoles: [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS], requiredPermission: 'manage_programs', audiences: ['operations'], showInNav: true },
    // Compatibility path for older links. The visible task entry lives under Staff > Tasks.
    { path: '/operations/tasks', labelKey: 'nav.tasks', icon: <CalendarOutlined />, element: <OperationsTasksPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    {
        path: '/operations/staff',
        labelKey: 'nav.staff',
        icon: <TeamOutlined />,
        element: placeholder,
        allowedRoles: applicationReviewRoles,
        requiredPermission: 'view_staff',
        audiences: ['operations'],
        showInNav: true,
        children: [
            { path: '/operations/staff/tasks', labelKey: 'nav.tasks', icon: <CalendarOutlined />, element: <OperationsTasksPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_staff', audiences: ['operations'], showInNav: true },
            { path: '/operations/staff/manage', labelKey: 'nav.manageTeam', icon: <UserSwitchOutlined />, element: <OperationsStaffPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'manage_staff', audiences: ['operations'], showInNav: true },
        ],
    },
    {
        path: '/operations/participants',
        labelKey: 'nav.participants',
        icon: <IdcardOutlined />,
        element: placeholder,
        allowedRoles: operationsRoles,
        audiences: ['operations'],
        showInNav: true,
        children: [
            { path: '/operations/participants/applications', labelKey: 'nav.applications', icon: <AuditOutlined />, element: <ApplicationsReviewPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_applications', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/diagnostic-plans', labelKey: 'nav.diagnosticPlans', icon: <FileSearchOutlined />, element: <DiagnosticPlansPage />, allowedRoles: operationsRoles, requiredPermission: 'view_diagnostic_plans', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/all', labelKey: 'nav.viewAll', icon: <ApartmentOutlined />, element: <ParticipantsPage />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/metrics', labelKey: 'nav.metrics', icon: <BarChartOutlined />, element: <SmeMetricsPage />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/compliance', labelKey: 'nav.compliance', icon: <SafetyCertificateOutlined />, element: <CompliancePage />, allowedRoles: complianceRoles, requiredPermission: 'view_compliance', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/new', labelKey: 'operations.participants.add', icon: <UserOutlined />, element: <ParticipantOnboardingPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: false },
        ],
    },
    { path: '/operations/connection-requests', labelKey: 'nav.connectionRequests', icon: <TeamOutlined />, element: <ConsultantConnectionRequestsPage />, allowedRoles: operationsRoles, audiences: ['operations'], platformOwnerOnly: true, showInNav: true },
    { path: '/operations/risk-register', labelKey: 'nav.riskRegister', icon: <ExclamationCircleOutlined />, element: <RiskRegisterPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: true },
    { path: '/operations/impact-analysis', labelKey: 'nav.impactAnalysis', icon: <FundProjectionScreenOutlined />, element: <ImpactAnalysisPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: true },
    {
        path: '/operations/interventions',
        labelKey: 'nav.interventions',
        icon: <FormOutlined />,
        element: <AllocatedInterventions />,
        allowedRoles: interventionWorkspaceRoles,
        requiredPermission: 'track_interventions',
        audiences: ['operations'],
        showInNav: true,
        children: [
            {
                path: '/operations/interventions/assign',
                labelKey: 'nav.assignInterventions',
                icon: <FormOutlined />,
                element: <InterventionsAssignemnts />,
                allowedRoles: interventionWorkspaceRoles,
                requiredPermission: 'assign_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            {
                path: '/operations/interventions/assigned',
                labelKey: 'nav.assignedInterventions',
                icon: <FormOutlined />,
                element: <AllocatedInterventions />,
                allowedRoles: interventionWorkspaceRoles,
                requiredPermission: 'track_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            {
                path: '/operations/interventions/monitoring',
                labelKey: 'nav.monitoring',
                icon: <BarChartOutlined />,
                element: <InterventionsMonitoringPage />,
                allowedRoles: [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS],
                requiredPermission: 'track_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            {
                path: '/operations/interventions/appointments',
                labelKey: 'nav.appointments',
                icon: <CalendarOutlined />,
                element: <InterventionAppointmentsPage />,
                allowedRoles: interventionWorkspaceRoles,
                requiredPermission: 'track_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            {
                path: '/operations/interventions/documents',
                labelKey: 'nav.documentLibrary',
                icon: <FolderOpenOutlined />,
                element: <InterventionDocumentsPage />,
                allowedRoles: [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS],
                requiredPermission: 'track_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            {
                path: '/operations/interventions/setup',
                labelKey: 'nav.setup',
                icon: <SettingOutlined />,
                element: <InterventionsSetupPage />,
                allowedRoles: interventionWorkspaceRoles,
                requiredPermission: 'manage_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
        ],
    },
    { path: '/operations/surveys', labelKey: 'nav.surveys', icon: <FormOutlined />, element: <SurveysPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: true },
    { path: '/operations/surveys/builder', labelKey: 'nav.surveyBuilder', icon: <FormOutlined />, element: <SurveyBuilderPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    { path: '/operations/surveys/builder/:id', labelKey: 'nav.surveyBuilder', icon: <FormOutlined />, element: <SurveyBuilderPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    { path: '/operations/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <OperationsReportsPage />, allowedRoles: operationsDashboardRoles, audiences: ['operations'], showInNav: true },
    { path: '/director', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <DirectorDashboardPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/director/programs', labelKey: 'nav.programPerformance', icon: <ProjectOutlined />, element: <DirectorProgramsPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/director/portfolio', labelKey: 'nav.portfolio', icon: <FundProjectionScreenOutlined />, element: <DirectorPortfolioPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/director/sectors', labelKey: 'nav.sectors', icon: <PieChartOutlined />, element: <DirectorSectorsPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/director/structure', labelKey: 'nav.structure', icon: <ApartmentOutlined />, element: <DirectorStructurePage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true, showInNavWhenAnySetting: ['hasDepartments', 'hasBranches'] },
    { path: '/director/settings', labelKey: 'nav.companySettings', icon: <SettingOutlined />, element: <CompanySettingsPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/director/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <DirectorReportsPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/admin/users', labelKey: 'nav.users', icon: <UserOutlined />, element: <UserManagementPage />, allowedRoles: adminRoles, requiredPermission: 'manage_users', audiences: ['platform'], showInNav: true },
    { path: '/admin/consultant-verification', labelKey: 'nav.consultantVerification', icon: <SafetyCertificateOutlined />, element: <ConsultantVerificationPage />, allowedRoles: [USER_ROLES.SYSTEM_ADMIN], requiredPermission: 'manage_users', audiences: ['platform'], showInNav: true },
    { path: '/admin/usage', labelKey: 'nav.usageAnalytics', icon: <BarChartOutlined />, element: <UsageAnalyticsPage />, allowedRoles: adminRoles, audiences: ['platform'], showInNav: true },
    { path: '/admin/email-operations', labelKey: 'nav.emailOperations', icon: <MailOutlined />, element: <EmailOperationsPage />, allowedRoles: adminRoles, audiences: ['platform'], showInNav: true },
    { path: '/admin/company-change-requests', labelKey: 'nav.changeRequests', icon: <ExclamationCircleOutlined />, element: <SystemSettingsChangeRequestsPage />, allowedRoles: adminRoles, audiences: ['platform'], showInNav: true },
    {
        path: '/admin/agent-registry',
        labelKey: 'nav.agentRegistry',
        icon: <RobotOutlined />,
        element: <AgentRegistryPage />,
        allowedRoles: [USER_ROLES.SYSTEM_ADMIN],
        audiences: ['platform'], showInNav: true
    },
    {
        path: '/admin/agents',
        labelKey: 'nav.agentAvailability',
        icon: <SafetyCertificateOutlined />,
        element: <AgentAvailabilityPage />,
        allowedRoles: [USER_ROLES.SYSTEM_ADMIN, USER_ROLES.ADMIN],
        audiences: ['platform'], showInNav: true
    },
    { path: '/admin/agent-ratings', labelKey: 'nav.agentRatings', icon: <StarOutlined />, element: <AgentRatingsPage />, allowedRoles: [USER_ROLES.SYSTEM_ADMIN, USER_ROLES.ADMIN], audiences: ['platform'], showInNav: true },
    { path: '/settings', labelKey: 'nav.companySettings', icon: <SettingOutlined />, element: <CompanySettingsPage />, allowedRoles: allRoles, audiences: ['platform'], showInNav: false },
]
