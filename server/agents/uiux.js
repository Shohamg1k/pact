// Agent role: UI/UX. Reads pm's feature list and/or the architect's contract —
// whichever is present (registry.js: `requires: [['pm'], ['architect']]`, an OR). Never
// reads the brief directly.
import { readFile } from 'node:fs/promises';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta } from './engine.js';
import { UiuxOutputSchema } from '../schemas/uiux.js';
import { runGateUiux, repairFeedbackUiux, collectValidIds, pruneInvalidScreens } from '../gates/uiux.js';
import { getArtifact } from '../kernel/chats.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/uiux.md', import.meta.url), 'utf8');

/** @param {string} chatId @param {{pinnedAdapter?: string}} opts */
export async function runUiux(chatId, opts = {}) {
  const [pm, contract] = await Promise.all([getArtifact(chatId, 'pm'), getArtifact(chatId, 'architect')]);
  const validIds = collectValidIds(contract, pm);

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    contract ? { name: 'architecture', content: `## Solution Architect's contract\n\n${JSON.stringify(contract, null, 2)}` } : null,
    pm ? { name: 'pm', content: `## Product Manager's feature list\n\n${JSON.stringify(pm, null, 2)}` } : null,
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  const gate = async (uiux) => runGateUiux(validIds, uiux);

  const loopResult = await runRepairLoop({
    chatId,
    role: 'uiux',
    buildSections,
    schema: withForcedMeta(UiuxOutputSchema, { schema: 'uiux/v1', chatId }),
    gate,
    gateRepairFeedback: repairFeedbackUiux,
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    return finish(chatId, loopResult, loopResult.output, []);
  }

  if (loopResult.output) {
    const pruned = pruneInvalidScreens(loopResult.output, loopResult.errors);
    const candidate = pruned ? pruned.uiux : loopResult.output;
    if (candidate.screens.length > 0) {
      const gateResult = await runGateUiux(validIds, candidate);
      const remainingGaps = gateResult.errors.map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM)`);
      return finish(chatId, loopResult, candidate, [...(pruned?.gaps ?? []), ...remainingGaps]);
    }
  }

  await failJob({ chatId, role: 'uiux', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}

async function finish(chatId, loopResult, output, gaps) {
  const result = await commitArtifact({
    chatId,
    role: 'uiux',
    jobId: loopResult.jobId,
    startedAt: loopResult.startedAt,
    adapterId: loopResult.adapterId,
    output,
    gaps,
    packReport: loopResult.packReport,
  });
  return { status: 'passed', role: 'uiux', output, hash: result.hash, gaps, savedTokens: result.savedTokens };
}
