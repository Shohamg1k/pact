// Agent 1 — Solution Architect (PRD §13 CORE-1..8). Brief in, validated architecture
// contract out. This is the ONLY place the brief and Agent 1's role prompt ever meet —
// Agent 2 never sees either (CORE-4).
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ladder, completeWithLadder } from '../router.js';
import { buildPack } from '../pack.js';
import { extractJson } from './extractJson.js';
import { deriveOpenApi, deriveMongoSchema, deriveDecisions } from './derive.js';
import {
  validateContract,
  repairFeedback,
  onlyUnderspecified,
  pruneInvalidElements,
} from '../kernel/validator.js';
import { runDir, writeArtifact, appendLog, readLog } from '../kernel/store.js';
import { askClarification } from '../kernel/interrupts.js';
import { readProjectMemory, recordProjectMemory, renderProjectMemory } from '../memory.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/architect.md', import.meta.url), 'utf8');
const MAX_REPAIRS = 2; // PRD §8.2: capped at 2 retries, then escalate the ladder rung

/**
 * @param {string} runId
 * @param {string} brief - VERBATIM, never paraphrased
 * @param {{mode?: 'interactive'|'batch', projectName?: string|null, pinnedAdapter?: string}} opts
 */
export async function runArchitect(runId, brief, opts = {}) {
  const mode = opts.mode ?? 'batch';
  const cwd = path.join(runDir(runId), 'sandbox-agent1'); // SEC-2: never the user's real repo

  let repairNote = '';
  let firstAdapterId = null;
  let lastResult = null;
  let lastRaw = null;

  // Prior rounds of clarification (if this is a resumed run) ride into every attempt as
  // a stable-ish section — they are the human's own answers, not model output.
  const answeredClarifications = await previousAnswers(runId);

  // CORE-10: decisions/naming/stack preference from prior runs of the SAME project. Placed
  // in the stable prefix (CTX-2) — it changes only between projects, not between attempts.
  const projectMemory = await readProjectMemory(opts.projectName ?? null);
  const memorySection = renderProjectMemory(projectMemory);

  // attempts 0..MAX_REPAIRS are same-rung content repairs; attempt MAX_REPAIRS+1 is the
  // "escalate the ladder rung" step — same repair note, a DIFFERENT adapter forced.
  const totalAttempts = MAX_REPAIRS + 2;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const isEscalation = attempt === totalAttempts - 1;
    let rungs = ladder(opts.pinnedAdapter); // ROUTE-8: pinned ?? laddered
    if (isEscalation && firstAdapterId) {
      rungs = rungs.filter((a) => a.id !== firstAdapterId);
      if (rungs.length === 0) rungs = ladder(opts.pinnedAdapter); // nothing else available — retry same rung anyway
    }

    const { text: prompt, report } = buildPack(
      [
        { name: 'role', content: ROLE_PROMPT },
        memorySection ? { name: 'project-memory', content: memorySection } : null,
        { name: 'brief', content: `## Client brief\n\n${brief}` },
        answeredClarifications
          ? { name: 'clarifications', content: `## Human answers to prior clarifying questions\n\n${answeredClarifications}` }
          : null,
        repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
      ].filter(Boolean),
    );

    await writeArtifact(runId, 'packs/agent1.txt', prompt);

    const { text: raw, adapterId } = await completeWithLadder(prompt, rungs, {
      runId,
      phase: 'agent1',
      cwd,
    });
    await writeArtifact(runId, `raw/agent1-attempt-${attempt}.txt`, raw);
    lastRaw = raw;
    if (attempt === 0) firstAdapterId = adapterId;

    const parsed = extractJson(raw);
    const result = parsed
      ? validateContract(parsed)
      : {
          valid: false,
          contract: null,
          errors: [{ code: 'SCHEMA_INVALID', detail: 'no parseable JSON found in model output', recoverable: true }],
        };
    lastResult = result;

    if (result.valid) {
      return commitContract(runId, result.contract, [], report, opts.projectName);
    }

    // Clarify-or-assume boundary: once schema/coverage/orphans all pass and completeness
    // is the ONLY remaining problem, stop repairing content — ask or accept (CORE-6).
    if (onlyUnderspecified(result.errors)) {
      if (mode === 'interactive') {
        const question = deriveClarifyingQuestion(result.contract, brief);
        const ask = await askClarification(runId, question, { attempt });
        if (ask.asked) {
          await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'agent1', event: 'awaiting_human', detail: { itemId: ask.item.id } });
          return { status: 'awaiting_human', item: ask.item, contract: result.contract };
        }
        // round cap already hit — fall through to accept with flagged assumptions
      }
      return commitContract(
        runId,
        result.contract,
        ['UNDERSPECIFIED: proceeding with every low-confidence assumption flagged'],
        report,
        opts.projectName,
      );
    }

    if (attempt < totalAttempts - 1) {
      repairNote = repairFeedback(result.errors);
      await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'agent1', event: 'repair', detail: { attempt, errors: result.errors } });
      continue;
    }
  }

  // Exhausted every attempt. P4: if the only remaining errors are droppable
  // (FEATURE_UNCOVERED/ORPHAN_ELEMENT), prune those exact elements and proceed on the
  // valid subset rather than failing the whole run.
  const parsedLast = extractJson(lastRaw ?? '');
  const pruned = parsedLast ? pruneInvalidElements(parsedLast, lastResult.errors) : null;
  if (pruned) {
    const revalidated = validateContract(pruned.contract);
    if (revalidated.valid || onlyUnderspecified(revalidated.errors)) {
      return commitContract(runId, revalidated.contract ?? pruned.contract, pruned.gaps, { savedTokens: 0 }, opts.projectName);
    }
  }

  await appendLog(runId, 'worklog.jsonl', {
    ts: Date.now(),
    phase: 'agent1',
    event: 'exhausted',
    detail: { errors: lastResult?.errors ?? [] },
  });
  throw new Error(`Agent 1 exhausted all repair attempts: ${(lastResult?.errors ?? []).map((e) => e.code).join(', ')}`);
}

