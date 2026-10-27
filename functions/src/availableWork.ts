import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore'

/**
 * Facilitators picking up their own work ("Who assigns interventions: Facilitators pick their own").
 *
 * Facilitators can't read applications, growth plans or participant records, so the list is worked out here and
 * returns only what they need. A facilitator sees an intervention when all of these hold:
 *  - the company uses "Facilitators pick their own", and facilitators are one of its delivery roles;
 *  - the SME's growth plan is accepted and confirmed by operations, and the SME hasn't declined it;
 *  - the SME's programme is one of the facilitator's (no programmes set = every programme);
 *  - the intervention's area is one of theirs, or operations chose "All areas" (no areas = no work);
 *  - nobody is already on it (a multi-step intervention offers its next step once the current one is done).
 * Picking it up re-checks all of that inside a transaction and creates the assignment under a fixed id, so two
 * facilitators clicking at once can't both get it. The required-intervention and "already assigned" rules mirror
 * src/pages/interventions/InterventionsAssignmentsPage.tsx; keep the two in step.
 */

// Applications and plans come in several legacy shapes (see requiredInterventions), read field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

export class AvailableWorkError extends Error {
  constructor(public code: 'permission-denied' | 'failed-precondition' | 'already-exists' | 'not-found' | 'invalid-argument', message: string) {
    super(message)
  }
}

export type AvailableWorkItem = {
  participantId: string
  smeName: string
  programId: string | null
  programName: string | null
  interventionId: string
  title: string
  area: string | null
  stepId: string | null
  stepTitle: string | null
  stepNumber: number | null
  stepCount: number | null
}

/** Why a facilitator sees no work at all (the app words these). */
export type AvailableWorkBlock = 'not_enabled' | 'not_delivery_role' | 'no_areas'

const DEFAULT_DELIVERY_ROLES = ['consultant', 'projectadmin', 'operations']

const text = (value: unknown) => String(value ?? '').trim()
const normalize = (value: unknown) => text(value).toLowerCase()
const slug = (value: unknown) => normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const interventionTitle = (item: Row) => text(item.title) || 'Intervention'
const interventionArea = (item: Row) => text(item.areaOfSupport || item.area)
const interventionIdOf = (item: Row) => text(item.interventionId) || slug(interventionTitle(item))
const declinedKey = (id: unknown) => text(id).replace(/[./]/g, '_')

