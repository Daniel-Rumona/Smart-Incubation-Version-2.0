import type { UserRole } from '@/config/roles'

/** Where a signed-in user's workspace starts, by role. Used by the shell and by the landing page's "continue" button. */
export const workspaceDashboardPath = (user?: { role?: UserRole, isApplicant?: boolean, smeJourney?: string } | null) => {
    // Applicants who chose consultants and agents get their own dashboard; programme applicants start at Programmes.
    if (user?.role === 'incubatee') return user.isApplicant ? (user.smeJourney === 'independent' ? '/applicant/dashboard' : '/applicant/programs') : '/incubatee'
    if (user?.role === 'consultant') return '/consultant'
    if (user?.role === 'projectadmin') return '/projectadmin'
    if (user?.role === 'director') return '/director'
    if (user?.role === 'admin') return '/reception'
    if (user?.role === 'funder') return '/funder'
    if (user?.role === 'operations' || user?.role === 'projectmanager') return '/operations'
    return '/dashboard'
}
