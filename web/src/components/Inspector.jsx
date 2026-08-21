import React from 'react';

// The shared shape every agent's output uses: a metrics toolbar, a main body, and a
// detail panel that opens on selection. The architecture diagram established this
// interaction (click a thing, read what it is, see what it connects to) and the other
// agents now follow it, so the product reads as one tool rather than seven screens that
// happen to live in the same window.

export function Inspector({ toolbar, detail, children, onCloseDetail }) {
  return (
    <div className="insp">
      {toolbar && <div className="insp-toolbar">{toolbar}</div>}
      <div className="insp-body">
        <div className="insp-main">{children}</div>
        {detail && (
          <aside className="insp-detail">
            {onCloseDetail && (
              <button className="icon-btn insp-close" onClick={onCloseDetail} title="Close">×</button>
            )}
            {detail}
          </aside>
        )}
      </div>
    </div>
  );
}

/** A labelled metric for the toolbar. `tone` drives the colour so a gap reads as a gap. */
export function Metric({ label, value, tone }) {
  return (
    <span className={`badge ${tone ?? ''}`} title={label}>
      <strong style={{ fontFamily: 'var(--mono)' }}>{value}</strong> {label}
    </span>
  );
}

/** A horizontal coverage bar — used wherever "how much of X is covered by Y" matters. */
export function CoverageBar({ covered, total, label }) {
  const pct = total ? Math.round((covered / total) * 100) : 0;
  const tone = pct === 100 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div className="cov">
      <div className="cov-head">
        <span>{label}</span>
        <span className="cov-num" style={{ color: tone }}>{covered}/{total} · {pct}%</span>
      </div>
      <div className="cov-track"><div className="cov-fill" style={{ width: `${pct}%`, background: tone }} /></div>
    </div>
  );
}

export function DetailHead({ icon, title, sub, children }) {
  return (
    <div className="dd-head">
      {icon}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="dd-title">{title}</div>
        {sub && <div className="dd-sub">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

export function Section({ title, children, count }) {
  return (
    <>
      <div className="section-title" style={{ marginTop: 16 }}>
        {title}{count != null && ` (${count})`}
      </div>
      {children}
    </>
  );
}

export function EmptyAgent({ role }) {
  return <div className="empty-state" style={{ padding: 22 }}>The {role} agent has not run for this chat yet.</div>;
}
