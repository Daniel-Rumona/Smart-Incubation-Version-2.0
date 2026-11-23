// Run with: node --test src/services/growthLadder.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateLadder, ladderHistory, quarterEnds, quartersOnStep, stepsGained, type LadderMonth } from './growthLadder.ts'

const months = (entries: Record<string, [number, number?]>): LadderMonth[] =>
    Object.entries(entries).map(([month, [revenue, jobs]]) => ({ month, revenue, jobs }))

test('nothing reported is step 0', () => {
    assert.equal(evaluateLadder({ months: [], opportunities: [] }, '2026-11-18').rung, 0)
})

test('reporting needs 3 of the last 4 completed months, not the running one', () => {
    const input = { months: months({ '2026-11': [10], '2026-10': [10], '2026-09': [10] }), opportunities: [] }
    // November is still running, so only Oct and Sep count: 2 of 4.
    assert.equal(evaluateLadder(input, '2026-11-18').steps.reporting, false)
    input.months.push({ month: '2026-08', revenue: 0 })
    assert.equal(evaluateLadder(input, '2026-11-18').steps.reporting, true)
})

test('selling needs revenue in 2 of the last 3 months', () => {
    const input = { months: months({ '2026-10': [0], '2026-09': [500], '2026-08': [0], '2026-07': [0] }), opportunities: [] }
    const result = evaluateLadder(input, '2026-11-18')
    assert.equal(result.steps.reporting, true)
    assert.equal(result.steps.selling, false)
    assert.equal(result.rung, 1)
})

test('growing compares the last 3 months with the same 3 months half a year earlier', () => {
    const base = { '2026-10': [1200], '2026-09': [1100], '2026-08': [1000], '2026-04': [1000], '2026-03': [1000], '2026-02': [1000] } as Record<string, [number]>
    assert.equal(evaluateLadder({ months: months(base), opportunities: [] }, '2026-11-18').steps.growing, true)
    const flat = { ...base, '2026-10': [1000], '2026-09': [1000], '2026-08': [1000] } as Record<string, [number]>
    assert.equal(evaluateLadder({ months: months(flat), opportunities: [] }, '2026-11-18').steps.growing, false)
})

test('more jobs than half a year earlier also counts as growing', () => {
    const input = { months: months({ '2026-10': [1000, 6], '2026-09': [1000, 6], '2026-08': [1000], '2026-04': [1000, 4] }), opportunities: [] }
    assert.equal(evaluateLadder(input, '2026-11-18').steps.growing, true)
})

test('steps are cumulative: winning work without growth stays on the lower step', () => {
    const input = {
        months: months({ '2026-10': [1000], '2026-09': [1000], '2026-08': [1000] }),
        opportunities: [{ stage: 'awarded', submittedAt: '2026-10-01' }],
    }
    const result = evaluateLadder(input, '2026-11-18')
    assert.equal(result.steps.winning, true)
    assert.equal(result.steps.growing, false)
    assert.equal(result.rung, 2)
})

test('the top step needs every step below it', () => {
    const input = {
        months: months({ '2026-10': [1500, 5], '2026-09': [1400, 5], '2026-08': [1300, 5], '2026-04': [1000, 3], '2026-03': [1000], '2026-02': [1000] }),
        opportunities: [{ stage: 'submitted', submittedAt: '2026-10-20' }, { stage: 'awarded', submittedAt: '2026-03-01' }],
    }
    assert.equal(evaluateLadder(input, '2026-11-18').rung, 5)
})

test('in the market only counts submissions in the last 90 days, not ones still being prepared', () => {
    const preparing = { months: [], opportunities: [{ stage: 'preparing', submittedAt: '2026-11-01' }] }
    assert.equal(evaluateLadder(preparing, '2026-11-18').steps.market, false)
    const old = { months: [], opportunities: [{ stage: 'submitted', submittedAt: '2026-07-01' }] }
    assert.equal(evaluateLadder(old, '2026-11-18').steps.market, false)
    // A submission after the as-at date doesn't count for that date.
    const future = { months: [], opportunities: [{ stage: 'submitted', submittedAt: '2026-12-01' }] }
    assert.equal(evaluateLadder(future, '2026-11-18').steps.market, false)
})

test('quarter ends run from the joining quarter to the last finished quarter', () => {
    assert.deepEqual(quarterEnds('2026-02-10', '2026-11-18'), ['2026-03-31', '2026-06-30', '2026-09-30'])
    assert.deepEqual(quarterEnds('2026-10-05', '2026-11-18'), [])
})

test('history gives steps gained and quarters on the current step', () => {
    // Reporting from June: step 1 at end of Q3, nothing at end of Q2.
    const input = { months: months({ '2026-06': [0], '2026-07': [0], '2026-08': [0], '2026-09': [0], '2026-10': [0] }), opportunities: [] }
    const history = ladderHistory(input, '2026-04-01', '2026-11-18')
    assert.deepEqual(history.map(point => point.rung), [0, 1, 1])
    assert.equal(stepsGained(history), 1)
    assert.equal(quartersOnStep(history), 2)
})
