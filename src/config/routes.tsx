import {
    AimOutlined,
    ApartmentOutlined,
    BellOutlined,
    DollarOutlined,
    AuditOutlined,
    ExperimentOutlined,
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
    ReadOutlined,
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
import SetPasswordPage from '@/pages/auth/SetPasswordPage'
import { WelcomePage } from '@/pages/welcome/WelcomePage'
import JoinProgramPage from '@/pages/join/JoinProgramPage'
import { DashboardPage } from '@/pages/dashboard/DashboardPage'
import LandingPage from '@/pages/landing/LandingPage'
import { ComingSoonPage } from '@/pages/system/ComingSoonPage'
import { ApplicantProfilePage } from '@/pages/applicant/ApplicantProfilePage'
import { ApplicationTrackerPage } from '@/pages/applicant/ApplicationTrackerPage'
import { ProgramsDiscoveryPage } from '@/pages/applicant/ProgramsDiscoveryPage'
import { UsageAnalyticsPage } from '@/pages/admin/UsageAnalyticsPage'
import { PlatformKpisPage } from '@/pages/admin/PlatformKpisPage'
import { UserManagementPage } from '@/pages/admin/UserManagementPage'
import { EmailOperationsPage } from '@/pages/admin/EmailOperationsPage'
import { SystemSettingsChangeRequestsPage } from '@/pages/admin/SystemSettingsChangeRequestsPage'
import AgentAvailabilityPage from '@/pages/admin/AgentAvailabilityPage'
import AgentRegistryPage from '@/pages/admin/AgentRegistryPage'
import CompanyPlansPage from '@/pages/admin/CompanyPlansPage'
import AgentRatingsPage from '@/pages/admin/AgentRatingsPage'
import ConsultantVerificationPage from '@/pages/admin/ConsultantVerificationPage'
import SalesPitchPage from '@/pages/admin/SalesPitchPage'
import DirectorDashboardPage from '@/pages/director/DirectorDashboardPage'
import { DirectorPortfolioPage } from '@/pages/director/DirectorPortfolioPage'
import { DirectorSectorsPage } from '@/pages/director/DirectorSectorsPage'
import { DirectorProgramsPage } from '@/pages/director/DirectorProgramsPage'
import { DirectorStructurePage } from '@/pages/director/DirectorStructurePage'
import { DirectorReportsPage } from '@/pages/director/DirectorReportsPage'
import { Navigate } from 'react-router-dom'
import { ApplicationsReviewPage } from '@/pages/operations/ApplicationsReviewPage'
import OperationsDashboardPage from '@/pages/dashboards/operations/OperationsDashboardPage'
import { CompliancePage } from '@/pages/operations/CompliancePage'
import ParticipantsPage from '@/pages/operations/ParticipantsPage'
import SmeMetricsPage from '@/pages/operations/SmeMetricsPage'
import { ParticipantOnboardingPage } from '@/pages/operations/ParticipantOnboardingPage'
import { StaffPage } from '@/pages/shared/StaffPage'
import { DiagnosticPlansPage } from '@/pages/operations/DiagnosticPlansPage'
import RiskRegisterPage from '@/pages/operations/RiskRegisterPage'
import SmeControlTowerPage from '@/pages/operations/SmeControlTowerPage'
import ImpactAnalysisPage from '@/pages/operations/ImpactAnalysisPage'
import OperationsReportsPage from '@/pages/operations/OperationsReportsPage'
import KpisPage from '@/pages/kpis/KpisPage'
import ProgramsPage from '@/pages/operations/ProgramsPage'
import SurveysPage from '@/pages/operations/surveys/SurveysPage'
import IncubateeSurveysPage from '@/pages/incubatee/surveys/IncubateeSurveysPage'
import SurveyResponsePage from '@/pages/incubatee/surveys/SurveyResponsePage'
import SurveyBuilderPage from '@/pages/operations/surveys/SurveyBuilderPage'
import LmsPage from '@/pages/operations/lms/LmsPage'
import CourseBuilderPage from '@/pages/operations/lms/CourseBuilderPage'
import IncubateeCoursesPage from '@/pages/incubatee/lms/IncubateeCoursesPage'
import CourseLessonPage from '@/pages/incubatee/lms/CourseLessonPage'
import ConsultantConnectionRequestsPage from '@/pages/operations/ConsultantConnectionRequestsPage'
import { OperationsTasksPage } from '@/pages/operations/OperationsTasksPage'
import ProjectAdminDashboardPage from '@/pages/projectadmin/ProjectAdminDashboardPage'
import ProjectAdminReportsPage from '@/pages/projectadmin/ProjectAdminReportsPage'
import ProjectAdminEsgPage from '@/pages/projectadmin/ProjectAdminEsgPage'
import ProjectAdminEsgPerformancePage from '@/pages/projectadmin/ProjectAdminEsgPerformancePage'
import { IncubateeDashboardPage } from '@/pages/incubatee/IncubateeDashboardPage'
import { IncubateeInterventionsPage } from '@/pages/incubatee/IncubateeInterventionsPage'
import IncubateeDiagnosticPlanPage from '@/pages/incubatee/IncubateeDiagnosticPlanPage'
import IncubateePlanReadyPage from '@/pages/incubatee/IncubateePlanReadyPage'
import IncubateeCompliancePage from '@/pages/incubatee/IncubateeCompliancePage'
import IncubateeMetricsPage from '@/pages/incubatee/IncubateeMetricsPage'
import IncubateeRoadmapPage from '@/pages/incubatee/IncubateeRoadmapPage'
import AgentWorkspacePage from '@/pages/incubatee/AgentWorkspacePage'
import PitchCoachPage from '@/pages/incubatee/PitchCoachPage'
import ConsultantDashboardPage from '@/pages/consultant/ConsultantDashboardPage'
import ConsultantFeedbackPage from '@/pages/consultant/ConsultantFeedbackPage'
import ConsultantReportsPage from '@/pages/consultant/ConsultantReportsPage'
import ConsultantProfilePage from '@/pages/consultant/ConsultantProfilePage'
import UserProfilePage from '@/pages/profile/UserProfilePage'
import NotificationCenterPage from '@/pages/notifications/NotificationCenterPage'
import ConsultantSmesPage from '@/pages/consultant/ConsultantSmesPage'
import SmeOnboardingPage from '@/pages/applicant/SmeOnboardingPage'
import ProviderMarketplacePage from '@/pages/applicant/ProviderMarketplacePage'
import { AllocatedInterventions } from '@/pages/interventions/AllocatedInterventionsPage'
import { InterventionsAssignemnts } from '@/pages/interventions/InterventionsAssignmentsPage'
import { InterventionAppointmentsPage } from '@/pages/interventions/InterventionAppointmentsPage'
import { AppointmentsRedirect } from '@/pages/interventions/AppointmentsRedirect'
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
    { path: '/set-password', labelKey: 'nav.setPassword', element: SetPasswordPage },
    { path: '/welcome', labelKey: 'nav.welcome', element: WelcomePage },
    { path: '/join/:programId', labelKey: 'nav.join', element: JoinProgramPage },
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
        requiredPermission: 'view_dashboard',
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
        // Programme applicants stay focused on their programme while they wait.
        smeJourneys: ['independent'],
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
    // Opened from the dashboard once per sign-in while the growth plan waits for the SME's confirmation.
    { path: '/incubatee/plan-ready', labelKey: 'nav.myDiagnosticPlan', icon: <FileSearchOutlined />, element: <IncubateePlanReadyPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/business-plan', labelKey: 'nav.businessPlan', icon: <FileWordOutlined />, element: <AgentWorkspacePage agentId="business-plan" />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false, agentEnabled: true, agentActions: ['explain_business_plan'] },
    { path: '/incubatee/strategic-plan', labelKey: 'nav.strategicPlan', icon: <FileWordOutlined />, element: <AgentWorkspacePage agentId="strategic-plan" />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false, agentEnabled: true, agentActions: ['explain_strategic_plan'] },
    { path: '/incubatee/pitch-coach', labelKey: 'nav.pitchCoach', icon: <AudioOutlined />, element: <PitchCoachPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false, agentEnabled: true, agentActions: ['create_pitch_project', 'score_pitch_transcript'] },
    { path: '/incubatee/interventions', labelKey: 'nav.interventions', icon: <FormOutlined />, element: <IncubateeInterventionsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    // Same business profile form as /applicant/profile, without the application journey; reached from "My profile".
    { path: '/incubatee/profile', labelKey: 'nav.profile', icon: <ProfileOutlined />, element: <ApplicantProfilePage mode="incubatee" />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/documents', labelKey: 'nav.documentLibrary', icon: <FolderOpenOutlined />, element: <InterventionDocumentsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    // Independent SMEs get the same library of their own documents, listed once they have any.
    { path: '/applicant/documents', labelKey: 'nav.documentLibrary', icon: <FolderOpenOutlined />, element: <InterventionDocumentsPage />, allowedRoles: incubateeRoles, audiences: ['applicant'], smeJourneys: ['independent'], showInNavWhenHasDocuments: true, showInNav: true },
    { path: '/incubatee/tracker', labelKey: 'nav.interventions', icon: <FormOutlined />, element: <IncubateeInterventionsPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/surveys', labelKey: 'nav.surveys', icon: <FormOutlined />, element: <IncubateeSurveysPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/surveys/:id', labelKey: 'nav.surveys', icon: <FormOutlined />, element: <SurveyResponsePage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/lms', labelKey: 'nav.courses', icon: <ReadOutlined />, element: <IncubateeCoursesPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/incubatee/lms/:id', labelKey: 'nav.courses', icon: <ReadOutlined />, element: <CourseLessonPage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: false },
    { path: '/incubatee/compliance', labelKey: 'nav.compliance', icon: <SafetyCertificateOutlined />, element: <IncubateeCompliancePage />, allowedRoles: incubateeRoles, audiences: ['incubatee'], showInNav: true },
    { path: '/consultant', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <ConsultantDashboardPage />, allowedRoles: consultantRoles, requiredPermission: 'view_dashboard', audiences: ['operations'], showInNav: true },
    { path: '/consultant/profile', labelKey: 'nav.consultantProfile', icon: <UserOutlined />, element: <ConsultantProfilePage />, allowedRoles: consultantRoles, audiences: ['operations'], showInNav: false },
    { path: '/consultant/smes', labelKey: 'nav.mySmes', icon: <TeamOutlined />, element: <ConsultantSmesPage />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/consultant/interventions', labelKey: 'nav.myInterventions', icon: <FormOutlined />, element: <AllocatedInterventions />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/consultant/allocated', labelKey: 'nav.myInterventions', icon: <FormOutlined />, element: <AllocatedInterventions />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: false },
    // Same page and URL as the staff entry under Interventions; listed here so it sits in the facilitator menu.
    { path: '/shared/interventions/appointments', labelKey: 'nav.appointments', icon: <CalendarOutlined />, element: <InterventionAppointmentsPage />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/consultant/appointments', labelKey: 'nav.appointments', icon: <CalendarOutlined />, element: <AppointmentsRedirect />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: false },
    { path: '/consultant/feedback', labelKey: 'nav.smeFeedback', icon: <MessageOutlined />, element: <ConsultantFeedbackPage />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/consultant/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <ConsultantReportsPage />, allowedRoles: consultantRoles, requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <ProjectAdminDashboardPage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_dashboard', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <ProjectAdminReportsPage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin/esg', labelKey: 'nav.esgScorecard', icon: <FundProjectionScreenOutlined />, element: <ProjectAdminEsgPage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
    { path: '/projectadmin/esg/performance', labelKey: 'nav.esgPerformance', icon: <TeamOutlined />, element: <ProjectAdminEsgPerformancePage />, allowedRoles: projectAdminRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: false },
    { path: '/operations', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <OperationsDashboardPage />, allowedRoles: operationsDashboardRoles, requiredPermission: 'view_dashboard', audiences: ['operations'], showInNav: true },
    { path: '/operations/programs', labelKey: 'nav.programs', icon: <ProjectOutlined />, element: <ProgramsPage />, allowedRoles: [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS], requiredPermission: 'manage_programs', audiences: ['operations'], showInNav: true },
    // Compatibility path for older links. The visible task entry lives under Staff > Tasks.
    { path: '/operations/tasks', labelKey: 'nav.tasks', icon: <CalendarOutlined />, element: <OperationsTasksPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    // Compatibility path for older links to the shared appointments page.
    { path: '/operations/interventions/appointments', labelKey: 'nav.appointments', icon: <CalendarOutlined />, element: <AppointmentsRedirect />, allowedRoles: [...interventionWorkspaceRoles, ...consultantRoles], requiredPermission: 'track_interventions', audiences: ['operations'], showInNav: false },
    {
        path: '/shared/staff',
        labelKey: 'nav.staff',
        icon: <TeamOutlined />,
        element: placeholder,
        allowedRoles: applicationReviewRoles,
        requiredPermission: 'view_staff',
        audiences: ['operations'],
        showInNav: true,
        children: [
            { path: '/shared/staff/tasks', labelKey: 'nav.tasks', icon: <CalendarOutlined />, element: <OperationsTasksPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_staff', audiences: ['operations'], showInNav: true },
            { path: '/shared/staff/manage', labelKey: 'nav.manageTeam', icon: <UserSwitchOutlined />, element: <StaffPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'manage_staff', audiences: ['operations'], showInNav: true },
        ],
    },
    { path: '/shared/applications', labelKey: 'nav.applications', icon: <AuditOutlined />, element: <ApplicationsReviewPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_applications', audiences: ['operations'], showInNav: true },
    { path: '/operations/participants/applications', labelKey: 'nav.applications', icon: <AuditOutlined />, element: <Navigate to="/shared/applications" replace />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_applications', audiences: ['operations'], showInNav: false },
    {
        path: '/operations/participants',
        labelKey: 'nav.participants',
        icon: <IdcardOutlined />,
        element: placeholder,
        allowedRoles: operationsRoles,
        audiences: ['operations'],
        showInNav: true,
        children: [
            { path: '/operations/participants/diagnostic-plans', labelKey: 'nav.diagnosticPlans', icon: <FileSearchOutlined />, element: <DiagnosticPlansPage />, allowedRoles: operationsRoles, requiredPermission: 'view_diagnostic_plans', audiences: ['operations'], showInNav: true },
            { path: '/shared/participants', labelKey: 'nav.viewAll', icon: <ApartmentOutlined />, element: <ParticipantsPage />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: true },
            // Old address, kept so bookmarks and links still land on the participants list.
            { path: '/operations/participants/all', labelKey: 'nav.viewAll', icon: <ApartmentOutlined />, element: <Navigate to="/shared/participants" replace />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: false },
            { path: '/operations/participants/metrics', labelKey: 'nav.metrics', icon: <BarChartOutlined />, element: <SmeMetricsPage />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/control-tower', labelKey: 'nav.controlTower', icon: <FundProjectionScreenOutlined />, element: <SmeControlTowerPage />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/control-tower/:participantId', labelKey: 'nav.controlTower', icon: <FundProjectionScreenOutlined />, element: <SmeControlTowerPage />, allowedRoles: operationsRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: false },
            { path: '/operations/participants/compliance', labelKey: 'nav.compliance', icon: <SafetyCertificateOutlined />, element: <CompliancePage />, allowedRoles: complianceRoles, requiredPermission: 'view_compliance', audiences: ['operations'], showInNav: true },
            { path: '/operations/participants/new', labelKey: 'operations.participants.add', icon: <UserOutlined />, element: <ParticipantOnboardingPage />, allowedRoles: applicationReviewRoles, requiredPermission: 'view_participants', audiences: ['operations'], showInNav: false },
        ],
    },
    { path: '/operations/connection-requests', labelKey: 'nav.connectionRequests', icon: <TeamOutlined />, element: <ConsultantConnectionRequestsPage />, allowedRoles: operationsRoles, audiences: ['operations'], platformOwnerOnly: true, showInNav: true },
    { path: '/operations/risk-register', labelKey: 'nav.riskRegister', icon: <ExclamationCircleOutlined />, element: <RiskRegisterPage />, allowedRoles: operationsRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
    { path: '/operations/impact-analysis', labelKey: 'nav.impactAnalysis', icon: <FundProjectionScreenOutlined />, element: <ImpactAnalysisPage />, allowedRoles: operationsRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
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
                path: '/shared/interventions/appointments',
                labelKey: 'nav.appointments',
                icon: <CalendarOutlined />,
                element: <InterventionAppointmentsPage />,
                allowedRoles: interventionWorkspaceRoles,
                requiredPermission: 'track_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            {
                path: '/shared/interventions/setup',
                labelKey: 'nav.setup',
                icon: <SettingOutlined />,
                element: <InterventionsSetupPage />,
                allowedRoles: interventionWorkspaceRoles,
                requiredPermission: 'manage_interventions',
                audiences: ['operations'],
                showInNav: true,
            },
            { path: '/operations/interventions/setup', labelKey: 'nav.setup', icon: <SettingOutlined />, element: <Navigate to="/shared/interventions/setup" replace />, allowedRoles: interventionWorkspaceRoles, requiredPermission: 'manage_interventions', audiences: ['operations'], showInNav: false },
        ],
    },
    { path: '/operations/surveys', labelKey: 'nav.surveys', icon: <FormOutlined />, element: <SurveysPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: true },
    { path: '/operations/surveys/builder', labelKey: 'nav.surveyBuilder', icon: <FormOutlined />, element: <SurveyBuilderPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    { path: '/operations/surveys/builder/:id', labelKey: 'nav.surveyBuilder', icon: <FormOutlined />, element: <SurveyBuilderPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    { path: '/operations/lms', labelKey: 'nav.courses', icon: <ReadOutlined />, element: <LmsPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: true },
    { path: '/operations/lms/builder', labelKey: 'nav.courseBuilder', icon: <ReadOutlined />, element: <CourseBuilderPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    { path: '/operations/lms/builder/:id', labelKey: 'nav.courseBuilder', icon: <ReadOutlined />, element: <CourseBuilderPage />, allowedRoles: operationsRoles, audiences: ['operations'], showInNav: false },
    { path: '/operations/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <OperationsReportsPage />, allowedRoles: operationsDashboardRoles, requiredPermission: 'view_reports', audiences: ['operations'], showInNav: true },
    // One KPIs page for every role that works with company programme KPIs; editing is limited to operations and directors inside the page (and in firestore.rules).
    // Platform admins use System KPIs (/admin/kpis) instead, so they are left out here.
    { path: '/kpis', labelKey: 'nav.kpis', icon: <AimOutlined />, element: <KpisPage />, allowedRoles: [USER_ROLES.DIRECTOR, USER_ROLES.PROJECT_MANAGER, USER_ROLES.OPERATIONS, USER_ROLES.PROJECT_ADMIN, USER_ROLES.CONSULTANT], audiences: ['operations', 'platform'], hideFromMarketplaceConsultants: true, showInNav: true },
    { path: '/director', labelKey: 'nav.dashboard', icon: <DashboardOutlined />, element: <DirectorDashboardPage />, allowedRoles: directorRoles, requiredPermission: 'view_dashboard', audiences: ['platform'], showInNav: true },
    { path: '/director/programs', labelKey: 'nav.programPerformance', icon: <ProjectOutlined />, element: <DirectorProgramsPage />, allowedRoles: directorRoles, requiredPermission: 'view_reports', audiences: ['platform'], showInNav: true },
    { path: '/director/portfolio', labelKey: 'nav.portfolio', icon: <FundProjectionScreenOutlined />, element: <DirectorPortfolioPage />, allowedRoles: directorRoles, requiredPermission: 'view_reports', audiences: ['platform'], showInNav: true },
    { path: '/director/sectors', labelKey: 'nav.sectors', icon: <PieChartOutlined />, element: <DirectorSectorsPage />, allowedRoles: directorRoles, requiredPermission: 'view_reports', audiences: ['platform'], showInNav: true },
    { path: '/director/structure', labelKey: 'nav.structure', icon: <ApartmentOutlined />, element: <DirectorStructurePage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true, showInNavWhenAnySetting: ['hasDepartments', 'hasBranches'] },
    { path: '/operations/structure', labelKey: 'nav.structure', icon: <ApartmentOutlined />, element: <DirectorStructurePage />, allowedRoles: [USER_ROLES.PROJECT_ADMIN, USER_ROLES.OPERATIONS], audiences: ['operations'], showInNav: true, showInNavWhenAnySetting: ['hasDepartments', 'hasBranches'] },
    { path: '/director/settings', labelKey: 'nav.companySettings', icon: <SettingOutlined />, element: <CompanySettingsPage />, allowedRoles: directorRoles, audiences: ['platform'], showInNav: true },
    { path: '/director/reports', labelKey: 'nav.reports', icon: <BarChartOutlined />, element: <DirectorReportsPage />, allowedRoles: directorRoles, requiredPermission: 'view_reports', audiences: ['platform'], showInNav: true },
    { path: '/admin/users', labelKey: 'nav.users', icon: <UserOutlined />, element: <UserManagementPage />, allowedRoles: adminRoles, requiredPermission: 'manage_users', audiences: ['platform'], showInNav: true },
    { path: '/admin/consultant-verification', labelKey: 'nav.consultantVerification', icon: <SafetyCertificateOutlined />, element: <ConsultantVerificationPage />, allowedRoles: [USER_ROLES.SYSTEM_ADMIN], requiredPermission: 'manage_users', audiences: ['platform'], showInNav: true },
    { path: '/admin/usage', labelKey: 'nav.usageAnalytics', icon: <BarChartOutlined />, element: <UsageAnalyticsPage />, allowedRoles: adminRoles, requiredPermission: 'view_usage_analytics', audiences: ['platform'], showInNav: true },
    { path: '/admin/kpis', labelKey: 'nav.systemKpis', icon: <AimOutlined />, element: <PlatformKpisPage />, allowedRoles: adminRoles, requiredPermission: 'view_usage_analytics', audiences: ['platform'], showInNav: true },
    { path: '/admin/email-operations', labelKey: 'nav.emailOperations', icon: <MailOutlined />, element: <EmailOperationsPage />, allowedRoles: adminRoles, requiredPermission: 'view_email_operations', audiences: ['platform'], showInNav: true },
    { path: '/admin/company-change-requests', labelKey: 'nav.changeRequests', icon: <ExclamationCircleOutlined />, element: <SystemSettingsChangeRequestsPage />, allowedRoles: adminRoles, requiredPermission: 'manage_users', audiences: ['platform'], showInNav: true },
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
    { path: '/admin/plans', labelKey: 'nav.companyPlans', icon: <DollarOutlined />, element: <CompanyPlansPage />, allowedRoles: adminRoles, requiredPermission: 'manage_users', audiences: ['platform'], showInNav: true },
    { path: '/admin/agent-ratings', labelKey: 'nav.agentRatings', icon: <StarOutlined />, element: <AgentRatingsPage />, allowedRoles: [USER_ROLES.SYSTEM_ADMIN, USER_ROLES.ADMIN], audiences: ['platform'], showInNav: true },
    { path: '/admin/sales-pitch', labelKey: 'nav.salesPitch', icon: <ExperimentOutlined />, element: <SalesPitchPage />, allowedRoles: [USER_ROLES.SYSTEM_ADMIN], audiences: ['platform'], showInNav: true },
    { path: '/notifications', labelKey: 'nav.notifications', icon: <BellOutlined />, element: <NotificationCenterPage />, allowedRoles: [USER_ROLES.INCUBATEE, USER_ROLES.OPERATIONS, USER_ROLES.PROJECT_ADMIN, USER_ROLES.PROJECT_MANAGER, USER_ROLES.CONSULTANT], audiences: ['platform', 'applicant', 'incubatee', 'operations'], showInNav: false },
    { path: '/profile', labelKey: 'nav.profile', icon: <ProfileOutlined />, element: <UserProfilePage />, allowedRoles: allRoles.filter(role => role !== USER_ROLES.INCUBATEE), audiences: ['platform'], showInNav: false },
    { path: '/settings', labelKey: 'nav.companySettings', icon: <SettingOutlined />, element: <CompanySettingsPage />, allowedRoles: allRoles, audiences: ['platform'], showInNav: false },
]
