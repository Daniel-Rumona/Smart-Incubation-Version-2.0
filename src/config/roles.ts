export const USER_ROLES = {
  SYSTEM_ADMIN: 'systemadmin',
  ADMIN: 'admin',
  DIRECTOR: 'director',
  PROJECT_ADMIN: 'projectadmin',
  PROJECT_MANAGER: 'projectmanager',
  OPERATIONS: 'operations',
  CONSULTANT: 'consultant',
  INCUBATEE: 'incubatee',
  /** Read-only view of the programmes they fund (users.assignedProgramIds; empty = all the company's). */
  FUNDER: 'funder',
  /**
   * Awareness training learners (client module, config/clientModules.ts): their own classes, tests, attendance and
   * ID copy, nothing else. Only created by a training company's staff while the module is switched on.
   */
  LEARNER: 'learner',
  /**
   * A client company of an awareness training company (users.organisationId; orgRole 'director' or 'coordinator'):
   * its own people's classes, attendance and certificates, and booking them into classes. The training company's
   * staff give a company its director; the director adds coordinators. Only while the module is switched on.
   */
  CLIENT_ORG: 'clientorg',
} as const

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES]

export const isUserRole = (role: unknown): role is UserRole =>
  typeof role === 'string' && Object.values(USER_ROLES).includes(role as UserRole)

/** English display names for each role; pass through t() when rendering. */
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  systemadmin: 'System Admin',
  admin: 'Admin',
  director: 'Director',
  projectadmin: 'Project Admin',
  projectmanager: 'Project Manager',
  operations: 'Operations',
  consultant: 'Consultant',
  incubatee: 'SME',
  funder: 'Funder',
  learner: 'Learner',
  clientorg: 'Client company',
}
