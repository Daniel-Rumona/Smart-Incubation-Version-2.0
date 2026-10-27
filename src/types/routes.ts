import type { ReactNode } from 'react'
import type { UserRole } from '@/config/roles'
import type { SmeJourney, WorkspaceAudience } from '@/types/identity'
import type { IdentityPermission } from '@/types/identity'

export type AppRoute = {
  path: string
  labelKey: string
  icon?: ReactNode
  element?: ReactNode
  allowedRoles: UserRole[]
  requiredPermission?: IdentityPermission
  audiences?: WorkspaceAudience[]
  /** Only reachable inside the platform owner's (QTX) workspace: its own staff, and the SMEs that fall back to it. */
  platformOwnerOnly?: boolean
  /** Hidden from freelance (marketplace) consultants, who work outside any company's goals and settings. */
  hideFromMarketplaceConsultants?: boolean
  /** Only for freelance (marketplace) consultants, e.g. their marketplace requests. */
  marketplaceConsultantsOnly?: boolean
  /** SMEs only: which journeys may use this page (see utils/smeJourney). Omitted = every journey. */
  smeJourneys?: SmeJourney[]
  /** SMEs only: listed in the menu just for SMEs whose programmes are all Training (see SystemLayout). */
  trainingSmesOnly?: boolean
  /** Only listed in the menu once the SME has at least one intervention document. */
  showInNavWhenHasDocuments?: boolean
  /** Independent SMEs (no programme) only see it in the menu and top bar once they've applied to a programme. */
  showInNavWhenHasApplications?: boolean
  /** Independent SMEs (who chose consultants and agents) only see it in the menu once they ask to see programmes. */
  programmesOptIn?: boolean
  showInNav?: boolean
  showInNavWhenAnySetting?: string[]
  /** Only listed in the menu when each of these company settings has exactly this value. */
  showInNavWhenSettingEquals?: Record<string, string>
  groupKey?: string
  agentEnabled?: boolean
  agentActions?: string[]
  children?: AppRoute[]
}
