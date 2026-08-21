import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { exportGithubPR } from './github.js';

const contract = { meta: { schema: 'arch-contract/v1', id: 'PACT-gh-test', completeness_score: 0.9 }, features: [{ id: 'F-01' }], apis: [{ id: 'API-01' }], collections: [] };

// --- fresh repo path: no .git yet -> init, empty base commit, gh repo create --push, then
// a feature branch with the real content, pushed, PR'd against base. Uses a REAL (but
// git-uninitialized) temp dir, since exportGithubPR writes a real .gitignore file there —
// only the git/gh commands themselves are mocked. ---
const freshDir = path.join(os.tmpdir(), `pact-github-selftest-${Date.now()}`);
await mkdir(freshDir, { recursive: true });
try {
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'git' && args[0] === 'rev-parse') throw new Error('not a git repo'); // simulates a fresh generatedDir
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/acme/pact-generated-xyz/pull/1', stderr: '' };
    return { stdout: '', stderr: '' };
  };

  const result = await exportGithubPR(freshDir, contract, { runId: 'abc123', exec });

  assert.strictEqual(result.connector, 'github');
  assert.strictEqual(result.prUrl, 'https://github.com/acme/pact-generated-xyz/pull/1');
  assert.strictEqual(result.base, 'main');
  assert.strictEqual(result.branch, 'pact/abc123');

  assert.ok(calls.some((c) => c === 'git rev-parse --is-inside-work-tree'), 'should check for an existing repo first');
  assert.ok(calls.some((c) => c === 'git init'), 'fresh dir should be git init');
  assert.ok(calls.some((c) => c.includes('commit --allow-empty')), 'base branch should get an empty commit to diff against');
  assert.ok(calls.some((c) => c.startsWith('gh repo create')), 'no remoteUrl given -> should create a new GitHub repo');
  assert.ok(calls.some((c) => c === 'git checkout -B pact/abc123'), 'should create the feature branch');
  assert.ok(calls.some((c) => c === 'git add -A'), 'should stage the generated tree');
  assert.ok(calls.some((c) => c.startsWith('git commit -m')), 'should commit the generated tree onto the feature branch');
  assert.ok(calls.some((c) => c === 'git push -u origin pact/abc123'), 'should push the feature branch');
  assert.ok(
    calls.some((c) => c.startsWith('gh pr create') && c.includes('--base main') && c.includes('--head pact/abc123')),
    'should open the PR from the feature branch against base',
  );
  const gitignore = await readFile(path.join(freshDir, '.gitignore'), 'utf8');
  assert.ok(gitignore.includes('node_modules/'), 'a fresh repo should get a .gitignore excluding node_modules (the preview dir is reused for this)');

  console.log('github.selftest.mjs — fresh-repo command sequence passed:', calls.length, 'commands');
} finally {
  await rm(freshDir, { recursive: true, force: true }).catch(() => {});
}

// --- existing repo + explicit remoteUrl: should skip `gh repo create`, use `git remote add` instead ---
{
  const remoteDir = path.join(os.tmpdir(), `pact-github-selftest-remote-${Date.now()}`);
  await mkdir(remoteDir, { recursive: true });
  try {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'git' && args[0] === 'rev-parse') throw new Error('not a git repo');
      if (cmd === 'gh' && args[0] === 'pr') return { stdout: 'https://github.com/acme/existing/pull/7', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    await exportGithubPR(remoteDir, contract, { runId: 'def456', remoteUrl: 'https://github.com/acme/existing.git', exec });
    assert.ok(!calls.some((c) => c.startsWith('gh repo create')), 'an explicit remoteUrl should skip gh repo create');
    assert.ok(calls.some((c) => c === 'git remote add origin https://github.com/acme/existing.git'));
    console.log('github.selftest.mjs — explicit-remote path passed');
  } finally {
    await rm(remoteDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- already-a-repo path: should skip init/empty-commit/repo-create entirely ---
{
  const calls = [];
  const exec = async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'git' && args[0] === 'rev-parse') return { stdout: 'true', stderr: '' }; // already a repo
    if (cmd === 'gh' && args[0] === 'pr') return { stdout: 'https://github.com/acme/repo/pull/2', stderr: '' };
    return { stdout: '', stderr: '' };
  };
  await exportGithubPR('/fake/generated/dir', contract, { runId: 'ghi789', exec });
  assert.ok(!calls.some((c) => c === 'git init'), 'an existing repo should not be re-initialized');
  assert.ok(!calls.some((c) => c.startsWith('gh repo create')), 'an existing repo should not get a new remote created');
  console.log('github.selftest.mjs — already-a-repo path passed');
}

console.log('github.selftest.mjs — all checks passed (no real git/gh commands were ever run)');
