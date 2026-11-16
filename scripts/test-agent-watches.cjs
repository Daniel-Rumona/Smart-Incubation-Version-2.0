// Tests for the nightly agent watch / chaser run (functions/src/agentWatches.ts).
// Build first: `npm --prefix functions run build`, then `node --test scripts/test-agent-watches.cjs`.
const assert = require('node:assert/strict')
const test = require('node:test')
const { join } = require('node:path')

const W = require(join(__dirname, '../functions/lib/agentWatches.js'))

// ---- a small in-memory Firestore (only what agentWatches.ts uses) ----------------------------

const isSentinel = (value) => value && typeof value === 'object' && value.constructor && /FieldValue|Transform/.test(value.constructor.name)

const applyUpdate = (target, patch) => {
  for (const [key, value] of Object.entries(patch)) {
    if (isSentinel(value)) {
      // increment(n) keeps a count; serverTimestamp() becomes "now".
      const operand = value.operand ?? value._operand
      target[key] = typeof operand === 'number' ? (Number(target[key]) || 0) + operand : new Date()
    } else {
      target[key] = value
    }
  }
}

const makeDb = (data) => {
  let n = 0
  const store = (name) => (data[name] ??= {})
  const docRef = (path, id) => ({
    id,
    path: `${path}/${id}`,
    collection: (sub) => collectionRef(`${path}/${id}/${sub}`),
  })
  const collectionRef = (name, filters = [], order = null, max = Infinity) => ({
    where: (field, op, value) => collectionRef(name, [...filters, [field, op, value]], order, max),
    orderBy: (field, direction = 'asc') => collectionRef(name, filters, [field, direction], max),
    limit: (count) => collectionRef(name, filters, order, count),
    doc: (id) => docRef(name, id ?? `auto${++n}`),
    get: async () => {
      let rows = Object.entries(store(name))
        .filter(([, row]) => filters.every(([field, op, value]) => (op === '==' ? row[field] === value
          : op === '>=' ? row[field] >= value : op === '<' ? row[field] < value : false)))
      if (order) {
        const [field, direction] = order
        rows = rows.sort(([, a], [, b]) => (a[field] > b[field] ? 1 : a[field] < b[field] ? -1 : 0) * (direction === 'desc' ? -1 : 1))
      }
      return { docs: rows.slice(0, max).map(([id, row]) => ({ id, data: () => ({ ...row }), ref: docRef(name, id) })) }
    },
  })
  const resolve = (ref) => {
    const parts = ref.path.split('/')
    const id = parts.pop()
    return { bucket: store(parts.join('/')), id }
  }
  return {
    data,
    collection: (name) => collectionRef(name),
    batch: () => {
      const ops = []
      return {
        set: (ref, value) => ops.push(() => { const { bucket, id } = resolve(ref); bucket[id] = {}; applyUpdate(bucket[id], value) }),
        update: (ref, value) => ops.push(() => { const { bucket, id } = resolve(ref); applyUpdate(bucket[id], value) }),
        commit: async () => ops.forEach((op) => op()),
      }
    },
  }
}

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-11-12T04:30:00Z')
const later = (days) => new Date(NOW.getTime() + days * DAY)
const cards = (db) => Object.values(db.data.agentChatMessages || {}).map((row) => row.card)
const reminders = (db) => Object.values(db.data.notifications || {}).filter((row) => row.type === 'intervention_reminder')

// ---- chasers ---------------------------------------------------------------------------------

const chaserDb = () => makeDb({
  assignedInterventions: {
    a1: { companyCode: 'CO', interventionTitle: 'Cash Flow', businessName: 'Acme', assigneeStatus: 'pending', participantStatus: 'pending' },
    a2: { companyCode: 'CO', interventionTitle: 'Marketing', businessName: 'Beta', assigneeStatus: 'accepted', participantStatus: 'pending' },
  },
  agentWatches: {
    c1: {
      uid: 'ops1', companyCode: 'CO', kind: 'chaser', status: 'active', title: 'Get 2 approved', goal: 'accepted',
      dueAt: later(5), nudgesEach: 2, escalation: { status: 'none' },
      items: ['a1', 'a2'].map((id) => ({ assignmentId: id, title: id, participantName: 'SME', assigneeName: '', done: false, nudges: { facilitator: 0, sme: 0 }, lastNudgedAt: null })),
    },
  },
})

