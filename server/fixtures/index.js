// D4 — reproducible demo scenarios (PRD §22 cut list, §24 T15). Each fixture drives the
// SAME orchestrator.js / kernel/chats.js entry points the API routes use — there is no
// separate "demo mode" code path. Imports no model client directly (PRD §2 non-negotiable
// #1); every model call happens exactly where it always does, inside agents/*.js via
// router.js. Runs standalone (no HTTP daemon required) — orchestrator.js's preview map and
// SSE bus are in-process state, so `node server/fixtures/run.mjs <name>` is a complete,
// self-contained rehearsal of one scenario with nothing else running.
import { createChat, getArtifact, listJobs } from '../kernel/chats.js';
import { generateRoles, subscribe, resumeAfterAnswer, getPreview } from '../orchestrator.js';
import { runContractTests } from '../gates/contracttests.js';
import { checkDrift } from '../gates/v2.js';
import { probeAll } from '../adapters/index.js';

// Every adapter object starts `available: false` until probeAll() actually checks the
// real binaries (adapters/index.js) -- server/index.js does this once at daemon startup,
// but a fixture runs as its own fresh process that never goes through that path. Without
// this, ladder() always returns an empty rung list and every scenario that calls a model
// fails immediately with NO_CAPACITY -- confirmed live: happy-path's first run "hung" for
// 25+ minutes (actually a SEPARATE orchestrator.js bug, now fixed, that swallowed the
// failure silently instead of surfacing it), and even after that fix it still failed
// instantly with NO_CAPACITY until this probe was added. Probing once per process (not per
// scenario call) matches ROUTE-6's own "on boot" cadence.
let probed = false;
async function ensureProbed() {
  if (probed) return;
  await probeAll();
  probed = true;
}

const TERMINAL = new Set(['passed', 'failed', 'awaiting_human']);

/** Resolves on the next terminal event for `role` on `chatId` — the same states the UI's
 * pipeline strip renders. `onEvent` sees every event first (so a caller can print live
 * progress), terminal or not. Guards against a fixture hanging forever if a role never
 * settles (a real bug elsewhere should surface as a timeout, not a silent stall). */
function waitForRole(chatId, role, { onEvent, timeoutMs = 15 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`fixture timed out waiting for role "${role}" on chat ${chatId} after ${timeoutMs}ms`));
    }, timeoutMs);
    const unsub = subscribe(chatId, (evt) => {
      onEvent?.(evt);
      if (evt.role !== role || !TERMINAL.has(evt.status)) return;
      clearTimeout(timer);
      unsub();
      resolve(evt);
    });
  });
}

function logEvent(prefix) {
  return (evt) => console.log(`${prefix} [${evt.role}] ${evt.status}${evt.detail && Object.keys(evt.detail).length ? ' ' + JSON.stringify(evt.detail) : ''}`);
}

