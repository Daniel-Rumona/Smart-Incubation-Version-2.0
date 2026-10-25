import type { SmeJourney } from '@/types/identity'

const PROGRAMME_PATHS = new Set(['program_link', 'company_program', 'open_program'])

/**
 * Which way an SME came in, from what the join server records (functions/src/programJoin.ts):
 * - 'programme': arrived through a programme link or chose a programme, so they see only their programme;
 * - 'independent': chose the marketplace or skipped, so they get the marketplace, Agentic and "Find a programme".
 * Accepted SMEs are in a programme by definition. Undefined until an SME has finished onboarding.
 */
export const resolveSmeJourney = (profile: Record<string, unknown> | undefined, isApplicant: boolean): SmeJourney | undefined => {
    if (!isApplicant) return 'programme'
    const onboarding = (profile?.smeOnboarding || {}) as Record<string, unknown>
    const assigned = Array.isArray(profile?.assignedProgramIds) && profile.assignedProgramIds.length > 0
    if (PROGRAMME_PATHS.has(String(onboarding.path || '')) || onboarding.selectedProgramId || assigned) return 'programme'
    if (profile?.smeOnboardingComplete === false) return undefined
    return 'independent'
}

/** The programme link remembered on the account (see programLinkService.rememberProgramLinkOnAccount). */
export const pendingProgramIdFrom = (profile: Record<string, unknown> | undefined) => {
    const link = (profile?.pendingProgramLink || {}) as Record<string, unknown>
    return typeof link.programId === 'string' && link.programId ? link.programId : null
}
