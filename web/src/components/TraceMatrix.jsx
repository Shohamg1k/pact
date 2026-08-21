import React, { useEffect, useState } from 'react';
import { getTrace } from '../api.js';

// UI-4: trace matrix table + gaps, both directions (VER-5, §8.5). Built against the locked
// shape from server/trace.js: {rows:[{contractItem,kind,model,route,test,status:'OK'|'GAP'}],
// reverse, gaps}. Older runs (or a run that hasn't reached agent2 yet) still report
// {rows: [], reverse: {}} — handled below, not treated as an error.
export default function TraceMatrix({ chatId, refreshKey, onJumpToFile }) {
  const [trace, setTrace] = useState(null);

  // Refetches on refreshKey change so a panel opened before trace.json is written
  // doesn't stay stuck on the empty-state message forever.
  useEffect(() => {
    let cancelled = false;
    getTrace(chatId).then((t) => {
      if (!cancelled) setTrace(t);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, refreshKey]);

  if (!trace) return <div className="empty-state">loading…</div>;

  const rows = trace.rows ?? [];
  const gaps = trace.gaps ?? [];

  return (
    <div>
      {gaps.length > 0 && (
        <div className="gap-banner">
          {gaps.length} gap{gaps.length === 1 ? '' : 's'}: {gaps.join(' · ')}
        </div>
      )}
      {rows.length === 0 ? (
        <div className="gap-notice">
          trace.json is empty for this chat — the Architect hasn't produced a contract yet
          (nothing else can be traced against). Computed deterministically from the contract
          + whatever roles have run (VER-5); this table renders live once rows[] populate.
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="trace-table">
            <thead>
              <tr>
                <th>Contract item</th>
                <th>Kind</th>
                <th>Model</th>
                <th>Route</th>
                <th>Test</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                // `model` holds "role:path" citations, comma-joined (trace.js) — jumping
                // needs BOTH which role's code viewer to open and which file within it.
                const first = r.model?.split(',')[0]?.trim();
                const [firstRole, firstPath] = first?.includes(':') ? first.split(/:(.+)/) : [null, first];
                const jumpable = firstRole === 'backend' || firstRole === 'frontend';
                return (
                  <tr key={i} onClick={() => jumpable && onJumpToFile?.(firstRole, firstPath)}>
                    <td>{r.contractItem}</td>
                    <td>{r.kind}</td>
                    <td>{r.model ?? '—'}</td>
                    <td>{r.route ?? '—'}</td>
                    <td>{r.test ?? '—'}</td>
                    <td>
                      <span className={`badge ${r.status === 'OK' ? 'ok' : r.status === 'GAP' ? 'bad' : ''}`}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
