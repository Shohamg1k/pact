// Express + SSE daemon (PRD §4, §11), generalized from run-centric to chat/project-
// centric routes. Route surface here is the shared integration contract — extend it,
// don't restructure it, without updating web/src/api.js in the same change.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { generateRoles, subscribe, resumeAfterAnswer, SelectionError, getPreview, startPreviewForChat, stopPreview } from './orchestrator.js';
import {
  getChat,
  listChats,
  listJobs,
  listArtifacts,
  readChatFile,
  createChat,
  createProject,
  listProjects,
  availableRoles,
  chatDir,
  deleteChat,
  deleteProject,
} from './kernel/chats.js';
import { gate } from './gate.js';
import { adapters, probeAll } from './adapters/index.js';
import { launchCommandFor } from './adapters/registry.js';
import { usageSnapshot } from './router.js';
import { ROLE_IDS, ROLE_LABELS, ROLE_GRAPH } from './agents/registry.js';
import { listInboxItems, getInboxItem, approveInboxItem, rejectInboxItem, ackInboxItem, findChatIdForItem } from './kernel/inbox.js';
import { exportPostman } from './connectors/postman.js';
import { exportGithubPR } from './connectors/github.js';
import { exportMiro } from './connectors/miro.js';
import { exportSlack } from './connectors/slack.js';
import { buildFrontendBundle, previewDocument } from './preview/frontend.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// SEC-1 (PRD §11, §19): every mutating route passes through the gate, no client can bypass it.
app.use(gate);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// --- projects ---
app.post('/api/projects', async (req, res) => {
  const { name } = req.body ?? {};
  if (!name || typeof name !== 'string') return res.status(400).json({ code: 'INVALID_NAME' });
  res.json(await createProject(name));
});
app.get('/api/projects', async (_req, res) => res.json({ projects: await listProjects() }));

// Deleting a project unfiles its chats rather than destroying them (kernel/chats.js).
app.delete('/api/projects/:id', async (req, res) => {
  const result = await deleteProject(req.params.id);
  res.json({ ok: true, ...result });
});

// Deleting a chat takes its generated tree with it, so any preview it booted has to be
// torn down first or we'd leak a node process and its mongod.
app.delete('/api/chats/:id', async (req, res) => {
  const chat = await getChat(req.params.id);
  if (!chat) return res.status(404).json({ code: 'NOT_FOUND' });
  await stopPreview(req.params.id);
  await deleteChat(req.params.id);
  res.json({ ok: true });
});

// --- chats ---
// CORE-1: a chat is created by its first message — that message IS the brief, stored
// byte-verbatim (chat.brief). Everything after is an activity log, not further
// model-directed chat (see kernel/chats.js's createChat comment).
app.post('/api/chats', async (req, res) => {
  const { text, projectId, mode, pinnedAdapter } = req.body ?? {};
  if (!text || typeof text !== 'string' || text.length > 4000) {
    return res.status(400).json({ code: 'INVALID_BRIEF', detail: 'text must be a string, 1-4000 chars' });
  }
  const chat = await createChat({
    text,
    projectId: projectId ?? null,
    mode: mode === 'interactive' ? 'interactive' : 'batch',
    pinnedAdapter: typeof pinnedAdapter === 'string' && pinnedAdapter ? pinnedAdapter : null,
  });
  res.json(chat);
});

app.get('/api/chats', async (_req, res) => {
  const ids = await listChats();
  const chats = [];
  for (const id of ids) {
    const chat = await getChat(id);
    if (chat) chats.push(chat);
  }
  chats.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  res.json({ chats });
});

app.get('/api/chats/:id', async (req, res) => {
  const chat = await getChat(req.params.id);
  if (!chat) return res.status(404).json({ code: 'NOT_FOUND' });
  const artifacts = await listArtifacts(req.params.id);
  const summary = Object.fromEntries(Object.entries(artifacts).map(([role, a]) => [role, { gaps: a.gaps ?? [] }]));
  // `preview` tells the workbench whether the generated backend is actually live, so the
  // API console and Live Preview tab can say so instead of failing opaquely.
  const preview = getPreview(req.params.id);
  res.json({
    chat,
    artifacts: summary,
    jobs: await listJobs(req.params.id),
    preview: preview ? { live: true, baseUrl: preview.baseUrl } : { live: false },
  });
});

