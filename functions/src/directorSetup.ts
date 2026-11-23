import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/*
 * Director first-login setup: claims a company code, stores the company profile and locks its operating
 * settings in `companies/{code}` (the document SystemSettingsProvider reads). Clients cannot write
 * `companies` directly, so this runs server-side and enforces the claim rules:
 *   - the caller must already be a director, assigned by staff or an approved organisation access request;
 *   - a code that is locked or owned by someone else cannot be taken;
 *   - an admin-provisioned company (no owner yet) can only be claimed by the director whose own profile
 *     already carries that code.
 */

export type DirectorSetupInput = {
  companyName: string
  companyCode: string
  logoUrl?: string
  consultantLabel: string
  hasDepartments: boolean
  hasBranches: boolean
  branchScopedManagement?: boolean
  smeOnboardingModel: 'self_application' | 'consultants_register_smes'
  assignmentModel: 'ops_assign_consultant' | 'consultant_self_assign'
  smeDivisionModel?: 'system_equal_random' | 'ops_assign_smes_to_consultants' | 'consultants_register_their_smes'
  interventionScopeModel: 'program_specific' | 'company_wide' | 'department_specific' | 'both'
  /**
   * Who runs the programme day to day. 'solo': the director works alone, so their own account also gets the
   * operations role (users.secondRole), instead of needing a second login to do the work.
   */
  teamSize?: TeamSize
}

export type TeamSize = 'solo' | 'small' | 'large'
const TEAM_SIZES = ['solo', 'small', 'large'] as const

export class DirectorSetupError extends Error {
  constructor(public code: 'invalid' | 'forbidden' | 'conflict' | 'not_found', message: string) {
    super(message)
  }
}

const normalizeName = (value: unknown) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s-]/g, '')
export const cleanCompanyCode = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '')

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], label: string): T => {
  if (!allowed.includes(value as T)) throw new DirectorSetupError('invalid', `${label} is not valid.`)
  return value as T
}

