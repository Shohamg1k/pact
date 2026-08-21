import React, { useMemo, useState } from 'react';
import { useFullscreenPane } from '../lib/useFullscreenPane.js';

// Visual database schema — one table card per collection, with field name/type/flags
// parsed from the contract's free-text field descriptions, and reference lines drawn
// between collections when a field name plausibly points at another collection (e.g.
// `supplier_id` -> the `suppliers` collection). The contract has no explicit FK model
// (schemas/contract.js's CollectionSchema is prose strings, not structured columns), so
// this is the same class of best-effort heuristic ArchitectureDiagram's Miro export
// already uses for feature->collection arrows — a real visual aid, not an authoritative
// trace (that's trace.js's job, over the real implements[] links the Backend agent writes).

const BOX_W = 230;
const ROW_H = 20;
const HEADER_H = 34;
const GAP_X = 60;
const GAP_Y = 50;
const COLS = 3;

/** "owner_id string required, indexed, set from token subject (BR-01)" ->
 * {name, type, flags: ['required','indexed'], rest}. Best-effort: some entries describe
 * a compound index rather than a field and won't parse into a clean type — still shown,
 * just without flag pills. */
function parseField(raw) {
  const m = raw.match(/^(\S+)\s+(\S+)\s*(.*)$/);
  if (!m) return { name: raw, type: '', flags: [], pk: false };
  const [, name, type, rest] = m;
  const flags = [];
  if (/primary key/i.test(rest)) flags.push('PK');
  if (/\brequired\b/i.test(rest)) flags.push('required');
  if (/\bindexed\b|\bindex\b/i.test(rest)) flags.push('indexed');
  if (/\bunique\b/i.test(rest)) flags.push('unique');
  return { name, type, flags, pk: name === '_id' || flags.includes('PK'), raw };
}

/** A field named `xxx_id` plausibly references the collection whose singular name is
 * `xxx` — heuristic only, same spirit as connectors/miro.js's apiTouchesCollection. */
function findReferences(collections) {
  const bySingular = new Map(collections.map((c) => [c.name.toLowerCase().replace(/s$/, ''), c]));
  const refs = [];
  for (const c of collections) {
    for (const raw of c.fields) {
      const { name } = parseField(raw);
      if (name === '_id' || !name.endsWith('_id')) continue;
      const target = bySingular.get(name.slice(0, -3).toLowerCase());
      if (target && target.id !== c.id) refs.push({ from: c.id, to: target.id, field: name });
    }
  }
  return refs;
}

function layout(collections) {
  const boxes = [];
  let rowStartIdx = 0;
  let x = 0;
  let y = 0;
  let rowMaxH = 0;
  collections.forEach((c, i) => {
    const fields = c.fields.map(parseField);
    const h = HEADER_H + fields.length * ROW_H + 10;
    if (i > 0 && i - rowStartIdx >= COLS) {
      x = 0;
      y += rowMaxH + GAP_Y;
      rowMaxH = 0;
      rowStartIdx = i;
    }
    boxes.push({ id: c.id, name: c.name, fields, x, y, w: BOX_W, h });
    rowMaxH = Math.max(rowMaxH, h);
    x += BOX_W + GAP_X;
  });
  const width = Math.min(collections.length, COLS) * (BOX_W + GAP_X) - GAP_X;
  const height = y + rowMaxH;
  return { boxes, width: Math.max(width, BOX_W), height: Math.max(height, HEADER_H) };
}

