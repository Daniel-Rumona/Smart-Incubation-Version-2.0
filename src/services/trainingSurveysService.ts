import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore'
import { getFirebaseDb } from '@/config/firebase'
import { trainingCompanyOf } from '@/services/trainingService'
import type { FullIdentity } from '@/types/identity'
import type {
    TrainingSurvey,
    TrainingSurveyAnswer,
    TrainingSurveyAudience,
    TrainingSurveyQuestion,
    TrainingSurveyResponse,
    TrainingSurveyStatus,
    TrainingSurveyValues,
} from '@/types/trainingSurveys'

/**
 * Surveys of the awareness training company (types/trainingSurveys.ts). Staff build, open and close them and read the
 * answers; an open survey reaches its audience in the same company (learners of the chosen classes, or the client
 * companies), and each person answers once, changing it while the survey is open. firestore.rules check each of these.
 */

const SURVEYS = 'trainingSurveys'
const RESPONSES = 'trainingSurveyResponses'
const TYPES: TrainingSurveyQuestion['type'][] = ['rating', 'choice', 'yesno', 'text']
const STATUSES: TrainingSurveyStatus[] = ['draft', 'open', 'closed']

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')
const now = () => new Date().toISOString()
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

export const toTrainingSurvey = (id: string, data: Record<string, unknown>): TrainingSurvey => ({
    id,
    companyCode: text(data.companyCode),
    title: text(data.title),
    description: text(data.description),
    audience: data.audience === 'companies' ? 'companies' : 'learners',
    classIds: strings(data.classIds),
    hideNames: data.hideNames === true,
    status: STATUSES.includes(data.status as TrainingSurveyStatus) ? data.status as TrainingSurveyStatus : 'draft',
    questions: (Array.isArray(data.questions) ? data.questions : [])
        .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object')
        .map((row) => ({
            id: text(row.id),
            type: TYPES.includes(row.type as TrainingSurveyQuestion['type']) ? row.type as TrainingSurveyQuestion['type'] : 'text',
            text: text(row.text),
            options: strings(row.options),
            required: row.required !== false,
        })),
    openedAt: text(data.openedAt) || undefined,
    closedAt: text(data.closedAt) || undefined,
    createdAt: text(data.createdAt) || undefined,
    createdBy: text(data.createdBy) || undefined,
    updatedAt: text(data.updatedAt) || undefined,
})

export const toTrainingSurveyResponse = (id: string, data: Record<string, unknown>): TrainingSurveyResponse => {
    const answers: Record<string, TrainingSurveyAnswer> = {}
    if (data.answers && typeof data.answers === 'object') {
        for (const [key, value] of Object.entries(data.answers as Record<string, unknown>)) {
            if (typeof value === 'number' || typeof value === 'string') answers[key] = value
        }
    }
    return {
        id,
        companyCode: text(data.companyCode),
        surveyId: text(data.surveyId),
        respondentUid: text(data.respondentUid),
        audience: data.audience === 'companies' ? 'companies' : 'learners',
        classId: text(data.classId) || undefined,
        organisationId: text(data.organisationId) || undefined,
        name: text(data.name) || undefined,
        organisation: text(data.organisation) || undefined,
        answers,
        submittedAt: text(data.submittedAt),
        updatedAt: text(data.updatedAt) || undefined,
    }
}

const cleanValues = (values: TrainingSurveyValues) => ({
    title: values.title.trim(),
    description: values.description.trim(),
    audience: values.audience,
    classIds: values.audience === 'learners' ? [...new Set(values.classIds)] : [],
    hideNames: values.hideNames,
    questions: values.questions.map((item) => ({
        id: item.id,
        type: item.type,
        text: item.text.trim(),
        options: item.type === 'choice' ? item.options.map((option) => option.trim()).filter(Boolean) : [],
        required: item.required,
    })),
})

// Staff

export const listTrainingSurveys = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), SURVEYS), where('companyCode', '==', companyCode)))
    return snapshot.docs.map((row) => toTrainingSurvey(row.id, row.data())).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}

export const getTrainingSurvey = async (user: FullIdentity, surveyId: string) => {
    trainingCompanyOf(user)
    const snapshot = await getDoc(doc(getFirebaseDb(), SURVEYS, surveyId))
    return snapshot.exists() ? toTrainingSurvey(snapshot.id, snapshot.data()) : null
}

export const createTrainingSurvey = async (user: FullIdentity, values: TrainingSurveyValues) => {
    const companyCode = trainingCompanyOf(user)
    const created = await addDoc(collection(getFirebaseDb(), SURVEYS), {
        ...cleanValues(values), companyCode, status: 'draft', createdAt: now(), createdBy: user.uid, updatedAt: now(),
    })
    return created.id
}

export const updateTrainingSurvey = async (user: FullIdentity, surveyId: string, values: TrainingSurveyValues) => {
    trainingCompanyOf(user)
    await updateDoc(doc(getFirebaseDb(), SURVEYS, surveyId), { ...cleanValues(values), updatedAt: now() })
}

export const setTrainingSurveyStatus = async (user: FullIdentity, survey: TrainingSurvey, status: TrainingSurveyStatus) => {
    trainingCompanyOf(user)
    await updateDoc(doc(getFirebaseDb(), SURVEYS, survey.id), {
        status,
        ...(status === 'open' && !survey.openedAt ? { openedAt: now() } : {}),
        ...(status === 'closed' ? { closedAt: now() } : {}),
        updatedAt: now(),
    })
}