// SSE: {role, status, detail, ts} per agent job — PRD §11, §21 integration contract.
app.get('/api/chats/:id/stream', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write(`event: connected\ndata: {}\n\n`);
  const unsubscribe = subscribe(req.params.id, (evt) => {
    res.write(`event: role\ndata: ${JSON.stringify(evt)}\n\n`);
  });
  req.on('close', unsubscribe);
});

// Starts (or extends) a batch of agent roles for this chat. Validated against the DAG
// (agents/registry.js) before any model is called — an unsatisfiable selection 400s
// immediately, naming exactly which role is missing what.
app.post('/api/chats/:id/generate', async (req, res) => {
  const { roles, mode, pinnedAdapter } = req.body ?? {};
  if (!Array.isArray(roles) || roles.length === 0) {
    return res.status(400).json({ code: 'INVALID_ROLES', detail: 'roles must be a non-empty array of agent role ids' });
  }
  try {
    const opts = { mode, pinnedAdapter: typeof pinnedAdapter === 'string' && pinnedAdapter ? pinnedAdapter : undefined };
    const { order } = await generateRoles(req.params.id, roles, opts);
    res.json({ order });
  } catch (e) {
    if (e instanceof SelectionError) return res.status(400).json({ code: e.code, details: e.details });
    throw e;
  }
});

// LOCKED (§11): answering the ONE clarifying question resumes the paused role.
app.post('/api/chats/:id/answer', async (req, res) => {
  const { itemId, answer } = req.body ?? {};
  if (!itemId || !answer) return res.status(400).json({ code: 'INVALID_ANSWER' });
  await resumeAfterAnswer(req.params.id, itemId, answer);
  res.json({ ok: true });
});

// The current committed artifact for one role — always exactly artifacts/<role>.json.
app.get('/api/chats/:id/artifact/:role', async (req, res) => {
  const body = await readChatFile(req.params.id, `artifacts/${req.params.role}.json`);
  if (body === null) return res.status(404).json({ code: 'NOT_FOUND' });
  res.type('application/json').send(body);
});
// Chat-root derived files (openapi.yaml, decisions.md, technical-spec.md, etc.)
app.get('/api/chats/:id/file/*name', async (req, res) => {
  const name = [].concat(req.params.name).join('/');
  const body = await readChatFile(req.params.id, name);
  if (body === null) return res.status(404).json({ code: 'NOT_FOUND' });
  res.type('text/plain').send(body);
});
// A specific job's pack/raw bytes — packs/agent2.txt's successor, now job-scoped
// (jobs/<jobId>/pack-attempt-N.txt etc.) — the on-stage hash-diff/pack-grep proof (CORE-4).
app.get('/api/chats/:id/job/:jobId/*name', async (req, res) => {
  const name = `jobs/${req.params.jobId}/${[].concat(req.params.name).join('/')}`;
  const body = await readChatFile(req.params.id, name);
  if (body === null) return res.status(404).json({ code: 'NOT_FOUND' });
  res.type('text/plain').send(body);
});

app.get('/api/chats/:id/trace', async (req, res) => {
  const trace = await readChatFile(req.params.id, 'trace.json');
  res.json(trace ? JSON.parse(trace) : { rows: [], reverse: {}, gaps: [] });
});

// The 7-role graph + which are currently satisfiable for this chat — drives the UI's
// agent-selector without duplicating the DAG check client-side.
app.get('/api/agents', async (_req, res) => {
  res.json({
    // `reads` is what a role's pack is ALLOWED to contain — the UI's provenance check
    // verifies each pack against exactly this, so the rule and its proof share one source.
    roles: ROLE_IDS.map((id) => ({ id, label: ROLE_LABELS[id], requires: ROLE_GRAPH[id].requires, reads: ROLE_GRAPH[id].reads })),
  });
});
app.get('/api/chats/:id/agents', async (req, res) => {
  const available = await availableRoles(req.params.id);
  res.json({ available: [...available] });
});

