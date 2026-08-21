// Express + SSE daemon (PRD §4, §11). Route surface here is the shared integration contract —
// extend it, don't restructure it, without updating web/src/api.js in the same change.
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { startRun, subscribe, resumeAfterAnswer, getPreview } from './orchestrator.js';
import { getRun, readArtifact, listRuns, runDir } from './kernel/store.js';
import { gate } from './gate.js';
import { adapters, probeAll } from './adapters/index.js';
import { launchCommandFor } from './adapters/registry.js';
import { usageSnapshot } from './router.js';
import { listInboxItems, getInboxItem, approveInboxItem, rejectInboxItem, ackInboxItem, findRunIdForItem } from './kernel/inbox.js';
import { exportPostman } from './connectors/postman.js';
import { exportGithubPR } from './connectors/github.js';
import { exportMiro } from './connectors/miro.js';
import { exportSlack } from './connectors/slack.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// SEC-1 (PRD §11, §19): every mutating route passes through the gate, no client can bypass it.
app.use(gate);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/runs', async (req, res) => {
  const { brief, projectName, mode, pinnedAdapter } = req.body ?? {};
  if (!brief || typeof brief !== 'string' || brief.length > 4000) {
    return res.status(400).json({ code: 'INVALID_BRIEF', detail: 'brief must be a string, 1-4000 chars' });
  }
  // CORE-6: 'interactive' (ask ONE question below 0.7 completeness) or 'batch' (default —
  // proceed with every low-confidence assumption flagged, never blocks).
  // ROUTE-8: an optional adapter id pin — beats the ladder's own choice, falls back to it
  // if the pin is unavailable/cooling down (router.js `ladder()`).
  const runId = await startRun(brief, projectName ?? null, {
    mode: mode === 'interactive' ? 'interactive' : 'batch',
    pinnedAdapter: typeof pinnedAdapter === 'string' && pinnedAdapter ? pinnedAdapter : undefined,
  });
  res.json({ runId });
});

app.get('/api/runs', async (_req, res) => res.json({ runs: await listRuns() }));

app.get('/api/runs/:id', async (req, res) => {
  const run = await getRun(req.params.id);
  if (!run) return res.status(404).json({ code: 'NOT_FOUND' });
  res.json(run);
});

// SSE: phase transitions, repairs, failovers — PRD §11, §21 integration contract.
app.get('/api/runs/:id/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write(`event: connected\ndata: {}\n\n`);

  const unsubscribe = subscribe(req.params.id, (evt) => {
    res.write(`event: phase\ndata: ${JSON.stringify(evt)}\n\n`);
  });
  req.on('close', unsubscribe);
});

// Named wildcard (Express 5 / path-to-regexp v8 syntax) — artifact names can be nested
// (packs/agent1.txt, raw/agent1-attempt-0.txt). req.params.name is an array of segments.
app.get('/api/runs/:id/artifact/*name', async (req, res) => {
  const name = [].concat(req.params.name).join('/');
  const body = await readArtifact(req.params.id, name);
  if (body === null) return res.status(404).json({ code: 'NOT_FOUND' });
  res.type('text/plain').send(body);
});

app.get('/api/runs/:id/trace', async (req, res) => {
  const trace = await readArtifact(req.params.id, 'trace.json');
  res.json(trace ? JSON.parse(trace) : { rows: [], reverse: {} });
});

// LOCKED (§11): answering the ONE clarifying question resumes the run.
app.post('/api/runs/:id/answer', async (req, res) => {
  const { itemId, answer } = req.body ?? {};
  if (!itemId || !answer) return res.status(400).json({ code: 'INVALID_ANSWER' });
  await resumeAfterAnswer(req.params.id, itemId, answer);
  res.json({ ok: true });
});

// UI-5/T8: proxy a real HTTP call to the generated app's live preview server. Not
// EXTERNAL_PREFIXES-gated (gate.js) — this hits the run's OWN sandboxed generated app, not
// a third party, so no Inbox approval is required, unlike a connector write.
app.post('/api/preview/:id/request', async (req, res) => {
  const { method, path: urlPath, body } = req.body ?? {};
  if (!method || typeof urlPath !== 'string' || !urlPath.startsWith('/')) {
    return res.status(400).json({ code: 'INVALID_PREVIEW_REQUEST', detail: 'method and an absolute path are required' });
  }
  const preview = getPreview(req.params.id);
  if (!preview) return res.status(404).json({ code: 'NO_PREVIEW', detail: 'this run has no live preview server (not booted yet, or it failed to boot)' });
  try {
    const result = await preview.proxy(method, urlPath, body);
    res.json(result);
  } catch (e) {
    res.status(502).json({ code: 'PREVIEW_UNREACHABLE', detail: e.message });
  }
});

