// Gate for the Frontend role. Tier 1 (syntax, gates/verify.js) first — cheapest before
// expensive (P6) — then drift: every module cites >=1 real contract id, the same
// shared id space gates/v2.js already established (collectContractIds), so "real id"
// means the same thing regardless of which role is citing it. Deliberately does NOT
// attempt to verify that fetch/axios call paths in the code match backend routes —
// that would need fragile regex-heuristics over arbitrary JS; scoped out rather than
// built unreliable.
import { verifyArtifacts, repairFeedback as tier1RepairFeedback } from './verify.js';
import { collectContractIds } from './v2.js';

function moduleFiles(frontend) {
  return [
    ...frontend.modules.map((m) => ({ path: m.path, content: m.code })),
    { path: 'package.json', content: JSON.stringify(frontend.package_json, null, 2) },
  ];
}

export async function runTier1(frontend) {
  const result = await verifyArtifacts(moduleFiles(frontend));
  if (result.ok) return { valid: true, errors: [] };
  const errors = result.issues.map((i) => ({
    code: 'TIER1_PARSE_FAIL',
    subject_id: i.file,
    detail: i.line ? `${i.file}:${i.line}${i.column != null ? `:${i.column}` : ''} — ${i.message}` : `${i.file} — ${i.message}`,
    recoverable: true,
  }));
  return { valid: false, errors };
}

export function checkDrift(contract, frontend) {
  const validIds = collectContractIds(contract);
  const errors = [];
  for (const m of frontend.modules) {
    const impl = m.implements ?? [];
    if (impl.length === 0) {
      errors.push({ code: 'DRIFT_REJECTED', subject_id: m.path, detail: `${m.path} has an empty implements[] — cites nothing in the contract`, recoverable: true });
      continue;
    }
    for (const id of impl) {
      if (!validIds.has(id)) {
        errors.push({ code: 'DRIFT_REJECTED', subject_id: m.path, detail: `${m.path} cites unknown contract id "${id}"`, recoverable: true });
      }
    }
  }
  return errors;
}

export async function runGateFrontend(contract, frontend) {
  const t1 = await runTier1(frontend);
  if (!t1.valid) return { valid: false, errors: t1.errors, tier: 1 };
  const driftErrors = checkDrift(contract, frontend);
  return { valid: driftErrors.length === 0, errors: driftErrors, tier: driftErrors.length ? 2 : 0 };
}

export function repairFeedbackFrontend(errors) {
  if (errors.length && errors[0].code === 'TIER1_PARSE_FAIL') {
    return tier1RepairFeedback({ ok: false, checked: errors.length, issues: errors.map((e) => ({ file: e.subject_id, message: e.detail })) });
  }
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return 'Gate REJECTED the previous output with these EXACT errors. Fix only these issues:\n' + lines.join('\n');
}

/** P4 graceful partial — drop exactly the modules named by DRIFT_REJECTED/TIER1_PARSE_FAIL. */
export function pruneInvalidModules(frontend, errors) {
  const dropPaths = new Set(errors.filter((e) => e.code === 'DRIFT_REJECTED' || e.code === 'TIER1_PARSE_FAIL').map((e) => e.subject_id));
  if (dropPaths.size === 0) return null;
  const modules = frontend.modules.filter((m) => !dropPaths.has(m.path));
  if (modules.length === 0) return null;
  const gaps = errors.filter((e) => dropPaths.has(e.subject_id)).map((e) => `${e.code}: ${e.detail} (dropped, BLOCKED_ON_UPSTREAM)`);
  return { frontend: { ...frontend, modules }, gaps };
}