const requiredInterventions = (application: Row, plan: Row): Row[] => {
  const candidates = [
    plan.interventions,
    application.interventions?.required,
    application.growthPlan?.interventions,
    application.growthPlan?.requiredInterventions,
    application.diagnosticPlan?.interventions,
    application.requiredInterventions,
  ]
  const found = candidates.find((value) => Array.isArray(value)) as Row[] | undefined
  if (!found) return []
  const seen = new Set<string>()
  return found.filter(Boolean).filter((item) => {
    const key = slug(interventionTitle(item)) || normalize(interventionIdOf(item))
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const isConfirmedGrowthPlan = (application: Row, plan: Row) => {
  const confirmedBy = plan.confirmedBy || application.interventions?.confirmedBy || application.growthPlan?.confirmedBy || {}
  const operationsConfirmed = confirmedBy.operations === true || confirmedBy.ops === true || confirmedBy.projectAdmin === true
    || (confirmedBy.operations && typeof confirmedBy.operations === 'object')
    || plan.confirmed === true
    || normalize(plan.status) === 'confirmed'
  return normalize(application.applicationStatus) === 'accepted' && requiredInterventions(application, plan).length > 0 && operationsConfirmed
}

const smeConfirmedPlan = (plan: Row) => {
  const confirmedBy = plan.confirmedBy || {}
  return Boolean(confirmedBy.participant || confirmedBy.incubatee || confirmedBy.sme)
}

const assignmentMatches = (assignment: Row, item: Row) =>
  normalize(assignment.interventionId) === normalize(interventionIdOf(item))
  || (!!slug(assignment.interventionTitle) && slug(assignment.interventionTitle) === slug(interventionTitle(item)))

const assignmentIsActive = (assignment: Row) => {
  const isRejected = normalize(assignment.status) === 'cancelled'
    || normalize(assignment.assigneeStatus) === 'declined'
    || normalize(assignment.participantStatus) === 'declined'
    || normalize(assignment.participantCompletionStatus) === 'rejected'
  return !isRejected
}

const assignmentStepComplete = (assignment: Row) => normalize(assignment.participantCompletionStatus) === 'confirmed'
  || normalize(assignment.status) === 'completed'
  || normalize(assignment.completionStatus) === 'confirmed'

/** The step to offer for a multi-step intervention (same rule as the assignment wizard), or null when none is free. */
const nextStepOf = (item: Row, matching: Row[]) => {
  if (matching.some((assignment) => !assignmentStepComplete(assignment))) return null
  const steps = Array.isArray(item.steps) ? item.steps as Row[] : []
  const assignedStepIds = new Set(matching.map((assignment) => text(assignment.assignedStepId)).filter(Boolean))
  const legacyStepCount = matching.filter((assignment) => !text(assignment.assignedStepId)).length
  const index = steps.findIndex((step, position) => !assignedStepIds.has(text(step.id)) && position >= legacyStepCount)
  return index >= 0 ? { step: steps[index], index, count: steps.length } : null
}

/** The facilitator, their company's set-up and their areas, or why they get no work. */
const loadFacilitator = async (db: Firestore, uid: string, transaction?: Transaction) => {
  const read = (ref: DocumentReference) => (transaction ? transaction.get(ref) : ref.get())
  const userSnapshot = await read(db.collection('users').doc(uid))
  const user = userSnapshot.data() || {}
  if (normalize(user.role) !== 'consultant') throw new AvailableWorkError('permission-denied', 'Only facilitators pick up work.')
  const companyCode = text(user.companyCode)
  if (!companyCode) throw new AvailableWorkError('permission-denied', 'Your profile has no company.')
  const [companySnapshot, workSnapshot] = await Promise.all([
    read(db.collection('companies').doc(companyCode)),
    read(db.collection('companyWorkSettings').doc(companyCode)),
  ])
  const company = companySnapshot.data() || {}
  const work = ((workSnapshot.data() || {}).consultants || {})[uid] || {}
  const deliveryRoles = Array.isArray(company.interventionDeliveryRoles) && company.interventionDeliveryRoles.length
    ? company.interventionDeliveryRoles.map(normalize)
    : DEFAULT_DELIVERY_ROLES
  const areas: string[] = Array.isArray(work.areasOfSupport) ? work.areasOfSupport.map(normalize).filter(Boolean) : []
  const allAreas = work.allAreas === true
  const programmes: string[] = Array.isArray(user.assignedProgramIds) ? user.assignedProgramIds.map(text).filter(Boolean) : []
  const block: AvailableWorkBlock | null = company.assignmentModel !== 'consultant_self_assign'
    ? 'not_enabled'
    : !deliveryRoles.includes('consultant')
      ? 'not_delivery_role'
      : !allAreas && !areas.length ? 'no_areas' : null
  return {
    uid,
    companyCode,
    name: text(user.name || user.displayName || user.fullName || user.email) || 'Facilitator',
    email: text(user.email) || null,
    block,
    coversProgramme: (programId: string) => !programmes.length || programmes.includes(programId),
    coversArea: (area: string) => allAreas || (!!area && areas.includes(normalize(area))),
  }
}

type Facilitator = Awaited<ReturnType<typeof loadFacilitator>>

type Candidate = AvailableWorkItem & { item: Row, application: Row, plan: Row, step: Row | null }

/** Everything this facilitator could pick up right now, from already-read company records. */
const candidatesFor = (facilitator: Facilitator, records: { applications: Row[], plans: Map<string, Row>, catalogue: Row[], assignments: Row[] }) => {
  const catalogueById = new Map(records.catalogue.map((item) => [normalize(item.id || item.interventionId), item]))
  const catalogueByTitle = new Map(records.catalogue.map((item) => [slug(item.interventionTitle || item.title), item]))
  const assignmentsBySme = new Map<string, Row[]>()
  records.assignments.forEach((assignment) => {
    const key = text(assignment.participantId)
    assignmentsBySme.set(key, [...(assignmentsBySme.get(key) || []), assignment])
  })

  const out: Candidate[] = []
  records.applications.forEach((application) => {
    const plan = records.plans.get(text(application.applicationId)) || {}
    if (!isConfirmedGrowthPlan(application, plan)) return
    const programId = text(application.programId)
    if (!facilitator.coversProgramme(programId)) return
    const participantId = text(application.participantId)
    const declined = (plan.declinedInterventions && typeof plan.declinedInterventions === 'object') ? plan.declinedInterventions as Row : {}
    const smeAssignments = (assignmentsBySme.get(participantId) || []).filter(assignmentIsActive)

    requiredInterventions(application, plan).forEach((planItem) => {
      const configured = catalogueById.get(normalize(interventionIdOf(planItem))) || catalogueByTitle.get(slug(interventionTitle(planItem))) || {}
      const item = {
        ...configured,
        ...planItem,
        interventionId: interventionIdOf(planItem),
        title: interventionTitle(planItem),
        areaOfSupport: interventionArea(planItem) || text(configured.areaOfSupport || configured.area),
        executionMode: planItem.executionMode || configured.executionMode,
        steps: planItem.steps || configured.steps,
        outcomeDefinition: configured.outcomeDefinition || planItem.outcomeDefinition,
      } as Row
      if (declined[declinedKey(item.interventionId)]) return
      if (!facilitator.coversArea(text(item.areaOfSupport))) return
      // Agent-only interventions aren't for people to pick up.
      if (['agent_only'].includes(normalize(item.deliveryStrategy))) return
      const matching = smeAssignments.filter((assignment) => assignmentMatches(assignment, item))
      let step: { step: Row, index: number, count: number } | null = null
      if (item.executionMode === 'multi_step') {
        step = nextStepOf(item, matching)
        if (!step) return
      } else if (matching.length) {
        return
      }
      out.push({
        participantId,
        smeName: text(application.beneficiaryName || application.businessName) || 'SME',
        programId: programId || null,
        programName: text(application.programName) || null,
        interventionId: text(item.interventionId),
        title: text(item.title),
        area: text(item.areaOfSupport) || null,
        stepId: step ? text(step.step.id) || null : null,
        stepTitle: step ? text(step.step.title) || null : null,
        stepNumber: step ? step.index + 1 : null,
        stepCount: step ? step.count : null,
        item,
        application,
        plan,
        step: step ? step.step : null,
      })
    })
  })
  return out.sort((a, b) => a.smeName.localeCompare(b.smeName) || a.title.localeCompare(b.title))
}

const readCompanyRecords = async (db: Firestore, companyCode: string) => {
  const [applications, plans, catalogue, assignments] = await Promise.all([
    db.collection('applications').where('companyCode', '==', companyCode).where('applicationStatus', '==', 'accepted').get(),
    db.collection('diagnosticPlans').where('companyCode', '==', companyCode).get(),
    db.collection('interventions').where('companyCode', '==', companyCode).get(),
    db.collection('assignedInterventions').where('companyCode', '==', companyCode).get(),
  ])
  return {
    applications: applications.docs.map((doc) => ({ ...doc.data(), applicationId: doc.id })),
    plans: new Map(plans.docs.map((doc) => [doc.id, { ...doc.data(), id: doc.id } as Row])),
    catalogue: catalogue.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)),
    assignments: assignments.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)),
  }
}

