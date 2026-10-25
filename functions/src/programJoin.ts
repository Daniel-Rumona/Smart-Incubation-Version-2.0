import { FieldValue, type Firestore } from 'firebase-admin/firestore'

/*
 * Attaching an SME to a company and programme.
 *
 * The browser must never choose its own company: a user's `companyCode` scopes what they can read, so it is
 * set here, after checking the programme and the company's onboarding rule. Used by:
 *   - the programme link (`/join/<programId>`): company and programme come from the link;
 *   - the onboarding company picker (SMEs who signed up without a link);
 *   - skipping onboarding (the SME lands in the platform owner's marketplace bucket).
 *
 * A company that chose "our team registers SMEs" (`companies/{code}.smeOnboardingModel ===
 * 'consultants_register_smes'`) cannot be joined by self-application at all.
 */

export const PLATFORM_OWNER_CODE = 'QTX'
const ACTIVE_PROGRAM_STATUSES = new Set(['active', 'planned', 'upcoming'])

export type JoinPath = 'program_link' | 'company_program' | 'open_program' | 'marketplace' | 'skip'
export type JoinInput = {
  path: JoinPath
  programId?: string
  companyCode?: string
  consultingBudget?: number
  wantsSpecificProgram?: boolean
}

export class JoinError extends Error {
  constructor(public code: 'invalid' | 'forbidden' | 'not_found', message: string) {
    super(message)
  }
}

const clean = (value: unknown) => String(value ?? '').trim()
export const allowsSelfApplication = (company: Record<string, unknown> | undefined) =>
  clean(company?.smeOnboardingModel) !== 'consultants_register_smes'

const programIsOpenForApplications = (program: Record<string, unknown>) => {
  const status = clean(program.status).toLowerCase()
  return !status || ACTIVE_PROGRAM_STATUSES.has(status)
}

/** Public: just enough for the join page to show which programme and company a link is for. */
export async function getProgramLinkInfo(db: Firestore, programId: string) {
  const id = clean(programId)
  if (!id || id.includes('/')) throw new JoinError('invalid', 'This link is not valid.')
  const programSnapshot = await db.collection('programs').doc(id).get()
  if (!programSnapshot.exists) throw new JoinError('not_found', 'This programme link is not valid.')
  const program = programSnapshot.data() as Record<string, unknown>
  const companyCode = clean(program.companyCode)
  const companySnapshot = companyCode ? await db.collection('companies').doc(companyCode).get() : null
  const company = (companySnapshot?.data() || {}) as Record<string, unknown>
  return {
    programId: id,
    programName: clean(program.name) || id,
    companyName: clean(company.name || company.companyName) || companyCode,
    logoUrl: clean(company.logoUrl),
    open: programIsOpenForApplications(program),
    selfApplication: allowsSelfApplication(company),
  }
}

export async function joinProgram(db: Firestore, uid: string, input: JoinInput) {
  const userRef = db.collection('users').doc(uid)

  return db.runTransaction(async transaction => {
    const userSnapshot = await transaction.get(userRef)
    if (!userSnapshot.exists) throw new JoinError('not_found', 'Your profile could not be found.')
    const user = userSnapshot.data() as Record<string, unknown>
    if (clean(user.role).toLowerCase() !== 'incubatee') throw new JoinError('forbidden', 'Only an SME account can join a programme.')

    const currentCode = clean(user.companyCode)
    let companyCode: string
    let companyName = ''
    let programId = ''
    let programName = ''

    if (input.path === 'skip') {
      companyCode = currentCode || PLATFORM_OWNER_CODE
    } else if (input.path === 'marketplace') {
      companyCode = PLATFORM_OWNER_CODE
    } else {
      const requestedProgramId = clean(input.programId)
      if (requestedProgramId) {
        if (requestedProgramId.includes('/')) throw new JoinError('invalid', 'The programme is not valid.')
        const programSnapshot = await transaction.get(db.collection('programs').doc(requestedProgramId))
        if (!programSnapshot.exists) throw new JoinError('not_found', 'That programme could not be found.')
        const program = programSnapshot.data() as Record<string, unknown>
        if (!programIsOpenForApplications(program)) throw new JoinError('forbidden', 'That programme is not accepting applications.')
        if (input.path === 'open_program' && program.openToExternalSmes !== true) throw new JoinError('forbidden', 'That programme is not open to outside SMEs.')
        companyCode = clean(program.companyCode)
        if (input.companyCode && clean(input.companyCode) !== companyCode) throw new JoinError('invalid', 'That programme does not belong to the chosen company.')
        programId = requestedProgramId
        programName = clean(program.name) || programId
      } else {
        companyCode = clean(input.companyCode)
      }

      if (!companyCode || companyCode.includes('/')) throw new JoinError('invalid', 'Choose a company or programme.')
      const companySnapshot = await transaction.get(db.collection('companies').doc(companyCode))
      if (!companySnapshot.exists) throw new JoinError('not_found', 'That company could not be found.')
      const company = companySnapshot.data() as Record<string, unknown>
      companyName = clean(company.name || company.companyName) || companyCode
      if (!allowsSelfApplication(company)) {
        throw new JoinError('forbidden', 'This organisation registers its own SMEs. Please contact the programme team and they will set you up.')
      }
    }

    // An account that already belongs to another real company (not the open marketplace bucket) cannot be moved by itself.
    if (currentCode && currentCode !== PLATFORM_OWNER_CODE && currentCode !== companyCode) {
      throw new JoinError('forbidden', 'This account already belongs to a different company.')
    }

    const budget = Number(input.consultingBudget)
    transaction.set(userRef, {
      companyCode,
      ...(Number.isFinite(budget) && budget >= 0 ? { consultingBudget: budget } : {}),
      ...(programId ? { assignedProgramIds: FieldValue.arrayUnion(programId) } : {}),
      smeOnboarding: {
        hasCompany: companyCode !== PLATFORM_OWNER_CODE,
        companyCode,
        companyName: companyName || null,
        selectedProgramId: programId || null,
        wantsSpecificProgram: input.wantsSpecificProgram ?? null,
        path: input.path,
        viaProgramLink: input.path === 'program_link',
        completedAt: FieldValue.serverTimestamp(),
      },
      smeOnboardingComplete: true,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })

    return { companyCode, companyName, programId, programName }
  })
}
