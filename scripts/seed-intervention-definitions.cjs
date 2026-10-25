#!/usr/bin/env node
/*
 * Defines the interventions that the diagnostic plans use but the intervention library does not describe.
 *
 * Plans and assignments refer to an intervention by id ("business-plan-refresh") but only 3 library definitions
 * existed, so steps, recurrence, outcome and follow-up were all missing. This creates one definition per company
 * in `interventions/<COMPANY>__<id>` (the lookup in src/services/interventionDefinitionLookup.ts tries that first)
 * and adds an outcome definition to the three library entries that already exist.
 *
 * The 18 definitions deliberately cover every variation the library supports:
 *   execution      single session, multi-step with weighted steps (3, 4 and 5 steps)
 *   recurrence     weekly, monthly, quarterly, yearly, custom; ends never / after N cycles / by date
 *   term           short, medium, long
 *   compulsory     yes and no
 *   outcome type   all eight (capability, process, behaviour, compliance, risk, performance, access, issue)
 *   deliverable    required, optional, none
 *   follow-up      30, 45, 60, 90, 120 and 180 days, and none
 *   delivery       human; agent with consultant review; agent with operations review (only where the company
 *                  has that agent enabled)
 *   scope          company-wide, and one programme-scoped example per company
 *
 * Dry run by default. Everything it creates is tagged and listed in a manifest so it can be undone.
 *
 *   node scripts/seed-intervention-definitions.cjs --service-account ./scripts/new-service-account.json            (preview)
 *   node scripts/seed-intervention-definitions.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-intervention-definitions.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-definitions-<ts>.json --apply
 */
const fs = require('fs')
const path = require('path')
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'))

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const value = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

