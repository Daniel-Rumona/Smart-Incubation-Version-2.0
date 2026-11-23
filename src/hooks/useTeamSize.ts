import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSystemSettings } from '@/contexts/SystemSettingsContext'
import { setDirectorWorkspace } from '@/hooks/useDirectorWorkspace'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { updateDirectorTeamSize, type TeamSize } from '@/services/directorSetupService'

/**
 * Changing who runs the programme, shared by the Company settings card and the staff page's "you have a team now"
 * prompt, so both do the same thing: save it server-side, follow the second role in the session, reload the company
 * settings the menu reads, and, when leaving "Just me", go back to overseeing (the operations side is no longer theirs).
 */
export const useTeamSize = () => {
    const navigate = useNavigate()
    const { user, updateIdentity } = useFullIdentity()
    const { refresh: refreshSystemSettings } = useSystemSettings()

    /** Whether this account is a director running the programme alone (either side of the switch). */
    const isSoloDirector = user?.baseRole === 'director' && user.secondRole === 'operations'

    const changeTeamSize = useCallback(async (teamSize: TeamSize) => {
        const result = await updateDirectorTeamSize(teamSize)
        const secondRole = result.secondRole === 'operations' ? 'operations' as const : null
        updateIdentity({ secondRole })
        void refreshSystemSettings()
        if (!secondRole) {
            setDirectorWorkspace('overview')
            // A page only operations can open (such as Manage team) would refuse them now.
            if (user?.actingAs === 'operations') navigate('/director/settings')
        }
        return result
    }, [navigate, refreshSystemSettings, updateIdentity, user?.actingAs])

    /** "Add a team member": Manage team is an operations page, so switch to running the programme first. */
    const openManageTeam = useCallback(() => {
        setDirectorWorkspace('operations')
        navigate('/shared/staff/manage')
    }, [navigate])

    return { isSoloDirector, changeTeamSize, openManageTeam }
}
