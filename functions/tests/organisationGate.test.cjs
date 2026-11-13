const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../../src/components/auth/AgreementGate.tsx'), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
const gate = identity => {
  const jsx = (type, props) => ({ type, props })
  const mocks = {
    react: {}, 'react/jsx-runtime': { jsx, jsxs: jsx },
    antd: { Alert: 'Alert', Button: 'Button', Card: 'Card' },
    'react-router-dom': { Navigate: 'Navigate' },
    '@/config/agreements': { COMPANY_AGREEMENTS_VERSION: 'test' },
    '@/hooks/useFullIdentity': { useFullIdentity: () => identity },
    '@/components/shared/LoadingOverlay': { LoadingOverlay: 'Loading' },
    '@/providers/LanguageProvider': { useLanguage: () => ({ t: value => value }) },
    '@/services/agreementsService': { agreementScope: user => user.companyCode },
    '@/styles/agreements.css': {},
  }
  const exports = {}
  new Function('require', 'exports', compiled)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`)
    return mocks[name]
  }, exports)
  return exports.AgreementGate({ children: 'workspace' })
}
const user = { uid: 'test', role: 'incubatee', emailVerified: true, firstLoginComplete: true }

test('pending and rejected operators never reach consent or protected pages, even with completed onboarding', () => {
  for (const organisationAccessStatus of ['pending', 'rejected']) {
    const result = gate({ loading: false, user: { ...user, organisationAccessStatus } })
    assert.equal(result.type, 'Navigate')
    assert.equal(result.props.to, '/organisation-access')
  }
})

test('approved directors still finish onboarding before accessing the workspace', () => {
  assert.equal(gate({ loading: false, user: { ...user, role: 'director', organisationAccessStatus: 'approved', firstLoginComplete: false } }).props.to, '/welcome')
})

test('SMEs, freelancers and approved directors proceed to the blocking consent check', () => {
  for (const profile of [user, { ...user, role: 'consultant' }, { ...user, role: 'director', organisationAccessStatus: 'approved' }]) {
    const result = gate({ loading: false, user: profile })
    assert.equal(typeof result.type, 'function')
    assert.equal(result.type.name, 'VerifiedAgreements')
  }
})
