import React from 'react';

export default function PMViewer({ artifact }) {
  if (!artifact) return <div className="empty-state">pm hasn't run yet.</div>;
  return (
    <div>
      <div className="card-grid">
        {artifact.personas.map((p) => (
          <div key={p.id} className="mini-card">
            <div className="mini-card-title">
              {p.name} <span className="badge mono small">{p.id}</span>
            </div>
            <div className="mini-card-body">{p.description}</div>
          </div>
        ))}
      </div>
      <table className="trace-table" style={{ marginTop: 14 }}>
        <thead>
          <tr>
            <th>id</th>
            <th>feature</th>
            <th>priority</th>
            <th>personas</th>
          </tr>
        </thead>
        <tbody>
          {artifact.features.map((f) => (
            <tr key={f.id}>
              <td className="mono">{f.id}</td>
              <td>
                {f.name}
                <div style={{ color: 'var(--text-faint)', fontSize: 12 }}>{f.description}</div>
              </td>
              <td>
                <span className={`badge ${f.priority === 'must' ? 'ok' : f.priority === 'should' ? 'warn' : ''}`}>{f.priority}</span>
              </td>
              <td className="mono">{(f.persona_ids ?? []).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {artifact.gaps?.length > 0 && <div className="gap-banner">{artifact.gaps.join(' · ')}</div>}
    </div>
  );
}
