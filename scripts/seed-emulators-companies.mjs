// Client companies, the library, class hours and a hybrid class for the awareness training company in the local
// emulators (used by seed-emulators.mjs, and safe to run on its own against running emulators that already hold
// the training data). Kgalagadi Mining and Marula Logistics are registered clients; Anatolia Retail is left
// unregistered, as a company Keletso has trained but not added yet. Kgalagadi's director and coordinator can sign in.
// Fixed ids, so re-running restores the same records; classes and learners are only updated, never replaced.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import PizZip from 'pizzip'

export const COMPANY_IDS = { kgalagadi: 'tns-org-kgalagadi', marula: 'tns-org-marula' }

// Her own training pack (the zip she sent, kept untracked in the repo root): seeded as the documents she would
// upload. Without it, one stand-in PDF.
const TRAINING_PACK = join(dirname(fileURLToPath(import.meta.url)), '..', 'ESG_AWARENESS_TRAINING_MATERIAL.zip')
const COURSE = 'ESG Awareness Training'
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PACK_DOCUMENTS = [
    { id: 'tns-lib-notes', entry: '01_Learner_Manual.docx', title: 'Learner Manual', category: 'course_material', audience: 'shared' },
    { id: 'tns-lib-facilitator', entry: '02_Facilitator_Guide.docx', title: 'Facilitator Guide', category: 'reference', audience: 'staff' },
    { id: 'tns-lib-memo', entry: '03_Assessments_and_Memorandum.docx', title: 'Assessments and Memorandum', category: 'reference', audience: 'staff' },
    { id: 'tns-lib-toolkit', entry: '04_ESG_Implementation_Toolkit.xlsx', title: 'ESG Implementation Toolkit', category: 'template', audience: 'shared' },
]
const GRI_LINK = { id: 'tns-lib-gri', title: 'GRI Standards (official site)', category: 'reference', courseTitle: '', audience: 'shared', url: 'https://www.globalreporting.org/standards/' }

/** A Word document's text, paragraph by paragraph and tidied as the app's upload does (150 000 characters at most), for Q. */
export const docxText = (bytes) => {
    const xml = new PizZip(bytes).file('word/document.xml')?.asText() || ''
    return xml
        .replace(/<w:tab\/>/g, '\t').replace(/<w:br\/>/g, '\n').replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&amp;/g, '&')
        .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 150_000)
}

/** The library's documents: from her training pack when it is there, else a stand-in PDF. */
export const trainingPackLibrary = (samplePdf) => {
    if (!existsSync(TRAINING_PACK)) {
        const text = 'ESG Awareness Training: sample document (test data only).'
        return [{ id: 'tns-lib-notes', title: 'ESG Awareness Training (sample document)', category: 'course_material', courseTitle: COURSE, audience: 'shared', fileName: 'ESG-Awareness-sample.pdf', contentType: 'application/pdf', bytes: samplePdf(text), text }]
    }
    const zip = new PizZip(readFileSync(TRAINING_PACK))
    // Entries may sit in a folder inside the zip.
    const entryFor = (name) => Object.values(zip.files).find((file) => !file.dir && file.name.split('/').pop() === name)
    return PACK_DOCUMENTS.flatMap(({ entry, ...values }) => {
        const file = entryFor(entry)
        if (!file) return []
        const bytes = Buffer.from(file.asUint8Array())
        const isWord = entry.endsWith('.docx')
        return [{ ...values, courseTitle: COURSE, fileName: entry, contentType: isWord ? DOCX : XLSX, bytes, text: isWord ? docxText(bytes) : '' }]
    })
}

/**
 * `db`, `bucket`, `samplePdf` and the `auth`-backed `seedPerson` come from the main seed. Returns the sign-ins it created and how
 * many records it wrote.
 */
