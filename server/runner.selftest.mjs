import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { rm, mkdir, writeFile } from 'node:fs/promises';
import {
  detectModuleFormat,
  injectHealthRoute,
  injectPortEnv,
  injectMongoUri,
  identifyFailingFile,
  pickProbeEndpoint,
  fillPathParams,
  writeGeneratedTree,
  installDeps,
  runBootCheck,
} from './runner.js';
import { resolveStack } from './stacks.js';
import { sha256 } from './kernel/store.js';

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

// fillPathParams: regression for a live FastAPI run where the architect wrote
// `/books/{book_id}` (OpenAPI/FastAPI's own syntax) — the probe left the literal `{book_id}`
// in the URL and got a 422 instead of the declared 404 until this covered `{id}` too.
assert.strictEqual(fillPathParams('/books/{book_id}'), '/books/1', 'should fill OpenAPI/FastAPI {param} placeholders');
assert.strictEqual(fillPathParams('/projects/<int:project_id>/tasks'), '/projects/1/tasks', 'should fill Django <type:name> converters');
assert.strictEqual(fillPathParams('/x/:id/y/{z}/<w>'), '/x/1/y/1/1', 'should fill a mix of all three param syntaxes');

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

// Regression: a stale-but-hash-matching `.pact-deps-hash` marker must NOT skip install for
// a non-Node stack. Live evidence: chat 39b42410's Django boot-check directory is reused
// across backend jobs (agents/backend.js always points at the same `<chat>/boot-check`
// path); an EARLIER job's successful install left a marker whose hash matched a LATER
// job's unchanged requirements.txt, install was skipped on that basis, and `manage.py
// migrate` failed with `ModuleNotFoundError: No module named 'django'` even though a
// manual `py -m pip install` in that exact directory succeeded immediately afterward —
// nothing was actually missing that a real install call wouldn't have caught. Node's
// node_modules existence check is a real, per-directory, physically-verifiable marker;
// nothing analogous exists for a shared interpreter, so non-Node stacks must always run
// the (idempotent, fast-when-satisfied) install rather than trust a hash alone.
const pyDir = path.join(os.tmpdir(), `pact-runner-selftest-py-${Date.now()}`);
try {
  await mkdir(pyDir, { recursive: true });
  const reqContent = 'pip\n'; // always-satisfied — this checks the SKIP decision, not pip itself
  await writeFile(path.join(pyDir, 'requirements.txt'), reqContent, 'utf8');
  // Plant a marker as if some earlier, unrelated job already "succeeded" in this directory.
  await writeFile(path.join(pyDir, '.pact-deps-hash'), sha256(reqContent), 'utf8');
  const pyStack = resolveStack({ stack: { default: 'python', db: 'sqlite', api: 'fastapi' } });
  const pyInstall = await installDeps(pyDir, { timeoutMs: 60_000, stack: pyStack });
  assert.strictEqual(pyInstall.skipped, false, 'a matching hash marker must not skip install for a non-Node stack');
  console.log('runner.selftest.mjs — non-Node stacks never trust a stale deps-hash marker');
} finally {
  await rm(pyDir, { recursive: true, force: true }).catch(() => {});
}

console.log('runner.selftest.mjs — all checks passed');
