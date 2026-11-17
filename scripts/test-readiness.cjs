// Tests for the readiness rules (src/utils/readiness.ts) and the digital twin's document moves
// (src/utils/digitalTwin.ts, src/utils/companyTwin.ts). Run: node --test scripts/test-readiness.cjs
//
// They pin the rules that once drifted: documents are matched through the platform's catalogue (the tax document's
// key is 'tax-compliance', not 'tax-clearance'), a check with no evidence lowers the score, and a check that does not
// apply is left out of it.
const assert = require('node:assert/strict')
const { readFileSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const SRC = join(__dirname, '../src')
const cache = new Map()

// Loads a TypeScript module from src/, resolving the app's '@/...' imports to src/ the same way.
const load = (file) => {
    if (cache.has(file)) return cache.get(file).exports
    const mod = new Module(file, module)
    cache.set(file, mod)
    mod.require = (id) => {
        // The rules never touch Firebase; the catalogue file imports it for a function the tests do not call.
        if (id === '@/config/firebase' || id.startsWith('firebase/')) return {}
        if (!id.startsWith('@/') && !id.startsWith('.')) return require(id)
        const base = id.startsWith('@/') ? join(SRC, id.slice(2)) : join(file, '..', id)
        const target = ['.ts', '.tsx', '/index.ts'].map((ext) => base + ext).find(existsSync)
        if (!target) throw new Error(`Cannot resolve ${id} from ${file}`)
        return load(target)
    }
    mod._compile(ts.transpileModule(readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText, file)
    return mod.exports
}

const readiness = load(join(SRC, 'utils/readiness.ts'))
const twin = load(join(SRC, 'utils/digitalTwin.ts'))
const company = load(join(SRC, 'utils/companyTwin.ts'))

const NOW = new Date('2026-11-17T10:00:00Z')
const inAYear = '2027-11-17'
const doc = (key, currentStatus = 'valid', extra = {}) => ({ key, type: key, currentStatus, expiryDate: inAYear, ...extra })
const ALL_DOCS = [doc('tax-compliance'), doc('cipc-registration'), doc('bank-confirmation')]
const sixMonths = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((period, index) => ({ period, value: 100 + index * 10 }))
const fundingGate = (result, key) => result.funding.gates.find((gate) => gate.key === key)
const assess = (input) => readiness.assessReadiness({ documents: ALL_DOCS, planItems: [], revenueMonthly: sixMonths, yearsOfTrading: 3, now: NOW, ...input })

test('the tax document counts under its catalogue key, tax-compliance', () => {
    const result = assess({})
    assert.equal(fundingGate(result, 'tax-compliance').state, 'met')
})

test('the tax document counts under its other names too (Tax clearance, Tax PIN)', () => {
    for (const name of ['Tax clearance', 'Tax PIN', 'tax-clearance']) {
        const result = assess({ documents: [doc(name), doc('cipc-registration'), doc('bank-confirmation')] })
        assert.equal(fundingGate(result, 'tax-compliance').state, 'met', name)
    }
})

test('a pending tax document is partial, not missing', () => {
    const result = assess({ documents: [doc('tax-compliance', 'pending'), doc('cipc-registration'), doc('bank-confirmation')] })
    assert.equal(fundingGate(result, 'tax-compliance').state, 'partial')
})

test('the best copy of a document decides: a verified one beats a pending one', () => {
    const result = assess({ documents: [doc('tax-compliance', 'pending'), doc('tax-compliance', 'valid'), doc('cipc-registration'), doc('bank-confirmation')] })
    assert.equal(fundingGate(result, 'tax-compliance').state, 'met')
})

test('a check with no evidence lowers the score and gets a next step', () => {
    const recorded = assess({ yearsOfTrading: 3 })
    const notRecorded = assess({ yearsOfTrading: null })
    assert.equal(fundingGate(notRecorded, 'track-record').state, 'unknown')
    assert.ok(notRecorded.funding.score < recorded.funding.score, `${notRecorded.funding.score} should be below ${recorded.funding.score}`)
    assert.ok(notRecorded.nextSteps.some((step) => step.gate.key === 'track-record' && /years of trading/i.test(step.gate.action)))
})

test('a check that does not apply is left out of the score', () => {
    // No financial, governance or pitch support in the plan: those checks do not apply, so with every other check
    // met the score is complete.
    const result = assess({})
    assert.equal(fundingGate(result, 'financial-management').notApplicable, true)
    assert.equal(result.funding.score, 100)
    assert.equal(result.funding.band, 'ready')
})

test('missing revenue history is not treated as fine', () => {
    const result = assess({ revenueMonthly: sixMonths.slice(0, 2) })
    assert.equal(fundingGate(result, 'revenue-trend').state, 'unknown')
    assert.ok(result.funding.score < 100)
})

const twinInput = (documents) => ({
    now: NOW,
    documents: documents.map((row, index) => ({ id: `d${index}`, label: twin.documentLabel(row), issuedAt: null, expiresAt: row.expiryDate ? new Date(row.expiryDate) : null, ...row })),
    plan: [],
    revenueMonthly: sixMonths,
    yearsOfTrading: 3,
})

test('the twin offers to verify a pending tax document, not to upload a second one', () => {
    const moves = twin.availableMoves(twinInput([doc('tax-compliance', 'pending'), doc('cipc-registration'), doc('bank-confirmation')]))
    const titles = moves.map((move) => move.title)
    assert.ok(titles.some((title) => /verified/.test(title) && /tax compliance/i.test(title)), titles.join(' | '))
    assert.ok(!titles.some((title) => /upload/i.test(title) && /tax/i.test(title)), titles.join(' | '))
})

test('the twin offers an upload only for a document of a kind not on file', () => {
    const moves = twin.availableMoves(twinInput([doc('tax-compliance'), doc('cipc-registration')]))
    const uploads = moves.filter((move) => /^Upload/.test(move.title)).map((move) => move.title)
    assert.ok(uploads.some((title) => /bank confirmation/i.test(title)), uploads.join(' | '))
    assert.ok(!uploads.some((title) => /tax|CIPC/i.test(title)), uploads.join(' | '))
})

test('a verified move lifts the twin to ready when it was the only gap', () => {
    const input = twinInput([doc('tax-compliance', 'pending'), doc('cipc-registration'), doc('bank-confirmation')])
    const before = twin.readinessOn(input, NOW)
    const verify = twin.availableMoves(input).find((move) => /verified/.test(move.title))
    const after = twin.readinessOn(verify.apply(input), NOW)
    assert.notEqual(before.funding.band, 'ready')
    assert.equal(after.funding.band, 'ready')
})

test('the training twin checks the documents the provider asks for, not any two', () => {
    const base = {
        now: NOW, detailsAt: NOW, learners: [], results: [], metrics: [{ period: '2026-08', revenue: 1, employees: 1 }, { period: '2026-09', revenue: 1, employees: 1 }, { period: '2026-10', revenue: 1, employees: 1 }],
        esg: null, nextClass: null, providerRate: null,
    }
    const twoUnrelated = company.companyScore({ ...base, documents: [{ key: 'proof-of-address', uploadedAt: NOW }, { key: 'id-document', uploadedAt: NOW }] })
    const required = company.companyScore({ ...base, documents: ['cipc-registration', 'b-bbee-certificate', 'tax-compliance'].map((key) => ({ key, uploadedAt: NOW })) })
    assert.ok(twoUnrelated < required, `${twoUnrelated} should be below ${required}`)
    assert.equal(required, 100)
})
