// The security boundary (PRD §11, §19 SEC-1). Every mutating route passes through here,
// regardless of client (web, CLI, curl) — a new mutating route without gate coverage
// must fail the CI grep once one exists. Do not special-case a route around this file.
const EXTERNAL_PREFIXES = ['/api/connectors/'];
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

// TODO(feat/core-pipeline): replace with kernel/interrupts.js inbox lookup once it lands.
// Until then, external (connector) writes are refused by default — the safe posture.
function findInboxApproval(_action) {
  return null;
}

function classifyAction(req) {
  const mutating = MUTATING_METHODS.has(req.method);
  const external = EXTERNAL_PREFIXES.some((p) => req.path.startsWith(p));
  return { mutating, external, path: req.path, method: req.method };
}

export function gate(req, res, next) {
  const action = classifyAction(req);
  if (!action.mutating) return next();
  if (action.external) {
    const item = findInboxApproval(action);
    if (!item || item.status !== 'approved') {
      return res.status(403).json({ code: 'GATE_REFUSED', action });
    }
    if (item.tainted) {
      return res.status(403).json({ code: 'TAINT_UNACKNOWLEDGED', item });
    }
  }
  next();
}
