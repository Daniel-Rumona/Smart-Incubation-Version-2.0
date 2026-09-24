#!/usr/bin/env node

/*
 * Seeds two extra programmes, each with its own cohort of SMEs, so program switching and the
 * Director's Program Performance / Portfolio pages have something to compare against the original
 * programme. Everything is created under the target user's companyCode:
 *
 *   - 2 `programs` documents (different sizes / profiles so the comparison is interesting)
 *   - per SME: a `participants` doc (with revenue + headcount history), an accepted `applications`
 *     doc (demographics + interventions.required/completed) and 3-5 `assignedInterventions`
 *     assigned to the target user, spread over the programme's months
 *
 * "Women in Agri Accelerator" is a healthy cohort (mostly growing, mostly on track);
 * "Township Tech Launchpad" is a struggling one (more overdue work, more declining SMEs).
 *
 * If the target user has assignedProgramIds set (i.e. is restricted to specific programmes), the
 * new programme ids are appended so they actually show up in the programme switcher; the previous
 * array is stored in the manifest and restored on undo.
 *
 * Every created document carries a `seedTag`; a manifest of created (collection, id) pairs is
 * written to scripts/seed-output-programs-<timestamp>.json for --undo.
 *
 * Usage:
 *   # dry run (default)
 *   node scripts/seed-programs.cjs --service-account ./scripts/new-service-account.json --email danieltmazorodze@gmail.com
 *
 *   # write it
 *   node scripts/seed-programs.cjs --service-account ./scripts/new-service-account.json --email danieltmazorodze@gmail.com --apply
 *
 *   # undo a previous run
 *   node scripts/seed-programs.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-programs-<timestamp>.json --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const requireFromFunctions = createRequire(path.resolve(__dirname, '../functions/package.json'))
const admin = requireFromFunctions('firebase-admin')

const PROVINCES = ['Gauteng', 'Western Cape', 'KwaZulu-Natal', 'Eastern Cape', 'Free State', 'Limpopo', 'Mpumalanga', 'North West']
const STAGES = ['Ideation', 'Startup', 'Early growth', 'Growth', 'Established']
const BEE_LEVELS = ['Level 1', 'Level 2', 'Level 3', 'Level 4']
const GENDERS = ['Female', 'Male']
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
const FIRST_NAMES = ['Thandiwe', 'Bongani', 'Lindiwe', 'Sipho', 'Nomvula', 'Kagiso', 'Ayanda', 'Mpho', 'Zanele', 'Themba', 'Palesa', 'Kabelo', 'Nokuthula', 'Tumelo', 'Busisiwe']
const LAST_NAMES = ['Dlamini', 'Nkosi', 'Mokoena', 'Khumalo', 'Mahlangu', 'Radebe', 'Sithole', 'Zulu', 'Mbeki', 'Ndlovu']

const PROGRAMS = [
  {
    key: 'agri',
    name: 'Women in Agri Accelerator 2026',
    description: 'A 10-month accelerator supporting women-led agri-businesses to scale production and access formal markets.',
    type: 'accelerator',
    cohortYear: '2026',
    start: '2026-01-15',
    end: '2026-11-30',
    budget: 1800000,
    maxCapacity: 15,
    sectors: ['Agro-processing', 'Renewable Energy', 'Health & Wellness', 'Retail & Trade'],
    businesses: ['Mabele Farms', 'Ithemba Harvest', 'Lehlohonolo Organics', 'Sunrise Agri Co', 'Kgotso Produce', 'Umlimi Foods', 'Tshepo Greenhouse', 'Bokamoso Grain', 'Ntombi Fresh Produce'],
    // share of SMEs whose revenue/headcount trend up, and the assignment status mix
    growingShare: 0.8,
    buckets: ['completed', 'completed', 'inProgress', 'inProgress', 'pending', 'overdue'],
  },
  {
    key: 'tech',
    name: 'Township Tech Launchpad 2026',
    description: 'A 6-month launchpad helping township-based digital and creative start-ups reach their first paying customers.',
    type: 'incubation',
    cohortYear: '2026',
    start: '2026-04-01',
    end: '2026-10-31',
    budget: 950000,
    maxCapacity: 10,
    sectors: ['ICT & Software', 'Creative Industries', 'Professional Services'],
    businesses: ['Kasi Code Labs', 'Pixel Ubuntu Studio', 'Mzansi Apps', 'Soweto Stream Media', 'Bytes & Beats', 'Ikasi Digital'],
    growingShare: 0.45,
    buckets: ['overdue', 'overdue', 'pending', 'pending', 'inProgress', 'completed'],
  },
]

function parseArgs(argv) {
  const args = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--email=')) args.email = arg.slice('--email='.length)
    else if (arg === '--email') args.email = argv[++index]
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

/** Deterministic-enough PRNG so a dry run and the matching --apply run generate the same preview. */
function makeRand(seed) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

