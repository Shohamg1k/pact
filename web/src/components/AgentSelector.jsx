import React, { useMemo } from 'react';

// Mirrors server/agents/registry.js's `requires` check client-side, purely for instant
// UI feedback — the server re-validates authoritatively on submit (POST
// /chats/:id/generate), so a mismatch here is a UX bug, never a compliance bug. `roles`
// comes from GET /api/agents ({id, label, requires: [[...]]}); `existing` is the set
// of roles this chat already has an artifact for.
function isSatisfied(role, roleGraph, available) {
  const requires = roleGraph[role]?.requires ?? [];
  if (requires.length === 0) return true;
  return requires.some((group) => group.every((r) => available.has(r)));
}

function missingLabel(role, roleGraph, labels) {
  const requires = roleGraph[role]?.requires ?? [];
  return requires.map((g) => g.map((r) => labels[r]).join(' + ')).join(' OR ');
}

export default function AgentSelector({ roles, existing, selected, onChange, onSubmit, busy, error }) {
  const roleGraph = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r])), [roles]);
  const labels = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, r.label])), [roles]);

  // Progressive availability: a role checked earlier in the list can satisfy a later
  // one in the SAME selection, same as the server's topological check.
  const available = new Set(existing);
  const satisfiedNow = {};
  for (const r of roles) {
    satisfiedNow[r.id] = isSatisfied(r.id, roleGraph, available);
    if (selected.has(r.id)) available.add(r.id);
  }

  function toggle(roleId) {
    const next = new Set(selected);
    if (next.has(roleId)) next.delete(roleId);
    else next.add(roleId);
    onChange(next);
  }

  return (
    <div className="agent-selector">
      <div className="agent-grid">
        {roles.map((r) => {
          const already = existing.has(r.id);
          const disabled = already || !satisfiedNow[r.id];
          const missing = !satisfiedNow[r.id] ? missingLabel(r.id, roleGraph, labels) : null;
          return (
            <label
              key={r.id}
              className={`agent-card ${selected.has(r.id) ? 'checked' : ''} ${disabled ? 'disabled' : ''} ${already ? 'done' : ''}`}
              title={already ? 'Already generated for this chat' : missing ? `Needs: ${missing}` : ''}
            >
              <input
                type="checkbox"
                checked={selected.has(r.id) || already}
                disabled={disabled}
                onChange={() => toggle(r.id)}
              />
              <span className="agent-name">{r.label}</span>
              {already && <span className="badge ok small">done</span>}
              {!already && !satisfiedNow[r.id] && <span className="agent-requires">needs {missing}</span>}
            </label>
          );
        })}
      </div>
      {error && (
        <div className="gap-notice">
          {error.details?.map((e) => `${e.role}: ${e.detail}`).join(' · ') ?? error.message ?? 'Selection invalid.'}
        </div>
      )}
      <button className="btn primary" disabled={busy || selected.size === 0} onClick={onSubmit}>
        {busy ? 'Generating…' : `Generate ${selected.size ? `(${selected.size})` : ''}`}
      </button>
    </div>
  );
}
