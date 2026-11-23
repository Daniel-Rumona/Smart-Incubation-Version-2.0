// node --test scripts/test-test-addresses.cjs (after `npm --prefix functions run build`)
const test = require('node:test')
const assert = require('node:assert')
const { isReservedTestAddress } = require('../functions/lib/testAddresses.js')

test('demo and seed addresses are never mailed', () => {
  for (const email of ['operations@demo-incubator.test', 'SME@Ubuntu-Growth.TEST', 'a@example.com', 'b@mail.example.org', 'c@foo.example', 'd@x.invalid', 'e@localhost']) {
    assert.strictEqual(isReservedTestAddress(email), true, email)
  }
})

test('real addresses are mailed', () => {
  for (const email of ['keletso@taunamagadi.co.za', 'someone@gmail.com', 'x@testing.co.za', 'y@example-company.co.za', 'z@mytest.com', '', null, 'no-at-sign']) {
    assert.strictEqual(isReservedTestAddress(email), false, String(email))
  }
})