const addDays = (date, days) => {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

/** Every "YYYY-MM" from the programme's start month through the current month. */
function monthsSince(start) {
  const keys = []
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
  const end = new Date()
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
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
    const noise = (rand() - 0.5) * 0.05
    value = Math.max(minValue, value * (1 + drift + noise))
    series.push(value)
  }
  return series
}

function statusFieldsFor(bucket, rand) {
  if (bucket === 'completed') {
    return { status: 'completed', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'done', participantCompletionStatus: 'confirmed', progress: 100 }
  }
  if (bucket === 'inProgress') {
    return { status: 'in_progress', assigneeStatus: 'accepted', participantStatus: 'accepted', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 30 + Math.round(rand() * 50) }
  }
  if (bucket === 'overdue') {
    return { status: 'pending', assigneeStatus: 'accepted', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: Math.round(rand() * 15) }
  }
  return { status: 'pending', assigneeStatus: 'pending', participantStatus: 'pending', assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', progress: 0 }
}

function dueDateFor(bucket, rand) {
  const today = new Date()
  today.setHours(9, 0, 0, 0)
  if (bucket === 'overdue') return addDays(today, -(4 + Math.floor(rand() * 25)))
  if (bucket === 'completed') return addDays(today, -(10 + Math.floor(rand() * 60)))
  return addDays(today, Math.floor(rand() * 28))
}

function buildPlan(rand, programStart, program) {
  const start = new Date(program.start)
  const months = monthsSince(start)
  return program.businesses.map((businessName, index) => {
    const participantName = `${pick(FIRST_NAMES, rand)} ${pick(LAST_NAMES, rand)}`
    const trend = rand() < program.growingShare ? 'up' : 'down'
    const startRevenue = 50000 + Math.round(rand() * 220000)
    const startEmployees = 2 + Math.floor(rand() * 9)
    const revenueSeries = buildSeries(startRevenue, months.length, trend, rand, 5000)
    const employeeSeries = buildSeries(startEmployees, months.length, trend, rand, 1)
    const revenueHistory = {}
    const headcountHistory = {}
    months.forEach((month, monthIndex) => {
      revenueHistory[month] = Math.round(revenueSeries[monthIndex] / 100) * 100
      headcountHistory[month] = Math.round(employeeSeries[monthIndex])
    })

    const assignmentCount = 3 + Math.floor(rand() * 3)
    const assignments = Array.from({ length: assignmentCount }, () => {
      const areaOfSupport = pick(AREAS_OF_SUPPORT, rand)
      const bucket = pick(program.buckets, rand)
      return {
        areaOfSupport,
        interventionTitle: pick(INTERVENTION_TITLES[areaOfSupport], rand),
        bucket,
        dueDate: dueDateFor(bucket, rand),
        statusFields: statusFieldsFor(bucket, rand),
        createdAt: addDays(start, 7 + Math.floor(rand() * Math.max(1, (Date.now() - start.getTime()) / 86400000 - 14))),
      }
    })

    const submittedAt = addDays(start, -(20 + Math.floor(rand() * 20)))
    return {
      businessName,
      participantName,
      email: `${participantName.toLowerCase().replace(/\s+/g, '.')}.${program.key}${index}@example.com`,
      phone: `+27${String(60000000 + Math.floor(rand() * 9999999)).slice(0, 9)}`,
      sector: pick(program.sectors, rand),
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
      age: 22 + Math.floor(rand() * 40),
      yearsOfTrading: 1 + Math.floor(rand() * 12),
      hub: pick(HUBS, rand),
      city: pick(CITIES, rand),
      disabilityStatus: pick(DISABILITY_STATUSES, rand),
      educationLevel: pick(EDUCATION_LEVELS, rand),
      employmentStatus: pick(EMPLOYMENT_STATUSES, rand),
      maritalStatus: pick(MARITAL_STATUSES, rand),
      locationType: pick(LOCATION_TYPES, rand),
      youthOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
      femaleOwnedPercent: program.key === 'agri' ? pick([75, 100, 100], rand) : pick(OWNERSHIP_PERCENTS, rand),
      blackOwnedPercent: pick(OWNERSHIP_PERCENTS, rand),
    }
  })
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const serviceAccount = loadServiceAccount(args)

  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()
  const auth = admin.auth()

  if (args.undo) {
    const manifestPath = path.isAbsolute(args.undo) ? args.undo : path.resolve(process.cwd(), args.undo)
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    console.log(`\nUndo manifest: ${manifest.created.length} document(s) from ${manifest.createdAt}`)

    if (!args.apply) {
      console.log('\nDry run. Re-run with --apply to delete these documents.')
      return
    }

    let batch = db.batch()
    let opsInBatch = 0
    for (const entry of manifest.created) {
      batch.delete(db.collection(entry.collection).doc(entry.id))
      opsInBatch += 1
      if (opsInBatch === 400) {
        await batch.commit()
        batch = db.batch()
        opsInBatch = 0
      }
    }
    if (opsInBatch > 0) await batch.commit()

    if (manifest.userAssignedProgramIds) {
      await db.collection('users').doc(manifest.userAssignedProgramIds.uid).update({ assignedProgramIds: manifest.userAssignedProgramIds.previous })
      console.log('Restored the target user\'s assignedProgramIds.')
    }
    console.log(`\nDeleted ${manifest.created.length} document(s).`)
    return
  }

  if (!args.email) throw new Error('Pass --email <address> (the user the interventions are assigned to; also decides the companyCode).')

  const userRecord = await auth.getUserByEmail(args.email).catch(() => null)
  if (!userRecord) throw new Error(`No Firebase Auth user found for ${args.email}.`)
  const userDoc = await db.collection('users').doc(userRecord.uid).get()
  if (!userDoc.exists) throw new Error(`Auth user ${args.email} has no users/${userRecord.uid} document.`)

  const userData = userDoc.data()
  const companyCode = String(userData.companyCode || '').trim()
  if (!companyCode) throw new Error(`users/${userRecord.uid} has no companyCode.`)
  const role = String(userData.role || '')
  const assigneeType = ['operations', 'projectadmin', 'projectmanager'].includes(role) ? 'operations' : 'consultant'
  const assigneeName = String(userData.displayName || userData.name || args.email)
  const previousAssignedProgramIds = Array.isArray(userData.assignedProgramIds) ? userData.assignedProgramIds : []

  console.log('\nTarget user')
  console.log(`  email        : ${args.email}`)
  console.log(`  companyCode  : ${companyCode}`)
  console.log(`  role         : ${role || '(none)'}`)
  console.log(`  restricted   : ${previousAssignedProgramIds.length ? `yes (${previousAssignedProgramIds.length} assigned programme(s)) - new ids will be appended` : 'no - sees every programme'}`)

  const seedTag = `programs-${Date.now()}`
  const rand = makeRand(77)
  const plans = PROGRAMS.map((program) => ({ program, smes: buildPlan(rand, null, program) }))

  console.log(`\nWill create ${PROGRAMS.length} programmes (seedTag=${seedTag}):`)
  plans.forEach(({ program, smes }) => {
    const assignments = smes.reduce((sum, sme) => sum + sme.assignments.length, 0)
    console.log(`\n  ${program.name}  (${program.start} to ${program.end})`)
    console.log(`    ${smes.length} SMEs, ${assignments} assigned interventions`)
    smes.forEach((sme) => {
      const buckets = sme.assignments.map((assignment) => assignment.bucket[0]).join('')
      console.log(`    ${sme.businessName.padEnd(26)} ${sme.sector.padEnd(24)} [${sme.trend.padEnd(4)}] R${sme.latestRevenue} / ${sme.latestEmployees} staff  interventions: ${buckets}`)
    })
  })

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write these documents.')
    return
  }

  const created = []
  const now = admin.firestore.FieldValue.serverTimestamp()
  const ts = (date) => admin.firestore.Timestamp.fromDate(date)
  const newProgramIds = []

  for (const { program, smes } of plans) {
    const programRef = db.collection('programs').doc()
    await programRef.set({
      name: program.name,
      title: program.name,
      description: program.description,
      type: program.type,
      status: 'active',
      cohortYear: program.cohortYear,
      assignedAdmin: userRecord.uid,
      startDate: ts(new Date(program.start)),
      endDate: ts(new Date(program.end)),
      budget: program.budget,
      maxCapacity: program.maxCapacity,
      openToExternalSmes: false,
      companyCode,
      eligibilityCriteria: [],
      onboardingQuestions: [],
      complianceRequirements: [],
      agentSupportMode: 'simultaneous',
      seedTag,
      createdAt: now,
      createdBy: userRecord.uid,
      updatedAt: now,
    })
    created.push({ collection: 'programs', id: programRef.id })
    newProgramIds.push(programRef.id)
    console.log(`\ncreated programs/${programRef.id} ${program.name}`)

    for (const sme of smes) {
      const applicationRef = db.collection('applications').doc()
      const participantRef = db.collection('participants').doc()

      const assignmentRefs = sme.assignments.map(() => db.collection('assignedInterventions').doc())
      const required = sme.assignments.map((assignment, index) => ({
        id: assignmentRefs[index].id,
        interventionId: null,
        title: assignment.interventionTitle,
        areaOfSupport: assignment.areaOfSupport,
      }))
      const completed = required.filter((_, index) => sme.assignments[index].bucket === 'completed').map(({ id, interventionId, title }) => ({ id, interventionId, title }))

      await participantRef.set({
        applicationId: applicationRef.id,
        applicantProfileId: null,
        businessProfileId: null,
        programId: programRef.id,
        programName: program.name,
        companyCode,
        departmentId: null,
        businessName: sme.businessName,
        participantName: sme.participantName,
        email: sme.email,
        phone: sme.phone,
        gender: sme.gender,
        sector: sme.sector,
        stage: sme.stage,
        province: sme.province,
        beeLevel: sme.beeLevel,
        status: 'active',
        revenue: sme.latestRevenue,
        employeeCount: sme.latestEmployees,
        revenueHistory: { monthly: sme.revenueHistory },
        headcountHistory: { monthly: sme.headcountHistory },
        acceptedAt: ts(sme.acceptedAt),
        onboardedAt: ts(sme.acceptedAt),
        acceptedBy: userRecord.uid,
        seedTag,
        createdAt: ts(sme.acceptedAt),
        updatedAt: now,
      })
      created.push({ collection: 'participants', id: participantRef.id })

      await applicationRef.set({
        uid: null,
        userId: null,
        applicantProfileId: null,
        businessProfileId: null,
        participantId: participantRef.id,
        businessName: sme.businessName,
        participantName: sme.participantName,
        email: sme.email,
        phone: sme.phone,
        gender: sme.gender,
        sector: sme.sector,
        stage: sme.stage,
        province: sme.province,
        hub: sme.hub,
        city: sme.city,
        ageGroup: sme.ageGroup,
        age: sme.age,
        yearsOfTrading: sme.yearsOfTrading,
        beeLevel: sme.beeLevel,
        disabilityStatus: sme.disabilityStatus,
        educationLevel: sme.educationLevel,
        employmentStatus: sme.employmentStatus,
        maritalStatus: sme.maritalStatus,
        locationType: sme.locationType,
        youthOwnedPercent: sme.youthOwnedPercent,
        femaleOwnedPercent: sme.femaleOwnedPercent,
        blackOwnedPercent: sme.blackOwnedPercent,
        programId: programRef.id,
        programName: program.name,
        companyCode,
        departmentId: null,
        status: 'accepted',
        applicationStatus: 'accepted',
        submittedAt: ts(sme.submittedAt),
        acceptedAt: ts(sme.acceptedAt),
        reviewedAt: ts(sme.acceptedAt),
        reviewedBy: null,
        interventions: { required, completed },
        requiredInterventions: [],
        complianceDocuments: [],
        swot: null,
        seedTag,
        createdAt: ts(sme.submittedAt),
        createdBy: null,
        updatedAt: now,
        updatedBy: null,
      })
      created.push({ collection: 'applications', id: applicationRef.id })

      for (let index = 0; index < sme.assignments.length; index += 1) {
        const assignment = sme.assignments[index]
        await assignmentRefs[index].set({
          companyCode,
          groupId: null,
          participantId: participantRef.id,
          businessName: sme.businessName,
          interventionDefinitionId: null,
          interventionId: null,
          interventionTitle: assignment.interventionTitle,
          subtitle: assignment.areaOfSupport,
          type: 'coaching',
          programId: programRef.id,
          programName: program.name,
          implementationDate: ts(assignment.createdAt),
          dueDate: ts(assignment.dueDate),
          isRecurring: false,
          assigneeType,
          assigneeUid: userRecord.uid,
          assigneeId: userRecord.uid,
          assigneeName,
          assigneeEmail: args.email,
          ...assignment.statusFields,
          areaOfSupport: assignment.areaOfSupport,
          targetType: 'number',
          targetValue: 10,
          targetMetric: 'hours',
          targetActual: assignment.bucket === 'completed' ? 10 : Math.round(assignment.statusFields.progress / 10),
          timeSpent: 0,
          notes: '',
          seedTag,
          createdAt: ts(assignment.createdAt),
          createdBy: userRecord.uid,
          updatedAt: now,
          updatedBy: userRecord.uid,
        })
        created.push({ collection: 'assignedInterventions', id: assignmentRefs[index].id })
      }
      console.log(`  created ${sme.businessName} (participant + application + ${sme.assignments.length} interventions)`)
    }
  }

  const manifest = { createdAt: new Date().toISOString(), targetEmail: args.email, seedTag, created }
  if (previousAssignedProgramIds.length) {
    await db.collection('users').doc(userRecord.uid).update({ assignedProgramIds: [...previousAssignedProgramIds, ...newProgramIds] })
    manifest.userAssignedProgramIds = { uid: userRecord.uid, previous: previousAssignedProgramIds }
    console.log('\nAppended the new programme ids to the target user\'s assignedProgramIds.')
  }

  const manifestPath = path.resolve(__dirname, `seed-output-programs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  console.log(`\nDone. Created ${created.length} document(s).`)
  console.log(`Manifest: ${manifestPath}`)
  console.log(`Undo    : node scripts/seed-programs.cjs --service-account <path> --undo ${manifestPath} --apply`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exitCode = 1
})
