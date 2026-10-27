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

/** Routes kept from, or kept for, freelance consultants; other routes are unaffected. */
export const marketplaceConsultantAllows = (route: AppRoute, user?: Parameters<typeof hasConsultantMarketplaceProfile>[0]) =>
    (!route.hideFromMarketplaceConsultants || !hasConsultantMarketplaceProfile(user))
    && (!route.marketplaceConsultantsOnly || hasConsultantMarketplaceProfile(user))

/**
 * Programme applicants keep to their programme; the Agentic workspace is for independent and accepted SMEs.
 * An SME still onboarding (no journey yet), or with a programme link waiting to be joined, needs the onboarding
 * page itself: it runs the join, so Agentic must not cover it.
 */
export const journeyAllowsAgentic = (user?: Pick<FullIdentity, 'role' | 'isApplicant' | 'smeJourney' | 'pendingProgramId'> | null) =>
    !(user?.role === 'incubatee' && user.isApplicant && (user.smeJourney === 'programme' || !user.smeJourney || !!user.pendingProgramId))
