import React, { useEffect, useRef, useState } from 'react';

// Shared collapsible section — the "one screen, not a tab system" layout (PRD §17 non-goal):
// panels stack vertically and expand in place rather than switching views like an IDE.
//
// defaultOpen is evaluated by the CALLER on every render (e.g. "this phase has passed"), not
// just once — App.jsx's panels don't unmount when a run's data finishes loading or a phase
// transitions, so a naive useState(defaultOpen) only ever sees its value from the very first
// render (before any fetch resolves) and the panel would never actually auto-expand. This
// watches defaultOpen and opens in response to it flipping true, but never fights a user who
// has explicitly toggled the panel themselves.
export default function Panel({ title, right, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const userToggled = useRef(false);

  useEffect(() => {
    if (!userToggled.current && defaultOpen) setOpen(true);
  }, [defaultOpen]);

  function toggle() {
    userToggled.current = true;
    setOpen((o) => !o);
  }

  return (
    <div className="panel">
      <div
        className="panel-header"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggle();
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