test('chaser nudges whoever is holding each item up, within the allowance, and reports progress', async () => {
  const db = chaserDb()
  let result = await W.runAgentWatches({ db, now: NOW })
  assert.equal(result.nudges, 3) // a1: facilitator + SME, a2: SME only
  assert.deepEqual(reminders(db).map((row) => row.recipientRoles[0]).sort(), ['consultant', 'incubatee', 'incubatee'])
  assert.ok(reminders(db).every((row) => row.source === 'agent_chaser' && row.chaserId === 'c1'))
  assert.deepEqual(cards(db).map((card) => card.type), ['chaser_progress'])
  assert.match(cards(db)[0].title, /0 of 2 accepted/)

  // The next night is too soon for another reminder: nothing is sent or posted.
  result = await W.runAgentWatches({ db, now: later(1) })
  assert.equal(result.nudges, 0)
  assert.equal(cards(db).length, 1)

  // Two days on, the second (last) reminders go out, the allowance is used up, and the agent asks once.
  result = await W.runAgentWatches({ db, now: later(2) })
  assert.equal(result.nudges, 3)
  assert.deepEqual(cards(db).map((card) => card.type), ['chaser_progress', 'chaser_progress', 'chaser_escalation'])
  const chaser = db.data.agentWatches.c1
  assert.equal(chaser.escalation.status, 'asked')
  assert.ok(chaser.escalation.messageId.startsWith('watch_c1_'))
  assert.deepEqual(chaser.items[0].nudges, { facilitator: 2, sme: 2 })

  // No reminder beyond the allowance, and no second escalation question.
  result = await W.runAgentWatches({ db, now: later(4) })
  assert.equal(result.nudges, 0)
  assert.equal(cards(db).filter((card) => card.type === 'chaser_escalation').length, 1)

  // Everything accepted: the chaser reports and stops.
  Object.assign(db.data.assignedInterventions.a1, { assigneeStatus: 'accepted', participantStatus: 'accepted' })
  db.data.assignedInterventions.a2.participantStatus = 'accepted'
  result = await W.runAgentWatches({ db, now: later(4.5) })
  assert.equal(db.data.agentWatches.c1.status, 'done')
  assert.equal(cards(db).at(-1).type, 'chaser_done')
  assert.equal(result.finished, 1)
})

test('a chaser past its deadline asks about escalating and stops', async () => {
  const db = chaserDb()
  await W.runAgentWatches({ db, now: later(6) })
  assert.equal(db.data.agentWatches.c1.status, 'expired')
  assert.equal(reminders(db).length, 0) // no reminders after the deadline
  assert.deepEqual(cards(db).map((card) => card.type), ['chaser_escalation'])
  assert.match(cards(db)[0].title, /deadline passed with 2 outstanding/)
})

test('dry run evaluates without writing', async () => {
  const db = chaserDb()
  const result = await W.runAgentWatches({ db, now: NOW, dryRun: true })
  assert.equal(result.nudges, 3)
  assert.equal(reminders(db).length, 0)
  assert.equal(db.data.agentChatMessages, undefined)
})

// ---- SME watches -----------------------------------------------------------------------------

