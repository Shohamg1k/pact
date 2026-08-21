// Agent role: Frontend. Reads uiux's screens/flows AND backend's API contracts —
// registry.js: `requires: [['uiux', 'backend']]`, both. Never the brief, never the
// architect's contract directly (drift is still checked against the architect's id
// space via gates/frontend.js, but the PACK content is the two upstream artifacts).
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta } from './engine.js';
import { FrontendManifestSchema } from '../schemas/frontend.js';
import { runGateFrontend, repairFeedbackFrontend, pruneInvalidModules } from '../gates/frontend.js';
import { readChatFile, getArtifact } from '../kernel/chats.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/frontend.md', import.meta.url), 'utf8');

/** @param {string} chatId @param {{pinnedAdapter?: string}} opts */
export async function runFrontend(chatId, opts = {}) {
  const contract = await getArtifact(chatId, 'architect'); // for the drift id space only, not the pack
  const uiux = await getArtifact(chatId, 'uiux');
  const backendRaw = await readChatFile(chatId, 'artifacts/backend.json');
  const backendHash = 'sha256:' + crypto.createHash('sha256').update(backendRaw).digest('hex');

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    { name: 'uiux', content: `## UI/UX screens and flows\n\n${JSON.stringify(uiux, null, 2)}` },
    { name: 'backend', content: `## Backend API contracts\n\n${backendRaw}` },
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  const gate = async (frontend) => runGateFrontend(contract, frontend);

  const loopResult = await runRepairLoop({
    chatId,
    role: 'frontend',
    buildSections,
    schema: withForcedMeta(FrontendManifestSchema, { schema: 'frontend/v1', chatId, backendHash }),
    gate,
    gateRepairFeedback: repairFeedbackFrontend,
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    return finish(chatId, loopResult, loopResult.output, []);
  }

  if (loopResult.output) {
    const pruned = pruneInvalidModules(loopResult.output, loopResult.errors);
    const candidate = pruned ? pruned.frontend : loopResult.output;
    if (candidate.modules.length > 0) {
      const gateResult = await runGateFrontend(contract, candidate);
      const remainingGaps = gateResult.errors.map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM)`);
      return finish(chatId, loopResult, candidate, [...(pruned?.gaps ?? []), ...remainingGaps]);
    }
  }

  await failJob({ chatId, role: 'frontend', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}

async function finish(chatId, loopResult, output, gaps) {
  const result = await commitArtifact({
    chatId,
    role: 'frontend',
    jobId: loopResult.jobId,
    startedAt: loopResult.startedAt,
    adapterId: loopResult.adapterId,
    output,
    gaps,
    packReport: loopResult.packReport,
  });
  return { status: 'passed', role: 'frontend', output, hash: result.hash, gaps, savedTokens: result.savedTokens };
}
