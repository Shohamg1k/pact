import React, { useMemo, useState } from 'react';

// A real architecture diagram computed from the contract — features on the left, the
// APIs that serve them in the middle, the collections they touch on the right, with
// edges drawn from the contract's own provenance links (apis[].feature_id, and a
// collection reference inferred from an API's declared request/response/rules).
//
// Deterministic layout (no physics sim, no layout library): three columns, each node
// stacked in contract order, edges as cubic curves. That keeps it stable between
// renders — the same contract always draws the same picture, which matters when the
// diagram is being used as evidence rather than decoration.

const COL = { feature: 0, api: 1, collection: 2 };
const COLOR = { feature: '#c586c0', api: '#4daafc', collection: '#4ec9b0' };
const NODE_W = 210;
const NODE_H = 34;
const GAP_Y = 12;
const GAP_X = 130;
const PAD = 28;

/** Which collections does this API plausibly touch? The contract has no explicit
 * api→collection field, so this looks for a collection id or name mentioned anywhere in
 * the API's rules/request/response — stated as inferred, never presented as declared. */
function inferCollections(api, collections) {
  const haystack = JSON.stringify([api.rules ?? [], api.request ?? {}, api.response ?? {}, api.path]).toLowerCase();
  return collections.filter((c) => haystack.includes(c.id.toLowerCase()) || haystack.includes(c.name.toLowerCase())).map((c) => c.id);
}

function layout(contract) {
  const features = contract.features ?? [];
  const apis = contract.apis ?? [];
  const collections = contract.collections ?? [];

  const columns = [
    features.map((f) => ({ id: f.id, kind: 'feature', title: f.id, sub: f.name })),
    apis.map((a) => ({ id: a.id, kind: 'api', title: `${a.method} ${a.path}`, sub: a.id })),
    collections.map((c) => ({ id: c.id, kind: 'collection', title: c.name, sub: `${c.id} · ${(c.fields ?? []).length} fields` })),
  ];

  const tallest = Math.max(1, ...columns.map((c) => c.length));
  const height = PAD * 2 + tallest * (NODE_H + GAP_Y);
  const width = PAD * 2 + 3 * NODE_W + 2 * GAP_X;

  const nodes = [];
  columns.forEach((col, ci) => {
    // Centre shorter columns against the tallest so the picture reads as balanced.
    const offset = ((tallest - col.length) * (NODE_H + GAP_Y)) / 2;
    col.forEach((n, ri) => {
      nodes.push({
        ...n,
        x: PAD + ci * (NODE_W + GAP_X),
        y: PAD + offset + ri * (NODE_H + GAP_Y),
      });
    });
  });

  const byId = new Map(nodes.map((n) => [`${n.kind}:${n.id}`, n]));
  const edges = [];
  for (const api of apis) {
    const to = byId.get(`api:${api.id}`);
    const from = byId.get(`feature:${api.feature_id}`);
    if (from && to) edges.push({ from, to, kind: 'feature' });
    for (const cid of inferCollections(api, collections)) {
      const target = byId.get(`collection:${cid}`);
      if (target) edges.push({ from: to, to: target, kind: 'collection', inferred: true });
    }
  }
  return { nodes, edges, width, height };
}

function edgePath(a, b) {
  const x1 = a.x + NODE_W;
  const y1 = a.y + NODE_H / 2;
  const x2 = b.x;
  const y2 = b.y + NODE_H / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
}

export default function ArchitectureDiagram({ contract }) {
  const [hover, setHover] = useState(null);
  const { nodes, edges, width, height } = useMemo(() => layout(contract ?? {}), [contract]);

  if (!contract) return <div className="diagram-empty">The Solution Architect has not produced a contract yet.</div>;
  if (nodes.length === 0) return <div className="diagram-empty">This contract declares no features, APIs, or collections to draw.</div>;

  const isLit = (n) => {
    if (!hover) return true;
    if (hover === `${n.kind}:${n.id}`) return true;
    return edges.some(
      (e) =>
        (`${e.from.kind}:${e.from.id}` === hover && `${e.to.kind}:${e.to.id}` === `${n.kind}:${n.id}`) ||
        (`${e.to.kind}:${e.to.id}` === hover && `${e.from.kind}:${e.from.id}` === `${n.kind}:${n.id}`),
    );
  };
  const edgeLit = (e) => !hover || `${e.from.kind}:${e.from.id}` === hover || `${e.to.kind}:${e.to.id}` === hover;

  return (
    <div className="diagram-wrap">
      <div className="diagram-canvas">
        <svg width={width} height={height} onMouseLeave={() => setHover(null)}>
          <g>
            {edges.map((e, i) => (
              <path
                key={i}
                d={edgePath(e.from, e.to)}
                stroke={COLOR[e.kind === 'collection' ? 'collection' : 'feature']}
                strokeWidth={hover && edgeLit(e) ? 2 : 1.2}
                strokeDasharray={e.inferred ? '4 3' : undefined}
                opacity={edgeLit(e) ? 0.75 : 0.12}
                fill="none"
              />
            ))}
          </g>
          {nodes.map((n) => {
            const lit = isLit(n);
            return (
              <g
                key={`${n.kind}:${n.id}`}
                className="node-box"
                transform={`translate(${n.x},${n.y})`}
                opacity={lit ? 1 : 0.2}
                onMouseEnter={() => setHover(`${n.kind}:${n.id}`)}
              >
                <rect className="node-rect" width={NODE_W} height={NODE_H} rx="4" fill="#252526" stroke={COLOR[n.kind]} strokeWidth="1.2" />
                <rect width="3" height={NODE_H} rx="1.5" fill={COLOR[n.kind]} />
                <text x="12" y="15" fill="#e6e6e6" fontSize="11.5" fontFamily="var(--mono)">
                  {n.title.length > 30 ? n.title.slice(0, 29) + '…' : n.title}
                </text>
                <text x="12" y="27" fill="#8a8a8a" fontSize="10">
                  {(n.sub ?? '').length > 34 ? n.sub.slice(0, 33) + '…' : n.sub}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="diagram-legend">
        <span className="legend-key"><i className="legend-swatch" style={{ background: COLOR.feature }} /> Feature</span>
        <span className="legend-key"><i className="legend-swatch" style={{ background: COLOR.api }} /> API</span>
        <span className="legend-key"><i className="legend-swatch" style={{ background: COLOR.collection }} /> Collection</span>
        <span className="legend-note">
          solid = declared provenance (<code>feature_id</code>) · dashed = collection use inferred from the API's rules/shape
        </span>
      </div>
    </div>
  );
}