export default function SchemaDiagram({ contract }) {
  const [selected, setSelected] = useState(null);
  const [fullscreen, setFullscreen] = useFullscreenPane();
  const collections = contract?.collections ?? [];

  const { boxes, width, height, refs } = useMemo(() => {
    const l = layout(collections);
    return { ...l, refs: findReferences(collections) };
  }, [collections]);

  if (!contract) return <div className="diagram-empty">The Solution Architect has not produced a contract yet.</div>;
  if (collections.length === 0) return <div className="diagram-empty">This contract declares no collections.</div>;

  const byId = new Map(boxes.map((b) => [b.id, b]));
  const related = selected ? new Set(refs.filter((r) => r.from === selected || r.to === selected).flatMap((r) => [r.from, r.to])) : null;

  return (
    <div className={`diagram-wrap ${fullscreen ? 'diagram-fullscreen' : ''}`}>
      <div className="diagram-toolbar">
        <span className="badge mono">{collections.length} collections</span>
        <span className="badge mono">{refs.length} references</span>
        <span style={{ flex: 1 }} />
        {selected && <button className="btn small ghost" onClick={() => setSelected(null)}>Clear selection</button>}
        <button className="btn small ghost" title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'} onClick={() => setFullscreen((f) => !f)}>
          {fullscreen ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <div className="diagram-body">
        <div className="diagram-canvas">
          <svg width={width} height={height + 20} viewBox={`0 0 ${width} ${height + 20}`} onClick={() => setSelected(null)}>
            <defs>
              <marker id="schema-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--accent)" />
              </marker>
            </defs>
            {refs.map((r, i) => {
              const from = byId.get(r.from);
              const to = byId.get(r.to);
              if (!from || !to) return null;
              const x1 = from.x + from.w / 2;
              const y1 = from.y + from.h;
              const x2 = to.x + to.w / 2;
              const y2 = to.y;
              const on = !related || (related.has(r.from) && related.has(r.to));
              const midY = (y1 + y2) / 2;
              return (
                <g key={i} opacity={on ? 1 : 0.12}>
                  <path d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`} fill="none" stroke="var(--accent)" strokeWidth="1.6" markerEnd="url(#schema-arrow)" />
                  <rect x={(x1 + x2) / 2 - r.field.length * 3 - 5} y={midY - 8} width={r.field.length * 6 + 10} height={15} rx="7" fill="var(--bg)" stroke="var(--border-soft)" strokeWidth="0.8" />
                  <text x={(x1 + x2) / 2} y={midY + 3} textAnchor="middle" fill="var(--text-dim)" fontSize="9.5">{r.field}</text>
                </g>
              );
            })}
            {boxes.map((b) => {
              const on = !related || related.has(b.id);
              const isSel = b.id === selected;
              return (
                <g key={b.id} opacity={!related ? 1 : on ? 1 : 0.15} className="dg-node" onClick={(e) => { e.stopPropagation(); setSelected(isSel ? null : b.id); }}>
                  <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="8" fill="var(--raised)" stroke={isSel ? 'var(--accent)' : 'var(--border)'} strokeWidth={isSel ? 2 : 1} />
                  <rect x={b.x} y={b.y} width={b.w} height={HEADER_H} rx="8" fill="var(--accent)" opacity="0.12" />
                  <text x={b.x + 12} y={b.y + 22} fill="var(--text-bright)" fontSize="12.5" fontWeight="600">{b.name}</text>
                  {b.fields.map((f, i) => (
                    <g key={i}>
                      <text x={b.x + 12} y={b.y + HEADER_H + 14 + i * ROW_H} fill={f.pk ? 'var(--accent)' : 'var(--text)'} fontSize="10.5" fontWeight={f.pk ? 700 : 400}>
                        {trim(f.name, 16)}
                      </text>
                      <text x={b.x + b.w - 12} y={b.y + HEADER_H + 14 + i * ROW_H} textAnchor="end" fill="var(--text-faint)" fontSize="9.5">
                        {trim(f.type, 12)}{f.flags.length ? ` · ${f.flags.join(',')}` : ''}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })}
          </svg>
        </div>
      </div>
      <div className="diagram-legend">
        <span className="legend-note">
          Click a table to highlight what it references. Reference lines are inferred from
          `&lt;name&gt;_id` fields matching another collection — a visual hint, not an authoritative trace.
        </span>
      </div>
    </div>
  );
}

const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));
