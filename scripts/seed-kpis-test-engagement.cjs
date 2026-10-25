#!/usr/bin/env node

/*
 * Seeds a set of company KPIs for QTX, with Test Engagement programme targets, covering all three kinds:
 * system metrics (actuals fill in from the app), intervention-based ones (SMEs completing listed
 * interventions), and manual ones (with a few sample actuals entered for Test Engagement).
 *
 * Same shape as kpiService.createKpi. Skips any KPI the company already has by name, so it can be re-run.
 * Every created document carries `seedTag`; --undo <tag> --apply archives nothing and deletes only those.
 *
 * Usage:
 *   node scripts/seed-kpis-test-engagement.cjs --service-account ./scripts/new-service-account.json          # dry run
 *   node scripts/seed-kpis-test-engagement.cjs --service-account ./scripts/new-service-account.json --apply  # write
 *   node scripts/seed-kpis-test-engagement.cjs --service-account ./scripts/new-service-account.json --undo <seedTag> --apply
 */

const fs = require('fs')
const path = require('path')
const { createRequire } = require('module')

const admin = createRequire(path.resolve(__dirname, '../functions/package.json'))('firebase-admin')

const COMPANY = 'QTX'
const PROGRAM_ID = 'G50OLXypsdc3g6s5QDac' // Test Engagement

function parseArgs(argv) {
  const args = { apply: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--service-account') args.serviceAccount = argv[++index]
    else if (arg.startsWith('--service-account=')) args.serviceAccount = arg.slice('--service-account='.length)
    else if (arg === '--undo') args.undo = argv[++index]
    else if (arg === '--apply') args.apply = true
  }
  return args
}

const actual = (value, note) => ({ value, note, byUid: 'seed-script', byName: 'Seed data', at: new Date().toISOString() })

// Periods keyed as kpiService.periodFor does: YYYY, YYYY-Qn, YYYY-MM.
const KPIS = [
  { name: 'Completion rate', kind: 'system', metric: 'completion_rate', unit: 'percent', direction: 'higher', cadence: 'quarter', target: 75, programTarget: 80,
    description: 'Share of the quarter’s interventions that are complete.' },
  { name: 'Interventions completed', kind: 'system', metric: 'interventions_completed', unit: 'count', direction: 'higher', cadence: 'quarter', target: 40, programTarget: 30,
    description: 'Interventions completed and confirmed by the SME each quarter.' },
  { name: 'Delivered on time', kind: 'system', metric: 'on_time_rate', unit: 'percent', direction: 'higher', cadence: 'quarter', target: 85, programTarget: 85,
    description: 'Completed interventions finished by their due date.' },
  { name: 'Median turnaround', kind: 'system', metric: 'median_turnaround_days', unit: 'days', direction: 'lower', cadence: 'quarter', target: 45, programTarget: 40,
    description: 'Days from assignment to completion, at the median.' },
  { name: 'Overdue interventions', kind: 'system', metric: 'overdue_now', unit: 'count', direction: 'lower', cadence: 'month', target: 5, programTarget: 3,
    description: 'Open interventions past their due date right now.' },
  { name: 'Appointment attendance', kind: 'system', metric: 'attendance_rate', unit: 'percent', direction: 'higher', cadence: 'month', target: 90, programTarget: 90,
    description: 'Share of held appointments the SME attended.' },
  { name: 'Client rating', kind: 'system', metric: 'average_rating', unit: 'rating', direction: 'higher', cadence: 'quarter', target: 4.2, programTarget: 4.5,
    description: 'Average rating SMEs gave completed interventions, out of 5.' },
  { name: 'SMEs supported', kind: 'system', metric: 'smes_supported', unit: 'count', direction: 'higher', cadence: 'year', target: 50, programTarget: 40,
    description: 'SMEs with at least one intervention completed this year.' },
  { name: 'Financially ready SMEs', kind: 'interventions', rule: 'atLeast', atLeast: 2, unit: 'count', direction: 'higher', cadence: 'year', target: 15, programTarget: 12,
    interventionIds: ['bookkeeping-systems-setup', 'cash-flow-budgeting-workshop', 'financial-management-coaching'],
    description: 'SMEs that complete at least two of the core finance interventions.' },
  { name: 'Market-ready SMEs', kind: 'interventions', rule: 'any', unit: 'count', direction: 'higher', cadence: 'quarter', target: 10, programTarget: 10,
    interventionIds: ['market-access-facilitation', 'marketing-strategy-development', 'website-e-commerce-setup'],
    description: 'SMEs that complete any market access, marketing or e-commerce intervention.' },
  { name: 'Jobs created', kind: 'manual', unit: 'count', direction: 'higher', cadence: 'quarter', target: 30, programTarget: 25,
    description: 'New permanent jobs reported by the programme’s SMEs.',
    manualActuals: {
      [`2026-Q3|${PROGRAM_ID}`]: actual(22, 'From SME quarterly returns (sample data).'),
      [`2026-Q4|${PROGRAM_ID}`]: actual(9, 'Returns received so far this quarter (sample data).'),
    } },
  { name: 'Sponsor funding unlocked', kind: 'manual', unit: 'currency', direction: 'higher', cadence: 'year', target: 2000000, programTarget: 1500000,
    description: 'Funding SMEs secured with programme support, as reported to the sponsor.',
    manualActuals: { [`2026|${PROGRAM_ID}`]: actual(640000, 'Confirmed funding letters to date (sample data).') } },
]

