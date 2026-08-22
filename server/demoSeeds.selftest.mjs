import assert from 'node:assert';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// installDemoSeedsIfEmpty reads process.env.PACT_ROOT indirectly via kernel/store.js's
// module-level PACT_ROOT (computed from process.cwd() at import time) — so this test
// drives it through a real repoRoot + a real temp PACT_ROOT by chdir'ing, since
// PACT_ROOT itself can't be swapped after import without restructuring the module.
const workDir = await mkdtemp(path.join(tmpdir(), 'pact-demoseeds-'));
const originalCwd = process.cwd();
process.chdir(workDir);

try {
  const { installDemoSeedsIfEmpty } = await import('./demoSeeds.js');

  // --- no demo-seeds/ directory at all: a no-op, not an error ---
  {
    const r = await installDemoSeedsIfEmpty(workDir);
    assert.strictEqual(r.installed, false);
    console.log('demoSeeds.selftest.mjs — missing demo-seeds/ is a clean no-op');
  }

  // --- a real demo-seeds/ directory, PLUS an ORPHANED chat directory already sitting
  //     under .pact/chats/ (no chat.json — e.g. left behind by an interrupted process
  //     still holding a lock on one of its subfolders): must still install. A real bug,
  //     not hypothetical — hit this exact scenario live while building the demo seeds
  //     themselves: a leftover locked `preview/` subfolder with no chat.json made the
  //     naive "does .pact/chats/ have any entries" check wrongly skip seeding on an
  //     otherwise-fresh checkout. ---
  {
    await mkdir(path.join(workDir, '.pact', 'chats', 'orphaned-no-chatjson', 'preview'), { recursive: true });

    const seedRoot = path.join(workDir, 'demo-seeds');
    await mkdir(path.join(seedRoot, 'chats', 'seed-chat-1'), { recursive: true });
    await writeFile(path.join(seedRoot, 'chats', 'seed-chat-1', 'chat.json'), JSON.stringify({ id: 'seed-chat-1', title: 'Seed' }));
    await mkdir(path.join(seedRoot, 'projects', 'seed-proj-1'), { recursive: true });
    await writeFile(path.join(seedRoot, 'projects', 'seed-proj-1', 'project.json'), JSON.stringify({ id: 'seed-proj-1', name: 'Seed Project' }));

    const r = await installDemoSeedsIfEmpty(workDir);
    assert.strictEqual(r.installed, true, 'an orphaned directory with no chat.json must not count as "chats already exist"');
    const chatRaw = await readFile(path.join(workDir, '.pact', 'chats', 'seed-chat-1', 'chat.json'), 'utf8');
    assert.strictEqual(JSON.parse(chatRaw).id, 'seed-chat-1');
    console.log('demoSeeds.selftest.mjs — installs demo-seeds/ on a fresh checkout, undeterred by an orphaned no-chat.json directory');
  }

  // --- a SECOND call, now that .pact/chats/ is non-empty: must NOT reinstall or
  //     touch anything — a real user's own chats must never be seeded over. ---
  {
    await mkdir(path.join(workDir, '.pact', 'chats', 'a-real-user-chat'), { recursive: true });
    await writeFile(path.join(workDir, '.pact', 'chats', 'a-real-user-chat', 'chat.json'), JSON.stringify({ id: 'a-real-user-chat' }));
    const r = await installDemoSeedsIfEmpty(workDir);
    assert.strictEqual(r.installed, false, 'must never reseed once any chat exists, seeded or real');
    console.log('demoSeeds.selftest.mjs — never reinstalls once .pact/chats/ is non-empty');
  }

  console.log('demoSeeds.selftest.mjs — all checks passed');
} finally {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
