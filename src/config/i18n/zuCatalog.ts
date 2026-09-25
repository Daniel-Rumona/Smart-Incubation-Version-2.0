import { zuAccount } from './zu/account'
import { zuAdmin } from './zu/admin'
import { zuApplicant } from './zu/applicant'
import { zuCore } from './zu/core'
import { zuDirector } from './zu/director'
import { zuExtra } from './zu/extra'
import { zuForms } from './zu/forms'
import { zuIncubatee } from './zu/incubatee'
import { zuLanding } from './zu/landing'
import { zuLegacy } from './zu/legacy'
import { zuFragments } from './zu/fragments'
import { zuInterventions } from './zu/interventions'
import { zuNavigation } from './zu/navigation'
import { zuOperations } from './zu/operations'
import { zuPrompts } from './zu/prompts'
import { zuReports } from './zu/reports'

/** isiZulu translations keyed by the English source text passed to t(). Per-area files keep review manageable. */
export const zuCatalog: Record<string, string> = {
  ...zuCore,
  ...zuAccount,
  ...zuAdmin,
  ...zuApplicant,
  ...zuIncubatee,
  ...zuInterventions,
  ...zuDirector,
  ...zuOperations,
  ...zuExtra,
  ...zuForms,
  ...zuLegacy,
  ...zuFragments,
  ...zuLanding,
  ...zuNavigation,
  ...zuPrompts,
  ...zuReports,
}