/** A survey nobody has answered can be deleted; one with answers is closed instead. */
export const deleteTrainingSurvey = async (user: FullIdentity, surveyId: string) => {
    trainingCompanyOf(user)
    await deleteDoc(doc(getFirebaseDb(), SURVEYS, surveyId))
}

export const listSurveyResponses = async (user: FullIdentity, surveyId: string) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), RESPONSES), where('companyCode', '==', companyCode), where('surveyId', '==', surveyId)))
    return snapshot.docs.map((row) => toTrainingSurveyResponse(row.id, row.data())).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))
}

/** How many have answered each survey, for the list. */
export const countSurveyResponses = async (user: FullIdentity) => {
    const companyCode = trainingCompanyOf(user)
    const snapshot = await getDocs(query(collection(getFirebaseDb(), RESPONSES), where('companyCode', '==', companyCode)))
    const counts = new Map<string, number>()
    for (const row of snapshot.docs) {
        const surveyId = text(row.data().surveyId)
        counts.set(surveyId, (counts.get(surveyId) || 0) + 1)
    }
    return counts
}

// Learners and client companies

/** The respondent's company (their training provider) and audience, from their role. */
const respondentOf = (user?: FullIdentity | null): { companyCode: string, audience: TrainingSurveyAudience } => {
    const companyCode = text(user?.companyCode)
    if (!user || !companyCode) throw new Error('forbidden')
    if (user.role === 'learner') return { companyCode, audience: 'learners' }
    if (user.role === 'clientorg' && text(user.organisationId)) return { companyCode, audience: 'companies' }
    throw new Error('forbidden')
}

export const responseIdFor = (surveyId: string, uid: string) => `${surveyId}__${uid}`

export type MySurvey = { survey: TrainingSurvey, response: TrainingSurveyResponse | null }

/**
 * The open surveys for this learner or client company, with their own answers. A learner sees the surveys for any of
 * their classes (`classIds`, from their enrolments); a client company every open survey for companies.
 */
export const listMySurveys = async (user: FullIdentity, classIds: string[] = []): Promise<MySurvey[]> => {
    const own = respondentOf(user)
    const db = getFirebaseDb()
    const [surveys, responses] = await Promise.all([
        getDocs(query(collection(db, SURVEYS), where('companyCode', '==', own.companyCode), where('audience', '==', own.audience), where('status', '==', 'open'))),
        getDocs(query(collection(db, RESPONSES), where('companyCode', '==', own.companyCode), where('respondentUid', '==', user.uid))),
    ])
    const mine = new Map(responses.docs.map((row) => [text(row.data().surveyId), toTrainingSurveyResponse(row.id, row.data())]))
    return surveys.docs
        .map((row) => toTrainingSurvey(row.id, row.data()))
        .filter((survey) => own.audience === 'companies' || !survey.classIds.length || survey.classIds.some((id) => classIds.includes(id)))
        .map((survey) => ({ survey, response: mine.get(survey.id) || null }))
        .sort((a, b) => Number(Boolean(a.response)) - Number(Boolean(b.response)) || (b.survey.openedAt || '').localeCompare(a.survey.openedAt || ''))
}

export const getMySurvey = async (user: FullIdentity, surveyId: string): Promise<MySurvey | null> => {
    respondentOf(user)
    const db = getFirebaseDb()
    const snapshot = await getDoc(doc(db, SURVEYS, surveyId))
    if (!snapshot.exists()) return null
    const response = await getDoc(doc(db, RESPONSES, responseIdFor(surveyId, user.uid)))
    return { survey: toTrainingSurvey(snapshot.id, snapshot.data()), response: response.exists() ? toTrainingSurveyResponse(response.id, response.data()) : null }
}

/**
 * Saves this person's answers (again, while the survey is open). A learner answers for one of the survey's classes
 * they are in; a client company for itself. Names are left out when the survey hides them.
 */
export const submitMySurvey = async (
    user: FullIdentity,
    survey: TrainingSurvey,
    answers: Record<string, TrainingSurveyAnswer>,
    about: { classId?: string, name: string, organisation: string },
    existing: TrainingSurveyResponse | null,
) => {
    const own = respondentOf(user)
    if (own.audience !== survey.audience || own.companyCode !== survey.companyCode) throw new Error('forbidden')
    const kept: Record<string, TrainingSurveyAnswer> = {}
    for (const item of survey.questions) {
        const value = answers[item.id]
        if (typeof value === 'number' || (typeof value === 'string' && value.trim())) kept[item.id] = typeof value === 'string' ? value.trim() : value
    }
    const record: Record<string, unknown> = {
        companyCode: survey.companyCode,
        surveyId: survey.id,
        respondentUid: user.uid,
        audience: survey.audience,
        answers: kept,
        submittedAt: existing?.submittedAt || now(),
        updatedAt: now(),
    }
    if (survey.audience === 'learners') record.classId = about.classId || ''
    else record.organisationId = text(user.organisationId)
    if (!survey.hideNames) {
        record.name = about.name
        record.organisation = about.organisation
    }
    await setDoc(doc(getFirebaseDb(), RESPONSES, responseIdFor(survey.id, user.uid)), record)
}
