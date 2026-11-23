// node --experimental-strip-types --test scripts/test-prospect-utils.mjs
import test from 'node:test'
import assert from 'node:assert'
import { contactKeys, emailKey, phoneKey, registrationKey, sharedKeys } from '../src/utils/contactKeys.ts'
import { mapColumns, parseTable, readProspects } from '../src/utils/prospectImport.ts'

test('contact keys match the server (functions/src/prospects.ts)', () => {
  assert.strictEqual(phoneKey('082 123 4567'), '+27821234567')
  assert.strictEqual(phoneKey('+27 (82) 123-4567'), '+27821234567')
  assert.strictEqual(phoneKey('12'), '')
  assert.strictEqual(emailKey('A@B.CO.ZA'), 'a@b.co.za')
  assert.strictEqual(registrationKey('2019/123456/07'), '201912345607')
  const a = contactKeys({ phone: '0821234567', email: 'x@y.co.za' })
  assert.deepStrictEqual(sharedKeys(a, contactKeys({ phone: '+27821234567' })), ['phone'])
  assert.deepStrictEqual(sharedKeys(contactKeys({}), contactKeys({})), [], 'empty never matches')
})

test('CSV with quotes, commas and line breaks inside cells', () => {
  const rows = parseTable('\uFEFFName,Business,Notes\r\n"Dlamini, Sipho",Marula Logistics,"said ""call me""\nnext week"\r\n')
  assert.deepStrictEqual(rows, [['Name', 'Business', 'Notes'], ['Dlamini, Sipho', 'Marula Logistics', 'said "call me"\nnext week']])
})

test('cells pasted from Excel (tabs) and semicolon CSV', () => {
  assert.deepStrictEqual(parseTable('Name\tPhone\nThabo\t082 000 0000'), [['Name', 'Phone'], ['Thabo', '082 000 0000']])
  assert.deepStrictEqual(parseTable('Name;Phone\nThabo;0820000000'), [['Name', 'Phone'], ['Thabo', '0820000000']])
})

test('common column names are recognised', () => {
  assert.deepStrictEqual(mapColumns(['Full Name', 'Company Name', 'Cell Phone', 'E-mail', 'Province', 'Something else']), {
    contactName: 0, businessName: 1, phone: 2, email: 3, province: 4,
  })
})

test('rows become businesses or people; rows without a name are skipped', () => {
  const { rows, skipped } = readProspects('Name,Business,Phone\nLerato,Kgalagadi Mining,0821112222\nThabo,,0823334444\n,,0825556666')
  assert.deepStrictEqual(rows.map((row) => [row.kind, row.businessName || row.contactName]), [['business', 'Kgalagadi Mining'], ['person', 'Thabo']])
  assert.strictEqual(skipped, 1)
})

test('incubation takes businesses only: a row without a business name is left out', () => {
  const sheet = 'Name,Business,Phone\nLerato,Kgalagadi Mining,0821112222\nThabo,,0823334444'
  const incubation = readProspects(sheet, false)
  assert.deepStrictEqual(incubation.rows.map((row) => row.businessName), ['Kgalagadi Mining'])
  assert.strictEqual(incubation.skipped, 1)
  assert.strictEqual(readProspects(sheet, true).rows.length, 2, 'training keeps the person')
})
