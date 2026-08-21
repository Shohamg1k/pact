// Tests the REAL completeWithLadder — the exact function that runs in production
// (imported directly, not reimplemented) — against synthetic adapters. This is fault
// injection, not a live cross-provider demo: agy isn't installed on this machine and no
// OPENROUTER_API_KEY is configured, so a genuine two-real-provider failover can't be
// exercised here. What CAN be verified without either is the router's own contract
// (PRD §9 ROUTE-2): on a rung's failure, the next rung gets the identical pack plus the
// worklog plus the partial output, the run completes rather than restarting, and a
// usage-limit-shaped failure starts a cooldown. That's exactly what this proves,
// deterministically and repeatably, using the production code path.
import assert from 'node:assert';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { completeWithLadder, isUsageLimitError, onCooldown, PactError } from './router.js';
import { chatDir, readChatLog } from './kernel/chats.js';

const CHAT_ID = `__router_selftest_${Date.now()}`;
const dir = chatDir(CHAT_ID);

function fakeAdapter(id, tier, behavior) {
  return { id, tier, available: true, complete: behavior };
}

try {
  // --- 1. basic failover: rung A fails (usage-limit-shaped, with partial output), rung B succeeds ---
  const partialA = '{"meta": {"schema": "arch-contract/v1"}, "features": [{"id": "F-01"';
  const adapterA = fakeAdapter('test-a', 0, async () => {
    const err = new Error('rate limit exceeded, retry after 900s');
    err.partial = partialA;
    throw err;
  });
  let promptSeenByB = null;
  const adapterB = fakeAdapter('test-b', 1, async (prompt) => {
    promptSeenByB = prompt;
    return '{"meta": {"schema": "arch-contract/v1"}, "features": [{"id": "F-01", "name": "done", "priority": "must"}], "apis": []}';
  });

  const originalPrompt = '## Client brief\n\nBuild a booking system.';
  const result = await completeWithLadder(originalPrompt, [adapterA, adapterB], { chatId: CHAT_ID, phase: 'architect', cwd: dir });

  assert.strictEqual(result.adapterId, 'test-b', 'the run must complete via the surviving rung');
  assert.ok(result.text.includes('"F-01"'), 'the completed result is the real output, not a stub');

  // --- 2. loss-free continuation: rung B's prompt must contain the ORIGINAL prompt, the
  //        EXACT partial output, and the continuation instruction — no truncation, no
  //        summarization, no restart (PRD §9's own wording, checked verbatim). ---
  assert.ok(promptSeenByB.includes(originalPrompt), 'rung B must receive the original pack unmodified');
  assert.ok(promptSeenByB.includes(partialA), 'rung B must receive the EXACT partial output byte-for-byte');
  assert.ok(promptSeenByB.includes('Continue seamlessly from the furthest good state above'), 'the continuation instruction must be present');
  assert.ok(promptSeenByB.includes('Do NOT restart unless the partial work is'), 'the anti-restart instruction must be present');

  // --- 3. isUsageLimitError correctly triggers a cooldown on the failed rung, and only
  //        on usage-limit-SHAPED errors (a real bug, not a quota exhaustion, must not
  //        cool an adapter down for 15 minutes over a transient failure). ---
  assert.strictEqual(isUsageLimitError('rate limit exceeded, retry after 900s'), true);
  assert.strictEqual(isUsageLimitError('unexpected token in JSON'), false, 'a parse error is not a usage-limit error');
  assert.strictEqual(onCooldown(adapterA), true, 'the rung that failed with a usage-limit error must now be cooling down');
  assert.strictEqual(onCooldown(adapterB), false, 'the rung that succeeded must not be on cooldown');

  // --- 4. the worklog (files are truth — P3) records BOTH the failover and the
  //        successful call, attributing each to the correct adapter, with the partial
  //        output captured on disk, not just in memory. ---
  const log = await readChatLog(CHAT_ID, 'worklog.jsonl');
  const failoverEntry = log.find((e) => e.event === 'failover');
  const callEntry = log.find((e) => e.event === 'call');
  assert.ok(failoverEntry, 'a failover event must be logged');
  assert.strictEqual(failoverEntry.adapter, 'test-a');
  assert.strictEqual(failoverEntry.partial, partialA, 'the partial output must be persisted to the worklog, not just held in memory');
  assert.ok(callEntry, 'a successful call event must be logged');
  assert.strictEqual(callEntry.adapter, 'test-b');

  // --- 5. total exhaustion: every rung fails -> a typed PactError naming exactly which
  //        rungs were tried, never a hang and never a silent swallow. ---
  const adapterC = fakeAdapter('test-c', 0, async () => { throw new Error('transient failure, no partial'); });
  const adapterD = fakeAdapter('test-d', 1, async () => { throw new Error('also failed'); });
  await assert.rejects(
    () => completeWithLadder('probe', [adapterC, adapterD], { chatId: CHAT_ID, phase: 'architect', cwd: dir }),
    (err) => {
      assert.ok(err instanceof PactError);
      assert.strictEqual(err.code, 'NO_CAPACITY');
      assert.deepStrictEqual(err.detail.tried, ['test-c', 'test-d'], 'must name every rung it actually tried');
      return true;
    },
  );

  // --- 6. a rung with an exhausted quota (hasQuota) is SKIPPED, not tried and failed —
  //        the ladder must not waste a call on something already known to be unusable. ---
  let calledE = false;
  const adapterE = fakeAdapter('test-e', 0, async () => { calledE = true; return 'should not run'; });
  adapterE.limits = { rpm: 1 };
  const adapterF = fakeAdapter('test-f', 1, async () => 'from F');
  // Exhaust E's quota via the real recordCall/hasQuota machinery by running it once first.
  await completeWithLadder('warm up', [adapterE], { chatId: CHAT_ID, phase: 'architect', cwd: dir });
  calledE = false;
  const skipResult = await completeWithLadder('probe2', [adapterE, adapterF], { chatId: CHAT_ID, phase: 'architect', cwd: dir });
  assert.strictEqual(calledE, false, 'a rung already out of quota must be skipped, not called');
  assert.strictEqual(skipResult.adapterId, 'test-f');

  console.log('router.selftest.mjs — all 6 checks passed (synthetic adapters — see file header: no second real provider is configured on this machine)');
} finally {
  await rm(dir, { recursive: true, force: true });
}
