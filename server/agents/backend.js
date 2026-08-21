// Agent role: Backend Engineer (PRD §13 CORE-4, §16 VER-2). Reads the architect's
// artifact VERBATIM and only that — never the brief, never any other role's output
// (CORE-4, registry.js: backend's `reads` is exactly ['architect']). Thin config
// module on top of agents/engine.js's shared repair loop.
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta } from './engine.js';
import { BackendManifestSchema } from '../schemas/backend.js';
import { runGateV2, repairFeedbackV2, pruneInvalidModules } from '../gates/v2.js';
import { readChatFile } from '../kernel/chats.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/backend.md', import.meta.url), 'utf8');

/**
 * @param {string} chatId
 * @param {object} contract - the architect's VALIDATED artifact (kernel `read` never
 *   returns an unvalidated one — PRD §8.3)
 * @param {{pinnedAdapter?: string}} opts
 */
export async function runBackend(chatId, contract, opts = {}) {
  // Read the EXACT bytes committed to disk, never a re-serialization of the JS object —
  // that is what makes byte-identity (CORE-4's acceptance test) provable.
  const architectureRaw = await readChatFile(chatId, 'artifacts/architect.json');
  const contractHash = 'sha256:' + crypto.createHash('sha256').update(architectureRaw).digest('hex');

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    // The ONLY data content in this pack is the architect's artifact, verbatim — never
    // the brief (CORE-4). Provable by hash equality + grep (T3).
    { name: 'contract', content: architectureRaw },
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  const gate = async (manifest) => runGateV2(contract, manifest);

  const loopResult = await runRepairLoop({
    chatId,
    role: 'backend',
    buildSections,
    schema: withForcedMeta(BackendManifestSchema, { schema: 'backend/v1', runId: chatId, contractHash }),
    gate,
    gateRepairFeedback: repairFeedbackV2,
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    return finish(chatId, loopResult, loopResult.output, []);
  }

  // Exhausted. P4: drop exactly the modules named by DRIFT_REJECTED / TIER1_PARSE_FAIL
  // and proceed with the valid subset (CORE-7); anything else unresolved (coverage,
  // conformance) is recorded as a gap rather than blocking the chat.
  if (loopResult.output) {
    const pruned = pruneInvalidModules(loopResult.output, loopResult.errors);
    const candidate = pruned ? pruned.backend : loopResult.output;
    if (candidate.modules.length > 0) {
      const gateResult = await runGateV2(contract, candidate);
      const remainingGaps = gateResult.errors.map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM)`);
      return finish(chatId, loopResult, candidate, [...(pruned?.gaps ?? []), ...remainingGaps]);
    }
  }

  await failJob({ chatId, role: 'backend', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}

async function finish(chatId, loopResult, manifest, gaps) {
  const result = await commitArtifact({
    chatId,
    role: 'backend',
    jobId: loopResult.jobId,
    startedAt: loopResult.startedAt,
    adapterId: loopResult.adapterId,
    output: manifest,
    gaps,
    packReport: loopResult.packReport,
  });
  return { status: 'passed', role: 'backend', manifest, hash: result.hash, gaps, savedTokens: result.savedTokens };
}
