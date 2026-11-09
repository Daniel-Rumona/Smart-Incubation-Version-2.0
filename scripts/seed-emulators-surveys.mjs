// Surveys of the awareness training company in the local emulators (used by seed-emulators.mjs): her training pack's
// participant feedback form, closed with answers from the finished class and open for the running class (learners
// with a sign-in can answer it), and an open questionnaire for client companies (the Kgalagadi director can answer it).
// Fixed ids, so re-running restores the same records without touching anything else.

const question = (id, type, text, options = [], required = true) => ({ id, type, text, options, required })

const FEEDBACK = [
    question('q-clear', 'rating', 'The training objectives were clear.'),
    question('q-relevant', 'rating', 'Examples were relevant to my workplace.'),
    question('q-actions', 'rating', 'I can identify at least three ESG actions.'),
    question('q-useful', 'text', 'Most useful activity'),
    question('q-improve', 'text', 'Suggested improvement', [], false),
]

const CLIENT = [
    question('q-satisfied', 'rating', 'Overall, how satisfied are you with the training your people attended?'),
    question('q-useful-esg', 'rating', 'How useful is it to your company\'s ESG work?'),
    question('q-more', 'yesno', 'Would you send more staff to this training?'),
    question('q-next', 'choice', 'What would help your company most next?', ['More staff trained', 'An ESG report', 'A carbon footprint', 'Help with an ESG policy']),
    question('q-else', 'text', 'Anything else we should know?', [], false),
]

export const SURVEY_IDS = { feedbackDone: 'tns-survey-feedback-oct', feedbackNow: 'tns-survey-feedback-nov', clients: 'tns-survey-clients' }

/** Writes the surveys and the finished class's answers; returns how many records were written. */
export const seedSurveys = async ({ db, day, companyCode, keletsoUid, classIds }) => {
    const now = new Date().toISOString()
    const batch = db.batch()
    let records = 0
    const put = (path, data) => {
        batch.set(db.doc(path), data)
        records += 1
    }
    const survey = (id, values) => put(`trainingSurveys/${id}`, { companyCode, hideNames: false, createdAt: now, createdBy: keletsoUid, updatedAt: now, ...values })

    survey(SURVEY_IDS.feedbackDone, {
        title: 'Participant feedback form', description: 'Tell us how the training went. It takes two minutes.',
        audience: 'learners', classIds: [classIds.done], status: 'closed', questions: FEEDBACK, openedAt: `${day(-28)}T15:30:00.000Z`, closedAt: `${day(-21)}T09:00:00.000Z`,
    })
    survey(SURVEY_IDS.feedbackNow, {
        title: 'Participant feedback form', description: 'Tell us how the training went. It takes two minutes.',
        audience: 'learners', classIds: [classIds.now], status: 'open', questions: FEEDBACK, openedAt: now,
    })
    survey(SURVEY_IDS.clients, {
        title: 'How did the training work for your company?', description: 'Your answers help us plan the next trainings and ESG work with you.',
        audience: 'companies', classIds: [], status: 'open', questions: CLIENT, openedAt: now,
    })

    // The finished class's answers (Pule signs in; the others are shown as if they had answered on the day).
    const answers = [
        ['learner-pule', 'Pule Mahlangu', 'Kgalagadi Mining (Pty) Ltd', { 'q-clear': 5, 'q-relevant': 4, 'q-actions': 5, 'q-useful': 'The group case study on our own mine\'s water use.', 'q-improve': 'More time for the 90-day plan.' }],
        ['seed-learner-zanele', 'Zanele Mthembu', 'Marula Logistics', { 'q-clear': 4, 'q-relevant': 4, 'q-actions': 4, 'q-useful': 'Working out Scope 1, 2 and 3 for a delivery fleet.' }],
        ['seed-learner-emre', 'Emre Kaya', 'Anatolia Retail A.Ş.', { 'q-clear': 5, 'q-relevant': 3, 'q-actions': 4, 'q-useful': 'The GRI and TSRS comparison.', 'q-improve': 'Examples from retail, not only mining.' }],
    ]
    for (const [uid, name, organisation, given] of answers) {
        put(`trainingSurveyResponses/${SURVEY_IDS.feedbackDone}__${uid}`, {
            companyCode, surveyId: SURVEY_IDS.feedbackDone, respondentUid: uid, audience: 'learners', classId: classIds.done,
            name, organisation, answers: given, submittedAt: `${day(-27)}T15:45:00.000Z`, updatedAt: `${day(-27)}T15:45:00.000Z`,
        })
    }
    await batch.commit()
    return { records }
}
