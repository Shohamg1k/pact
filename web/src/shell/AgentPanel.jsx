import React from 'react';
import { ROLE_ICON } from './icons.jsx';

// The run surface, in the sidebar rather than the editor: pick agents, generate, watch
// them progress. Keeping it out of the editor area is the point of the redesign — the
// editor is for looking at outputs, this is for producing them.

function isSatisfied(role, graph, available) {
  const requires = graph[role]?.requires ?? [];
  if (requires.length === 0) return true;
  return requires.some((group) => group.every((r) => available.has(r)));
}

export default function AgentPanel({ roles, existing, running, failed, selected, onToggle, onGenerate, busy, error, roleLabels, disabled }) {
  const graph = Object.fromEntries(roles.map((r) => [r.id, r]));
  const available = new Set(existing);
  const satisfied = {};
  for (const r of roles) {
    satisfied[r.id] = isSatisfied(r.id, graph, available);
    if (selected.has(r.id)) available.add(r.id);
  }

  return (
    <>
      <div className="sidebar-title">
        <span>Agents</span>
      </div>
      <div className="sidebar-scroll">
        {disabled && <div className="tree-empty">Open or start a chat to run agents.</div>}
        {!disabled && (
          <>
            <div className="agent-list">
              {roles.map((r) => {
                const done = existing.has(r.id);
                const isRunning = running === r.id;
                const isFailed = failed.has(r.id);
                const blocked = !satisfied[r.id];
                const state = isRunning ? 'running' : isFailed ? 'failed' : done ? 'done' : '';
                const Icon = ROLE_ICON[r.id];
                return (
                  <React.Fragment key={r.id}>
                    <label
                      className={`agent-row ${state} ${selected.has(r.id) ? 'checked' : ''} ${blocked && !done ? 'disabled' : ''}`}
                      title={done ? 'Already produced — re-select to regenerate' : blocked ? 'Upstream agent required first' : ''}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        disabled={blocked && !done}
                        onChange={() => onToggle(r.id)}
                      />
                      {Icon && <Icon size={13} />}
                      <span className="agent-name">{r.label}</span>
                      <span className="state-dot" />
                    </label>
                    {blocked && !done && <div className="agent-requires">needs {(graph[r.id].requires ?? []).map((g) => g.map((x) => roleLabels[x]).join(' + ')).join(' or ')}</div>}
                  </React.Fragment>
                );
              })}
            </div>
            <div className="run-actions">
              {error && <div className="notice bad" style={{ marginBottom: 6 }}>{error}</div>}
              <button className="btn primary" disabled={busy || selected.size === 0} onClick={onGenerate}>
                {busy ? 'Running…' : selected.size ? `Generate ${selected.size} agent${selected.size > 1 ? 's' : ''}` : 'Generate'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