export const seedCompaniesAndLibrary = async ({ db, bucket, seedPerson, samplePdf, companyCode, keletsoUid }) => {
    const now = new Date().toISOString()
    let records = 0
    const batch = db.batch()
    const put = (path, data, merge = false) => {
        batch.set(db.doc(path), data, merge ? { merge: true } : {})
        records += 1
    }

    // Class hours: a shorter last day on the class running now, and the online class becomes hybrid.
    const hours = { start: '09:00', end: '16:00' }
    const classes = await db.collection('trainingClasses').where('companyCode', '==', companyCode).get()
    for (const row of classes.docs) {
        const update = row.id === 'tns-class-refresher'
            ? { hours: { start: '10:00', end: '12:00' } }
            : row.id === 'tns-class-now'
                ? { hours, dayHours: { 3: { start: '09:00', end: '13:00' } } }
                : row.id === 'tns-class-online'
                    ? { hours, deliveryMode: 'hybrid', venue: 'Kgalagadi Mining boardroom, Kathu (test venue)' }
                    : row.data().hours ? {} : { hours }
        if (Object.keys(update).length) put(`trainingClasses/${row.id}`, { ...update, updatedAt: now }, true)
    }

    // Client companies, and their learners linked by name.
    const companies = [
        { id: COMPANY_IDS.kgalagadi, name: 'Kgalagadi Mining (Pty) Ltd', contactName: 'Mmabatho Seretse', contactEmail: 'director@kgalagadi-mining.test', phone: '+27 53 000 0000' },
        { id: COMPANY_IDS.marula, name: 'Marula Logistics', contactName: 'Johan van Wyk', contactEmail: 'johan@marula-logistics.test', phone: '' },
    ]
    for (const company of companies) {
        const { id, ...values } = company
        put(`trainingOrganisations/${id}`, { ...values, phone: values.phone || null, companyCode, createdAt: now, createdBy: keletsoUid, updatedAt: now, updatedBy: keletsoUid })
    }
    const learners = await db.collection('trainingLearners').where('companyCode', '==', companyCode).get()
    for (const row of learners.docs) {
        const company = companies.find((entry) => entry.name.toLowerCase() === String(row.data().organisation || '').trim().toLowerCase())
        if (company) put(`trainingLearners/${row.id}`, { organisationId: company.id, organisation: company.name }, true)
    }

    // A booking the company made itself: in the hybrid class, not invited yet.
    put('trainingLearners/tns-booked-boitumelo', {
        companyCode,
        classId: 'tns-class-online',
        name: 'Boitumelo Kgosi',
        email: 'boitumelo@kgalagadi-mining.test',
        idNumber: 'TEST-ID-0901',
        organisation: companies[0].name,
        organisationId: COMPANY_IDS.kgalagadi,
        phone: null,
        attendance: {},
        bookedBy: 'tns-org-director',
        createdAt: now,
        updatedAt: now,
    })

    // The library: her own documents, as she would upload them (no typed notes), and a link.
    for (const item of [...trainingPackLibrary(samplePdf), GRI_LINK]) {
        const { id, bytes, text, fileName, contentType, url, ...values } = item
        const base = { ...values, description: '', companyCode, createdAt: now, createdBy: keletsoUid, updatedAt: now, updatedBy: keletsoUid }
        if (url) {
            put(`trainingLibrary/${id}`, { ...base, kind: 'link', url, textChars: 0 })
            continue
        }
        const storagePath = `training-library/${companyCode}/${id}/${fileName}`
        await bucket.file(storagePath).save(bytes, { contentType })
        put(`trainingLibrary/${id}`, { ...base, kind: 'file', fileName, storagePath, contentType, size: bytes.length, textChars: text.length })
        if (text) put(`trainingLibraryTexts/${id}`, { companyCode, audience: values.audience, title: values.title, text, updatedAt: now })
    }

    // What Keletso asks of companies and learners (the default short list).
    put(`trainingSettings/${companyCode}`, {
        companyCode,
        companyFields: ['registrationNumber', 'sector', 'beeLevel', 'businessAddress', 'province', 'employees', 'baselineRevenue'],
        companyDocuments: ['cipc-registration', 'b-bbee-certificate', 'tax-compliance'],
        learnerFields: ['gender', 'dateOfBirth', 'disabilityStatus', 'jobTitle'],
        updatedAt: now,
        updatedBy: keletsoUid,
    })

    // Kgalagadi has sent its details and two of the three documents; Marula has not started.
    const documents = {}
    for (const [key, fileName] of [['cipc-registration', 'CIPC-registration.pdf'], ['b-bbee-certificate', 'B-BBEE-certificate.pdf']]) {
        const storagePath = `training-org-documents/${companyCode}/${COMPANY_IDS.kgalagadi}/${key}_${fileName}`
        await bucket.file(storagePath).save(samplePdf(`Test document: ${fileName}`), { contentType: 'application/pdf' })
        documents[key] = { fileName, storagePath, contentType: 'application/pdf', uploadedAt: now, uploadedBy: 'tns-org-director' }
    }
    put(`trainingOrganisations/${COMPANY_IDS.kgalagadi}`, {
        details: { registrationNumber: '2009/123456/07', sector: 'Mining (manganese)', beeLevel: 'Level 2', businessAddress: '12 Mine Road, Kathu', province: 'Northern Cape', employees: 420, baselineRevenue: 185000000 },
        documents,
        detailsSubmittedAt: now,
    }, true)

    // Genders, dates of birth and job titles as the learners (or their companies) gave them; a few left out, as in
    // real life, so the funder report also shows "not given".
    const learnerDetails = {
        'tns-now-lerato': { gender: 'female', dateOfBirth: '1997-05-12', jobTitle: 'Environmental officer' }, 'tns-now-thabo': { gender: 'male', dateOfBirth: '1986-09-03', jobTitle: 'Safety officer' },
        'tns-now-ayse': { gender: 'female', dateOfBirth: '1994-02-20' }, 'tns-now-sipho': { gender: 'male', dateOfBirth: '2001-11-30' }, 'tns-now-naledi': { gender: 'female', dateOfBirth: '1999-07-08' },
        'tns-online-kabelo': { gender: 'male', dateOfBirth: '1990-04-17' }, 'tns-online-elif': { gender: 'female' }, 'tns-refresh-ruth': { gender: 'female', dateOfBirth: '1979-12-01' },
        'tns-done-pule': { gender: 'male', dateOfBirth: '1983-06-25', disabilityStatus: 'no', jobTitle: 'Plant supervisor' }, 'tns-done-zanele': { gender: 'female', dateOfBirth: '1996-03-14', disabilityStatus: 'yes' }, 'tns-done-emre': { gender: 'male' },
        'tns-booked-boitumelo': { gender: 'female', dateOfBirth: '2002-08-19', jobTitle: 'HR assistant' },
    }
    for (const [id, details] of Object.entries(learnerDetails)) {
        if (id === 'tns-booked-boitumelo' || learners.docs.some((row) => row.id === id)) put(`trainingLearners/${id}`, { details }, true)
    }

    // Two funders, each seeing only what it funded: Green Enterprise Fund (the classes in Keletso's training room) and
    // the Mining Skills Fund (the hybrid class at Kgalagadi, Kgalagadi's ESG report and one learner in another class).
    const FUNDERS = {
        green: { id: 'tns-funder-green', name: 'Green Enterprise Fund', contactName: 'Thandeka Mthethwa', contactEmail: 'funder@greenfund.test' },
        mining: { id: 'tns-funder-mining', name: 'Mining Skills Fund', contactName: 'Sibusiso Zulu', contactEmail: 'funder@miningskills.test' },
    }
    for (const funder of Object.values(FUNDERS)) {
        const { id, ...values } = funder
        put(`trainingFunders/${id}`, { ...values, companyCode, createdAt: now, createdBy: keletsoUid, updatedAt: now, updatedBy: keletsoUid })
    }
    for (const row of classes.docs) {
        put(`trainingClasses/${row.id}`, { funderId: row.id === 'tns-class-online' ? FUNDERS.mining.id : FUNDERS.green.id }, true)
    }
    if (learners.docs.some((row) => row.id === 'tns-now-ayse')) put('trainingLearners/tns-now-ayse', { funderId: FUNDERS.mining.id }, true)
    put('esgReports/tns-esg-kgalagadi-fy2026', { funderId: FUNDERS.mining.id }, true)
    put('esgReports/tns-esg-anatolia-2025', { funderId: FUNDERS.green.id }, true)
    // Income not linked to a class or report says whose it is.
    for (const [id, funderId] of [['tns-income-01', FUNDERS.green.id], ['tns-income-02', FUNDERS.green.id], ['tns-income-04', FUNDERS.mining.id]]) {
        put(`clientRevenue/${id}`, { funderId }, true)
    }

    // Kgalagadi's monthly figures since the training (its baseline is R185m a year, 420 employees), and its ESG report
    // and its people's certificates linked to it so the company sees them.
    for (const [period, revenue, employees] of [['2026-07', 15300000, 420], ['2026-08', 15900000, 424], ['2026-09', 16400000, 428], ['2026-10', 16800000, 431]]) {
        put(`trainingOrgMetrics/${COMPANY_IDS.kgalagadi}_${period}`, { companyCode, organisationId: COMPANY_IDS.kgalagadi, period, revenue, employees, recordedAt: now, recordedBy: 'tns-org-director' })
    }
    put('esgReports/tns-esg-kgalagadi-fy2026', { organisationId: COMPANY_IDS.kgalagadi }, true)
    const certificates = await db.collection('trainingCertificates').where('companyCode', '==', companyCode).get()
    for (const row of certificates.docs) {
        const learner = learners.docs.find((entry) => entry.id === row.data().learnerId)
        const company = learner && companies.find((entry) => entry.name.toLowerCase() === String(learner.data().organisation || '').trim().toLowerCase())
        if (company) put(`trainingCertificates/${row.id}`, { organisationId: company.id }, true)
    }

    // A pre-assessment of its own for the hybrid class (the post-assessment stays the course assessment).
    const preQuestions = [
        { id: 'pre-q1', text: 'In your own words, what does ESG stand for?', marks: 2 },
        { id: 'pre-q2', text: 'Name one environmental issue your company deals with.', marks: 2 },
        { id: 'pre-q3', text: 'Who in your company is responsible for health and safety?', marks: 2 },
    ]
    put('trainingAssessments/tns-pre-awareness', {
        companyCode, title: 'ESG Awareness Pre-assessment (sample)', use: 'pre', instructions: 'A short check of what you already know. It does not count.',
        durationMinutes: 10, questions: preQuestions, rubric: [], createdAt: now, updatedAt: now, updatedBy: keletsoUid,
    })
    put('trainingAssessmentMemos/tns-pre-awareness', { companyCode, answers: { 'pre-q1': 'Environmental, Social and Governance.', 'pre-q2': 'Any relevant issue, e.g. dust, water use, waste.', 'pre-q3': 'The named safety officer or manager.' } })
    put('trainingClasses/tns-class-online', { preAssessmentId: 'tns-pre-awareness' }, true)

    await batch.commit()

    // The second funder's sign-in; the first (seeded with the ESG data) is linked to its funder record.
    await db.doc('users/tns-funder').set({ funderId: FUNDERS.green.id, jobTitle: FUNDERS.green.name }, { merge: true })
    await seedPerson({
        uid: 'tns-funder2',
        email: FUNDERS.mining.contactEmail,
        name: FUNDERS.mining.contactName,
        role: 'funder',
        companyCode,
        extra: { funderId: FUNDERS.mining.id, jobTitle: FUNDERS.mining.name },
    })

    // Kgalagadi's director (given by Keletso) and the coordinator the director added.
    const people = [
        { uid: 'tns-org-director', email: 'director@kgalagadi-mining.test', name: 'Mmabatho Seretse', orgRole: 'director', jobTitle: 'Managing Director' },
        { uid: 'tns-org-coordinator', email: 'hr@kgalagadi-mining.test', name: 'Kagiso Phiri', orgRole: 'coordinator', jobTitle: 'HR Manager' },
    ]
    for (const person of people) {
        await seedPerson({
            uid: person.uid,
            email: person.email,
            name: person.name,
            role: 'clientorg',
            companyCode,
            extra: { organisationId: COMPANY_IDS.kgalagadi, organisationName: companies[0].name, orgRole: person.orgRole, jobTitle: person.jobTitle },
        })
    }
    return { people: [...people, { uid: 'tns-funder2', email: 'funder@miningskills.test', name: 'Sibusiso Zulu', orgRole: 'funder' }], records }
}
