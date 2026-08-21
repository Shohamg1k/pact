// CONN-3 — Miro board (PRD §18, P1). Deterministic layout derived from the architecture
// contract: one shape per feature, one shape per collection, arrows linking a feature to the
// collections its APIs' paths reference, each arrow labelled with the API(s) it represents.
// No model call. `opts.fetch` is injectable so the layout math is unit-testable without a
// real MIRO_ACCESS_TOKEN (see miro.selftest.mjs) — the REST calls themselves are untested
// here since they need a live board and a real token this environment doesn't have.
const MIRO_API = 'https://api.miro.com/v2';
const ROW_HEIGHT = 180;
const COLLECTION_X = 0;
const FEATURE_X = 500;

/** Does this API plausibly touch this collection? Heuristic: the collection's name (as a
 * word) appears in the API's path — the contract has no explicit api->collection edge, only
 * api->feature, so this is a best-effort visual hint, not an authoritative trace (that's
 * trace.js's job, over the real implements[] links Agent 2 writes). */
function apiTouchesCollection(api, collection) {
  const name = collection.name.toLowerCase().replace(/s$/, '');
  return api.path.toLowerCase().includes(name);
}

/** Pure function: contract -> board layout (shapes + arrows, positioned). No I/O. */
export function buildMiroBoardPlan(contract) {
  const collections = contract.collections ?? [];
  const features = contract.features ?? [];
  const apis = contract.apis ?? [];

  const collectionShapes = collections.map((c, i) => ({
    key: `collection:${c.id}`,
    kind: 'collection',
    text: `${c.name}\n(${c.id})\n${c.fields.join(', ')}`,
    x: COLLECTION_X,
    y: i * ROW_HEIGHT,
  }));
  const featureShapes = features.map((f, i) => ({
    key: `feature:${f.id}`,
    kind: 'feature',
    text: `${f.name}\n(${f.id}, ${f.priority})`,
    x: FEATURE_X,
    y: i * ROW_HEIGHT,
  }));

  const arrows = [];
  for (const feature of features) {
    const featureApis = apis.filter((a) => a.feature_id === feature.id);
    for (const collection of collections) {
      const touching = featureApis.filter((a) => apiTouchesCollection(a, collection));
      if (touching.length === 0) continue;
      arrows.push({
        from: `feature:${feature.id}`,
        to: `collection:${collection.id}`,
        label: touching.map((a) => `${a.method} ${a.path}`).join(', '),
      });
    }
  }

  return { shapes: [...collectionShapes, ...featureShapes], arrows };
}

async function miroRequest(fetchImpl, token, path, options = {}) {
  const res = await fetchImpl(`${MIRO_API}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Miro API ${path} failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Creates a board (or uses an existing one) and populates it from the contract.
 * @param {object} contract
 * @param {{token?: string, boardId?: string, fetch?: Function}} opts
 */
export async function exportMiro(contract, opts = {}) {
  const token = opts.token ?? process.env.MIRO_ACCESS_TOKEN;
  if (!token) throw new Error('Miro export needs MIRO_ACCESS_TOKEN (env var or opts.token) — never written into .pact/ (SEC-3)');
  const fetchImpl = opts.fetch ?? fetch;

  const board = opts.boardId
    ? { id: opts.boardId }
    : await miroRequest(fetchImpl, token, '/boards', {
        method: 'POST',
        body: JSON.stringify({ name: `PACT — ${contract.meta.id}` }),
      });

  const plan = buildMiroBoardPlan(contract);
  const shapeIdByKey = new Map();

  for (const shape of plan.shapes) {
    const created = await miroRequest(fetchImpl, token, `/boards/${board.id}/shapes`, {
      method: 'POST',
      body: JSON.stringify({
        data: { content: shape.text, shape: shape.kind === 'collection' ? 'rectangle' : 'round_rectangle' },
        position: { x: shape.x, y: shape.y },
      }),
    });
    shapeIdByKey.set(shape.key, created.id);
  }

  for (const arrow of plan.arrows) {
    const startId = shapeIdByKey.get(arrow.from);
    const endId = shapeIdByKey.get(arrow.to);
    if (!startId || !endId) continue;
    await miroRequest(fetchImpl, token, `/boards/${board.id}/connectors`, {
      method: 'POST',
      body: JSON.stringify({
        startItem: { id: startId },
        endItem: { id: endId },
        captions: [{ content: arrow.label }],
      }),
    });
  }

  return { connector: 'miro', boardId: board.id, shapeCount: plan.shapes.length, arrowCount: plan.arrows.length };
}
