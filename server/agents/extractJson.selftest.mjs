import assert from 'node:assert';
import { extractJson } from './extractJson.js';

assert.deepStrictEqual(extractJson('{"a":1}'), { a: 1 }, 'raw JSON');
assert.deepStrictEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 }, 'fenced JSON');
assert.deepStrictEqual(extractJson('Here is the contract:\n\n{"a":1}\n\nLet me know!'), { a: 1 }, 'prose-wrapped JSON');
assert.strictEqual(extractJson('not json at all'), null, 'unparseable -> null');

console.log('extractJson.selftest.mjs — all 4 checks passed');
