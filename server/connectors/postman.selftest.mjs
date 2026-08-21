import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { buildPostmanCollection, exportPostman } from './postman.js';

const contract = {
  meta: { schema: 'arch-contract/v1', id: 'PACT-postman-test', completeness_score: 0.9 },
  stack: { default: 'MERN', db: 'mongodb', api: 'express' },
  features: [{ id: 'F-01', name: 'Bookings', priority: 'must' }],
  assumptions: [],
  business_rules: [],
  collections: [{ id: 'C-01', name: 'bookings', fields: ['status'] }],
  apis: [
    { id: 'API-01', feature_id: 'F-01', method: 'POST', path: '/bookings', request: { start_at: 'string' }, errors: [409], rules: ['BR-01'] },
    { id: 'API-02', feature_id: 'F-01', method: 'GET', path: '/bookings', errors: [], rules: [] },
  ],
};

const collection = buildPostmanCollection(contract, { baseUrl: 'http://127.0.0.1:4300' });
assert.strictEqual(collection.item.length, 2);
assert.strictEqual(collection.variable[0].value, 'http://127.0.0.1:4300');
assert.strictEqual(collection.item[0].request.method, 'POST');
assert.ok(collection.item[0].request.body.raw.includes('start_at'), 'POST item should carry a sample body from api.request');
assert.strictEqual(collection.item[1].request.body, undefined, 'GET item with no api.request should have no body');
console.log('postman.selftest.mjs — buildPostmanCollection checks passed');

const outputDir = path.join(os.tmpdir(), `pact-postman-selftest-${Date.now()}`);
try {
  const result = await exportPostman(outputDir, contract, { baseUrl: 'http://127.0.0.1:4300' });
  assert.strictEqual(result.files.length, 2);
  assert.strictEqual(result.apiCount, 2);

  const openapi = await readFile(path.join(outputDir, 'openapi.yaml'), 'utf8');
  assert.ok(openapi.includes('/bookings'), 'openapi.yaml should list the declared path');

  const written = JSON.parse(await readFile(path.join(outputDir, 'postman_collection.json'), 'utf8'));
  assert.strictEqual(written.item.length, 2);
  console.log('postman.selftest.mjs — real file export (openapi.yaml + postman_collection.json) passed');
} finally {
  await rm(outputDir, { recursive: true, force: true }).catch(() => {});
}

console.log('postman.selftest.mjs — all checks passed');