export function validateDirectorSetup(raw: Partial<DirectorSetupInput>): DirectorSetupInput {
  const companyName = String(raw.companyName || '').trim()
  const companyCode = cleanCompanyCode(raw.companyCode)
  if (companyName.length < 2 || companyName.length > 120) throw new DirectorSetupError('invalid', 'Enter the company name.')
  if (!/^[A-Z0-9_-]{3,20}$/.test(companyCode)) throw new DirectorSetupError('invalid', 'The company code must be 3 to 20 letters or numbers with no spaces.')
  const consultantLabel = String(raw.consultantLabel || '').trim()
  if (!consultantLabel || consultantLabel.length > 40) throw new DirectorSetupError('invalid', 'Enter what your company calls its consultants.')

  const hasDepartments = raw.hasDepartments === true
  const hasBranches = raw.hasBranches === true
  const assignmentModel = oneOf(raw.assignmentModel, ['ops_assign_consultant', 'consultant_self_assign'] as const, 'Assignment model')
  const interventionScopeModel = oneOf(raw.interventionScopeModel, ['program_specific', 'company_wide', 'department_specific', 'both'] as const, 'Intervention scope')
  if (interventionScopeModel === 'department_specific' && !hasDepartments) {
    throw new DirectorSetupError('invalid', 'Department scope needs departments to be enabled.')
  }

  const logoUrl = String(raw.logoUrl || '').trim()
  if (logoUrl && !/^https:\/\//.test(logoUrl)) throw new DirectorSetupError('invalid', 'The logo link is not valid.')

  return {
    companyName,
    companyCode,
    ...(logoUrl ? { logoUrl } : {}),
    consultantLabel,
    hasDepartments,
    hasBranches,
    ...(hasBranches ? { branchScopedManagement: raw.branchScopedManagement === true } : {}),
    smeOnboardingModel: oneOf(raw.smeOnboardingModel, ['self_application', 'consultants_register_smes'] as const, 'SME onboarding model'),
    assignmentModel,
    ...(assignmentModel === 'consultant_self_assign'
      ? { smeDivisionModel: oneOf(raw.smeDivisionModel, ['system_equal_random', 'ops_assign_smes_to_consultants', 'consultants_register_their_smes'] as const, 'SME division model') }
      : {}),
    interventionScopeModel,
    ...(raw.teamSize === undefined ? {} : { teamSize: oneOf(raw.teamSize, TEAM_SIZES, 'Team size') }),
  }
}

/** The user fields that follow from the team size: a director working alone also holds the operations role. */
const secondRoleFor = (teamSize: TeamSize) => (teamSize === 'solo' ? { secondRole: 'operations' } : { secondRole: FieldValue.delete() })

export async function completeDirectorSetup(db: Firestore, uid: string, email: string, raw: Partial<DirectorSetupInput>) {
  const input = validateDirectorSetup(raw)
  const userRef = db.collection('users').doc(uid)
  const companyRef = db.collection('companies').doc(input.companyCode)

  return db.runTransaction(async transaction => {
    const milestoneRef = db.collection('organisationMilestones').doc(input.companyCode)
    const [userSnapshot, companySnapshot, milestone] = await Promise.all([transaction.get(userRef), transaction.get(companyRef), transaction.get(milestoneRef)])
    if (!userSnapshot.exists) throw new DirectorSetupError('not_found', 'Your profile could not be found.')
    const user = userSnapshot.data() as Record<string, unknown>
    const isDirector = String(user.role || '').trim().toLowerCase() === 'director'
    if (user.organisationAccessStatus && user.organisationAccessStatus !== 'approved') {
      throw new DirectorSetupError('forbidden', 'Your organisation must be approved before setup.')
    }
    if (!isDirector) {
      throw new DirectorSetupError('forbidden', 'Request organisation access and wait for approval before creating an organisation.')
    }

    if (companySnapshot.exists) {
      const existing = companySnapshot.data() as Record<string, unknown>
      const ownedByMe = existing.ownerUid === uid
      const ownedByOther = Boolean(existing.ownerUid) && !ownedByMe
      const adminProvisionedForMe = !existing.ownerUid && cleanCompanyCode(user.companyCode) === input.companyCode
      if (ownedByOther || (!ownedByMe && !adminProvisionedForMe)) {
        throw new DirectorSetupError('conflict', 'This company code is already in use by another organisation.')
      }
      if (existing.locked === true) {
        if (!ownedByMe || normalizeName(existing.name || existing.companyName) !== normalizeName(input.companyName)) {
          throw new DirectorSetupError('conflict', 'This company code already has locked settings.')
        }
        // Retried request after a success: nothing more to write.
        return { companyCode: input.companyCode, alreadyLocked: true }
      }
    }

    const { logoUrl, ...settings } = input
    if (!companySnapshot.exists && !milestone.exists) {
      transaction.create(milestoneRef, { status: 'awaiting_first_staff', createdAt: FieldValue.serverTimestamp() })
    }
    transaction.set(companyRef, {
      ...settings,
      companyCode: input.companyCode,
      name: input.companyName,
      ...(logoUrl ? { logoUrl } : {}),
      locked: true,
      ownerUid: uid,
      ownerEmail: email,
      ...(companySnapshot.exists ? {} : { createdAt: FieldValue.serverTimestamp(), createdByUid: uid, createdByEmail: email, subscription: { tier: 'basic', addOns: [], setBy: 'system' } }),
      updatedAt: FieldValue.serverTimestamp(),
      updatedByUid: uid,
    }, { merge: true })

    transaction.set(userRef, {
      company: input.companyName,
      companyName: input.companyName,
      companyCode: input.companyCode,
      systemSettingsConfigured: true,
      systemSettingsCompanyCode: input.companyCode,
      systemSettingsConfiguredAt: FieldValue.serverTimestamp(),
      ...(input.teamSize ? secondRoleFor(input.teamSize) : {}),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return { companyCode: input.companyCode, alreadyLocked: false }
  })
}

/**
 * A director changes who runs the programme after setup (Company settings). Only a director of their own company
 * may, and it only ever changes their own second role, so it can't hand operations powers to anyone else.
 */
export async function setDirectorTeamSize(db: Firestore, uid: string, rawTeamSize: unknown) {
  const teamSize = oneOf(rawTeamSize, TEAM_SIZES, 'Team size')
  const userRef = db.collection('users').doc(uid)
  const user = (await userRef.get()).data() || {}
  const companyCode = cleanCompanyCode(user.companyCode)
  if (user.role !== 'director' || !companyCode) throw new DirectorSetupError('forbidden', 'Only a company director can change this.')
  const companyRef = db.collection('companies').doc(companyCode)
  if (!(await companyRef.get()).exists) throw new DirectorSetupError('not_found', 'Your company could not be found.')
  const batch = db.batch()
  batch.set(companyRef, { teamSize, updatedAt: FieldValue.serverTimestamp(), updatedByUid: uid }, { merge: true })
  batch.set(userRef, { ...secondRoleFor(teamSize), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await batch.commit()
  return { teamSize, secondRole: teamSize === 'solo' ? 'operations' : null }
}
