// The run state machine (PRD §10). Emits SSE events shaped `{phase, status, detail}` —
// this shape is the integration contract every other track (UI, runner) builds against.
// It must not change without updating web/src/api.js and server/runner.js in lockstep.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ensureRunDir, writeArtifact, appendLog, patchRun, runDir } from './kernel/store.js';
import { runArchitect } from './agents/architect.js';
import { runBackend } from './agents/backend.js';
import { buildTrace } from './trace.js';
import { buildProvenance } from './kernel/provenance.js';
import { answerClarification } from './kernel/interrupts.js';
import { getRun } from './kernel/store.js';
import { startPreviewServer } from './runner.js';
import { runContractTests } from './gates/contracttests.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

// Live preview handles (PRD UI-5, T8) keyed by runId — the daemon is the only writer to
// `.pact/`, and this is the daemon-process-lifetime equivalent for a running child process:
// the ONLY place a preview server's handle lives. A new run for the same project does not
// replace an old run's preview; each runId gets its own child + its own in-memory Mongo,
// stopped explicitly (see stopPreview / the shutdown hook below) — never left orphaned.
const previews = new Map(); // runId -> handle from runner.js#startPreviewServer

export function getPreview(runId) {
  return previews.get(runId) ?? null;
}

export async function stopPreview(runId) {
  const handle = previews.get(runId);
  if (!handle) return;
  previews.delete(runId);
  await handle.stop();
}

// SEC-2 / the runner.js non-negotiable: never leave an orphaned child process. If the
// daemon itself is killed, every live preview's node process + its mongod instance must
// go down with it rather than surviving as an orphan.
async function stopAllPreviews() {
  const handles = [...previews.values()];
  previews.clear();
  await Promise.all(handles.map((h) => h.stop().catch(() => {})));
}
process.on('SIGINT', () => stopAllPreviews().finally(() => process.exit(0)));
process.on('SIGTERM', () => stopAllPreviews().finally(() => process.exit(0)));

function emit(runId, phase, status, detail = {}) {
  bus.emit(runId, { phase, status, detail, ts: Date.now() });
}

const PHASES = ['agent1', 'gateV1', 'agent2', 'gateV2', 'run', 'connectors'];

/**
 * Agent 1 + Gate V1, Agent 2 + Gate V2 (incl. the tier-3 boot check), and 'run' (persistent
 * preview + VER-4 contract tests) are all real. Only 'connectors' remains a stub. The phase
 * names, SSE shape, and run.json fields are the contract other tracks build against.
 */
export async function startRun(brief, projectName = null, opts = {}) {
  const runId = randomUUID().slice(0, 8);
  const mode = opts.mode ?? 'batch';
  const pinnedAdapter = opts.pinnedAdapter ?? null; // ROUTE-8: a human pin always beats the ladder's choice
  await ensureRunDir(runId);
  await writeArtifact(runId, 'requirement.md', brief);
  await patchRun(runId, {
    id: runId,
    projectName,
    mode,
    pinnedAdapter,
    status: 'created',
    brief,
    createdAt: new Date().toISOString(),
    phases: PHASES.map((name) => ({ name, status: 'pending' })),
  });

  // Stored on run.json (not just passed through the call stack) so a resume after a
  // clarifying question — a separate HTTP request, possibly minutes later — re-enters the
  // pipeline with the SAME mode/pin rather than silently reverting to defaults.
  runPipeline(runId, brief, { mode, projectName, pinnedAdapter }).catch((e) => {
    appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'orchestrator', event: 'error', detail: e.message });
    patchRun(runId, { status: 'failed' });
    emit(runId, 'run', 'failed', { error: e.message });
  });

  return runId;
}

async function setPhase(runId, phase, status, detail) {
  const run = await patchRun(runId, {});
  const phases = run.phases.map((p) => (p.name === phase ? { ...p, status, ...detail } : p));
  await patchRun(runId, { phases, status: phase });
  emit(runId, phase, status, detail);
  await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase, event: status, detail });
}

