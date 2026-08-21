// The trace matrix (PRD §16 VER-5): a pure function over contract + backend manifest ->
// rows (contract item -> model -> route -> test -> OK/gap) plus the reverse index. Computed,
// never authored by a model — imports no model client (PRD §2 non-negotiable #1).
//
// Output shape (locked with the UI track, which builds UI-4 against it):
// { rows: [{contractItem, kind, model, route, test, status}],
//   reverse: {filePath: [contractIds]},
//   gaps: [] }

/**
 * @param {object} contract - the validated architecture contract
 * @param {object} backend - the validated backend manifest
 * @param {string[]} [extraGaps] - gap strings already recorded upstream (e.g. Gate V1/V2 P4 prunes)
 */
export function buildTrace(contract, backend, extraGaps = []) {
  const byContractId = new Map(); // contract id -> module[]
  const reverse = {};

  for (const m of backend.modules) {
    for (const id of m.implements ?? []) {
      if (!byContractId.has(id)) byContractId.set(id, []);
      byContractId.get(id).push(m);
      reverse[m.path] = reverse[m.path] ?? [];
      if (!reverse[m.path].includes(id)) reverse[m.path].push(id);
    }
  }

  const rows = [];

  for (const api of contract.apis) {
    const mods = byContractId.get(api.id) ?? [];
    rows.push({
      contractItem: api.id,
      kind: 'api',
      model: mods.map((m) => m.path).join(', ') || null,
      route: `${api.method} ${api.path}`,
      test: null, // VER-4 (generated contract tests) not wired yet
      status: mods.length ? 'OK' : 'GAP',
    });
  }

  for (const c of contract.collections ?? []) {
    const mods = byContractId.get(c.id) ?? [];
    rows.push({
      contractItem: c.id,
      kind: 'collection',
      model: mods.map((m) => m.path).join(', ') || null,
      route: null,
      test: null,
      status: mods.length ? 'OK' : 'GAP',
    });
  }

  // Features aren't cited by modules directly — only their APIs are (per the locked
  // backend/v1 shape, implements[] holds api/collection/business-rule ids). A feature is
  // covered when at least one of the APIs citing it (feature_id) has an implementing module.
  for (const f of contract.features) {
    const apisForFeature = contract.apis.filter((a) => a.feature_id === f.id);
    const mods = apisForFeature.flatMap((a) => byContractId.get(a.id) ?? []);
    rows.push({
      contractItem: f.id,
      kind: 'feature',
      model: [...new Set(mods.map((m) => m.path))].join(', ') || null,
      route: null,
      test: null,
      status: mods.length ? 'OK' : 'GAP',
    });
  }

  const gaps = [...extraGaps, ...rows.filter((r) => r.status === 'GAP').map((r) => `${r.kind} ${r.contractItem} has no implementing module`)];

  return { rows, reverse, gaps };
}