async function waitForPreview(chatId, { tries = 40, intervalMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const preview = getPreview(chatId);
    if (preview) return preview;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

// --- scenario 1: happy path (T1, T7, T8, T9) ---------------------------------------------

const HAPPY_PATH_BRIEF =
  'Build a Node/Express MERN backend for a training-session booking system. One collection: ' +
  'bookings (slot_id, status, paid_at). Endpoints: create a booking, get a booking by id, list ' +
  'bookings. Business rule: GET /bookings/:id/report returns 403 "payment pending" until paid_at ' +
  'is set on that booking.';

export async function happyPath() {
  console.log('=== D4 scenario: happy path ===');
  await ensureProbed();
  const chat = await createChat({ text: HAPPY_PATH_BRIEF, mode: 'batch' });
  console.log(`chat ${chat.id} created`);

  const unsub = subscribe(chat.id, logEvent('  '));
  const { order } = await generateRoles(chat.id, ['architect', 'backend'], { mode: 'batch' });
  console.log(`order: ${order.join(' -> ')}`);

  const architectEvt = await waitForRole(chat.id, 'architect');
  if (architectEvt.status !== 'passed') throw new Error(`architect did not pass: ${JSON.stringify(architectEvt)}`);
  const backendEvt = await waitForRole(chat.id, 'backend');
  if (backendEvt.status !== 'passed') throw new Error(`backend did not pass: ${JSON.stringify(backendEvt)}`);
  unsub();

  const preview = await waitForPreview(chat.id);
  if (!preview) throw new Error('backend passed but no live preview booted within the wait window');
  console.log(`preview live at ${preview.baseUrl}`);

  const created = await preview.proxy('POST', '/bookings', { slot_id: 'slot-1' });
  console.log(`POST /bookings -> ${created.status} ${JSON.stringify(created.body)}`);
  const listed = await preview.proxy('GET', '/bookings');
  console.log(`GET /bookings -> ${listed.status} ${JSON.stringify(listed.body)}`);

  const contract = await getArtifact(chat.id, 'architect');
  const contractTests = await runContractTests(contract, preview.baseUrl);
  console.log(`contract tests: ${contractTests.passed}/${contractTests.total} passed`);

  const jobs = await listJobs(chat.id);
  const hashes = Object.fromEntries(jobs.map((j) => [j.role, j.hash]));
  return { chatId: chat.id, hashes, previewBaseUrl: preview.baseUrl, created, listed, contractTests };
}

// --- scenario 2: vague brief / clarify-or-assume (T10, CORE-6, §8.4) ---------------------

const VAGUE_BRIEF = 'Build an employee system.';

export async function vagueBrief() {
  console.log('=== D4 scenario: vague brief (clarify-or-assume) ===');
  await ensureProbed();
  const chat = await createChat({ text: VAGUE_BRIEF, mode: 'interactive' });
  console.log(`chat ${chat.id} created (interactive mode)`);

  const rounds = [];
  await generateRoles(chat.id, ['architect'], { mode: 'interactive' });

  for (let round = 0; round < 3; round++) {
    const evt = await waitForRole(chat.id, 'architect');
    if (evt.status === 'passed') {
      console.log(`round ${round}: architect PASSED (no more questions -- either satisfied or round-capped)`);
      rounds.push({ status: 'passed' });
      return { chatId: chat.id, rounds };
    }
    if (evt.status === 'failed') throw new Error(`architect failed: ${JSON.stringify(evt)}`);
    // awaiting_human
    console.log(`round ${round}: clarifying question -- "${evt.detail.question}"`);
    rounds.push({ status: 'awaiting_human', question: evt.detail.question });
    await resumeAfterAnswer(chat.id, evt.detail.itemId, 'Use reasonable defaults; proceed with your best assumption.');
  }
  throw new Error('vagueBrief fixture did not settle within 3 rounds — CORE-6 round cap should have forced a pass by round 2');
}

// --- scenario 3: loss-free failover (T11, ROUTE-2) ----------------------------------------

const FAILOVER_BRIEF =
  'Build a tiny Node/Express MERN backend for a todo list. One collection: todos (title, done). ' +
  'Endpoints: list, create, mark done.';

/** Finds the newest OS process actually running `bin` (not its shell wrapper — see
 * spawn.js's file header on why shell:true means the tracked child is cmd.exe, not the
 * CLI) spawned after `sinceMs`, and force-kills it. This IS the mechanism T11 exercises
 * manually; automated here so the scenario is push-button rather than hand-timed. Windows
 * only (this track's dev/demo machines) — on any other platform this logs and returns
 * false rather than silently no-op'ing a step the caller thinks happened. */
async function killNewestCliProcess(bin, sinceMs) {
  if (process.platform !== 'win32') {
    console.log(`[fixture] live process-kill is only implemented for win32; skipping on ${process.platform}`);
    return false;
  }
  const { execFile } = await import('node:child_process');
  const run = (args) =>
    new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args], { timeout: 10_000 }, (err, stdout) => {
        if (err) return reject(err);
        resolve(stdout);
      });
    });
  // The shell wrapper (cmd.exe /c "<bin> -p ...") is what Node's spawn() tracks; its real
  // child is the actual CLI binary, which is the one that must die to simulate a genuine
  // crash rather than an orderly shutdown the shell could absorb.
  const findScript = `Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" | Where-Object { $_.CommandLine -like '*${bin} -p*' } | Sort-Object CreationDate -Descending | Select-Object -First 1 -ExpandProperty ProcessId`;
  for (let i = 0; i < 20; i++) {
    const out = (await run(findScript)).trim();
    if (out) {
      const shellPid = Number(out);
      const childScript = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${shellPid} AND Name='${bin}.exe'").ProcessId`;
      const childOut = (await run(childScript)).trim();
      const targetPid = childOut ? Number(childOut) : shellPid;
      await run(`Stop-Process -Id ${targetPid} -Force`);
      console.log(`[fixture] killed ${bin} process tree (shell pid ${shellPid}, target pid ${targetPid})`);
      return true;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`[fixture] never observed a ${bin} process to kill within the wait window`);
  return false;
}

