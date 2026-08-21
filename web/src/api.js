// Thin client over the daemon (PRD §11), rewritten against the chat/project-centric
// route surface (server/index.js) that replaced the old fixed-pipeline /api/runs/*.
const BASE = '/api';

// Some routes 404 with Express's default HTML page, not JSON (e.g. a route that
// belongs to a different track and isn't wired yet) — fall back to raw text so the UI
// can show *something* useful instead of swallowing the body. Never hide a failure.
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

async function postJson(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return asJson(res);
}

// --- projects ---
export async function createProject(name) {
  const res = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}
export async function deleteProject(projectId) {
  const res = await fetch(`${BASE}/projects/${projectId}`, { method: 'DELETE' });
  return asJson(res);
}
export async function deleteChat(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}`, { method: 'DELETE' });
  return asJson(res);
}

export async function listProjects() {
  const res = await fetch(`${BASE}/projects`);
  return res.json();
}

// --- chats ---
// A chat is created by its first message — CORE-1: the brief, stored byte-verbatim.
export async function createChat(text, { projectId, mode, pinnedAdapter } = {}) {
  const res = await fetch(`${BASE}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, projectId, mode, pinnedAdapter }),
  });
  return res.json();
}

export async function listChats() {
  const res = await fetch(`${BASE}/chats`);
  return res.json();
}

export async function getChat(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}`);
  return res.json();
}

export function streamChat(chatId, onEvent, onConnected) {
  const es = new EventSource(`${BASE}/chats/${chatId}/stream`);
  if (onConnected) es.addEventListener('connected', () => onConnected());
  es.addEventListener('role', (e) => onEvent(JSON.parse(e.data)));
  return () => es.close();
}

/** Starts (or extends) a batch of agent roles. Returns {ok:false, status:400,
 * body:{code:'AGENT_SELECTION_INVALID', details:[{role, detail}]}} on an unsatisfiable
 * selection — the caller shows that, it never silently retries or drops roles. */
export async function generateRoles(chatId, roles, { mode, pinnedAdapter } = {}) {
  return postJson(`/chats/${chatId}/generate`, { roles, mode, pinnedAdapter });
}

// LOCKED (§11): answering the ONE clarifying question resumes the paused role.
export async function answerClarification(chatId, itemId, answer) {
  return postJson(`/chats/${chatId}/answer`, { itemId, answer });
}

export async function getArtifact(chatId, role) {
  const res = await fetch(`${BASE}/chats/${chatId}/artifact/${role}`);
  return res.ok ? res.json() : null;
}

export async function getFile(chatId, name) {
  const res = await fetch(`${BASE}/chats/${chatId}/file/${name}`);
  return res.ok ? res.text() : null;
}

export async function getJobFile(chatId, jobId, name) {
  const res = await fetch(`${BASE}/chats/${chatId}/job/${jobId}/${name}`);
  return res.ok ? res.text() : null;
}

export async function getTrace(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}/trace`);
  return res.json();
}

// Manual edit of one generated module — bypasses the repair-loop gates (see the route's
// own comment in server/index.js), restarts the live backend preview if one is running
// so the change is visible immediately, not just saved to disk.
export async function saveModule(chatId, role, path, code) {
  const res = await fetch(`${BASE}/chats/${chatId}/artifact/${role}/module`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, code }),
  });
  return asJson(res);
}

// One row per API/business-rule, run live against the booted preview (gates/contracttests.js).
// 404 before the preview has ever booted — asJson's raw-text fallback keeps that readable.
export async function getContractTests(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}/contracttests`);
  return asJson(res);
}

// The 7-role graph — static, drives the agent selector's dependency awareness.
export async function getAgentGraph() {
  const res = await fetch(`${BASE}/agents`);
  return res.json();
}
export async function getAvailableRoles(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}/agents`);
  return res.json();
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

// VER-3/UI-5: the backend preview. orchestrator.js boots one automatically as soon as
// the Backend agent commits, so there is no client-side "boot" call — GET /chats/:id
// reports `preview` when one is live, and this proxies a real request to it.
export async function requestPreview(chatId, { method, path, body, headers }) {
  return postJson(`/chats/${chatId}/preview/request`, { method, path, body, headers });
}

/** Bring a previously-generated backend back up — previews live only as long as the
 * daemon process, so reopening an older chat needs this rather than a regeneration. */
export async function startPreview(chatId) {
  return postJson(`/chats/${chatId}/preview/start`, {});
}

// The Frontend agent's manifest, bundled by the daemon and framed in the Live Preview tab.
export function frontendPreviewUrl(chatId) {
  return `${BASE}/chats/${chatId}/frontend-preview`;
}
export async function getFrontendPreviewStatus(chatId) {
  const res = await fetch(`${BASE}/chats/${chatId}/frontend-preview/status`);
  return res.json();
}

// UI-8: the single decision queue. Connector writes are refused by gate.js until the
// matching item here is approved (SEC-1), so these are load-bearing, not cosmetic.
export async function listInbox(chatId) {
  const res = await fetch(`${BASE}/inbox${chatId ? `?chatId=${chatId}` : ''}`);
  return res.json();
}
export async function approveInbox(itemId) {
  return postJson(`/inbox/${itemId}/approve`, {});
}
export async function rejectInbox(itemId) {
  return postJson(`/inbox/${itemId}/reject`, {});
}
export async function ackInbox(itemId) {
  const res = await fetch(`${BASE}/inbox/${itemId}/ack`, { method: 'PATCH' });
  return asJson(res);
}

// CONN-1..4: deterministic exporters, each behind the inbox gate.
export async function runConnector(chatId, name, payload = {}) {
  return postJson(`/chats/${chatId}/connectors/${name}`, payload);
}
