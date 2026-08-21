import React, { useEffect, useMemo, useRef, useState } from 'react';
import DiagramIcon, { resolveIcon, ICON_COLOR } from './diagramIcons.jsx';
import { layoutDiagram, deriveDiagram, EDGE_STYLE, TILE_W, TILE_H } from './diagramLayout.js';

// The system diagram: nested zones, tiles with technology glyphs, typed and labelled
// connections, a legend — and it's interactive. Selecting a tile dims everything it
// isn't connected to and opens a brief on what it does, so the picture answers "how does
// this work" rather than only "what exists".
//
// Layout is deterministic (see diagramLayout.js): the same contract always draws the
// same picture, which matters when the diagram is used as documentation.

const GROUP_TINT = ['rgba(255,255,255,0.028)', 'rgba(255,255,255,0.038)', 'rgba(255,255,255,0.05)'];

export default function ArchitectureDiagram({ contract }) {
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(true); // a wide diagram in a narrow pane is unreadable
  const canvasRef = useRef(null);

  // The Architect draws the system when it can; otherwise derive a real picture from the
  // features/APIs/collections rather than showing an empty tab.
  const spec = useMemo(() => {
    if (!contract) return null;
    const d = contract.diagram;
    return d && (d.nodes ?? []).length ? d : deriveDiagram(contract);
  }, [contract]);

  const laid = useMemo(() => (spec ? layoutDiagram(spec) : null), [spec]);

  const related = useMemo(() => {
    if (!selected || !laid) return null;
    const nodes = new Set([selected]);
    const edges = new Set();
    for (const e of laid.edges) {
      if (e.from === selected || e.to === selected) {
        edges.add(e.key);
        nodes.add(e.from);
        nodes.add(e.to);
      }
    }
    return { nodes, edges };
  }, [selected, laid]);

  if (!contract) return <div className="diagram-empty">The Solution Architect has not produced a contract yet.</div>;
  if (!laid || laid.nodes.length === 0) return <div className="diagram-empty">This contract has nothing to draw yet.</div>;

  const sel = laid.nodes.find((n) => n.id === selected);
  const selEdges = selected ? laid.edges.filter((e) => e.from === selected || e.to === selected) : [];
  const nodeLabel = (id) => laid.nodes.find((n) => n.id === id)?.label ?? id;

  const dim = (on) => (!related ? 1 : on ? 1 : 0.13);
  const usedKinds = [...new Set(laid.edges.map((e) => e.kind ?? 'request'))];

  return (
    <div className="diagram-wrap">
      <FitWatcher canvasRef={canvasRef} width={laid.width} fit={fit} setZoom={setZoom} detailOpen={!!sel} />
      <div className="diagram-toolbar">
        <span className="badge mono">{laid.nodes.length} components</span>
        <span className="badge mono">{laid.edges.length} connections</span>
        {spec.derived && (
          <span className="badge warn" title="The Architect did not emit a diagram for this contract, so this was derived deterministically from its features, APIs and collections.">
            derived from the contract
          </span>
        )}
        <span style={{ flex: 1 }} />
        {selected && <button className="btn small ghost" onClick={() => setSelected(null)}>Clear selection</button>}
        <button className={`btn small ${fit ? '' : 'ghost'}`} onClick={() => setFit((f) => !f)} title="Scale the diagram to fit the pane">
          Fit
        </button>
        <button className="btn small ghost" onClick={() => { setFit(false); setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2))); }}>−</button>
        <span className="hint" style={{ minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn small ghost" onClick={() => { setFit(false); setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2))); }}>+</button>
      </div>

      <div className="diagram-body">
        <div className="diagram-canvas" ref={canvasRef}>
          <svg
            width={laid.width * zoom}
            height={laid.height * zoom}
            viewBox={`0 0 ${laid.width} ${laid.height}`}
            onClick={() => setSelected(null)}
          >
            <defs>
              {Object.entries(EDGE_STYLE).map(([kind, s]) => (
                <marker key={kind} id={`arrow-${kind}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 9 5 L 0 9 z" fill={s.color} />
                </marker>
              ))}
            </defs>

            {/* zones, outermost first so nesting reads correctly */}
            {laid.groups.map((g) => (
              <g key={g.id} opacity={related ? 0.55 : 1}>
                <rect
                  x={g.x} y={g.y} width={g.w} height={g.h} rx="10"
                  fill={GROUP_TINT[Math.min(g.depth, GROUP_TINT.length - 1)]}
                  stroke="var(--border)" strokeWidth="1"
                />
                <text x={g.x + 14} y={g.y + 19} fill="var(--text)" fontSize="12" fontWeight="600">{g.label}</text>
                {g.sublabel && (
                  <text x={g.x + 14} y={g.y + 19} dx={g.label.length * 6.6 + 12} fill="var(--text-faint)" fontSize="10.5">
                    {g.sublabel}
                  </text>
                )}
              </g>
            ))}

            {/* connections */}
            {laid.edges.map((e) => {
              const style = EDGE_STYLE[e.kind ?? 'request'] ?? EDGE_STYLE.request;
              const on = !related || related.edges.has(e.key);
              const mid = midpoint(e);
              return (
                <g key={e.key} opacity={on ? 1 : 0.08}>
                  <path
                    d={e.path}
                    fill="none"
                    stroke={style.color}
                    strokeWidth={on && related ? 2.2 : 1.4}
                    strokeDasharray={e.optional ? '5 4' : undefined}
                    markerEnd={`url(#arrow-${e.kind ?? 'request'})`}
                  />
                  {e.label && (
                    <g>
                      <rect x={mid.x - e.label.length * 3.1 - 5} y={mid.y - 8} width={e.label.length * 6.2 + 10} height={15} rx="7" fill="var(--bg)" stroke="var(--border-soft)" strokeWidth="0.8" />
                      <text x={mid.x} y={mid.y + 3} textAnchor="middle" fill="var(--text-dim)" fontSize="9.5">{e.label}</text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* component tiles */}
            {laid.nodes.map((n) => {
              const on = !related || related.nodes.has(n.id);
              const isSel = n.id === selected;
              const tint = ICON_COLOR[resolveIcon(n.icon)] ?? 'var(--blue)';
              return (
                <g
                  key={n.id}
                  className="dg-node"
                  opacity={dim(on)}
                  onClick={(ev) => { ev.stopPropagation(); setSelected(isSel ? null : n.id); }}
                >
                  <rect
                    x={n.x} y={n.y} width={TILE_W} height={TILE_H} rx="8"
                    fill="var(--raised)"
                    stroke={isSel ? tint : 'var(--border)'}
                    strokeWidth={isSel ? 2 : 1}
                  />
                  <rect x={n.x} y={n.y} width="3" height={TILE_H} rx="1.5" fill={tint} />
                  <foreignObject x={n.x + 11} y={n.y + 9} width="22" height="22">
                    <DiagramIcon name={n.icon} size={18} />
                  </foreignObject>
                  <text x={n.x + 38} y={n.y + 23} fill="var(--text-bright)" fontSize="11.5" fontWeight="500">
                    {trim(n.label, 13)}
                  </text>
                  {n.sublabel && (
                    <text x={n.x + 12} y={n.y + 44} fill="var(--text-faint)" fontSize="9.5">{trim(n.sublabel, 21)}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>

        {sel && (
          <aside className="diagram-detail">
            <div className="dd-head">
              <DiagramIcon name={sel.icon} size={20} />
              <div style={{ minWidth: 0 }}>
                <div className="dd-title">{sel.label}</div>
                {sel.sublabel && <div className="dd-sub">{sel.sublabel}</div>}
              </div>
              <button className="icon-btn" onClick={() => setSelected(null)} title="Close">×</button>
            </div>

            {sel.description ? (
              <p className="dd-body">{sel.description}</p>
            ) : (
              <p className="dd-body dim">No description was written for this component.</p>
            )}

            {(sel.implements ?? []).length > 0 && (
              <>
                <div className="section-title" style={{ marginTop: 14 }}>Implements</div>
                <div className="implements">
                  {sel.implements.map((id) => <span key={id} className="chip">{id}</span>)}
                </div>
              </>
            )}

            <div className="section-title" style={{ marginTop: 16 }}>
              Connections ({selEdges.length})
            </div>
            {selEdges.length === 0 && <div className="hint">Nothing connects to this component.</div>}
            {selEdges.map((e) => {
              const outgoing = e.from === selected;
              const other = outgoing ? e.to : e.from;
              const style = EDGE_STYLE[e.kind ?? 'request'] ?? EDGE_STYLE.request;
              return (
                <button key={e.key} className="dd-edge" onClick={() => setSelected(other)}>
                  <span className="dd-dir" style={{ color: style.color }}>{outgoing ? '→' : '←'}</span>
                  <span className="dd-edge-main">
                    <span className="dd-edge-name">{nodeLabel(other)}</span>
                    <span className="dd-edge-meta">
                      {e.label ? `${e.label} · ` : ''}{style.label}{e.optional ? ' · optional' : ''}
                    </span>
                    {e.description && <span className="dd-edge-desc">{e.description}</span>}
                  </span>
                </button>
              );
            })}
          </aside>
        )}
      </div>

      <div className="diagram-legend">
        {usedKinds.map((k) => (
          <span key={k} className="legend-key">
            <i className="legend-swatch" style={{ background: (EDGE_STYLE[k] ?? EDGE_STYLE.request).color }} />
            {(EDGE_STYLE[k] ?? EDGE_STYLE.request).label}
          </span>
        ))}
        <span className="legend-key"><i className="legend-dash" /> optional / inferred</span>
        <span className="legend-note">
          Click any component to see what it does and highlight what it talks to. Icons are technology categories, not vendor logos.
        </span>
      </div>
    </div>
  );
}

/** Keeps zoom matched to the pane width while Fit is on. The panes are user-resizable,
 * so this has to react to the container, not just to mount. */
function FitWatcher({ canvasRef, width, fit, setZoom, detailOpen }) {
  useEffect(() => {
    if (!fit) return;
    const el = canvasRef.current;
    if (!el) return;
    const apply = () => {
      const avail = el.clientWidth - 16;
      if (avail > 40) setZoom(Math.max(0.3, Math.min(1, +(avail / width).toFixed(3))));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, width, canvasRef, setZoom, detailOpen]);
  return null;
}

const trim = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

function midpoint(e) {
  const x1 = e.a.x + e.a.w / 2;
  const x2 = e.b.x + e.b.w / 2;
  const y1 = e.a.y + e.a.h / 2;
  const y2 = e.b.y + e.b.h / 2;
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
}
