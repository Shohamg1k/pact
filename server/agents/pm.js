// Agent role: Product Manager. Reads the brief; produces personas + a prioritised
// feature list (registry.js: `requires: []`, a valid entry point). Schema-only gate —
// no code is produced, nothing to syntax-check or drift-check against yet (there's no
// contract id space until the Architect runs).
import { readFile } from 'node:fs/promises';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta } from './engine.js';
import { PMOutputSchema } from '../schemas/pm.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/pm.md', import.meta.url), 'utf8');

/** @param {string} chatId @param {string} brief @param {{pinnedAdapter?: string}} opts */
export async function runPM(chatId, brief, opts = {}) {
  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    { name: 'brief', content: `## Client brief\n\n${brief}` },
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  const loopResult = await runRepairLoop({
    chatId,
    role: 'pm',
    buildSections,
    schema: withForcedMeta(PMOutputSchema, { schema: 'pm/v1', chatId }),
    gate: async () => ({ valid: true, errors: [] }), // schema pass is the whole gate for this role
    gateRepairFeedback: () => '',
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    const result = await commitArtifact({
      chatId,
      role: 'pm',
      jobId: loopResult.jobId,
      startedAt: loopResult.startedAt,
      adapterId: loopResult.adapterId,
      output: loopResult.output,
      gaps: [],
      packReport: loopResult.packReport,
    });
    return { status: 'passed', role: 'pm', output: loopResult.output, hash: result.hash, gaps: [], savedTokens: result.savedTokens };
  }

  await failJob({ chatId, role: 'pm', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}
