import React, { useEffect, useState } from 'react';
import { getArtifactJSON } from '../api.js';

// UI-3: generated tree; each file shows its implements:[...] stamp (§8.5 provenance).
// backend.json is Agent 2's manifest (server/schemas/backend.js, locked shape backend/v1):
// { meta, modules: [{path, kind, implements, code, language}], server_entry, package_json,
// gaps }. The module's full source lives in modules[].code — the tree, not the runner's
// written-to-disk generated/ dir, is the source of truth here; feat/runner-connectors only
// materializes those same bytes to disk for `npm install`/boot, it doesn't produce new ones.
function normalizeManifest(raw) {
  if (!raw?.modules || !Array.isArray(raw.modules)) return null;
  return raw.modules.map((m) => ({
    path: m.path,
    kind: m.kind,
    implements: m.implements ?? [],
    code: m.code ?? '',
  }));
}

export default function CodeViewer({ runId, refreshKey, jumpTo, onJumped }) {
  const [manifest, setManifest] = useState(undefined); // undefined = loading, null = absent
  const [active, setActive] = useState(null);

  // Refetches whenever refreshKey changes (App.jsx passes agent2's phase status) — not just
  // on mount. Without this, a panel opened before Agent 2 commits backend.json would show
  // "not written yet" forever, even after the real file lands (found via live testing).
  useEffect(() => {
    let cancelled = false;
    getArtifactJSON(runId, 'backend.json').then((raw) => {
      if (cancelled) return;
      setManifest(normalizeManifest(raw));
    });
    return () => {
      cancelled = true;
    };
  }, [runId, refreshKey]);

  useEffect(() => {
    if (jumpTo) {
      setActive(jumpTo);
      onJumped?.();
    }
  }, [jumpTo]); // eslint-disable-line react-hooks/exhaustive-deps

  if (manifest === undefined) return <div className="empty-state">loading…</div>;

  if (manifest === null) {
    return (
      <div className="gap-notice">
        backend.json not written yet — either Agent 2 hasn't run, or this run predates
        feat/core-pipeline's real Backend Engineer landing. This viewer populates
        automatically once it exists; no UI change needed.
      </div>
    );
  }

  if (manifest.length === 0) {
    return <div className="empty-state">Agent 2 produced an empty manifest.</div>;
  }

  const activeModule = manifest.find((f) => f.path === active);

  return (
    <div className="code-layout">
      <div className="file-tree">
        {manifest.map((f) => (
          <div
            key={f.path}
            className={`file-row ${active === f.path ? 'selected' : ''}`}
            onClick={() => setActive(f.path)}
          >
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
