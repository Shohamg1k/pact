// The security boundary (PRD §11, §19 SEC-1). Every mutating route passes through here,
// regardless of client (web, CLI, curl) — a new mutating route without gate coverage
// must fail the CI grep once one exists. Do not special-case a route around this file.
//
// This is app.use()-level middleware, mounted before Express does route matching — req.params
// isn't populated yet, so chatId + the connector name are parsed straight out of req.path,
// following the rest of the API's /api/chats/:id/... convention (chat id in the URL, never
// a body field).
import { findApprovedConnectorWrite, requestConnectorWrite } from './kernel/inbox.js';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const CONNECTOR_PATH_RE = /^\/api\/chats\/([^/]+)\/connectors\/([^/]+)/;

function classifyAction(req) {
  const mutating = MUTATING_METHODS.has(req.method);
  const connectorMatch = req.path.match(CONNECTOR_PATH_RE);
  const external = !!connectorMatch;
  return {
    mutating,
    external,
    path: req.path,
    method: req.method,
    chatId: connectorMatch?.[1] ?? null,
    connectorName: connectorMatch?.[2] ?? null,
  };
}

export async function gate(req, res, next) {
  const action = classifyAction(req);
  if (!action.mutating) return next();
  if (action.external) {
    const item = await findApprovedConnectorWrite(action.chatId, action.connectorName);
    if (!item) {
      // First attempt at this write: self-register it as a pending Inbox item rather than
      // just refusing into a dead end — this is what "attempting the action puts it in
      // your Inbox" (§19 CLI-1's `pact snapshot`) means in code. The SAME request, replayed
      // after a human approves it via POST /api/inbox/:id/approve, will find it here.
      const created = await requestConnectorWrite(action.chatId, action.connectorName, { requestBody: req.body });
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
