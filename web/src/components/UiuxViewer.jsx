import React, { useState } from 'react';

export default function UiuxViewer({ artifact }) {
  const [active, setActive] = useState(null);
  if (!artifact) return <div className="empty-state">uiux hasn't run yet.</div>;
  const screen = artifact.screens.find((s) => s.path === active) ?? artifact.screens[0];

  return (
    <div className="code-layout">
      <div className="file-tree">
        {artifact.screens.map((s) => (
          <div key={s.path} className={`file-row ${screen?.path === s.path ? 'selected' : ''}`} onClick={() => setActive(s.path)}>
            <div>{s.name}</div>
            <div className="implements">
              {s.implements.map((id) => (
                <span key={id} className="chip">
                  {id}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        {!screen && <div className="empty-state">No screens.</div>}
        {screen && (
          <div>
            <div className="mini-card-title">{screen.name}</div>
            <pre className="code-block" style={{ whiteSpace: 'pre-wrap' }}>{screen.flow}</pre>
          </div>
        )}
      </div>
      {artifact.gaps?.length > 0 && <div className="gap-banner">{artifact.gaps.join(' · ')}</div>}
    </div>
  );
}
