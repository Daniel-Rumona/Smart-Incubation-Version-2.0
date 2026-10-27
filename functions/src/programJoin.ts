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

/**
 * A "direct" programme has no application: SMEs who join through its link only fill in their profile and are
 * accepted straight away. The programme team chose that, so its link works even when the company otherwise
 * registers its own SMEs.
 */
export const isDirectIntake = (program: Record<string, unknown> | undefined) => clean(program?.intakeMode) === 'direct'

/** The programme's set interventions, in the shape `applications.interventions.required` uses. */
export const forcedProgramInterventions = (program: Record<string, unknown> | undefined) => {
  const policy = (program?.interventionPolicy || {}) as Record<string, unknown>
  const forced = policy.mode === 'force_all' || policy.allowSmeSelection === false
  const list = Array.isArray(policy.forcedInterventions) ? policy.forcedInterventions as Array<Record<string, unknown>> : []
  return forced
    ? list.map(item => ({ id: clean(item.id), title: clean(item.title), area: clean(item.area) })).filter(item => item.id)
    : []
}

/** Public: just enough for the join page to show which programme and company a link is for. */
/**
 * A no-application programme with a set list has nothing for operations to review, so the SME's growth plan
 * (diagnosticPlans/{applicationId}) is written already confirmed and they appear on Assign interventions at once.
 * Returns null when the programme is not direct, has no set list, or the SME already has a plan for it.
 * A plan left over from a different programme (the SME was moved) is replaced only with `replaceOtherProgramme`.
 */
export async function buildConfirmedSetPlan(db: Firestore, args: {
  program: Record<string, unknown> | undefined
  programId: string
  applicationId: string
  participantId: string
  replaceOtherProgramme?: boolean
}) {
  const required = forcedProgramInterventions(args.program)
  if (!isDirectIntake(args.program) || !required.length) return null
  const existing = await db.collection('diagnosticPlans').doc(args.applicationId).get()
  if (existing.exists && (!args.replaceOtherProgramme || clean(existing.get('programId')) === args.programId)) return null
  const definitions = await db.getAll(...required.map(item => db.collection('interventions').doc(item.id)))
  const interventions = required.map((item, index) => {
    const data = (definitions[index].data() || {}) as Record<string, unknown>
    return {
      interventionId: item.id,
      title: clean(data.interventionTitle) || item.title,
      ...(clean(data.areaOfSupport) || item.area ? { areaOfSupport: clean(data.areaOfSupport) || item.area } : {}),
      ...(data.executionMode === 'multi_step' ? { executionMode: 'multi_step' } : {}),
      ...(Array.isArray(data.steps) ? { steps: data.steps } : {}),
    }
  })
  const confirmedAt = new Date().toISOString()
  // Both sides are confirmed: there is nothing for operations to review or for the SME to agree to beyond joining.
  const confirmation = { automatic: true, name: 'Set by programme', reason: 'no_application_set_list', confirmedAt }
  return {
    participantId: args.participantId,
    applicationId: args.applicationId,
    programId: args.programId,
    companyCode: clean(args.program?.companyCode) || null,
    interventions,
    status: 'Confirmed',
    confirmed: true,
    confirmedBy: { operations: confirmation, participant: confirmation },
    confirmedMeta: { operations: confirmation, participant: confirmation },
    confirmedAt,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }
}

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
    selfApplication: isDirectIntake(program) || allowsSelfApplication(company),
    direct: isDirectIntake(program),
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
    let direct = false

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
        direct = input.path === 'program_link' && isDirectIntake(program)
      } else {
        companyCode = clean(input.companyCode)
      }

      if (!companyCode || companyCode.includes('/')) throw new JoinError('invalid', 'Choose a company or programme.')
      const companySnapshot = await transaction.get(db.collection('companies').doc(companyCode))
      if (!companySnapshot.exists) throw new JoinError('not_found', 'That company could not be found.')
      const company = companySnapshot.data() as Record<string, unknown>
      companyName = clean(company.name || company.companyName) || companyCode
      if (!direct && !allowsSelfApplication(company)) {
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

    return { companyCode, companyName, programId, programName, direct }
  })
}

