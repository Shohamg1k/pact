// Agent role: Solution Architect (PRD §13 CORE-1..8). Brief in (or a Product Manager's
// feature list, when pm was also run — registry.js), validated architecture contract
// out. Thin config module on top of agents/engine.js's shared repair loop; the one bit
// of role-specific logic that stays here is CORE-6 clarify-or-assume, which no other
// role needs (yet), so it isn't in the generic engine.
import { readFile } from 'node:fs/promises';
import { runRepairLoop, commitArtifact, failJob } from './engine.js';
import { deriveOpenApi, deriveMongoSchema, deriveDecisions } from './derive.js';
import { ArchitectureContractSchema } from '../schemas/contract.js';
import { validateContract, onlyUnderspecified, pruneInvalidElements, repairFeedback } from '../kernel/validator.js';
import { writeChatFile, appendChatLog, readChatLog, getArtifact } from '../kernel/chats.js';
import { askClarification } from '../kernel/interrupts.js';
import { recordProjectMemory } from '../memory.js';

const ROLE_PROMPT = await readFile(new URL('../prompts/architect.md', import.meta.url), 'utf8');

/**
 * @param {string} chatId
 * @param {string} brief - VERBATIM, never paraphrased
 * @param {{mode?: 'interactive'|'batch', projectName?: string|null, pinnedAdapter?: string}} opts
 */
export async function runArchitect(chatId, brief, opts = {}) {
  const mode = opts.mode ?? 'batch';
  const answeredClarifications = await previousAnswers(chatId);
  const pmOutput = await getArtifact(chatId, 'pm'); // registry.js: architect reads pm's output when present

  const buildSections = (repairNote) => [
    { name: 'role', content: ROLE_PROMPT },
    pmOutput ? { name: 'pm', content: `## Product Manager's feature list (structured, use this over re-deriving from the brief)\n\n${JSON.stringify(pmOutput, null, 2)}` } : null,
    { name: 'brief', content: `## Client brief\n\n${brief}` },
    answeredClarifications ? { name: 'clarifications', content: `## Human answers to prior clarifying questions\n\n${answeredClarifications}` } : null,
    repairNote ? { name: 'repair', content: repairNote, budget: 2000, policy: 'head' } : null,
  ].filter(Boolean);

  // The engine's gate treats "only UNDERSPECIFIED" as a pass-through (valid:true) —
  // that's not a repairable defect, it's CORE-6's ask-or-assume signal, decided AFTER
  // the loop returns, not by spending more repair attempts on it.
  const gate = async (contract) => {
    const result = validateContract(contract);
    if (result.valid || onlyUnderspecified(result.errors)) return { valid: true, errors: [] };
    return { valid: false, errors: result.errors };
  };

  const loopResult = await runRepairLoop({
    chatId,
    role: 'architect',
    buildSections,
    schema: ArchitectureContractSchema,
    gate,
    gateRepairFeedback: repairFeedback,
    pinnedAdapter: opts.pinnedAdapter,
  });

  if (loopResult.done) {
    const revalidated = validateContract(loopResult.output);
    if (revalidated.valid) {
      return commit(chatId, loopResult, revalidated.contract, [], opts.projectName);
    }
    // onlyUnderspecified — CORE-6: ask ONE question (interactive) or proceed flagged (batch).
    if (mode === 'interactive') {
      const question = deriveClarifyingQuestion(revalidated.contract, brief);
      const ask = await askClarification(chatId, question, { jobId: loopResult.jobId });
      if (ask.asked) {
        await appendChatLog(chatId, 'worklog.jsonl', { ts: Date.now(), phase: 'architect', event: 'awaiting_human', detail: { itemId: ask.item.id, question } });
        return { status: 'awaiting_human', item: ask.item, contract: revalidated.contract };
      }
      // round cap already hit — fall through to accept with flagged assumptions
    }
    return commit(chatId, loopResult, revalidated.contract, ['UNDERSPECIFIED: proceeding with every low-confidence assumption flagged'], opts.projectName);
  }

  // Exhausted every attempt. P4: if the only remaining errors are droppable
  // (FEATURE_UNCOVERED/ORPHAN_ELEMENT), prune those exact elements and proceed on the
  // valid subset rather than failing the whole chat.
  const pruned = loopResult.output ? pruneInvalidElements(loopResult.output, loopResult.errors) : null;
  if (pruned) {
    const revalidated = validateContract(pruned.contract);
    if (revalidated.valid || onlyUnderspecified(revalidated.errors)) {
      return commit(chatId, loopResult, revalidated.contract ?? pruned.contract, pruned.gaps, opts.projectName);
    }
  }

  await failJob({ chatId, role: 'architect', jobId: loopResult.jobId, startedAt: loopResult.startedAt, errors: loopResult.errors });
}

/** Folds every already-answered clarification for this chat into one text block. */
async function previousAnswers(chatId) {
  const inbox = await readChatLog(chatId, 'inbox.jsonl');
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

async function commit(chatId, loopResult, contract, gaps, projectName) {
  const result = await commitArtifact({
    chatId,
    role: 'architect',
    jobId: loopResult.jobId,
    startedAt: loopResult.startedAt,
    adapterId: loopResult.adapterId,
    output: contract,
    gaps,
    packReport: loopResult.packReport,
  });
  await writeChatFile(chatId, 'openapi.yaml', deriveOpenApi(contract));
  await writeChatFile(chatId, 'schema.mongo.json', deriveMongoSchema(contract));
  await writeChatFile(chatId, 'decisions.md', deriveDecisions(contract, gaps));
  await recordProjectMemory(projectName ?? null, chatId, contract); // CORE-10
  return { status: 'passed', role: 'architect', contract, hash: result.hash, gaps, savedTokens: result.savedTokens };
}
