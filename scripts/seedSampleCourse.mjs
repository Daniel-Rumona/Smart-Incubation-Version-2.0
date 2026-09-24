// Seeds one published sample course (with quizzes and AI reviews) into the
// "Test Engagement" programme, and assigns it to that programme's accepted SMEs
// exactly like publishing from the course builder does.
//
//   node scripts/seedSampleCourse.mjs            # writes
//   node scripts/seedSampleCourse.mjs --dry-run  # prints what it would write
//
// Uses scripts/new-service-account.json.
// Re-running is safe: it updates the same course (matched by title + programme)
// and skips SMEs who already have it.
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(new URL('../functions/package.json', import.meta.url))
const { initializeApp, cert } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')

const PROGRAM_NAME = 'Test Engagement'
const COURSE_TITLE = 'Getting Started: Running a Healthy Small Business'
const dryRun = process.argv.includes('--dry-run')

const now = new Date().toISOString()

const lessons = [
    {
        id: 'les0001',
        title: 'Know your numbers',
        videoUrl: 'https://www.youtube.com/watch?v=WEDIj9JBTC8',
        body: [
            'Every healthy business tracks three numbers every month: revenue, costs and cash.',
            '',
            'Revenue is the money customers pay you. Costs are what you spend to earn it (stock, rent, wages, data). Cash is what is actually in your bank account right now.',
            '',
            'A business can show a profit on paper and still run out of cash, for example when customers pay you 60 days late but suppliers want payment in 7. That is why cash flow matters more than profit in the early days.',
            '',
            'Habit to build: on the last day of each month, write down all three numbers on one page.',
        ].join('\n'),
        quiz: [
            {
                id: 'quz0001', type: 'single', required: true,
                question: 'Which number tells you how much money you can actually spend today?',
                options: ['Revenue', 'Profit', 'Cash in the bank', 'Total costs'],
                correctOptions: ['Cash in the bank'],
            },
            {
                id: 'quz0002', type: 'multiple', required: false,
                question: 'Which of these are costs of running a small business?',
                options: ['Rent', 'Stock you buy to resell', 'Money customers pay you', 'Data and airtime'],
                correctOptions: ['Rent', 'Stock you buy to resell', 'Data and airtime'],
            },
        ],
        aiReviewEnabled: true,
    },
    {
        id: 'les0002',
        title: 'Pricing without guessing',
        body: [
            'A price has to cover three things: what it costs you to deliver, your running costs, and a profit.',
            '',
            'Simple method: 1) work out the cost of one unit (materials + your time), 2) add a share of monthly overheads, 3) add the profit margin you need, 4) compare with what competitors charge.',
            '',
            'Example: a loaf costs R9 to make, overheads add R2 per loaf, and you want R4 profit. Your minimum price is R15. If competitors sell for R12, your costs are too high, not your price too low.',
            '',
            'Avoid pricing by copying the cheapest competitor. They may be losing money.',
        ].join('\n'),
        quiz: [
            {
                id: 'quz0003', type: 'single', required: true,
                question: 'A product costs R20 to make, overheads add R5 and you want R10 profit. What is the minimum price?',
                options: ['R25', 'R30', 'R35', 'R20'],
                correctOptions: ['R35'],
            },
            {
                id: 'quz0004', type: 'text', required: false,
                question: 'In your own words, why is copying the cheapest competitor risky?',
            },
        ],
        aiReviewEnabled: true,
    },
    {
        id: 'les0003',
        title: 'Keeping simple records',
        body: [
            'You do not need accounting software to start. A notebook or spreadsheet with three columns works: date, what happened, amount.',
            '',
            'Record every sale and every expense the same day, and keep receipts in one folder. Separate business money from personal money by using a dedicated bank account.',
            '',
            'Good records make it far easier to apply for funding, prove your turnover, and pass compliance checks.',
        ].join('\n'),
        aiReviewEnabled: true,
    },
]

const course = {
    title: COURSE_TITLE,
    description: 'A short sample course covering cash flow, pricing and record keeping, with quizzes and an AI review after each lesson.',
    category: 'Business Skills',
    status: 'published',
    lessons,
    createdAt: now,
    updatedAt: now,
    createdBy: 'seed-script',
}

const serviceAccount = JSON.parse(readFileSync(new URL('./new-service-account.json', import.meta.url), 'utf8'))
initializeApp({ credential: cert(serviceAccount), projectId: 'smart-incubation-71f96' })
const db = getFirestore()

const programs = await db.collection('programs').where('name', '==', PROGRAM_NAME).get()
if (programs.empty) {
    console.error(`No programme named "${PROGRAM_NAME}" found.`)
    process.exit(1)
}
if (programs.size > 1) {
    console.error(`Found ${programs.size} programmes named "${PROGRAM_NAME}": ${programs.docs.map((d) => d.id).join(', ')}. Refusing to guess.`)
    process.exit(1)
}

const program = programs.docs[0]
const payload = { ...course, programId: program.id, department: program.data().departmentId ?? undefined }
Object.keys(payload).forEach((key) => payload[key] === undefined && delete payload[key])

const applications = await db.collection('applications').where('programId', '==', program.id).get()
const participantIds = [...new Set(applications.docs
    .map((d) => d.data())
    .filter((d) => String(d.applicationStatus || '').trim().toLowerCase() === 'accepted')
    .map((d) => String(d.participantId || d.uid || d.userId || '').trim())
    .filter(Boolean))]

console.log(`Programme: ${PROGRAM_NAME} (${program.id})`)
console.log(`Course: "${COURSE_TITLE}" - ${lessons.length} lessons, ${lessons.filter((l) => l.quiz).length} quizzes, ${lessons.filter((l) => l.aiReviewEnabled).length} AI reviews`)
console.log(`Accepted SMEs to assign: ${participantIds.length}`)
if (dryRun) process.exit(0)

const existing = await db.collection('courseTemplates').where('programId', '==', program.id).where('title', '==', COURSE_TITLE).get()
let courseId
if (existing.empty) {
    courseId = (await db.collection('courseTemplates').add(payload)).id
} else {
    courseId = existing.docs[0].id
    await db.collection('courseTemplates').doc(courseId).set({ ...payload, createdAt: existing.docs[0].data().createdAt ?? now })
}

const assigned = await db.collection('courseAssignments').where('courseId', '==', courseId).get()
const already = new Set(assigned.docs.map((d) => String(d.data().participantId || '')))
const batch = db.batch()
participantIds.filter((id) => !already.has(id)).forEach((participantId) => {
    batch.set(db.collection('courseAssignments').doc(), {
        courseId, courseTitle: COURSE_TITLE, category: course.category, participantId,
        programId: program.id, status: 'assigned', createdAt: now, updatedAt: now,
    })
})
await batch.commit()

console.log(`Done. courseTemplates/${courseId}; newly assigned to ${participantIds.filter((id) => !already.has(id)).length} SME(s).`)
