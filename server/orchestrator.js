// The run state machine (PRD §10). Emits SSE events shaped `{phase, status, detail}` —
// this shape is the integration contract every other track (UI, runner) builds against.
// It must not change without updating web/src/api.js and server/runner.js in lockstep.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ensureRunDir, writeArtifact, appendLog, patchRun } from './kernel/store.js';

export const bus = new EventEmitter();
bus.setMaxListeners(100);

function emit(runId, phase, status, detail = {}) {
  bus.emit(runId, { phase, status, detail, ts: Date.now() });
}

const PHASES = ['agent1', 'gateV1', 'agent2', 'gateV2', 'run', 'connectors'];

/**
 * STUB PIPELINE — real Agent 1 / Gate V1 / Agent 2 / Gate V2 land on feat/core-pipeline.
 * The phase names, SSE shape, and run.json fields below are the contract other tracks
 * build against; only the internals of each phase change as the real pipeline lands.
 */
export async function startRun(brief, projectName = null) {
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

  runStub(runId).catch((e) => {
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

async function runStub(runId) {
  await setPhase(runId, 'agent1', 'running', { adapter: 'stub' });
  await wait(600);
  await setPhase(runId, 'agent1', 'passed', {});

  await setPhase(runId, 'gateV1', 'running', {});
  await wait(300);
  await setPhase(runId, 'gateV1', 'passed', {});

  await setPhase(runId, 'agent2', 'running', { adapter: 'stub' });
  await wait(600);
  await setPhase(runId, 'agent2', 'passed', {});

  await setPhase(runId, 'gateV2', 'running', {});
  await wait(300);
  await setPhase(runId, 'gateV2', 'passed', {});

  await setPhase(runId, 'run', 'running', {});
  await wait(300);
  await setPhase(runId, 'run', 'passed', { preview: `http://127.0.0.1:0/` });

  await setPhase(runId, 'connectors', 'passed', {});
  await patchRun(runId, { status: 'done_stub' });
}

export function subscribe(runId, listener) {
  bus.on(runId, listener);
  return () => bus.off(runId, listener);
}
