// Agent role: Documentation. Reads whatever other roles have produced (registry.js:
// `requires` at least one). Pure text synthesis — schema-only gate, no P4 prune (a
// technical spec / user guide isn't a list of droppable citable units).
import { readFile } from 'node:fs/promises';
import { runRepairLoop, commitArtifact, failJob, withForcedMeta } from './engine.js';
import { DocsOutputSchema } from '../schemas/docs.js';
import { getArtifact, writeChatFile } from '../kernel/chats.js';
import { ROLE_IDS, ROLE_LABELS } from './registry.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/docs.md', import.meta.url), 'utf8');

/** @param {string} chatId @param {{pinnedAdapter?: string}} opts */
export async function runDocs(chatId, opts = {}) {
  const available = {};
  for (const role of ROLE_IDS) {
    if (role === 'docs') continue;
    const a = await getArtifact(chatId, role);
    if (a) available[role] = a;
  }

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    ...Object.entries(available).map(([role, artifact]) => ({
      name: role,
      content: `## ${ROLE_LABELS[role]}'s output\n\n${JSON.stringify(artifact, null, 2)}`,
    })),
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  const loopResult = await runRepairLoop({
    chatId,
    role: 'docs',
    buildSections,
    schema: withForcedMeta(DocsOutputSchema, { schema: 'docs/v1', chatId }),
    gate: async () => ({ valid: true, errors: [] }),
    gateRepairFeedback: () => '',
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    const result = await commitArtifact({
      chatId,
      role: 'docs',
      jobId: loopResult.jobId,
      startedAt: loopResult.startedAt,
      adapterId: loopResult.adapterId,
      output: loopResult.output,
      gaps: [],
      packReport: loopResult.packReport,
    });
    await writeChatFile(chatId, 'technical-spec.md', loopResult.output.technical_spec);
    await writeChatFile(chatId, 'user-guide.md', loopResult.output.user_guide);
    return { status: 'passed', role: 'docs', output: loopResult.output, hash: result.hash, gaps: [], savedTokens: result.savedTokens };
  }

  await failJob({ chatId, role: 'docs', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}
