// Express + SSE daemon (PRD §4, §11), generalized from run-centric to chat/project-
// centric routes. Route surface here is the shared integration contract — extend it,
// don't restructure it, without updating web/src/api.js in the same change.
import express from 'express';
import cors from 'cors';
import { generateRoles, subscribe, resumeAfterAnswer, SelectionError } from './orchestrator.js';
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
} from './kernel/chats.js';
import { gate } from './gate.js';
import { adapters, probeAll } from './adapters/index.js';
import { launchCommandFor } from './adapters/registry.js';
import { usageSnapshot } from './router.js';
import { ROLE_IDS, ROLE_LABELS, ROLE_GRAPH } from './agents/registry.js';
import { bootChat, getBoot, stopBoot, stopAllBoots, proxyRequest } from './runner.js';

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
  res.json({ chat, artifacts: summary, jobs: await listJobs(req.params.id) });
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
    roles: ROLE_IDS.map((id) => ({ id, label: ROLE_LABELS[id], requires: ROLE_GRAPH[id].requires })),
  });
});
app.get('/api/chats/:id/agents', async (req, res) => {
  const available = await availableRoles(req.params.id);
  res.json({ available: [...available] });
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

// VER-3 / UI-5: write the backend manifest to disk, npm install, boot an in-memory
// Mongo + the generated server as an isolated child process. Async — POST returns
// immediately with {status:'booting'}, the client polls GET for {status,port,error}.
app.post('/api/chats/:id/boot', async (req, res) => {
  const record = await bootChat(req.params.id);
  res.json(record);
});
app.get('/api/chats/:id/boot', async (req, res) => res.json(getBoot(req.params.id)));
app.post('/api/chats/:id/boot/stop', async (req, res) => {
  await stopBoot(req.params.id);
  res.json({ ok: true });
});

// UI-5: PreviewConsole — a real HTTP round trip against the booted server.
app.post('/api/preview/:id/request', async (req, res) => {
  const { method, path: reqPath, body } = req.body ?? {};
  if (!method || !reqPath) return res.status(400).json({ code: 'INVALID_REQUEST' });
  const result = await proxyRequest(req.params.id, { method, path: reqPath, body });
  res.json(result);
});

const PORT = process.env.PACT_PORT || 4300;
probeAll()
  .then(() => {
    console.log('[pact] adapters:', adapters.map((a) => `${a.id}=${a.available}`).join(' '));
    setInterval(probeAll, 30_000); // ROUTE-6: re-probe every 30s, no restart needed
  })
  .catch(() => {});
app.listen(PORT, () => console.log(`[pact] daemon listening on http://127.0.0.1:${PORT}`));

// SEC-2/P5: never leave a booted generated server or its in-memory Mongo orphaned when
// the daemon exits.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await stopAllBoots();
    process.exit(0);
  });
}
