// node --test scripts/test-prospects.cjs (after `npm --prefix functions run build`)
const test = require('node:test')
const assert = require('node:assert')
const p = require('../functions/lib/prospects.js')

test('contact details compare in one form', () => {
  assert.strictEqual(p.phoneKey('082 123 4567'), '+27821234567')
  assert.strictEqual(p.phoneKey('+27 82 123 4567'), '+27821234567')
  assert.strictEqual(p.phoneKey('0027821234567'), '+27821234567')
  assert.strictEqual(p.phoneKey('27821234567'), '+27821234567')
  assert.strictEqual(p.phoneKey('821234567'), '+27821234567')
  assert.strictEqual(p.phoneKey('+90 532 123 4567'), '+905321234567')
  assert.strictEqual(p.phoneKey('123'), '')
  assert.strictEqual(p.emailKey(' Thabo@Example.CO.ZA '), 'thabo@example.co.za')
  assert.strictEqual(p.emailKey('not an email'), '')
  assert.strictEqual(p.registrationKey('2019/123456/07'), '2019123456 07'.replace(' ', ''))
})

test('same business: shared phone, email or registration number; name only when asked', () => {
  const keys = p.keysOf({ phone: '082 123 4567', email: 'a@b.co.za' })
  assert.ok(p.sameBusiness(keys, { keys: { phone: '+27821234567' } }))
  assert.ok(p.sameBusiness(keys, { keys: { email: 'a@b.co.za' } }))
  assert.ok(!p.sameBusiness(keys, { keys: { phone: '+27820000000' } }))
  assert.ok(!p.sameBusiness(p.keysOf({}), { keys: { phone: '', email: '' } }), 'empty keys never match')
  assert.ok(p.sameBusiness(p.keysOf({}), { businessName: 'Marula  Logistics' }, 'marula logistics', true))
  assert.ok(!p.sameBusiness(p.keysOf({}), { businessName: 'Marula Logistics' }, 'marula logistics', false))
})

test('a sign-up only moves a prospect forward', () => {
  assert.ok(p.isAdvance('incubation', 'contacted', 'applied'))
  assert.ok(p.isAdvance('incubation', 'lost', 'applied'), 'a lost prospect who signs up has come back')
  assert.ok(!p.isAdvance('incubation', 'joined', 'applied'))
  assert.ok(!p.isAdvance('incubation', 'applied', 'applied'))
  assert.ok(p.isAdvance('training', 'proposal', 'client'))
})

test('funnel: furthest stage reached counts, even after a prospect was lost', () => {
  const prospects = [
    { id: 'a', source: 'event', status: 'joined' },
    { id: 'b', source: 'event', status: 'lost' },        // was invited before it was lost
    { id: 'c', source: 'event', status: 'new' },
    { id: 'd', source: 'referral', status: 'contacted' },
  ]
  const rows = p.funnelCounts('incubation', prospects, new Map([['b', 2]]))
  const all = rows.find((row) => row.source === 'all')
  const event = rows.find((row) => row.source === 'event')
  assert.deepStrictEqual(all, { source: 'all', reached: 4, engaged: 3, invited: 2, converted: 1, conversionPct: 25 })
  assert.deepStrictEqual(event, { source: 'event', reached: 3, engaged: 2, invited: 2, converted: 1, conversionPct: 33 })
  assert.strictEqual(rows[0].source, 'all')
})

test('retention: archive after 12 months untouched, anonymise 30 days later; converted prospects are kept', () => {
  const now = new Date('2027-06-01T00:00:00Z')
  assert.strictEqual(p.retentionStep({ createdAt: '2027-01-01T00:00:00Z' }, now), 'keep')
  assert.strictEqual(p.retentionStep({ createdAt: '2026-01-01T00:00:00Z', statusChangedAt: '2026-05-01T00:00:00Z' }, now), 'archive')
  assert.strictEqual(p.retentionStep({ createdAt: '2026-01-01T00:00:00Z', statusChangedAt: '2027-05-01T00:00:00Z' }, now), 'keep', 'recent activity keeps it')
  assert.strictEqual(p.retentionStep({ createdAt: '2026-01-01T00:00:00Z', archivedAt: '2027-05-20T00:00:00Z', archiveReason: 'retention' }, now), 'keep', 'inside the restore window')
  assert.strictEqual(p.retentionStep({ createdAt: '2026-01-01T00:00:00Z', archivedAt: '2027-04-01T00:00:00Z', archiveReason: 'retention' }, now), 'anonymise')
  assert.strictEqual(p.retentionStep({ createdAt: '2027-03-01T00:00:00Z', archivedAt: '2027-04-01T00:00:00Z' }, now), 'keep', 'archived by staff but still recent')
  assert.strictEqual(p.retentionStep({ createdAt: '2025-01-01T00:00:00Z', convertedAt: '2025-03-01T00:00:00Z' }, now), 'keep')
  assert.strictEqual(p.retentionStep({ createdAt: '2025-01-01T00:00:00Z', anonymisedAt: '2026-03-01T00:00:00Z' }, now), 'keep')
  assert.strictEqual(p.ANONYMISED_FIELDS.phone, '')
  assert.strictEqual(p.ANONYMISED_FIELDS.email, '')
})

