// The general Inbox (PRD §7, §11, §19 SEC-1) for everything besides clarification (that
// stays in kernel/interrupts.js, which owns the round-cap semantics — PRD §8.4). This module
// covers connector writes: create a pending request, let a human approve/reject it, and let
// gate.js (the route-layer security boundary) check whether one is currently approved.
//
// Backed by the SAME append-only inbox.jsonl store.js already writes clarifications to —
// "one queue for everything the human owes" (§7) is a statement about the FILE, not about
// every item type sharing one code path. A creation row and its decision are two separate
// appended rows, same pattern as interrupts.js's clarification/clarification_answer split —
// never a mutated row, since the log is append-only (P3: files are truth).
import { randomUUID } from 'node:crypto';
import { appendLog, readLog, listRuns } from './store.js';

/**
 * Records a connector write as pending approval. Called by gate.js the first time a
 * connector route is hit without one already approved — the request itself becomes the
 * Inbox row a human resolves with `pact approve <id>` / POST /api/inbox/:id/approve.
 * @param {string} runId
 * @param {string} connectorName - e.g. 'postman', 'github', 'miro', 'slack'
 * @param {object} payload - connector-specific description of what would be written
 * @param {{tainted?: boolean}} [opts]
 */
export async function requestConnectorWrite(runId, connectorName, payload, opts = {}) {
  const item = {
    id: randomUUID().slice(0, 8),
    type: 'connector_write',
    payload: { connector: connectorName, ...payload },
    status: 'pending',
    round: 0,
    tainted: opts.tainted ? 1 : 0,
    createdAt: new Date().toISOString(),
  };
  await appendLog(runId, 'inbox.jsonl', item);
  return item;
}

/** Reconstructs current state: the creation row plus the latest decision appended after
 * it (if any). Undecided items report status:'pending', matching their creation row. */
export async function listInboxItems(runId, { types } = {}) {
  const rows = await readLog(runId, 'inbox.jsonl');
  const creations = rows.filter((r) => r.type === 'clarification' || r.type === 'connector_write' || r.type === 'review');
  const decisions = rows.filter((r) => r.type === 'connector_write_decision');
  const latestDecisionFor = (id) => decisions.filter((d) => d.itemId === id).at(-1); // append-only -> last write wins

  const items = creations.map((item) => {
    const decision = latestDecisionFor(item.id);
    return decision ? { ...item, status: decision.status, tainted: decision.acked ? 0 : item.tainted } : item;
  });
  return types ? items.filter((i) => types.includes(i.type)) : items;
}

export async function getInboxItem(runId, itemId) {
  const items = await listInboxItems(runId);
  return items.find((i) => i.id === itemId) ?? null;
}

/** PRD §19 CLI-2: `pact approve <id>` names only the item, not its run — the web client's
 * POST /api/inbox/:id/approve accepts an optional runId in the body for a direct lookup,
 * but falls back to this scan across every run's inbox.jsonl so both callers work off the
 * same id alone. Fine at hackathon scale (a handful of runs); would want a real index first
 * at any larger scale. */
export async function findRunIdForItem(itemId) {
  const runIds = await listRuns();
  for (const runId of runIds) {
    const items = await listInboxItems(runId);
    if (items.some((i) => i.id === itemId)) return runId;
  }
  return null;
}

/**
 * The gate.js lookup (PRD §11 gate middleware, SEC-1): is there a currently-approved
 * connector_write request for this exact run + connector? Only the LATEST request for a
 * given connector counts — an old approval doesn't authorize a brand new write requested
 * after it (e.g. the manifest changed since).
 */
export async function findApprovedConnectorWrite(runId, connectorName) {
  const items = await listInboxItems(runId, { types: ['connector_write'] });
  const forConnector = items.filter((i) => i.payload?.connector === connectorName);
  return forConnector.at(-1) ?? null; // most recently requested — approval or not
}

export async function approveInboxItem(runId, itemId) {
  await appendLog(runId, 'inbox.jsonl', { type: 'connector_write_decision', itemId, status: 'approved', ts: Date.now() });
}

export async function rejectInboxItem(runId, itemId) {
  await appendLog(runId, 'inbox.jsonl', { type: 'connector_write_decision', itemId, status: 'rejected', ts: Date.now() });
}

/** PATCH /api/inbox/:id/ack (§19 CLI-3, SEC-4): a human has read tainted content — clears
 * the taint flag without changing approval status. Must be called before an already-approved
 * tainted item's action can execute (gate.js's TAINT_UNACKNOWLEDGED check). */
export async function ackInboxItem(runId, itemId) {
  const item = await getInboxItem(runId, itemId);
  await appendLog(runId, 'inbox.jsonl', { type: 'connector_write_decision', itemId, status: item?.status ?? 'pending', acked: true, ts: Date.now() });
}
