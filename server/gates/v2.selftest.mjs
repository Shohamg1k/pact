import assert from 'node:assert';
import { runGateV2, checkDrift, checkConformance, pruneInvalidModules } from './v2.js';

const contract = {
  meta: { schema: 'arch-contract/v1', id: 'PACT-test', completeness_score: 0.9 },
  stack: { default: 'MERN', db: 'mongodb', api: 'express' },
  features: [{ id: 'F-01', name: 'Book a test', priority: 'must' }],
  assumptions: [],
  business_rules: ['BR-01: report released only after payment'],
  collections: [{ id: 'C-01', name: 'bookings', fields: ['slot_id unique', 'status'] }],
  apis: [{ id: 'API-01', feature_id: 'F-01', method: 'POST', path: '/bookings', errors: [409], rules: ['BR-01'] }],
};

const goodBackend = {
  meta: { schema: 'backend/v1', runId: 'r1', contractHash: 'sha256:x' },
  modules: [
    { path: 'models/Booking.js', kind: 'model', implements: ['C-01'], code: 'module.exports = {};\n', language: 'js' },
    {
      path: 'routes/bookings.js',
      kind: 'route',
      implements: ['API-01', 'BR-01'],
      code: "const router = require('express').Router();\nrouter.post('/bookings', (req, res) => { res.json({}); });\nmodule.exports = router;\n",
      language: 'js',
    },
  ],
  server_entry: 'server.js',
  package_json: { name: 'gen', dependencies: { express: '^5.0.0' } },
  gaps: [],
};

const r1 = await runGateV2(contract, goodBackend);
assert.strictEqual(r1.valid, true, 'well-formed backend should pass Gate V2');

// DRIFT_REJECTED — empty implements[]
const driftEmpty = { ...goodBackend, modules: [...goodBackend.modules, { path: 'routes/loyalty.js', kind: 'route', implements: [], code: 'x=1;\n', language: 'js' }] };
const driftEmptyErrors = checkDrift(contract, driftEmpty);
assert.ok(driftEmptyErrors.some((e) => e.code === 'DRIFT_REJECTED' && e.subject_id === 'routes/loyalty.js'), 'empty implements[] should be DRIFT_REJECTED');

// DRIFT_REJECTED — unknown id
const driftUnknown = { ...goodBackend, modules: [...goodBackend.modules, { path: 'routes/fake.js', kind: 'route', implements: ['API-99'], code: 'x=1;\n', language: 'js' }] };
const driftUnknownErrors = checkDrift(contract, driftUnknown);
assert.ok(driftUnknownErrors.some((e) => e.code === 'DRIFT_REJECTED' && e.subject_id === 'routes/fake.js'), 'unknown id should be DRIFT_REJECTED');

// CONFORMANCE_MISMATCH — declared API has no matching route in code
const noRoute = { ...goodBackend, modules: goodBackend.modules.filter((m) => m.kind !== 'route') };
const confErrors = checkConformance(contract, noRoute);
assert.ok(confErrors.some((e) => e.code === 'CONFORMANCE_MISMATCH' && e.subject_id === 'API-01'), 'missing route should be CONFORMANCE_MISMATCH');

// Tier 1 short-circuits: unparseable code should fail before drift/conformance run
const brokenSyntax = { ...goodBackend, modules: [{ path: 'routes/bad.js', kind: 'route', implements: ['API-01'], code: 'function foo( {\n', language: 'js' }] };
const tierResult = await runGateV2(contract, brokenSyntax);
assert.strictEqual(tierResult.valid, false);
assert.strictEqual(tierResult.tier, 1, 'syntax errors should surface as tier 1');
assert.ok(tierResult.errors.every((e) => e.code === 'TIER1_PARSE_FAIL'));

// pruneInvalidModules drops exactly the named drift module, keeps the rest
const pruned = pruneInvalidModules(driftEmpty, driftEmptyErrors);
assert.ok(pruned, 'should produce a pruned candidate');
assert.strictEqual(pruned.backend.modules.length, driftEmpty.modules.length - 1);
assert.ok(!pruned.backend.modules.some((m) => m.path === 'routes/loyalty.js'));
assert.ok(pruned.gaps[0].includes('DRIFT_REJECTED'));

console.log('v2.selftest.mjs — all 7 checks passed');
