/**
 * A client company's view of its own people's assessments (src/pages/company/CompanyAssessmentsPage.tsx in the web
 * app): for each of its learners, the pre-assessment and post-assessment scores, what is waiting to be marked and
 * whether an assessment is open for them to write now. Scores only: never the questions, answers or memo.
 *
 * Open to a client company's accounts (role clientorg, users.organisationId) while awareness training is on for the
 * training company they belong to.
 */
import type { Firestore } from 'firebase-admin/firestore'

export class OrganisationResultsError extends Error {
  constructor(public code: 'permission-denied' | 'failed-precondition', message: string) {
    super(message)
  }
}

type Row = Record<string, unknown>
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const whole = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback)

export type AttemptSummary = { attempt: number, status: 'in_progress' | 'submitted' | 'marked', scorePct: number | null }

export type OrganisationLearnerResult = {
  learnerId: string
  name: string
  classId: string
  pre: AttemptSummary[]
  post: AttemptSummary[]
  /** The best marked post-assessment. */
  bestPostPct: number | null
  passMarkPct: number
  /** Assessments open for this learner to write now (from their training page). */
  canWrite: Array<'pre' | 'post'>
  certified: boolean
}

const attemptsOf = (submissions: Row[], learnerId: string, kind: 'pre' | 'post'): AttemptSummary[] => submissions
  .filter((row) => text(row.learnerId) === learnerId && row.kind === kind)
  .map((row) => ({
    attempt: whole(row.attempt, 1),
    status: (row.status === 'marked' || row.status === 'submitted' ? row.status : 'in_progress') as AttemptSummary['status'],
    scorePct: row.status === 'marked' && typeof row.scorePct === 'number' ? row.scorePct : null,
  }))
  .sort((a, b) => a.attempt - b.attempt)

/** The same rule the learner's page uses (utils/trainingResults.ts learnerMayStart), from scores only. */
const mayWrite = (trainingClass: Row, kind: 'pre' | 'post', attempts: AttemptSummary[]) => {
  const open = (trainingClass.testsOpen && typeof trainingClass.testsOpen === 'object' ? trainingClass.testsOpen : {}) as Row
  if (open[kind] !== true) return false
  if (attempts.some((attempt) => attempt.status !== 'marked')) return false
  if (kind === 'pre') return attempts.length === 0
  if (attempts.length === 0) return true
  const best = Math.max(...attempts.map((attempt) => attempt.scorePct ?? 0))
  return best < whole(trainingClass.passMarkPct, 0) && attempts.length < 1 + Math.max(0, whole(trainingClass.reassessmentsAllowed, 0))
}

export const summariseOrganisationResults = (input: { learners: Row[], classes: Row[], submissions: Row[], certificates: Row[] }): OrganisationLearnerResult[] => {
  const classes = new Map(input.classes.map((row) => [text(row.id), row]))
  const certified = new Set(input.certificates.filter((row) => row.status === 'valid').map((row) => text(row.learnerId)))
  return input.learners.map((learner) => {
    const learnerId = text(learner.id)
    const trainingClass = classes.get(text(learner.classId)) || {}
    const pre = attemptsOf(input.submissions, learnerId, 'pre')
    const post = attemptsOf(input.submissions, learnerId, 'post')
    const marked = post.map((attempt) => attempt.scorePct).filter((value): value is number => value !== null)
    return {
      learnerId,
      name: text(learner.name),
      classId: text(learner.classId),
      pre,
      post,
      bestPostPct: marked.length ? Math.max(...marked) : null,
      passMarkPct: whole(trainingClass.passMarkPct, 0),
      canWrite: (['pre', 'post'] as const).filter((kind) => mayWrite(trainingClass, kind, kind === 'pre' ? pre : post)),
      certified: certified.has(learnerId),
    }
  }).sort((a, b) => a.name.localeCompare(b.name))
}

/** The results for the client company asking, or an error when they may not see them. */
export const organisationResults = async (db: Firestore, uid: string) => {
  const profile = (await db.collection('users').doc(uid).get()).data() || {}
  const companyCode = text(profile.companyCode)
  const organisationId = text(profile.organisationId)
  if (text(profile.role) !== 'clientorg' || !companyCode || !organisationId) {
    throw new OrganisationResultsError('permission-denied', 'Only a client company sees its people\'s results.')
  }
  const company = (await db.collection('companies').doc(companyCode).get()).data() || {}
  if (company.awarenessTrainingEnabled !== true) throw new OrganisationResultsError('failed-precondition', 'Training is not switched on.')
  const learners = (await db.collection('trainingLearners').where('companyCode', '==', companyCode).where('organisationId', '==', organisationId).get())
    .docs.map((doc) => ({ id: doc.id, ...doc.data() }))
  const learnerIds = new Set(learners.map((row) => row.id))
  const classIds = new Set(learners.map((row) => text((row as Row).classId)))
  const [classes, submissions, certificates] = await Promise.all([
    db.collection('trainingClasses').where('companyCode', '==', companyCode).get(),
    db.collection('trainingSubmissions').where('companyCode', '==', companyCode).get(),
    db.collection('trainingCertificates').where('companyCode', '==', companyCode).get(),
  ])
  return summariseOrganisationResults({
    learners,
    classes: classes.docs.filter((doc) => classIds.has(doc.id)).map((doc) => ({ id: doc.id, ...doc.data() })),
    submissions: submissions.docs.map((doc) => doc.data()).filter((row) => learnerIds.has(text(row.learnerId))),
    certificates: certificates.docs.map((doc) => doc.data()).filter((row) => learnerIds.has(text(row.learnerId))),
  })
}
