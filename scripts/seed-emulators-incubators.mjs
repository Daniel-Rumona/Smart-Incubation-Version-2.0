// Ordinary incubator companies for the local emulators (used by seed-emulators.mjs): every staff role, programmes,
// an interventions catalogue, SMEs with accepted applications, confirmed growth plans, assigned interventions,
// compliance documents and appointments, plus pending applications. None of it uses the awareness training module,
// so the regular app can be checked next to it. Record shapes follow scripts/seed-rcm-smes.cjs and the pages that
// read them; ids are fixed, so re-running restores the same records.

const AREAS = {
    'Financial Management': ['Cash Flow & Budgeting Workshop', 'Bookkeeping Systems Setup'],
    'Marketing & Sales': ['Marketing Strategy Development', 'Sales Pipeline Coaching'],
    'Digital Transformation': ['Digital Tools Onboarding', 'Website & E-commerce Setup'],
    'Operations & Compliance': ['Compliance Readiness Review', 'Standard Operating Procedures Workshop'],
    'Governance & Leadership': ['Business Plan Refresh', 'Governance & Leadership Coaching'],
    'Access to Markets': ['Tender Readiness Coaching', 'Market Access Facilitation'],
}
const COMPLIANCE = [
    { key: 'id-document', type: 'ID document' },
    { key: 'cipc-registration', type: 'CIPC registration' },
    { key: 'tax-compliance', type: 'Tax compliance (PIN or clearance)' },
]
// Assignment states, as seed-rcm-smes.cjs writes them.
const STATES = {
    completed: { status: 'completed', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'done', participantCompletionStatus: 'confirmed', progress: 100 },
    inProgress: { status: 'in_progress', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 55 },
    overdue: { status: 'pending', assigneeStatus: 'accepted', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 10 },
    pending: { status: 'pending', assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 0 },
}
const BUCKETS = [['completed', 'inProgress', 'overdue'], ['completed', 'completed', 'pending'], ['inProgress', 'pending', 'overdue']]
const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

const COMPANIES = [
    {
        code: 'DEMO',
        name: 'Demo Incubator',
        domain: 'demo-incubator.test',
        tier: 'premium', // Agentic home on, like most live companies
        staff: [
            { key: 'director', role: 'director', name: 'Dineo Director' },
            { key: 'projectadmin', uid: 'demo-projectadmin', role: 'projectadmin', name: 'Demo Project Admin' },
            { key: 'operations', role: 'operations', name: 'Olwethu Operations' },
            { key: 'consultant', role: 'consultant', name: 'Nomsa Consultant' },
            { key: 'consultant2', role: 'consultant', name: 'Kagiso Consultant' },
            { key: 'reception', role: 'admin', name: 'Rethabile Reception' },
            { key: 'funder', role: 'funder', name: 'Fikile Funder', programmes: ['accelerator'] },
        ],
        programmes: [
            { key: 'accelerator', name: 'Demo Growth Accelerator 2026', areas: ['Financial Management', 'Marketing & Sales', 'Governance & Leadership'] },
            { key: 'digital', name: 'Digital Readiness Programme 2026', areas: ['Digital Transformation', 'Operations & Compliance'] },
        ],
        smes: [
            { programme: 'accelerator', business: 'Ubuntu Harvest', owner: 'Thandiwe Dlamini', sector: 'Agro-processing', login: 'sme' },
            { programme: 'accelerator', business: 'Ilanga Solar Farms', owner: 'Bongani Nkosi', sector: 'Renewable Energy' },
            { programme: 'accelerator', business: 'Bophelo Organics', owner: 'Refilwe Mokoena', sector: 'Health & Wellness' },
            { programme: 'accelerator', business: 'Sakhile Grain Mill', owner: 'Themba Khumalo', sector: 'Manufacturing' },
            { programme: 'digital', business: 'Karoo Wool Traders', owner: 'Palesa Radebe', sector: 'Retail & Trade' },
            { programme: 'digital', business: 'Lwazi Seedlings', owner: 'Ayanda Sithole', sector: 'Agro-processing' },
        ],
        pendingApplications: [
            { programme: 'accelerator', business: 'Umoya Tea Estate', owner: 'Mbali Zulu', sector: 'Agro-processing' },
            { programme: 'digital', business: 'Kwena Feeds', owner: 'Kabelo Molefe', sector: 'Manufacturing' },
        ],
    },
    {
        code: 'UGH',
        name: 'Ubuntu Growth Hub',
        domain: 'ubuntu-growth.test',
        tier: 'standard', // no Agentic home
        staff: [
            { key: 'director', role: 'director', name: 'Lindiwe Director' },
            { key: 'operations', role: 'operations', name: 'Sipho Operations' },
            { key: 'consultant', role: 'consultant', name: 'Busisiwe Consultant' },
        ],
        programmes: [
            { key: 'agri', name: 'Agri Enterprise Programme 2026', areas: ['Financial Management', 'Access to Markets'] },
        ],
        smes: [
            { programme: 'agri', business: 'Masakhane Poultry', owner: 'Nokuthula Baloyi', sector: 'Agro-processing', login: 'sme' },
            { programme: 'agri', business: 'Imvelo Compost', owner: 'Sizwe Ndlovu', sector: 'Agro-processing' },
            { programme: 'agri', business: 'Vula Vineyards', owner: 'Zodwa Mbeki', sector: 'Agro-processing' },
        ],
        pendingApplications: [
            { programme: 'agri', business: 'Dumisani Beekeeping', owner: 'Dumisani Zungu', sector: 'Agro-processing' },
        ],
    },
]

