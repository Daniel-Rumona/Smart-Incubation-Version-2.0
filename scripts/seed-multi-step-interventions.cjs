#!/usr/bin/env node
/*
 * Makes the multi-step interventions in the library genuinely multi-step for the SMEs that have them in their plan.
 *
 * Plans keep a copy of each intervention's execution mode and steps (the library editor syncs it when a definition
 * changes), but the seeded plans were written before the multi-step definitions existed, so every plan item said
 * "single session" and the single seeded assignment looked like only step 1 of N. This script, for every plan item
 * whose library definition is multi_step:
 *
 *   1. sets executionMode and steps on the plan item, copied from the definition;
 *   2. turns the existing assignment into step 1 (same document, so completions that point at it still do), and
 *      adds step records only as far as the work really got, because steps are assigned one at a time:
 *        completed             -> every step done and confirmed
 *        in progress (p%)      -> the steps that p% covers are done, the next one is in progress
 *        pending               -> step 1 pending
 *        awaiting confirmation -> earlier steps done, the last one awaiting the SME
 *
 * Only seeded assignments (they carry a seedTag) are touched. Dry run by default; --apply writes and saves a
 * manifest with the original plan items and assignment fields; --undo <manifest> --apply restores them and deletes
 * the step records this script created.
 *
 *   node scripts/seed-multi-step-interventions.cjs --service-account ./scripts/new-service-account.json
 *   node scripts/seed-multi-step-interventions.cjs --service-account ./scripts/new-service-account.json --apply
 *   node scripts/seed-multi-step-interventions.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-multistep-<ts>.json --apply
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
if (!serviceAccountPath) { console.error('Usage: node scripts/seed-multi-step-interventions.cjs --service-account <file> [--apply] [--undo <manifest>]'); process.exit(1) }
admin.initializeApp({ credential: admin.credential.cert(path.resolve(serviceAccountPath)) })
const db = admin.firestore()
const { Timestamp, FieldValue } = admin.firestore
const SEED_TAG = `multistep-${Date.now()}`

const norm = (v) => String(v ?? '').trim().toLowerCase()
const slug = (v) => norm(v).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const toMillis = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN)
const at = (millis) => Timestamp.fromMillis(Math.round(millis))

const serialise = (data) => JSON.parse(JSON.stringify(data, (key, v) => (v && typeof v.toMillis === 'function' ? { __ts: v.toMillis() } : v)))
const reviveTimestamps = (value) => {
  if (Array.isArray(value)) return value.map(reviveTimestamps)
  if (value && typeof value === 'object') {
    if (typeof value.__ts === 'number') return Timestamp.fromMillis(value.__ts)
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reviveTimestamps(v)]))
  }
  return value
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
    console.log(`Undo: restore ${manifest.plans.length} plans and ${manifest.assignments.length} assignments, delete ${manifest.created.length} step records`)
    if (!apply) { console.log('Dry run. Re-run with --apply.'); return }
    await commit([
      ...manifest.created.map((id) => (batch) => batch.delete(db.collection('assignedInterventions').doc(id))),
      ...manifest.assignments.map((entry) => (batch) => batch.set(db.collection('assignedInterventions').doc(entry.id), reviveTimestamps(entry.data))),
      ...manifest.plans.map((entry) => (batch) => batch.update(db.collection('diagnosticPlans').doc(entry.id), { interventions: reviveTimestamps(entry.interventions) })),
    ])
    console.log('Undone.')
    return
  }

  const [plans, assignments, definitions] = await Promise.all(['diagnosticPlans', 'assignedInterventions', 'interventions'].map((name) => db.collection(name).get()))
  const defById = new Map(definitions.docs.map((d) => [d.id, d.data()]))
  const definitionFor = (company, item) => defById.get(`${String(company).toUpperCase()}__${item.interventionId}`) || defById.get(item.interventionId)

  // The status values a finished seeded assignment uses, so finished steps look exactly like finished assignments.
  const doneTemplate = assignments.docs.map((d) => d.data()).find((d) => norm(d.status) === 'completed' && d.seedTag)
  if (!doneTemplate) { console.error('No completed seeded assignment to copy status values from.'); process.exit(1) }
  const doneFields = Object.fromEntries(['status', 'assigneeStatus', 'participantStatus', 'assigneeCompletionStatus', 'participantCompletionStatus'].map((k) => [k, doneTemplate[k]]))

  const assignmentsByParticipant = new Map()
  assignments.docs.forEach((d) => {
    const list = assignmentsByParticipant.get(d.data().participantId) || []
    list.push(d)
    assignmentsByParticipant.set(d.data().participantId, list)
  })

  const planWrites = []
  const assignmentWrites = [] // original assignment becomes step 1
  const creates = [] // further step records
  const summary = { items: 0, byOutcome: { completed: 0, inProgress: 0, pending: 0, awaiting: 0, other: 0 } }

  plans.docs.forEach((plan) => {
    const data = plan.data()
    const items = Array.isArray(data.interventions) ? data.interventions : []
    let planChanged = false
    const nextItems = items.map((item) => {
      const definition = definitionFor(data.companyCode, item)
      const steps = Array.isArray(definition?.steps) ? definition.steps.filter((s) => s && s.title) : []
      if (definition?.executionMode !== 'multi_step' || steps.length < 2) return item
      if (item.executionMode === 'multi_step') return item
      const mine = (assignmentsByParticipant.get(data.participantId) || []).filter((d) => d.data().seedTag && (norm(d.data().interventionId) === norm(item.interventionId) || slug(d.data().interventionTitle) === slug(item.title)))
      if (mine.length !== 1) return item // only the simple seeded case: exactly one seeded assignment for it
      const original = mine[0]
      const base = original.data()
      if (base.assignedStepId) return item

      summary.items += 1
      planChanged = true
      const weights = steps.map((s) => (Number(s.weight) > 0 ? Number(s.weight) : 1))
      const totalWeight = weights.reduce((a, b) => a + b, 0)
      const status = norm(base.status).replace('_', '-')
      const progress = Math.min(100, Math.max(0, Number(base.progress) || 0))

      // How far the work got: how many steps are done, and which step is current.
      let doneCount = 0
      let current = null // { index, progress, kind }
      if (status === 'completed') { doneCount = steps.length; summary.byOutcome.completed += 1 }
      else if (status === 'awaiting-confirmation') { doneCount = steps.length - 1; current = { index: steps.length - 1, progress: 99, kind: 'awaiting' }; summary.byOutcome.awaiting += 1 }
      else if (status === 'in-progress') {
        const covered = (progress / 100) * totalWeight
        let cumulative = 0
        for (let i = 0; i < steps.length; i++) {
          if (cumulative + weights[i] <= covered + 1e-9) { cumulative += weights[i]; doneCount = i + 1 } else break
        }
        doneCount = Math.min(doneCount, steps.length - 1)
        const within = covered - weights.slice(0, doneCount).reduce((a, b) => a + b, 0)
        current = { index: doneCount, progress: Math.max(1, Math.min(99, Math.round((within / weights[doneCount]) * 100))), kind: 'in_progress' }
        summary.byOutcome.inProgress += 1
      } else if (status === 'pending') { current = { index: 0, progress, kind: 'pending' }; summary.byOutcome.pending += 1 }
      else { current = { index: 0, progress, kind: 'pending' }; summary.byOutcome.other += 1 }

      const start = toMillis(base.implementationDate) || toMillis(base.createdAt) || Date.now()
      const end = toMillis(base.dueDate) || start + 30 * 86_400_000
      const created = toMillis(base.createdAt) || start
      const slotStart = (i) => start + ((end - start) * i) / steps.length
      const slotEnd = (i) => start + ((end - start) * (i + 1)) / steps.length

      const lastIndex = current ? current.index : steps.length - 1
      const stepRecord = (index) => {
        const step = steps[index]
        const finished = index < doneCount
        const stateFields = finished ? doneFields
          : current?.kind === 'awaiting' ? { ...doneFields, status: 'awaiting_confirmation', participantCompletionStatus: 'pending', assigneeCompletionStatus: doneFields.assigneeCompletionStatus }
          : current?.kind === 'in_progress' ? { status: 'in_progress', assigneeStatus: base.assigneeStatus, participantStatus: base.participantStatus, assigneeCompletionStatus: base.assigneeCompletionStatus, participantCompletionStatus: base.participantCompletionStatus }
          : { status: base.status, assigneeStatus: base.assigneeStatus, participantStatus: base.participantStatus, assigneeCompletionStatus: base.assigneeCompletionStatus, participantCompletionStatus: base.participantCompletionStatus }
        const stepProgress = finished ? 100 : current.progress
        const record = {
          ...stateFields,
          progress: stepProgress,
          executionMode: 'multi_step',
          steps: [{ id: step.id, title: step.title, description: step.description || null, weight: step.weight || 1, status: finished ? 'completed' : stepProgress > 0 ? 'in_progress' : 'not_started' }],
          assignedStepId: step.id || null,
          assignedStepTitle: step.title,
          assignedStepDescription: step.description || null,
          stepIndex: index,
          stepNumber: index + 1,
          stepCount: steps.length,
          implementationDate: at(slotStart(index)),
          dueDate: at(slotEnd(index)),
          createdAt: at(created + (index * (Math.max(start - created, 0) + 86_400_000))),
          updatedAt: at(finished ? slotEnd(index) : Math.min(Date.now(), slotEnd(index))),
        }
        if (base.targetMetric) {
          record.targetValue = Math.max(1, Math.ceil((Number(base.targetValue) || 0) / steps.length))
          record.targetActual = finished ? record.targetValue : Math.round(record.targetValue * (stepProgress / 100))
        }
        if (finished) record.completedAt = at(slotEnd(index))
        // The follow-up result belongs to the whole intervention, so it sits on the last step.
        if (index === steps.length - 1 && base.outcomeResult) { record.outcomeResult = base.outcomeResult; record.outcomeSeedTag = base.outcomeSeedTag || null }
        return record
      }

      assignmentWrites.push({ id: original.id, original: serialise(base), patch: { ...stepRecord(0), outcomeResult: index0Outcome(base, steps.length), } })
      for (let index = 1; index <= lastIndex; index++) {
        creates.push({ data: { ...stripOutcome(base), ...stepRecord(index), seedTag: base.seedTag, multiStepSeedTag: SEED_TAG } })
      }
      return { ...item, executionMode: 'multi_step', steps: steps.map((s, i) => ({ id: s.id, title: s.title, description: s.description || null, weight: s.weight || 1 })) }
    })
    if (planChanged) planWrites.push({ id: plan.id, original: serialise(items), next: nextItems })
  })

  console.log(`Plans changed: ${planWrites.length}; multi-step interventions made real: ${summary.items}`)
  console.log('  by how far they got:', summary.byOutcome)
  console.log(`  assignments turned into step 1: ${assignmentWrites.length}; further step records created: ${creates.length}`)
  if (!apply) { console.log('\nDry run. Re-run with --apply to write these.'); return }

  const createdIds = []
  const ops = []
  planWrites.forEach((w) => ops.push((batch) => batch.update(db.collection('diagnosticPlans').doc(w.id), { interventions: w.next })))
  assignmentWrites.forEach((w) => ops.push((batch) => batch.update(db.collection('assignedInterventions').doc(w.id), { ...w.patch, multiStepSeedTag: SEED_TAG })))
  creates.forEach((w) => { const ref = db.collection('assignedInterventions').doc(); createdIds.push(ref.id); ops.push((batch) => batch.set(ref, w.data)) })
  const manifestPath = path.join(__dirname, `seed-output-multistep-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(manifestPath, JSON.stringify({ seedTag: SEED_TAG, plans: planWrites.map((w) => ({ id: w.id, interventions: w.original })), assignments: assignmentWrites.map((w) => ({ id: w.id, data: w.original })), created: createdIds }, null, 2))
  await commit(ops)
  console.log(`\nDone. Manifest: ${manifestPath}`)
})().catch((error) => { console.error('FAILED:', error.message); process.exit(1) })

// The follow-up result moves to the last step; the first step keeps it only when it is also the last.
function index0Outcome(base, stepCount) { return stepCount === 1 ? base.outcomeResult || FieldValue.delete() : FieldValue.delete() }
function stripOutcome(base) { const { outcomeResult, outcomeSeedTag, ...rest } = base; return rest }
