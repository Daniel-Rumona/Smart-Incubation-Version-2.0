import { useEffect, useState } from 'react'
import { App, Empty } from 'antd'
import DashboardPage from '@/components/shared/DashboardPage'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { AppointmentInvitations } from '@/components/incubatee/AppointmentInvitations'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useLanguage } from '@/providers/LanguageProvider'
import { loadIncubateeWorkspace } from '@/services/incubateeWorkspaceService'
import type { IncubateeWorkspace } from '@/types/incubatee'
import '@/styles/incubatee.css'

/**
 * The SME's upcoming sessions on their own page. Training SMEs have no interventions page in their menu, where
 * other SMEs answer appointment invitations, so they accept or decline them here.
 */
export default function IncubateeAppointmentsPage() {
    const { t } = useLanguage()
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const [workspace, setWorkspace] = useState<IncubateeWorkspace | null>()

    const load = async () => {
        if (!user) return
        try {
            setWorkspace(await loadIncubateeWorkspace(user))
        } catch (error) {
            console.error('Could not load the incubatee workspace.', error)
            message.error(t('incubatee.common.loadError'))
            setWorkspace(null)
        }
    }

    useEffect(() => {
        const timeout = window.setTimeout(() => void load(), 0)
        return () => window.clearTimeout(timeout)
    }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

    if (workspace === undefined) return <PageSkeleton variant="detail" label={t('Loading your appointments')} />
    if (!workspace) return <DashboardPage><Empty description={t('incubatee.common.noAcceptedProgram')} /></DashboardPage>

    return (
        <DashboardPage className="incubatee-page">
            <AppointmentInvitations workspace={workspace} upcoming onChanged={() => void load()} />
        </DashboardPage>
    )
}
