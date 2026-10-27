import { isUserRole } from '@/config/roles'

export const getRoleHomePath = (role?: string, isApplicant = false, smeOnboardingComplete = true) => {
  if (!role || !isUserRole(role)) return '/dashboard'
  if (role === 'director') return '/director'
  if (role === 'admin') return '/reception'
  if (role === 'projectadmin') return '/projectadmin'
  if (role === 'operations') return '/operations'
  if (role === 'consultant') return '/consultant'
  if (role === 'incubatee') {
    if (!isApplicant) return '/incubatee'
    // /applicant sends them on to Programmes, or to the profile setup until that's complete.
    return smeOnboardingComplete ? '/applicant' : '/applicant/onboarding'
  }
  return '/dashboard'
}
