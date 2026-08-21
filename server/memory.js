// Project memory (PRD §7, CORE-10): decisions, naming, stack preference persisted across
// runs of the SAME project — keyed by projectName in one file, `.pact/project-memory.json`
// (P3: files are truth). Pure file I/O, no model call. This is Builder B's memory.js from
// the repo layout (§6); the semantic dedupe cache (CTX-5) named in the same slot is
// deliberately NOT built here — it's first on the finale cut list (§22) and the run-to-run
// value is marginal until there's real multi-run traffic to dedupe against.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '.pact');
const FILE = path.join(ROOT, 'project-memory.json');

async function readAll() {
  if (!existsSync(FILE)) return {};
  return JSON.parse(await readFile(FILE, 'utf8'));
}

async function writeAll(data) {
  await mkdir(ROOT, { recursive: true });
  await writeFile(FILE, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Everything PACT has learned about this project across prior runs. Returns null for an
 * unnamed project — there is nothing stable to key memory on (PRD CORE-1: project name is
 * optional).
 * @param {string|null} projectName
 */
export async function readProjectMemory(projectName) {
  if (!projectName) return null;
  const all = await readAll();
  return all[projectName] ?? null;
}

/**
 * Folds a completed run's contract into project memory: the stack it settled on and any
 * assumptions the architect recorded, so the NEXT run of this project starts from them
 * instead of re-deriving from a silent brief every time. Additive — never drops a prior
 * decision, only appends and dedupes.
 * @param {string|null} projectName
 * @param {string} runId
 * @param {object} contract - the validated architecture contract
 */
export async function recordProjectMemory(projectName, runId, contract) {
  if (!projectName) return;
  const all = await readAll();
  const prior = all[projectName] ?? { stackPreference: null, decisions: [], runs: [] };
  const newDecisions = (contract.assumptions ?? []).map((a) => `${a.id}: ${a.statement} (confidence ${a.confidence})`);
  all[projectName] = {
    stackPreference: contract.stack ?? prior.stackPreference,
    decisions: [...new Set([...prior.decisions, ...newDecisions])],
    runs: [...new Set([...prior.runs, runId])],
    updatedAt: new Date().toISOString(),
  };
  await writeAll(all);
}

/**
 * Renders project memory as a pack section. Belongs in the STABLE prefix (CTX-2: role ->
 * schema -> few-shot -> project memory, then the volatile brief) so the cached prefix stays
 * byte-identical across runs of the same project until memory itself changes.
 * @returns {string|null} null when there is nothing to say yet (first run of a project)
 */
export function renderProjectMemory(memory) {
  if (!memory) return null;
  const lines = ['## Project memory (from prior runs of this project — treat as established, not up for re-litigation)'];
  if (memory.stackPreference) lines.push(`- Prior stack choice: ${JSON.stringify(memory.stackPreference)}`);
  if (memory.decisions?.length) {
    lines.push('- Prior decisions and assumptions:');
    for (const d of memory.decisions) lines.push(`  - ${d}`);
  }
  return lines.join('\n');
}
