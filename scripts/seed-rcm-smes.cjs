#!/usr/bin/env node

/*
 * Tops up RCM's programme (see setup-company-rcm.cjs) with more dummy SMEs until it has --target
 * (default 30). Per new SME it creates: a participant (with revenue + headcount history), an
 * accepted application (demographics + required interventions), a confirmed diagnostic plan (so it
 * shows on Operations > Interventions > Assign), 3-5 assigned interventions shared round-robin
 * across RCM's consultants (completed ones get a completedAt), and two appointments (one held
 * with attendance, one upcoming).
 *
 * Every created document carries a seedTag; a manifest is written to
 * scripts/seed-output-rcm-smes-<timestamp>.json for --undo.
 *
 * Usage:
 *   node scripts/seed-rcm-smes.cjs --service-account ./scripts/new-service-account.json                # dry run
 *   node scripts/seed-rcm-smes.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-rcm-smes.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-rcm-smes-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const COMPANY_CODE = 'RCM'
const SECTORS = ['Agro-processing', 'Renewable Energy', 'Health & Wellness', 'Retail & Trade', 'Manufacturing']
const PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga', 'North West']
const STAGES = ['Ideation', 'Startup', 'Early growth', 'Growth', 'Established']
const BEE_LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4']
const GENDERS = ['Female', 'Female', 'Female', 'Male']
const AGE_GROUPS = ['18-24', '25-34', '35-44', '45-54', '55+']
const HUBS = ['Johannesburg Hub', 'Cape Town Hub', 'Durban Hub', 'Pretoria Hub']
const CITIES = ['Johannesburg', 'Cape Town', 'Durban', 'Pretoria', 'Bloemfontein', 'Port Elizabeth']
const DISABILITY_STATUSES = ['None', 'None', 'None', 'None', 'Physical', 'Visual', 'Hearing']
const EDUCATION_LEVELS = ['Matric', 'Diploma', "Bachelor's Degree", 'Honours Degree', 'Postgraduate']
const EMPLOYMENT_STATUSES = ['Self-employed', 'Employed full-time', 'Unemployed', 'Part-time']
const MARITAL_STATUSES = ['Single', 'Married', 'Divorced', 'Widowed']
const LOCATION_TYPES = ['Urban', 'Peri-urban', 'Rural']
const OWNERSHIP_PERCENTS = [0, 25, 50, 75, 100]
const AREAS_OF_SUPPORT = ['Financial Management', 'Marketing & Sales', 'Digital Transformation', 'Operations & Compliance', 'Governance & Leadership', 'Access to Markets']
const INTERVENTION_TITLES = {
  'Financial Management': ['Financial Management Coaching', 'Cash Flow & Budgeting Workshop', 'Bookkeeping Systems Setup'],
  'Marketing & Sales': ['Marketing Strategy Development', 'Brand & Digital Presence Audit', 'Sales Pipeline Coaching'],
  'Digital Transformation': ['Digital Tools Onboarding', 'Website & E-commerce Setup', 'Systems Automation Review'],
  'Operations & Compliance': ['Compliance Readiness Review', 'Operations Efficiency Assessment', 'Standard Operating Procedures Workshop'],
  'Governance & Leadership': ['Governance & Leadership Coaching', 'Business Plan Refresh', 'Succession Planning Session'],
  'Access to Markets': ['Market Access Facilitation', 'Tender Readiness Coaching', 'Export Readiness Assessment'],
}
const FIRST_NAMES = ['Thandiwe', 'Lindiwe', 'Nomvula', 'Ayanda', 'Zanele', 'Palesa', 'Nokuthula', 'Busisiwe', 'Refilwe', 'Mbali', 'Bongani', 'Sipho', 'Themba', 'Kabelo']
const LAST_NAMES = ['Dlamini', 'Nkosi', 'Mokoena', 'Khumalo', 'Mahlangu', 'Radebe', 'Sithole', 'Zulu', 'Mbeki', 'Ndlovu', 'Molefe', 'Baloyi']
const BUSINESS_NAMES = [
  'Ubuntu Harvest', 'Lekgotla Greens', 'Amadlelo Dairy', 'Sizani Orchards', 'Masakhane Poultry', 'Ilanga Solar Farms',
  'Khula Nursery', 'Tshwane Herbs', 'Bophelo Organics', 'Dumisani Beekeeping', 'Vula Vineyards', 'Nomsa Mushrooms',
  'Kwena Feeds', 'Mpumalanga Citrus Co', 'Zamokuhle Aquaponics', 'Letsatsi Agri Energy', 'Imvelo Compost', 'Sakhile Grain Mill',
  'Thabo Hydroponics', 'Karoo Wool Traders', 'Baswa Free-Range Eggs', 'Umoya Tea Estate', 'Lwazi Seedlings', 'Boitshoko Butchery',
]
const MEETING_TYPES = ['online', 'in_person', 'phone']
const SUMMARIES = ['Reviewed progress against the plan and agreed next steps.', 'Worked through the cash-flow forecast and identified quick wins.', 'Discussed market access options and prepared a follow-up action list.']

function parseArgs(argv) {
  const args = { apply: false, target: 30 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--target=')) args.target = Number(arg.slice('--target='.length))
    else if (arg === '--target') args.target = Number(argv[++index])
    else if (arg.startsWith('--undo=')) args.undo = arg.slice('--undo='.length)
    else if (arg === '--undo') args.undo = argv[++index]
    else if (arg === '--apply') args.apply = true
  }
  return args
}

function loadServiceAccount(args) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString('utf8'))
  }
  if (!args.serviceAccount) {
    throw new Error('Pass --service-account <path> or set FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_B64.')
  }
  const resolved = path.isAbsolute(args.serviceAccount) ? args.serviceAccount : path.resolve(process.cwd(), args.serviceAccount)
  return JSON.parse(fs.readFileSync(resolved, 'utf8'))
}

const pick = (list, rand) => list[Math.floor(rand() * list.length)]
function makeRand(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}
const addDays = (date, days) => new Date(date.getTime() + days * 86400000)
const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
const slug = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

function monthsSince(start) {
  const keys = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  while (cursor <= last) {
    keys.push(monthKey(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return keys
}

function buildSeries(startValue, months, trend, rand, minValue) {
  const series = []
  let value = startValue
  for (let index = 0; index < months; index += 1) {
    const drift = trend === 'up' ? 0.02 + rand() * 0.04 : -(0.015 + rand() * 0.035)
    value = Math.max(minValue, value * (1 + drift + (rand() - 0.5) * 0.05))
    series.push(value)
  }
  return series
}

function statusFieldsFor(bucket, rand) {
  if (bucket === 'completed') return { status: 'completed', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'done', participantCompletionStatus: 'confirmed', progress: 100 }
  if (bucket === 'inProgress') return { status: 'in_progress', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 30 + Math.round(rand() * 50) }
  if (bucket === 'overdue') return { status: 'pending', assigneeStatus: 'accepted', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: Math.round(rand() * 15) }
  return { status: 'pending', assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 0 }
}

function dueDateFor(bucket, rand) {
  const today = new Date()
  today.setHours(9, 0, 0, 0)
  if (bucket === 'overdue') return addDays(today, -(4 + Math.floor(rand() * 25)))
  if (bucket === 'completed') return addDays(today, -(10 + Math.floor(rand() * 60)))
  return addDays(today, Math.floor(rand() * 28))
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount(args)) })
  const db = admin.firestore()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.created.length} document(s) from ${manifest.createdAt}`)
    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to delete them.')
      return
    }
    let batch = db.batch()
    let ops = 0
    for (const entry of manifest.created) {
      batch.delete(db.collection(entry.collection).doc(entry.id))
      ops += 1
      if (ops === 400) {
        await batch.commit()
        batch = db.batch()
        ops = 0
      }
    }
    if (ops > 0) await batch.commit()
    console.log(`\nDeleted ${manifest.created.length} document(s).`)
    return
  }

  const programmes = await db.collection('programs').where('companyCode', '==', COMPANY_CODE).get()
  if (programmes.size !== 1) throw new Error(`Expected exactly one RCM programme, found ${programmes.size}. Run setup-company-rcm.cjs first.`)
  const programme = programmes.docs[0]
  const programmeData = programme.data()
  const programStart = programmeData.startDate && programmeData.startDate.toDate ? programmeData.startDate.toDate() : new Date('2026-01-15')

  const consultantsSnap = await db.collection('users').where('companyCode', '==', COMPANY_CODE).where('role', '==', 'consultant').get()
  const consultants = consultantsSnap.docs.map((row) => ({ uid: row.id, email: row.data().email, name: row.data().name || row.data().displayName || row.data().email }))
  if (!consultants.length) throw new Error('No RCM consultants found.')

  const existing = await db.collection('participants').where('programId', '==', programme.id).get()
  const usedNames = new Set(existing.docs.map((row) => String(row.data().businessName || '').toLowerCase()))
  const toCreate = Math.max(0, args.target - existing.size)
  const available = BUSINESS_NAMES.filter((name) => !usedNames.has(name.toLowerCase()))
  if (toCreate > available.length) throw new Error(`Only ${available.length} unused business names available; lower --target.`)

  const rand = makeRand(101)
  const months = monthsSince(programStart)
  const plans = available.slice(0, toCreate).map((businessName, index) => {
    const participantName = `${pick(FIRST_NAMES, rand)} ${pick(LAST_NAMES, rand)}`
    const trend = rand() < 0.72 ? 'up' : 'down'
    const revenueSeries = buildSeries(50000 + Math.round(rand() * 250000), months.length, trend, rand, 5000)
    const employeeSeries = buildSeries(2 + Math.floor(rand() * 10), months.length, trend, rand, 1)
    const revenueHistory = {}
    const headcountHistory = {}
    months.forEach((month, monthIndex) => {
      revenueHistory[month] = Math.round(revenueSeries[monthIndex] / 100) * 100
      headcountHistory[month] = Math.round(employeeSeries[monthIndex])
    })
    const bucketsPool = ['completed', 'completed', 'inProgress', 'inProgress', 'pending', 'overdue']
    const assignments = Array.from({ length: 3 + Math.floor(rand() * 3) }, () => {
      const areaOfSupport = pick(AREAS_OF_SUPPORT, rand)
      const bucket = pick(bucketsPool, rand)
      const createdAt = addDays(programStart, 7 + Math.floor(rand() * Math.max(1, (Date.now() - programStart.getTime()) / 86400000 - 14)))
      const dueDate = dueDateFor(bucket, rand)
      let finishedAt = null
      if (bucket === 'completed') {
        finishedAt = addDays(createdAt, 4 + Math.floor(rand() * 37))
        if (rand() < 0.75 && finishedAt > dueDate) finishedAt = addDays(dueDate, -Math.floor(rand() * 5))
        if (finishedAt < createdAt) finishedAt = addDays(createdAt, 3)
        if (finishedAt > new Date()) finishedAt = addDays(new Date(), -1)
      }
      return { areaOfSupport, interventionTitle: pick(INTERVENTION_TITLES[areaOfSupport], rand), bucket, dueDate, createdAt, finishedAt, statusFields: statusFieldsFor(bucket, rand) }
    })
    const submittedAt = addDays(programStart, -(20 + Math.floor(rand() * 20)))
    return {
      businessName,
      participantName,
      consultant: consultants[index % consultants.length],
      email: `${participantName.toLowerCase().replace(/\s+/g, '.')}.rcm${index}@example.com`,
      phone: `+27${String(60000000 + Math.floor(rand() * 9999999)).slice(0, 9)}`,
      sector: pick(SECTORS, rand),
      stage: pick(STAGES, rand),
      province: pick(PROVINCES, rand),
      beeLevel: pick(BEE_LEVELS, rand),
      trend,
      revenueHistory,
      headcountHistory,
      latestRevenue: revenueHistory[months[months.length - 1]],
      latestEmployees: headcountHistory[months[months.length - 1]],
      assignments,
      submittedAt,
      acceptedAt: addDays(submittedAt, 5 + Math.floor(rand() * 14)),
      gender: pick(GENDERS, rand),
      ageGroup: pick(AGE_GROUPS, rand),
      age: 24 + Math.floor(rand() * 36),
      yearsOfTrading: 1 + Math.floor(rand() * 12),
      hub: pick(HUBS, rand),
      city: pick(CITIES, rand),
      disabilityStatus: pick(DISABILITY_STATUSES, rand),
      educationLevel: pick(EDUCATION_LEVELS, rand),
      employmentStatus: pick(EMPLOYMENT_STATUSES, rand),
      maritalStatus: pick(MARITAL_STATUSES, rand),
      locationType: pick(LOCATION_TYPES, rand),
      youthOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
      femaleOwnedPercent: pick([75, 100, 100], rand),
      blackOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
      heldAt: addDays(new Date(), -(5 + Math.floor(rand() * 85))),
      upcomingAt: addDays(new Date(), 1 + Math.floor(rand() * 21)),
      heldPresent: rand() < 0.8,
      meetingTypes: [pick(MEETING_TYPES, rand), pick(MEETING_TYPES, rand)],
      summary: pick(SUMMARIES, rand),
    }
  })

  console.log(`\nRCM programme "${programmeData.name}" has ${existing.size} SMEs; target ${args.target} -> creating ${toCreate}.`)
  console.log(`Consultants: ${consultants.map((item) => item.email).join(', ')}`)
  plans.forEach((sme) => {
    const buckets = sme.assignments.map((assignment) => assignment.bucket[0]).join('')
    console.log(`  ${sme.businessName.padEnd(26)} ${sme.sector.padEnd(18)} [${sme.trend.padEnd(4)}] R${sme.latestRevenue} / ${sme.latestEmployees} staff  ${buckets}  -> ${sme.consultant.name}`)
  })

  if (!args.apply || !toCreate) {
    console.log(args.apply ? '\nNothing to do.' : '\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const seedTag = `rcm-smes-${Date.now()}`
  const now = admin.firestore.FieldValue.serverTimestamp()
  const ts = (date) => admin.firestore.Timestamp.fromDate(date)
  const created = []
  const track = (collection, ref) => created.push({ collection, id: ref.id })

  for (const sme of plans) {
    const participantRef = db.collection('participants').doc()
    const applicationRef = db.collection('applications').doc()
    const assignmentRefs = sme.assignments.map(() => db.collection('assignedInterventions').doc())
    const required = sme.assignments.map((assignment, index) => ({ id: assignmentRefs[index].id, interventionId: null, title: assignment.interventionTitle, areaOfSupport: assignment.areaOfSupport }))
    const completed = required.filter((_, index) => sme.assignments[index].bucket === 'completed').map(({ id, interventionId, title }) => ({ id, interventionId, title }))

    await participantRef.set({
      applicationId: applicationRef.id, applicantProfileId: null, businessProfileId: null,
      programId: programme.id, programName: programmeData.name, companyCode: COMPANY_CODE, departmentId: null,
      businessName: sme.businessName, participantName: sme.participantName, email: sme.email, phone: sme.phone,
      gender: sme.gender, sector: sme.sector, stage: sme.stage, province: sme.province, beeLevel: sme.beeLevel,
      status: 'active', revenue: sme.latestRevenue, employeeCount: sme.latestEmployees,
      revenueHistory: { monthly: sme.revenueHistory }, headcountHistory: { monthly: sme.headcountHistory },
      acceptedAt: ts(sme.acceptedAt), onboardedAt: ts(sme.acceptedAt), seedTag, createdAt: ts(sme.acceptedAt), updatedAt: now,
    })
    track('participants', participantRef)

    await applicationRef.set({
      uid: null, userId: null, applicantProfileId: null, businessProfileId: null, participantId: participantRef.id,
      businessName: sme.businessName, participantName: sme.participantName, email: sme.email, phone: sme.phone,
      gender: sme.gender, sector: sme.sector, stage: sme.stage, province: sme.province, hub: sme.hub, city: sme.city,
      ageGroup: sme.ageGroup, age: sme.age, yearsOfTrading: sme.yearsOfTrading, beeLevel: sme.beeLevel,
      disabilityStatus: sme.disabilityStatus, educationLevel: sme.educationLevel, employmentStatus: sme.employmentStatus,
      maritalStatus: sme.maritalStatus, locationType: sme.locationType,
      youthOwnedPercent: sme.youthOwnedPercent, femaleOwnedPercent: sme.femaleOwnedPercent, blackOwnedPercent: sme.blackOwnedPercent,
      programId: programme.id, programName: programmeData.name, companyCode: COMPANY_CODE, departmentId: null,
      status: 'accepted', applicationStatus: 'accepted',
      submittedAt: ts(sme.submittedAt), acceptedAt: ts(sme.acceptedAt), reviewedAt: ts(sme.acceptedAt), reviewedBy: null,
      interventions: { required, completed }, requiredInterventions: [], complianceDocuments: [], swot: null,
      seedTag, createdAt: ts(sme.submittedAt), createdBy: null, updatedAt: now, updatedBy: null,
    })
    track('applications', applicationRef)

    await db.collection('diagnosticPlans').doc(applicationRef.id).set({
      companyCode: COMPANY_CODE, participantId: participantRef.id, applicationId: applicationRef.id, programId: programme.id,
      interventions: required.map((item) => ({ interventionId: slug(item.title), title: item.title, areaOfSupport: item.areaOfSupport, executionMode: 'single_session', steps: [] })),
      confirmed: true, status: 'Confirmed', confirmedAt: new Date().toISOString(),
      confirmedBy: { operations: { name: 'Seeded plan', confirmedAt: new Date().toISOString() } },
      confirmedMeta: { operations: { name: 'Seeded plan', confirmedAt: new Date().toISOString() } },
      seedTag, updatedAt: now,
    })
    track('diagnosticPlans', { id: applicationRef.id })

    for (let index = 0; index < sme.assignments.length; index += 1) {
      const assignment = sme.assignments[index]
      await assignmentRefs[index].set({
        companyCode: COMPANY_CODE, groupId: null, participantId: participantRef.id, businessName: sme.businessName,
        interventionDefinitionId: null, interventionId: null, interventionTitle: assignment.interventionTitle,
        subtitle: assignment.areaOfSupport, type: 'coaching', programId: programme.id, programName: programmeData.name,
        implementationDate: ts(assignment.createdAt), dueDate: ts(assignment.dueDate), isRecurring: false,
        assigneeType: 'consultant', assigneeUid: sme.consultant.uid, assigneeId: sme.consultant.uid,
        assigneeName: sme.consultant.name, assigneeEmail: sme.consultant.email,
        ...assignment.statusFields, areaOfSupport: assignment.areaOfSupport,
        targetType: 'number', targetValue: 10, targetMetric: 'hours',
        targetActual: assignment.bucket === 'completed' ? 10 : Math.round(assignment.statusFields.progress / 10),
        timeSpent: 0, notes: '', ...(assignment.finishedAt ? { completedAt: ts(assignment.finishedAt) } : {}),
        seedTag, createdAt: ts(assignment.createdAt), createdBy: sme.consultant.uid, updatedAt: now, updatedBy: sme.consultant.uid,
      })
      track('assignedInterventions', assignmentRefs[index])
    }

    const firstAssignment = sme.assignments[0]
    const appointmentBase = {
      companyCode: COMPANY_CODE, assignedInterventionId: assignmentRefs[0].id, interventionId: null,
      interventionTitle: firstAssignment.interventionTitle, participantId: participantRef.id, participantName: sme.businessName,
      participantEmail: sme.email, programId: programme.id, programName: programmeData.name,
      assigneeId: sme.consultant.uid, assigneeEmail: sme.consultant.email, meetingLink: null, location: null,
      requiresSmeAcceptance: true, acceptanceBundle: 'intervention_and_appointment', seedTag,
      createdByUid: sme.consultant.uid, createdByEmail: sme.consultant.email, createdAt: now, updatedAt: now,
    }
    const heldRef = db.collection('appointments').doc()
    await heldRef.set({
      ...appointmentBase, meetingType: sme.meetingTypes[0], startTime: ts(sme.heldAt), endTime: ts(new Date(sme.heldAt.getTime() + 3600000)),
      status: 'completed', attendance: { [sme.email]: sme.heldPresent ? 'present' : 'absent' }, discussionSummary: sme.summary, completedAt: now,
    })
    track('appointments', heldRef)
    const upcomingRef = db.collection('appointments').doc()
    await upcomingRef.set({
      ...appointmentBase, meetingType: sme.meetingTypes[1], startTime: ts(sme.upcomingAt), endTime: ts(new Date(sme.upcomingAt.getTime() + 3600000)),
      status: 'pending', attendance: {}, discussionSummary: '',
    })
    track('appointments', upcomingRef)
    console.log(`  created ${sme.businessName}`)
  }

  const manifestPath = path.resolve(__dirname, `seed-output-rcm-smes-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), seedTag, created }, null, 2))
  console.log(`\nDone. Created ${created.length} document(s) for ${plans.length} SMEs.`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-rcm-smes.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
