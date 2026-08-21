// Agent 2 — Backend Engineer (PRD §13 CORE-4, §16 VER-2). Reads architecture.json VERBATIM
// and only architecture.json — never the brief (CORE-4). This is the second and last place
// a model is called; everything downstream (trace, provenance, runner, connectors) is
// deterministic code.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ladder, completeWithLadder } from '../router.js';
import { buildPack } from '../pack.js';
import { extractJson } from './extractJson.js';
import { BackendManifestSchema } from '../schemas/backend.js';
import { runGateV2, repairFeedbackV2, pruneInvalidModules } from '../gates/v2.js';
import { runBootCheck } from '../runner.js';
import { runDir, writeArtifact, appendLog, readArtifact } from '../kernel/store.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/backend.md', import.meta.url), 'utf8');
const MAX_REPAIRS = 2; // PRD §8.2/§16: capped at 2 retries, then escalate the ladder rung

/**
 * @param {string} runId
 * @param {object} contract - the VALIDATED architecture contract (kernel `read` never
 *   returns unvalidated artifacts — PRD §8.3)
 * @param {{pinnedAdapter?: string}} opts
 */
export async function runBackend(runId, contract, opts = {}) {
  const cwd = path.join(runDir(runId), 'sandbox-agent2'); // SEC-2: never the user's real repo

  // Read the EXACT bytes written to disk at Gate V1 commit time, never a re-serialization
  // of the JS object — that is what makes byte-identity (CORE-4's acceptance test) provable.
  const architectureRaw = await readArtifact(runId, 'architecture.json');
  const contractHash = 'sha256:' + crypto.createHash('sha256').update(architectureRaw).digest('hex');

  let repairNote = '';
  let firstAdapterId = null;
  let lastManifest = null;
  let lastErrors = null;
  let lastRaw = null;

  const totalAttempts = MAX_REPAIRS + 2;

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    const isEscalation = attempt === totalAttempts - 1;
    let rungs = ladder(opts.pinnedAdapter); // ROUTE-8: pinned ?? laddered
    if (isEscalation && firstAdapterId) {
      rungs = rungs.filter((a) => a.id !== firstAdapterId);
      if (rungs.length === 0) rungs = ladder(opts.pinnedAdapter);
    }

    const { text: prompt, report } = buildPack(
      [
        { name: 'role', content: ROLE_PROMPT },
        // The ONLY data content in this pack is architecture.json, verbatim — never the
        // brief (CORE-4). Provable by hash equality + grep (T3).
        { name: 'contract', content: architectureRaw },
        repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
      ].filter(Boolean),
    );

    await writeArtifact(runId, 'packs/agent2.txt', prompt);

    const { text: raw, adapterId } = await completeWithLadder(prompt, rungs, { runId, phase: 'agent2', cwd });
    await writeArtifact(runId, `raw/agent2-attempt-${attempt}.txt`, raw);
    lastRaw = raw;
    if (attempt === 0) firstAdapterId = adapterId;

    const parsed = extractJson(raw);
    if (!parsed) {
      lastErrors = [{ code: 'SCHEMA_INVALID', detail: 'no parseable JSON found in model output', recoverable: true }];
      if (attempt < totalAttempts - 1) {
        repairNote = repairFeedbackSchema(lastErrors);
        await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'agent2', event: 'repair', detail: { attempt, errors: lastErrors } });
        continue;
      }
      break;
    }

    // meta is deterministic, never trusted from the model — this is what makes the CORE-4
    // acceptance test (contractHash == sha256(architecture.json)) true unconditionally.
    parsed.meta = { ...parsed.meta, schema: 'backend/v1', runId, contractHash };

    const zr = BackendManifestSchema.safeParse(parsed);
    if (!zr.success) {
      lastErrors = zr.error.issues.map((iss) => ({
        code: 'SCHEMA_INVALID',
        subject_id: iss.path.join('.'),
        detail: iss.message,
        recoverable: true,
      }));
      if (attempt < totalAttempts - 1) {
        repairNote = repairFeedbackSchema(lastErrors);
        await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'agent2', event: 'repair', detail: { attempt, errors: lastErrors } });
        continue;
      }
      break;
    }

    const manifest = zr.data;
    lastManifest = manifest;

    const gateResult = await runGateV2(contract, manifest);
    lastErrors = gateResult.errors;

    if (gateResult.valid) {
      // VER-3 (PRD §16): tier 3 (boot) runs only after tiers 1 (syntax) and 2
      // (coverage/drift/conformance) already passed — cheap before expensive (P6). A
      // manifest that fails to boot re-enters this SAME bounded repair loop, exactly like
      // a tier-1/2 failure, rather than a separate unbounded retry path.
      const bootDir = path.join(runDir(runId), 'boot-check'); // caller owns the path (runner.js takes it as a param)
      const bootResult = await runBootCheck(bootDir, contract, manifest);
      if (bootResult.valid) {
        return commitBackend(runId, manifest, [], report);
      }
      lastErrors = bootResult.errors;
      await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'agent2', event: 'boot_fail', detail: { attempt, errors: bootResult.errors } });
    }

    if (attempt < totalAttempts - 1) {
      repairNote = repairFeedbackV2(lastErrors);
      await appendLog(runId, 'worklog.jsonl', { ts: Date.now(), phase: 'agent2', event: 'repair', detail: { attempt, errors: lastErrors } });
      continue;
    }
  }

  // Exhausted every attempt. P4: drop exactly the modules named by DRIFT_REJECTED /
  // TIER1_PARSE_FAIL and proceed with the valid subset; anything else unresolved (coverage,
  // conformance) is recorded as a gap rather than blocking the run (CORE-7).
  if (lastManifest) {
    const pruned = pruneInvalidModules(lastManifest, lastErrors ?? []);
    const candidate = pruned ? pruned.backend : lastManifest;
    if (candidate.modules.length > 0) {
      const gateResult = await runGateV2(contract, candidate);
      const remainingGaps = gateResult.errors.map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM)`);
      // Structural tiers 1+2 don't re-check boot — a persistent BOOT_FAIL from lastErrors
      // must be carried into the gap list explicitly, or a manifest that never once
      // booted would commit looking indistinguishable from one that passed (CORE-7/P4:
      // never a silent hole).
      const bootGaps = (lastErrors ?? [])
        .filter((e) => e.code === 'BOOT_FAIL')
        .map((e) => `${e.code}: ${e.detail} (BLOCKED_ON_UPSTREAM — server never booted after ${MAX_REPAIRS} repair attempts)`);
      const allGaps = [...(pruned?.gaps ?? []), ...remainingGaps, ...bootGaps];
      return commitBackend(runId, candidate, allGaps, { savedTokens: 0 });
    }
  }

  await appendLog(runId, 'worklog.jsonl', {
    ts: Date.now(),
    phase: 'agent2',
    event: 'exhausted',
    detail: { errors: lastErrors ?? [] },
  });
  throw new Error(`Agent 2 exhausted all repair attempts: ${(lastErrors ?? []).map((e) => e.code).join(', ')}`);
}

function repairFeedbackSchema(errors) {
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return (
    'The previous output failed schema validation with these EXACT errors. Return the ' +
    'complete corrected backend/v1 JSON object; fix only these issues:\n' +
    lines.join('\n')
  );
}

async function commitBackend(runId, manifest, gaps, packReport) {
  const hash = await writeArtifact(runId, 'backend.json', manifest);
  const savedTokens = packReport?.savedTokens ?? 0;
  await appendLog(runId, 'worklog.jsonl', {
    ts: Date.now(),
    phase: 'agent2',
    event: 'committed',
    detail: { hash, gaps, savedTokens },
  });
  return { status: 'passed', manifest, hash, gaps, savedTokens };
}
