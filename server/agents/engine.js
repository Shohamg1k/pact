// Shared execution engine for every PACT agent role. architect.js and backend.js
// independently proved out this exact shape (build a budgeted pack -> completeWithLadder
// -> extract JSON -> schema-validate -> gate -> repair, capped at 2 -> escalate the
// ladder rung -> exhaust) — this extracts the identical attempt loop ONCE so all seven
// roles share it instead of seven hand-copies. What's deliberately NOT generalized here:
// commit semantics (what gets written where), P4 graceful-partial pruning, and the
// clarify-or-assume branch (architect-only, CORE-6) all differ enough per role that
// they stay in each agent's own thin wrapper — runRepairLoop returns its final state
// and lets the caller decide what to do with it. Imports no model client of its own;
// router.js is still the only thing that spawns/calls one.
import { randomUUID } from 'node:crypto';
import { ladder, completeWithLadder } from '../router.js';
import { buildPack } from '../pack.js';
import { extractJson } from './extractJson.js';
import { chatDir, writeJobFile, writeChatFile, appendChatLog } from '../kernel/chats.js';
import path from 'node:path';

export const MAX_REPAIRS = 2; // PRD §8.2/§16: capped at 2 retries, then escalate the rung

export function sandboxDir(chatId, jobId) {
  return path.join(chatDir(chatId), 'jobs', jobId, 'sandbox');
}

/** Wraps a zod schema so `meta` fields are forced BEFORE validation, never trusted from
 * the model — this is what makes cross-artifact identity checks (e.g. CORE-4's
 * contractHash equality) hold unconditionally regardless of what the model wrote. */
export function withForcedMeta(zodSchema, forcedMeta) {
  return {
    safeParse(input) {
      return zodSchema.safeParse({ ...input, meta: { ...input?.meta, ...forcedMeta } });
    },
  };
}

export function schemaRepairFeedback(errors) {
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return (
    'The previous output failed schema validation with these EXACT errors. Return the ' +
    'complete corrected JSON object; fix only these issues:\n' +
    lines.join('\n')
  );
}

/**
 * @param {object} params
 * @param {string} params.chatId
 * @param {string} params.role
 * @param {(repairNote: string) => Array} params.buildSections - pack sections for this attempt
 * @param {import('zod').ZodType} params.schema
 * @param {(output: object) => Promise<{valid: boolean, errors: Array}>} params.gate
 * @param {(errors: Array) => string} params.gateRepairFeedback
 * @param {string} [params.pinnedAdapter]
 * @returns {Promise<{
 *   done: boolean, output: object|null, errors: Array, adapterId: string|null,
 *   jobId: string, packReport: object|null, attempts: number
 * }>} done=true means it passed the gate; done=false means every attempt was
 *   exhausted and the caller must decide (P4 prune, clarify, or fail).
 */
