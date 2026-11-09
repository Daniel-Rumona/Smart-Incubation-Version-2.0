/**
 * Learner accounts for awareness training, a client module switched on for one company at a time
 * (companies/{code}.awarenessTrainingEnabled; see src/config/clientModules.ts in the web app).
 *
 * A company's training staff may create learner accounts only in their own company and only while the module is
 * on; no other company can create learners at all. An address that already has an account is only reused when it
 * is a learner of the same company (someone who attended an earlier class) - never a staff or SME account.
 */

export const LEARNER_ROLE = 'learner'

const LEARNER_MANAGER_ROLES = ['projectadmin', 'operations']

const clean = (value: unknown) => String(value ?? '').trim()

export const isLearnerRole = (role: unknown) => clean(role).toLowerCase() === LEARNER_ROLE

export const canCreateLearner = (
  manager: { role: string, companyCode: string, isPlatformAdmin: boolean },
  targetCompanyCode: unknown,
  trainingEnabled: boolean,
) => {
  const code = clean(targetCompanyCode)
  if (!code || !trainingEnabled) return false
  return manager.isPlatformAdmin || (LEARNER_MANAGER_ROLES.includes(manager.role) && manager.companyCode === code)
}

export const canReuseAccountAsLearner = (
  existing: { role?: unknown, companyCode?: unknown } | null | undefined,
  companyCode: unknown,
) => Boolean(existing) && isLearnerRole(existing?.role) && clean(existing?.companyCode) === clean(companyCode)

/** The invitation a learner receives, in the training provider's name rather than the platform's. */
export const learnerInviteWording = (input: { companyName?: unknown, courseTitle?: unknown }) => {
  const provider = clean(input.companyName) || 'your training provider'
  const course = clean(input.courseTitle)
  return {
    title: `Your ${provider} training account is ready`,
    intro: `${provider} has registered you for ${course || 'training'}. Use the secure link below to set your password. `
      + 'Your training page shows your class, how to join it, your assessments and where to upload your ID copy.',
    actionLabel: 'Set your password',
    expiryNote: `This link is time-sensitive. Ask ${provider} for a new invitation if it has expired.`,
  }
}
