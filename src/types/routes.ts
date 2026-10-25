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
  /** SMEs only: which journeys may use this page (see utils/smeJourney). Omitted = every journey. */
  smeJourneys?: SmeJourney[]
  /** Only listed in the menu once the SME has at least one intervention document. */
  showInNavWhenHasDocuments?: boolean
  showInNav?: boolean
  showInNavWhenAnySetting?: string[]
  groupKey?: string
  agentEnabled?: boolean
  agentActions?: string[]
  children?: AppRoute[]
}
