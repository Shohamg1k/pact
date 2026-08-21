// Aggregates every *.selftest.mjs under server/ into one `npm test` run. These have
// always existed and always passed individually — nothing wired them together, so
// "does this repo have tests" wasn't answerable from npm test alone. This just runs
// each one as its own child process (so one file's top-level throw can't take down the
// rest of the suite) and reports a single pass/fail summary.
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

async function findSelftests(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await findSelftests(full)));
    else if (entry.name.endsWith('.selftest.mjs')) found.push(full);
  }
  return found;
}

function run(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    const p = spawn(process.execPath, [file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('exit', (code) => resolve({ file, code, out, ms: Date.now() - started }));
  });
}

const files = (await findSelftests(root)).sort();
console.log(`server/run-selftests.mjs — running ${files.length} selftest files\n`);

const results = [];
for (const file of files) {
  const r = await run(file);
  results.push(r);
  const rel = path.relative(root, r.file).replaceAll('\\', '/');
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'}  ${rel}  (${r.ms}ms)`);
  if (r.code !== 0) console.log(r.out.trim().split('\n').map((l) => `      ${l}`).join('\n'));
}

const failed = results.filter((r) => r.code !== 0);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log(`FAILED: ${failed.map((f) => path.relative(root, f.file)).join(', ')}`);
  process.exitCode = 1;
}
