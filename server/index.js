// Express + SSE daemon (PRD §4, §11). Route surface here is the shared integration contract —
// extend it, don't restructure it, without updating web/src/api.js in the same change.
import express from 'express';
import cors from 'cors';
import { startRun, subscribe } from './orchestrator.js';
import { getRun, readArtifact, listRuns } from './kernel/store.js';
import { gate } from './gate.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// SEC-1 (PRD §11, §19): every mutating route passes through the gate, no client can bypass it.
app.use(gate);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/api/runs', async (req, res) => {
  const { brief, projectName } = req.body ?? {};
  if (!brief || typeof brief !== 'string' || brief.length > 4000) {
    return res.status(400).json({ code: 'INVALID_BRIEF', detail: 'brief must be a string, 1-4000 chars' });
  }
  const runId = await startRun(brief, projectName ?? null);
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

app.get('/api/runs/:id/artifact/:name', async (req, res) => {
  const body = await readArtifact(req.params.id, req.params.name);
  if (body === null) return res.status(404).json({ code: 'NOT_FOUND' });
  res.type('text/plain').send(body);
});

app.get('/api/runs/:id/trace', async (req, res) => {
  const trace = await readArtifact(req.params.id, 'trace.json');
  res.json(trace ? JSON.parse(trace) : { rows: [], reverse: {} });
});

// Stub until server/router.js (feat/core-pipeline) lands.
app.get('/api/adapters', (_req, res) => {
  res.json({ adapters: [{ id: 'stub', name: 'stub', available: true, tier: 0 }] });
});

const PORT = process.env.PACT_PORT || 4300;
app.listen(PORT, () => console.log(`[pact] daemon listening on http://127.0.0.1:${PORT}`));
