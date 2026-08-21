// Deterministic slice of D4's coverage — the parts that don't need a real model call.
// happy-path / vague-brief / failover are proven live (T15 rehearsal), not here: they
// spawn real CLI adapters and can take minutes, which is exactly what a selftest must not
// do (PRD P6, and this repo's own "every fix gets a selftest where it's deterministic, and
// a live run where it isn't").
import assert from 'node:assert';
import { SCENARIOS, driftRejection } from './index.js';

const expectedNames = ['happy-path', 'vague-brief', 'failover', 'drift-rejection'];
assert.deepStrictEqual(Object.keys(SCENARIOS).sort(), [...expectedNames].sort(), 'SCENARIOS must expose exactly the four D4 scenarios');
for (const name of expectedNames) {
  assert.strictEqual(typeof SCENARIOS[name], 'function', `SCENARIOS['${name}'] must be a function`);
}

// drift-rejection is fully deterministic (T5's own test method: inject implements: []) —
// runnable here for real, no model, no network.
const result = await driftRejection();
assert.ok(Array.isArray(result.errors) && result.errors.length > 0, 'driftRejection should report at least one DRIFT_REJECTED error');
assert.ok(result.errors.every((e) => e.code === 'DRIFT_REJECTED'), 'every reported error should be DRIFT_REJECTED');
assert.ok(result.errors.some((e) => e.subject_id === 'routes/loyalty.js'), 'should name the injected file');

console.log('fixtures/index.selftest.mjs — all checks passed');