// Only these fields leave the server; the application and plan stay here.
const strip = (row: Candidate): AvailableWorkItem => ({
  participantId: row.participantId,
  smeName: row.smeName,
  programId: row.programId,
  programName: row.programName,
  interventionId: row.interventionId,
  title: row.title,
  area: row.area,
  stepId: row.stepId,
  stepTitle: row.stepTitle,
  stepNumber: row.stepNumber,
  stepCount: row.stepCount,
})

export async function listAvailableWork(db: Firestore, uid: string): Promise<{ block: AvailableWorkBlock | null, items: AvailableWorkItem[] }> {
  const facilitator = await loadFacilitator(db, uid)
  if (facilitator.block) return { block: facilitator.block, items: [] }
  return { block: null, items: candidatesFor(facilitator, await readCompanyRecords(db, facilitator.companyCode)).map(strip) }
}

/** Fixed per SME, intervention and step, so a second pick-up of the same work finds the first and stops. */
export const claimId = (participantId: string, interventionId: string, stepId?: string | null) =>
  ['claim', participantId, interventionId, stepId || ''].filter(Boolean).join('_').replace(/[/.#[\]$]/g, '-')

export async function claimAvailableWork(db: Firestore, uid: string, input: { participantId: string, interventionId: string, stepId?: string | null }) {
  const participantId = text(input.participantId)
  const interventionId = text(input.interventionId)
  if (!participantId || !interventionId) throw new AvailableWorkError('invalid-argument', 'Which intervention is this?')

  return db.runTransaction(async (transaction) => {
    const facilitator = await loadFacilitator(db, uid, transaction)
    if (facilitator.block) throw new AvailableWorkError('failed-precondition', 'You can’t pick up work right now.')
    const companyCode = facilitator.companyCode

    // Re-read this SME's records inside the transaction: if anyone (another facilitator or operations) took the
    // work since the list loaded, the transaction sees it and stops instead of creating a second assignment.
    const [applicationSnapshot, assignmentSnapshot, catalogueSnapshot] = await Promise.all([
      transaction.get(db.collection('applications').where('companyCode', '==', companyCode).where('participantId', '==', participantId)),
      transaction.get(db.collection('assignedInterventions').where('companyCode', '==', companyCode).where('participantId', '==', participantId)),
      transaction.get(db.collection('interventions').where('companyCode', '==', companyCode)),
    ])
    const applications = applicationSnapshot.docs
      .map((doc) => ({ ...doc.data(), applicationId: doc.id } as Row))
      .filter((application) => normalize(application.applicationStatus) === 'accepted')
    const planSnapshots = await Promise.all(applications.map((application) => transaction.get(db.collection('diagnosticPlans').doc(text(application.applicationId)))))
    const plans = new Map(planSnapshots.filter((doc) => doc.exists).map((doc) => [doc.id, { ...doc.data(), id: doc.id } as Row]))

    const candidate = candidatesFor(facilitator, {
      applications,
      plans,
      catalogue: catalogueSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)),
      assignments: assignmentSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Row)),
    }).find((row) => row.interventionId === interventionId && (row.stepId || null) === (text(input.stepId) || null))
    if (!candidate) throw new AvailableWorkError('already-exists', 'Someone has already picked this up, or it’s no longer available to you.')

    const ref = db.collection('assignedInterventions').doc(claimId(participantId, interventionId, candidate.stepId))
    if ((await transaction.get(ref)).exists) throw new AvailableWorkError('already-exists', 'Someone has already picked this up.')

    const { item, application, plan, step } = candidate
    const smeConfirmed = smeConfirmedPlan(plan)
    transaction.create(ref, {
      companyCode,
      participantId,
      applicationId: text(application.applicationId),
      interventionId,
      interventionTitle: candidate.title,
      areaOfSupport: candidate.area,
      ...(item.outcomeDefinition ? { outcomeDefinition: item.outcomeDefinition } : {}),
      businessName: candidate.smeName,
      sector: text(application.sector) || null,
      programName: candidate.programName,
      programId: candidate.programId,
      assigneeId: uid,
      assigneeName: facilitator.name,
      assigneeEmail: facilitator.email,
      assigneeType: 'consultant',
      deliveryActorType: 'human',
      deliveryStrategy: 'human_only',
      configuredDeliveryStrategy: text(item.deliveryStrategy) || 'human_only',
      deliveryComparisonGroup: interventionId,
      executionMode: item.executionMode || 'single_session',
      steps: step ? [{ ...step, status: 'not_started' }] : [],
      assignedStepId: candidate.stepId,
      assignedStepTitle: candidate.stepTitle,
      assignedStepDescription: step ? text(step.description) || null : null,
      stepIndex: candidate.stepNumber ? candidate.stepNumber - 1 : null,
      stepNumber: candidate.stepNumber,
      stepCount: candidate.stepCount,
      agentId: null,
      agentName: null,
      reviewRequired: false,
      reviewerType: null,
      reviewerId: null,
      reviewerName: null,
      reviewStatus: null,
      agentWorkStatus: null,
      type: 'singular',
      status: 'assigned',
      // They chose it, so there's nothing for them to accept.
      assigneeStatus: 'accepted',
      participantStatus: smeConfirmed ? 'accepted' : 'pending',
      ...(smeConfirmed ? { participantAcceptedVia: 'plan', participantAcceptedAt: FieldValue.serverTimestamp() } : {}),
      assigneeCompletionStatus: 'pending',
      participantCompletionStatus: 'pending',
      progress: 0,
      dueDate: null,
      targetMetric: null,
      targetValue: null,
      source: 'facilitator_pickup',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      createdByUid: uid,
      createdByEmail: facilitator.email,
    })
    // The SME and the team hear about it the same way as when operations assigns.
    transaction.create(db.collection('notifications').doc(), {
      companyCode,
      participantId,
      interventionId,
      interventionTitle: candidate.title,
      type: 'intervention_assigned',
      recipientRoles: ['consultant', 'operations', 'incubatee'],
      message: `${candidate.title} has been picked up by ${facilitator.name}.`,
      createdAt: FieldValue.serverTimestamp(),
      readBy: {},
    })
    return { assignmentId: ref.id }
  })
}