/** Folds every already-answered clarification for this run into one text block. */
async function previousAnswers(runId) {
  const inbox = await readLog(runId, 'inbox.jsonl');
  const questions = inbox.filter((i) => i.type === 'clarification');
  const answers = new Map(inbox.filter((i) => i.type === 'clarification_answer').map((i) => [i.id, i.answer]));
  const pairs = questions
    .filter((q) => answers.has(q.id))
    .map((q) => `Q: ${q.payload.question}\nA: ${answers.get(q.id)}`);
  return pairs.length ? pairs.join('\n\n') : null;
}

function deriveClarifyingQuestion(contract, brief) {
  return (
    `The brief "${brief.slice(0, 140)}" is underspecified (completeness ${contract.meta.completeness_score}). ` +
    `What is the single most important missing constraint — auth/roles, expected scale, ` +
    `who approves what, or a required field the brief never mentioned?`
  );
}

async function commitContract(runId, contract, gaps, packReport, projectName) {
  const hash = await writeArtifact(runId, 'architecture.json', contract);
  await writeArtifact(runId, 'openapi.yaml', deriveOpenApi(contract));
  await writeArtifact(runId, 'schema.mongo.json', deriveMongoSchema(contract));
  await writeArtifact(runId, 'decisions.md', deriveDecisions(contract, gaps));
  const savedTokens = packReport?.savedTokens ?? 0;
  await appendLog(runId, 'worklog.jsonl', {
    ts: Date.now(),
    phase: 'agent1',
    event: 'committed',
    detail: { hash, gaps, savedTokens },
  });
  await recordProjectMemory(projectName ?? null, runId, contract); // CORE-10
  return { status: 'passed', contract, hash, gaps, savedTokens };
}
