// Run after `npm --prefix functions run build` with node --test functions/tests/funderOrganisations.test.cjs.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  funderNameKey, isLookalikeName, canManageProgrammeFunders, isFunderOrgMember, canReuseAccountAsOrgFunder,
  nextLinkStatus, funderAccessFromLinks, strongerLinkStatus, funderLinkId, toFunderOrgType,
} = require('../lib/funderOrganisations.js')

const throwsCode = (fn, code) => assert.throws(fn, (error) => error.code === code)

test('name keys ignore case, punctuation and filler words', () => {
  assert.equal(funderNameKey('Green Futures Fund'), 'greenfutures')
  assert.equal(funderNameKey('The Green-Futures Foundation (Pty) Ltd'), 'greenfutures')
  assert.equal(funderNameKey('  '), '')
  // A name made only of filler words still has a key.
  assert.equal(funderNameKey('The Foundation'), 'thefoundation')
})

test('lookalike names are caught, different funders are not', () => {
  assert.equal(isLookalikeName('Green Futures Fund', 'Green Futures Foundation'), true)
  assert.equal(isLookalikeName('National Youth Development Agency', 'National Youth Developement Agency'), true)
  assert.equal(isLookalikeName('Absa', 'Absa Foundation'), true)
  assert.equal(isLookalikeName('Green Futures Fund', 'Blue Horizon Trust'), false)
  assert.equal(isLookalikeName('IDC', 'NEF'), false)
  assert.equal(isLookalikeName('', 'Anything'), false)
})

test('only the programme company\'s director or project admin (or a system admin) manage its funders', () => {
  const programme = { companyCode: 'RCM' }
  assert.equal(canManageProgrammeFunders({ role: 'director', companyCode: 'RCM' }, programme), true)
  assert.equal(canManageProgrammeFunders({ role: 'projectadmin', companyCode: 'RCM' }, programme), true)
  assert.equal(canManageProgrammeFunders({ role: 'systemadmin' }, programme), true)
  assert.equal(canManageProgrammeFunders({ role: 'director', companyCode: 'OTHER' }, programme), false)
  assert.equal(canManageProgrammeFunders({ role: 'operations', companyCode: 'RCM' }, programme), false)
  assert.equal(canManageProgrammeFunders({ role: 'funder', companyCode: 'RCM' }, programme), false)
  assert.equal(canManageProgrammeFunders({ role: 'systemadmin' }, { companyCode: '' }), false)
})

test('organisation membership needs the funder role, the organisation and no company', () => {
  assert.equal(isFunderOrgMember({ role: 'funder', funderOrgId: 'org1' }, 'org1'), true)
  assert.equal(isFunderOrgMember({ role: 'funder', funderOrgId: 'org1', companyCode: 'RCM' }, 'org1'), false)
  assert.equal(isFunderOrgMember({ role: 'funder', funderOrgId: 'org2' }, 'org1'), false)
  assert.equal(isFunderOrgMember({ role: 'director', funderOrgId: 'org1' }, 'org1'), false)
  assert.equal(isFunderOrgMember({ role: 'funder', funderOrgId: '' }, ''), false)
  assert.equal(canReuseAccountAsOrgFunder(null, 'org1'), false)
  assert.equal(canReuseAccountAsOrgFunder({ role: 'funder', companyCode: 'RCM' }, 'org1'), false)
  assert.equal(canReuseAccountAsOrgFunder({ role: 'funder', funderOrgId: 'org1' }, 'org1'), true)
})

test('links need both sides: the implementor requests, the funder accepts once confirmed', () => {
  assert.equal(nextLinkStatus(null, 'request', 'implementor', 'confirmed'), 'pending')
  assert.equal(nextLinkStatus('declined', 'request', 'implementor', 'confirmed'), 'pending')
  assert.equal(nextLinkStatus('removed', 'request', 'systemadmin', 'invited'), 'pending')
  throwsCode(() => nextLinkStatus('pending', 'request', 'implementor', 'confirmed'), 'already-exists')
  throwsCode(() => nextLinkStatus(null, 'request', 'funder', 'confirmed'), 'permission-denied')

  assert.equal(nextLinkStatus('pending', 'accept', 'funder', 'confirmed'), 'active')
  assert.equal(nextLinkStatus('pending', 'decline', 'funder', 'invited'), 'declined')
  throwsCode(() => nextLinkStatus('pending', 'accept', 'funder', 'invited'), 'failed-precondition')
  throwsCode(() => nextLinkStatus('pending', 'accept', 'implementor', 'confirmed'), 'permission-denied')
  throwsCode(() => nextLinkStatus('pending', 'accept', 'systemadmin', 'confirmed'), 'permission-denied')
  throwsCode(() => nextLinkStatus('active', 'accept', 'funder', 'confirmed'), 'failed-precondition')

  assert.equal(nextLinkStatus('active', 'remove', 'funder', 'confirmed'), 'removed')
  assert.equal(nextLinkStatus('pending', 'remove', 'implementor', 'confirmed'), 'removed')
  throwsCode(() => nextLinkStatus('declined', 'remove', 'implementor', 'confirmed'), 'failed-precondition')
  throwsCode(() => nextLinkStatus('pending', 'accept', 'funder', 'merged'), 'failed-precondition')
})

