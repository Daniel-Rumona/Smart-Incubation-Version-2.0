/**
 * Surveys of the awareness training company (client module awarenessTraining): feedback forms its learners answer
 * after a class, and questionnaires for its client companies. Kept apart from the incubator surveys (formTemplates),
 * which go to a programme's SMEs.
 */

export type TrainingSurveyQuestionType = 'rating' | 'choice' | 'yesno' | 'text'

export type TrainingSurveyQuestion = {
    id: string
    type: TrainingSurveyQuestionType
    text: string
    /** The choices of a 'choice' question. */
    options: string[]
    required: boolean
}

/** Learners of the chosen classes, or every registered client company. */
export type TrainingSurveyAudience = 'learners' | 'companies'

export type TrainingSurveyStatus = 'draft' | 'open' | 'closed'

export type TrainingSurvey = {
    id: string
    companyCode: string
    title: string
    description: string
    audience: TrainingSurveyAudience
    /** For learners: the classes asked; empty for every class. */
    classIds: string[]
    /** Results show answers without names (the answers are still one per person). */
    hideNames: boolean
    status: TrainingSurveyStatus
    questions: TrainingSurveyQuestion[]
    openedAt?: string
    closedAt?: string
    createdAt?: string
    createdBy?: string
    updatedAt?: string
}

export type TrainingSurveyValues = Pick<TrainingSurvey, 'title' | 'description' | 'audience' | 'classIds' | 'hideNames' | 'questions'>

/** A rating 1-5, a choice, 'yes' / 'no' or text. */
export type TrainingSurveyAnswer = number | string

/** One person's answers (id `{surveyId}__{uid}`): learners and client companies each answer once and may change it while open. */
export type TrainingSurveyResponse = {
    id: string
    companyCode: string
    surveyId: string
    respondentUid: string
    audience: TrainingSurveyAudience
    classId?: string
    organisationId?: string
    /** Left out when the survey hides names. */
    name?: string
    organisation?: string
    answers: Record<string, TrainingSurveyAnswer>
    submittedAt: string
    updatedAt?: string
}