export async function failover() {
  console.log('=== D4 scenario: loss-free failover ===');
  await ensureProbed();
  const chat = await createChat({ text: FAILOVER_BRIEF, mode: 'batch' });
  console.log(`chat ${chat.id} created`);

  await generateRoles(chat.id, ['architect'], { mode: 'batch' });
  const architectEvt = await waitForRole(chat.id, 'architect');
  if (architectEvt.status !== 'passed') throw new Error(`architect did not pass: ${JSON.stringify(architectEvt)}`);

  const sinceMs = Date.now();
  const unsub = subscribe(chat.id, logEvent('  '));
  await generateRoles(chat.id, ['backend'], { mode: 'batch' });
  const killed = await killNewestCliProcess('claude', sinceMs);
  const backendEvt = await waitForRole(chat.id, 'backend');
  unsub();
  if (backendEvt.status !== 'passed') throw new Error(`backend did not pass after failover: ${JSON.stringify(backendEvt)}`);

  const jobs = await listJobs(chat.id);
  const backendJob = jobs.find((j) => j.role === 'backend');
  console.log(`backend committed via adapter: ${backendJob?.adapter ?? '(unknown)'}`);
  return { chatId: chat.id, killed, adapter: backendJob?.adapter, backendEvt };
}

// --- scenario 4: drift rejection (T5, VER-2) ----------------------------------------------

/** Deterministic by design, per T5's own test method ("inject a file with implements: []")
 * and the PRD §22 cut list's own judgment ("live drift scenario (show recorded)" is near
 * the top of what to cut under time pressure) -- this proves the GATE mechanism, not a
 * model's willingness to invent scope, so it never depends on what a live call happens to
 * generate and cannot be flaky on stage. */
export async function driftRejection() {
  console.log('=== D4 scenario: drift rejection ===');
  const contract = {
    meta: { schema: 'arch-contract/v1', id: 'PACT-fixture', completeness_score: 0.9 },
    stack: { default: 'MERN', db: 'mongodb', api: 'express' },
    features: [{ id: 'F-01', name: 'Loyalty points', priority: 'could' }],
    assumptions: [],
    business_rules: [],
    collections: [],
    apis: [],
  };
  const backend = {
    meta: { schema: 'backend/v1', runId: 'fixture', contractHash: 'sha256:fixture' },
    modules: [
      {
        path: 'routes/loyalty.js',
        kind: 'route',
        implements: [], // the invented-scope shape T5 specifies
        code: "const router = require('express').Router();\nrouter.get('/loyalty', (req, res) => res.json([]));\nmodule.exports = router;\n",
        language: 'js',
      },
    ],
    server_entry: 'server.js',
    package_json: { name: 'fixture', dependencies: {} },
    gaps: [],
  };
  const errors = checkDrift(contract, backend);
  const rejected = errors.find((e) => e.code === 'DRIFT_REJECTED' && e.subject_id === 'routes/loyalty.js');
  if (!rejected) throw new Error('expected DRIFT_REJECTED naming routes/loyalty.js, got: ' + JSON.stringify(errors));
  console.log(`DRIFT_REJECTED: ${rejected.detail}`);
  return { errors };
}

export const SCENARIOS = {
  'happy-path': happyPath,
  'vague-brief': vagueBrief,
  failover,
  'drift-rejection': driftRejection,
};
