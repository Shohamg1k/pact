import React, { useEffect, useState } from 'react';
import { getTrace } from '../api.js';

// UI-4: trace matrix table + gaps, both directions (VER-5, §8.5). Built against the locked
// shape from server/trace.js: {rows:[{contractItem,kind,model,route,test,status:'OK'|'GAP'}],
// reverse, gaps}. Older runs (or a run that hasn't reached agent2 yet) still report
// {rows: [], reverse: {}} — handled below, not treated as an error.
export default function TraceMatrix({ runId, refreshKey, onJumpToFile }) {
  const [trace, setTrace] = useState(null);

  // Refetches on refreshKey change (App.jsx passes gateV2's phase status) so a panel opened
  // before trace.json is written doesn't stay stuck on the empty-state message forever.
  useEffect(() => {
    let cancelled = false;
    getTrace(runId).then((t) => {
      if (!cancelled) setTrace(t);
    });
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey]);

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
          trace.json is empty for this run — either Agent 2 hasn't reached Gate V2 yet, or
          this run predates trace.js landing. Computed deterministically from the contract +
          manifest (VER-5); this table renders live once rows[] populate.
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
                // `model` holds the implementing file path(s), comma-joined (trace.js) —
                // that's what "jump to file" means; `route` is METHOD /path, not a file.
                const firstFile = r.model?.split(',')[0]?.trim();
                return (
                  <tr key={i} onClick={() => firstFile && onJumpToFile?.(firstFile)}>
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
