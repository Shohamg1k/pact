import React from 'react';

// Generalized from a fixed 6-phase strip to whatever roles are in the current batch
// (registry.js's topological order) — the two-agent Architect->Backend demo path still
// renders as exactly two nodes when that's the whole selection; N roles render as N.
const STATUS_TEXT = {
  pending: 'waiting',
  running: 'running…',
  passed: 'passed',
  awaiting_human: 'needs answer',
  failed: 'failed',
};

function chipLabel(entry) {
  switch (entry.event) {
    case 'repair':
      return `repair #${(entry.detail?.attempt ?? 0) + 1}`;
    case 'failover':
      return `failover ← ${entry.adapter ?? '?'}`;
    case 'awaiting_human':
      return 'asked human';
    case 'exhausted':
      return 'exhausted repairs';
    default:
      return entry.event;
  }
}

function chipClass(entry) {
  if (entry.event === 'repair') return 'chip repair';
  if (entry.event === 'failover') return 'chip failover';
  return 'chip other';
}

/** @param {{role: string, label: string, status: string, adapter?: string}[]} nodes */
export default function PipelineStrip({ nodes, chips }) {
  if (nodes.length === 0) return null;
  return (
    <div className="pipeline-strip">
      {nodes.map((n, i) => (
        <React.Fragment key={n.role}>
          <div className={`phase-node ${n.status}`}>
            <div className="name">
              <span className="dot" />
              {n.label}
            </div>
            <div className="status-text">
              {STATUS_TEXT[n.status] ?? n.status}
              {n.adapter ? ` · ${n.adapter}` : ''}
            </div>
            {(chips[n.role] ?? []).length > 0 && (
              <div className="phase-chips">
                {chips[n.role].map((c, idx) => (
                  <span key={idx} className={chipClass(c)} title={JSON.stringify(c.detail)}>
                    {chipLabel(c)}
                  </span>
                ))}
              </div>
            )}
          </div>
          {i < nodes.length - 1 && <span className="arrow-connector">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
