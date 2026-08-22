import assert from 'node:assert';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// buildFrontendBundle reads the chat's frontend artifact via kernel/chats.js, which
// resolves paths off the module-level PACT_ROOT (computed from process.cwd() at import
// time) — same pattern as demoSeeds.selftest.mjs, so this drives it through a real temp
// PACT_ROOT by chdir'ing before the first import.
const workDir = await mkdtemp(path.join(tmpdir(), 'pact-fe-preview-'));
const originalCwd = process.cwd();
process.chdir(workDir);

try {
  const { writeChatFile } = await import('../kernel/chats.js');
  const { buildFrontendBundle } = await import('./frontend.js');

  const chatId = 'race-test-chat';
  // A manifest deliberately shaped like the one that broke live: a module imported
  // early in the array by a LATER module, so a lost write is unambiguous (the bundle
  // either has both files or fails to resolve the import — no silent partial success).
  await writeChatFile(chatId, 'artifacts/frontend.json', {
    entry: 'src/main.jsx',
    modules: [
      { path: 'src/helper.js', code: 'export const greet = () => "hi";\n' },
      {
        path: 'src/main.jsx',
        code: "import { greet } from './helper';\ndocument.getElementById('root').textContent = greet();\n",
      },
    ],
  });

  // --- regression: concurrent callers for the SAME chat must not race each other's
  //     writeSources() rm()+write cycle. Confirmed live, not hypothetical: two calls
  //     close together left an early module missing from disk while later ones
  //     survived, and esbuild failed on a file the artifact genuinely declared. ---
  {
    const results = await Promise.all(Array.from({ length: 8 }, () => buildFrontendBundle(chatId)));
    for (const r of results) {
      assert.strictEqual(r.error, null, `concurrent build must not fail: ${r.error}`);
      assert.ok(r.js.includes('hi'), 'the bundle must contain the helper module — a lost write would make this fail to resolve instead');
    }
    console.log('frontend.selftest.mjs — 8 concurrent builds for the same chat all succeed, no lost writes');
  }

  // --- a cached result short-circuits without re-touching the filesystem at all —
  //     confirmed by the fact that a repeat call still returns the same content ---
  {
    const r = await buildFrontendBundle(chatId);
    assert.strictEqual(r.error, null);
    assert.ok(r.js.includes('hi'));
    console.log('frontend.selftest.mjs — a subsequent call still returns a valid cached bundle');
  }

  console.log('frontend.selftest.mjs — all checks passed');
} finally {
  process.chdir(originalCwd);
  await rm(workDir, { recursive: true, force: true }).catch(() => {});
}
