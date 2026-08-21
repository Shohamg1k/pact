import assert from 'node:assert';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readProjectMemory, recordProjectMemory, renderProjectMemory } from './memory.js';

const FILE = path.resolve(process.cwd(), '.pact', 'project-memory.json');
const PROJECT = `__selftest_${Date.now()}`;

// Snapshot whatever was already on disk so this test never clobbers real project memory.
const before = existsSync(FILE) ? await readFile(FILE, 'utf8') : null;

try {
  assert.strictEqual(await readProjectMemory(null), null, 'unnamed project has no memory');
  assert.strictEqual(await readProjectMemory(PROJECT), null, 'new project starts with no memory');

  const contract1 = {
    stack: { default: 'MERN', db: 'mongodb', api: 'express' },
    assumptions: [{ id: 'AS-01', statement: 'no auth needed', confidence: 0.6 }],
  };
  await recordProjectMemory(PROJECT, 'run-1', contract1);
  const m1 = await readProjectMemory(PROJECT);
  assert.deepStrictEqual(m1.stackPreference, contract1.stack);
  assert.strictEqual(m1.decisions.length, 1);
  assert.deepStrictEqual(m1.runs, ['run-1']);

  // A second run appends and dedupes rather than overwriting.
  const contract2 = {
    stack: { default: 'MERN', db: 'mongodb', api: 'express' },
    assumptions: [
      { id: 'AS-01', statement: 'no auth needed', confidence: 0.6 }, // duplicate
      { id: 'AS-02', statement: 'single tenant', confidence: 0.8 },
    ],
  };
  await recordProjectMemory(PROJECT, 'run-2', contract2);
  const m2 = await readProjectMemory(PROJECT);
  assert.strictEqual(m2.decisions.length, 2, 'dedupes identical decisions across runs');
  assert.deepStrictEqual(m2.runs, ['run-1', 'run-2']);

  const rendered = renderProjectMemory(m2);
  assert.ok(rendered.includes('AS-02'));
  assert.strictEqual(renderProjectMemory(null), null);

  console.log('memory.selftest.mjs — all 7 checks passed');
} finally {
  // Clean up: remove only this test's key, restore the file to its prior state otherwise.
  if (before === null) {
    await rm(FILE, { force: true });
  } else {
    const all = JSON.parse(before);
    delete all[PROJECT];
    const current = JSON.parse(await readFile(FILE, 'utf8'));
    delete current[PROJECT];
    await writeFile(FILE, JSON.stringify(current, null, 2), 'utf8');
  }
}
