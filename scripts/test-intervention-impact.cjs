const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, filename)
const dayjs = require('dayjs')
const { rankInterventionImpact } = require('../src/services/interventionImpact.ts')
const now = dayjs('2026-11-09')
const person = { id: 'sme', programId: 'p', source: {
    revenueHistory: { monthly: { '2026-04': 100, '2026-05': 100, '2026-06': 99999, '2026-07': 150, '2026-08': 50, '2026-11': 99999 } },
    headcountHistory: { monthly: { '2026-05': 4, '2026-07': 6, '2026-08': 3 } },
} }
const exposure = { interventionId: 'i', title: 'Training', participantId: 'sme', programId: 'p', completed: true, completedAt: '2026-06-10' }
const rank = (rows, lag = 0, people = [person]) => rankInterventionImpact(people, rows, lag, now)
const result = rank([exposure, exposure])[0]
assert.equal(result.smes, 1, 'Repeated steps must not double-count an SME')
assert.equal(result.revenueChange, 0, 'Completion/current months excluded; genuine zero retained')
assert.equal(result.jobsChange, -1, 'Headcount uses last report either side')
assert.equal(rank([exposure], 1)[0].revenueChange, -50, 'Lag shifts after window, not baseline')
assert.equal(rank([exposure], 12)[0].revenueChange, null, 'Missing future reports are not zero')
assert.equal(rank([{ ...exposure, programId: 'other' }]).length, 0)
assert.equal(rank([{ ...exposure, participantId: 'outside' }]).length, 0)
assert.equal(rank([exposure, { ...exposure, completed: false }]).length, 0, 'Unfinished steps excluded')
assert.equal(rank([{ ...exposure, completedAt: null }]).length, 0)
assert.equal(rank([exposure], 0, [{ ...person, source: { revenueHistory: { monthly: { '2026-05': 0, '2026-07': 50 } } } }])[0].revenueChange, null, 'Zero baseline cannot produce a percent change')
console.log('Intervention impact checks passed.')
