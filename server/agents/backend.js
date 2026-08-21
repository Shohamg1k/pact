// Agent role: Backend Engineer (PRD §13 CORE-4, §16 VER-2). Reads the architect's
// artifact VERBATIM and only that — never the brief, never any other role's output
// (CORE-4, registry.js: backend's `reads` is exactly ['architect']). Thin config
// module on top of agents/engine.js's shared repair loop.
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta, MAX_REPAIRS } from './engine.js';
import { BackendManifestSchema } from '../schemas/backend.js';
import { runGateV2, repairFeedbackV2, pruneInvalidModules } from '../gates/v2.js';
import { runBootCheck } from '../runner.js';
import { readChatFile, chatDir } from '../kernel/chats.js';
import { resolveStack } from '../stacks.js';

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

  // CORE-8: the stack is DATA. Everything downstream — the gate's route extraction, the
  // syntax checker, the runner's install/start commands — keys off this same profile, so
  // the prompt must state it explicitly rather than leaving the model to infer a stack.
  const stack = resolveStack(contract);
  const stackBlock = [
    `## Target stack (authoritative — the gate and runner both use this profile)`,
    ``,
    `- Stack: **${stack.label}** (id \`${stack.id}\`)`,
    `- Entry file: \`${stack.entryDefault}\``,
    `- Dependency manifest: \`${stack.manifestFile}\``,
    `- File languages allowed: ${stack.languages.map((l) => `\`${l}\``).join(', ')}`,
    ``,
    ...stack.promptRules.map((r) => `- ${r}`),
  ].join('\n');

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    { name: 'stack', content: stackBlock },
    // The ONLY data content in this pack is the architect's artifact, verbatim — never
    // the brief (CORE-4). Provable by hash equality + grep (T3).
    { name: 'contract', content: architectureRaw },
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  // VER-3 (PRD §16): tier 3 (boot) runs only after tiers 1 (syntax) and 2
  // (coverage/drift/conformance) already pass — cheap before expensive (P6). runBootCheck
  // returns the same {valid, errors} shape as runGateV2, so a non-boot manifest re-enters
  // engine.js's SAME bounded repair loop exactly like a tier-1/2 failure, rather than a
  // separate unbounded retry path. The boot directory lives under this chat's OWN dir
  // (never hardcoded inside runner.js itself — see runner.js's file header).
  const gate = async (manifest) => {
    const structural = await runGateV2(contract, manifest);
    if (!structural.valid) return structural;
    const bootDir = path.join(chatDir(chatId), 'boot-check');
    return runBootCheck(bootDir, contract, manifest);
  };

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
      // Only re-checks tiers 1+2 (pruneInvalidModules never drops anything for BOOT_FAIL,
      // since that's not a per-file error) — a persistent BOOT_FAIL from loopResult.errors
      // must be folded in explicitly, or a manifest that never once booted would commit
      // looking indistinguishable from one that passed (CORE-7/P4: never a silent hole).
      const gateResult = await runGateV2(contract, candidate);
      const remainingGaps = gateResult.errors.map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM)`);
      const bootGaps = (loopResult.errors ?? [])
        .filter((e) => e.code === 'BOOT_FAIL')
        .map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM — server never booted after ${MAX_REPAIRS} repair attempts)`);
      return finish(chatId, loopResult, candidate, [...(pruned?.gaps ?? []), ...remainingGaps, ...bootGaps]);
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
