import assert from 'node:assert';
import { validateContract } from './validator.js';

const good = {
  meta: { schema: 'arch-contract/v1', id: 'PACT-test', completeness_score: 0.78 },
  stack: { default: 'MERN', db: 'mongodb', api: 'express' },
  features: [{ id: 'F-01', name: 'Book a test', priority: 'must' }],
  assumptions: [],
  business_rules: ['BR-01: report released only after payment'],
  collections: [{ id: 'C-01', name: 'bookings', fields: ['slot_id unique', 'status'] }],
  apis: [{ id: 'API-01', feature_id: 'F-01', method: 'POST', path: '/bookings', errors: [409], rules: [] }],
};

const r1 = validateContract(good);
assert.strictEqual(r1.valid, true, 'good contract should validate');

// FEATURE_UNCOVERED: a feature with no API citing it
const uncovered = { ...good, features: [...good.features, { id: 'F-02', name: 'Orphan feature', priority: 'should' }] };
const r2 = validateContract(uncovered);
assert.strictEqual(r2.valid, false);
assert.ok(r2.errors.some((e) => e.code === 'FEATURE_UNCOVERED' && e.subject_id === 'F-02'));

// ORPHAN_ELEMENT: an API citing a feature_id that doesn't exist
const orphan = { ...good, apis: [...good.apis, { id: 'API-99', feature_id: 'F-99', method: 'GET', path: '/loyalty', errors: [], rules: [] }] };
const r3 = validateContract(orphan);
assert.strictEqual(r3.valid, false);
assert.ok(r3.errors.some((e) => e.code === 'ORPHAN_ELEMENT' && e.subject_id === 'API-99'));

// UNDERSPECIFIED: low completeness score
const vague = { ...good, meta: { ...good.meta, completeness_score: 0.31 } };
const r4 = validateContract(vague);
assert.strictEqual(r4.valid, false);
assert.ok(r4.errors.some((e) => e.code === 'UNDERSPECIFIED'));

// SCHEMA_INVALID: missing required field
const broken = { ...good, apis: undefined };
const r5 = validateContract(broken);
assert.strictEqual(r5.valid, false);
assert.ok(r5.errors.some((e) => e.code === 'SCHEMA_INVALID'));

console.log('validator.selftest.mjs — all 5 checks passed');
