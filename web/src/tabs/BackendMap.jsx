import React, { useMemo, useState } from 'react';

// Visualizes the Backend manifest as the thing it actually is: a set of HTTP routes
// grouped by the module that serves them, each carrying the contract ids it implements,
// plus the data models behind them. Route paths are extracted from the generated source
// with the same regex Gate V2's conformance check uses, so what's drawn here is exactly
// what the gate verified — not a second, looser reading of the code.

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/gi;

function extractRoutes(module) {
  const found = [];
  ROUTE_RE.lastIndex = 0;
  let m;
  while ((m = ROUTE_RE.exec(module.code))) found.push({ method: m[1].toUpperCase(), path: m[2] });
  return found;
}

export default function BackendMap({ manifest, contract, onOpenFile }) {
  const [filter, setFilter] = useState('');

  const model = useMemo(() => {
    if (!manifest) return null;
    const modules = manifest.modules ?? [];
    const routeModules = modules
      .filter((m) => m.kind === 'route')
      .map((m) => ({ ...m, routes: extractRoutes(m) }))
      .filter((m) => m.routes.length > 0);
    const models = modules.filter((m) => m.kind === 'model');
    const other = modules.filter((m) => m.kind !== 'route' && m.kind !== 'model');
    const declared = new Set((contract?.apis ?? []).map((a) => `${a.method} ${a.path}`));
    const implemented = new Set(routeModules.flatMap((m) => m.routes.map((r) => `${r.method} ${r.path}`)));
    const missing = (contract?.apis ?? []).filter((a) => !implemented.has(`${a.method} ${a.path}`));
    return { routeModules, models, other, declared, missing, moduleCount: modules.length };
  }, [manifest, contract]);

  if (!manifest) return <div className="empty-state">The Backend agent has not run for this chat yet.</div>;

  const q = filter.trim().toLowerCase();
  const match = (s) => !q || s.toLowerCase().includes(q);

  return (
    <div className="editor-pad">
      <div className="toolbar">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter routes, models, contract ids…"
          style={{ minWidth: 260 }}
        />
        <span className="badge mono">{model.moduleCount} modules</span>
        <span className="badge mono">{model.routeModules.reduce((n, m) => n + m.routes.length, 0)} routes</span>
        <span className="badge mono">{model.models.length} models</span>
        {model.missing.length > 0 && <span className="badge bad">{model.missing.length} declared but unimplemented</span>}
        {model.missing.length === 0 && contract && <span className="badge ok">every declared API implemented</span>}
      </div>

      {model.missing.length > 0 && (
        <div className="notice bad">
          The contract declares {model.missing.length} endpoint{model.missing.length === 1 ? '' : 's'} with no matching
          route in the generated code: {model.missing.map((a) => `${a.method} ${a.path}`).join(' · ')}
        </div>
      )}

      <div className="section-title">Routes</div>
      {model.routeModules.map((m) => {
        const rows = m.routes.filter((r) => match(`${r.method} ${r.path}`) || match(m.path) || (m.implements ?? []).some(match));
        if (rows.length === 0) return null;
        return (
          <div key={m.path} style={{ marginBottom: 18 }}>
            <button className="endpoint" style={{ color: 'var(--text)', paddingLeft: 0 }} onClick={() => onOpenFile?.(m.path)}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{m.path}</span>
              <span className="badge" style={{ marginLeft: 8 }}>open</span>
            </button>
            <table className="grid" style={{ marginTop: 6 }}>
              <tbody>
                {rows.map((r, i) => {
                  const key = `${r.method} ${r.path}`;
                  const declared = model.declared.has(key);
                  return (
                    <tr key={i}>
                      <td style={{ width: 70 }}><span className={`verb ${r.method}`}>{r.method}</span></td>
                      <td className="mono">{r.path}</td>
                      <td style={{ width: 130 }}>
                        {declared ? <span className="badge ok">in contract</span> : <span className="badge bad">not declared</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="implements" style={{ marginTop: 6 }}>
              {(m.implements ?? []).map((id) => (
                <span key={id} className="chip">{id}</span>
              ))}
            </div>
          </div>
        );
      })}

      <div className="section-title" style={{ marginTop: 26 }}>Data models</div>
      <div className="card-grid">
        {model.models
          .filter((m) => match(m.path) || (m.implements ?? []).some(match))
          .map((m) => {
            const collection = (contract?.collections ?? []).find((c) => (m.implements ?? []).includes(c.id));
            return (
              <div key={m.path} className="mini-card">
                <div className="mini-card-title">
                  <button onClick={() => onOpenFile?.(m.path)} style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--accent)' }}>
                    {m.path.split('/').pop()}
                  </button>
                </div>
                <div className="implements" style={{ marginBottom: 6 }}>
                  {(m.implements ?? []).map((id) => (
                    <span key={id} className="chip">{id}</span>
                  ))}
                </div>
                {collection && (
                  <div className="mini-card-body">
                    {(collection.fields ?? []).slice(0, 7).map((f) => (
                      <div key={f} style={{ fontFamily: 'var(--mono)', fontSize: 10.5 }}>{f}</div>
                    ))}
                    {(collection.fields ?? []).length > 7 && <div style={{ fontSize: 10.5 }}>+{collection.fields.length - 7} more</div>}
                  </div>
                )}
              </div>
            );
          })}
      </div>

      {model.other.length > 0 && (
        <>
          <div className="section-title" style={{ marginTop: 26 }}>Supporting modules</div>
          <div className="implements">
            {model.other.filter((m) => match(m.path)).map((m) => (
              <button key={m.path} className="badge mono" onClick={() => onOpenFile?.(m.path)}>
                {m.path} · {m.kind}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
