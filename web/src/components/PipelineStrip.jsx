import React from 'react';

// UI-1: the run theatre pipeline strip. Nodes are always these six phases, in this order
// (PRD §10, §11) — the fixed shape IS the two-agent compliance guarantee (CORE-2).
const PHASE_LABELS = {
  agent1: 'Agent 1 · Architect',
  gateV1: 'Gate V1',
  agent2: 'Agent 2 · Backend',
  gateV2: 'Gate V2',
  run: 'Run',
  connectors: 'Connectors',
};

const STATUS_TEXT = {
  pending: 'waiting',
  running: 'running…',
  passed: 'passed',
  repairing: 'repairing…',
  awaiting_human: 'needs answer',
  failed: 'failed',
};

function chipLabel(entry) {
  switch (entry.event) {
    case 'repair':
      return `repair #${(entry.detail?.attempt ?? 0) + 1}`;
    case 'failover':
      return `failover ← ${entry.adapter ?? '?'}`;
    case 'drift':
      return `drift: ${entry.detail?.file ?? entry.detail ?? ''}`;
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
  if (entry.event === 'drift') return 'chip drift';
  return 'chip other';
}

export default function PipelineStrip({ phases, chips }) {
  return (
    <div className="pipeline-strip">
      {phases.map((p, i) => (
        <React.Fragment key={p.name}>
          <div className={`phase-node ${p.status}`}>
            <div className="name">
              <span className="dot" />
              {PHASE_LABELS[p.name] ?? p.name}
            </div>
            <div className="status-text">
              {STATUS_TEXT[p.status] ?? p.status}
              {p.adapter && p.adapter !== 'stub' ? ` · ${p.adapter}` : ''}
              {p.name === 'agent2' && p.adapter === 'stub' ? ' (stub — feat/core-pipeline)' : ''}
            </div>
            {(chips[p.name] ?? []).length > 0 && (
              <div className="phase-chips">
                {chips[p.name].map((c, idx) => (
                  <span key={idx} className={chipClass(c)} title={JSON.stringify(c.detail)}>
                    {chipLabel(c)}
                  </span>
                ))}
              </div>
            )}
          </div>
          {i < phases.length - 1 && <span className="arrow-connector">→</span>}
        </React.Fragment>
      ))}
    </div>
  );
}
