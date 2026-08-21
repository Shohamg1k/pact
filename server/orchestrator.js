// The run state machine (PRD §10). Emits SSE events shaped `{phase, status, detail}` —
// this shape is the integration contract every other track (UI, runner) builds against.
// It must not change without updating web/src/api.js and server/runner.js in lockstep.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ensureRunDir, writeArtifact, appendLog, patchRun } from './kernel/store.js';
import { runArchitect } from './agents/architect.js';
import { runBackend } from './agents/backend.js';
import { buildTrace } from './trace.js';
import { buildProvenance } from './kernel/provenance.js';
import { answerClarification } from './kernel/interrupts.js';
import { getRun } from './kernel/store.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

function emit(runId, phase, status, detail = {}) {
  bus.emit(runId, { phase, status, detail, ts: Date.now() });
}

const PHASES = ['agent1', 'gateV1', 'agent2', 'gateV2', 'run', 'connectors'];

/**
 * Agent 1 + Gate V1 are real (agents/architect.js). Agent 2 + Gate V2 + run + connectors
 * remain a stub until feat/core-pipeline finishes them — the phase names, SSE shape, and
 * run.json fields are the contract other tracks build against; only phase internals change.
 */
export async function startRun(brief, projectName = null, opts = {}) {
  const runId = randomUUID().slice(0, 8);
  await ensureRunDir(runId);
  await writeArtifact(runId, 'requirement.md', brief);
  await patchRun(runId, {
    id: runId,
    projectName,
    status: 'created',
    brief,
    createdAt: new Date().toISOString(),
    phases: PHASES.map((name) => ({ name, status: 'pending' })),
  });

  runPipeline(runId, brief, opts).catch((e) => {
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

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function runPipeline(runId, brief, opts) {
  await setPhase(runId, 'agent1', 'running', {});
  const result = await runArchitect(runId, brief, { mode: opts.mode ?? 'batch' });

  if (result.status === 'awaiting_human') {
    await setPhase(runId, 'agent1', 'awaiting_human', { itemId: result.item.id, question: result.item.payload.question });
    return; // resumes via POST /api/runs/:id/answer -> resumeAfterAnswer()
  }

  await setPhase(runId, 'agent1', 'passed', { gaps: result.gaps });
  await setPhase(runId, 'gateV1', 'passed', { contractHash: result.hash });

  // Agent 2 (Backend Engineer) + Gate V2 tiers 1-2 are real, mirroring the agent1/gateV1
  // pattern above: the gate is embedded inside runBackend's repair loop (PRD §8.2/§16),
  // so by the time it returns the manifest has already passed or been gracefully pruned.
  await setPhase(runId, 'agent2', 'running', {});
  const backendResult = await runBackend(runId, result.contract);
  await setPhase(runId, 'agent2', 'passed', { gaps: backendResult.gaps });
  await setPhase(runId, 'gateV2', 'passed', { backendHash: backendResult.hash });

  const trace = buildTrace(result.contract, backendResult.manifest, backendResult.gaps);
  await writeArtifact(runId, 'trace.json', trace);
  await writeArtifact(runId, 'provenance.json', buildProvenance(backendResult.manifest));

  // --- run/connectors remain a stub: runner.js + connectors/* land on feat/runner-connectors ---
  await setPhase(runId, 'run', 'running', {});
  await wait(300);
  await setPhase(runId, 'run', 'passed', { preview: `http://127.0.0.1:0/` });

  await setPhase(runId, 'connectors', 'passed', {});
  await patchRun(runId, { status: 'done_stub' });
}

/** POST /api/runs/:id/answer -> here. Records the answer, then re-enters the pipeline. */
export async function resumeAfterAnswer(runId, itemId, answer, opts = {}) {
  await answerClarification(runId, itemId, answer);
  const run = await getRun(runId);
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
