#!/usr/bin/env node
/*
 * Seeds demo SWOT analyses and follow-up outcome results so the SWOT-vs-outcome matching has something to show.
 *
 *  1. Every SME with a diagnostic plan gets SWOT items (applications/<id> and participants/<id>): `swotItems`
 *     (quadrant, text, areaOfSupport) plus the plain `swot` string lists the older screens read. Weaknesses and
 *     threats are mostly in areas the SME has interventions for, so some are resolved, some in progress and some
 *     not started; a few sit in areas with no intervention, and strengths mostly sit where no work is planned.
 *  2. Completed seeded interventions get a facilitator follow-up result (achieved / partially / not yet), and some
 *     are left unchecked so "delivered, outcome not yet checked" shows too. Only `outcomeResult` is written: no
 *     follow-up due dates, so no reminders or risk flags are created from seed data.
 *
 * Dry run by default; --apply writes and saves a manifest; --undo <manifest> --apply removes exactly what was written.
 * SMEs that already have `swotItems` are skipped, and existing `swot` lists are never overwritten.
 *
 *   node scripts/seed-swot-and-outcomes.cjs --service-account ./scripts/new-service-account.json
 *   node scripts/seed-swot-and-outcomes.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-swot-and-outcomes.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-swot-<ts>.json --apply
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
if (!serviceAccountPath) { console.error('Usage: node scripts/seed-swot-and-outcomes.cjs --service-account <file> [--apply] [--undo <manifest>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(path.resolve(serviceAccountPath)) })
const db = admin.firestore()
const { FieldValue } = admin.firestore
const SEED_TAG = `swot-outcomes-${Date.now()}`

const hash = (text) => { let h = 2166136261; for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) } return h >>> 0 }
const pick = (list, seed) => list[hash(seed) % list.length]
const pickMany = (list, count, seed) => {
  const pool = [...list]; const out = []
  for (let i = 0; i < count && pool.length; i++) out.push(pool.splice(hash(`${seed}:${i}`) % pool.length, 1)[0])
  return out
}

const AREAS = ['Governance & Leadership', 'Marketing & Sales', 'Financial Management', 'Access to Markets', 'Digital Transformation', 'Operations & Compliance']
const TEXT = {
  'Governance & Leadership': {
    weaknesses: ['No formal board or advisory structure', 'Founder makes every decision with no delegation', 'Roles and responsibilities are not documented'],
    threats: ['Key-person dependency on the founder', 'Funders expect governance the business does not yet have'],
    strengths: ['Strong, committed founder with clear vision', 'Loyal core team with low staff turnover'],
    opportunities: ['Access to experienced mentors through the programme', 'Governance upgrade would unlock investor conversations'],
  },
  'Marketing & Sales': {
    weaknesses: ['No structured sales pipeline or follow-up process', 'Weak brand presence and inconsistent messaging', 'Relies on word of mouth for all new customers'],
    threats: ['Larger competitors winning on price and visibility', 'Customers switching to cheaper online alternatives'],
    strengths: ['Loyal repeat customers and good local reputation', 'Product quality is rated highly by customers'],
    opportunities: ['Growing demand in nearby markets', 'Social media can reach new customers cheaply'],
  },
  'Financial Management': {
    weaknesses: ['No monthly management accounts or cash-flow forecast', 'Business and personal finances are mixed', 'Pricing is not based on actual costs'],
    threats: ['Late-paying customers strain cash flow', 'Rising input costs eroding margins'],
    strengths: ['Healthy gross margins on core products', 'Owner understands the cost of each product line'],
    opportunities: ['Funding readiness would open access to development finance', 'Better cost tracking could lift margins'],
  },
  'Access to Markets': {
    weaknesses: ['Sells into only one customer segment', 'No tender or procurement-readiness documents', 'No export or large-buyer relationships'],
    threats: ['Dependence on one or two large customers', 'Procurement opportunities going to better-prepared competitors'],
    strengths: ['Established relationships with local buyers', 'Competitive products for the target segment'],
    opportunities: ['Corporate supplier-development programmes are open to SMEs of this size', 'Public-sector procurement set-asides'],
  },
  'Digital Transformation': {
    weaknesses: ['Records kept on paper or loose spreadsheets', 'No website or online ordering', 'Staff have limited digital skills'],
    threats: ['Competitors are moving sales and service online', 'Cyber and data-loss risk from unmanaged devices'],
    strengths: ['Owner is comfortable with technology', 'Already takes payments digitally'],
    opportunities: ['Low-cost tools can automate invoicing and stock', 'E-commerce could double the addressable market'],
  },
  'Operations & Compliance': {
    weaknesses: ['Tax and registration documents are not up to date', 'No documented standard operating procedures', 'Inconsistent quality control'],
    threats: ['Penalties and lost contracts from non-compliance', 'Supply-chain disruption with a single supplier'],
    strengths: ['Efficient production process for current volumes', 'Good relationships with key suppliers'],
    opportunities: ['Certification would qualify the business for larger contracts', 'Process improvements could cut waste'],
  },
}

const OUTCOME_NOTES = {
  achieved: ['Facilitator confirmed the change is in place and being used.', 'Evidence reviewed on site; outcome met.', 'The SME is applying this without support.'],
  partially: ['Partly in place; the SME still needs support to apply it consistently.', 'Done for one area of the business; the rest is outstanding.'],
  not_yet: ['Delivered, but the SME has not started applying it.', 'No change observed yet; to be revisited.'],
}

const commit = async (operations) => {
  for (let i = 0; i < operations.length; i += 400) {
    const batch = db.batch()
    operations.slice(i, i + 400).forEach((run) => run(batch))
    await batch.commit()
  }
}

;(async () => {
  if (undoFile) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(undoFile), 'utf8'))
    console.log(`Undo: ${manifest.swot.length} SWOT sets and ${manifest.outcomes.length} outcome results will be removed`)
    if (!apply) { console.log('Dry run. Re-run with --apply.'); return }
    const operations = []
    manifest.swot.forEach((entry) => {
      const fields = { swotItems: FieldValue.delete(), swotSeedTag: FieldValue.delete() }
      if (entry.wroteLists) fields.swot = FieldValue.delete()
      operations.push((batch) => batch.update(db.collection(entry.collection).doc(entry.id), fields))
    })
    manifest.outcomes.forEach((entry) => operations.push((batch) => batch.update(db.collection('assignedInterventions').doc(entry.id), { outcomeResult: FieldValue.delete(), outcomeSeedTag: FieldValue.delete() })))
    await commit(operations)
    console.log('Undone.')
    return
  }

  const [plans, applications, participants, assignments] = await Promise.all(
    ['diagnosticPlans', 'applications', 'participants', 'assignedInterventions'].map((name) => db.collection(name).get()),
  )
  const applicationById = new Map(applications.docs.map((d) => [d.id, d]))
  const participantsByApplication = new Map(participants.docs.filter((d) => d.data().applicationId).map((d) => [String(d.data().applicationId), d]))

  const swotWrites = []
  plans.docs.forEach((plan) => {
    const application = applicationById.get(plan.id)
    if (!application || Array.isArray(application.data().swotItems)) return
    const planAreas = [...new Set((plan.data().interventions || []).map((item) => item.areaOfSupport).filter((area) => AREAS.includes(area)))]
    if (!planAreas.length) return
    const otherAreas = AREAS.filter((area) => !planAreas.includes(area))
    const seed = plan.id
    const items = []
    const add = (quadrant, area, n) => { const text = pick(TEXT[area][quadrant], `${seed}:${quadrant}:${area}:${n}`); if (!items.some((i) => i.text === text)) items.push({ quadrant, text, areaOfSupport: area }) }

    pickMany(planAreas, Math.min(2, planAreas.length), `${seed}:w`).forEach((area, n) => add('weaknesses', area, n))
    // About one SME in four also has a weakness no intervention covers, so the "not planned" state is visible.
    if (otherAreas.length && hash(`${seed}:gap`) % 4 === 0) add('weaknesses', pick(otherAreas, `${seed}:gapArea`), 9)
    pickMany(planAreas, 1, `${seed}:t`).forEach((area, n) => add('threats', area, n))
    if (otherAreas.length && hash(`${seed}:tgap`) % 3 === 0) add('threats', pick(otherAreas, `${seed}:tgapArea`), 9)
    // One strength where the SME gets no support (stays as is) and one where it does (so "strengthened" can show).
    pickMany(otherAreas.length ? otherAreas : planAreas, 1, `${seed}:s`).forEach((area, n) => add('strengths', area, n))
    pickMany(planAreas, 1, `${seed}:sp`).forEach((area, n) => add('strengths', area, 5 + n))
    pickMany(planAreas, 1, `${seed}:o`).forEach((area, n) => add('opportunities', area, n))

    const lists = { strengths: [], weaknesses: [], opportunities: [], threats: [] }
    items.forEach((item) => lists[item.quadrant].push(item.text))
    swotWrites.push({ collection: 'applications', id: application.id, items, lists, hadLists: Boolean(application.data().swot) })
    const participant = participantsByApplication.get(plan.id)
    if (participant && !Array.isArray(participant.data().swotItems)) swotWrites.push({ collection: 'participants', id: participant.id, items, lists, hadLists: Boolean(participant.data().swot) })
  })

  // Follow-up results on completed seeded interventions: ~55% achieved, 15% partially, 10% not yet, 20% unchecked.
  const outcomeWrites = []
  const tally = { achieved: 0, partially: 0, not_yet: 0, unchecked: 0 }
  assignments.docs.forEach((doc) => {
    const data = doc.data()
    if (!data.seedTag || data.status !== 'completed' || data.outcomeResult) return
    const roll = hash(`${doc.id}:outcome`) % 100
    const result = roll < 55 ? 'achieved' : roll < 70 ? 'partially' : roll < 80 ? 'not_yet' : null
    if (!result) { tally.unchecked += 1; return }
    tally[result] += 1
    const completed = data.completedAt?.toDate?.() || data.updatedAt?.toDate?.() || new Date()
    const recordedAt = new Date(completed.getTime() + 21 * 86_400_000)
    outcomeWrites.push({
      id: doc.id,
      outcomeResult: {
        result,
        note: pick(OUTCOME_NOTES[result], doc.id),
        recordedAt: recordedAt.toISOString(),
        recordedBy: { uid: 'seed-facilitator', name: 'Demo facilitator', role: 'consultant' },
        via: 'web',
        evidenceMechanism: 'facilitator_observation',
        confidence: 'facilitator_verified',
      },
    })
  })

  const perQuadrant = swotWrites.filter((w) => w.collection === 'applications').flatMap((w) => w.items).reduce((acc, i) => { acc[i.quadrant] = (acc[i.quadrant] || 0) + 1; return acc }, {})
  console.log(`SWOT: ${swotWrites.filter((w) => w.collection === 'applications').length} SMEs (applications) + ${swotWrites.filter((w) => w.collection === 'participants').length} participants`, perQuadrant)
  console.log(`Outcome results on completed seeded interventions: ${outcomeWrites.length}`, tally, '(unchecked ones are left without a result on purpose)')
  const sample = swotWrites.find((w) => w.collection === 'applications')
  if (sample) console.log('Sample:', JSON.stringify(sample.items, null, 1))
  if (!apply) { console.log('\nDry run. Re-run with --apply to write these.'); return }

  await commit([
    ...swotWrites.map((w) => (batch) => batch.update(db.collection(w.collection).doc(w.id), {
      swotItems: w.items,
      swotSeedTag: SEED_TAG,
      ...(w.hadLists ? {} : { swot: w.lists }),
    })),
    ...outcomeWrites.map((w) => (batch) => batch.update(db.collection('assignedInterventions').doc(w.id), { outcomeResult: w.outcomeResult, outcomeSeedTag: SEED_TAG })),
  ])
  const manifestPath = path.join(__dirname, `seed-output-swot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({
    seedTag: SEED_TAG,
    swot: swotWrites.map((w) => ({ collection: w.collection, id: w.id, wroteLists: !w.hadLists })),
    outcomes: outcomeWrites.map((w) => ({ id: w.id })),
  }, null, 2))
  console.log(`\nDone. Manifest: ${manifestPath}`)
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })
