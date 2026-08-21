import assert from 'node:assert';
import { runGateV2, checkDrift, checkConformance, pruneInvalidModules, collectContractIds } from './v2.js';

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

// checkConformance normalizes path-param syntax across stacks (regression: a live FastAPI
// run had the architect write `{book_id}` and the generated code match it verbatim — a
// literal-string conformance check rejected perfectly conforming code).
const fastapiContract = {
  ...contract,
  stack: { default: 'FastAPI', db: 'sqlite', api: 'fastapi' },
  apis: [{ id: 'API-01', feature_id: 'F-01', method: 'GET', path: '/books/{book_id}', errors: [404], rules: [] }],
};
const fastapiBackend = {
  ...goodBackend,
  modules: [
    {
      path: 'main.py',
      kind: 'route',
      implements: ['API-01'],
      code: '@app.get("/books/{book_id}")\ndef get_book(book_id: int):\n    return {}\n',
      language: 'py',
    },
  ],
};
assert.strictEqual(checkConformance(fastapiContract, fastapiBackend).length, 0, 'FastAPI {param} path should conform to itself');

// Django regression: the URLconf carries no HTTP method (stacks.js methodInRoute: false),
// and the model wrote the param in Django's own <int:name> syntax with a DIFFERENT name
// than the contract's {name} (projectId vs project_id) -- both are live-observed shapes.
// A method-less route must match ANY contract method declared for that path, and the
// param name must not matter, only its position.
const djangoContract = {
  ...contract,
  stack: { default: 'Django', db: 'sqlite', api: 'django' },
  apis: [
    { id: 'API-01', feature_id: 'F-01', method: 'GET', path: '/api/projects/{projectId}/tasks', errors: [404], rules: [] },
    { id: 'API-02', feature_id: 'F-01', method: 'POST', path: '/api/projects/{projectId}/tasks', errors: [422], rules: [] },
  ],
};
const djangoBackend = {
  ...goodBackend,
  modules: [
    {
      path: 'tracker/urls.py',
      kind: 'route',
      implements: ['API-01', 'API-02'],
      code: "urlpatterns = [\n    path('api/projects/<int:project_id>/tasks/', views.tasks),\n]\n",
      language: 'py',
    },
  ],
};
assert.strictEqual(
  checkConformance(djangoContract, djangoBackend).length,
  0,
  'a single Django path() must satisfy both the GET and POST the contract declared for it',
);

// Negative control: the fix must not become so lenient that a genuinely wrong path passes.
const djangoWrongPath = {
  ...goodBackend,
  modules: [{ path: 'tracker/urls.py', kind: 'route', implements: ['API-01'], code: "urlpatterns = [\n    path('api/projects/<int:pk>/members/', views.members),\n]\n", language: 'py' }],
};
const wrongErrors = checkConformance({ ...djangoContract, apis: [djangoContract.apis[0]] }, djangoWrongPath);
assert.ok(
  wrongErrors.some((e) => e.code === 'CONFORMANCE_MISMATCH' && e.subject_id === 'API-01'),
  'a genuinely different path must still be rejected, not waved through by the method-agnostic match',
);

// Regression: citing a real assumption id must NOT be DRIFT_REJECTED. A live Django run
// had a settings.py citing "AS-05" (a real assumptions[] entry) get pruned as unknown-id
// drift, which took the whole app's settings module down with it.
const contractWithAssumption = { ...contract, assumptions: [{ id: 'AS-01', statement: 'single-tenant, no auth', confidence: 0.6, source: 'brief-silence' }] };
assert.ok(collectContractIds(contractWithAssumption).has('AS-01'), 'collectContractIds must include assumption ids');
const settingsBackend = {
  ...goodBackend,
  modules: [...goodBackend.modules, { path: 'app/settings.py', kind: 'config', implements: ['AS-01'], code: 'DEBUG = True\n', language: 'py' }],
};
const assumptionDriftErrors = checkDrift(contractWithAssumption, settingsBackend);
assert.ok(
  !assumptionDriftErrors.some((e) => e.subject_id === 'app/settings.py'),
  'a module citing a real assumption id must not be DRIFT_REJECTED',
);

console.log('v2.selftest.mjs — all 11 checks passed');
