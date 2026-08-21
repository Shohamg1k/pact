// The trace matrix (PRD §16 VER-5), generalized from architect+backend to however many
// of the 7 roles have produced an artifact in this chat. Still a pure function over the
// contract + whatever artifacts exist -> rows (contract item -> which role(s)/file(s)
// implement it -> OK/gap) plus the reverse index. Computed, never authored by a model —
// imports no model client (PRD §2 non-negotiable #1).
//
// Output shape (unchanged from the two-agent version — the UI builds against it):
// { rows: [{contractItem, kind, model, route, test, status}],
//   reverse: {filePath: [contractIds]},
//   gaps: [] }

/** Every artifact-producing role names its citable units differently (backend/frontend
 * use `modules[]`, uiux uses `screens[]`, qa uses `test_cases[]`) — pm/architect/docs
 * don't cite anything themselves, they're what OTHER roles cite. This just knows which
 * array to look at per role and normalizes to {role, path, implements}. */
const CITABLE_FIELD_BY_ROLE = { backend: 'modules', frontend: 'modules', uiux: 'screens', qa: 'test_cases' };

function citationsFromArtifacts(artifacts) {
  const out = [];
  for (const [role, field] of Object.entries(CITABLE_FIELD_BY_ROLE)) {
    const items = artifacts[role]?.[field];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      out.push({ role, path: item.path ?? item.id, implements: item.implements ?? [] });
    }
  }
  return out;
}

/**
 * @param {object} contract - the validated architect artifact
 * @param {object} artifacts - { [role]: artifactObject } for whatever roles have run
 * @param {string[]} [extraGaps] - gap strings already recorded upstream (Gate V1/V2 P4 prunes)
 */
export function buildTrace(contract, artifacts, extraGaps = []) {
  const citations = citationsFromArtifacts(artifacts);
  const byContractId = new Map(); // contract id -> citation[]
  const reverse = {};

  for (const c of citations) {
    for (const id of c.implements) {
      if (!byContractId.has(id)) byContractId.set(id, []);
      byContractId.get(id).push(c);
      reverse[c.path] = reverse[c.path] ?? [];
      if (!reverse[c.path].includes(id)) reverse[c.path].push(id);
    }
  }

  const label = (cites) => [...new Set(cites.map((c) => `${c.role}:${c.path}`))].join(', ') || null;

  const rows = [];

  for (const api of contract.apis) {
    const cites = byContractId.get(api.id) ?? [];
    rows.push({ contractItem: api.id, kind: 'api', model: label(cites), route: `${api.method} ${api.path}`, test: null, status: cites.length ? 'OK' : 'GAP' });
  }

  for (const c of contract.collections ?? []) {
    const cites = byContractId.get(c.id) ?? [];
    rows.push({ contractItem: c.id, kind: 'collection', model: label(cites), route: null, test: null, status: cites.length ? 'OK' : 'GAP' });
  }

  // Features aren't cited directly — only the APIs that implement them are. A feature
  // is covered when at least one of ITS APIs has a citation from any role.
  for (const f of contract.features) {
    const apisForFeature = contract.apis.filter((a) => a.feature_id === f.id);
    const cites = apisForFeature.flatMap((a) => byContractId.get(a.id) ?? []);
    rows.push({ contractItem: f.id, kind: 'feature', model: label(cites), route: null, test: null, status: cites.length ? 'OK' : 'GAP' });
  }

  const gaps = [...extraGaps, ...rows.filter((r) => r.status === 'GAP').map((r) => `${r.kind} ${r.contractItem} has no implementing module`)];

  return { rows, reverse, gaps };
}
