/**
 * Client company accounts for awareness training, a client module switched on for one company at a time
 * (companies/{code}.awarenessTrainingEnabled; see src/config/clientModules.ts in the web app).
 *
 * A training company registers its client companies (trainingOrganisations). Its staff give each company a director;
 * the director adds coordinators. Both have the role `clientorg`, with users.organisationId naming their company and
 * users.orgRole their role in it; firestore.rules keeps them to their own company's people. An address that already
 * has an account is only reused when it already belongs to the same client company.
 */

export const CLIENT_ORG_ROLE = 'clientorg'

export type OrgRole = 'director' | 'coordinator'

const TRAINING_STAFF_ROLES = ['projectadmin', 'operations']

const clean = (value: unknown) => String(value ?? '').trim()

export const toOrgRole = (value: unknown): OrgRole => (clean(value) === 'coordinator' ? 'coordinator' : 'director')

type Caller = { role?: unknown, companyCode?: unknown, organisationId?: unknown, orgRole?: unknown }
type Organisation = { id: string, companyCode: string }

/**
 * Who may give which company role: a platform admin either; the training company's staff a director for one of
 * their own company's clients; a client company's director a coordinator in their own company. Nothing while the
 * module is off.
 */
export const canInviteOrganisationMember = (caller: Caller, organisation: Organisation, orgRole: OrgRole, trainingEnabled: boolean) => {
  if (!trainingEnabled || !organisation.companyCode) return false
  const role = clean(caller.role).toLowerCase()
  if (role === 'systemadmin') return true
  if (clean(caller.companyCode) !== organisation.companyCode) return false
  if (TRAINING_STAFF_ROLES.includes(role)) return orgRole === 'director'
  return role === CLIENT_ORG_ROLE
    && clean(caller.orgRole) === 'director'
    && clean(caller.organisationId) === organisation.id
    && orgRole === 'coordinator'
}

/** An existing account is only given a new link when it already belongs to this client company. */
export const canReuseAccountAsOrgMember = (existing: Caller | null | undefined, organisation: Organisation) =>
  Boolean(existing)
  && clean(existing?.role) === CLIENT_ORG_ROLE
  && clean(existing?.companyCode) === organisation.companyCode
  && clean(existing?.organisationId) === organisation.id

/**
 * A training company's funders (trainingFunders): its staff give a funder's contact a sign-in (role `funder`,
 * users.funderId), and the funder report then shows only what that funder funded. Only while a client module is on.
 */
export const canInviteFunder = (caller: Caller, funder: { companyCode: string }, moduleEnabled: boolean) => {
  if (!moduleEnabled || !funder.companyCode) return false
  const role = clean(caller.role).toLowerCase()
  return role === 'systemadmin' || (TRAINING_STAFF_ROLES.includes(role) && clean(caller.companyCode) === funder.companyCode)
}

/** An existing account is only given a new link when it is already this funder's. */
export const canReuseAccountAsFunder = (existing: (Caller & { funderId?: unknown }) | null | undefined, funder: { id: string, companyCode: string }) =>
  Boolean(existing)
  && clean(existing?.role) === 'funder'
  && clean(existing?.companyCode) === funder.companyCode
  && clean(existing?.funderId) === funder.id

export const funderInviteWording = (input: { providerName?: unknown, funderName?: unknown }) => {
  const provider = clean(input.providerName) || 'your grantee'
  const funder = clean(input.funderName) || 'your organisation'
  return {
    title: `Your ${provider} funder report`,
    intro: `${provider} has given ${funder} a sign-in to its funder report: the training and ESG work you funded, and the revenue from it. `
      + 'Use the secure link below to set your password.',
    actionLabel: 'Set your password',
    expiryNote: `This link is time-sensitive. Ask ${provider} for a new invitation if it has expired.`,
  }
}

/** The invitation, in the training provider's name rather than the platform's. */
export const orgMemberInviteWording = (input: { providerName?: unknown, organisationName?: unknown, orgRole: OrgRole }) => {
  const provider = clean(input.providerName) || 'your training provider'
  const organisation = clean(input.organisationName) || 'your company'
  return {
    title: `${organisation}: your ${provider} training account`,
    intro: `${provider} has given ${organisation} access to its training records. Use the secure link below to set your password. `
      + (input.orgRole === 'director'
        ? 'You can see your people\'s classes, attendance and certificates, book them into classes, and add colleagues who help you.'
        : 'You can see your people\'s classes, attendance and certificates, and book them into classes.'),
    actionLabel: 'Set your password',
    expiryNote: `This link is time-sensitive. Ask ${input.orgRole === 'director' ? provider : 'your company\'s director'} for a new invitation if it has expired.`,
  }
}
