import assert from 'node:assert';
import { validateSelection, topoSort } from './registry.js';

// Architect+Backend together, nothing pre-existing — the flagship demo path.
const r1 = validateSelection(['architect', 'backend'], new Set());
assert.strictEqual(r1.valid, true, 'architect+backend together should be valid');
assert.deepStrictEqual(r1.order, ['architect', 'backend'], 'architect must be ordered before backend');

// Backend alone, nothing pre-existing — must fail (no architect anywhere).
const r2 = validateSelection(['backend'], new Set());
assert.strictEqual(r2.valid, false, 'backend alone with no prior architect should be invalid');
assert.ok(r2.errors.some((e) => e.role === 'backend'));

// Backend alone, but architect already ran in an EARLIER job (this chat) — must pass.
// This is the "come back later and add an agent" requirement.
const r3 = validateSelection(['backend'], new Set(['architect']));
assert.strictEqual(r3.valid, true, 'backend alone should be valid once architect already exists in the chat');

// Frontend requires BOTH uiux and backend — missing one should fail.
const r4 = validateSelection(['frontend'], new Set(['uiux']));
assert.strictEqual(r4.valid, false, 'frontend needs uiux AND backend, only uiux present should fail');
const r5 = validateSelection(['frontend'], new Set(['uiux', 'backend']));
assert.strictEqual(r5.valid, true, 'frontend should pass once both uiux and backend exist');

// uiux requires pm OR architect (OR-group) — either alone should satisfy it.
assert.strictEqual(validateSelection(['uiux'], new Set(['pm'])).valid, true, 'uiux satisfied by pm alone');
assert.strictEqual(validateSelection(['uiux'], new Set(['architect'])).valid, true, 'uiux satisfied by architect alone');
assert.strictEqual(validateSelection(['uiux'], new Set()).valid, false, 'uiux fails with neither pm nor architect');

// The whole graph selected at once, from nothing, must be satisfiable and correctly ordered.
const all = ['pm', 'architect', 'uiux', 'backend', 'frontend', 'qa', 'docs'];
const r6 = validateSelection(all, new Set());
assert.strictEqual(r6.valid, true, 'selecting all 7 from scratch should be valid');
const pos = (role) => r6.order.indexOf(role);
assert.ok(pos('pm') < pos('architect') || pos('architect') < pos('pm') === false || true); // pm has no hard order vs architect
assert.ok(pos('architect') < pos('backend'), 'architect before backend');
assert.ok(pos('backend') < pos('frontend') && pos('uiux') < pos('frontend'), 'backend and uiux before frontend');
assert.ok(pos('backend') < pos('qa'), 'backend before qa');
assert.ok(pos('docs') === r6.order.length - 1 || all.every((r) => r === 'docs' || pos(r) < pos('docs')), 'docs last');

// Unknown role name is rejected cleanly, not silently ignored.
const r7 = validateSelection(['not-a-real-role'], new Set());
assert.strictEqual(r7.valid, false);
assert.ok(r7.errors[0].detail.includes('unknown agent role'));

// docs requires at least ONE other role — zero prior artifacts and docs alone should fail.
assert.strictEqual(validateSelection(['docs'], new Set()).valid, false, 'docs alone with nothing else should fail');
assert.strictEqual(validateSelection(['docs'], new Set(['pm'])).valid, true, 'docs satisfied by any single prior role');

// topoSort never drops or duplicates a requested role.
const sorted = topoSort(['docs', 'pm', 'backend', 'architect']);
assert.deepStrictEqual([...sorted].sort(), ['architect', 'backend', 'docs', 'pm'].sort());
assert.strictEqual(sorted.length, 4);

console.log('registry.selftest.mjs — all 13 checks passed');
