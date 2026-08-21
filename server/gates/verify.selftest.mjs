import assert from 'node:assert';
import { verifyArtifacts, repairFeedback } from './verify.js';

const good = [
  { path: 'routes/bookings.js', content: "export function foo() { return 1; }\n" },
  { path: 'package.json', content: '{"name":"x"}' },
];
const r1 = await verifyArtifacts(good);
assert.strictEqual(r1.ok, true, 'valid js + json should pass');
assert.strictEqual(r1.checked, 2);

const brokenJs = [{ path: 'routes/bad.js', content: 'export function foo( { return 1; }\n' }];
const r2 = await verifyArtifacts(brokenJs);
assert.strictEqual(r2.ok, false, 'unbalanced paren should fail');
assert.ok(r2.issues[0].file === 'routes/bad.js');
assert.ok(r2.issues[0].line, 'should report a line number');

const brokenJson = [{ path: 'package.json', content: '{ not valid json' }];
const r3 = await verifyArtifacts(brokenJson);
assert.strictEqual(r3.ok, false, 'malformed json should fail');

const skippable = [{ path: 'README.md', content: '# hi' }];
const r4 = await verifyArtifacts(skippable);
assert.strictEqual(r4.ok, true, 'unknown extensions are skipped, not failed');
assert.strictEqual(r4.skipped, 1);
assert.strictEqual(r4.checked, 0);

const feedback = repairFeedback(r2);
assert.ok(feedback.includes('routes/bad.js'), 'repairFeedback should name the file');

console.log('verify.selftest.mjs — all 5 checks passed');