// UI-5/T8: proxy a real HTTP call to this chat's live preview server (orchestrator.js
// boots one right after 'backend' commits). Not gated externally (gate.js) — this hits
// the chat's OWN sandboxed generated app, not a third party, so no Inbox approval is
// required, unlike a connector write.
app.post('/api/chats/:id/preview/request', async (req, res) => {
  const { method, path: urlPath, body } = req.body ?? {};
  if (!method || typeof urlPath !== 'string' || !urlPath.startsWith('/')) {
    return res.status(400).json({ code: 'INVALID_PREVIEW_REQUEST', detail: 'method and an absolute path are required' });
  }
  const preview = getPreview(req.params.id);
  if (!preview) return res.status(404).json({ code: 'NO_PREVIEW', detail: 'this chat has no live preview server (backend has not booted one yet, or it failed to boot)' });
  try {
    const result = await preview.proxy(method, urlPath, body);
    res.json(result);
  } catch (e) {
    res.status(502).json({ code: 'PREVIEW_UNREACHABLE', detail: e.message });
  }
});

// Start the persistent preview for a chat whose backend committed in an earlier daemon
// lifetime — previews die with the process, so this is how you get yesterday's chat live
// again without paying for a model call to regenerate an identical manifest.
app.post('/api/chats/:id/preview/start', async (req, res) => {
  if (getPreview(req.params.id)) return res.json({ live: true, baseUrl: getPreview(req.params.id).baseUrl });
  try {
    await startPreviewForChat(req.params.id);
    const preview = getPreview(req.params.id);
    res.json(preview ? { live: true, baseUrl: preview.baseUrl } : { live: false, error: 'preview failed to start' });
  } catch (e) {
    res.status(400).json({ live: false, error: e.message });
  }
});

// The Frontend agent's manifest, bundled and served as a real page for the workbench's
// Live Preview tab. Three routes: the document, its status (so the tab can report a
// bundle failure as UI instead of a blank iframe), and the same-origin API bridge the
// injected fetch shim routes the app's own calls through.
app.get('/api/chats/:id/frontend-preview/status', async (req, res) => {
  const built = await buildFrontendBundle(req.params.id);
  res.json({ ok: !built.error, error: built.error ?? null });
});

app.get('/api/chats/:id/frontend-preview', async (req, res) => {
  const built = await buildFrontendBundle(req.params.id);
  // Same-origin so the shim can reach the proxy below; framed only by our own workbench.
  res.set('Content-Security-Policy', "frame-ancestors 'self'");
  res.type('html').send(previewDocument(req.params.id, built.js, built.error));
});

app.all('/api/chats/:id/frontend-preview/proxy/*urlPath', async (req, res) => {
  const preview = getPreview(req.params.id);
  if (!preview) {
    return res.status(503).json({ error: 'NO_BACKEND', message: 'No backend is running for this chat yet.' });
  }
  const urlPath = '/' + [].concat(req.params.urlPath).join('/');
  try {
    const result = await preview.proxy(req.method, urlPath, req.body);
    res.status(result.status ?? 502).json(result.body ?? result);
  } catch (e) {
    res.status(502).json({ error: 'PREVIEW_UNREACHABLE', message: e.message });
  }
});

// §11 P1: the single decision queue — clarifications (kernel/interrupts.js) don't route
// through kernel/inbox.js's list, since that module owns only connector_write/review; a
// unified view across types can layer on top later without changing either module's shape.
app.get('/api/inbox', async (req, res) => {
  const { status, chatId } = req.query;
  const chatIds = chatId ? [chatId] : await listChats();
  const items = [];
  for (const cid of chatIds) {
    const chatItems = await listInboxItems(cid);
    items.push(...chatItems.map((i) => ({ ...i, chatId: cid })));
  }
  res.json({ items: status ? items.filter((i) => i.status === status) : items });
});

async function resolveInboxTarget(req, res) {
  const itemId = req.params.id;
  const chatId = typeof req.body?.chatId === 'string' && req.body.chatId ? req.body.chatId : await findChatIdForItem(itemId);
  if (!chatId) {
    res.status(404).json({ code: 'NOT_FOUND' });
    return null;
  }
  const item = await getInboxItem(chatId, itemId);
  if (!item) {
    res.status(404).json({ code: 'NOT_FOUND' });
    return null;
  }
  return { chatId, item };
}

// LOCKED (§11): approving is what lets a subsequent POST /api/chats/:id/connectors/:name
// through gate.js — refuses if the item is already tainted and hasn't been acked (SEC-4).
app.post('/api/inbox/:id/approve', async (req, res) => {
  const target = await resolveInboxTarget(req, res);
  if (!target) return;
  if (target.item.tainted) return res.status(403).json({ code: 'TAINT_UNACKNOWLEDGED', item: target.item });
  await approveInboxItem(target.chatId, target.item.id);
  res.json({ ok: true, item: await getInboxItem(target.chatId, target.item.id) });
});

