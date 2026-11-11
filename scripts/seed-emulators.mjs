// Seeds the LOCAL Firebase emulators with test data for the awareness training client module (Tau Namagadi
// Sustainable Solutions), plus one ordinary company that must not see any of it.
//
//   npm run emulators                    # terminal 1: starts the emulators and runs this seed
//   npm run dev:emulators                # terminal 2: the app, pointed at the emulators
//   npm run emulators:seed               # writes the test data again; safe to re-run
//   npm run emulators:seed -- --reset    # wipes the emulator database and sign-ins first
//
// It sets the emulator hosts itself and only uses the demo-smartinc project, so it cannot reach a real Firebase
// project. Records use fixed ids: re-running restores them (anything else you created stays).
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import dayjs from 'dayjs'
import { seedIncubators } from './seed-emulators-incubators.mjs'
import { seedEsgAndRevenue } from './seed-emulators-esg.mjs'
import { seedCompaniesAndLibrary } from './seed-emulators-companies.mjs'
import { seedSurveys } from './seed-emulators-surveys.mjs'
import { seedTrainingOnly } from './seed-emulators-training-only.mjs'

const PROJECT_ID = 'demo-smartinc'
const BUCKET = `${PROJECT_ID}.appspot.com`
const HOST = '127.0.0.1'
const PASSWORD = 'Password@1'
const APP_URL = 'http://localhost:5173'

Object.assign(process.env, {
    FIRESTORE_EMULATOR_HOST: `${HOST}:8080`,
    FIREBASE_AUTH_EMULATOR_HOST: `${HOST}:9099`,
    FIREBASE_STORAGE_EMULATOR_HOST: `${HOST}:9199`,
    GCLOUD_PROJECT: PROJECT_ID,
})
delete process.env.GOOGLE_APPLICATION_CREDENTIALS

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')

const reset = process.argv.includes('--reset')

const emulatorUp = async (port) => {
    try {
        await fetch(`http://${HOST}:${port}/`)
        return true
    } catch {
        return false
    }
}

for (const [name, port] of [['Firestore', 8080], ['Auth', 9099], ['Storage', 9199]]) {
    if (!await emulatorUp(port)) {
        console.error(`The ${name} emulator is not running on ${HOST}:${port}. Start the emulators first: npm run emulators`)
        process.exit(1)
    }
}

if (reset) {
    await fetch(`http://${HOST}:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`, { method: 'DELETE' })
    await fetch(`http://${HOST}:9099/emulator/v1/projects/${PROJECT_ID}/accounts`, { method: 'DELETE' })
    console.log('Wiped the emulator database and sign-ins.')
}

initializeApp({ projectId: PROJECT_ID, storageBucket: BUCKET })
const auth = getAuth()
const db = getFirestore()
const bucket = getStorage().bucket(BUCKET)

const now = () => new Date().toISOString()
const today = dayjs().startOf('day')
const day = (offset) => today.add(offset, 'day').format('YYYY-MM-DD')
const at = (offset, hour = 9) => today.add(offset, 'day').hour(hour).toISOString()

// ---- Files -------------------------------------------------------------------------------------------------------

/** Uploads a file and returns its download link, the same shape of link the app stores after an upload. */
const upload = async (path, data, contentType) => {
    const token = randomUUID()
    await bucket.file(path).save(data, { contentType, metadata: { metadata: { firebaseStorageDownloadTokens: token } } })
    return `http://${HOST}:9199/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media&token=${token}`
}

