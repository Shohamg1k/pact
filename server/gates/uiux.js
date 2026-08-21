// Gate for the UI/UX role. Same drift-only shape as gates/qa.js — no code, no syntax
// tier. The valid id space here depends on which upstream artifacts uiux actually
// received (architect's contract ids, PM's PMF-xx ids, or both), so the caller
// (agents/uiux.js) computes it and passes it in rather than this file reaching into
// storage itself (gates/ imports no model client AND no storage — pure functions only).
export function collectValidIds(contract, pm) {
  const ids = new Set();
  if (contract) {
    for (const f of contract.features) ids.add(f.id);
    for (const a of contract.apis) ids.add(a.id);
  }
  if (pm) {
    for (const f of pm.features) ids.add(f.id);
  }
  return ids;
}

export function checkDrift(validIds, uiux) {
  const errors = [];
  for (const s of uiux.screens) {
    const impl = s.implements ?? [];
    if (impl.length === 0) {
      errors.push({ code: 'DRIFT_REJECTED', subject_id: s.path, detail: `${s.path} has an empty implements[] — cites nothing given`, recoverable: true });
      continue;
    }
    for (const id of impl) {
      if (!validIds.has(id)) {
        errors.push({ code: 'DRIFT_REJECTED', subject_id: s.path, detail: `${s.path} cites unknown id "${id}"`, recoverable: true });
      }
    }
  }
  return errors;
}

export async function runGateUiux(validIds, uiux) {
  const errors = checkDrift(validIds, uiux);
  return { valid: errors.length === 0, errors };
}

export function repairFeedbackUiux(errors) {
  const lines = errors.map((e) => `- [${e.code}] ${e.subject_id ?? ''}: ${e.detail}`);
  return 'Gate REJECTED the previous output with these EXACT errors. Fix only these issues:\n' + lines.join('\n');
}

/** P4 graceful partial — drop exactly the screens named by DRIFT_REJECTED. */
export function pruneInvalidScreens(uiux, errors) {
  const dropPaths = new Set(errors.filter((e) => e.code === 'DRIFT_REJECTED').map((e) => e.subject_id));
  if (dropPaths.size === 0) return null;
  const screens = uiux.screens.filter((s) => !dropPaths.has(s.path));
  if (screens.length === 0) return null;
  const gaps = errors.filter((e) => dropPaths.has(e.subject_id)).map((e) => `${e.code}: ${e.detail} (dropped, BLOCKED_ON_UPSTREAM)`);
  return { uiux: { ...uiux, screens }, gaps };
}