app.post('/api/inbox/:id/reject', async (req, res) => {
  const target = await resolveInboxTarget(req, res);
  if (!target) return;
  await rejectInboxItem(target.chatId, target.item.id);
  res.json({ ok: true, item: await getInboxItem(target.chatId, target.item.id) });
});

// LOCKED (§11, §19 CLI-3, SEC-4): a human has read tainted content — required before an
// approved-but-tainted item's action can execute.
app.patch('/api/inbox/:id/ack', async (req, res) => {
  const target = await resolveInboxTarget(req, res);
  if (!target) return;
  await ackInboxItem(target.chatId, target.item.id);
  res.json({ ok: true, item: await getInboxItem(target.chatId, target.item.id) });
});

// LOCKED (§11, §18, SEC-1): reaches this handler only after gate.js confirms an approved,
// non-tainted connector_write Inbox item for this exact {chatId, name} — see gate.js. A
// failed connector never fails the chat (§18): `.pact/` files remain canonical regardless.
app.post('/api/chats/:id/connectors/:name', async (req, res) => {
  const chatId = req.params.id;
  const { name } = req.params;
  try {
    const chat = await getChat(chatId);
    if (!chat) return res.status(404).json({ code: 'NOT_FOUND', detail: 'unknown chatId' });
    const contractRaw = await readChatFile(chatId, 'artifacts/architect.json');
    const contract = contractRaw ? JSON.parse(contractRaw) : null;
    const preview = getPreview(chatId);

    let result;
    switch (name) {
      case 'postman': {
        if (!contract) return res.status(409).json({ code: 'NOT_READY', detail: 'architect artifact not written yet' });
        const outputDir = path.join(chatDir(chatId), 'connectors', 'postman');
        result = await exportPostman(outputDir, contract, { baseUrl: preview?.baseUrl, ...req.body });
        break;
      }
      case 'github': {
        if (!contract) return res.status(409).json({ code: 'NOT_READY', detail: 'architect artifact not written yet' });
        if (!preview) return res.status(409).json({ code: 'NOT_READY', detail: 'no generated tree on disk yet (backend has not booted a preview)' });
        result = await exportGithubPR(path.join(chatDir(chatId), 'preview'), contract, { runId: chatId, ...req.body });
        break;
      }
      case 'miro': {
        if (!contract) return res.status(409).json({ code: 'NOT_READY', detail: 'architect artifact not written yet' });
        result = await exportMiro(contract, req.body ?? {});
        break;
      }
      case 'slack': {
        const traceRaw = await readChatFile(chatId, 'trace.json');
        const contractTestsRaw = await readChatFile(chatId, 'contracttests.json');
        result = await exportSlack({ id: chatId, projectName: chat.title, status: chat.pendingRole ? 'running' : 'done' }, traceRaw ? JSON.parse(traceRaw) : null, {
          preview: preview?.baseUrl,
          contractTests: contractTestsRaw ? JSON.parse(contractTestsRaw) : null,
          ...req.body,
        });
        break;
      }
      default:
        return res.status(404).json({ code: 'UNKNOWN_CONNECTOR', detail: name });
    }
    res.json({ ok: true, result });
  } catch (e) {
    res.status(502).json({ code: 'CONNECTOR_FAILED', detail: e.message });
  }
});

app.get('/api/adapters', (_req, res) => {
  res.json({
    adapters: adapters.map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      tier: a.tier,
      available: a.available,
      detail: a.detail,
      cooldownUntil: a.cooldownUntil ?? null,
      launchCommand: launchCommandFor(a.id) ?? null,
    })),
  });
});

app.get('/api/usage', (_req, res) => res.json({ providers: usageSnapshot() }));

const PORT = process.env.PACT_PORT || 4300;
probeAll()
  .then(() => {
    console.log('[pact] adapters:', adapters.map((a) => `${a.id}=${a.available}`).join(' '));
    setInterval(probeAll, 30_000); // ROUTE-6: re-probe every 30s, no restart needed
  })
  .catch(() => {});
app.listen(PORT, () => console.log(`[pact] daemon listening on http://127.0.0.1:${PORT}`));