// §11 P1: the single decision queue — clarifications (kernel/interrupts.js) don't route
// through kernel/inbox.js's list, since that module owns only connector_write/review; a
// unified view across types can layer on top later without changing either module's shape.
app.get('/api/inbox', async (req, res) => {
  const { status, runId } = req.query;
  const runIds = runId ? [runId] : await listRuns();
  const items = [];
  for (const rid of runIds) {
    const runItems = await listInboxItems(rid);
    items.push(...runItems.map((i) => ({ ...i, runId: rid })));
  }
  res.json({ items: status ? items.filter((i) => i.status === status) : items });
});

async function resolveInboxTarget(req, res) {
  const itemId = req.params.id;
  const runId = typeof req.body?.runId === 'string' && req.body.runId ? req.body.runId : await findRunIdForItem(itemId);
  if (!runId) {
    res.status(404).json({ code: 'NOT_FOUND' });
    return null;
  }
  const item = await getInboxItem(runId, itemId);
  if (!item) {
    res.status(404).json({ code: 'NOT_FOUND' });
    return null;
  }
  return { runId, item };
}

// LOCKED (§11): approving is what lets a subsequent POST /api/connectors/:name through
// gate.js — refuses if the item is already tainted and hasn't been acked (SEC-4).
app.post('/api/inbox/:id/approve', async (req, res) => {
  const target = await resolveInboxTarget(req, res);
  if (!target) return;
  if (target.item.tainted) return res.status(403).json({ code: 'TAINT_UNACKNOWLEDGED', item: target.item });
  await approveInboxItem(target.runId, target.item.id);
  res.json({ ok: true, item: await getInboxItem(target.runId, target.item.id) });
});

app.post('/api/inbox/:id/reject', async (req, res) => {
  const target = await resolveInboxTarget(req, res);
  if (!target) return;
  await rejectInboxItem(target.runId, target.item.id);
  res.json({ ok: true, item: await getInboxItem(target.runId, target.item.id) });
});

// LOCKED (§11, §19 CLI-3, SEC-4): a human has read tainted content — required before an
// approved-but-tainted item's action can execute.
app.patch('/api/inbox/:id/ack', async (req, res) => {
  const target = await resolveInboxTarget(req, res);
  if (!target) return;
  await ackInboxItem(target.runId, target.item.id);
  res.json({ ok: true, item: await getInboxItem(target.runId, target.item.id) });
});

// LOCKED (§11, §18, SEC-1): reaches this handler only after gate.js confirms an approved,
// non-tainted connector_write Inbox item for this exact {runId, name} — see gate.js. A
// failed connector never fails the run (§18): `.pact/` files remain canonical regardless.
app.post('/api/connectors/:name', async (req, res) => {
  const { name } = req.params;
  const { runId, ...params } = req.body ?? {};
  try {
    const run = await getRun(runId);
    if (!run) return res.status(404).json({ code: 'NOT_FOUND', detail: 'unknown runId' });
    const contractRaw = await readArtifact(runId, 'architecture.json');
    const contract = contractRaw ? JSON.parse(contractRaw) : null;
    const preview = getPreview(runId);

    let result;
    switch (name) {
      case 'postman': {
        if (!contract) return res.status(409).json({ code: 'NOT_READY', detail: 'architecture.json not written yet' });
        const outputDir = path.join(runDir(runId), 'connectors', 'postman');
        result = await exportPostman(outputDir, contract, { baseUrl: preview?.baseUrl, ...params });
        break;
      }
      case 'github': {
        if (!contract) return res.status(409).json({ code: 'NOT_READY', detail: 'architecture.json not written yet' });
        if (!preview) return res.status(409).json({ code: 'NOT_READY', detail: 'no generated tree on disk yet (the run phase has not booted a preview)' });
        result = await exportGithubPR(path.join(runDir(runId), 'preview'), contract, { runId, ...params });
        break;
      }
      case 'miro': {
        if (!contract) return res.status(409).json({ code: 'NOT_READY', detail: 'architecture.json not written yet' });
        result = await exportMiro(contract, params);
        break;
      }
      case 'slack': {
        const traceRaw = await readArtifact(runId, 'trace.json');
        const contractTestsRaw = await readArtifact(runId, 'contracttests.json');
        result = await exportSlack(run, traceRaw ? JSON.parse(traceRaw) : null, {
          preview: preview?.baseUrl,
          contractTests: contractTestsRaw ? JSON.parse(contractTestsRaw) : null,
          ...params,
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