test('who may see the funnel counts', () => {
  assert.ok(p.canSeeFunnel({ role: 'operations', companyCode: 'UGH' }, 'UGH'))
  assert.ok(!p.canSeeFunnel({ role: 'operations', companyCode: 'DEMO' }, 'UGH'))
  assert.ok(p.canSeeFunnel({ role: 'funder', companyCode: 'UGH' }, 'UGH'))
  assert.ok(p.canSeeFunnel({ role: 'funder', funderCompanyCodes: ['UGH'] }, 'UGH'))
  assert.ok(!p.canSeeFunnel({ role: 'incubatee', companyCode: 'UGH' }, 'UGH'))
  assert.ok(!p.canSeeFunnel({ role: 'learner', companyCode: 'UGH' }, 'UGH'))
})

test('the system emails a prospect only with consent, and never a test address', () => {
  assert.ok(p.mayEmail({ email: 'owner@business.co.za', consent: { contactAllowed: true } }))
  assert.ok(!p.mayEmail({ email: 'owner@business.co.za', consent: { contactAllowed: false } }))
  assert.ok(!p.mayEmail({ email: 'sme@demo.test', consent: { contactAllowed: true } }))
  assert.ok(!p.mayEmail({ email: '', consent: { contactAllowed: true } }))
})

test('a funder sees only the prospects tied to what it funds', () => {
  assert.ok(p.inScope('incubation', { programId: 'prog-a' }, null), 'staff: the whole company')
  assert.ok(p.inScope('incubation', { programId: 'prog-a' }, { programIds: ['prog-a'] }))
  assert.ok(!p.inScope('incubation', { programId: 'prog-b' }, { programIds: ['prog-a'] }))
  assert.ok(!p.inScope('incubation', {}, { programIds: ['prog-a'] }), 'no programme: not this funder\'s')
  assert.ok(p.inScope('training', { bookedClassId: 'class-1' }, { classIds: ['class-1'] }))
  assert.ok(!p.inScope('training', { bookedClassId: 'class-2' }, { classIds: ['class-1'] }))
  assert.ok(!p.inScope('training', {}, { classIds: [] }), 'a funder with nothing funded sees nothing')
})

test('per event: reached, converted and the income from the clients it brought', () => {
  const prospects = [
    { id: 'a', source: 'event', sourceDetail: 'Mining Summit', status: 'client', businessName: 'Karoo Solar' },
    { id: 'b', source: 'event', sourceDetail: 'mining summit', status: 'proposal', businessName: 'Sishen' },
    { id: 'c', source: 'referral', sourceDetail: 'Kgalagadi', status: 'client', businessName: 'Kalahari Water' },
    { id: 'd', source: 'website', sourceDetail: '', status: 'client', businessName: 'No event' },
  ]
  const revenue = [
    { organisation: 'Karoo  Solar', amount: 60000, status: 'paid' },
    { organisation: 'Karoo Solar', amount: 15000, status: 'invoiced' },
    { organisation: 'Karoo Solar', amount: 9999, status: 'cancelled' },
    { organisation: 'Kalahari Water', amount: 4500, status: 'paid' },
  ]
  const rows = p.eventCounts('training', prospects, new Map(), revenue)
  assert.deepStrictEqual(rows.map((row) => [row.event, row.reached, row.converted, row.conversionPct, row.revenue]), [
    ['Mining Summit', 2, 1, 50, 75000],
    ['Kgalagadi', 1, 1, 100, 4500],
  ])
  assert.strictEqual(p.eventCounts('incubation', [{ id: 'x', source: 'event', sourceDetail: 'Expo', status: 'joined' }], new Map())[0].revenue, null)
})