/**
 * Writes the companies and their records. `seedPerson` (from seed-emulators.mjs) creates a sign-in, profile and
 * signed agreements; `signature` is a stored signature to give every seeded person.
 * Returns the sign-ins created, for the summary table.
 */
export const seedIncubators = async ({ db, Timestamp, FieldValue, seedPerson, signature, day }) => {
    const ts = (date) => Timestamp.fromDate(date)
    const daysFromNow = (offset, hour = 9) => {
        const date = new Date()
        date.setHours(hour, 0, 0, 0)
        date.setDate(date.getDate() + offset)
        return date
    }
    const signIns = []
    let records = 0

    for (const company of COMPANIES) {
        const { code } = company
        const people = Object.fromEntries(company.staff.map((person) => [person.key, {
            ...person,
            uid: person.uid || `${code.toLowerCase()}-${person.key}`,
            email: `${person.key}@${company.domain}`,
        }]))
        const programmes = Object.fromEntries(company.programmes.map((programme) => [programme.key, { ...programme, id: `${code.toLowerCase()}-prog-${programme.key}` }]))
        const consultants = Object.values(people).filter((person) => person.role === 'consultant')
        const director = people.director

        await db.doc(`companies/${code}`).set({
            companyCode: code,
            name: company.name,
            companyName: company.name,
            status: 'active',
            locked: true,
            ownerUid: director.uid,
            ownerEmail: director.email,
            consultantLabel: 'Consultants',
            hasDepartments: false,
            hasBranches: false,
            smeOnboardingModel: 'self_application',
            smeDivisionModel: 'ops_assign_smes_to_consultants',
            assignmentModel: 'ops_assign_consultant',
            interventionScopeModel: 'program_specific',
            interventionDeliveryRoles: ['consultant', 'projectadmin', 'operations'],
            subscription: { tier: company.tier, addOns: [] },
            seededBy: 'emulators',
        })

        for (const person of Object.values(people)) {
            await seedPerson({
                uid: person.uid,
                email: person.email,
                name: person.name,
                role: person.role,
                companyCode: code,
                companyName: company.name,
                signature,
                extra: {
                    ...(person.role === 'director' ? { systemSettingsConfigured: true, systemSettingsCompanyCode: code } : {}),
                    ...(person.programmes ? { assignedProgramIds: person.programmes.map((key) => programmes[key].id) } : {}),
                },
            })
            signIns.push({ email: person.email, role: person.role, note: company.name })
        }

        const batch = db.batch()
        const put = (path, data) => {
            batch.set(db.doc(path), data)
            records += 1
        }

        for (const programme of Object.values(programmes)) {
            put(`programs/${programme.id}`, {
                name: programme.name,
                title: programme.name,
                description: `${programme.name} for small businesses in ${company.name}'s network.`,
                type: 'Incubation',
                status: 'Active',
                cohortYear: '2026',
                startDate: ts(new Date('2026-02-02T08:00:00Z')),
                endDate: ts(new Date('2026-12-11T15:00:00Z')),
                budget: 1500000,
                maxCapacity: 20,
                assignedAdmin: people.projectadmin?.email || director.email,
                openToExternalSmes: false,
                intakeMode: 'application',
                companyCode: code,
                eligibilityCriteria: {},
                onboardingQuestions: [],
                interventionPolicy: { mode: 'sme_choice', sourceScope: 'company', forcedInterventionIds: [], forcedInterventions: [], allowSmeSelection: true, maxSelections: null },
                complianceRequirements: COMPLIANCE.map((item) => ({ name: item.type, required: true })),
                agentSupportMode: 'simultaneous',
                seededBy: 'emulators',
                createdAt: ts(new Date('2026-01-15T08:00:00Z')),
                updatedAt: FieldValue.serverTimestamp(),
            })
            for (const area of programme.areas) {
                for (const title of AREAS[area]) {
                    put(`interventions/${code}__${slug(title)}`, {
                        companyCode: code,
                        areaOfSupport: area,
                        interventionTitle: title,
                        isCompulsory: 'no',
                        isRecurring: 'no',
                        durationTerm: 'short_term',
                        executionMode: 'single_session',
                        scopeType: 'program',
                        programId: programme.id,
                        departmentId: null,
                        deliveryStrategy: 'human_only',
                        agentId: null,
                        reviewRequired: false,
                        reviewerType: null,
                        outcomeDefinition: { outcomeType: 'process_implemented', intendedOutcome: `${title} completed and in use`, deliverableName: title, deliverableRequired: true, followUpDays: 60 },
                        createdAt: '2026-01-20T08:00:00.000Z',
                    })
                }
            }
        }

        company.smes.forEach((sme, index) => {
            const programme = programmes[sme.programme]
            const login = sme.login ? { uid: `${code.toLowerCase()}-${sme.login}`, email: `${sme.login}@${company.domain}` } : null
            const participantId = login ? login.uid : `${code.toLowerCase()}-participant-${index + 1}`
            const applicationId = `${code.toLowerCase()}-application-${index + 1}`
            const email = login ? login.email : `${slug(sme.owner)}@${slug(sme.business)}.test`
            const consultant = consultants[index % consultants.length]
            const acceptedAt = daysFromNow(-150 + index * 9)
            const titles = programme.areas.flatMap((area) => AREAS[area].map((title) => ({ area, title })))
            const plan = [0, 1, 2].map((offset) => titles[(index + offset * 2) % titles.length])
            const buckets = BUCKETS[index % BUCKETS.length]
            const assignmentIds = plan.map((_, item) => `${code.toLowerCase()}-assignment-${index + 1}-${item + 1}`)
            const required = plan.map((item, position) => ({ id: assignmentIds[position], interventionId: slug(item.title), title: item.title, areaOfSupport: item.area }))
            const completed = required.filter((_, position) => buckets[position] === 'completed').map(({ id, interventionId, title }) => ({ id, interventionId, title }))
            const months = Array.from({ length: 8 }, (_, back) => {
                const date = new Date()
                date.setDate(1)
                date.setMonth(date.getMonth() - (7 - back))
                return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
            })
            const revenueStart = 60000 + index * 35000
            const revenueHistory = Object.fromEntries(months.map((month, position) => [month, Math.round(revenueStart * (1 + position * (index % 3 === 2 ? -0.02 : 0.04)) / 100) * 100]))
            const headcountHistory = Object.fromEntries(months.map((month, position) => [month, 3 + (index % 4) + Math.floor(position / 3)]))
            const phone = `+2782${String(1000000 + index * 7331).slice(0, 7)}`
            const base = {
                businessName: sme.business, participantName: sme.owner, email, phone, sector: sme.sector,
                programId: programme.id, programName: programme.name, companyCode: code,
            }

            put(`participants/${participantId}`, {
                ...base,
                ...(login ? { uid: login.uid } : {}),
                applicationId, applicantProfileId: login ? login.uid : null, businessProfileId: login ? login.uid : null, departmentId: null,
                gender: index % 3 === 1 ? 'Male' : 'Female', stage: 'Early growth', province: 'Gauteng', beeLevel: 'Level 1',
                status: 'active', revenue: revenueHistory[months[months.length - 1]], employeeCount: headcountHistory[months[months.length - 1]],
                revenueHistory: { monthly: revenueHistory }, headcountHistory: { monthly: headcountHistory },
                acceptedAt: ts(acceptedAt), onboardedAt: ts(acceptedAt), seededBy: 'emulators', createdAt: ts(acceptedAt), updatedAt: FieldValue.serverTimestamp(),
            })
            put(`applications/${applicationId}`, {
                ...base,
                uid: login ? login.uid : null, userId: login ? login.uid : null, applicantProfileId: login ? login.uid : null, businessProfileId: login ? login.uid : null,
                participantId, gender: index % 3 === 1 ? 'Male' : 'Female', stage: 'Early growth', province: 'Gauteng', city: 'Johannesburg', hub: 'Johannesburg Hub',
                ageGroup: '25-34', age: 31 + index, yearsOfTrading: 2 + index, beeLevel: 'Level 1', disabilityStatus: 'None', educationLevel: 'Diploma',
                employmentStatus: 'Self-employed', maritalStatus: 'Single', locationType: 'Urban', youthOwnedPercent: 50, femaleOwnedPercent: 100, blackOwnedPercent: 100,
                departmentId: null, status: 'accepted', applicationStatus: 'accepted',
                submittedAt: ts(daysFromNow(-170 + index * 9)), acceptedAt: ts(acceptedAt), reviewedAt: ts(acceptedAt), reviewedBy: null,
                interventions: { required, completed }, requiredInterventions: [], complianceDocuments: [], swot: null,
                seededBy: 'emulators', createdAt: ts(daysFromNow(-170 + index * 9)), createdBy: null, updatedAt: FieldValue.serverTimestamp(), updatedBy: null,
            })
            const confirmedAt = acceptedAt.toISOString()
            put(`diagnosticPlans/${applicationId}`, {
                companyCode: code, participantId, applicationId, programId: programme.id,
                interventions: required.map((item) => ({ interventionId: item.interventionId, title: item.title, areaOfSupport: item.areaOfSupport, executionMode: 'single_session', steps: [] })),
                confirmed: true, status: 'Confirmed', confirmedAt,
                confirmedBy: {
                    operations: { name: people.operations.name, confirmedAt },
                    participant: { uid: login?.uid || null, name: sme.owner, email, signatureURL: signature.url, confirmedAt },
                },
                confirmedMeta: {
                    operations: { name: people.operations.name, confirmedAt },
                    participant: { uid: login?.uid || null, name: sme.owner, email, signatureURL: signature.url, confirmedAt },
                },
                seededBy: 'emulators', updatedAt: FieldValue.serverTimestamp(),
            })
            required.forEach((item, position) => {
                const bucket = buckets[position]
                const createdAt = daysFromNow(-120 + index * 5 + position * 3)
                const dueDate = bucket === 'overdue' ? daysFromNow(-6 - position) : bucket === 'completed' ? daysFromNow(-40 + position * 4) : daysFromNow(10 + position * 6)
                put(`assignedInterventions/${assignmentIds[position]}`, {
                    companyCode: code, groupId: null, participantId, businessName: sme.business, sector: sme.sector,
                    interventionDefinitionId: `${code}__${item.interventionId}`, interventionId: item.interventionId, interventionTitle: item.title,
                    subtitle: item.areaOfSupport, type: 'coaching', programId: programme.id, programName: programme.name,
                    implementationDate: ts(createdAt), dueDate: ts(dueDate), isRecurring: false,
                    assigneeType: 'consultant', assigneeUid: consultant.uid, assigneeId: consultant.uid, assigneeName: consultant.name, assigneeEmail: consultant.email,
                    ...STATES[bucket], areaOfSupport: item.areaOfSupport,
                    targetType: 'number', targetValue: 10, targetMetric: 'hours', targetActual: bucket === 'completed' ? 10 : Math.round(STATES[bucket].progress / 10),
                    timeSpent: 0, notes: '', ...(bucket === 'completed' ? { completedAt: ts(daysFromNow(-45 + position * 4)) } : {}),
                    seededBy: 'emulators', createdAt: ts(createdAt), createdBy: consultant.uid, updatedAt: FieldValue.serverTimestamp(), updatedBy: consultant.uid,
                })
            })
            const appointment = (id, startTime, status, extra) => put(`appointments/${id}`, {
                companyCode: code, assignedInterventionId: assignmentIds[0], interventionId: required[0].interventionId, interventionTitle: plan[0].title,
                participantId, participantName: sme.business, participantEmail: email, programId: programme.id, programName: programme.name,
                assigneeId: consultant.uid, assigneeEmail: consultant.email, assigneeName: consultant.name, meetingLink: null, location: 'Hub boardroom',
                meetingType: 'in_person', requiresSmeAcceptance: true, acceptanceBundle: 'intervention_and_appointment',
                startTime: ts(startTime), endTime: ts(new Date(startTime.getTime() + 3600000)), status,
                createdByUid: consultant.uid, createdByEmail: consultant.email, seededBy: 'emulators', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
                ...extra,
            })
            appointment(`${code.toLowerCase()}-appointment-${index + 1}-held`, daysFromNow(-12 - index, 10), 'completed', { attendance: { [email]: 'present' }, discussionSummary: 'Reviewed progress against the plan and agreed next steps.', completedAt: FieldValue.serverTimestamp() })
            // One appointment today (reception lists today and the next 7 days), the rest in the coming weeks.
            appointment(`${code.toLowerCase()}-appointment-${index + 1}-next`, index === 0 ? daysFromNow(0, 15) : daysFromNow(2 + index * 3, 11), index === 0 ? 'accepted' : 'pending', { attendance: {}, discussionSummary: '' })
            COMPLIANCE.forEach((item, position) => {
                const state = (index + position) % 4
                put(`complianceDocuments/${applicationId}-${item.key}`, {
                    participantId, applicationId, programId: programme.id, companyCode: code, key: item.key, type: item.type,
                    currentStatus: ['valid', 'valid', 'pending', 'expired'][state], verificationStatus: ['verified', 'verified', 'unverified', 'verified'][state],
                    issueDate: day(-300), expiryDate: state === 3 ? day(-10) : day(200), fileName: `${item.key}.pdf`, url: null,
                    seededBy: 'emulators', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
                })
            })
            if (login) {
                const profile = { participantName: sme.owner, email: login.email, phone, gender: index % 3 === 1 ? 'Male' : 'Female', province: 'Gauteng', city: 'Johannesburg' }
                put(`applicantProfiles/${login.uid}`, { uid: login.uid, ...profile, idNumber: 'TEST-ID-9000', seededBy: 'emulators', updatedAt: FieldValue.serverTimestamp() })
                put(`businessProfiles/${login.uid}`, {
                    ownerUid: login.uid, applicantProfileId: login.uid, businessName: sme.business, participantName: sme.owner, email: login.email, phone,
                    sector: sme.sector, natureOfBusiness: `${sme.sector} business`, yearsOfTrading: 4, businessAddress: '12 Main Road, Johannesburg',
                    province: 'Gauteng', city: 'Johannesburg', ownership: { youthOwnedPercent: 50, femaleOwnedPercent: 100, blackOwnedPercent: 100 }, directors: [],
                    seededBy: 'emulators', updatedAt: FieldValue.serverTimestamp(),
                })
            }
        })

        company.pendingApplications.forEach((application, index) => {
            const programme = programmes[application.programme]
            put(`applications/${code.toLowerCase()}-pending-${index + 1}`, {
                businessName: application.business, participantName: application.owner, email: `${slug(application.owner)}@${slug(application.business)}.test`,
                phone: `+2783${String(2000000 + index * 4111).slice(0, 7)}`, sector: application.sector, gender: 'Female', province: 'Gauteng', city: 'Johannesburg',
                stage: 'Startup', yearsOfTrading: 1, programId: programme.id, programName: programme.name, companyCode: code, departmentId: null,
                uid: null, userId: null, participantId: null, status: 'pending', applicationStatus: 'pending',
                submittedAt: ts(daysFromNow(-2 - index)), interventions: { required: [], completed: [] }, requiredInterventions: [], complianceDocuments: [], swot: null,
                seededBy: 'emulators', createdAt: ts(daysFromNow(-2 - index)), updatedAt: FieldValue.serverTimestamp(),
            })
        })

        if (people.operations) {
            put(`operationsTasks/${code.toLowerCase()}-task-1`, {
                companyCode: code, programId: Object.values(programmes)[0].id, title: 'Prepare the quarterly funder report', description: 'Collect intervention outcomes and SME growth figures.',
                status: 'in_progress', priority: 'high', dueAt: ts(daysFromNow(5)), startAt: ts(daysFromNow(-2)), assigneeIds: [people.operations.uid], archived: false,
                createdBy: director.uid, createdAt: ts(daysFromNow(-3)),
            })
        }
        put(`kpis/${code.toLowerCase()}-kpi-completion`, {
            companyCode: code, name: 'Intervention completion rate', description: 'Share of assigned interventions completed.', kind: 'system', metric: 'completion_rate',
            interventionIds: [], rule: null, atLeast: null, unit: 'percent', direction: 'higher', cadence: 'quarter', target: 75,
            programTargets: Object.fromEntries(Object.values(programmes).map((programme) => [programme.id, 75])), manualActuals: {}, active: true,
            createdByUid: director.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        })
        await batch.commit()

        for (const sme of company.smes.filter((item) => item.login)) {
            const uid = `${code.toLowerCase()}-${sme.login}`
            const email = `${sme.login}@${company.domain}`
            await seedPerson({
                uid, email, name: sme.owner, role: 'incubatee', companyCode: code, companyName: company.name, signature,
                extra: { isApplicant: false, assignedProgramIds: [programmes[sme.programme].id] },
            })
            signIns.push({ email, role: 'incubatee', note: `${company.name}: ${sme.business}` })
        }
    }

    return { signIns, records }
}
