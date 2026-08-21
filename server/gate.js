// The security boundary (PRD §11, §19 SEC-1). Every mutating route passes through here,
// regardless of client (web, CLI, curl) — a new mutating route without gate coverage
// must fail the CI grep once one exists. Do not special-case a route around this file.
//
// This is app.use()-level middleware, mounted before Express does route matching — req.params
// isn't populated yet, so the connector name is parsed straight out of req.path instead.
import { findApprovedConnectorWrite, requestConnectorWrite } from './kernel/inbox.js';

const EXTERNAL_PREFIXES = ['/api/connectors/'];
const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const CONNECTOR_PATH_RE = /^\/api\/connectors\/([^/]+)/;

function classifyAction(req) {
  const mutating = MUTATING_METHODS.has(req.method);
  const external = EXTERNAL_PREFIXES.some((p) => req.path.startsWith(p));
  const connectorMatch = external ? req.path.match(CONNECTOR_PATH_RE) : null;
  return {
    mutating,
    external,
    path: req.path,
    method: req.method,
    connectorName: connectorMatch?.[1] ?? null,
    runId: typeof req.body?.runId === 'string' ? req.body.runId : null,
  };
}

export async function gate(req, res, next) {
  const action = classifyAction(req);
  if (!action.mutating) return next();
  if (action.external) {
    if (!action.runId || !action.connectorName) {
      return res.status(400).json({ code: 'GATE_REFUSED', detail: 'connector writes require {runId} in the request body', action });
    }
    const item = await findApprovedConnectorWrite(action.runId, action.connectorName);
    if (!item) {
      // First attempt at this write: self-register it as a pending Inbox item rather than
      // just refusing into a dead end — this is what "attempting the action puts it in
      // your Inbox" (§19 CLI-1's `pact snapshot`) means in code. The SAME request, replayed
      // after a human approves it via POST /api/inbox/:id/approve, will find it here.
      const created = await requestConnectorWrite(action.runId, action.connectorName, { requestBody: req.body });
      return res.status(403).json({ code: 'GATE_REFUSED', action, item: created });
    }
    if (item.status !== 'approved') {
      return res.status(403).json({ code: 'GATE_REFUSED', action, item });
    }
    if (item.tainted) {
      return res.status(403).json({ code: 'TAINT_UNACKNOWLEDGED', item });
    }
  }
  next();
}
