// Thin client over the daemon (PRD §11). This is the contract the UI track builds against —
// every route here already exists on server/index.js, even where its internals are stubbed.
const BASE = '/api';

// Routes documented in PRD §11 but not wired server-side yet (preview, inbox approve/ack)
// 404 with Express's default HTML page, not JSON — fall back to raw text so the UI can show
// *something* useful instead of swallowing the body, per "never hide the failure".
async function asJson(res) {
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text ? { raw: text.slice(0, 300) } : null;
  }
  return { ok: res.ok, status: res.status, body };
}

export async function submitRun(brief, projectName, mode) {
  const res = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief, projectName, mode }),
  });
  return res.json();
}

export async function getRun(runId) {
  const res = await fetch(`${BASE}/runs/${runId}`);
  return res.json();
}

export async function listRuns() {
  const res = await fetch(`${BASE}/runs`);
  return res.json();
}

export function streamRun(runId, onEvent, onConnected) {
  const es = new EventSource(`${BASE}/runs/${runId}/stream`);
  if (onConnected) es.addEventListener('connected', () => onConnected());
  es.addEventListener('phase', (e) => onEvent(JSON.parse(e.data)));
  return () => es.close();
}

export async function getArtifact(runId, name) {
  const res = await fetch(`${BASE}/runs/${runId}/artifact/${name}`);
  return res.ok ? res.text() : null;
}

export async function getArtifactJSON(runId, name) {
  const text = await getArtifact(runId, name);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function getTrace(runId) {
  const res = await fetch(`${BASE}/runs/${runId}/trace`);
  return res.json();
}

// UI-6: LOCKED — answering the ONE clarifying question resumes the run.
export async function answerClarification(runId, itemId, answer) {
  const res = await fetch(`${BASE}/runs/${runId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, answer }),
  });
  return asJson(res);
}

// UI-9: adapter registry + availability + real launch command.
export async function getAdapters() {
  const res = await fetch(`${BASE}/adapters`);
  return res.json();
}

// UI-7: per-provider ledger, cooldowns, reset times.
export async function getUsage() {
  const res = await fetch(`${BASE}/usage`);
  return res.json();
}

// UI-5: KNOWN GAP — this route belongs to feat/runner-connectors and does not exist yet.
// Build against it now; it will 404 until that track lands. Never hide the failure.
export async function requestPreview(runId, { method, path, body }) {
  const res = await fetch(`${BASE}/preview/${runId}/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, body }),
  });
  return asJson(res);
}

// UI-8: Inbox routes (approve/ack) are P1/P2 and not wired server-side yet. Build the
// shell now; these will 404 until the approval endpoints land. Never hide the failure.
export async function approveInboxItem(itemId) {
  const res = await fetch(`${BASE}/inbox/${itemId}/approve`, { method: 'POST' });
  return asJson(res);
}

export async function ackInboxItem(itemId) {
  const res = await fetch(`${BASE}/inbox/${itemId}/ack`, { method: 'PATCH' });
  return asJson(res);
}