test('access comes only from active links of a confirmed organisation', () => {
  const links = [
    { status: 'active', programId: 'p2', companyCode: 'B' },
    { status: 'active', programId: 'p1', companyCode: 'A' },
    { status: 'active', programId: 'p1', companyCode: 'A' },
    { status: 'pending', programId: 'p3', companyCode: 'C' },
    { status: 'declined', programId: 'p4', companyCode: 'D' },
    { status: 'removed', programId: 'p5', companyCode: 'E' },
    { status: 'active', programId: '', companyCode: 'F' },
  ]
  assert.deepEqual(funderAccessFromLinks(links, 'confirmed'), { funderProgramIds: ['p1', 'p2'], funderCompanyCodes: ['A', 'B'] })
  assert.deepEqual(funderAccessFromLinks(links, 'invited'), { funderProgramIds: [], funderCompanyCodes: [] })
  assert.deepEqual(funderAccessFromLinks(links, 'merged'), { funderProgramIds: [], funderCompanyCodes: [] })
  assert.deepEqual(funderAccessFromLinks([], 'confirmed'), { funderProgramIds: [], funderCompanyCodes: [] })
})

test('merging keeps the link further along, and ids and types are stable', () => {
  assert.equal(strongerLinkStatus('pending', 'active'), 'active')
  assert.equal(strongerLinkStatus('active', 'declined'), 'active')
  assert.equal(strongerLinkStatus('removed', 'pending'), 'pending')
  assert.equal(funderLinkId('prog1', 'org1'), 'prog1_org1')
  assert.equal(toFunderOrgType('government'), 'government')
  assert.equal(toFunderOrgType('bank'), 'other')
})

test('unanswered requests expire after LINK_REQUEST_DAYS and can be asked again', () => {
  const { isExpiredRequest, LINK_REQUEST_DAYS } = require('../lib/funderOrganisations.js')
  const now = new Date('2026-12-31T00:00:00Z')
  const day = 24 * 60 * 60 * 1000
  assert.equal(isExpiredRequest({ status: 'pending', requestedAt: now.getTime() - (LINK_REQUEST_DAYS + 1) * day }, now), true)
  assert.equal(isExpiredRequest({ status: 'pending', requestedAt: { toMillis: () => now.getTime() - (LINK_REQUEST_DAYS - 1) * day } }, now), false)
  assert.equal(isExpiredRequest({ status: 'active', requestedAt: 0 }, now), false)
  assert.equal(isExpiredRequest({ status: 'pending', requestedAt: null }, now), false)
  assert.equal(nextLinkStatus('expired', 'request', 'implementor', 'confirmed'), 'pending')
  throwsCode(() => nextLinkStatus('expired', 'accept', 'funder', 'confirmed'), 'failed-precondition')
})

test('colleagues are added by members of a confirmed organisation', () => {
  const { canInviteFunderColleague } = require('../lib/funderOrganisations.js')
  const member = { role: 'funder', funderOrgId: 'org1' }
  assert.equal(canInviteFunderColleague(member, 'org1', 'confirmed'), true)
  assert.equal(canInviteFunderColleague(member, 'org1', 'invited'), false)
  assert.equal(canInviteFunderColleague(member, 'org2', 'confirmed'), false)
  assert.equal(canInviteFunderColleague({ role: 'systemadmin' }, 'org1', 'confirmed'), true)
  assert.equal(canInviteFunderColleague({ role: 'director', companyCode: 'A' }, 'org1', 'confirmed'), false)
})