const smeDb = () => makeDb({
  participants: {
    p1: { companyCode: 'CO', businessName: 'Acme', city: 'Rustenburg', progress: 30 },
    p2: { companyCode: 'CO', businessName: 'Beta', city: 'Rustenburg', progress: 90, growthRate: 50 },
    p3: { companyCode: 'CO', businessName: 'Gamma', city: 'Pretoria', progress: 20 },
    p4: { companyCode: 'CO', businessName: 'Delta', city: 'Rustenburg', progress: 10, participantDiscontinuedAt: '2026-01-01' },
    px: { companyCode: 'OTHER', businessName: 'Elsewhere', city: 'Rustenburg', progress: 10 },
  },
  assignedInterventions: {},
  appointments: {},
  agentWatches: {
    w1: {
      uid: 'ops1', companyCode: 'CO', kind: 'watch', status: 'active', subject: 'sme', title: 'Rustenburg high risk',
      request: 'Tell me if any Rustenburg SME goes High risk and has no session booked in the next two weeks',
      filters: { city: 'rustenburg' }, conditions: [{ type: 'risk', level: 'high' }, { type: 'no_session_within_days', days: 14 }],
      endsAt: later(90), notifiedIds: [],
    },
  },
})

test('an SME watch fires once per newly matching SME, and again if it drops out and comes back', async () => {
  const db = smeDb()
  await W.runAgentWatches({ db, now: NOW })
  assert.equal(cards(db).length, 1)
  assert.deepEqual(cards(db)[0].items.map((item) => item.label), ['Acme'])
  assert.match(cards(db)[0].items[0].detail, /High risk · no session booked in the next 14 days/)

  await W.runAgentWatches({ db, now: later(1) })
  assert.equal(cards(db).length, 1) // already told

  db.data.appointments.ap1 = { companyCode: 'CO', participantId: 'p1', status: 'scheduled', startTime: later(5) }
  await W.runAgentWatches({ db, now: later(2) })
  assert.deepEqual(db.data.agentWatches.w1.notifiedIds, [])

  db.data.appointments.ap1.status = 'cancelled'
  await W.runAgentWatches({ db, now: later(3) })
  assert.equal(cards(db).length, 2)
})

test('a watch past its end date ends with a card', async () => {
  const db = smeDb()
  db.data.agentWatches.w1.endsAt = later(-1)
  db.data.participants.p1.progress = 99
  db.data.participants.p1.growthRate = 99
  await W.runAgentWatches({ db, now: NOW })
  assert.equal(db.data.agentWatches.w1.status, 'expired')
  assert.deepEqual(cards(db).map((card) => card.type), ['watch_ended'])
})

test('cards land in the owner\'s chat and bell', async () => {
  const db = smeDb()
  await W.runAgentWatches({ db, now: NOW })
  const [message] = Object.values(db.data.agentChatMessages)
  assert.equal(message.uid, 'ops1')
  assert.equal(message.role, 'agent')
  assert.equal(message.card.watchId, 'w1')
  assert.match(message.content, /Acme/)
  const [bell] = Object.values(db.data.staffNotifications)
  assert.equal(bell.recipientUid, 'ops1')
  assert.equal(bell.type, 'agent_watch')
})

test('risk follows the director dashboard rule', () => {
  assert.equal(W.riskLevel({ progress: 50, growthRate: 30 }, []), 'medium')
  assert.equal(W.riskLevel({ progress: 70, growthRate: 45 }, []), 'low')
  assert.equal(W.riskLevel({ progress: 70, growthRate: 10 }, []), 'high')
  // No stored progress: worked out from the SME's interventions.
  // (100 + 20) / 2 = 60% progress: Medium.
  assert.equal(W.riskLevel({ growthRate: 50 }, [{ status: 'completed' }, { progress: 20 }]), 'medium')
  // Cancelled assignments count too, as on the dashboard: (100 + 0) / 2 = 50%.
  assert.equal(W.riskLevel({ growthRate: 50 }, [{ status: 'completed' }, { status: 'cancelled' }]), 'medium')
  // "45%" reads as 45, and a stored 0 stops the search (the next field is not consulted).
  assert.equal(W.riskLevel({ progress: '80%', growthRate: '50%' }, []), 'low')
  assert.equal(W.riskLevel({ progress: 0, overallProgress: 90, growthRate: 50 }, [{ progress: 50 }]), 'medium')
})

