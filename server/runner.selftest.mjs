import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import {
  detectModuleFormat,
  injectHealthRoute,
  injectPortEnv,
  injectMongoUri,
  identifyFailingFile,
  pickProbeEndpoint,
  writeGeneratedTree,
  installDeps,
  runBootCheck,
} from './runner.js';

// --- pure-function checks (no I/O) --------------------------------------------------------

assert.strictEqual(
  detectModuleFormat({ modules: [{ code: "const x = require('y');\nmodule.exports = x;" }] }),
  'commonjs',
  'require()/module.exports should detect as commonjs',
);
assert.strictEqual(
  detectModuleFormat({ modules: [{ code: "import express from 'express';\nexport default express;" }] }),
  'module',
  'import/export should detect as module',
);
assert.strictEqual(detectModuleFormat({ modules: [{ code: 'const x = 1;' }] }), 'commonjs', 'ambiguous code defaults to commonjs');

const withApp = "const express = require('express');\nconst app = express();\napp.listen(3000);\n";
const injected = injectHealthRoute(withApp);
assert.ok(injected.includes("app.get('/__health'"), 'should inject a /__health route after app = express()');
assert.ok(injectHealthRoute(injected) === injected, 'injection should be idempotent');

const noAppDecl = "const app = require('./app');\napp.listen(4000);\n";
const injectedFallback = injectHealthRoute(noAppDecl);
assert.ok(injectedFallback.includes("app.get('/__health'"), 'should fall back to injecting before .listen(');

const portInjected = injectPortEnv('app.listen(3000, () => {});');
assert.ok(portInjected.includes('process.env.PACT_RUNNER_PORT || 3000'), 'should rewrite a hardcoded listen port');

const uriInjected = injectMongoUri("mongoose.connect('mongodb://localhost:27017/app');");
assert.ok(uriInjected.includes('process.env.MONGO_URI ||'), 'should rewrite a hardcoded mongo uri');

const manifestForLookup = { modules: [{ path: 'routes/bookings.js', code: '' }, { path: 'server.js', code: '' }] };
assert.strictEqual(
  identifyFailingFile('Error: Cannot find module at routes/bookings.js:12', manifestForLookup),
  'routes/bookings.js',
  'should identify the failing file from stderr text',
);
assert.strictEqual(identifyFailingFile('nothing relevant here', manifestForLookup), null);

const contract = { apis: [{ id: 'API-01', method: 'POST', path: '/bookings' }, { id: 'API-02', method: 'GET', path: '/bookings/:id' }] };
const probe = pickProbeEndpoint(contract);
assert.strictEqual(probe.method, 'GET', 'should prefer a GET endpoint to avoid side effects');
assert.strictEqual(probe.path, '/bookings/1', 'should fill path params with a placeholder');

console.log('runner.selftest.mjs — pure-function checks passed');

// --- real end-to-end: write -> install -> boot -> health -> probe -> kill ----------------

const contractReal = {
  meta: { schema: 'arch-contract/v1', id: 'PACT-runner-test', completeness_score: 0.9 },
  stack: { default: 'MERN', db: 'mongodb', api: 'express' },
  features: [{ id: 'F-01', name: 'List bookings', priority: 'must' }],
  assumptions: [],
  business_rules: [],
  collections: [{ id: 'C-01', name: 'bookings', fields: ['status'] }],
  apis: [{ id: 'API-01', feature_id: 'F-01', method: 'GET', path: '/bookings', errors: [], rules: [] }],
};

const manifestReal = {
  meta: { schema: 'backend/v1', runId: 'selftest', contractHash: 'sha256:x' },
  modules: [
    {
      path: 'server.js',
      kind: 'entry',
      implements: ['API-01'],
      language: 'js',
      code: [
        "const express = require('express');",
        'const app = express();',
        "app.get('/bookings', (req, res) => res.json([{ id: 1, status: 'confirmed' }]));",
        'app.listen(3000, () => console.log("listening"));',
        '',
      ].join('\n'),
    },
  ],
  server_entry: 'server.js',
  package_json: { name: 'runner-selftest-backend', dependencies: { express: '^4.19.2' } },
  gaps: [],
};

const generatedDir = path.join(os.tmpdir(), `pact-runner-selftest-${Date.now()}`);

try {
  const written = await writeGeneratedTree(generatedDir, manifestReal);
  assert.strictEqual(written.format, 'commonjs');

  const install = await installDeps(generatedDir, { timeoutMs: 120_000 });
  assert.ok(!install.skipped, 'first install should not be skipped');
  console.log('runner.selftest.mjs — npm install OK');

  const result = await runBootCheck(generatedDir, contractReal, manifestReal, { bootTimeoutMs: 20_000 });
  assert.strictEqual(result.valid, true, `boot check should succeed: ${JSON.stringify(result.errors)}`);
  assert.ok(result.endpointProbe, 'should have probed a declared endpoint');
  assert.strictEqual(result.endpointProbe.status, 200, 'the probed GET /bookings should return 200 live');
  console.log('runner.selftest.mjs — real boot + health + endpoint probe passed:', result.endpointProbe);

  // Repair-loop cheap-path: a second install with the SAME dependencies should be skipped.
  const install2 = await installDeps(generatedDir, { timeoutMs: 120_000 });
  assert.strictEqual(install2.skipped, true, 'unchanged package.json should skip reinstall');
  console.log('runner.selftest.mjs — dep-hash skip on unchanged package.json passed');

  // A manifest whose entry throws at require-time should fail BOOT_FAIL, not hang.
  const brokenManifest = {
    ...manifestReal,
    modules: [{ ...manifestReal.modules[0], code: "throw new Error('boom at startup');\n" }],
  };
  const brokenResult = await runBootCheck(generatedDir, contractReal, brokenManifest, { bootTimeoutMs: 8_000 });
  assert.strictEqual(brokenResult.valid, false);
  assert.strictEqual(brokenResult.errors[0].code, 'BOOT_FAIL');
  console.log('runner.selftest.mjs — broken entry correctly reported as BOOT_FAIL, no hang');
} finally {
  await rm(generatedDir, { recursive: true, force: true }).catch(() => {});
}

console.log('runner.selftest.mjs — all checks passed');