/**
 * Accepts an SME into a direct (no-application) programme they joined by link. Their profile becomes the
 * accepted application and participant record, carrying the programme's set interventions.
 */
export async function enrolInDirectProgram(db: Firestore, uid: string, programId: string) {
  const id = clean(programId)
  if (!id || id.includes('/')) throw new JoinError('invalid', 'The programme is not valid.')
  const applicationId = `${uid}__${id}`
  const [userSnapshot, programSnapshot, applicantSnapshot, businessSnapshot, existingSnapshot] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('programs').doc(id).get(),
    db.collection('applicantProfiles').doc(uid).get(),
    db.collection('businessProfiles').doc(uid).get(),
    db.collection('applications').doc(applicationId).get(),
  ])
  if (!programSnapshot.exists) throw new JoinError('not_found', 'That programme could not be found.')
  const program = programSnapshot.data() as Record<string, unknown>
  const user = (userSnapshot.data() || {}) as Record<string, unknown>
  const companyCode = clean(program.companyCode)
  if (!isDirectIntake(program)) throw new JoinError('forbidden', 'This programme takes applications.')
  if (!programIsOpenForApplications(program)) throw new JoinError('forbidden', 'That programme is not taking new SMEs.')
  if (clean(user.role).toLowerCase() !== 'incubatee') throw new JoinError('forbidden', 'Only an SME account can join a programme.')
  const assigned = Array.isArray(user.assignedProgramIds) ? user.assignedProgramIds.map(String) : []
  if (clean(user.companyCode) !== companyCode || !assigned.includes(id)) {
    throw new JoinError('forbidden', 'Open the programme link first to join this programme.')
  }
  if (!applicantSnapshot.exists || !businessSnapshot.exists) throw new JoinError('invalid', 'Complete your profile before joining.')

  const programName = clean(program.name) || id
  if (existingSnapshot.exists && clean(existingSnapshot.get('applicationStatus')).toLowerCase() === 'accepted') {
    return { applicationId, programId: id, programName, alreadyAccepted: true }
  }

  const applicant = applicantSnapshot.data() as Record<string, unknown>
  const business = businessSnapshot.data() as Record<string, unknown>
  const email = clean(applicant.email || user.email).toLowerCase()
  const profile = {
    uid,
    participantId: uid,
    applicationId,
    applicantProfileId: uid,
    businessProfileId: uid,
    participantName: clean(applicant.participantName || user.name) || null,
    businessName: clean(business.businessName) || null,
    email,
    emailLower: email,
    phone: clean(applicant.phone) || null,
    gender: clean(applicant.gender) || null,
    idNumber: clean(applicant.idNumber) || null,
    sector: clean(business.sector) || null,
    natureOfBusiness: clean(business.natureOfBusiness) || null,
    registrationNumber: clean(business.registrationNumber) || null,
    province: clean(business.province || applicant.province) || null,
    city: clean(business.city || applicant.city) || null,
    programId: id,
    programName,
    companyCode,
    updatedAt: FieldValue.serverTimestamp(),
  }

  const plan = await buildConfirmedSetPlan(db, { program, programId: id, applicationId, participantId: uid })
  const batch = db.batch()
  if (plan) batch.set(db.collection('diagnosticPlans').doc(applicationId), plan)
  batch.set(db.collection('applications').doc(applicationId), {
    ...profile,
    applicationStatus: 'Accepted',
    intakeMode: 'direct',
    submittedAt: FieldValue.serverTimestamp(),
    acceptedAt: FieldValue.serverTimestamp(),
    createdAt: FieldValue.serverTimestamp(),
    interventions: { required: forcedProgramInterventions(program), assigned: [], completed: [], participationRate: 0 },
  }, { merge: true })
  batch.set(db.collection('participants').doc(uid), {
    ...profile,
    status: 'active',
    acceptedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  await batch.commit()
  return { applicationId, programId: id, programName, alreadyAccepted: false }
}