const toDoc = (kpi, seedTag) => ({
  companyCode: COMPANY,
  name: kpi.name,
  description: kpi.description || '',
  kind: kpi.kind,
  metric: kpi.kind === 'system' ? kpi.metric : null,
  interventionIds: kpi.kind === 'interventions' ? kpi.interventionIds : [],
  rule: kpi.kind === 'interventions' ? kpi.rule : null,
  atLeast: kpi.kind === 'interventions' && kpi.rule === 'atLeast' ? kpi.atLeast : null,
  unit: kpi.unit,
  direction: kpi.direction,
  cadence: kpi.cadence,
  target: kpi.target,
  programTargets: { [PROGRAM_ID]: kpi.programTarget },
  manualActuals: kpi.manualActuals || {},
  active: true,
  createdByUid: 'seed-script',
  seedTag,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
})

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.serviceAccount) throw new Error('Pass --service-account <path>.')
  const credentials = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), args.serviceAccount), 'utf8'))
  admin.initializeApp({ credential: admin.credential.cert(credentials) })
  const db = admin.firestore()

  if (args.undo) {
    const seeded = await db.collection('kpis').where('seedTag', '==', args.undo).get()
    console.log(`${args.apply ? 'Deleting' : 'Would delete'} ${seeded.size} seeded KPI(s) tagged ${args.undo}`)
    if (args.apply) { const batch = db.batch(); seeded.docs.forEach((row) => batch.delete(row.ref)); await batch.commit() }
    return
  }

  const program = await db.collection('programs').doc(PROGRAM_ID).get()
  if (!program.exists || program.data().companyCode !== COMPANY) throw new Error('Test Engagement programme not found for QTX.')
  const existing = new Set((await db.collection('kpis').where('companyCode', '==', COMPANY).get()).docs.map((row) => String(row.data().name || '').toLowerCase()))

  const seedTag = `kpi-seed-${new Date().toISOString()}`
  const toCreate = KPIS.filter((kpi) => !existing.has(kpi.name.toLowerCase()))
  KPIS.filter((kpi) => existing.has(kpi.name.toLowerCase())).forEach((kpi) => console.log(`skip (exists): ${kpi.name}`))
  toCreate.forEach((kpi) => console.log(`${args.apply ? 'create' : 'would create'}: ${kpi.name} [${kpi.kind}${kpi.metric ? `:${kpi.metric}` : ''}] per ${kpi.cadence}, company target ${kpi.target}, Test Engagement ${kpi.programTarget}`))

  if (!args.apply) { console.log(`\nDry run: ${toCreate.length} to create. Re-run with --apply.`); return }
  const batch = db.batch()
  toCreate.forEach((kpi) => batch.set(db.collection('kpis').doc(), toDoc(kpi, seedTag)))
  await batch.commit()
  console.log(`\nCreated ${toCreate.length} KPI(s). seedTag: ${seedTag}`)
}

main().catch((error) => { console.error(error); process.exit(1) })
