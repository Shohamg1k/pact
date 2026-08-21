// Thin client over the daemon (PRD §11). This is the contract the UI track builds against —
// every route here already exists on server/index.js, even where its internals are stubbed.
const BASE = '/api';

export async function submitRun(brief, projectName) {
  const res = await fetch(`${BASE}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brief, projectName }),
  });
  return res.json();
}

export async function getRun(runId) {
  const res = await fetch(`${BASE}/runs/${runId}`);
  return res.json();
}

export function streamRun(runId, onEvent) {
  const es = new EventSource(`${BASE}/runs/${runId}/stream`);
  es.addEventListener('phase', (e) => onEvent(JSON.parse(e.data)));
  return () => es.close();
}

export async function getArtifact(runId, name) {
  const res = await fetch(`${BASE}/runs/${runId}/artifact/${name}`);
  return res.ok ? res.text() : null;
}

export async function getTrace(runId) {
  const res = await fetch(`${BASE}/runs/${runId}/trace`);
  return res.json();
}
