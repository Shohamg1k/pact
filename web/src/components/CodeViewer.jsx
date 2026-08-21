import React, { useEffect, useState } from 'react';
import { getArtifact } from '../api.js';

// Generalized from backend-only to any role whose artifact has a modules[] array
// (backend, frontend — both share the shape: {path, kind, implements, code}).
function normalizeManifest(raw) {
  if (!raw?.modules || !Array.isArray(raw.modules)) return null;
  return raw.modules.map((m) => ({ path: m.path, kind: m.kind, implements: m.implements ?? [], code: m.code ?? '' }));
}

export default function CodeViewer({ chatId, role, refreshKey, jumpTo, onJumped }) {
  const [manifest, setManifest] = useState(undefined); // undefined = loading, null = absent
  const [active, setActive] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getArtifact(chatId, role).then((raw) => {
      if (cancelled) return;
      setManifest(normalizeManifest(raw));
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, role, refreshKey]);

  useEffect(() => {
    if (jumpTo) {
      setActive(jumpTo);
      onJumped?.();
    }
  }, [jumpTo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (manifest === undefined) return <div className="empty-state">loading…</div>;
  if (manifest === null) return <div className="empty-state">{role} hasn't run yet.</div>;
  if (manifest.length === 0) return <div className="empty-state">{role} produced an empty manifest.</div>;

  const activeModule = manifest.find((f) => f.path === active);

  return (
    <div className="code-layout">
      <div className="file-tree">
        {manifest.map((f) => (
          <div key={f.path} className={`file-row ${active === f.path ? 'selected' : ''}`} onClick={() => setActive(f.path)}>
            <div>
              {f.path} <span style={{ color: 'var(--text-faint)' }}>· {f.kind}</span>
            </div>
            <div className="implements">
              {f.implements.length === 0 && <span className="chip orphan">implements: [] (orphan)</span>}
              {f.implements.map((id) => (
                <span key={id} className="chip">
                  {id}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div>
        {!activeModule && <div className="empty-state">Select a file to view its contents.</div>}
        {activeModule && <pre className="code-block">{activeModule.code}</pre>}
      </div>
    </div>
  );
}
