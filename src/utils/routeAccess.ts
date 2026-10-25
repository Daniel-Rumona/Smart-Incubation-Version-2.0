import type { FullIdentity } from '@/types/identity'
import type { AppRoute } from '@/types/routes'
import { hasConsultantMarketplaceProfile } from '@/services/companiesService'

/**
 * Whether an SME's journey allows a route. Non-SMEs, routes without a journey list, and SMEs who have
 * not finished onboarding (no journey yet) are unaffected.
 */
export const journeyAllows = (route: AppRoute, user?: Pick<FullIdentity, 'role' | 'smeJourney'> | null) =>
    !route.smeJourneys
    || user?.role !== 'incubatee'
    || !user.smeJourney
    || route.smeJourneys.includes(user.smeJourney)

/** Whether a freelance consultant may use a route; company consultants and other roles are unaffected. */
export const marketplaceConsultantAllows = (route: AppRoute, user?: Parameters<typeof hasConsultantMarketplaceProfile>[0]) =>
    !route.hideFromMarketplaceConsultants || !hasConsultantMarketplaceProfile(user)

/** Programme applicants keep to their programme; the Agentic workspace is for independent and accepted SMEs. */
export const journeyAllowsAgentic = (user?: Pick<FullIdentity, 'role' | 'isApplicant' | 'smeJourney'> | null) =>
    !(user?.role === 'incubatee' && user.isApplicant && user.smeJourney === 'programme')