/** A one-page PDF with a line of text: the stand-in for a learner's ID copy. */
const samplePdf = (line) => {
    const content = `BT /F1 20 Tf 72 760 Td (${line}) Tj ET`
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ]
    let pdf = '%PDF-1.4\n'
    const offsets = objects.map((body, index) => {
        const offset = pdf.length
        pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
        return offset
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(pdf, 'latin1')
}

const asset = (name) => readFileSync(new URL(`../emulators/seed-assets/${name}`, import.meta.url))

// ---- Companies and accounts --------------------------------------------------------------------------------------

const TNS = 'TNS'
const TNS_NAME = 'Tau Namagadi Sustainable Solutions'

const ensureSignIn = async ({ uid, email, name }) => {
    const values = { email, password: PASSWORD, displayName: name, emailVerified: true, disabled: false }
    try {
        await auth.getUser(uid)
        await auth.updateUser(uid, values)
    } catch (error) {
        if (error?.code !== 'auth/user-not-found') throw error
        try {
            await auth.createUser({ uid, ...values })
        } catch (createError) {
            if (createError?.code === 'auth/email-already-exists') {
                throw new Error(`${email} already belongs to another test account. Run: npm run emulators:seed -- --reset`)
            }
            throw createError
        }
    }
}

const agreementId = (scope, uid, key) =>
    `${scope}_${uid}_${key}_generic-company-agreements-v1`.replace(/[^A-Za-z0-9_-]/g, '_')
// SMEs sign the Code of Conduct and the consent form; everyone else signs the consent form (agreementsService.ts).
const AGREEMENT_TITLES = {
    'code-of-conduct': 'Code of Conduct & Funding Acknowledgement',
    'company-consent': 'Consent to Collect, Process and Share Information',
}

/** The sign-in, profile and signed agreements of someone who has already been through the welcome steps. */
const seedPerson = async ({ uid, email, name, role, companyCode, companyName, signature, extra = {} }) => {
    await ensureSignIn({ uid, email, name })
    const signatureFields = signature
        ? { signatureURL: signature.url, signature: { url: signature.url, storagePath: signature.path, updatedAt: now() }, signatureStrokes: null, signatureUpdatedAt: now() }
        : {}
    const profile = {
        uid,
        email,
        name,
        displayName: name,
        role,
        companyCode: companyCode || null,
        ...(companyName ? { companyName, company: companyName } : {}),
        assignedProgramIds: [],
        emailVerified: true,
        firstLoginComplete: true,
        mustChangePassword: false,
        active: true,
        status: 'active',
        whatsappConsent: { status: 'declined', source: 'welcome', at: now() },
        ...signatureFields,
        ...extra,
        seededBy: 'emulators',
        updatedAt: FieldValue.serverTimestamp(),
    }
    const scope = companyCode || 'platform'
    const agreements = role === 'incubatee' ? ['code-of-conduct', 'company-consent'] : ['company-consent']
    await Promise.all([
        db.doc(`users/${uid}`).set({ ...profile, createdAt: FieldValue.serverTimestamp() }, { merge: true }),
        db.doc(`userIdentities/${uid}`).set({ uid, email, name, displayName: name, role, companyCode: companyCode || null, mustChangePassword: false, updatedAt: FieldValue.serverTimestamp() }, { merge: true }),
        ...agreements.map((key) => db.doc(`companyAgreementSubmissions/${agreementId(scope, uid, key)}`).set({
            agreementKey: key,
            agreementTitle: AGREEMENT_TITLES[key],
            accepted: true,
            acceptedAt: FieldValue.serverTimestamp(),
            acceptedByUid: uid,
            acceptedByEmail: email,
            acceptedByRole: role,
            companyCode: scope,
            companyName: companyName || 'Smart Incubation',
            signatureURL: signature?.url || null,
            version: 'generic-company-agreements-v1',
        })),
    ])
}

const logoPath = 'company-logos/seed/tau-namagadi-logo.png'
const logoUrl = await upload(logoPath, asset('tau-namagadi-logo.png'), 'image/png')
const keletsoUid = 'tns-keletso'
const signaturePath = `user-signatures/${keletsoUid}/seed-signature.png`
const signature = { path: signaturePath, url: await upload(signaturePath, asset('test-signature.png'), 'image/png') }
// Everyone else seeded shares one stored test signature.
const sharedSignaturePath = 'user-signatures/seed/test-signature.png'
const sharedSignature = { path: sharedSignaturePath, url: await upload(sharedSignaturePath, asset('test-signature.png'), 'image/png') }

const companyDefaults = {
    status: 'active',
    locked: true,
    consultantLabel: 'Consultants',
    hasDepartments: false,
    hasBranches: false,
    smeOnboardingModel: 'self_application',
    assignmentModel: 'ops_assign_consultant',
    interventionScopeModel: 'program_specific',
    subscription: { tier: 'premium', addOns: [] },
    seededBy: 'emulators',
}

await db.doc(`companies/${TNS}`).set({
    ...companyDefaults,
    companyCode: TNS,
    name: TNS_NAME,
    companyName: TNS_NAME,
    logoUrl,
    interventionDeliveryRoles: ['projectadmin'],
    awarenessTrainingEnabled: true,
    esgReportingEnabled: true,
    clientHomeModule: 'awarenessTraining',
})

const accounts = [
    { uid: 'qtx-systemadmin', email: 'admin@smartinc.test', name: 'Quantilytix Admin', role: 'systemadmin', signature: sharedSignature, note: 'Platform: Admin > Workspace types' },
    { uid: 'qtx-prince', email: 'prince@quantilytix.co.za', name: 'Prince', role: 'systemadmin', signature: sharedSignature, note: 'Platform admin (Prince): Admin > Workspace types' },
    { uid: keletsoUid, email: 'keletso@taunamagadi.co.za', name: 'Keletso', role: 'projectadmin', companyCode: TNS, companyName: TNS_NAME, signature, note: `${TNS_NAME}: the facilitator` },
]

// ---- Training ----------------------------------------------------------------------------------------------------

const ASSESSMENT_ID = 'tns-sample-test'
const questions = [
    { id: 'q1', marks: 4, text: 'What do the letters E, S and G stand for? Give one example of each.' },
    { id: 'q2', marks: 4, text: 'What is a stakeholder? Name three stakeholders of a mining company.' },
    { id: 'q3', marks: 4, text: 'Explain what "materiality" means in sustainability reporting.' },
    { id: 'q4', marks: 4, text: 'What are the GRI Standards, and which kinds of organisations use them?' },
    { id: 'q5', marks: 4, text: 'Give two reasons why ESG matters to a company\'s clients and funders.' },
]
const memo = {
    q1: 'Environmental (e.g. emissions, water, waste), Social (e.g. health and safety, labour practices, community relations), Governance (e.g. board oversight, ethics, anti-corruption).',
    q2: 'A person or group that affects or is affected by the organisation, e.g. employees, local communities, regulators, investors, suppliers, customers.',
    q3: 'Finding and prioritising the topics where the organisation has its most significant impacts on the economy, environment and people; these decide what is reported.',
    q4: 'A global framework for sustainability reporting (Universal, Sector e.g. GRI 14 Mining, and Topic Standards), usable by organisations of any size, sector or country.',
    q5: 'Access to finance and investor requirements; customers\' supply-chain requirements; risk management; reputation; regulation.',
}
const rubric = [
    { id: 'r1', label: 'Material topics', maxMarks: 5, guidance: 'Three distinct E, S and G topics with a reason for each' },
    { id: 'r2', label: 'Stakeholders', maxMarks: 5, guidance: 'The stakeholders affected by each topic' },
    { id: 'r3', label: 'Indicators', maxMarks: 5, guidance: 'One measurable indicator per topic' },
    { id: 'r4', label: 'Presentation and teamwork', maxMarks: 5, guidance: 'Clear presentation; every member contributes' },
]
const totalMarks = questions.reduce((sum, question) => sum + question.marks, 0)

const writes = []
const put = (path, data) => writes.push([path, data])

put(`trainingAssessments/${ASSESSMENT_ID}`, {
    companyCode: TNS,
    title: 'ESG Awareness Assessment (sample)',
    instructions: 'Answer every question in your own words. The pre-assessment is not counted; the post-assessment is.',
    durationMinutes: 30,
    questions,
    caseBrief: 'Kgalagadi Mining (a fictional company) is preparing its first sustainability report. As a group, choose its three most material ESG topics, the stakeholders affected by each, and one indicator it could report for each topic.',
    rubric,
    createdAt: now(),
    updatedAt: now(),
    updatedBy: keletsoUid,
})
put(`trainingAssessmentMemos/${ASSESSMENT_ID}`, { companyCode: TNS, answers: memo })

const classBase = {
    companyCode: TNS,
    courseTitle: 'ESG Awareness Training',
    dayCount: 3,
    assessmentId: ASSESSMENT_ID,
    passMarkPct: 70,
    reassessmentsAllowed: 1,
    groupAssignmentRequired: true,
    createdAt: now(),
    createdBy: keletsoUid,
    updatedAt: now(),
    updatedBy: keletsoUid,
}

// Learners: `account` ones can sign in (already through the welcome steps); the rest are still to be invited.
const learners = [
    // A running class (day 1 is the day you seed), in person.
    { id: 'tns-now-lerato', classId: 'tns-class-now', name: 'Lerato Mokoena', organisation: 'Kgalagadi Mining (Pty) Ltd', email: 'lerato@kgalagadi-mining.test', account: true },
    { id: 'tns-now-thabo', classId: 'tns-class-now', name: 'Thabo Nkosi', organisation: 'Kgalagadi Mining (Pty) Ltd', email: 'thabo@kgalagadi-mining.test', account: true },
    { id: 'tns-now-ayse', classId: 'tns-class-now', name: 'Ayşe Yılmaz', organisation: 'Anatolia Retail A.Ş.', email: 'ayse@anatolia-retail.test', account: true },
    { id: 'tns-now-sipho', classId: 'tns-class-now', name: 'Sipho Dlamini', organisation: 'Marula Logistics', email: 'sipho@marula-logistics.test', account: true },
    { id: 'tns-now-naledi', classId: 'tns-class-now', name: 'Naledi Khumalo', organisation: 'Marula Logistics', email: 'naledi@marula-logistics.test' },
    // An online class in two weeks.
    { id: 'tns-online-kabelo', classId: 'tns-class-online', name: 'Kabelo Molefe', organisation: 'Kgalagadi Mining (Pty) Ltd', email: 'kabelo@kgalagadi-mining.test' },
    { id: 'tns-online-elif', classId: 'tns-class-online', name: 'Elif Demir', organisation: 'Anatolia Retail A.Ş.', email: 'elif@anatolia-retail.test' },
    // A one-day refresher course with no group assignment: imported from a register, so no emails or ID numbers yet.
    { id: 'tns-refresh-mpho', classId: 'tns-class-refresher', name: 'Mpho Sello', organisation: 'Marula Logistics', email: '', noId: true },
    { id: 'tns-refresh-ruth', classId: 'tns-class-refresher', name: 'Ruth Botha', organisation: 'Kgalagadi Mining (Pty) Ltd', email: '', noId: true },
    // A finished class a month ago: one passed (certificate issued), one did not, one may still be reassessed.
    { id: 'tns-done-pule', classId: 'tns-class-done', name: 'Pule Mahlangu', organisation: 'Kgalagadi Mining (Pty) Ltd', email: 'pule@kgalagadi-mining.test', account: true },
    { id: 'tns-done-zanele', classId: 'tns-class-done', name: 'Zanele Mthembu', organisation: 'Marula Logistics', email: 'zanele@marula-logistics.test' },
    { id: 'tns-done-emre', classId: 'tns-class-done', name: 'Emre Kaya', organisation: 'Anatolia Retail A.Ş.', email: 'emre@anatolia-retail.test' },
].map((learner, index) => ({ ...learner, uid: learner.account ? `learner-${learner.id.split('-').pop()}` : undefined, idNumber: learner.noId ? '' : `TEST-ID-${String(index + 1).padStart(4, '0')}` }))

const learner = (id) => learners.find((entry) => entry.id === id)
const uidsOf = (classId) => learners.filter((entry) => entry.classId === classId && entry.uid).map((entry) => entry.uid)

put('trainingClasses/tns-class-now', {
    ...classBase,
    deliveryMode: 'in_person',
    venue: 'Training room (test venue)',
    startDate: day(0),
    testsOpen: { pre: true, post: false },
    learnerUids: uidsOf('tns-class-now'),
})
put('trainingClasses/tns-class-online', {
    ...classBase,
    deliveryMode: 'online',
    venue: '',
    meetingUrl: 'https://us02web.zoom.us/j/81234567890?pwd=TestOnly',
    startDate: day(14),
    testsOpen: { pre: false, post: false },
    learnerUids: uidsOf('tns-class-online'),
})
// A course without group work: its assessment has no case or rubric, so learners pass on the post-test alone.
const REFRESHER_ID = 'tns-refresher-test'
const refresherQuestions = questions.slice(0, 3)
put(`trainingAssessments/${REFRESHER_ID}`, {
    companyCode: TNS,
    title: 'ESG Refresher Quiz (no group work)',
    instructions: 'Short refresher; answer in your own words.',
    durationMinutes: 15,
    questions: refresherQuestions,
    rubric: [],
    createdAt: now(),
    updatedAt: now(),
    updatedBy: keletsoUid,
})
put(`trainingAssessmentMemos/${REFRESHER_ID}`, { companyCode: TNS, answers: Object.fromEntries(refresherQuestions.map((question) => [question.id, memo[question.id]])) })
put('trainingClasses/tns-class-refresher', {
    ...classBase,
    courseTitle: 'ESG Refresher',
    deliveryMode: 'online',
    venue: '',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/test-only',
    startDate: day(7),
    dayCount: 1,
    assessmentId: REFRESHER_ID,
    reassessmentsAllowed: 0,
    groupAssignmentRequired: false,
    testsOpen: { pre: false, post: false },
    learnerUids: [],
})
const doneClass = { startDate: day(-30), dayCount: 3, venue: 'Training room (test venue)' }
put('trainingClasses/tns-class-done', {
    ...classBase,
    deliveryMode: 'in_person',
    venue: doneClass.venue,
    startDate: doneClass.startDate,
    testsOpen: { pre: false, post: false },
    learnerUids: uidsOf('tns-class-done'),
})

const present = (recordedBy, offset) => ({ present: true, recordedAt: at(offset, 8), recordedBy })
const fullAttendance = { 1: present('facilitator', -30), 2: present('facilitator', -29), 3: present('facilitator', -28) }

// Thabo's ID copy (a stand-in PDF), waiting for the facilitator to check it.
const idCopyPath = `training-id-documents/${TNS}/tns-now-thabo/${Date.parse(at(0, 8))}_sample-id-copy.pdf`
await upload(idCopyPath, samplePdf('SAMPLE ID COPY - TEST DATA ONLY'), 'application/pdf')

const certificateId = 'seedCert0000000000001'
const issuedOn = day(-28)
const certificateYear = dayjs(issuedOn).year()

for (const entry of learners) {
    const extra = {
        'tns-now-lerato': { attendance: { 1: present('learner', 0) } },
        'tns-now-thabo': {
            attendance: { 1: present('facilitator', 0) },
            idDocument: { fileName: 'sample-id-copy.pdf', storagePath: idCopyPath, contentType: 'application/pdf', uploadedAt: at(0, 8), uploadedBy: 'learner', consentAt: at(0, 8), status: 'pending' },
        },
        'tns-done-pule': { attendance: fullAttendance, certificateId },
        'tns-done-zanele': { attendance: fullAttendance },
        'tns-done-emre': { attendance: { 1: present('facilitator', -30), 2: present('facilitator', -29) }, attendanceRemark: 'Left early on day 3 (work emergency)' },
    }[entry.id] || {}
    put(`trainingLearners/${entry.id}`, {
        companyCode: TNS,
        classId: entry.classId,
        name: entry.name,
        email: entry.email,
        idNumber: entry.idNumber,
        organisation: entry.organisation,
        phone: '',
        ...(entry.uid ? { uid: entry.uid, invitedAt: at(-1, 10) } : {}),
        attendance: {},
        ...extra,
        createdAt: now(),
        updatedAt: now(),
    })
}

const answersFor = (quality) => Object.fromEntries(questions.map((question) => [question.id, quality === 'good'
    ? `${memo[question.id].split(';')[0]}.`
    : 'I think it is about how a company looks after the environment and people.']))

const submission = (learnerId, kind, attempt, offset, marksList) => {
    const entry = learner(learnerId)
    const marks = marksList ? Object.fromEntries(questions.map((question, index) => [question.id, marksList[index]])) : {}
    const score = marksList ? marksList.reduce((sum, value) => sum + value, 0) : undefined
    put(`trainingSubmissions/${learnerId}__${kind}__${attempt}`, {
        companyCode: TNS,
        classId: entry.classId,
        learnerId,
        ...(entry.uid ? { learnerUid: entry.uid } : {}),
        assessmentId: ASSESSMENT_ID,
        kind,
        attempt,
        source: 'online',
        questions,
        answers: answersFor(score !== undefined && score >= 14 ? 'good' : 'weak'),
        status: marksList ? 'marked' : 'submitted',
        marks,
        ...(marksList ? { score, scorePct: Math.round((score / totalMarks) * 100), markedAt: at(offset, 16), markedBy: keletsoUid } : {}),
        totalMarks,
        startedAt: at(offset, 9),
        submittedAt: at(offset, 10),
    })
}

submission('tns-now-lerato', 'pre', 1, 0)                         // handed in, waiting to be marked
submission('tns-now-thabo', 'pre', 1, 0, [3, 3, 2, 2, 2])        // marked: 60% (pre-test, not counted)
submission('tns-done-pule', 'pre', 1, -30, [2, 2, 1, 2, 2])
submission('tns-done-pule', 'post', 1, -28, [4, 4, 3, 3, 3])     // 85%: passed
submission('tns-done-zanele', 'post', 1, -28, [2, 2, 2, 2, 2])   // 50%
submission('tns-done-zanele', 'post', 2, -28, [3, 3, 2, 2, 2])   // 60%, no reassessments left: not passed
submission('tns-done-emre', 'post', 1, -28, [3, 3, 2, 3, 2])     // 65%: reassessment available

put('trainingGroups/tns-done-group-a', {
    companyCode: TNS,
    classId: 'tns-class-done',
    name: 'Group A',
    learnerIds: ['tns-done-pule', 'tns-done-zanele', 'tns-done-emre'],
    absentLearnerIds: [],
    rubricMarks: { r1: 4, r2: 4, r3: 3, r4: 5 },
    total: 16,
    maxTotal: 20,
    markedAt: at(-28, 15),
    markedBy: keletsoUid,
    createdAt: at(-29, 9),
    updatedAt: at(-28, 15),
})

const doneStart = dayjs(doneClass.startDate)
const doneEnd = doneStart.add(doneClass.dayCount - 1, 'day')
const trainingDates = doneStart.isSame(doneEnd, 'month')
    ? `${doneStart.format('D')} – ${doneEnd.format('D MMM YYYY')}`
    : `${doneStart.format('D MMM')} – ${doneEnd.format('D MMM YYYY')}`
const certificateShared = {
    companyCode: TNS,
    certificateNumber: `${TNS}-${certificateYear}-0001`,
    learnerName: 'Pule Mahlangu',
    courseTitle: 'ESG Awareness Training',
    trainingDates,
    providerName: TNS_NAME,
    issuedOn,
    status: 'valid',
}
put(`trainingCertificates/${certificateId}`, {
    ...certificateShared,
    classId: 'tns-class-done',
    learnerId: 'tns-done-pule',
    learnerUid: learner('tns-done-pule').uid,
    organisation: 'Kgalagadi Mining (Pty) Ltd',
    deliveryLabel: doneClass.venue,
    logoUrl,
    signatoryName: 'Keletso',
    signatureUrl: signature.url,
    issuedAt: at(-28, 16),
    issuedBy: keletsoUid,
})
put(`certificateVerifications/${certificateId}`, certificateShared)
put(`trainingCertificateCounters/${TNS}_${certificateYear}`, { companyCode: TNS, year: certificateYear, next: 2, updatedAt: now() })

// ---- Write -------------------------------------------------------------------------------------------------------

for (const account of accounts) await seedPerson(account)
for (const entry of learners.filter((item) => item.uid)) {
    await seedPerson({ uid: entry.uid, email: entry.email, name: entry.name, role: 'learner', companyCode: TNS, companyName: TNS_NAME })
}

const batch = db.batch()
for (const [path, data] of writes) batch.set(db.doc(path), data)
await batch.commit()

// ESG reports, revenue and the funder for the training company.
const esg = await seedEsgAndRevenue({
    db, seedPerson, signature: sharedSignature, day, companyCode: TNS, companyName: TNS_NAME, keletsoUid,
    classIds: { now: 'tns-class-now', done: 'tns-class-done' },
})

// Client companies (with a director and a coordinator who sign in), the library, class hours and a hybrid class.
const companies = await seedCompaniesAndLibrary({ db, bucket, seedPerson, samplePdf, companyCode: TNS, keletsoUid })

// Surveys: the feedback form from her training pack (answered by the finished class, open for the running one) and one for client companies.
const surveys = await seedSurveys({ db, day, companyCode: TNS, keletsoUid, classIds: { now: 'tns-class-now', done: 'tns-class-done' } })

// A second training provider: a Training workspace without the ESG reporting add-on.
const trainingOnly = await seedTrainingOnly({ db, seedPerson, signature: sharedSignature, day, at, companyDefaults })

// Ordinary incubator companies (no training module), to check the rest of the app next to it.
const incubators = await seedIncubators({ db, Timestamp, FieldValue, seedPerson, signature: sharedSignature, day })

const signIns = [
    ...accounts.map((account) => ({ email: account.email, role: account.role, note: account.note })),
    ...learners.filter((item) => item.uid).map((item) => ({ email: item.email, role: 'learner', note: `${TNS_NAME}: ${item.name}, ${item.classId === 'tns-class-done' ? 'finished class (has a certificate)' : 'running class'}` })),
    ...esg.signIns,
    ...companies.people.map((person) => (person.orgRole === 'funder'
        ? { email: person.email, role: 'funder', note: `${TNS_NAME}: Mining Skills Fund (sees only what it funded)` }
        : { email: person.email, role: 'clientorg', note: `Kgalagadi Mining (Pty) Ltd ${person.orgRole}: ${person.name}` })),
    ...trainingOnly.signIns,
    ...incubators.signIns,
]
console.log(`\nSeeded ${writes.length} training records, ${esg.records} ESG and revenue records, ${companies.records} company and library records, ${surveys.records} survey records, ${trainingOnly.records} training-only records, ${incubators.records} incubator records and ${signIns.length} sign-ins. Password for every account: ${PASSWORD}\n`)
console.table(signIns)
console.log(`App:                 ${APP_URL}   (npm run dev:emulators)`)
console.log(`Certificate check:   ${APP_URL}/verify/${certificateId}`)
console.log(`Emulator UI:         http://${HOST}:4000   (data, sign-ins, files; invite emails land in Firestore > mail)`)
process.exit(0)