const serviceAccountPath = value('service-account')
const apply = flag('apply')
const undoFile = value('undo')
const onlyCompany = (value('company') || '').toUpperCase()
if (!serviceAccountPath) { console.error('Usage: node scripts/seed-intervention-definitions.cjs --service-account <file> [--company QTX] [--apply] [--undo <manifest>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(serviceAccountPath))) })
const db = admin.firestore()

const slug = (v) => String(v).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const SEED_TAG = `intervention-definitions-${new Date().toISOString().slice(0, 10)}`
const step = (base, n, title, description, weight) => ({ id: `step-${base}-${n}`, title, description, weight })
const outcome = (outcomeType, intendedOutcome, deliverableName, deliverableRequired, followUpDays, deliverableDescription) => ({
  outcomeType,
  intendedOutcome,
  ...(deliverableName ? { deliverableName, ...(deliverableDescription ? { deliverableDescription } : {}), ...(deliverableRequired ? { deliverableRequired: true } : {}) } : {}),
  ...(followUpDays ? { followUpDays } : {}),
})
const yearsFromNow = (years) => { const d = new Date(); d.setFullYear(d.getFullYear() + years); return d.toISOString() }

// Companies the plans use. `agents` are the agents enabled for that company (the library refuses agent delivery otherwise).
const COMPANIES = {
  QTX: { agents: ['business-plan', 'strategic-plan', 'pitch-coach'], programme: 'rX9MtWkkupBU647bhKaL' /* Township Tech Launchpad 2026 */ },
  RCM: { agents: [], programme: 'itGOWCM83DzMjkJktW6W' /* Women in Agri Accelerator 2026 */ },
}

const DEFINITIONS = [
  { title: 'Digital Tools Onboarding', area: 'Digital Transformation', term: 'short_term', compulsory: false,
    outcome: outcome('behaviour_adopted', 'The SME uses its core digital tools in day-to-day operations.', 'Digital Tools Setup Checklist', false, 30, 'The tools set up and who uses them.') },
  { title: 'Business Plan Refresh', area: 'Governance & Leadership', term: 'medium_term', compulsory: false,
    steps: [['Review the current plan', 'Read the existing plan and note what is out of date.', 1], ['Update market and financial assumptions', 'Refresh the numbers and the market picture.', 2], ['Draft the updated plan', 'Write the new plan.', 3], ['Review and sign-off', 'Walk through the plan with the owner and agree it.', 1]],
    outcome: outcome('capability_established', 'The SME has a current business plan that guides its decisions.', 'Business Plan', true, 90, 'The updated business plan document.'),
    agent: { QTX: { strategy: 'agent_with_consultant_review', agentId: 'business-plan', reviewer: 'consultant' } } },
  { title: 'Sales Pipeline Coaching', area: 'Marketing & Sales', term: 'long_term', compulsory: false,
    recurrence: { preset: 'weekly', every: 1, unit: 'week' }, endRule: 'after_n_cycles', maxCycles: 8,
    outcome: outcome('performance_improved', 'The SME runs a repeatable customer acquisition process.', null, false, 60) },
  { title: 'Website & E-commerce Setup', area: 'Digital Transformation', term: 'medium_term', compulsory: false,
    steps: [['Requirements and domain', 'Agree what the site must do and secure the domain.', 1], ['Design and content', 'Agree the look and prepare the content.', 2], ['Build and payments', 'Build the site and connect payments.', 3], ['Test and launch', 'Test everything and go live.', 2], ['Handover and training', 'Show the owner how to run and update it.', 1]],
    outcome: outcome('process_implemented', 'The SME takes orders or enquiries through its website.', 'Live Website', true, 45, 'The live website address.') },
  { title: 'Compliance Readiness Review', area: 'Operations & Compliance', term: 'short_term', compulsory: true,
    outcome: outcome('compliance_achieved', 'The SME has closed its identified compliance gaps.', 'Compliance Gap Report', true, 90, 'The gaps found and the plan to close them.') },
  { title: 'Market Access Facilitation', area: 'Access to Markets', term: 'long_term', compulsory: false, programmeScoped: true,
    steps: [['Market scan', 'Identify the markets and buyers worth pursuing.', 1], ['Buyer introductions', 'Introduce the SME to suitable buyers.', 2], ['Follow-through on leads', 'Support the SME to turn introductions into conversations.', 2]],
    outcome: outcome('access_achieved', 'The SME is in active conversation with at least one new buyer.', 'Buyer Introductions Log', false, 120) },
  { title: 'Export Readiness Assessment', area: 'Access to Markets', term: 'short_term', compulsory: false,
    outcome: outcome('capability_established', 'The SME knows what it must fix before it can export.', 'Export Readiness Report', true, null) },
  { title: 'Systems Automation Review', area: 'Digital Transformation', term: 'medium_term', compulsory: false,
    steps: [['Map current processes', 'Document how work is done today.', 1], ['Find automation opportunities', 'Pick the processes worth automating.', 2], ['Present the automation roadmap', 'Agree what to automate and in what order.', 1]],
    outcome: outcome('process_implemented', 'The SME has automated at least one manual process.', 'Automation Roadmap', true, 60) },
  { title: 'Cash Flow & Budgeting Workshop', area: 'Financial Management', term: 'short_term', compulsory: false,
    outcome: outcome('process_implemented', 'The SME actively maintains a forward-looking cash-flow forecast.', 'Cash Flow Forecast', true, 60, 'The cash-flow forecast for the next 6 to 12 months.') },
  { title: 'Financial Management Coaching', area: 'Financial Management', term: 'long_term', compulsory: false,
    recurrence: { preset: 'monthly', every: 1, unit: 'month' }, endRule: 'after_n_cycles', maxCycles: 6,
    outcome: outcome('behaviour_adopted', 'The SME reviews its management accounts every month.', null, false, 90) },
  { title: 'Brand & Digital Presence Audit', area: 'Marketing & Sales', term: 'short_term', compulsory: false,
    outcome: outcome('issue_resolved', 'The gaps found in the SME’s brand and online presence are fixed.', 'Brand & Digital Audit Report', false, 45) },
  { title: 'Operations Efficiency Assessment', area: 'Operations & Compliance', term: 'medium_term', compulsory: false,
    recurrence: { preset: 'quarterly', every: 3, unit: 'month' }, endRule: 'none',
    outcome: outcome('performance_improved', 'The SME has measurably reduced wasted time or cost in its operations.', 'Efficiency Assessment Report', true, 90) },
  { title: 'Marketing Strategy Development', area: 'Marketing & Sales', term: 'medium_term', compulsory: false,
    steps: [['Customer and market research', 'Understand who the customers are and what they want.', 1], ['Positioning and channels', 'Decide how to position the business and where to reach customers.', 2], ['Draft the marketing strategy', 'Write the strategy.', 3], ['Review and sign-off', 'Walk through it with the owner and agree it.', 1]],
    outcome: outcome('process_implemented', 'The SME follows a marketing plan to win customers.', 'Marketing Strategy', true, 90) },
  { title: 'Standard Operating Procedures Workshop', area: 'Operations & Compliance', term: 'short_term', compulsory: false,
    recurrence: { preset: 'yearly', every: 1, unit: 'year' }, endRule: 'by_date', endDate: yearsFromNow(2),
    outcome: outcome('process_implemented', 'The SME’s key processes are written down and followed.', 'SOP Manual', true, 60) },
  { title: 'Succession Planning Session', area: 'Governance & Leadership', term: 'long_term', compulsory: false,
    outcome: outcome('risk_reduced', 'The SME has a plan for who runs the business if the owner is unavailable.', 'Succession Plan', true, 180),
    agent: { QTX: { strategy: 'agent_with_ops_review', agentId: 'strategic-plan', reviewer: 'operations' } } },
  { title: 'Tender Readiness Coaching', area: 'Access to Markets', term: 'medium_term', compulsory: false,
    steps: [['Find suitable tenders', 'Identify tenders the SME can realistically win.', 1], ['Gather compliance documents', 'Collect the documents every tender asks for.', 2], ['Prepare the tender submission', 'Complete the submission.', 2], ['Review before submission', 'Check everything before it goes in.', 1]],
    outcome: outcome('capability_established', 'The SME can prepare and submit a compliant tender.', 'Tender Submission Pack', true, 90) },
  { title: 'Bookkeeping Systems Setup', area: 'Financial Management', term: 'short_term', compulsory: true,
    steps: [['Choose the bookkeeping system', 'Pick a system that suits the business.', 1], ['Set up accounts and import records', 'Configure the system and bring in existing records.', 2], ['Train the owner', 'Show the owner how to keep the books up to date.', 1]],
    outcome: outcome('process_implemented', 'The SME keeps its books up to date in a proper system.', 'Bookkeeping Setup Checklist', true, 30) },
  { title: 'Governance & Leadership Coaching', area: 'Governance & Leadership', term: 'long_term', compulsory: false,
    recurrence: { preset: 'custom', every: 6, unit: 'week' }, endRule: 'after_n_cycles', maxCycles: 4,
    outcome: outcome('behaviour_adopted', 'The owner holds regular management reviews.', null, false, 60) },
]

// The three library entries that already exist only need an outcome definition.
const EXISTING_OUTCOMES = {
  'Business Readiness Pitch': outcome('capability_established', 'The SME can deliver a clear, investor-ready pitch.', 'Pitch Deck', true, 60),
  'Strategic Plan': outcome('capability_established', 'The SME has a strategic plan it uses to steer the business.', 'Strategic Plan', true, 90),
  'Tax Compliance Support': outcome('compliance_achieved', 'The SME’s tax affairs are up to date and compliant.', 'Tax Compliance Pack', true, 90),
}

const buildDocument = (companyCode, def) => {
  const company = COMPANIES[companyCode]
  const multi = Boolean(def.steps)
  const agent = def.agent?.[companyCode]
  const agentAllowed = agent && company.agents.includes(agent.agentId)
  const base = slug(def.title)
  return {
    companyCode,
    areaOfSupport: def.area,
    interventionTitle: def.title,
    isCompulsory: def.compulsory ? 'yes' : 'no',
    isRecurring: def.recurrence ? 'yes' : 'no',
    durationTerm: def.term,
    executionMode: multi ? 'multi_step' : 'single_session',
    ...(def.recurrence ? { recurrence: def.recurrence, endRule: def.endRule, ...(def.maxCycles ? { maxCycles: def.maxCycles } : {}), ...(def.endDate ? { endDate: def.endDate } : {}) } : {}),
    ...(multi ? { steps: def.steps.map(([title, description, weight], i) => step(base, i + 1, title, description, weight)) } : {}),
    scopeType: def.programmeScoped ? 'program' : 'company',
    programId: def.programmeScoped ? company.programme : null,
    departmentId: null,
    deliveryStrategy: agentAllowed ? agent.strategy : 'human_only',
    agentId: agentAllowed ? agent.agentId : null,
    reviewRequired: Boolean(agentAllowed),
    reviewerType: agentAllowed ? agent.reviewer : null,
    outcomeDefinition: def.outcome,
    createdAt: new Date().toISOString(),
    seedTag: SEED_TAG,
    legacyInterventionId: base,
  }
}

;(async () => {
  if (undoFile) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(undoFile), 'utf8'))
    console.log(`Undo: ${manifest.created.length} created definitions, ${manifest.outcomePatched.length} patched library entries`)
    if (!apply) { console.log('Dry run. Re-run with --apply to delete the created definitions and remove the added outcome definitions.'); return }
    const batch = db.batch()
    manifest.created.forEach((id) => batch.delete(db.collection('interventions').doc(id)))
    manifest.outcomePatched.forEach((id) => batch.update(db.collection('interventions').doc(id), { outcomeDefinition: admin.firestore.FieldValue.delete() }))
    await batch.commit()
    console.log('Undone.')
    return
  }

  const companies = Object.keys(COMPANIES).filter((c) => !onlyCompany || c === onlyCompany)
  const toCreate = []
  const skipped = []
  for (const code of companies) {
    for (const def of DEFINITIONS) {
      const id = `${code}__${slug(def.title)}`
      const exists = (await db.collection('interventions').doc(id).get()).exists
      if (exists) skipped.push(id)
      else toCreate.push({ id, data: buildDocument(code, def) })
    }
  }

  const libraryDocs = await db.collection('interventions').get()
  const patches = libraryDocs.docs
    .filter((d) => EXISTING_OUTCOMES[d.data().interventionTitle] && !d.data().outcomeDefinition && (!onlyCompany || d.data().companyCode === onlyCompany))
    .map((d) => ({ id: d.id, title: d.data().interventionTitle, outcomeDefinition: EXISTING_OUTCOMES[d.data().interventionTitle] }))

  console.log(`${toCreate.length} definitions to create, ${skipped.length} already exist, ${patches.length} existing library entries to get an outcome definition`)
  toCreate.forEach(({ id, data }) => console.log(`  + ${id.padEnd(48)} ${data.executionMode === 'multi_step' ? `multi-step (${data.steps.length} steps)` : 'single session'.padEnd(18)} | ${data.durationTerm} | ${data.isRecurring === 'yes' ? `recurs ${data.recurrence.preset}, ${data.endRule}` : 'one-off'} | ${data.deliveryStrategy} | follow-up ${data.outcomeDefinition.followUpDays || 'none'} | ${data.scopeType}`))
  patches.forEach((p) => console.log(`  ~ ${p.id} (${p.title}) gets an outcome definition`))
  if (!apply) { console.log('\nDry run. Re-run with --apply to write these.'); return }

  const batch = db.batch()
  toCreate.forEach(({ id, data }) => batch.create(db.collection('interventions').doc(id), data))
  patches.forEach((p) => batch.update(db.collection('interventions').doc(p.id), { outcomeDefinition: p.outcomeDefinition }))
  await batch.commit()
  const manifestPath = path.join(__dirname, `seed-output-definitions-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ seedTag: SEED_TAG, created: toCreate.map((x) => x.id), outcomePatched: patches.map((p) => p.id) }, null, 2))
  console.log(`\nDone. Manifest: ${manifestPath}`)
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
