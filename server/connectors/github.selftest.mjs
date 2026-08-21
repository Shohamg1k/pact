import assert from 'node:assert';
import os from 'node:os';
import path from 'node:path';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { exportGithubPR } from './github.js';

// isRepo is now `existsSync(path.join(generatedDir, '.git'))` — a real filesystem check,
// not a mocked `git rev-parse` call (that call walked up to ANY ancestor repo, which is
// exactly the bug: it found PACT's own repo whenever generatedDir was nested inside it,
// e.g. .pact/chats/<id>/preview, and ran checkout/add/commit against the daemon's real
// source tree — confirmed live, not hypothetical). So these tests use real temp dirs
// with or without an actual .git subdirectory, instead of mocking git's own detection.

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
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/acme/pact-generated-xyz/pull/1', stderr: '' };
    return { stdout: '', stderr: '' };
  };

  const result = await exportGithubPR(freshDir, contract, { runId: 'abc123', exec });

  assert.strictEqual(result.connector, 'github');
  assert.strictEqual(result.prUrl, 'https://github.com/acme/pact-generated-xyz/pull/1');
  assert.strictEqual(result.base, 'main');
  assert.strictEqual(result.branch, 'pact/abc123');

  assert.ok(calls.some((c) => c === 'git init'), 'fresh dir (no .git of its own) should be git init');
  assert.ok(calls.some((c) => c === 'git config user.email pact@localhost'), 'a fresh repo must not depend on the host having a global git identity configured');
  assert.ok(calls.some((c) => c === 'git config user.name PACT'));
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
// A REAL .git subdirectory, not a mocked `git rev-parse` response — the whole point of
// the fix is that repo-ness is now decided by the filesystem, not by asking git (which
// would say "yes" for any directory nested inside PACT's own repo too).
{
  const existingDir = path.join(os.tmpdir(), `pact-github-selftest-existing-${Date.now()}`);
  await mkdir(path.join(existingDir, '.git'), { recursive: true });
  try {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'gh' && args[0] === 'pr') return { stdout: 'https://github.com/acme/repo/pull/2', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    await exportGithubPR(existingDir, contract, { runId: 'ghi789', exec });
    assert.ok(!calls.some((c) => c === 'git init'), 'an existing repo (has its own .git) should not be re-initialized');
    assert.ok(!calls.some((c) => c.startsWith('gh repo create')), 'an existing repo should not get a new remote created');
    assert.ok(!calls.some((c) => c.startsWith('git config user.')), 'identity is only set on a freshly-init\'d repo, not an existing one');
    console.log('github.selftest.mjs — already-a-repo path passed');
  } finally {
    await rm(existingDir, { recursive: true, force: true }).catch(() => {});
  }
}

// --- regression: a directory NESTED inside a real ancestor repo, with no .git of its
// own, must still be treated as not-a-repo — the exact scenario that broke live
// (.pact/chats/<id>/preview nested inside the pact-ui repo). ---
{
  const outerDir = path.join(os.tmpdir(), `pact-github-selftest-outer-${Date.now()}`);
  const nestedDir = path.join(outerDir, 'nested', 'generated');
  await mkdir(path.join(outerDir, '.git'), { recursive: true }); // a real ancestor repo
  await mkdir(nestedDir, { recursive: true }); // generatedDir itself has no .git
  try {
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (cmd === 'gh' && args[0] === 'pr') return { stdout: 'https://github.com/acme/nested/pull/3', stderr: '' };
      return { stdout: '', stderr: '' };
    };
    await exportGithubPR(nestedDir, contract, { runId: 'nested1', exec });
    assert.ok(calls.some((c) => c === 'git init'), 'nested-but-no-own-.git must still be treated as a fresh repo, not inherit the ancestor\'s');
    console.log('github.selftest.mjs — nested-inside-an-ancestor-repo regression check passed');
  } finally {
    await rm(outerDir, { recursive: true, force: true }).catch(() => {});
  }
}

console.log('github.selftest.mjs — all checks passed (no real git/gh commands were ever run)');
