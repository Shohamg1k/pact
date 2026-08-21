import React, { useEffect, useState } from 'react';
import { getTrace } from '../api.js';

// UI-4: trace matrix table + gaps, both directions (VER-5, §8.5). Currently always
// {rows: [], reverse: {}} — trace.js hasn't landed (feat/core-pipeline). Built against the
// documented future shape {rows:[{contractItem,kind,model,route,test,status}], reverse, gaps}
// so no UI rewrite is needed when it does.
export default function TraceMatrix({ runId, onJumpToFile }) {
  const [trace, setTrace] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getTrace(runId).then((t) => {
      if (!cancelled) setTrace(t);
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

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
          trace.json is still empty ({'{rows: [], reverse: {}}'}) — trace.js computes this
          matrix deterministically from the contract + manifest and hasn't landed yet
          (feat/core-pipeline). This table renders live once rows[] populate.
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
              {rows.map((r, i) => (
                <tr key={i} onClick={() => r.route && onJumpToFile?.(r.route)}>
                  <td>{r.contractItem}</td>
                  <td>{r.kind}</td>
                  <td>{r.model ?? '—'}</td>
                  <td>{r.route ?? '—'}</td>
                  <td>{r.test ?? '—'}</td>
                  <td>
                    <span className={`badge ${r.status === 'ok' ? 'ok' : r.status === 'gap' ? 'bad' : ''}`}>
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
