import assert from 'node:assert';
import { buildMiroBoardPlan, exportMiro } from './miro.js';

const contract = {
  meta: { schema: 'arch-contract/v1', id: 'PACT-miro-test', completeness_score: 0.9 },
  stack: { default: 'MERN', db: 'mongodb', api: 'express' },
  features: [{ id: 'F-01', name: 'Bookings', priority: 'must' }],
  assumptions: [],
  business_rules: [],
  collections: [{ id: 'C-01', name: 'bookings', fields: ['status'] }, { id: 'C-02', name: 'users', fields: ['email'] }],
  apis: [
    { id: 'API-01', feature_id: 'F-01', method: 'POST', path: '/bookings', errors: [], rules: [] },
    { id: 'API-02', feature_id: 'F-01', method: 'GET', path: '/bookings/:id', errors: [], rules: [] },
  ],
};

// --- pure layout ---------------------------------------------------------------------------
const plan = buildMiroBoardPlan(contract);
assert.strictEqual(plan.shapes.length, 3, '2 collections + 1 feature');
assert.strictEqual(plan.shapes.filter((s) => s.kind === 'collection').length, 2);
assert.strictEqual(plan.shapes.filter((s) => s.kind === 'feature').length, 1);
// F-01's APIs both mention "bookings" in their path -> should arrow to C-01 but not C-02 (users)
assert.strictEqual(plan.arrows.length, 1);
assert.strictEqual(plan.arrows[0].from, 'feature:F-01');
assert.strictEqual(plan.arrows[0].to, 'collection:C-01');
assert.ok(plan.arrows[0].label.includes('POST /bookings'));
console.log('miro.selftest.mjs — buildMiroBoardPlan checks passed');

// --- REST call sequence, mocked fetch (no real MIRO_ACCESS_TOKEN used) ---------------------
{
  const calls = [];
  const fetchMock = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/boards')) return { ok: true, json: async () => ({ id: 'board-1' }) };
    if (url.includes('/shapes')) return { ok: true, json: async () => ({ id: `shape-${calls.length}` }) };
    if (url.includes('/connectors')) return { ok: true, json: async () => ({ id: `conn-${calls.length}` }) };
    return { ok: false, status: 404, text: async () => 'not found' };
  };

  const result = await exportMiro(contract, { token: 'fake-token-not-real', fetch: fetchMock });
  assert.strictEqual(result.connector, 'miro');
  assert.strictEqual(result.shapeCount, 3);
  assert.strictEqual(result.arrowCount, 1);
  assert.strictEqual(result.url, 'https://miro.com/app/board/board-1/', 'a clickable board URL must always be returned, even when the create-board response has no viewLink');
  assert.ok(calls.some((c) => c.url.endsWith('/boards') && c.method === 'POST'), 'should create a board when no boardId given');
  assert.strictEqual(calls.filter((c) => c.url.includes('/shapes')).length, 3, 'should POST one shape per collection/feature');
  assert.strictEqual(calls.filter((c) => c.url.includes('/connectors')).length, 1, 'should POST one connector per arrow');
  console.log('miro.selftest.mjs — exportMiro REST call sequence (mocked) passed');
}

// --- missing token should fail loudly, never silently proceed ------------------------------
{
  const originalEnv = process.env.MIRO_ACCESS_TOKEN;
  delete process.env.MIRO_ACCESS_TOKEN;
  try {
    await assert.rejects(() => exportMiro(contract, {}), /MIRO_ACCESS_TOKEN/);
    console.log('miro.selftest.mjs — missing-token guard passed');
  } finally {
    if (originalEnv !== undefined) process.env.MIRO_ACCESS_TOKEN = originalEnv;
  }
}

console.log('miro.selftest.mjs — all checks passed (no real Miro API calls were ever made)');
