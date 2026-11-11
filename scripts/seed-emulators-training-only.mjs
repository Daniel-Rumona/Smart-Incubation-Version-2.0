// A Training workspace without the ESG reporting add-on, for the local emulators (used by seed-emulators.mjs): the
// setup for a training provider that runs classes but does not do ESG reports. Fictional names; fixed ids, so
// re-running restores the same records.

const CODE = 'SSA'
const NAME = 'Siyafunda Skills Academy'
const COURSE = 'Fire Safety Awareness Training'

export const seedTrainingOnly = async ({ db, seedPerson, signature, day, at, companyDefaults }) => {
    const now = new Date().toISOString()
    const trainerUid = 'ssa-trainer'
    const learnerUid = 'ssa-learner-amahle'
    let records = 0
    const batch = db.batch()
    const put = (path, data) => {
        records += 1
        batch.set(db.doc(path), data)
    }

    // Training is the home, ESG reporting stays off: Admin > Workspace types shows it as a Training workspace.
    await db.doc(`companies/${CODE}`).set({
        ...companyDefaults,
        companyCode: CODE,
        name: NAME,
        companyName: NAME,
        interventionDeliveryRoles: ['projectadmin'],
        awarenessTrainingEnabled: true,
        esgReportingEnabled: false,
        clientHomeModule: 'awarenessTraining',
    })

    const questions = [
        { id: 'q1', marks: 4, text: 'Name the three things a fire needs to burn.' },
        { id: 'q2', marks: 4, text: 'Which extinguisher would you use on an electrical fire, and why?' },
        { id: 'q3', marks: 4, text: 'What are the first three things you do when the fire alarm goes off?' },
    ]
    put('trainingAssessments/ssa-fire-test', {
        companyCode: CODE,
        title: 'Fire Safety Awareness Assessment (sample)',
        instructions: 'Answer every question in your own words.',
        durationMinutes: 20,
        questions,
        rubric: [],
        createdAt: now, updatedAt: now, updatedBy: trainerUid,
    })
    put('trainingAssessmentMemos/ssa-fire-test', {
        companyCode: CODE,
        answers: {
            q1: 'Heat, fuel and oxygen (the fire triangle).',
            q2: 'A CO2 (or dry powder) extinguisher: it does not conduct electricity. Never water.',
            q3: 'Raise the alarm, leave by the nearest safe exit, go to the assembly point and report to the marshal.',
        },
    })

    const classBase = {
        companyCode: CODE,
        courseTitle: COURSE,
        dayCount: 1,
        assessmentId: 'ssa-fire-test',
        passMarkPct: 60,
        reassessmentsAllowed: 1,
        groupAssignmentRequired: false,
        deliveryMode: 'in_person',
        venue: 'Siyafunda training room (test venue)',
        createdAt: now, createdBy: trainerUid, updatedAt: now, updatedBy: trainerUid,
    }
    put('trainingClasses/ssa-class-now', { ...classBase, startDate: day(0), testsOpen: { pre: false, post: true }, learnerUids: [learnerUid] })
    put('trainingClasses/ssa-class-next', { ...classBase, startDate: day(10), testsOpen: { pre: false, post: false }, learnerUids: [] })

    const learners = [
        { id: 'ssa-now-amahle', classId: 'ssa-class-now', name: 'Amahle Ndaba', organisation: 'Umgeni Warehousing', email: 'amahle@umgeni-warehousing.test', uid: learnerUid },
        { id: 'ssa-now-johan', classId: 'ssa-class-now', name: 'Johan Pretorius', organisation: 'Umgeni Warehousing', email: '' },
        { id: 'ssa-now-busi', classId: 'ssa-class-now', name: 'Busisiwe Zungu', organisation: 'Coastal Cold Storage', email: '' },
        { id: 'ssa-next-lwazi', classId: 'ssa-class-next', name: 'Lwazi Gumede', organisation: 'Coastal Cold Storage', email: '' },
    ]
    learners.forEach((learner, index) => put(`trainingLearners/${learner.id}`, {
        companyCode: CODE,
        classId: learner.classId,
        name: learner.name,
        email: learner.email,
        idNumber: `TEST-SSA-${String(index + 1).padStart(4, '0')}`,
        organisation: learner.organisation,
        phone: '',
        ...(learner.uid ? { uid: learner.uid, invitedAt: at(-1, 10) } : {}),
        attendance: learner.classId === 'ssa-class-now' && learner.uid ? { 1: { present: true, recordedAt: at(0, 8), recordedBy: 'learner' } } : {},
        createdAt: now,
        updatedAt: now,
    }))

    const income = [
        [-40, 'Umgeni Warehousing', null, 'Fire Safety Awareness, September class (8 learners)', 16000, 'paid'],
        [-12, 'Coastal Cold Storage', null, 'Fire Safety Awareness, October class (5 learners)', 10000, 'paid'],
        [-1, 'Umgeni Warehousing', 'ssa-class-now', 'Fire Safety Awareness, November class (2 learners)', 4000, 'invoiced'],
    ]
    income.forEach(([offset, organisation, classId, description, amount, status], index) => put(`clientRevenue/ssa-income-${index + 1}`, {
        companyCode: CODE, date: day(offset), organisation, service: 'training', classId, reportId: null, description, amount, status,
        paidOn: status === 'paid' ? day(offset + 14) : null,
        createdAt: now, createdBy: trainerUid, updatedAt: now, updatedBy: trainerUid,
    }))
    await batch.commit()

    await seedPerson({ uid: trainerUid, email: 'trainer@siyafunda.test', name: 'Nandi Shabalala', role: 'projectadmin', companyCode: CODE, companyName: NAME, signature })
    await seedPerson({ uid: learnerUid, email: 'amahle@umgeni-warehousing.test', name: 'Amahle Ndaba', role: 'learner', companyCode: CODE, companyName: NAME })

    return {
        records,
        signIns: [
            { email: 'trainer@siyafunda.test', role: 'projectadmin', note: `${NAME}: Training workspace without ESG reporting` },
            { email: 'amahle@umgeni-warehousing.test', role: 'learner', note: `${NAME}: Amahle Ndaba, running class (post-assessment open)` },
        ],
    }
}
