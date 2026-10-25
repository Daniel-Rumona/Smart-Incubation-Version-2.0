export const USER_ROLES = {
  SYSTEM_ADMIN: 'systemadmin',
  ADMIN: 'admin',
  DIRECTOR: 'director',
  PROJECT_ADMIN: 'projectadmin',
  PROJECT_MANAGER: 'projectmanager',
  OPERATIONS: 'operations',
  CONSULTANT: 'consultant',
  INCUBATEE: 'incubatee',
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
}
