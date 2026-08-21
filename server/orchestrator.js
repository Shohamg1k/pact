// The multi-agent run state machine — generalized from a fixed 2-phase pipeline to an
// N-role batch, validated against the DAG in agents/registry.js before any model is
// called. Emits SSE `{role, status, detail, ts}` per role — the integration contract
// the UI builds against. A chat is resumable: `generateRoles` can be called again later
// with a different selection, and registry.js's DAG check treats artifacts already on
// disk from earlier batches the same as ones just produced in this batch.
import { EventEmitter } from 'node:events';
import { getChat, patchChat, appendChatLog, availableRoles, getArtifact, listArtifacts, writeChatFile } from './kernel/chats.js';
import { validateSelection, ROLE_LABELS } from './agents/registry.js';
import { runArchitect } from './agents/architect.js';
import { runBackend } from './agents/backend.js';
import { runPM } from './agents/pm.js';
import { runUiux } from './agents/uiux.js';
import { runFrontend } from './agents/frontend.js';
import { runQA } from './agents/qa.js';
import { runDocs } from './agents/docs.js';
import { answerClarification } from './kernel/interrupts.js';
import { buildTrace } from './trace.js';
import { buildProvenance } from './kernel/provenance.js';

export const bus = new EventEmitter();
bus.setMaxListeners(200);

function emit(chatId, role, status, detail = {}) {
  bus.emit(chatId, { role, status, detail, ts: Date.now() });
}

const RUNNERS = { pm: runPM, architect: runArchitect, uiux: runUiux, backend: runBackend, frontend: runFrontend, qa: runQA, docs: runDocs };

export class SelectionError extends Error {
  constructor(errors) {
    super('AGENT_SELECTION_INVALID');
    this.code = 'AGENT_SELECTION_INVALID';
    this.details = errors;
  }
}

/**
 * Validates `roles` against the chat's already-available artifacts + this batch's own
 * selection (registry.js), then starts the batch in the background. Throws
 * SelectionError synchronously (before any model call) if the selection is
 * unsatisfiable — e.g. QA with no Backend anywhere in this chat's history.
 */
export async function generateRoles(chatId, roles, opts = {}) {
  const existing = await availableRoles(chatId);
  const { valid, order, errors } = validateSelection(roles, existing);
  if (!valid) throw new SelectionError(errors);

  runBatch(chatId, order, opts).catch((e) => {
    appendChatLog(chatId, 'worklog.jsonl', { ts: Date.now(), phase: 'orchestrator', event: 'error', detail: e.message });
  });
  return { order };
}

async function runBatch(chatId, order, opts) {
  const chat = await getChat(chatId);
  const runOpts = {
    mode: opts.mode ?? chat.mode ?? 'batch',
    projectName: chat.projectId ?? null, // memory.js keys by project name; a chat's projectId doubles as that key
    pinnedAdapter: opts.pinnedAdapter ?? chat.pinnedAdapter ?? undefined,
  };

  for (const role of order) {
    const runner = RUNNERS[role];
    emit(chatId, role, 'running', {});

    let result;
    if (role === 'pm') result = await runner(chatId, chat.brief, runOpts);
    else if (role === 'architect') result = await runner(chatId, chat.brief, runOpts);
    else if (role === 'backend') result = await runner(chatId, await getArtifact(chatId, 'architect'), runOpts);
    else result = await runner(chatId, runOpts); // uiux/frontend/qa/docs read their own upstream artifacts

    if (result.status === 'awaiting_human') {
      emit(chatId, role, 'awaiting_human', { itemId: result.item.id, question: result.item.payload.question });
      // Only the paused role + whatever hadn't run yet — NOT the whole original order,
      // so resuming doesn't re-run roles that already committed an artifact.
      const remaining = order.slice(order.indexOf(role));
      await patchChat(chatId, { pendingRole: role, pendingOrder: remaining });
      return; // resumes via resumeAfterAnswer()
    }

    emit(chatId, role, 'passed', { gaps: result.gaps, savedTokens: result.savedTokens });
  }

  await refreshTrace(chatId);
  await patchChat(chatId, { pendingRole: null, pendingOrder: null });
}

async function refreshTrace(chatId) {
  const artifacts = await listArtifacts(chatId);
  const contract = artifacts.architect;
  if (!contract) return; // no contract yet (e.g. only pm has run) — nothing to trace against
  const gaps = Object.values(artifacts).flatMap((a) => a.gaps ?? []);
  const trace = buildTrace(contract, artifacts, gaps);
  await writeChatFile(chatId, 'trace.json', trace);
  await writeChatFile(chatId, 'provenance.json', buildProvenance(artifacts));
}

/** POST /api/chats/:id/answer -> here. Records the answer, then resumes the batch that
 * was paused on this role, continuing with the remaining roles in its original order. */
export async function resumeAfterAnswer(chatId, itemId, answer, overrideOpts = {}) {
  await answerClarification(chatId, itemId, answer);
  const chat = await getChat(chatId);
  const order = chat.pendingOrder ?? [chat.pendingRole].filter(Boolean);
  const opts = { mode: chat.mode ?? 'batch', pinnedAdapter: chat.pinnedAdapter ?? undefined, ...overrideOpts };
  runBatch(chatId, order, opts).catch((e) => {
    appendChatLog(chatId, 'worklog.jsonl', { ts: Date.now(), phase: 'orchestrator', event: 'error', detail: e.message });
  });
}

export function subscribe(chatId, listener) {
  bus.on(chatId, listener);
  return () => bus.off(chatId, listener);
}

export { ROLE_LABELS };
