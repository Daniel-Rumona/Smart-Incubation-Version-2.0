const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, '../src/services/matchedImpactLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const MONTHS = Array.from({ length: 18 }, (_, i) => L.addMonths('2025-06', i))

// Revenue that grows `growth` per month from `base`, with an extra `jump` from `jumpAt` on.
const series = ({ base = 100, growth = 0, jump = 0, jumpAt = null }) => Object.fromEntries(
    MONTHS.map((month, i) => [month, base * (1 + growth * i) * (jumpAt && month >= jumpAt ? 1 + jump : 1)])
)
const sme = (id, opts = {}) => ({ id, programId: 'p1', sector: opts.sector || 'retail', synthetic: !!opts.synthetic, values: series(opts) })
const treat = (participantId, month, extra = {}) => ({
    participantId, programId: 'p1', interventionId: 'iv1', interventionTitle: 'Cash Flow Planning', month, outcome: null, ...extra
})

test('addMonths crosses year ends', () => {
    assert.equal(L.addMonths('2025-11', 3), '2026-02')
    assert.equal(L.addMonths('2026-01', -1), '2025-12')
})

test('a 20% jump after completion shows as about +20 points over flat comparison SMEs', () => {
    const treated = Array.from({ length: 10 }, (_, i) => sme(`t${i}`, { base: 100 + i * 10, jump: 0.2, jumpAt: '2026-01' }))
    const controls = Array.from({ length: 10 }, (_, i) => sme(`c${i}`, { base: 100 + i * 10 }))
    const result = L.measureIntervention('p1', 'iv1', [...treated, ...controls], treated.map(s => treat(s.id, '2025-12')))
    assert.equal(result.status, 'reportable')
    assert.equal(result.treatedCount, 10)
    assert.equal(result.comparisonCount, 10)
    assert.equal(result.liftPercent, 20)
    assert.equal(result.comparisonChangePercent, 0)
    assert.ok(result.headline.startsWith('Cash Flow Planning: linked to revenue growth 20 percentage points above similar SMEs'))
})

test('growth the whole cohort shares is not credited to the intervention', () => {
    const treated = Array.from({ length: 10 }, (_, i) => sme(`t${i}`, { growth: 0.05 }))
    const controls = Array.from({ length: 10 }, (_, i) => sme(`c${i}`, { growth: 0.05 }))
    const result = L.measureIntervention('p1', 'iv1', [...treated, ...controls], treated.map(s => treat(s.id, '2025-12')))
    assert.ok(Math.abs(result.liftPercent) < 0.5, `lift ${result.liftPercent}`)
    assert.match(result.headline, /no clear difference/)
})

test('SMEs given it later serve as the comparison until they get it', () => {
    const early = Array.from({ length: 6 }, (_, i) => sme(`e${i}`, { jump: 0.3, jumpAt: '2025-12' }))
    const late = Array.from({ length: 6 }, (_, i) => sme(`l${i}`, { jump: 0.3, jumpAt: '2026-09' }))
    const treatments = [...early.map(s => treat(s.id, '2025-11')), ...late.map(s => treat(s.id, '2026-08'))]
    const result = L.measureIntervention('p1', 'iv1', [...early, ...late], treatments)
    // The late group compares the early group; the late group's own window runs past the data.
    assert.equal(result.treatedCount, 6)
    assert.equal(result.comparisonCount, 6)
    assert.equal(result.treatedWithoutData, 6)
    assert.equal(result.status, 'early')
    assert.equal(result.headline, null)
})

test('small groups are insufficient and never get a headline', () => {
    const treated = [sme('t1', { jump: 0.5, jumpAt: '2026-01' }), sme('t2', { jump: 0.5, jumpAt: '2026-01' })]
    const result = L.measureIntervention('p1', 'iv1', [...treated, sme('c1'), sme('c2')], treated.map(s => treat(s.id, '2025-12')))
    assert.equal(result.status, 'insufficient')
    assert.equal(result.headline, null)
})

test('comparison SMEs come from the same sector when there are enough', () => {
    const treated = Array.from({ length: 4 }, (_, i) => sme(`t${i}`, { sector: 'agri', jump: 0.1, jumpAt: '2026-01' }))
    const agri = Array.from({ length: 4 }, (_, i) => sme(`a${i}`, { sector: 'agri' }))
    const retail = Array.from({ length: 4 }, (_, i) => sme(`r${i}`, { sector: 'retail', jump: 1, jumpAt: '2026-01' }))
    const result = L.measureIntervention('p1', 'iv1', [...treated, ...agri, ...retail], treated.map(s => treat(s.id, '2025-12')))
    assert.equal(result.matching.programme, 0)
    assert.equal(result.liftPercent, 10)
})

