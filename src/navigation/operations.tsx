// src/navigation/operations.tsx

import {
    ApartmentOutlined,
    AuditOutlined,
    BarChartOutlined,
    CalendarOutlined,
    ClockCircleOutlined,
    DashboardOutlined,
    DeploymentUnitOutlined,
    ExclamationCircleOutlined,
    FileProtectOutlined,
    FileSearchOutlined,
    FundProjectionScreenOutlined,
    IdcardOutlined,
    RobotOutlined,
    SafetyCertificateOutlined,
    ScheduleOutlined,
    SettingOutlined,
    TeamOutlined,
    UserSwitchOutlined,
} from '@ant-design/icons'

import { Link } from 'react-router-dom'
import type { MenuProps } from 'antd'
import { tr } from '@/providers/LanguageProvider'

type SystemMenuItem = NonNullable<MenuProps['items']>[number]

export function getOperationsMenu(): SystemMenuItem[] {
    return [
        {
            key: '/operations',
            icon: <DashboardOutlined />,
            label: <Link to="/operations">{tr('Dashboard')}</Link>,
        },
        {
            key: '/operations/clock',
            icon: <ClockCircleOutlined />,
            label: <Link to="/operations/clock">{tr('Timesheet')}</Link>,
        },
        {
            key: '/operations/team-workroom',
            icon: <TeamOutlined />,
            label: tr('Team Workroom'),
            children: [
                {
                    key: '/operations/coordinators',
                    icon: <UserSwitchOutlined />,
                    label: <Link to="/operations/coordinators">{tr('Manage')}</Link>,
                },
                {
                    key: '/operations/activity',
                    icon: <BarChartOutlined />,
                    label: <Link to="/operations/activity">{tr('Activity')}</Link>,
                },
                {
                    key: '/operations/tasks',
                    icon: <ScheduleOutlined />,
                    label: <Link to="/operations/tasks">{tr('Tasks')}</Link>,
                },
            ],
        },
        {
            key: '/operations/participant-workspace',
            icon: <IdcardOutlined />,
            label: tr('Participants'),
            children: [
                {
                    key: '/operations/applications',
                    icon: <AuditOutlined />,
                    label: <Link to="/operations/applications">{tr('Applications')}</Link>,
                },
                {
                    key: '/operations/incubatees',
                    icon: <ApartmentOutlined />,
                    label: <Link to="/operations/incubatees">{tr('Participants')}</Link>,
                },
                {
                    key: '/operations/participants/compliance',
                    icon: <SafetyCertificateOutlined />,
                    label: <Link to="/operations/participants/compliance">{tr('Compliance')}</Link>,
                },
                {
                    key: '/operations/risk-register',
                    icon: <ExclamationCircleOutlined />,
                    label: <Link to="/operations/risk-register">{tr('Risk Register')}</Link>,
                },
            ],
        },
        {
            key: '/operations/diagnostic-plans',
            icon: <FileSearchOutlined />,
            label: <Link to="/operations/diagnostic-plans">{tr('Diagnostic Plans')}</Link>,
        },
        {
            key: '/operations/intervention-workspace',
            icon: <DeploymentUnitOutlined />,
            label: tr('Interventions'),
            children: [
                {
                    key: '/operations/assignments',
                    icon: <DeploymentUnitOutlined />,
                    label: <Link to="/operations/assignments">{tr('Assignments')}</Link>,
                },
                {
                    key: '/operations/interventions/monitoring',
                    icon: <BarChartOutlined />,
                    label: <Link to="/operations/interventions/monitoring">{tr('Monitoring')}</Link>,
                },
                {
                    key: '/operations/appointments',
                    icon: <CalendarOutlined />,
                    label: <Link to="/operations/appointments">{tr('Appointments')}</Link>,
                },
                {
                    key: '/operations/movs',
                    icon: <FileProtectOutlined />,
                    label: <Link to="/operations/movs">{tr('MOVs')}</Link>,
                },
                {
                    key: '/operations/interventions/setup',
                    icon: <SettingOutlined />,
                    label: <Link to="/operations/interventions/setup">{tr('Setup')}</Link>,
                },
            ],
        },
        {
            key: '/operations/reports',
            icon: <BarChartOutlined />,
            label: <Link to="/operations/reports">{tr('Reports')}</Link>,
        },
        {
            key: '/operations/impact-analysis',
            icon: <FundProjectionScreenOutlined />,
            label: <Link to="/operations/impact-analysis">{tr('Impact Analysis')}</Link>,
        },
        {
            key: '/operations/assistant',
            icon: <RobotOutlined />,
            label: <Link to="/operations/assistant">{tr('Agent Assistant')}</Link>,
        },
    ]
}
