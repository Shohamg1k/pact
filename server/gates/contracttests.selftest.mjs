import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { buildContractTestPlan, runContractTests } from './contracttests.js';
import { writeGeneratedTree, installDeps, startMemoryMongo, killTree } from '../runner.js';
import { spawn } from 'node:child_process';
import net from 'node:net';

// --- pure plan-building checks (no I/O) ---------------------------------------------------

const contract = {
  meta: { schema: 'arch-contract/v1', id: 'PACT-test', completeness_score: 0.9 },
  stack: { default: 'MERN', db: 'mongodb', api: 'express' },
  features: [{ id: 'F-01', name: 'Reports', priority: 'must' }],
  assumptions: [],
  business_rules: ['BR-01: report released only after payment'],
  collections: [],
  apis: [
    { id: 'API-01', feature_id: 'F-01', method: 'GET', path: '/reports/:id', errors: [403], rules: ['403 until paid_at set — BR-01'] },
    { id: 'API-02', feature_id: 'F-01', method: 'POST', path: '/bookings', errors: [409], rules: [] },
  ],
};

const plan = buildContractTestPlan(contract);
assert.strictEqual(plan.length, 3, 'one declared_status test per api + one business_rule test for API-01');
const declared = plan.filter((t) => t.kind === 'declared_status');
assert.strictEqual(declared.length, 2);
assert.deepStrictEqual(declared[0].declaredErrors, [403]);
const ruleTests = plan.filter((t) => t.kind === 'business_rule');
assert.strictEqual(ruleTests.length, 1);
assert.strictEqual(ruleTests[0].expectedStatus, 403);
assert.strictEqual(ruleTests[0].path, '/reports/000000000000000000000001', 'path param should be filled with a placeholder');

console.log('contracttests.selftest.mjs — plan-building checks passed');

// --- real end-to-end: run the plan against a live server ---------------------------------

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const manifest = {
  meta: { schema: 'backend/v1', runId: 'selftest', contractHash: 'sha256:x' },
  modules: [
    {
      path: 'server.js',
      kind: 'entry',
      implements: ['API-01', 'API-02'],
      language: 'js',
      code: [
        "const express = require('express');",
        'const app = express();',
        'app.use(express.json());',
        // Fresh DB has no paid reports — the guard must fire for ANY id.
        "app.get('/reports/:id', (req, res) => res.status(403).json({ error: 'payment pending' }));",
        "app.post('/bookings', (req, res) => res.status(201).json({ ok: true }));",
        'app.listen(process.env.PACT_RUNNER_PORT || 3000);',
        '',
      ].join('\n'),
    },
  ],
  server_entry: 'server.js',
  package_json: { name: 'contracttests-selftest-backend', dependencies: { express: '^4.19.2' } },
  gaps: [],
};

const generatedDir = path.join(os.tmpdir(), `pact-contracttests-selftest-${Date.now()}`);
let child;
let mongo;

try {
  await writeGeneratedTree(generatedDir, manifest);
  await installDeps(generatedDir, { timeoutMs: 120_000 });
  mongo = await startMemoryMongo();
  const port = await getFreePort();
  child = spawn(process.execPath, [path.join(generatedDir, 'server.js')], {
    cwd: generatedDir,
    env: { ...process.env, PACT_RUNNER_PORT: String(port), MONGO_URI: mongo.uri },
  });
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 15_000;
    (async function poll() {
      while (Date.now() < deadline) {
        try {
          await fetch(`http://127.0.0.1:${port}/bookings`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
          return resolve();
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      reject(new Error('server never came up'));
    })();
  });

  const report = await runContractTests(contract, `http://127.0.0.1:${port}`);
  assert.strictEqual(report.total, 3);
  assert.strictEqual(report.passed, 3, `expected all 3 to pass: ${JSON.stringify(report.results, null, 1)}`);
  assert.strictEqual(report.failed, 0);
  console.log('contracttests.selftest.mjs — real live run: 3/3 passed, including the 403 business-rule guard');

  // A deliberately non-compliant server (always 200) should surface RED tests, not throw.
  const badReport = await runContractTests(contract, 'http://127.0.0.1:1'); // nothing listens here
  assert.ok(badReport.failed > 0, 'unreachable server should produce failed (not thrown) results');
  assert.ok(badReport.results.every((r) => r.error), 'each result should carry the transport error');
  console.log('contracttests.selftest.mjs — unreachable server reported as red, not thrown (Q2: reporting, not blocking)');
} finally {
  if (child) await killTree(child.pid);
  if (mongo) await mongo.stop();
  await rm(generatedDir, { recursive: true, force: true }).catch(() => {});
}

console.log('contracttests.selftest.mjs — all checks passed');