async function runPipeline(runId, brief, opts) {
  const pinnedAdapter = opts.pinnedAdapter ?? undefined;

  await setPhase(runId, 'agent1', 'running', {});
  const result = await runArchitect(runId, brief, {
    mode: opts.mode ?? 'batch',
    projectName: opts.projectName ?? null,
    pinnedAdapter,
  });

  if (result.status === 'awaiting_human') {
    await setPhase(runId, 'agent1', 'awaiting_human', { itemId: result.item.id, question: result.item.payload.question });
    return; // resumes via POST /api/runs/:id/answer -> resumeAfterAnswer()
  }

  await setPhase(runId, 'agent1', 'passed', { gaps: result.gaps, savedTokens: result.savedTokens });
  await setPhase(runId, 'gateV1', 'passed', { contractHash: result.hash });

  // Agent 2 (Backend Engineer) + Gate V2 tiers 1-2 are real, mirroring the agent1/gateV1
  // pattern above: the gate is embedded inside runBackend's repair loop (PRD §8.2/§16),
  // so by the time it returns the manifest has already passed or been gracefully pruned.
  await setPhase(runId, 'agent2', 'running', {});
  const backendResult = await runBackend(runId, result.contract, { pinnedAdapter });
  await setPhase(runId, 'agent2', 'passed', { gaps: backendResult.gaps, savedTokens: backendResult.savedTokens });
  await setPhase(runId, 'gateV2', 'passed', { backendHash: backendResult.hash });

  const trace = buildTrace(result.contract, backendResult.manifest, backendResult.gaps);
  await writeArtifact(runId, 'trace.json', trace);
  await writeArtifact(runId, 'provenance.json', buildProvenance(backendResult.manifest));

  // VER-3's tier-3 boot check (inside runBackend above) already proved the manifest boots.
  // This is a SEPARATE, persistent boot — the ephemeral check tears itself down immediately;
  // this one stays up for the live preview console (UI-5) and the connector demo, and is
  // proxied via POST /api/preview/:id/request.
  await setPhase(runId, 'run', 'running', {});
  try {
    const previewDir = path.join(runDir(runId), 'preview');
    const handle = await startPreviewServer(previewDir, result.contract, backendResult.manifest);
    previews.set(runId, handle);
    await setPhase(runId, 'run', 'passed', { preview: handle.baseUrl });

    // VER-4: generated contract tests, run against the now-live server. Reporting, not
    // blocking (§28 Q2) — recorded to disk and on run.json regardless of red/green.
    const contractTestReport = await runContractTests(result.contract, handle.baseUrl);
    await writeArtifact(runId, 'contracttests.json', contractTestReport);
    await appendLog(runId, 'worklog.jsonl', {
      ts: Date.now(),
      phase: 'run',
      event: 'contract_tests',
      detail: { total: contractTestReport.total, passed: contractTestReport.passed, failed: contractTestReport.failed },
    });
  } catch (e) {
    // A preview that fails to boot is a P4 partial-output situation, not a run failure —
    // the backend manifest already proved it boots once (Gate V2 tier 3); a persistent
    // preview is a nice-to-have on top of that guarantee, never load-bearing for CORE-2.
    await setPhase(runId, 'run', 'done_partial', { error: e.message });
    await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'run', event: 'preview_failed', detail: e.message });
  }

  // --- connectors remain a stub: connectors/* land later this track ---
  await setPhase(runId, 'connectors', 'passed', {});
  await patchRun(runId, { status: 'done_stub' });
}

/** POST /api/runs/:id/answer -> here. Records the answer, then re-enters the pipeline with
 * the SAME mode/projectName/pin the run started with (read back from run.json, not the
 * caller — a resume is a separate HTTP request and must not silently revert to defaults). */
export async function resumeAfterAnswer(runId, itemId, answer, overrideOpts = {}) {
  await answerClarification(runId, itemId, answer);
  const run = await getRun(runId);
  const opts = { mode: run.mode ?? 'batch', projectName: run.projectName ?? null, pinnedAdapter: run.pinnedAdapter ?? undefined, ...overrideOpts };
  runPipeline(runId, run.brief, opts).catch((e) => {
    appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'orchestrator', event: 'error', detail: e.message });
    patchRun(runId, { status: 'failed' });
    emit(runId, 'run', 'failed', { error: e.message });
  });
}

export function subscribe(runId, listener) {
  bus.on(runId, listener);
  return () => bus.off(runId, listener);
}
