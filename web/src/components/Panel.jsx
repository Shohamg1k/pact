import React, { useState } from 'react';

// Shared collapsible section — the "one screen, not a tab system" layout (PRD §17 non-goal):
// panels stack vertically and expand in place rather than switching views like an IDE.
export default function Panel({ title, right, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel">
      <div
        className="panel-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
      >
        <div className="panel-title">
          <span className={`chevron ${open ? 'open' : ''}`}>▶</span>
          {title}
        </div>
        <div onClick={(e) => e.stopPropagation()}>{right}</div>
      </div>
      {open && <div className="panel-body">{children}</div>}
    </div>
  );
}
