const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
let saved;
const firestore = {
 doc: (_, collection, id) => ({ collection, id }),
 serverTimestamp: () => 'timestamp',
 runTransaction: async (_, callback) => callback({ get: async () => ({ exists: () => false }), set: (_, values) => { saved = values; } }),
};
const sandbox = { exports: {}, require: (id) => {
 if (id === 'firebase/firestore') return firestore;
 if (id === '@/config/firebase') return { getFirebaseDb: () => ({}) };
 if (id === '@/config/permissions') return { hasRolePermission: () => true };
 return {};
}, fetch: () => { throw Error('AI unavailable'); } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/services/operationsComplianceService.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
(async () => {
 await sandbox.exports.saveComplianceDocument({ uid: 'staff', role: 'operations' }, { participantId: 'sme', type: 'ID document', documentName: 'ID document', currentStatus: 'valid', url: 'https://example.com/id.pdf', expiryDate: undefined, issueDate: undefined, programId: undefined });
 assert.equal(saved.expiryDate, null);
 assert.equal(saved.issueDate, null);
 assert.equal(saved.programId, null);
 assert.equal(saved.currentStatus, 'pending');
 assert.equal(saved.verificationStatus, 'pending');
 assert.equal(saved.verificationComment, '');
 assert.ok(Object.values(saved).every(value => value !== undefined));
 console.log('Save regression passed: optional fields normalized, review reset, no AI request.');
})().catch(error => { console.error(error); process.exitCode = 1; });
