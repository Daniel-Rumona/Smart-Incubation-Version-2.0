import { Empty } from 'antd'
import DashboardHeader from '@/components/shared/DashboardHeader'
import DashboardPageShell from '@/components/shared/DashboardPage'
import { useRegisterAgentPageContext } from '@/context/AgentPageContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { SystemAdminDashboardPage } from '@/pages/admin/SystemAdminDashboardPage'
import { useLanguage, tr } from '@/providers/LanguageProvider'

export const DashboardPage = () => {
    const { t } = useLanguage()
    const { user } = useFullIdentity()
    useRegisterAgentPageContext({
        pageKey: 'dashboard',
        pageName: 'Dashboard',
        purpose: 'Workspace overview and starting point for role-aware platform activity.',
    })

    if (user?.role === 'systemadmin' || user?.role === 'admin') return <SystemAdminDashboardPage />

    return (
        <DashboardPageShell>
            <DashboardHeader title={t('Dashboard')} subtitle={tr('Your workspace foundation is ready for the restored modules.')} />
            <Empty description={t('Dashboard modules are being restored.')} />
        </DashboardPageShell>
    )
}