test('the Users page can put a funder in an organisation only as a system admin, and never with a company', () => {
  const { decideFunderOrgChange } = require('../lib/funderOrganisations.js')
  const admin = { isPlatformAdmin: true }
  assert.deepEqual(decideFunderOrgChange({ ...admin, role: 'funder', requestedOrgId: 'org1' }), { action: 'set', orgId: 'org1' })
  assert.deepEqual(decideFunderOrgChange({ ...admin, role: 'funder', requestedOrgId: 'org2', existingOrgId: 'org1', previousRole: 'funder' }), { action: 'set', orgId: 'org2' })
  // Blank or unsent keeps the organisation: a member is never turned back into a one-company funder.
  assert.deepEqual(decideFunderOrgChange({ ...admin, role: 'funder', requestedOrgId: '', existingOrgId: 'org1', previousRole: 'funder' }), { action: 'keep', orgId: 'org1' })
  assert.deepEqual(decideFunderOrgChange({ ...admin, role: 'funder', requestedOrgId: undefined, existingOrgId: 'org1' }), { action: 'keep', orgId: 'org1' })
  assert.deepEqual(decideFunderOrgChange({ ...admin, role: 'funder', requestedOrgId: 'org1', existingOrgId: 'org1' }), { action: 'keep', orgId: 'org1' })
  // Funders made the old way keep working until they're converted.
  assert.deepEqual(decideFunderOrgChange({ isPlatformAdmin: false, role: 'funder', companyCode: 'A', previousRole: 'funder' }), { action: 'keep', orgId: '' })
  // Every new funder needs an organisation, including someone given the funder role.
  throwsCode(() => decideFunderOrgChange({ ...admin, role: 'funder', companyCode: 'A' }), 'invalid-argument')
  throwsCode(() => decideFunderOrgChange({ isPlatformAdmin: false, role: 'funder', companyCode: 'A' }), 'invalid-argument')
  throwsCode(() => decideFunderOrgChange({ ...admin, role: 'funder', companyCode: 'A', previousRole: 'consultant' }), 'invalid-argument')
  // Leaving the funder role leaves the organisation.
  assert.deepEqual(decideFunderOrgChange({ ...admin, role: 'director', existingOrgId: 'org1' }), { action: 'clear', orgId: 'org1' })
  assert.deepEqual(decideFunderOrgChange({ isPlatformAdmin: false, role: 'consultant' }), { action: 'keep', orgId: '' })
  throwsCode(() => decideFunderOrgChange({ isPlatformAdmin: false, role: 'funder', requestedOrgId: 'org1' }), 'permission-denied')
  throwsCode(() => decideFunderOrgChange({ ...admin, role: 'funder', requestedOrgId: 'org1', companyCode: 'A' }), 'invalid-argument')
  throwsCode(() => decideFunderOrgChange({ ...admin, role: 'funder', existingOrgId: 'org1', companyCode: 'A' }), 'invalid-argument')
})

test('old-style funders are found and keep the programmes they see today when converted', () => {
  const { isOldStyleFunder, oldStyleProgrammeIds } = require('../lib/funderOrganisations.js')
  assert.equal(isOldStyleFunder({ role: 'funder', companyCode: 'RCM' }), true)
  assert.equal(isOldStyleFunder({ role: 'funder', companyCode: 'RCM', funderOrgId: 'org1' }), false)
  assert.equal(isOldStyleFunder({ role: 'funder', companyCode: 'RCM', funderId: 'tf1' }), false, 'training-module funders stay as they are')
  assert.equal(isOldStyleFunder({ role: 'funder' }), false)
  assert.equal(isOldStyleFunder({ role: 'director', companyCode: 'RCM' }), false)
  assert.deepEqual(oldStyleProgrammeIds(['p1', 'p2', 'p3'], ['p2', 'gone']), ['p2'])
  assert.deepEqual(oldStyleProgrammeIds(['p1', 'p2'], []), ['p1', 'p2'])
  assert.deepEqual(oldStyleProgrammeIds(['p1', 'p2'], undefined), ['p1', 'p2'])
})

test('funding amounts are rand with two decimals, and blank clears them', () => {
  const { parseFundingAmount } = require('../lib/funderOrganisations.js')
  assert.equal(parseFundingAmount(2500000), 2500000)
  assert.equal(parseFundingAmount('R 1 250 000.456'), 1250000.46)
  assert.equal(parseFundingAmount(''), null)
  assert.equal(parseFundingAmount(null), null)
  assert.equal(parseFundingAmount(0), 0)
  throwsCode(() => parseFundingAmount(-5), 'invalid-argument')
  throwsCode(() => parseFundingAmount('abc'), 'invalid-argument')
})