export async function runRepairLoop({ chatId, role, buildSections, schema, gate, gateRepairFeedback, pinnedAdapter }) {
  const jobId = randomUUID().slice(0, 8);
  const startedAt = new Date().toISOString();
  await writeJobFile(chatId, jobId, 'job.json', { id: jobId, role, status: 'running', startedAt });

  let repairNote = '';
  let firstAdapterId = null;
  let lastOutput = null;
  let lastErrors = [];
  let lastPackReport = null;
  const totalAttempts = MAX_REPAIRS + 2; // 0..MAX_REPAIRS content repairs, +1 rung-escalation attempt

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const isEscalation = attempt === totalAttempts - 1;
    let rungs = ladder(pinnedAdapter);
    if (isEscalation && firstAdapterId) {
      rungs = rungs.filter((a) => a.id !== firstAdapterId);
      if (rungs.length === 0) rungs = ladder(pinnedAdapter);
    }

    const { text: prompt, report } = buildPack(buildSections(repairNote));
    lastPackReport = report;
    await writeJobFile(chatId, jobId, `pack-attempt-${attempt}.txt`, prompt);

    let raw, adapterId;
    try {
      ({ text: raw, adapterId } = await completeWithLadder(prompt, rungs, { chatId, phase: role, cwd: sandboxDir(chatId, jobId) }));
    } catch (e) {
      lastErrors = [{ code: 'NO_CAPACITY', detail: e.message, recoverable: false }];
      break; // nothing to repair — every rung is out of capacity
    }
    await writeJobFile(chatId, jobId, `raw-attempt-${attempt}.txt`, raw);
    if (attempt === 0) firstAdapterId = adapterId;

    const parsed = extractJson(raw);
    if (!parsed) {
      lastErrors = [{ code: 'SCHEMA_INVALID', detail: 'no parseable JSON found in model output', recoverable: true }];
      if (attempt < totalAttempts - 1) {
        repairNote = schemaRepairFeedback(lastErrors);
        await logRepair(chatId, role, jobId, attempt, lastErrors);
        continue;
      }
      break;
    }

    const zr = schema.safeParse(parsed);
    if (!zr.success) {
      lastErrors = zr.error.issues.map((iss) => ({ code: 'SCHEMA_INVALID', subject_id: iss.path.join('.'), detail: iss.message, recoverable: true }));
      lastOutput = parsed;
      if (attempt < totalAttempts - 1) {
        repairNote = schemaRepairFeedback(lastErrors);
        await logRepair(chatId, role, jobId, attempt, lastErrors);
        continue;
      }
      break;
    }

    lastOutput = zr.data;
    const gateResult = await gate(zr.data);
    lastErrors = gateResult.errors ?? [];
    if (gateResult.valid) {
      return { done: true, output: zr.data, errors: [], adapterId, jobId, packReport: report, attempt, startedAt };
    }

    if (attempt < totalAttempts - 1) {
      repairNote = gateRepairFeedback(gateResult.errors);
      await logRepair(chatId, role, jobId, attempt, gateResult.errors);
      continue;
    }
  }

  return { done: false, output: lastOutput, errors: lastErrors, adapterId: firstAdapterId, jobId, packReport: lastPackReport, startedAt };
}

async function logRepair(chatId, role, jobId, attempt, errors) {
  await appendChatLog(chatId, 'worklog.jsonl', { ts: Date.now(), phase: role, event: 'repair', detail: { jobId, attempt, errors } });
}

/** Writes the artifact, updates job.json, and logs the commit — the shared tail of
 * every successful (or gracefully-pruned) agent run. */
export async function commitArtifact({ chatId, role, jobId, startedAt, adapterId, output, gaps, packReport }) {
  const hash = await writeChatFile(chatId, `artifacts/${role}.json`, output);
  const savedTokens = packReport?.savedTokens ?? 0;
  await appendChatLog(chatId, 'worklog.jsonl', { ts: Date.now(), phase: role, event: 'committed', detail: { jobId, hash, gaps, savedTokens } });
  await writeJobFile(chatId, jobId, 'job.json', {
    id: jobId,
    role,
    status: 'passed',
    adapter: adapterId,
    startedAt,
    endedAt: new Date().toISOString(),
    hash,
    gaps,
    savedTokens,
  });
  return { status: 'passed', role, jobId, output, hash, gaps, savedTokens };
}

/** Marks the job failed and throws — the shared tail when a role has no P4 fallback
 * (or its fallback also couldn't produce a valid subset). */
export async function failJob({ chatId, role, jobId, startedAt, errors }) {
  await appendChatLog(chatId, 'worklog.jsonl', { ts: Date.now(), phase: role, event: 'exhausted', detail: { jobId, errors } });
  await writeJobFile(chatId, jobId, 'job.json', {
    id: jobId,
    role,
    status: 'failed',
    startedAt,
    endedAt: new Date().toISOString(),
    errors,
  });
  throw new Error(`${role} exhausted all repair attempts: ${errors.map((e) => e.code).join(', ') || 'unknown error'}`);
}
