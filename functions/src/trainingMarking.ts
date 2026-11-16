/**
 * Automatic marking of multiple-choice questions in awareness-training tests (any Training workspace).
 *
 * A learner cannot read the memo, so the correct options are checked here when a test is handed in: each
 * multiple-choice question with a correct option in the memo gets full marks for that option and 0 otherwise. A test
 * of only such questions is marked completely (status `marked`), so the learner's result is ready at once; a test that
 * also has written questions keeps status `submitted` with the multiple-choice marks filled in, for the facilitator to
 * mark the rest. Same rule as choiceMarks/marksItself in the web app (src/utils/trainingResults.ts).
 */

type Question = { id?: unknown, marks?: unknown, type?: unknown }

const clean = (value: unknown) => String(value ?? '').trim()
const marksOf = (question: Question) => (typeof question.marks === 'number' && question.marks > 0 ? Math.round(question.marks) : 1)
const isChoice = (question: Question) => question.type === 'choice'

export type AutoMarking = {
  marks: Record<string, number>
  /** Every question marked itself: the whole test is marked. */
  complete: boolean
  score?: number
  totalMarks?: number
  scorePct?: number
}

/** The marks the multiple-choice questions earn, or null when the test has none that can be marked automatically. */
export const autoMarkSubmission = (
  questionsValue: unknown,
  answersValue: unknown,
  memoValue: unknown,
  existingMarks: unknown = {},
): AutoMarking | null => {
  const questions = (Array.isArray(questionsValue) ? questionsValue : []).filter((row): row is Question => Boolean(row) && typeof row === 'object' && Boolean(clean((row as Question).id)))
  const answers = (answersValue && typeof answersValue === 'object' ? answersValue : {}) as Record<string, unknown>
  const memo = (memoValue && typeof memoValue === 'object' ? memoValue : {}) as Record<string, unknown>
  const markable = questions.filter((question) => isChoice(question) && clean(memo[clean(question.id)]))
  if (!markable.length) return null

  const choice = Object.fromEntries(markable.map((question) => {
    const id = clean(question.id)
    const given = clean(answers[id]).toLowerCase()
    return [id, given !== '' && given === clean(memo[id]).toLowerCase() ? marksOf(question) : 0]
  }))
  const kept = existingMarks && typeof existingMarks === 'object' ? existingMarks as Record<string, number> : {}
  const marks = { ...kept, ...choice }
  const complete = markable.length === questions.length
  if (!complete) return { marks, complete }

  const totalMarks = questions.reduce((sum, question) => sum + marksOf(question), 0)
  const score = questions.reduce((sum, question) => sum + Math.min(Math.max(0, Number(marks[clean(question.id)]) || 0), marksOf(question)), 0)
  return { marks, complete, score, totalMarks, scorePct: totalMarks ? Math.round((score / totalMarks) * 100) : 0 }
}

/** Only an online attempt that has just been handed in is marked here (paper attempts have no answers). */
export const isNewlyHandedIn = (before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined) =>
  Boolean(after) && after?.status === 'submitted' && before?.status !== 'submitted' && after?.source !== 'paper'
