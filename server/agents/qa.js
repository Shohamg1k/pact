// Agent role: QA. Reads backend (required — registry.js: `requires: [['backend']]`)
// plus whichever of pm/architect/frontend also exist. Generates test cases; running
// them against a live server is runner.js's job (feat/runner-connectors), not this one.
import { readFile } from 'node:fs/promises';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta } from './engine.js';
import { QAOutputSchema } from '../schemas/qa.js';
import { runGateQA, repairFeedbackQA, pruneInvalidTestCases } from '../gates/qa.js';
import { getArtifact } from '../kernel/chats.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/qa.md', import.meta.url), 'utf8');

/** @param {string} chatId @param {{pinnedAdapter?: string}} opts */
export async function runQA(chatId, opts = {}) {
  const [contract, pm, backend, frontend] = await Promise.all([
    getArtifact(chatId, 'architect'),
    getArtifact(chatId, 'pm'),
    getArtifact(chatId, 'backend'),
    getArtifact(chatId, 'frontend'),
  ]);

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    contract ? { name: 'architecture', content: `## Contract\n\n${JSON.stringify(contract, null, 2)}` } : null,
    pm ? { name: 'pm', content: `## Product Manager's feature list\n\n${JSON.stringify(pm, null, 2)}` } : null,
    { name: 'backend', content: `## Backend\n\n${JSON.stringify(backend, null, 2)}` },
    frontend ? { name: 'frontend', content: `## Frontend\n\n${JSON.stringify(frontend, null, 2)}` } : null,
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  const gate = async (qa) => runGateQA(contract, qa);

  const loopResult = await runRepairLoop({
    chatId,
    role: 'qa',
    buildSections,
    schema: withForcedMeta(QAOutputSchema, { schema: 'qa/v1', chatId }),
    gate,
    gateRepairFeedback: repairFeedbackQA,
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    return finish(chatId, loopResult, loopResult.output, []);
  }

  if (loopResult.output) {
    const pruned = pruneInvalidTestCases(loopResult.output, loopResult.errors);
    const candidate = pruned ? pruned.qa : loopResult.output;
    if (candidate.test_cases.length > 0) {
      const gateResult = await runGateQA(contract, candidate);
      const remainingGaps = gateResult.errors.map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM)`);
      return finish(chatId, loopResult, candidate, [...(pruned?.gaps ?? []), ...remainingGaps]);
    }
  }

  await failJob({ chatId, role: 'qa', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}

async function finish(chatId, loopResult, output, gaps) {
  const result = await commitArtifact({
    chatId,
    role: 'qa',
    jobId: loopResult.jobId,
    startedAt: loopResult.startedAt,
    adapterId: loopResult.adapterId,
    output,
    gaps,
    packReport: loopResult.packReport,
  });
  return { status: 'passed', role: 'qa', output, hash: result.hash, gaps, savedTokens: result.savedTokens };
}