test('splits the lift by check-back outcome and flags demo data and overlap', () => {
    const achieved = Array.from({ length: 4 }, (_, i) => sme(`a${i}`, { jump: 0.3, jumpAt: '2026-01', synthetic: true }))
    const notYet = Array.from({ length: 4 }, (_, i) => sme(`n${i}`, {}))
    const controls = Array.from({ length: 6 }, (_, i) => sme(`c${i}`, {}))
    const treatments = [
        ...achieved.map(s => treat(s.id, '2025-12', { outcome: 'achieved' })),
        ...notYet.map(s => treat(s.id, '2025-12', { outcome: 'not_yet' })),
        { ...treat('a0', '2026-01'), interventionId: 'iv2', interventionTitle: 'Record Keeping' }
    ]
    const result = L.measureIntervention('p1', 'iv1', [...achieved, ...notYet, ...controls], treatments)
    assert.equal(result.byOutcome.achieved.liftPercent, 30)
    assert.equal(result.byOutcome.notAchieved.liftPercent, 0)
    assert.equal(result.demo, true)
    assert.equal(result.overlapShare, 0.1)
})

test('the range is reproducible and brackets the mean', () => {
    const values = [5, 12, 30, -4, 18, 22, 9, 15, 11, 7]
    const a = L.resampleRange(values, 1000, 7)
    assert.deepEqual(a, L.resampleRange(values, 1000, 7))
    const average = values.reduce((s, v) => s + v, 0) / values.length
    assert.ok(a[0] < average && average < a[1])
})

test('measureAll covers each programme and intervention once', () => {
    const smes = [sme('a'), { ...sme('b'), programId: 'p2' }]
    const treatments = [treat('a', '2025-12'), { ...treat('b', '2025-12'), programId: 'p2' }, treat('a', '2026-03')]
    assert.equal(L.measureAll(smes, treatments).length, 2)
})

// Head count: a flat team of `base` that hires `hires` people from `hireAt` on.
const team = (id, { base = 4, hires = 0, hireAt = null } = {}) => ({
    id, programId: "p1", sector: "retail", synthetic: false,
    values: Object.fromEntries(MONTHS.map(month => [month, base + (hireAt && month >= hireAt ? hires : 0)]))
})

test("jobs are measured as jobs per SME, not a percentage", () => {
    const treated = Array.from({ length: 10 }, (_, i) => team(`t${i}`, { base: 3 + (i % 3), hires: 2, hireAt: "2026-01" }))
    const controls = Array.from({ length: 10 }, (_, i) => team(`c${i}`, { base: 3 + (i % 3) }))
    const result = L.measureIntervention("p1", "iv1", [...treated, ...controls], treated.map(s => treat(s.id, "2025-12")), undefined, "jobs")
    assert.equal(result.metric, "jobs")
    assert.equal(result.unit, "jobs")
    assert.equal(result.status, "reportable")
    assert.equal(result.liftPercent, 2)
    assert.ok(result.headline.startsWith("Cash Flow Planning: linked to 2 more jobs per SME than similar SMEs"), result.headline)
    // Every SME hired the same two people, so there is no spread to quote, and all completed in one month.
    assert.ok(result.headline.includes("completing it in Dec 2025)"), result.headline)
    assert.ok(!result.headline.includes("likely range"), result.headline)
})

test("jobs can be measured from a zero baseline", () => {
    const treated = Array.from({ length: 5 }, (_, i) => team(`t${i}`, { base: 0, hires: 1, hireAt: "2026-01" }))
    const controls = Array.from({ length: 5 }, (_, i) => team(`c${i}`, { base: 0 }))
    const result = L.measureIntervention("p1", "iv1", [...treated, ...controls], treated.map(s => treat(s.id, "2025-12")), undefined, "jobs")
    assert.equal(result.treatedCount, 5)
    assert.equal(result.liftPercent, 1)
})

test("revenue results say which measure they are", () => {
    const result = L.measureIntervention("p1", "iv1", [sme("a")], [treat("a", "2025-12")])
    assert.equal(result.metric, "revenue")
    assert.equal(result.unit, "points")
})

test("a range that crosses zero is reported as no clear difference", () => {
    const result = {
        programId: "p1", interventionId: "iv1", interventionTitle: "Business Record Keeping", metric: "jobs", unit: "jobs",
        status: "reportable", liftPercent: 0.4, rangeLowPercent: -0.1, rangeHighPercent: 0.8,
        treatedCount: 10, comparisonCount: 14, period: { from: "2025-12", to: "2026-04" }
    }
    const line = L.impactHeadline(result)
    assert.ok(line.startsWith("Business Record Keeping: linked to no clear difference in jobs against similar SMEs"), line)
    assert.ok(line.includes("likely range -0.1 to +0.8 jobs"), line)
    assert.ok(L.impactHeadline({ ...result, rangeLowPercent: 0.1 }).includes("0.4 more jobs per SME"))
})
