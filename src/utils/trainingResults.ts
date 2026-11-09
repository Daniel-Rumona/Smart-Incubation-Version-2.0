import dayjs, { type Dayjs } from 'dayjs'
import type {
    TrainingClass,
    TrainingClassPhase,
    TrainingGroup,
    TrainingLearner,
    TrainingLearnerResult,
    TrainingQuestion,
    TrainingSubmission,
} from '@/types/training'

type ClassDates = Pick<TrainingClass, 'startDate' | 'dayCount'> & Partial<Pick<TrainingClass, 'hours' | 'dayHours'>>

/** Last training day, `YYYY-MM-DD`. */
export const classEndDate = ({ startDate, dayCount }: ClassDates) =>
    dayjs(startDate).add(Math.max(1, dayCount) - 1, 'day').format('YYYY-MM-DD')

/** The hours of one training day ('1', '2', ...): that day's own hours, else the class's usual ones. */
export const hoursOfDay = (trainingClass: Partial<Pick<TrainingClass, 'hours' | 'dayHours'>>, day: string) => trainingClass.dayHours?.[day] || trainingClass.hours

/** A class is finished once its last day has ended: after that day's end time, or the day after it without hours. */
export const classPhase = (trainingClass: ClassDates, now: Dayjs = dayjs()): TrainingClassPhase => {
    if (now.isBefore(dayjs(trainingClass.startDate), 'day')) return 'upcoming'
    const lastDay = classEndDate(trainingClass)
    if (now.isAfter(dayjs(lastDay), 'day')) return 'finished'
    const lastHours = hoursOfDay(trainingClass, String(Math.max(1, trainingClass.dayCount)))
    if (lastHours && now.isSame(dayjs(lastDay), 'day') && now.format('HH:mm') >= lastHours.end) return 'finished'
    return 'running'
}

/** The assessment a class writes as its pre-assessment or post-assessment. */
export const assessmentIdFor = (trainingClass: Pick<TrainingClass, 'assessmentId' | 'preAssessmentId'>, kind: TrainingSubmission['kind']) =>
    (kind === 'pre' ? trainingClass.preAssessmentId || trainingClass.assessmentId : trainingClass.assessmentId)

/** The attendance register's day keys: '1', '2', ... */
export const trainingDays = (dayCount: number) =>
    Array.from({ length: Math.max(1, dayCount) }, (_, index) => String(index + 1))

export const totalMarksOf = (questions: TrainingQuestion[]) =>
    questions.reduce((sum, question) => sum + Math.max(0, question.marks), 0)

/** Marks above a question's maximum are capped, so a typo cannot push a score past 100%. */
export const scoreMarks = (questions: TrainingQuestion[], marks: Record<string, number>) => {
    const totalMarks = totalMarksOf(questions)
    const score = questions.reduce((sum, question) => sum + Math.min(Math.max(0, marks[question.id] ?? 0), question.marks), 0)
    return { score, totalMarks, scorePct: totalMarks ? Math.round((score / totalMarks) * 100) : 0 }
}

export const groupOfLearner = (learnerId: string, groups: TrainingGroup[]) =>
    groups.find((group) => group.learnerIds.includes(learnerId))

const bestMarkedPct = (submissions: TrainingSubmission[]) => {
    const scores = submissions
        .filter((submission) => submission.status === 'marked' && typeof submission.scorePct === 'number')
        .map((submission) => submission.scorePct as number)
    return scores.length ? Math.max(...scores) : undefined
}

/**
 * Where a learner stands against the class pass rule: the best marked post-assessment at or above the pass mark and,
 * when the class requires it, taking part in a group whose assignment has been marked.
 */
export const learnerResult = (
    trainingClass: Pick<TrainingClass, 'passMarkPct' | 'reassessmentsAllowed' | 'groupAssignmentRequired'>,
    learner: TrainingLearner,
    submissions: TrainingSubmission[],
    groups: TrainingGroup[],
): TrainingLearnerResult => {
    const own = submissions.filter((submission) => submission.learnerId === learner.id)
    const posts = own.filter((submission) => submission.kind === 'post')
    const preScorePct = bestMarkedPct(own.filter((submission) => submission.kind === 'pre'))
    const postScorePct = bestMarkedPct(posts)
    const awaitingMarking = posts.some((submission) => submission.status === 'submitted')

    const group = groupOfLearner(learner.id, groups)
    const groupMarked = Boolean(group?.markedAt)
    const groupParticipated = groupMarked && !group?.absentLearnerIds.includes(learner.id)
    const groupSatisfied = !trainingClass.groupAssignmentRequired || groupParticipated

    let status: TrainingLearnerResult['status']
    if (postScorePct === undefined) {
        status = awaitingMarking ? 'awaiting_marking' : 'not_started'
    } else if (postScorePct >= trainingClass.passMarkPct) {
        if (groupSatisfied) status = 'passed'
        else status = groupMarked ? 'not_passed' : 'awaiting_group'
    } else if (awaitingMarking) {
        status = 'awaiting_marking'
    } else if (posts.length < 1 + Math.max(0, trainingClass.reassessmentsAllowed)) {
        status = 'reassessment_available'
    } else {
        status = 'not_passed'
    }

    return { learner, preScorePct, postScorePct, postAttempts: posts.length, group, groupParticipated, status }
}

/** Whether another post-assessment may be started: the first one, or a reassessment the pass rule still allows. */
export const canStartPostTest = (result: TrainingLearnerResult, submissions: TrainingSubmission[]) => {
    const open = submissions.some((submission) => submission.learnerId === result.learner.id && submission.kind === 'post' && submission.status !== 'marked')
    if (open) return false
    return result.postAttempts === 0 || result.status === 'reassessment_available'
}

export const nextAttemptNumber = (learnerId: string, kind: TrainingSubmission['kind'], submissions: TrainingSubmission[]) =>
    submissions
        .filter((submission) => submission.learnerId === learnerId && submission.kind === kind)
        .reduce((highest, submission) => Math.max(highest, submission.attempt), 0) + 1

/** One record per learner, test and attempt, so the same attempt can never be started twice. */
export const submissionIdFor = (learnerId: string, kind: TrainingSubmission['kind'], attempt: number) =>
    `${learnerId}__${kind}__${attempt}`

/**
 * What a learner may start themselves, from their own attempts only (they cannot see group marks): the pre-assessment
 * once; the post-assessment once, then a reassessment while their best marked score is below the pass mark and
 * attempts remain. Nothing while an attempt is unfinished or waiting to be marked.
 */
export const learnerMayStart = (
    trainingClass: Pick<TrainingClass, 'passMarkPct' | 'reassessmentsAllowed' | 'testsOpen'>,
    kind: TrainingSubmission['kind'],
    ownSubmissions: TrainingSubmission[],
) => {
    if (!trainingClass.testsOpen[kind]) return false
    const attempts = ownSubmissions.filter((submission) => submission.kind === kind)
    if (attempts.some((submission) => submission.status !== 'marked')) return false
    if (kind === 'pre') return attempts.length === 0
    if (attempts.length === 0) return true
    const best = bestMarkedPct(attempts)
    return best !== undefined && best < trainingClass.passMarkPct && attempts.length < 1 + Math.max(0, trainingClass.reassessmentsAllowed)
}

/** The training day a date falls on ('1', '2', ...), or null outside the class. */
export const trainingDayOn = (trainingClass: ClassDates, date: Dayjs = dayjs()) => {
    const offset = date.startOf('day').diff(dayjs(trainingClass.startDate).startOf('day'), 'day')
    return offset >= 0 && offset < Math.max(1, trainingClass.dayCount) ? String(offset + 1) : null
}
