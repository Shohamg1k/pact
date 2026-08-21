// Deterministic layout for the system diagram: nested group boxes, tiles gridded inside
// them, three lanes (actors | system | external), and orthogonal edge routing.
//
// No physics simulation and no layout library — the same contract must always draw the
// same picture, because this diagram is used as documentation and as evidence. A
// force-directed layout would shuffle on every render and make two screenshots of the
// same system disagree.

export const TILE_W = 132;
export const TILE_H = 58;
export const TILE_GAP = 14;
export const GROUP_PAD = 16;
export const GROUP_HEAD = 30;
export const LANE_GAP = 68;
export const CANVAS_PAD = 26;

/** Nodes wrap into at most this many columns inside a group before starting a new row. */
function columnsFor(count) {
  if (count <= 2) return count || 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

/**
 * Measure a group: its own tiles gridded, with child groups stacked beneath them.
 * Returns {w, h} plus the placement plan, so measuring and placing share one code path
 * and can't disagree about size.
 */
function measure(groupId, ctx) {
  const own = ctx.nodesByGroup.get(groupId) ?? [];
  const kids = ctx.childGroups.get(groupId) ?? [];

  const cols = columnsFor(own.length);
  const rows = Math.ceil(own.length / cols) || 0;
  const gridW = cols > 0 ? cols * TILE_W + (cols - 1) * TILE_GAP : 0;
  const gridH = rows > 0 ? rows * TILE_H + (rows - 1) * TILE_GAP : 0;

  const kidPlans = kids.map((k) => ({ id: k.id, ...measure(k.id, ctx) }));
  const kidsW = kidPlans.length ? Math.max(...kidPlans.map((k) => k.w)) : 0;
  const kidsH = kidPlans.reduce((sum, k) => sum + k.h, 0) + Math.max(0, kidPlans.length - 1) * TILE_GAP;

  const innerW = Math.max(gridW, kidsW, 140);
  const innerH = gridH + (gridH && kidsH ? TILE_GAP : 0) + kidsH;

  return {
    w: innerW + GROUP_PAD * 2,
    h: innerH + GROUP_PAD * 2 + GROUP_HEAD,
    cols, rows, gridW, gridH, own, kidPlans,
  };
}

/** Place a measured group at (x, y), emitting absolute boxes for tiles and sub-groups. */
function place(groupId, plan, x, y, ctx, out, depth) {
  const group = ctx.groupById.get(groupId);
  out.groups.push({ ...group, x, y, w: plan.w, h: plan.h, depth });

  let cursorY = y + GROUP_HEAD + GROUP_PAD;
  const innerX = x + GROUP_PAD;

  plan.own.forEach((n, i) => {
    const c = i % plan.cols;
    const r = Math.floor(i / plan.cols);
    out.nodes.push({
      ...n,
      x: innerX + c * (TILE_W + TILE_GAP),
      y: cursorY + r * (TILE_H + TILE_GAP),
      w: TILE_W,
      h: TILE_H,
    });
  });
  if (plan.gridH) cursorY += plan.gridH + TILE_GAP;

  for (const kid of plan.kidPlans) {
    place(kid.id, kid, innerX, cursorY, ctx, out, depth + 1);
    cursorY += kid.h + TILE_GAP;
  }
}

/**
 * @param {{groups:Array, nodes:Array, edges:Array}} diagram
 * @returns {{groups:Array, nodes:Array, edges:Array, width:number, height:number}}
 */
export function layoutDiagram(diagram) {
  const groups = diagram.groups ?? [];
  const nodes = diagram.nodes ?? [];

  const groupById = new Map(groups.map((g) => [g.id, g]));
  // A node whose group doesn't exist would silently vanish; park it in a synthetic
  // lane instead so a model typo is visible rather than data-losing.
  const orphanNodes = nodes.filter((n) => !n.group || !groupById.has(n.group));
  if (orphanNodes.length) {
    groupById.set('__ungrouped', { id: '__ungrouped', label: 'Ungrouped', lane: 'main' });
  }

  const nodesByGroup = new Map();
  for (const n of nodes) {
    const gid = n.group && groupById.has(n.group) ? n.group : '__ungrouped';
    if (!nodesByGroup.has(gid)) nodesByGroup.set(gid, []);
    nodesByGroup.get(gid).push(n);
  }

  const childGroups = new Map();
  const roots = [];
  for (const g of groupById.values()) {
    if (g.parent && groupById.has(g.parent)) {
      if (!childGroups.has(g.parent)) childGroups.set(g.parent, []);
      childGroups.get(g.parent).push(g);
    } else {
      roots.push(g);
    }
  }

  const ctx = { groupById, nodesByGroup, childGroups };
  const out = { groups: [], nodes: [], edges: [] };

  // Three lanes, left to right: actors, the system itself, external dependencies.
  const lanes = { left: [], main: [], right: [] };
  for (const r of roots) lanes[r.lane ?? 'main'].push(r);

  const lanePlans = Object.fromEntries(
    Object.entries(lanes).map(([lane, gs]) => [lane, gs.map((g) => ({ id: g.id, ...measure(g.id, ctx) }))]),
  );
  const laneW = Object.fromEntries(
    Object.entries(lanePlans).map(([lane, plans]) => [lane, plans.length ? Math.max(...plans.map((p) => p.w)) : 0]),
  );
  const laneH = Object.fromEntries(
    Object.entries(lanePlans).map(([lane, plans]) => [
      lane,
      plans.reduce((s, p) => s + p.h, 0) + Math.max(0, plans.length - 1) * (TILE_GAP * 2),
    ]),
  );

  const totalH = Math.max(laneH.left, laneH.main, laneH.right, 120);
  let x = CANVAS_PAD;
  for (const lane of ['left', 'main', 'right']) {
    const plans = lanePlans[lane];
    if (!plans.length) continue;
    // Centre each lane vertically against the tallest, so the picture reads as balanced.
    let y = CANVAS_PAD + (totalH - laneH[lane]) / 2;
    for (const p of plans) {
      place(p.id, p, x, y, ctx, out, 0);
      y += p.h + TILE_GAP * 2;
    }
    x += laneW[lane] + LANE_GAP;
  }

  const nodeById = new Map(out.nodes.map((n) => [n.id, n]));
  out.edges = (diagram.edges ?? [])
    .map((e, i) => {
      const a = nodeById.get(e.from);
      const b = nodeById.get(e.to);
      if (!a || !b) return null; // an edge to a node that doesn't exist is dropped, not drawn wrong
      return { ...e, key: `${e.from}->${e.to}-${i}`, a, b, path: routeEdge(a, b) };
    })
    .filter(Boolean);

  out.width = Math.max(x - LANE_GAP + CANVAS_PAD, 420);
  out.height = totalH + CANVAS_PAD * 2;
  return out;
}

/** Anchor on the facing sides and bow the curve, so parallel edges stay distinguishable. */
export function routeEdge(a, b) {
  const aRight = a.x + a.w;
  const bRight = b.x + b.w;
  let x1;
  let x2;
  if (bRight < a.x) {
    x1 = a.x;
    x2 = bRight;
  } else if (b.x > aRight) {
    x1 = aRight;
    x2 = b.x;
  } else {
    x1 = a.x + a.w / 2;
    x2 = b.x + b.w / 2;
  }
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  const mx = (x1 + x2) / 2;
  if (Math.abs(x1 - x2) < 4) {
    // Vertically stacked: bow sideways so the line isn't hidden behind the tiles.
    const bow = 34;
    return `M ${x1} ${y1} C ${x1 + bow} ${y1}, ${x2 + bow} ${y2}, ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export const EDGE_STYLE = {
  request: { color: 'var(--blue)', label: 'Request / API call' },
  data: { color: 'var(--green)', label: 'Data / persistence' },
  auth: { color: 'var(--purple)', label: 'Authentication' },
  event: { color: 'var(--yellow)', label: 'Event / async' },
  deploy: { color: 'var(--text-dim)', label: 'Deployment' },
  external: { color: 'var(--red)', label: 'External / 3rd party' },
};

/**
 * When the Architect didn't emit a diagram (older contracts, or a model that skipped
 * it), derive one from what the contract does declare. Deterministic, so an old chat
 * still gets a real picture rather than an empty tab.
 */
export function deriveDiagram(contract) {
  const stack = contract.stack ?? {};
  const groups = [
    { id: 'clients', label: 'Clients', lane: 'left' },
    { id: 'system', label: stack.default ? `${stack.default} application` : 'Application', sublabel: stack.api, lane: 'main' },
    { id: 'data', label: 'Data', sublabel: stack.db, lane: 'right' },
  ];
  const nodes = [
    { id: 'user', label: 'End user', icon: 'user', group: 'clients', description: 'Whoever consumes the product — the actor every feature ultimately serves.', implements: [] },
    { id: 'client', label: 'Client app', icon: 'browser', group: 'clients', description: 'The browser or mobile client that calls the API.', implements: [] },
  ];
  const edges = [{ from: 'user', to: 'client', kind: 'request', label: 'uses' }];

  // One tile per feature, since features are the unit the contract is organised around.
  for (const f of contract.features ?? []) {
    const apis = (contract.apis ?? []).filter((a) => a.feature_id === f.id);
    nodes.push({
      id: `f-${f.id}`,
      label: f.name,
      sublabel: `${f.id} · ${apis.length} endpoint${apis.length === 1 ? '' : 's'}`,
      icon: 'service',
      group: 'system',
      description:
        `Serves feature ${f.id} (${f.priority}).\n\n` +
        (apis.length ? `Endpoints:\n${apis.map((a) => `  ${a.method} ${a.path}`).join('\n')}` : 'No endpoint declared for this feature.'),
      implements: [f.id, ...apis.map((a) => a.id)],
    });
    edges.push({ from: 'client', to: `f-${f.id}`, kind: 'request', label: 'HTTPS' });
  }

  for (const c of contract.collections ?? []) {
    nodes.push({
      id: `c-${c.id}`,
      label: c.name,
      sublabel: `${c.id} · ${(c.fields ?? []).length} fields`,
      icon: 'database',
      group: 'data',
      description: `Collection ${c.id}.\n\nFields:\n${(c.fields ?? []).map((x) => `  ${x}`).join('\n')}`,
      implements: [c.id],
    });
  }
  // Link a feature to a collection its APIs actually mention — inferred, and labelled so.
  for (const f of contract.features ?? []) {
    const blob = JSON.stringify((contract.apis ?? []).filter((a) => a.feature_id === f.id)).toLowerCase();
    for (const c of contract.collections ?? []) {
      if (blob.includes(c.id.toLowerCase()) || blob.includes(c.name.toLowerCase())) {
        edges.push({ from: `f-${f.id}`, to: `c-${c.id}`, kind: 'data', label: 'reads/writes', optional: true });
      }
    }
  }
  return { groups, nodes, edges, derived: true };
}
