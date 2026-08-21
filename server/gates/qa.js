// Gate for the QA role. Test cases aren't code — nothing to syntax-check — so this is
// drift-only: every test case's implements[] must cite a real contract id, the same
// shared id space gates/v2.js established. (The schema itself already requires
// implements.min(1) — an empty citation is a schema failure, not a gate failure.)
import { collectContractIds } from './v2.js';

export function checkDrift(contract, qa) {
  const validIds = collectContractIds(contract);
  const errors = [];
  for (const tc of qa.test_cases) {
    for (const id of tc.implements) {
      if (!validIds.has(id)) {
        errors.push({ code: 'DRIFT_REJECTED', subject_id: tc.id, detail: `test case ${tc.id} cites unknown contract id "${id}"`, recoverable: true });
      }
    }
  }
  return errors;
}

export async function runGateQA(contract, qa) {
  const errors = checkDrift(contract, qa);
  return { valid: errors.length === 0, errors };
}

export function repairFeedbackQA(errors) {
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return 'Gate REJECTED the previous output with these EXACT errors. Fix only these issues:\n' + lines.join('\n');
}

/** P4 graceful partial — drop exactly the test cases named by DRIFT_REJECTED. */
export function pruneInvalidTestCases(qa, errors) {
  const dropIds = new Set(errors.filter((e) => e.code === 'DRIFT_REJECTED').map((e) => e.subject_id));
  if (dropIds.size === 0) return null;
  const test_cases = qa.test_cases.filter((tc) => !dropIds.has(tc.id));
  if (test_cases.length === 0) return null;
  const gaps = errors.filter((e) => dropIds.has(e.subject_id)).map((e) => `${e.code}: ${e.detail} (dropped, BLOCKED_ON_UPSTREAM)`);
  return { qa: { ...qa, test_cases }, gaps };
}