test('risk uses the newest monthly report first, like the dashboard', () => {
  const sme = { progress: 90, growthRate: 50 } // Low on its own
  assert.equal(W.riskLevel(sme, []), 'low')
  // A report with its own figures wins.
  assert.equal(W.riskLevel(sme, [], W.latestPerformanceFrom({ progress: 30, growthRate: 50 })), 'high')
  // A report without those fields reads as 0, so the stored figures are skipped for the derived ones
  // (no assignments, no revenue history: 0% progress and 0 growth).
  assert.equal(W.riskLevel(sme, [], W.latestPerformanceFrom({ revenue: 5000 })), 'high')
  // No report at all: the stored figures apply.
  assert.equal(W.riskLevel(sme, [], W.latestPerformanceFrom(undefined)), 'low')
})

test('an SME watch reads only the newest monthly report', async () => {
  const db = smeDb()
  db.data.participants.p2.progress = 90 // Low on its own figures
  db.data['monthlyPerformance/p2/history'] = {
    '2026-09': { month: '2026-09', progress: 95, growthRate: 60, createdAt: new Date('2026-10-01') },
    '2026-10': { month: '2026-10', progress: 20, growthRate: 60, createdAt: new Date('2026-11-01') },
  }
  await W.runAgentWatches({ db, now: NOW })
  assert.deepEqual(cards(db)[0].items.map((item) => item.label), ['Acme', 'Beta'])
})

// ---- reportable and completion watches -------------------------------------------------------

test('a completion watch fires once everything is complete, then stops', async () => {
  const db = makeDb({
    assignedInterventions: {
      a1: { companyCode: 'CO', interventionTitle: 'Cash Flow', businessName: 'Acme', status: 'completed' },
      a2: { companyCode: 'CO', interventionTitle: 'Marketing', businessName: 'Beta', progress: 40 },
    },
    agentWatches: { w2: { uid: 'ops1', companyCode: 'CO', kind: 'watch', status: 'active', subject: 'assignments_completed', title: 'Both done', assignmentIds: ['a1', 'a2'], endsAt: later(30) } },
  })
  await W.runAgentWatches({ db, now: NOW })
  assert.equal(cards(db).length, 0)
  db.data.assignedInterventions.a2.progress = 100
  await W.runAgentWatches({ db, now: later(1) })
  assert.equal(db.data.agentWatches.w2.status, 'done')
  assert.equal(cards(db)[0].type, 'watch_fired')
})

test('a reportable watch fires when ten SMEs completed it against ten comparable SMEs', async () => {
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
  const revenue = (lift) => Object.fromEntries(months.map((month, i) => [month, 1000 * (1 + (i >= 4 ? lift : 0))]))
  const participants = {}
  const assignedInterventions = {}
  for (let i = 0; i < 24; i++) {
    const treated = i < 12
    participants[`s${i}`] = { companyCode: 'CO', businessName: `SME ${i}`, programId: 'prog', sector: 'retail', revenueHistory: { monthly: revenue(treated ? 0.3 : 0.05) } }
    if (treated) {
      assignedInterventions[`t${i}`] = { companyCode: 'CO', participantId: `s${i}`, programId: 'prog', interventionId: 'cfp', interventionTitle: 'Cash Flow Planning',
        status: 'completed', participantCompletionStatus: 'confirmed', completedAt: new Date('2026-04-15T10:00:00Z') }
    }
  }
  const db = makeDb({
    participants, assignedInterventions, monthlyPerformance: {},
    agentWatches: { w3: { uid: 'ops1', companyCode: 'CO', kind: 'watch', status: 'active', subject: 'intervention_reportable', title: 'CFP reportable',
      interventionId: 'cfp', interventionTitle: 'Cash Flow Planning', endsAt: later(300) } },
  })
  await W.runAgentWatches({ db, now: NOW })
  assert.equal(db.data.agentWatches.w3.status, 'done')
  assert.match(cards(db)[0].title, /Cash Flow Planning now has enough data to show its impact/)
})
